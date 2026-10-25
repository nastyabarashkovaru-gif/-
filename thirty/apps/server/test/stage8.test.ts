import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, clock, getApp, prisma, resetDb } from './helpers';
import { setPaymentProvider } from '../src/payments';
import { CloudPaymentsProvider, cpSign } from '../src/payments/cloudpayments';
import { config } from '../src/config';

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
  it('страница оплаты, Check, Pay, дата автосписания 28-го, продление, отмена', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await api('POST', '/api/offer/start', U);
    await api('POST', '/api/consents', U, { kinds: ['offer', 'personal_data'] });
    const co = await api('POST', '/api/checkout', U, { tariffId: 'm3', idempotencyKey: 'cp-key-1' });
    expect(co.status).toBe(200);
    expect(co.body.amount).toBe(2490);
    const url = new URL(co.body.url);
    expect(url.pathname).toBe(`/pay/${co.body.paymentId}`);
    const page = await (await getApp()).inject({ method: 'GET', url: url.pathname + url.search });
    expect(page.body).toContain('widget.cloudpayments.ru');
    expect(page.body).toContain(`"invoiceId":"${co.body.paymentId}"`);
    expect(page.body).toContain('"startDate":"2027-01-28T09:00:00"');
    expect((await (await getApp()).inject({ method: 'GET', url: `/pay/${co.body.paymentId}?e=1&s=bad` })).body).toContain('недействительна');

    const base = { InvoiceId: co.body.paymentId, AccountId: String(U), Amount: '2490.00', Currency: 'RUB' };
    expect((await notify('check', { ...base, Amount: '1.00' })).body).toEqual({ code: 12 });
    expect((await notify('check', { ...base, AccountId: '1' })).body).toEqual({ code: 11 });
    expect((await notify('check', base, false)).status).toBe(401);
    expect((await notify('check', base)).body).toEqual({ code: 0 });

    const pay = { ...base, TransactionId: 1001, SubscriptionId: 'sc_abc', Token: 'tk_1', Email: 'a@b.ru', Status: 'Completed', TestMode: 1 };
    expect((await notify('pay', pay)).body).toEqual({ code: 0 });
    expect((await notify('pay', pay)).body).toEqual({ code: 0 }); // повтор — без двойного доступа
    const sub = await prisma.subscription.findFirstOrThrow({ where: { userId: BigInt(U) } });
    expect(sub).toMatchObject({ providerSubscriptionId: 'sc_abc', renewalPrice: 2490 });
    expect(sub.nextChargeDate!.toISOString().slice(0, 10)).toBe('2027-01-28');
    expect(await prisma.flowMembership.count({ where: { userId: BigInt(U) } })).toBe(3);
    // сервер сам выставил дату и сумму автосписания
    expect(apiCalls.find((c) => c.url.endsWith('/subscriptions/update'))!.body).toMatchObject({ Id: 'sc_abc', StartDate: '2027-01-28T09:00:00', Amount: 2490 });
    expect((await notify('check', base)).body).toEqual({ code: 13 }); // уже оплачен

    // автосписание 28 января: без InvoiceId, по SubscriptionId
    clock.set('2027-01-28T09:05:00Z');
    expect((await notify('pay', { AccountId: String(U), Amount: '2490.00', TransactionId: 2002, SubscriptionId: 'sc_abc', Status: 'Completed' })).body).toEqual({ code: 0 });
    const renewed = await prisma.subscription.findFirstOrThrow({ where: { userId: BigInt(U) } });
    expect(renewed.paidThroughFlow.toISOString().slice(0, 10)).toBe('2027-04-01');
    expect(renewed.nextChargeDate!.toISOString().slice(0, 10)).toBe('2027-04-28');

    // отмена поддержкой → подписка отменяется в CloudPayments
    const owner = await import('../src/modules/billing');
    await owner.cancelAutoRenew(BigInt(U), 'support: тест');
    expect(apiCalls.find((c) => c.url.endsWith('/subscriptions/cancel'))!.body).toEqual({ Id: 'sc_abc' });

    // неуспешное автосписание другого покупателя не трогает эту подписку; Recurrent Cancelled гасит автопродление
    expect((await notify('recurrent', { Id: 'sc_abc', AccountId: String(U), Status: 'Cancelled', Amount: '2490' })).body).toEqual({ code: 0 });
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
});
