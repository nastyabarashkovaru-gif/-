import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, clock, getApp, prisma, resetDb } from './helpers';
import { setPaymentProvider } from '../src/payments';
import { CloudPaymentsProvider, cpSign } from '../src/payments/cloudpayments';
import { config } from '../src/config';
import { deliverPaymentAccess } from '../src/modules/paymentAccess';
import { setTelegramTransport } from '../src/lib/telegram';
import { DEFAULT_TEMPLATES } from '../src/modules/templates';
import { payToken, TRIBUTE_CHECKOUT_URL } from '../src/modules/botPay';

const U = 700;
let apiCalls: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(async () => {
  await resetDb();
  config.CP_PUBLIC_ID = 'pk_test';
  config.CP_API_SECRET = 'secret_test';
  setPaymentProvider(new CloudPaymentsProvider());
  apiCalls = [];
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    apiCalls.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ Success: true, Model: {} }), { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

async function notify(kind: string, data: Record<string, string | number>, sign = true) {
  const raw = new URLSearchParams(Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))).toString();
  const app = await getApp();
  const res = await app.inject({ method: 'POST', url: `/api/payments/cloudpayments/${kind}`, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(sign ? { 'content-hmac': cpSign(raw, 'secret_test') } : {}) }, payload: raw });
  return { status: res.statusCode, body: res.json() };
}

describe('CloudPayments', () => {
  it('кнопки бота открывают CloudPayments и Tribute при выключенном временном переключателе', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await api('GET', '/api/me', U);
    const token = payToken(BigInt(U), 'm1');
    const app = await getApp();
    const tributeOnly = config.BOT_TRIBUTE_ONLY;
    try {
      config.BOT_TRIBUTE_ONLY = true;
      const fallback = await app.inject({ method: 'GET', url: `/pay/new/${token}` });
      expect(fallback.headers.location).toBe(TRIBUTE_CHECKOUT_URL);
      expect(await prisma.payment.count()).toBe(0);

      config.BOT_TRIBUTE_ONLY = false;
      const checkout = await app.inject({ method: 'GET', url: `/pay/new/${token}` });
      const charge = await prisma.payment.findFirstOrThrow({ where: { userId: BigInt(U) } });
      expect(charge).toMatchObject({ provider: 'cloudpayments', status: 'pending', tariffId: 'm1' });
      expect(new URL(checkout.headers.location!).pathname).toBe(`/pay/${charge.id}`);
      const foreign = await app.inject({ method: 'GET', url: `/pay/tribute/${token}` });
      expect(foreign.headers.location).toBe(TRIBUTE_CHECKOUT_URL);
    } finally {
      config.BOT_TRIBUTE_ONLY = tributeOnly;
    }
  });

  it('страница оплаты, Check, Pay, дата автосписания 28-го, продление, отмена', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await api('POST', '/api/offer/start', U);
    await api('POST', '/api/consents', U, { kinds: ['offer', 'personal_data'] });
    const co = await api('POST', '/api/checkout', U, { tariffId: 'm3', idempotencyKey: 'cp-key-1' });
    expect(co.status).toBe(200);
    expect(co.body.amount).toBe(2990);
    const url = new URL(co.body.url);
    expect(url.pathname).toBe(`/pay/${co.body.paymentId}`);
    const page = await (await getApp()).inject({ method: 'GET', url: url.pathname + url.search });
    expect(page.body).toContain('widget.cloudpayments.ru');
    expect(page.body).toContain(`"invoiceId":"${co.body.paymentId}"`);
    expect(page.body).toContain('"startDate":"2027-01-28T09:00:00"');
    expect((await (await getApp()).inject({ method: 'GET', url: `/pay/${co.body.paymentId}?e=1&s=bad` })).body).toContain('недействительна');

    const base = { InvoiceId: co.body.paymentId, AccountId: String(U), Amount: '2990.00', Currency: 'RUB' };
    expect((await notify('check', { ...base, Amount: '1.00' })).body).toEqual({ code: 12 });
    expect((await notify('check', { ...base, Amount: '2989.99' })).body).toEqual({ code: 12 });
    expect((await notify('check', { ...base, Currency: 'USD' })).body).toEqual({ code: 12 });
    expect((await notify('check', { ...base, AccountId: '1' })).body).toEqual({ code: 11 });
    expect((await notify('check', base, false)).status).toBe(401);
    expect((await notify('check', base)).body).toEqual({ code: 0 });

    const pay = { ...base, TransactionId: 1001, SubscriptionId: 'sc_abc', Token: 'tk_1', Email: 'a@b.ru', Status: 'Completed', TestMode: 1 };
    expect((await notify('pay', pay)).body).toEqual({ code: 0 });
    expect((await notify('pay', pay)).body).toEqual({ code: 0 }); // повтор — без двойного доступа
    const sub = await prisma.subscription.findFirstOrThrow({ where: { userId: BigInt(U) } });
    expect(sub).toMatchObject({ providerSubscriptionId: 'sc_abc', renewalPrice: 2990 });
    expect(sub.nextChargeDate!.toISOString().slice(0, 10)).toBe('2027-01-28');
    expect(await prisma.flowMembership.count({ where: { userId: BigInt(U) } })).toBe(3);
    // сервер сам выставил дату и сумму автосписания
    expect(apiCalls.find((c) => c.url.endsWith('/subscriptions/update'))!.body).toMatchObject({ Id: 'sc_abc', StartDate: '2027-01-28T09:00:00', Amount: 2990 });
    expect((await notify('check', base)).body).toEqual({ code: 13 }); // уже оплачен

    // автосписание 28 января: без InvoiceId, по SubscriptionId
    clock.set('2027-01-28T09:05:00Z');
    expect((await notify('pay', { AccountId: String(U), Amount: '2990.00', TransactionId: 2002, SubscriptionId: 'sc_abc', Status: 'Completed' })).body).toEqual({ code: 0 });
    const renewed = await prisma.subscription.findFirstOrThrow({ where: { userId: BigInt(U) } });
    expect(renewed.paidThroughFlow.toISOString().slice(0, 10)).toBe('2027-04-01');
    expect(renewed.nextChargeDate!.toISOString().slice(0, 10)).toBe('2027-04-28');

    // отмена поддержкой → подписка отменяется в CloudPayments
    const owner = await import('../src/modules/billing');
    await owner.cancelAutoRenew(BigInt(U), 'support: тест');
    expect(apiCalls.find((c) => c.url.endsWith('/subscriptions/cancel'))!.body).toEqual({ Id: 'sc_abc' });

    // неуспешное автосписание другого покупателя не трогает эту подписку; Recurrent Cancelled гасит автопродление
    expect((await notify('recurrent', { Id: 'sc_abc', AccountId: String(U), Status: 'Cancelled', Amount: '2990' })).body).toEqual({ code: 0 });
    expect((await prisma.subscription.findFirstOrThrow({ where: { userId: BigInt(U) } })).autoRenew).toBe(false);
  });

  it('неуспешная оплата и чужие уведомления', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await api('POST', '/api/offer/start', U);
    await api('POST', '/api/consents', U, { kinds: ['offer', 'personal_data'] });
    const co = await api('POST', '/api/checkout', U, { tariffId: 'm1', idempotencyKey: 'cp-key-2' });
    expect((await notify('fail', { InvoiceId: co.body.paymentId, AccountId: String(U), Amount: '999.00', TransactionId: 3003, Reason: 'InsufficientFunds' })).body).toEqual({ code: 0 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: co.body.paymentId } })).status).toBe('failed');
    expect((await notify('pay', { InvoiceId: 'чужой-заказ', AccountId: '1', Amount: '100', TransactionId: 4004 })).body).toEqual({ code: 0 });
    expect(await prisma.subscription.count()).toBe(0);
  });

  it('повторяет уведомление Pay после сбоя базы и выдаёт одно приглашение', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await api('POST', '/api/offer/start', U);
    await api('POST', '/api/consents', U, { kinds: ['offer', 'personal_data'] });
    const co = await api('POST', '/api/checkout', U, { tariffId: 'm1', idempotencyKey: 'cp-retry-1' });
    expect(co.status).toBe(200);
    const base = { InvoiceId: co.body.paymentId, AccountId: String(U), Amount: '999.00', Currency: 'RUB' };
    expect((await notify('check', base)).body).toEqual({ code: 0 });
    const pay = { ...base, TransactionId: 6001, SubscriptionId: 'sc_retry', Status: 'Completed', TestMode: 1 };

    await prisma.payment.update({ where: { id: co.body.paymentId }, data: { tariffId: 'unavailable_test_tariff' } });
    try {
      expect((await notify('pay', pay)).status).toBe(500);
    } finally {
      await prisma.payment.update({ where: { id: co.body.paymentId }, data: { tariffId: 'm1' } });
    }
    const failed = await prisma.paymentEvent.findFirstOrThrow();
    expect(failed).toMatchObject({ processedAt: null, processingUntil: null, error: expect.any(String) });
    expect(await prisma.subscription.count()).toBe(0);

    await prisma.paymentEvent.update({ where: { id: failed.id }, data: { processingUntil: new Date('2026-10-21T09:02:00Z') } });
    expect((await notify('pay', pay)).status).toBe(503);
    clock.set('2026-10-21T09:02:00Z');

    expect((await notify('pay', pay)).body).toEqual({ code: 0 });
    expect((await notify('pay', pay)).body).toEqual({ code: 0 });
    expect(await prisma.paymentEvent.count()).toBe(1);
    expect(await prisma.paymentEvent.findUniqueOrThrow({ where: { id: failed.id } })).toMatchObject({ processedAt: expect.any(Date), processingUntil: null, error: null });
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.paymentAccessDelivery.count()).toBe(1);

    const membership = await prisma.flowMembership.findFirstOrThrow();
    await prisma.telegramChat.create({ data: { kind: 'flow', flowId: membership.flowId, telegramChatId: -100700n, title: 'Тестовый чат' } });
    await prisma.botMessageTemplate.create({ data: DEFAULT_TEMPLATES.find((template) => template.key === 'payment_success')! });
    const messages: Record<string, unknown>[] = [];
    setTelegramTransport(async (method, body) => {
      if (method === 'createChatInviteLink') return { invite_link: 'https://t.me/+exampleInvite' } as never;
      if (method === 'sendMessage') messages.push(body);
      return { message_id: 1 } as never;
    });
    await deliverPaymentAccess();
    await deliverPaymentAccess();
    expect(await prisma.paymentAccessDelivery.findUniqueOrThrow({ where: { paymentId: co.body.paymentId } })).toMatchObject({ status: 'sent', attempts: 1 });
    expect(messages).toHaveLength(1);
    expect(messages[0].reply_markup).toMatchObject({
      inline_keyboard: expect.arrayContaining([[{ text: 'Зайти в чат 💬', url: 'https://t.me/+exampleInvite' }]]),
    });
  });

  it.each([
    [{ Currency: 'USD' }, 'currency_mismatch'],
    [{ AccountId: '701' }, 'account_mismatch'],
    [{ Amount: '998.99' }, 'amount_mismatch:998.99'],
  ])('отправляет несовпадающий Pay на сверку: %j', async (override, reason) => {
    clock.set('2026-10-21T09:00:00Z');
    await api('POST', '/api/consents', U, { kinds: ['offer', 'personal_data'] });
    const co = await api('POST', '/api/checkout', U, { tariffId: 'm1', idempotencyKey: 'cp-mismatch-1' });
    expect(co.status).toBe(200);
    const pay = { InvoiceId: co.body.paymentId, AccountId: String(U), Amount: '999.00', Currency: 'RUB', TransactionId: 6002, Status: 'Completed', ...override };
    expect((await notify('pay', pay)).body).toEqual({ code: 0 });
    expect(await prisma.payment.findUniqueOrThrow({ where: { id: co.body.paymentId } })).toMatchObject({ status: 'disputed', failureReason: reason });
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.paymentAccessDelivery.count()).toBe(0);
  });
});
