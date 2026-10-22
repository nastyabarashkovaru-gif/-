import { beforeEach, describe, expect, it } from 'vitest';
import qs from 'qs';
import { api, clock, getApp, prisma, resetDb } from './helpers';
import { mockCalls, signMock } from '../src/payments/mock';
import { paymentProvider, setPaymentProvider } from '../src/payments';
import { ProdamusProvider } from '../src/payments/prodamus';
import { MockProvider } from '../src/payments/mock';
import { prodamusSign, prodamusVerify, normalize } from '../src/payments/sign';
import { handleWebhook, markRefunded, refreshSubscriptionStatuses } from '../src/modules/billing';

const U = 500;
const CONSENTS = ['personal_data', 'offer', 'public_reports', 'adult', 'autorenew'];

beforeEach(async () => {
  await resetDb();
  setPaymentProvider(new MockProvider());
  mockCalls.length = 0;
});

async function webhook(data: Record<string, unknown>) {
  const parsed = paymentProvider().parseWebhook({ sign: signMock(data) }, data);
  return handleWebhook(parsed, JSON.stringify(data));
}

async function buy(userId: number, tariffId: string, at = '2026-10-21T09:00:00Z') {
  clock.set(at);
  await api('POST', '/api/offer/start', userId);
  await api('POST', '/api/consents', userId, { kinds: CONSENTS });
  const co = await api('POST', '/api/checkout', userId, { tariffId, idempotencyKey: `key-${userId}-${tariffId}` });
  expect(co.status).toBe(200);
  return co.body as { paymentId: string; url: string; amount: number };
}

function paidEvent(paymentId: string, amount: number, userId: number) {
  return { order_num: paymentId, order_id: `pd-${paymentId}`, sum: `${amount}.00`, payment_status: 'success', customer_phone: '+79990001122', customer_extra: `tg:${userId}`, subscription_id: 'pd-sub-3m' };
}

describe('таймер предложения', () => {
  it('стартует один раз, не сбрасывается и реально меняет цену', async () => {
    clock.set('2026-10-21T09:00:00Z');
    const first = await api('POST', '/api/offer/start', U);
    expect(first.body.offer.active).toBe(true);
    expect(first.body.tariffs.map((t: { price: number }) => t.price)).toEqual([999, 2490, 3990]);
    expect(first.body.tariffs.map((t: { comparison: number }) => t.comparison)).toEqual([2990, 8970, 17940]);
    clock.set('2026-10-21T10:30:00Z');
    const again = await api('POST', '/api/offer/start', U);
    expect(again.body.offer.expiresAt).toBe(first.body.offer.expiresAt);
    clock.set('2026-10-21T12:00:01Z');
    const late = await api('GET', '/api/offer', U);
    expect(late.body.offer.active).toBe(false);
    expect(late.body.tariffs.map((t: { price: number }) => t.price)).toEqual([2990, 8970, 17940]);
    // ссылка после таймера — по обычной цене
    await api('POST', '/api/consents', U, { kinds: CONSENTS });
    const co = await api('POST', '/api/checkout', U, { tariffId: 'm1', idempotencyKey: 'after-timer-1' });
    expect(co.body.amount).toBe(2990);
    // продление — по цене покупки: после таймера 2990, без перечёркнутой «скидки»
    const pv = await api('GET', '/api/checkout/preview?tariff=m1', U);
    expect(pv.body.nextCharge.amount).toBe(2990);
    expect(pv.body.tariff.savingsPercent).toBe(0);
  });
});

describe('оплата и права доступа', () => {
  it('без согласий оплатить нельзя', async () => {
    clock.set('2026-10-21T09:00:00Z');
    const co = await api('POST', '/api/checkout', U, { tariffId: 'm1', idempotencyKey: 'no-consent-1' });
    expect(co.status).toBe(400);
    expect(co.body.code).toBe('consents_required');
  });

  it('S07 показывает даты до оплаты: 21.10, 3 месяца → ноябрь–январь, списание 28 января', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await api('POST', '/api/offer/start', U);
    const pv = await api('GET', '/api/checkout/preview?tariff=m3', U);
    expect(pv.body.flows.map((f: { startsOn: string }) => f.startsOn)).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(pv.body.nextCharge).toMatchObject({ date: '2027-01-28', amount: 2490 });
    expect(pv.body.text.renewal).toContain('28 января 2027');
  });

  it('критерий №2: webhook даёт 3 потока, следующий платёж 28.01, без списаний 28.11 и 28.12', async () => {
    const co = await buy(U, 'm3');
    expect(co.amount).toBe(2490);
    // повтор нажатия с тем же ключом — та же ссылка
    const again = await api('POST', '/api/checkout', U, { tariffId: 'm3', idempotencyKey: `key-${U}-m3` });
    expect(again.body.paymentId).toBe(co.paymentId);

    // redirect клиента ничего не даёт: до webhook доступа нет
    expect((await api('GET', `/api/payments/${co.paymentId}`, U)).body.status).toBe('pending');
    expect((await api('GET', '/api/membership', U)).body.membership).toBeNull();

    await webhook(paidEvent(co.paymentId, 2490, U));
    const sub = await prisma.subscription.findFirstOrThrow({ where: { userId: BigInt(U) } });
    expect(sub.status).toBe('prestart');
    expect(sub.nextChargeDate?.toISOString().slice(0, 10)).toBe('2027-01-28');
    const flows = await prisma.flowMembership.findMany({ where: { userId: BigInt(U) }, include: { flow: true }, orderBy: { flow: { startsOn: 'asc' } } });
    expect(flows.map((m) => m.flow.startsOn.toISOString().slice(0, 10))).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(mockCalls).toContainEqual(expect.objectContaining({ method: 'setNextChargeDate', arg: '2027-01-28' }));
    const sched = await prisma.billingSchedule.findMany({ where: { subscriptionId: sub.id } });
    expect(sched).toHaveLength(1);
    expect(sched[0]).toMatchObject({ months: 3, amount: 2490, status: 'synced' });

    for (const day of ['2026-11-28T12:00:00Z', '2026-12-28T12:00:00Z']) {
      clock.set(day);
      await refreshSubscriptionStatuses();
      const s = await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
      expect(s.status).toBe('active');
      expect(s.nextChargeDate?.toISOString().slice(0, 10)).toBe('2027-01-28');
    }
    expect(await prisma.payment.count({ where: { userId: BigInt(U), status: 'paid' } })).toBe(1);
  });

  it('критерий №10: повторный webhook и вторая оплата не дают двойного доступа', async () => {
    const co = await buy(U, 'm1');
    const ev = paidEvent(co.paymentId, 999, U);
    await webhook(ev);
    expect(await webhook(ev)).toEqual({ duplicate: true });
    // тот же платёж, но другое тело (повтор провайдера с attempt=2)
    await webhook({ ...ev, attempt: '2' });
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.flowMembership.count()).toBe(1);

    // второй платёж создать нельзя, пока подписка жива
    expect((await api('POST', '/api/checkout', U, { tariffId: 'm3', idempotencyKey: 'second-key-1' })).status).toBe(409);

    // гонка: две ссылки созданы до оплаты, обе оплачены
    await prisma.billingSchedule.deleteMany();
    await prisma.flowMembership.deleteMany();
    await prisma.payment.updateMany({ data: { status: 'pending', subscriptionId: null } });
    await prisma.subscription.deleteMany();
    const co2 = await api('POST', '/api/checkout', U, { tariffId: 'm3', idempotencyKey: 'race-key-2' });
    expect(co2.body).toMatchObject({ amount: 8970 });
    await webhook({ ...paidEvent(co.paymentId, 999, U), order_id: 'r1' });
    await webhook({ ...paidEvent(co2.body.paymentId, co2.body.amount, U), order_id: 'r2' });
    expect(await prisma.subscription.count()).toBe(1);
    const dup = await prisma.payment.findUniqueOrThrow({ where: { id: co2.body.paymentId } });
    expect(dup).toMatchObject({ status: 'paid', needsRefund: true, subscriptionId: null });
  });

  it('неверная подпись и неверная сумма не дают доступа', async () => {
    const co = await buy(U, 'm1');
    const ev = paidEvent(co.paymentId, 999, U);
    const bad = paymentProvider().parseWebhook({ sign: 'deadbeef' }, ev);
    expect(await handleWebhook(bad, JSON.stringify(ev) + 'x')).toEqual({ rejected: 'bad_signature' });
    expect(await prisma.subscription.count()).toBe(0);
    await webhook({ ...ev, sum: '1.00' });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: co.paymentId } })).status).toBe('disputed');
    expect(await prisma.subscription.count()).toBe(0);
  });

  it('продление 28 января даёт февраль–апрель; повтор автоплатежа игнорируется', async () => {
    const co = await buy(U, 'm3');
    await webhook(paidEvent(co.paymentId, 2490, U));
    clock.set('2027-01-28T08:00:00Z');
    const renewal = { order_id: 'auto-1', sum: '2490.00', payment_status: 'success', autopayment: '1', subscription_id: 'mock-sub', customer_extra: `tg:${U}`, customer_phone: '+79990001122' };
    await prisma.subscription.updateMany({ data: { providerSubscriptionId: 'mock-sub' } });
    expect(await webhook(renewal)).toMatchObject({ extended: ['2027-02-01', '2027-03-01', '2027-04-01'] });
    await webhook({ ...renewal, attempt: '2' });
    const sub = await prisma.subscription.findFirstOrThrow();
    expect(sub.paidThroughFlow.toISOString().slice(0, 10)).toBe('2027-04-01');
    expect(sub.nextChargeDate?.toISOString().slice(0, 10)).toBe('2027-04-28');
    expect(await prisma.flowMembership.count()).toBe(6);
    expect(await prisma.payment.count({ where: { kind: 'renewal', status: 'paid' } })).toBe(1);
  });

  it('неуспешное продление → past_due → оплата долга без двойного списания', async () => {
    const co = await buy(U, 'm1');
    await webhook(paidEvent(co.paymentId, 999, U));
    await prisma.subscription.updateMany({ data: { providerSubscriptionId: 'old-sub' } });
    clock.set('2026-11-28T08:00:00Z');
    await webhook({ order_id: 'auto-f', sum: '999.00', payment_status: 'order_denied', autopayment: '1', subscription_id: 'old-sub', customer_extra: `tg:${U}` });
    expect((await prisma.subscription.findFirstOrThrow()).status).toBe('past_due');
    const debt = await api('POST', '/api/subscription/pay-debt', U);
    expect(debt.status).toBe(200);
    await webhook({ order_num: debt.body.paymentId, order_id: 'debt-1', sum: '999.00', payment_status: 'success', subscription_id: 'new-sub', customer_extra: `tg:${U}` });
    const sub = await prisma.subscription.findFirstOrThrow();
    expect(sub).toMatchObject({ status: 'active', providerSubscriptionId: 'new-sub' });
    expect(sub.paidThroughFlow.toISOString().slice(0, 10)).toBe('2026-12-01');
    expect(mockCalls).toContainEqual(expect.objectContaining({ method: 'setActive', arg: false, ref: expect.objectContaining({ providerSubscriptionId: 'old-sub' }) }));
  });

  it('критерий №11: самостоятельная отмена без поддержки, доступ до конца периода', async () => {
    const co = await buy(U, 'm1');
    await webhook(paidEvent(co.paymentId, 999, U));
    clock.set('2026-11-10T08:00:00Z');
    for (const step of [1, 2, 3]) expect((await api('POST', '/api/subscription/cancel-step', U, { step })).status).toBe(200);
    const res = await api('POST', '/api/subscription/cancel', U, { reason: 'нет времени' });
    expect(res.body).toMatchObject({ canceled: true, paidUntil: '2026-12-01' });
    expect(mockCalls).toContainEqual(expect.objectContaining({ method: 'setActive', arg: false }));
    const s = await api('GET', '/api/subscription', U);
    expect(s.body.subscription).toMatchObject({ status: 'canceled_at_period_end', autoRenew: false, nextCharge: null });
    expect((await api('GET', '/api/membership', U)).body.membership.status).not.toBe('revoked');
    clock.set('2026-12-01T08:00:00Z');
    await refreshSubscriptionStatuses();
    expect((await prisma.subscription.findFirstOrThrow()).status).toBe('expired');
    const events = await prisma.analyticsEvent.findMany({ where: { eventName: { in: ['cancel_started', 'cancel_step_view', 'cancel_completed'] } } });
    expect(events.length).toBe(5);
  });

  it('возврат отзывает доступ и выключает автопродление', async () => {
    const co = await buy(U, 'm3');
    await webhook(paidEvent(co.paymentId, 2490, U));
    await markRefunded(co.paymentId, 'admin');
    expect((await prisma.subscription.findFirstOrThrow()).status).toBe('expired');
    expect(await prisma.flowMembership.count({ where: { status: 'revoked' } })).toBe(3);
    expect((await api('GET', '/api/membership', U)).body.membership).toBeNull();
  });
});

describe('Prodamus', () => {
  it('подпись: сортировка ключей, строки, экранирование слешей, вложенность', () => {
    expect(normalize({ b: 1, a: { d: null, c: 2 } })).toEqual({ a: { c: '2' }, b: '1' });
    const data = { order_id: '1', urlSuccess: 'https://x.ru/a', products: [{ price: 10, name: 'Тест' }] };
    const sig = prodamusSign(data, 'k');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(prodamusVerify({ products: [{ name: 'Тест', price: '10' }], urlSuccess: 'https://x.ru/a', order_id: 1 }, 'k', sig)).toBe(true);
    expect(prodamusVerify({ ...data, order_id: '2' }, 'k', sig)).toBe(false);
  });

  it('ссылка на оплату подписки подписана и содержит id подписки', async () => {
    const p = new ProdamusProvider();
    const { url } = await p.createPayment({ paymentId: 'pay-1', amount: 2490, title: '3 месяца', providerSubscriptionId: 1003, userId: '7', successUrl: 'https://t.me/b/app?startapp=pay_1', returnUrl: 'https://t.me/b/app', notificationUrl: 'https://x/api/payments/prodamus/webhook' });
    const u = new URL(url);
    expect(u.host).toBe('demo.payform.ru');
    const q = qs.parse(u.search.slice(1)) as Record<string, unknown>;
    expect(q).toMatchObject({ do: 'pay', order_id: 'pay-1', subscription: '1003' });
    const { signature, ...rest } = q;
    expect(prodamusVerify(rest, 'prodamus-test-secret', signature as string)).toBe(true);
  });

  it('webhook в формате формы с заголовком Sign выдаёт доступ', async () => {
    const co = await buy(U, 'm1');
    setPaymentProvider(new ProdamusProvider());
    const data = { date: '2026-10-21T12:00:00+03:00', order_id: '777', order_num: co.paymentId, domain: 'demo.payform.ru', sum: '999.00', customer_phone: '+79990001122', customer_extra: `tg:${U}`, payment_status: 'success', products: [{ name: '30 дней', price: '999.00', quantity: '1', sum: '999.00' }] };
    const app = await getApp();
    const res = await app.inject({ method: 'POST', url: '/api/payments/prodamus/webhook', headers: { 'content-type': 'application/x-www-form-urlencoded', sign: prodamusSign(data, 'prodamus-test-secret') }, payload: qs.stringify(data) });
    expect(res.statusCode).toBe(200);
    expect(await prisma.subscription.count()).toBe(1);
    const bad = await app.inject({ method: 'POST', url: '/api/payments/prodamus/webhook', headers: { 'content-type': 'application/x-www-form-urlencoded', sign: 'x'.repeat(64) }, payload: qs.stringify({ ...data, order_id: '778' }) });
    expect(bad.statusCode).toBe(400);
  });
});
