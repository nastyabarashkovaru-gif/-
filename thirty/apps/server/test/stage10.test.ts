import { beforeEach, describe, expect, it } from 'vitest';
import { api, clock, grantMembership, prisma, resetDb } from './helpers';
import { removeMember, restoreMember } from '../src/modules/removeMember';
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

describe('удалить участника', () => {
  it('выходит из подбора и пары, партнёр получает нового бадди; можно вернуть', async () => {
    clock.set('2026-10-31T09:00:00Z');
    for (const id of [701, 702, 703]) await grantMembership(id, '2026-11-01');
    const flow = await prisma.flow.findFirstOrThrow({ where: { startsOn: new Date('2026-11-01T00:00:00Z') } });
    const { autoMatch } = await import('../src/modules/buddy');
    await autoMatch(flow.id);
    const pair = await prisma.buddyPair.findFirstOrThrow({ where: { flowId: flow.id, status: 'active' } });
    const waiting = [701n, 702n, 703n].find((u) => u !== pair.userA && u !== pair.userB)!;

    const res = await removeMember(pair.userA, { closeSubscription: true });
    expect(res).toMatchObject({ pairsDissolved: 1 });
    expect(await prisma.flowMembership.findFirstOrThrow({ where: { userId: pair.userA, flowId: flow.id } })).toMatchObject({ status: 'revoked' });
    // бывший партнёр сразу в паре с тем, кто ждал
    const fresh = await prisma.buddyPair.findFirstOrThrow({ where: { flowId: flow.id, status: 'active' } });
    expect([fresh.userA, fresh.userB].sort()).toEqual([pair.userB, waiting].sort());
    await autoMatch(flow.id);
    expect(await prisma.buddyAssignment.count({ where: { flowId: flow.id, userId: pair.userA } })).toBe(0);

    await restoreMember(pair.userA);
    expect((await prisma.flowMembership.findFirstOrThrow({ where: { userId: pair.userA, flowId: flow.id } })).status).not.toBe('revoked');
  });
});

describe('онбординг: отзывы и «Нас уже 300+»', () => {
  it('порядок и состав карусели — из настроек; выключенные не показываются', async () => {
    const { setSetting, getSetting } = await import('../src/settings');
    const r = await api('GET', '/api/public/onboarding', 801);
    expect(r.status).toBe(200);
    expect(r.body.count).toBe('274');
    expect(r.body.reviews.slice(0, 3).map((x: { id: string }) => x.id)).toEqual(['weight', 'reels', 'veneers']);
    expect(r.body.reviews[0].image).toBe('/img/reviews/weight.jpg');
    expect(new Set(r.body.reviews.map((x: { image: string }) => x.image)).size).toBe(r.body.reviews.length);
    const list = await getSetting('onboarding.reviews');
    await setSetting('onboarding.reviews', [{ ...list[1] }, { ...list[0], enabled: false }, { id: 'up', emoji: '💜', title: 'Загружено', image: 'reviews/0b0b0b0b-1111-2222-3333-444444444444.jpg', enabled: true }]);
    await setSetting('community.count', '350+');
    const r2 = await api('GET', '/api/public/onboarding', 801);
    expect(r2.body.reviews.map((x: { id: string }) => x.id)).toEqual(['reels', 'up']);
    expect(r2.body.reviews[1].image).toBe('/api/public/review-image/0b0b0b0b-1111-2222-3333-444444444444.jpg');
    expect(r2.body.count).toBe('350');
    // каждая новая первая оплата после старта отсчёта (+1 на человека; тестовые не считаются)
    await setSetting('community.countSince', '2026-10-01T00:00:00Z');
    for (const [id, test] of [[811, false], [812, true]] as const) {
      await prisma.user.create({ data: { id: BigInt(id), firstName: 'П' } });
      await prisma.payment.create({ data: { userId: BigInt(id), kind: 'initial', status: 'paid', amount: 999, test, paidAt: new Date('2026-10-20T10:00:00Z'), idempotencyKey: `cnt-${id}` } });
    }
    expect((await api('GET', '/api/public/onboarding', 801)).body.count).toBe('351');
    const v = await api('GET', '/api/public/value', 801);
    expect(v.body.items.map((x: { title: string }) => x.title)).toContain('Еженедельные разборы');
  });
});
