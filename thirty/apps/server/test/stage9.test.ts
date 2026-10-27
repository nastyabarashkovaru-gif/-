import { beforeEach, describe, expect, it } from 'vitest';
import { api, clock, getApp, grantMembership, prisma, resetDb, upload } from './helpers';
import { refreshFlowStatuses } from '../src/modules/flows';
import { setTelegramTransport } from '../src/lib/telegram';
import { setAdminBotTransport, adminBotLinkCode, adminBotSecret } from '../src/modules/adminBot';
import { seedTemplates } from '../src/modules/bot';
import { config } from '../src/config';
import { renderResultCardPng } from '../src/modules/cards';

/** ТЗ 27.10: ожидания, обратная связь на предпоследний день, итоги, возврат по прежней цене, отзыв за трекеры, карточка */
const NOV = '2026-11-01';
const U = 900;
let sent: { method: string; body: Record<string, any> }[] = [];
let admin: { method: string; body: Record<string, any> }[] = [];

beforeEach(async () => {
  await resetDb();
  await seedTemplates();
  sent = [];
  admin = [];
  config.ADMIN_BOT_TOKEN = '1:ADMIN_TEST';
  setTelegramTransport(async (method, body) => (sent.push({ method, body }), { message_id: 1 }) as never);
  setAdminBotTransport(async (method, body) => (admin.push({ method, body }), { message_id: 1 }) as never);
});

async function member(userId = U) {
  clock.set('2026-10-25T10:00:00Z');
  await grantMembership(userId, NOV, 'm1');
  await prisma.user.update({ where: { id: BigInt(userId) }, data: { allowsWrite: true } });
  const g = await api('POST', '/api/goals', userId, { category: 'weightloss', title: 'Минус 3 кг', pointA: '60 кг', pointB: '57 кг', confirmMethod: 'daily_reports', successCriterion: '57 кг' });
  await api('POST', `/api/goals/${g.body.id}/tasks`, userId, { title: 'Шаги', frequency: 'daily' });
  expect((await api('POST', '/api/membership/fix', userId)).status).toBe(200);
  return g.body.id as string;
}

async function day(n: number, hour = 12) {
  clock.set(`2026-11-${String(n).padStart(2, '0')}T${String(hour - 3).padStart(2, '0')}:00:00Z`);
  await refreshFlowStatuses();
}

describe('анкета: «Что ты хочешь получить от клуба»', () => {
  it('ответ сохраняется в участии текущего потока', async () => {
    clock.set('2026-10-25T10:00:00Z');
    await grantMembership(U, NOV, 'm1');
    expect((await api('PUT', '/api/membership/expectation', U, { expectation: '' })).status).toBe(400);
    expect((await api('PUT', '/api/membership/expectation', U, { expectation: 'Новые привычки и окружение' })).status).toBe(200);
    expect((await prisma.flowMembership.findFirstOrThrow({ where: { userId: BigInt(U) } })).expectation).toBe('Новые привычки и окружение');
  });
});

describe('обратная связь на предпоследний день', () => {
  it('открывается на 29-й день, сохраняется один раз', async () => {
    await member();
    await day(28);
    expect((await api('GET', '/api/home', U)).body.prompts.feedback).toBe(false);
    const body = { month: 'Хорошо', helped: ['Поддержка напарника'], hindered: [], hinderedOther: 'Болела', benefit: 'Окружение', change: 'Больше созвонов', needHelp: 'Нет' };
    expect((await api('POST', '/api/feedback', U, body)).body.code).toBe('feedback_not_open');
    await day(29);
    expect((await api('GET', '/api/home', U)).body.prompts.feedback).toBe(true);
    expect((await api('POST', '/api/feedback', U, { ...body, hinderedOther: '' })).status).toBe(400);
    expect((await api('POST', '/api/feedback', U, body)).status).toBe(200);
    expect((await api('POST', '/api/feedback', U, body)).body.code).toBe('feedback_done');
    expect((await api('GET', '/api/home', U)).body.prompts.feedback).toBe(false);
    const fb = await prisma.flowFeedback.findFirstOrThrow();
    expect(fb).toMatchObject({ month: 'Хорошо', helped: ['Поддержка напарника'], hinderedOther: 'Болела' });
  });
});

describe('итоги потока и «Поставить новую цель»', () => {
  it('итоги — в последний день; оценка каждой цели; без подписки — предложение вернуться', async () => {
    const goalId = await member();
    await day(29);
    expect((await api('GET', '/api/finale', U)).body.code).toBe('finale_not_open');
    await day(30);
    const f = await api('GET', '/api/finale', U);
    expect(f.status).toBe(200);
    expect(f.body.stats).toMatchObject({ reportDays: 0, goalsTotal: 1 });
    expect(f.body.goals[0]).toMatchObject({ id: goalId, pointA: '60 кг', pointB: '57 кг' });
    expect((await api('POST', '/api/finale', U, { outcomes: [], result: 'Минус 2 кг' })).status).toBe(400);
    const s = await api('POST', '/api/finale', U, { outcomes: [{ goalId, outcome: 'partial' }], result: 'Минус 2 кг' });
    expect(s.body.next.kind).toBe('comeback');
    expect(await prisma.goal.findUniqueOrThrow({ where: { id: goalId } })).toMatchObject({ finalOutcome: 'partial', finalAchieved: false });
    const card = await api('POST', '/api/finale/card', U, { result: 'Минус 2 кг', showRank: true });
    expect(card.body.card).toMatchObject({ result: 'Минус 2 кг', days: 0, goal: 'Цель достигнута частично' });
    const token = String(card.body.imageUrl).split('?c=')[1];
    const png = await (await getApp()).inject({ method: 'GET', url: `/api/public/result-card.png?c=${token}` });
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect((await (await getApp()).inject({ method: 'GET', url: `/api/public/result-card.png?c=${token.slice(0, -2)}xx` })).statusCode).toBe(404);
  });

  it('40 минут по прежней цене: таймер на сервере, не перезапускается, после — обычные тарифы', async () => {
    await member();
    const sub = await prisma.subscription.create({
      data: { userId: BigInt(U), tariffId: 'm1', status: 'expired', autoRenew: false, renewalPrice: 999, priceVariant: 'promo', paidFromFlow: new Date('2026-11-01'), paidThroughFlow: new Date('2026-11-01') },
    });
    await day(30);
    expect((await api('GET', '/api/comeback', U)).body).toMatchObject({ available: true, started: false, active: false });
    const first = (await api('GET', '/api/comeback?start=1', U)).body;
    expect(first).toMatchObject({ active: true, price: 999, tariff: { id: 'm1' } });
    expect(first.msLeft).toBe(40 * 60_000);
    clock.set(new Date(clock.now().getTime() + 10 * 60_000).toISOString());
    const again = (await api('GET', '/api/comeback?start=1', U)).body;
    expect(again.expiresAt).toBe(first.expiresAt);
    expect(again.msLeft).toBe(30 * 60_000);
    // Прежняя цена — только для того же тарифа и только пока идёт таймер
    await api('POST', '/api/consents', U, { kinds: ['offer', 'personal_data'] });
    const preview = await api('GET', '/api/checkout/preview?tariff=m1&comeback=1', U);
    expect(preview.body.tariff.price).toBe(999);
    const pay = await api('POST', '/api/checkout', U, { tariffId: 'm1', idempotencyKey: 'comeback-1', comeback: true });
    expect(pay.body.amount).toBe(999);
    // Другие тарифы — по тем же (акционным) условиям, что и закончившаяся подписка
    expect((await api('GET', '/api/comeback', U)).body.tariffs.map((t: any) => [t.id, t.price])).toEqual([['m1', 999], ['m3', 2490], ['m6', 3990]]);
    expect((await api('GET', '/api/checkout/preview?tariff=m6&comeback=1', U)).body.tariff.price).toBe(3990);
    clock.set(new Date(clock.now().getTime() + 31 * 60_000).toISOString());
    expect((await api('GET', '/api/comeback?start=1', U)).body).toMatchObject({ active: false, msLeft: 0 });
    expect((await api('POST', '/api/checkout', U, { tariffId: 'm1', idempotencyKey: 'comeback-3', comeback: true })).body.code).toBe('comeback_expired');
    // Обычная покупка после таймера — по актуальной цене (условия старой подписки не трогаем)
    const regular = await api('POST', '/api/checkout', U, { tariffId: 'm1', idempotencyKey: 'regular-1' });
    expect(regular.body.amount).toBeGreaterThan(999);
    expect(sub.id).toBeTruthy();
  });

  it('оплачен следующий поток — «Поставить новую цель» ведёт к анкете, старые цели остаются', async () => {
    const goalId = await member();
    await grantMembership(U, '2026-12-01', 'm1');
    await day(30);
    const s = await api('POST', '/api/finale', U, { outcomes: [{ goalId, outcome: 'full' }], result: 'Минус 3 кг' });
    expect(s.body.next).toMatchObject({ kind: 'goals', flowStartsOn: '2026-12-01' });
    expect((await api('PUT', '/api/membership/expectation', U, { expectation: 'Продолжить' })).status).toBe(200);
    const all = await prisma.flowMembership.findMany({ where: { userId: BigInt(U) }, include: { flow: true }, orderBy: { flow: { startsOn: 'asc' } } });
    expect(all.map((m) => m.expectation)).toEqual([null, 'Продолжить']);
    expect(await prisma.goal.count({ where: { id: goalId } })).toBe(1);
  });
});

describe('отзыв за трекеры', () => {
  it('окно с 14-го дня раз в 14 дней; скриншот → админ-бот → трекеры один раз', async () => {
    await member();
    await day(13);
    expect((await api('GET', '/api/home', U)).body.prompts.trackers).toBe(false);
    await day(14);
    expect((await api('GET', '/api/home', U)).body.prompts.trackers).toBe(true);
    await api('POST', '/api/trackers/prompted', U);
    expect((await api('GET', '/api/home', U)).body.prompts.trackers).toBe(false);
    await day(28);
    expect((await api('GET', '/api/home', U)).body.prompts.trackers).toBe(true);

    const app = await getApp();
    const hook = (payload: object) => app.inject({ method: 'POST', url: '/api/telegram/admin-webhook', headers: { 'x-telegram-bot-api-secret-token': adminBotSecret() }, payload });
    await hook({ message: { chat: { id: 77, type: 'private' }, text: `/start ${adminBotLinkCode()}` } });
    const shot = await upload(U);
    expect((await api('POST', '/api/trackers', U, { mediaId: 'b3c1f8e2-1111-4111-8111-111111111111' })).body.code).toBe('media_not_found');
    const st = await api('POST', '/api/trackers', U, { mediaId: shot.body.id });
    expect(st.body.status).toBe('pending');
    expect((await api('POST', '/api/trackers', U, { mediaId: shot.body.id })).body.code).toBe('review_pending');
    expect((await api('GET', '/api/home', U)).body.prompts.trackers).toBe(false);
    const card = admin.find((c) => c.method === 'sendPhoto')!;
    expect(card.body.caption).toContain('Вам оставили отзыв');
    const [grant, clarify] = card.body.reply_markup.inline_keyboard.map((row: any[]) => row[0]);
    expect(grant.text).toBe('🎁 Выдать трекеры');

    // Уточнение → новый скриншот → выдача, повторная выдача невозможна
    await hook({ callback_query: { id: 'q1', from: { id: 77 }, data: clarify.callback_data, message: { chat: { id: 77 }, message_id: 5, caption: 'x', photo: [{}] } } });
    expect((await api('GET', '/api/trackers', U)).body.status).toBe('needs_info');
    expect(sent.some((c) => String(c.body.text).includes('новый скриншот'))).toBe(true);
    await prisma.setting.create({ data: { key: 'trackers.links', value: { tasks: 'https://docs.google.com/t', week: 'https://docs.google.com/w', finance: 'https://docs.google.com/f' } } });
    const second = await api('POST', '/api/trackers', U, { mediaId: (await upload(U)).body.id });
    expect(second.body.status).toBe('pending');
    const card2 = admin.filter((c) => c.method === 'sendPhoto').at(-1)!;
    const grant2 = card2.body.reply_markup.inline_keyboard[0][0].callback_data;
    await hook({ callback_query: { id: 'q2', from: { id: 77 }, data: grant2, message: { chat: { id: 77 }, message_id: 6, caption: 'x', photo: [{}] } } });
    await hook({ callback_query: { id: 'q3', from: { id: 77 }, data: grant2, message: { chat: { id: 77 }, message_id: 6, caption: 'x', photo: [{}] } } });
    const gifts = sent.filter((c) => String(c.body.text).includes('Обещанные подарки'));
    expect(gifts).toHaveLength(1);
    expect(gifts[0].body.text).toContain('https://docs.google.com/f');
    expect((await api('GET', '/api/trackers', U)).body).toMatchObject({ status: 'granted', links: { week: 'https://docs.google.com/w' } });
    await day(30);
    expect((await api('GET', '/api/home', U)).body.prompts.trackers).toBe(false);
  });
});

describe('карточка результатов', () => {
  it('рисуется 1080×1920 с длинным результатом и без необязательных строк', () => {
    const png = renderResultCardPng({ result: 'Похудела на 3 кг и начала бегать по утрам каждый день', days: 27, goal: 'Цель достигнута', rank: 'Топ-15 участников', link: 'https://t.me/Dney30_bot?start=stories' });
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1920);
    expect(renderResultCardPng({ link: 'https://t.me/x' }).length).toBeGreaterThan(1000);
  });
});

describe('возврат по прежней цене: оплата', () => {
  it('отменённая подписка закрывается, новая — со следующего потока, без двойной подписки', async () => {
    const { MockProvider, signMock } = await import('../src/payments/mock');
    const { setPaymentProvider, paymentProvider } = await import('../src/payments');
    const { handleWebhook } = await import('../src/modules/billing');
    setPaymentProvider(new MockProvider());
    await member();
    const old = await prisma.subscription.create({
      data: { userId: BigInt(U), tariffId: 'm1', status: 'canceled_at_period_end', autoRenew: false, renewalPrice: 999, priceVariant: 'promo', paidFromFlow: new Date('2026-11-01'), paidThroughFlow: new Date('2026-11-01') },
    });
    await day(30);
    await api('GET', '/api/comeback?start=1', U);
    await api('POST', '/api/consents', U, { kinds: ['offer', 'personal_data'] });
    const pay = await api('POST', '/api/checkout', U, { tariffId: 'm1', idempotencyKey: 'comeback-pay', comeback: true });
    expect(pay.body.amount).toBe(999);
    const data = { order_num: pay.body.paymentId, order_id: `mock-${pay.body.paymentId}`, sum: '999.00', payment_status: 'success', customer_extra: `tg:${U}`, subscription_id: `mock-sub-${U}` };
    await handleWebhook(paymentProvider().parseWebhook({ sign: signMock(data) }, data), JSON.stringify(data));
    const subs = await prisma.subscription.findMany({ where: { userId: BigInt(U) }, orderBy: { createdAt: 'asc' } });
    expect(subs.find((x) => x.id === old.id)!.status).toBe('expired');
    const fresh = subs.find((x) => x.id !== old.id)!;
    expect(fresh).toMatchObject({ renewalPrice: 999, status: 'prestart' });
    expect(fresh.paidFromFlow.toISOString().slice(0, 10)).toBe('2026-12-01');
    expect((await api('GET', '/api/comeback', U)).body.available).toBe(false);
    expect((await api('GET', '/api/membership', U)).body.membership.flow.startsOn).toBe('2026-12-01');
  });
});
