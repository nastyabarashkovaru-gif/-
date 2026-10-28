import { beforeEach, describe, expect, it } from 'vitest';
import { api, clock, prisma, resetDb } from './helpers';
import { handleWebhook } from '../src/modules/billing';
import { startOver } from '../src/modules/startOver';
import { paymentProvider, setPaymentProvider } from '../src/payments';
import { MockProvider, signMock } from '../src/payments/mock';
import { homeFunnel, homeMoney, homeRetention, resolveRange } from '../src/modules/adminHome';

beforeEach(resetDb);

const ts = (s: string) => new Date(s);
let n = 0;
const ev = (userId: number, eventName: string, at: string, screenId?: string) =>
  prisma.analyticsEvent.create({ data: { eventId: `t-${++n}`, userId: BigInt(userId), sessionId: `s-${userId}`, eventName, screenId, ts: ts(at) } });
const pay = (userId: number, data: { kind: 'initial' | 'renewal'; status: 'paid' | 'failed' | 'refunded'; amount: number; at: string; from?: string; months?: number; tariffId?: string; test?: boolean }) =>
  prisma.payment.create({
    data: {
      userId: BigInt(userId), kind: data.kind, status: data.status, amount: data.amount, tariffId: data.tariffId ?? 'm1', test: data.test ?? false,
      paidAt: data.status === 'failed' ? null : ts(data.at), refundedAt: data.status === 'refunded' ? ts(data.at) : null, createdAt: ts(data.at),
      coversFromFlow: data.from ? new Date(`${data.from}T00:00:00Z`) : null, months: data.months ?? null, idempotencyKey: `k-${++n}`,
    },
  });

describe('главный экран админки', () => {
  it('воронка бот → оплата по уникальным людям, деньги без тестовых и возвратов, удержание только по наступившим срокам', async () => {
    clock.set('2026-10-21T09:00:00Z');
    for (let i = 1; i <= 10; i++) await prisma.user.create({ data: { id: BigInt(i), firstName: `U${i}` } });
    // 1–4 нажали /start; 5 открыла приложение по прямой ссылке
    for (const u of [1, 2, 3, 4]) await prisma.botMessageLog.create({ data: { userId: BigInt(u), templateKey: 'welcome', dedupeKey: `welcome:${u}`, status: 'sent', sentAt: ts('2026-10-20T10:00:00Z') } });
    for (const u of [1, 2, 3, 5]) { await ev(u, 'app_open', '2026-10-20T10:05:00Z'); await ev(u, 'app_open', '2026-10-20T11:00:00Z'); }
    for (const u of [1, 2, 3]) await ev(u, 'onboarding_step_view', '2026-10-20T10:06:00Z', 'O01');
    for (const u of [1, 2]) await ev(u, 'onboarding_step_view', '2026-10-20T10:07:00Z', 'O02');
    await ev(1, 'onboarding_step_view', '2026-10-20T10:08:00Z', 'O03');
    for (const u of [1, 2, 5]) await ev(u, 'tariff_view', '2026-10-20T10:09:00Z');
    await ev(1, 'payment_start', '2026-10-20T10:10:00Z');
    // оплатила на следующий день — переход всё равно засчитан
    await pay(1, { kind: 'initial', status: 'paid', amount: 2490, at: '2026-10-21T08:00:00Z', from: '2026-11-01', months: 3, tariffId: 'm3' });

    const r = await resolveRange({ period: '7d' });
    expect(r).toMatchObject({ from: '2026-10-15', to: '2026-10-21' });
    const f = await homeFunnel(r);
    const step = (k: string) => f.steps.find((s) => s.key === k)!;
    expect(f.cards).toMatchObject({ bot: { count: 5 }, app: { count: 4, ofPrev: 80 }, tariffs: { count: 3, ofPrev: 75 }, paid: { count: 1, ofPrev: 33.3 } });
    expect(f.hero.botToPaid).toBe(20);
    expect(f.previous).toBeNull(); // до периода данных нет — сравнение не выдумываем
    expect(step('o01').count).toBe(4); // 5 пропустила онбординг, но дошла до тарифов
    expect(step('o03')).toMatchObject({ count: 3, lost: 0 });
    expect(step('select')).toMatchObject({ count: 1, lost: 2, lostPct: 66.7 });
    expect(f.worst).toMatchObject({ from: 'Тарифы', to: 'Выбор тарифа', lostPct: 66.7 });
    expect(f.daily.current.app[5]).toBe(4); // повторные открытия в тот же день — один человек
    expect(f.note).toBeTruthy();

    // деньги: возврат, неуспешная и тестовая оплаты не увеличивают выручку
    await pay(6, { kind: 'initial', status: 'paid', amount: 999, at: '2026-09-10T08:00:00Z', from: '2026-09-01', months: 1 });
    await pay(6, { kind: 'renewal', status: 'paid', amount: 999, at: '2026-10-20T08:00:00Z', from: '2026-10-01', months: 1 });
    await pay(7, { kind: 'initial', status: 'failed', amount: 999, at: '2026-10-20T08:00:00Z' });
    await pay(8, { kind: 'initial', status: 'refunded', amount: 999, at: '2026-10-20T08:00:00Z', from: '2026-11-01', months: 1 });
    await pay(9, { kind: 'initial', status: 'paid', amount: 5000, at: '2026-10-20T08:00:00Z', from: '2026-11-01', months: 6, test: true });
    await pay(10, { kind: 'initial', status: 'paid', amount: 999, at: '2026-09-12T08:00:00Z', from: '2026-09-01', months: 1 });
    const m = await homeMoney(r);
    expect(m).toMatchObject({ revenue: 3489, payments: 2, buyers: 2, avgCheck: 1745, newPurchases: 1, renewals: 1, refunds: { amount: 999, count: 1 } });
    expect(m.revenueChange).toBe(null); // в прошлом периоде (8–14.10) оплат не было
    expect(m.tariffs.find((t) => t.id === 'm3')).toMatchObject({ count: 1, revenue: 2490, pct: 100 });
    expect(m.recent.map((p) => p.amount)).not.toContain(5000);

    // удержание: 6 продлила на октябрь, 10 — нет; у 1 срок ещё не наступил
    const ret = await homeRetention(await resolveRange({ period: '30d' }));
    expect(ret).toMatchObject({ due: 2, renewed: 1, notRenewed: 1, renewedPct: 50, churnPct: 50 });
    expect(ret.cohorts.find((c) => c.month === '2026-09-01')).toMatchObject({ size: 2, cells: [100, 50, null, null, null, null] });
  });
});

async function buy(userId: number, key: string) {
  await api('POST', '/api/consents', userId, { kinds: ['offer', 'personal_data'] });
  const co = await api('POST', '/api/checkout', userId, { tariffId: 'm1', idempotencyKey: key });
  expect(co.status).toBe(200);
  const data = { order_num: co.body.paymentId, order_id: `pd-${co.body.paymentId}`, sum: `${co.body.amount}.00`, payment_status: 'success', customer_extra: `tg:${userId}`, subscription_id: 'pd-sub' };
  await handleWebhook(paymentProvider().parseWebhook({ sign: signMock(data) }, data), JSON.stringify(data));
}

describe('начать путь заново', () => {
  it('подписка закрыта, оплаты тестовые, анкета удалена — и можно снова купить', async () => {
    setPaymentProvider(new MockProvider());
    clock.set('2026-10-21T09:00:00Z');
    await api('POST', '/api/offer/start', 501);
    await buy(501, 'start-over-1');
    const m = await prisma.flowMembership.findFirstOrThrow({ where: { userId: 501n } });
    await prisma.flowMembership.update({ where: { id: m.id }, data: { expectation: 'Хочу дисциплину' } });
    await prisma.goal.create({ data: { membershipId: m.id, category: 'blog', title: 'Блог', successCriterion: '1000' } });
    await prisma.user.update({ where: { id: 501n }, data: { interests: ['blog'], city: 'Москва' } });

    const res = await startOver(501n);
    expect(res.subscriptions[0].autopayOff).toBe(true);
    expect(await prisma.subscription.findFirstOrThrow({ where: { userId: 501n } })).toMatchObject({ status: 'expired', autoRenew: false, test: true });
    expect(await prisma.payment.count({ where: { userId: 501n, status: 'paid', test: false } })).toBe(0);
    expect(await prisma.goal.count({ where: { membershipId: m.id } })).toBe(0);
    expect(await prisma.priceOffer.count({ where: { userId: 501n } })).toBe(0);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: 501n } })).toMatchObject({ interests: [], city: null, onboardingStage: 'new' });

    // снова как новичок: новый таймер, оплата, анкета с чистого листа
    expect((await api('POST', '/api/offer/start', 501)).status).toBe(200);
    await buy(501, 'start-over-2');
    expect(await prisma.subscription.count({ where: { userId: 501n, status: { in: ['prestart', 'active'] }, test: false } })).toBe(1);
    expect(await prisma.flowMembership.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: 'reserved', expectation: null });
  });
});
