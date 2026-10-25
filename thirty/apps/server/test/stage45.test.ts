import { beforeEach, describe, expect, it } from 'vitest';
import { api, clock, getApp, grantMembership, prisma, resetDb, upload } from './helpers';
import { setTelegramTransport, webhookSecret } from '../src/lib/telegram';
import { seedTemplates, sendTemplate } from '../src/modules/bot';
import { autoMatch } from '../src/modules/buddy';
import { refreshFlowStatuses } from '../src/modules/flows';
import { runFlowChains } from '../src/jobs/chains';
import { removeExpiredMembers } from '../src/modules/chats';
import { setPaymentProvider } from '../src/payments';
import { MockProvider } from '../src/payments/mock';
import { computeLeaderboard } from '../src/modules/rating';

const NOV = '2026-11-01';
let calls: { method: string; body: Record<string, any> }[] = [];

beforeEach(async () => {
  await resetDb();
  await seedTemplates();
  setPaymentProvider(new MockProvider());
  calls = [];
  setTelegramTransport(async (method, body) => {
    calls.push({ method, body });
    if (method === 'createChatInviteLink') return { invite_link: `https://t.me/+inv${calls.length}` } as never;
    if (method === 'getMe') return { id: 999, username: 'thirty_test_bot' } as never;
    if (method === 'getChatMember') return { status: 'administrator', can_invite_users: true, can_restrict_members: true } as never;
    if (method === 'sendMessage' && body.chat_id === 666) throw Object.assign(new Error('blocked'), { code: 403, description: 'Forbidden: bot was blocked by the user' });
    return { message_id: 1 } as never;
  });
});

async function paidUser(id: number, flow = NOV, tariff = 'm1', interests: string[] = []) {
  const m = await grantMembership(id, flow, tariff, { interests });
  await prisma.user.update({ where: { id: BigInt(id) }, data: { allowsWrite: true } });
  const sub = await prisma.subscription.create({ data: { userId: BigInt(id), tariffId: tariff, status: 'prestart', renewalPrice: 999, paidFromFlow: new Date(`${flow}T00:00:00Z`), paidThroughFlow: new Date(`${flow}T00:00:00Z`) } });
  await prisma.flowMembership.update({ where: { id: m.id }, data: { subscriptionId: sub.id } });
  return m;
}

async function fixDaily(id: number) {
  const g = await api('POST', '/api/goals', id, { category: 'habits', title: 'Привычка', pointA: 'старт', pointB: 'финиш', confirmMethod: 'daily_reports', successCriterion: 'Каждый день' });
  const t = await api('POST', `/api/goals/${g.body.id}/tasks`, id, { title: 'Сделать', frequency: 'daily' });
  await api('POST', '/api/membership/fix', id);
  return { goalId: g.body.id as string, taskId: t.body.id as string };
}

describe('бот', () => {
  it('/start отвечает кнопкой web_app и разрешает писать; webhook проверяет секрет', async () => {
    const app = await getApp();
    const upd = { message: { message_id: 1, chat: { id: 100, type: 'private' }, from: { id: 100, first_name: 'Аня' }, text: '/start ref_abc' } };
    expect((await app.inject({ method: 'POST', url: '/api/telegram/webhook', payload: upd })).statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': webhookSecret }, payload: upd });
    expect(ok.statusCode).toBe(200);
    const msg = calls.find((c) => c.method === 'sendMessage')!;
    expect(msg.body.reply_markup.inline_keyboard[0][0].web_app.url).toContain('startapp=ref_abc');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 100n } })).allowsWrite).toBe(true);
  });

  it('/bind в группе регистрирует группу для привязки в админке', async () => {
    const app = await getApp();
    const upd = { message: { message_id: 5, chat: { id: -100777, type: 'supergroup', title: '30 дней — Ноябрь' }, from: { id: 1, first_name: 'A' }, text: '/bind@Dney30_bot' } };
    await app.inject({ method: 'POST', url: '/api/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': webhookSecret }, payload: upd });
    const chat = await prisma.telegramChat.findUniqueOrThrow({ where: { telegramChatId: -100777n } });
    expect(chat).toMatchObject({ kind: 'pending', title: '30 дней — Ноябрь', active: false });
    expect(calls.find((c) => c.method === 'sendMessage')!.body.text).toContain('Группа найдена');
  });

  it('рекламные шаблоны: выключены до утверждения, требуют согласия, лимиты и журнал', async () => {
    await prisma.user.create({ data: { id: 200n, firstName: 'A', allowsWrite: true } });
    expect(await sendTemplate(200n, 'nudge_tariffs_no_select', {}, 'k1')).toBe('skipped'); // выключен
    await prisma.botMessageTemplate.update({ where: { key: 'nudge_tariffs_no_select' }, data: { enabled: true } });
    expect(await sendTemplate(200n, 'nudge_tariffs_no_select', {}, 'k2')).toBe('skipped'); // нет opt-in
    await prisma.user.update({ where: { id: 200n }, data: { marketingOptIn: true } });
    expect(await sendTemplate(200n, 'nudge_tariffs_no_select', {}, 'k3')).toBe('sent');
    expect(await sendTemplate(200n, 'nudge_tariffs_no_select', {}, 'k3')).toBe('skipped'); // дедупликация
    expect(await sendTemplate(200n, 'nudge_tariffs_no_select', {}, 'k4')).toBe('skipped'); // лимит частоты
    const sent = calls.filter((c) => c.method === 'sendMessage');
    expect(sent).toHaveLength(1);
    expect(sent[0].body.text).not.toContain('/stop');
    const log = await prisma.botMessageLog.findFirstOrThrow({ where: { status: 'sent' } });
    // клик по кнопке → bot_message_click
    const short = log.id.replace(/-/g, '');
    const a = await getApp();
    const { auth } = await import('./helpers');
    await a.inject({ method: 'GET', url: '/api/me', headers: { ...auth(200), 'x-start-param': `m_${short}_tariffs` } });
    expect((await prisma.botMessageLog.findUniqueOrThrow({ where: { id: log.id } })).clickedAt).not.toBeNull();
    expect(await prisma.analyticsEvent.count({ where: { eventName: 'bot_message_click' } })).toBe(1);
  });

  it('403 от Telegram помечает пользователя и пишет bot_message_failed', async () => {
    await prisma.user.create({ data: { id: 666n, firstName: 'B', allowsWrite: true } });
    expect(await sendTemplate(666n, 'buddy_matched', {}, 'x')).toBe('failed');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 666n } })).botBlocked).toBe(true);
    expect(await prisma.analyticsEvent.count({ where: { eventName: 'bot_message_failed' } })).toBe(1);
  });

});

describe('чаты (критерий №7)', () => {
  it('чат потока — только его участникам; тематические — только по категориям целей; вступление через проверку заявки', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await paidUser(1, NOV);
    await paidUser(2, '2026-12-01');
    const nov = await prisma.flow.findFirstOrThrow({ where: { startsOn: new Date(`${NOV}T00:00:00Z`) } });
    const flowChat = await prisma.telegramChat.create({ data: { kind: 'flow', flowId: nov.id, telegramChatId: -1001n, title: 'Ноябрь' } });
    const topic = await prisma.telegramChat.create({ data: { kind: 'topic', topic: 'money', telegramChatId: -1002n, title: 'Деньги' } });

    expect((await api('POST', `/api/chats/${flowChat.id}/invite`, 1)).status).toBe(200);
    expect((await api('POST', `/api/chats/${flowChat.id}/invite`, 2)).status).toBe(403);
    // тематический чат «Деньги» — только если среди целей есть «Деньги»
    const english = await prisma.telegramChat.create({ data: { kind: 'topic', topic: 'english', telegramChatId: -1003n, title: 'Английский' } });
    expect((await api('POST', `/api/chats/${topic.id}/invite`, 2)).status).toBe(403);
    await api('POST', '/api/goals', 2, { category: 'money', title: 'Накопить 50 000', pointA: '0', pointB: '50 000', confirmMethod: 'screenshot' });
    expect((await api('POST', `/api/chats/${topic.id}/invite`, 2)).status).toBe(200);
    expect((await api('POST', `/api/chats/${english.id}/invite`, 2)).status).toBe(403);
    const club = await api('GET', '/api/club', 2);
    expect(club.body.topicChats.filter((t: { available: boolean }) => t.available).map((t: { topic: string }) => t.topic)).toEqual(['money']);
    const link = calls.find((c) => c.method === 'createChatInviteLink')!;
    expect(link.body).toMatchObject({ chat_id: -1001, creates_join_request: true });

    const app = await getApp();
    const join = (chat: number, user: number) =>
      app.inject({ method: 'POST', url: '/api/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': webhookSecret }, payload: { chat_join_request: { chat: { id: chat }, from: { id: user } } } });
    await join(-1001, 1);
    await join(-1001, 2); // переслали ссылку участнику другого потока
    expect(calls.filter((c) => c.method === 'approveChatJoinRequest').map((c) => c.body.user_id)).toEqual([1]);
    expect(calls.filter((c) => c.method === 'declineChatJoinRequest').map((c) => c.body.user_id)).toEqual([2]);

    // окончание прав → удаление из группы (ban + unban)
    await prisma.subscription.updateMany({ where: { userId: 1n }, data: { status: 'expired' } });
    await prisma.flowMembership.updateMany({ where: { userId: 1n }, data: { status: 'revoked' } });
    expect((await removeExpiredMembers()).removed).toBe(1);
    expect(calls.filter((c) => c.method === 'banChatMember')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'unbanChatMember')).toHaveLength(1);
  });
});

describe('бадди (критерий №8)', () => {
  it('пара по приглашению не перераспределяется, автоподбор идемпотентен, одному — один бадди', async () => {
    clock.set('2026-10-21T09:00:00Z');
    for (const [id, interests] of [[1, ['money']], [2, ['money']], [3, ['english']], [4, ['english']], [5, ['money']]] as const) await paidUser(id, NOV, 'm1', [...interests]);
    const inv = await api('POST', '/api/buddy/invite', 1);
    expect(inv.body.startParam).toMatch(/^bd_/);
    expect((await api('POST', '/api/buddy/accept', 3, { token: inv.body.token })).status).toBe(200);
    expect((await api('POST', '/api/buddy/accept', 4, { token: inv.body.token })).status).toBe(404);

    const flow = await prisma.flow.findFirstOrThrow();
    const r1 = await autoMatch(flow.id);
    expect(r1).toEqual({ created: 1, waiting: 1 });
    expect(await autoMatch(flow.id)).toEqual({ created: 0, waiting: 1 });
    const pairs = await prisma.buddyPair.findMany({ where: { status: 'active' } });
    expect(pairs).toHaveLength(2);
    expect(pairs.find((p) => p.source === 'invite')).toMatchObject({ userA: 1n, userB: 3n });
    expect(pairs.find((p) => p.source === 'auto')).toMatchObject({ matchReason: 'interests' });
    const card = await api('GET', '/api/buddy', 1);
    expect(card.body).toMatchObject({ state: 'paired', buddy: { id: '3' } });
    expect((await api('GET', '/api/buddy', 4)).body.state).toBe('waiting');

    // замена: по согласию нужны оба, затем пул и переподбор с ожидающим
    expect((await api('POST', '/api/buddy/replace', 1, { reason: 'mutual' })).body.state).toBe('waiting_partner');
    const res = await api('POST', '/api/buddy/replace', 3, { reason: 'mutual' });
    expect(['rematched', 'waiting_pool']).toContain(res.body.state);
    expect(await prisma.buddyAssignment.count({ where: { userId: { in: [1n, 3n, 4n] } } })).toBe(2);
    // по отсутствию связи — не раньше 5 дней
    expect((await api('POST', '/api/buddy/replace', 2, { reason: 'no_contact_5d' })).status).toBe(403);
  });
});

describe('лента, участники, рейтинг', () => {
  it('отчёт виден в ленте, реакции и комментарии работают, скрытые участники не ищутся', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await paidUser(10, NOV);
    await paidUser(11, NOV);
    await prisma.user.update({ where: { id: 11n }, data: { visibility: 'hidden', city: 'Казань' } });
    await prisma.user.update({ where: { id: 10n }, data: { city: 'Москва' } });
    const { taskId } = await fixDaily(10);
    await fixDaily(11);
    clock.set('2026-11-01T09:00:00Z');
    await refreshFlowStatuses();
    await api('POST', '/api/reports', 10, { items: [{ taskId, done: true }], mediaIds: [(await upload(10)).body.id], publicAck: true, text: 'День 1!' });
    const f = await api('GET', '/api/feed', 11);
    expect(f.body.items).toHaveLength(1);
    expect(f.body.items[0]).toMatchObject({ text: 'День 1!', user: { id: '10' } });
    const rid = f.body.items[0].id;
    expect((await api('POST', `/api/reports/${rid}/react`, 11, { emoji: '🔥' })).body.active).toBe(true);
    expect((await api('POST', `/api/reports/${rid}/comments`, 11, { text: 'Так держать' })).status).toBe(200);
    const d = await api('GET', `/api/reports/${rid}`, 10);
    expect(d.body.report.reactions).toEqual([{ emoji: '🔥', count: 1 }]);
    expect(d.body.comments).toHaveLength(1);

    const all = await api('GET', '/api/participants', 10);
    expect(all.body.items.map((x: { id: string }) => x.id)).toEqual(['10']);
    const byFlow = await api('GET', `/api/participants?flowStart=${NOV}&city=москва`, 11);
    expect(byFlow.body.items.map((x: { id: string }) => x.id)).toEqual(['10']);
    expect((await api('GET', '/api/participants?flowStart=2026-12-01', 11)).body.items).toHaveLength(0);

    const lb = await api('GET', '/api/leaderboard', 10);
    expect(lb.body.rows).toHaveLength(2);
    expect(lb.body.rows.find((r: { userId: string }) => r.userId === '11').name).toBe('Участник');
    expect(lb.body.rules).toContain('тай-брейк');
  });
});

describe('общий чат отчётов', () => {
  it('сообщения и ответы видны только участникам потока; скрытое модератором не показывается', async () => {
    clock.set('2026-10-21T10:00:00Z');
    await grantMembership(50, '2026-11-01', 'm1');
    await grantMembership(51, '2026-11-01', 'm1');
    await prisma.user.create({ data: { id: 52n, firstName: 'Чужой' } });
    const { taskId } = await fixDaily(50);
    await fixDaily(51);
    clock.set('2026-11-01T09:00:00Z');
    await refreshFlowStatuses();
    await api('POST', '/api/reports', 50, { items: [{ taskId, done: true }], mediaIds: [(await upload(50)).body.id], publicAck: true, text: 'Сделала!' });
    const first = (await api('GET', '/api/feed/chat', 51)).body.messages[0];
    expect(first).toMatchObject({ text: 'Сделала!', mine: false, user: { id: '50' } });
    clock.set('2026-11-01T09:05:00Z');
    const reply = await api('POST', '/api/feed/chat', 51, { text: 'Умница!', replyToId: first.id });
    expect(reply.body).toMatchObject({ text: 'Умница!', replyTo: { id: first.id, text: 'Сделала!' } });
    const newer = await api('GET', `/api/feed/chat?after=${first.id}`, 50);
    expect(newer.body.messages.map((m: { text: string }) => m.text)).toEqual(['Умница!']);
    expect((await api('GET', '/api/feed/chat', 52)).status).toBe(403);
    expect((await api('POST', '/api/feed/chat', 52, { text: 'спам' })).status).toBe(403);
    await prisma.feedMessage.update({ where: { id: reply.body.id }, data: { hidden: true } });
    const after = (await api('GET', '/api/feed/chat', 50)).body.messages;
    expect(after[1]).toMatchObject({ hidden: true, text: null });
  });
});

describe('уведомления и текущий результат', () => {
  it('отчёт бадди и ответ в чате создают уведомления; прочтение гасит точку; «текущий результат» считает прогресс', async () => {
    clock.set('2026-10-21T10:00:00Z');
    await grantMembership(60, '2026-11-01', 'm1');
    await grantMembership(61, '2026-11-01', 'm1');
    const g = await api('POST', '/api/goals', 60, { category: 'weightloss', title: 'Минус 3 кг', pointA: '60 кг', pointB: '57 кг', confirmMethod: 'photo_video' });
    const t = await api('POST', `/api/goals/${g.body.id}/tasks`, 60, { title: 'Шаги', frequency: 'daily' });
    await api('POST', '/api/membership/fix', 60);
    await fixDaily(61);
    const flow = await prisma.flow.findFirstOrThrow({ where: { startsOn: new Date('2026-11-01T00:00:00Z') } });
    const pair = await prisma.buddyPair.create({ data: { flowId: flow.id, userA: 60n, userB: 61n, source: 'admin' } });
    await prisma.buddyAssignment.createMany({ data: [{ flowId: flow.id, userId: 60n, pairId: pair.id }, { flowId: flow.id, userId: 61n, pairId: pair.id }] });
    clock.set('2026-11-01T09:00:00Z');
    await refreshFlowStatuses();
    expect((await api('GET', '/api/notifications/unread', 61)).body.unread).toBe(0);
    const rep = await api('POST', '/api/reports', 60, { items: [{ taskId: t.body.id, done: true }], progress: [{ goalId: g.body.id, value: 58.5 }], mediaIds: [(await upload(60)).body.id], publicAck: true });
    expect(rep.status).toBe(200);
    const n61 = await api('GET', '/api/notifications', 61);
    expect(n61.body.unread).toBe(1);
    expect(n61.body.items[0]).toMatchObject({ kind: 'buddy_report', title: 'Твой бадди прислал отчёт!', link: `/feed?msg=${rep.body.messageId}`, read: false });
    const home = await api('GET', '/api/home', 60);
    expect(home.body.goals[0]).toMatchObject({ numeric: true, unit: 'кг', current: 58.5, progress: 50 });

    clock.set('2026-11-01T09:10:00Z');
    const reply = await api('POST', '/api/feed/chat', 61, { text: 'Так держать!', replyToId: rep.body.messageId });
    const n60 = await api('GET', '/api/notifications', 60);
    expect(n60.body.items[0]).toMatchObject({ kind: 'chat_reply', title: 'Тебе ответили в чате', link: `/feed?msg=${reply.body.id}` });
    // на свой собственный ответ уведомление не приходит
    await api('POST', '/api/feed/chat', 60, { text: 'Спасибо!', replyToId: reply.body.id });
    expect((await api('GET', '/api/notifications/unread', 60)).body.unread).toBe(1);
    expect((await api('GET', '/api/notifications/unread', 61)).body.unread).toBe(2);
    const read = await api('POST', `/api/notifications/${n60.body.items[0].id}/read`, 60);
    expect(read.body.unread).toBe(0);
    expect((await api('POST', `/api/notifications/${n60.body.items[0].id}/read`, 61)).status).toBe(404);

    // «Пора сдать отчёт!» — за 3 часа до конца дня тем, кто ещё не сдал (один раз в день)
    clock.set('2026-11-02T19:00:00Z'); // 22:00 МСК
    await runFlowChains(clock.now(), async () => undefined);
    await runFlowChains(clock.now(), async () => undefined);
    const due = await prisma.notification.findMany({ where: { kind: 'report_due' } });
    expect(due.map((d) => d.userId).sort()).toEqual([60n, 61n]);
    expect(due[0]).toMatchObject({ title: 'Пора сдать отчёт!', link: '/?report=1' });
  });
});

describe('финал, отзывы, карточки', () => {
  it('карточки 7/14/21/28 с реальными цифрами и QR; отзыв не влияет на рейтинг (№12, №13)', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await paidUser(20, NOV);
    await prisma.user.update({ where: { id: 20n }, data: { allowsWrite: true } });
    const { taskId, goalId } = await fixDaily(20);
    for (let d = 1; d <= 7; d++) {
      if (d === 3) continue;
      clock.set(`2026-11-0${d}T09:00:00Z`);
      await refreshFlowStatuses();
      await api('POST', '/api/reports', 20, { items: [{ taskId, done: true }], mediaIds: [(await upload(20)).body.id], publicAck: true });
    }
    clock.set('2026-11-06T09:00:00Z');
    expect((await api('POST', '/api/cards/1', 20)).status).toBe(403); // ещё рано
    clock.set('2026-11-07T10:00:00Z'); // 13:00 МСК, 7-й день
    const card = await api('POST', '/api/cards/1', 20);
    expect(card.status).toBe(200);
    expect(card.body.stats).toMatchObject({ week: 1, successfulDays: 6, previous: 0, delta: 6 });
    expect(card.body.link).toMatch(/startapp=ref_/);
    const app = await getApp();
    const png = await app.inject({ method: 'GET', url: card.body.imageUrl.replace('https://thirty.example', '') });
    expect(png.statusCode).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.rawPayload.subarray(1, 4).toString()).toBe('PNG');
    expect((await app.inject({ method: 'GET', url: `/api/cards/img/${card.body.id}.png?s=bad` })).statusCode).toBe(403);

    // цепочка 7-го дня отправляет карточку один раз
    await runFlowChains();
    await runFlowChains();
    expect(calls.filter((c) => c.method === 'sendMessage' && /Неделя 1/.test(c.body.text))).toHaveLength(1);

    const flow = await prisma.flow.findFirstOrThrow({ where: { startsOn: new Date(`${NOV}T00:00:00Z`) } });
    const before = (await computeLeaderboard(flow.id))[0];
    const rv = await api('POST', '/api/reviews', 20, { trigger: 'day14', rating: 9, changes: 'Бросила курить', allowText: true });
    expect(rv.status).toBe(200);
    expect(await prisma.consent.count({ where: { kind: 'case_text', context: rv.body.id } })).toBe(1);
    const after = (await computeLeaderboard(flow.id))[0];
    expect(after.ratio).toBe(before.ratio);
    await api('POST', `/api/reviews/${rv.body.id}/revoke`, 20);
    expect((await prisma.review.findUniqueOrThrow({ where: { id: rv.body.id } })).allowText).toBe(false);

    // итоговая анкета — только с последнего дня, ответ по каждой цели
    expect((await api('POST', '/api/membership/final', 20, { goals: [{ goalId, achieved: true }] })).status).toBe(403);
    clock.set('2026-11-30T12:00:00Z');
    expect((await api('POST', '/api/membership/final', 20, { goals: [{ goalId, achieved: true }] })).status).toBe(200);
    expect((await api('POST', '/api/membership/final', 20, { goals: [{ goalId, achieved: true }] })).status).toBe(403);
  });

  it('созвон: ссылка только оплатившим, клик пишется в посещаемость', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await paidUser(30, NOV);
    await prisma.user.create({ data: { id: 31n, firstName: 'Гость' } });
    const mt = await prisma.meeting.create({ data: { direction: 'money', title: 'Финансовые цели', startsAt: new Date('2026-11-05T16:00:00Z'), joinUrl: 'https://telemost.yandex.ru/j/1' } });
    const club = await api('GET', '/api/club', 30);
    expect(club.body.meetings).toHaveLength(1);
    expect(club.body.topicChats).toHaveLength(5);
    expect((await api('POST', `/api/meetings/${mt.id}/join`, 31)).status).toBe(403);
    const j = await api('POST', `/api/meetings/${mt.id}/join`, 30);
    expect(j.body.url).toBe('https://telemost.yandex.ru/j/1');
    expect(await prisma.attendance.count()).toBe(1);
  });
});
