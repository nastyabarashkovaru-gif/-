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
    const msg = calls.find((c) => c.method === 'sendPhoto')!; // приветствие — картинка с подписью
    expect(msg.body.photo).toMatch(/\/img\/bot-welcome-v3\.jpg$/);
    expect(msg.body).toMatchObject({ parse_mode: 'HTML' });
    expect(msg.body.caption).toContain('<b>ОТКРЫВАЙ ВИДЕО</b>');
    expect(msg.body.caption).toContain('https://youtu.be/IqQb4Ld2dlc');
    // как в прежнем боте: «как вступить» — следующее сообщение, вопрос — поддержка, частые вопросы — лендинг
    expect(msg.body.reply_markup.inline_keyboard.map((r: { text: string }[]) => r[0])).toEqual([
      { text: 'Ознакомился, как вступить? 🔥', callback_data: 'how_to_join' },
      { text: 'Задать вопрос ❓', url: 'https://t.me/barashkova_a' },
    ]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 100n } })).allowsWrite).toBe(true);
    // через секунду — правила клуба файлом
    await new Promise((r) => setTimeout(r, 1300));
    const doc = calls.find((c) => c.method === 'sendDocument')!;
    expect(doc.body.document).toMatchObject({ filename: 'Правила клуба 90 дней.pdf', contentType: 'application/pdf' });

    // «Ознакомился, как вступить?» → условия с картинкой и кнопкой оплаты (открывает тарифы)
    calls.length = 0;
    const cb = { callback_query: { id: 'q1', from: { id: 100 }, data: 'how_to_join', message: { chat: { id: 100 } } } };
    expect((await app.inject({ method: 'POST', url: '/api/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': webhookSecret }, payload: cb })).statusCode).toBe(200);
    expect(calls.find((c) => c.method === 'answerCallbackQuery')).toBeTruthy();
    const how = calls.find((c) => c.method === 'sendPhoto')!;
    expect(how.body.photo).toMatch(/\/img\/bot-rules\.jpg$/);
    expect(how.body.caption).toContain('Чтобы вступить в сообщество');
    const kb = how.body.reply_markup.inline_keyboard.map((r: { text: string }[]) => r[0]);
    expect(kb[0].text).toBe('ХОЧУ ОПЛАТИТЬ ВХОД! 🔥😍');
    expect(kb[0].web_app.url).toMatch(/_tariffs$/);
    expect(kb).toHaveLength(2);
    expect(kb[1]).toEqual({ text: 'Поддержка', url: 'https://t.me/barashkova_a' });
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
  it('информационный канал: всем оплатившим, неоплатившим — отказ; заявки проверяет бот', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await paidUser(11, NOV);
    await prisma.user.create({ data: { id: 12n, firstName: 'Гостья', allowsWrite: true } });
    const ch = await prisma.telegramChat.create({ data: { kind: 'channel', telegramChatId: -1007n, title: 'Канал 30 дней' } });
    expect((await api('GET', '/api/club', 11)).body).toMatchObject({ channel: { id: ch.id }, channelExists: true });
    expect((await api('GET', '/api/club', 12)).body).toMatchObject({ channel: null, channelExists: true });
    expect((await api('POST', `/api/chats/${ch.id}/invite`, 11)).status).toBe(200);
    expect((await api('POST', `/api/chats/${ch.id}/invite`, 12)).status).toBe(403);
    const app = await getApp();
    const join = (user: number) => app.inject({ method: 'POST', url: '/api/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': webhookSecret }, payload: { chat_join_request: { chat: { id: -1007 }, from: { id: user } } } });
    calls = [];
    await join(11);
    await join(12);
    expect(calls.filter((c) => c.method === 'approveChatJoinRequest').map((c) => c.body.user_id)).toEqual([11]);
    expect(calls.filter((c) => c.method === 'declineChatJoinRequest').map((c) => c.body.user_id)).toEqual([12]);
  });

  it('чат потока — только его участникам; тематические — только по категориям целей; вступление через проверку заявки', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await paidUser(1, NOV);
    await paidUser(2, '2026-12-01');
    const nov = await prisma.flow.findFirstOrThrow({ where: { startsOn: new Date(`${NOV}T00:00:00Z`) } });
    const flowChat = await prisma.telegramChat.create({ data: { kind: 'flow', flowId: nov.id, telegramChatId: -1001n, title: 'Ноябрь' } });
    const topic = await prisma.telegramChat.create({ data: { kind: 'topic', topic: 'money', telegramChatId: -1002n, title: 'Деньги' } });

    expect((await api('POST', `/api/chats/${flowChat.id}/invite`, 1)).status).toBe(200);
    // к декабрю чат ещё не привязан — общий чат открыт сразу после оплаты (последний привязанный)
    expect((await api('POST', `/api/chats/${flowChat.id}/invite`, 2)).status).toBe(200);
    // свой чат привязан — чужой потока больше недоступен
    const dec = await prisma.flow.findFirstOrThrow({ where: { startsOn: new Date('2026-12-01T00:00:00Z') } });
    await prisma.telegramChat.create({ data: { kind: 'flow', flowId: dec.id, telegramChatId: -1009n, title: 'Декабрь' } });
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
    // бывшие в очереди автоподбора, вместе их не ставим; 4 выбирает автоподбор — получает пару сразу
    expect((await prisma.flowMembership.findFirstOrThrow({ where: { userId: 1n } })).buddyMode).toBe('auto');
    expect((await api('POST', '/api/buddy/mode', 4, { mode: 'auto' })).body.state).toBe('paired');
    expect(await prisma.buddyAssignment.count({ where: { userId: { in: [1n, 3n, 4n] } } })).toBe(2);
    // по отсутствию связи — не раньше 5 дней
    expect((await api('POST', '/api/buddy/replace', 2, { reason: 'no_contact_5d' })).status).toBe(403);
  });
});

describe('лента, участники, рейтинг', () => {
  it('отчёт виден в ленте, реакции и комментарии работают; анкеты всех участников видны всем', async () => {
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
    expect(all.body.items.map((x: { id: string }) => x.id)).toEqual(['10', '11']);
    expect((await api('GET', '/api/participants/11', 10)).body.hidden).toBeUndefined();
    const byFlow = await api('GET', `/api/participants?flowStart=${NOV}&city=москва`, 11);
    expect(byFlow.body.items.map((x: { id: string }) => x.id)).toEqual(['10']);
    expect((await api('GET', '/api/participants?flowStart=2026-12-01', 11)).body.items).toHaveLength(0);

    // недельный рейтинг: в топе — после 7 дней участия, свой результат виден сразу
    const lb = await api('GET', '/api/leaderboard', 10);
    expect(lb.body.rows).toHaveLength(0);
    expect(lb.body.me).toMatchObject({ eligible: false, daysLeft: 7, done: 1 });
    clock.set('2026-11-08T09:00:00Z');
    const lb2 = await api('GET', '/api/leaderboard', 10);
    expect(lb2.body.week).toMatchObject({ from: '2026-11-02', to: '2026-11-08' });
    expect(lb2.body.rows).toHaveLength(2);
    expect(lb2.body.rows.find((r: { userId: string }) => r.userId === '11').name).not.toBe('Участник');
    expect(lb2.body.me.eligible).toBe(true);
    // история: прошлая неделя доступна
    expect((await api('GET', '/api/leaderboard?week=2026-10-26', 10)).body.week).toMatchObject({ from: '2026-10-26', to: '2026-11-01' });
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

describe('действия «X раз в неделю»', () => {
  it('можно любое число от 1 до 7, больше 7 — нельзя', async () => {
    clock.set('2026-10-25T09:00:00Z');
    await paidUser(880);
    const g = await api('POST', '/api/goals', 880, { category: 'habits', title: 'Спорт', pointA: 'старт', pointB: 'финиш', confirmMethod: 'daily_reports', successCriterion: 'Регулярно' });
    for (const n of [1, 2, 4, 5, 6, 7]) {
      const t = await api('POST', `/api/goals/${g.body.id}/tasks`, 880, { title: `Тренировка ${n}`, frequency: 'n_per_week', n });
      expect(t.status, String(n)).toBe(200);
      await api('DELETE', `/api/tasks/${t.body.id}`, 880);
    }
    expect((await api('POST', `/api/goals/${g.body.id}/tasks`, 880, { title: 'Тренировка 8', frequency: 'n_per_week', n: 8 })).status).toBe(400);
  });
});

describe('«X раз в неделю» во время потока', () => {
  it('после отправки анкеты: прошлые недели не меняются, с текущей — новая норма, сделанное сохраняется', async () => {
    clock.set('2026-10-25T09:00:00Z');
    await paidUser(890);
    const g = await api('POST', '/api/goals', 890, { category: 'habits', title: 'Спорт', pointA: 'старт', pointB: 'финиш', confirmMethod: 'daily_reports', successCriterion: 'Регулярно' });
    const t = await api('POST', `/api/goals/${g.body.id}/tasks`, 890, { title: 'Тренировка', frequency: 'n_per_week', n: 3 });
    expect((await api('POST', '/api/membership/fix', 890)).status).toBe(200);
    // обычное редактирование закрыто
    expect((await api('PATCH', `/api/tasks/${t.body.id}`, 890, { n: 4 })).status).toBe(403);
    clock.set('2026-11-11T09:00:00Z'); // среда третьей недели (9–15 ноября)
    const count = (from: string) => prisma.taskOccurrence.count({ where: { taskId: t.body.id, windowStart: new Date(`${from}T00:00:00Z`) } });
    expect(await count('2026-11-02')).toBe(3);
    const r = await api('POST', `/api/tasks/${t.body.id}/per-week`, 890, { n: 5 });
    expect(r.status).toBe(200);
    expect(await count('2026-11-02')).toBe(3); // прошлая неделя — как была
    expect(await count('2026-11-09')).toBe(5);
    expect(await count('2026-11-16')).toBe(5);
    // уменьшение: отмеченное не удаляется
    const one = await prisma.taskOccurrence.findFirstOrThrow({ where: { taskId: t.body.id, windowStart: new Date('2026-11-09T00:00:00Z') } });
    await prisma.taskOccurrence.update({ where: { id: one.id }, data: { status: 'done' } });
    expect((await api('POST', `/api/tasks/${t.body.id}/per-week`, 890, { n: 1 })).status).toBe(200);
    expect(await count('2026-11-09')).toBe(1);
    expect(await prisma.taskOccurrence.findUnique({ where: { id: one.id } })).not.toBeNull();
    expect((await api('POST', `/api/tasks/${t.body.id}/per-week`, 890, { n: 8 })).status).toBe(400);
  });
});

describe('отмена подписки по ссылке t.me/<бот>?start=cancel', () => {
  it('бот показывает подписку и кнопку; по нажатию автопродление отключается', async () => {
    clock.set('2026-10-25T09:00:00Z');
    await paidUser(895);
    await prisma.subscription.updateMany({ where: { userId: 895n }, data: { autoRenew: true, nextChargeDate: new Date('2026-11-28T00:00:00Z') } });
    const app = await getApp();
    const hook = (payload: object) => app.inject({ method: 'POST', url: '/api/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': webhookSecret }, payload });
    await hook({ message: { message_id: 1, chat: { id: 895, type: 'private' }, from: { id: 895, first_name: 'Оля' }, text: '/start cancel' } });
    const m = calls.find((c) => c.method === 'sendMessage')!;
    expect(m.body.text).toContain('Отмена автопродления');
    expect(calls.some((c) => c.method === 'sendPhoto')).toBe(false); // приветствие не шлём
    expect(m.body.reply_markup.inline_keyboard[0][0]).toEqual({ text: 'Отменить автопродление', callback_data: 'cancel_sub' });
    await hook({ callback_query: { id: 'c1', from: { id: 895 }, data: 'cancel_sub', message: { chat: { id: 895 } } } });
    expect(await prisma.subscription.findFirstOrThrow({ where: { userId: 895n } })).toMatchObject({ autoRenew: false, status: 'canceled_at_period_end' });
  });
});

describe('бадди: автоподбор по очереди и самостоятельный выбор (ТЗ 02.11)', () => {
  it('первая ждёт, вторая с автоподбором — сразу пара; цели не важны; свободные и фильтры', async () => {
    clock.set('2026-11-02T09:00:00Z');
    await paidUser(901, NOV, 'm1', ['money']);
    await paidUser(902, NOV, 'm1', ['english']);
    await paidUser(903, NOV, 'm1', ['money']);
    // самостоятельный выбор: свободные — все, кроме себя
    expect((await api('POST', '/api/buddy/mode', 903, { mode: 'self' })).body).toMatchObject({ state: 'waiting', mode: 'self' });
    await prisma.user.update({ where: { id: 903n }, data: { username: 'katya_fit' } });
    const free = await api('GET', '/api/buddy/free', 902);
    expect(free.body.items.map((x: { id: string }) => x.id).sort()).toEqual(['901', '903']);
    expect((await api('GET', '/api/buddy/free?q=@katya', 902)).body.items.map((x: { id: string }) => x.id)).toEqual(['903']);
    // автоподбор: Маша ждёт, Катя (другая цель) приходит — пара
    expect((await api('POST', '/api/buddy/mode', 901, { mode: 'auto' })).body).toMatchObject({ state: 'waiting', mode: 'auto' });
    calls = [];
    expect((await api('POST', '/api/buddy/mode', 902, { mode: 'auto' })).body.state).toBe('paired');
    const note = calls.find((c) => c.method === 'sendMessage' && String(c.body.text).includes('Ура! Мы нашли тебе бадди'));
    expect(note).toBeTruthy();
    // уже в паре — снова выбрать нельзя; пара исчезает из свободных
    expect((await api('POST', '/api/buddy/mode', 901, { mode: 'self' })).status).toBe(409);
    expect((await api('GET', '/api/buddy/free', 903)).body.items).toEqual([]);
    // фильтр участников: без пары / с бадди
    await prisma.user.updateMany({ where: { id: { in: [901n, 902n, 903n] } }, data: { visibility: 'public' } });
    await prisma.flowMembership.updateMany({ where: { userId: { in: [901n, 902n, 903n] } }, data: { status: 'active' } });
    const ids = async (f: string) => (await api('GET', `/api/participants?buddy=${f}`, 903)).body.items.map((x: { id: string }) => x.id).sort();
    expect(await ids('paired')).toEqual(['901', '902']);
    expect(await ids('free')).toEqual(['903']);
  });
});

describe('профиль участницы', () => {
  it('при оплате нескольких месяцев показывает текущий челлендж: цели, действия, старт и день', async () => {
    clock.set('2026-10-25T09:00:00Z');
    await paidUser(920);
    await grantMembership(920, '2026-12-01');
    await grantMembership(920, '2027-01-01');
    await fixDaily(920);
    await prisma.user.update({ where: { id: 920n }, data: { visibility: 'public' } });
    clock.set('2026-11-02T09:00:00Z');
    await paidUser(921);
    const p = await api('GET', '/api/participants/920', 921);
    expect(p.body.challenge).toMatchObject({ startsOn: '2026-11-01', day: 2, length: 30 });
    expect(p.body.goals[0]).toMatchObject({ title: 'Привычка', tasks: [{ title: 'Сделать', schedule: 'Ежедневно' }] });
  });
});

describe('личные даты старта (ТЗ 02.11)', () => {
  it('дата в прошлом нельзя; ожидание до старта; в дату старта — активна и бот поздравляет; ровно 30 дней', async () => {
    clock.set('2026-11-05T09:00:00Z');
    await paidUser(940, '2026-12-01');
    expect((await api('POST', '/api/membership/start', 940, { date: '2026-11-04' })).status).toBe(400);
    expect((await api('POST', '/api/membership/start', 940, { date: '2026-11-10' })).body).toEqual({ startsOn: '2026-11-10', endsOn: '2026-12-09' });
    await fixDaily(940);
    const h0 = await api('GET', '/api/home', 940);
    expect(h0.body.state).toBe('waiting');
    expect(h0.body.flow).toMatchObject({ startsOn: '2026-11-10', endsOn: '2026-12-09', days: 30, day: 0 });
    // дата старта: активна, бот поздравляет
    clock.set('2026-11-10T08:00:00Z');
    calls = [];
    await refreshFlowStatuses();
    expect((await prisma.flowMembership.findFirstOrThrow({ where: { userId: 940n } })).status).toBe('active');
    expect(calls.some((c) => String(c.body.text ?? c.body.caption).includes('Твой челлендж начался'))).toBe(true);
    const h1 = await api('GET', '/api/home', 940);
    expect(h1.body).toMatchObject({ state: 'active', flow: { day: 1 }, stats: { dayNumber: 1 } });
    // 30-й день — 9 декабря, 10-го — завершён
    clock.set('2026-12-09T08:00:00Z');
    expect((await api('GET', '/api/home', 940)).body.flow.day).toBe(30);
    clock.set('2026-12-10T08:00:00Z');
    await refreshFlowStatuses();
    expect((await prisma.flowMembership.findFirstOrThrow({ where: { userId: 940n } })).status).toBe('finished');
  });
});

describe('смена даты старта в любой момент (05.11)', () => {
  it('до старта — перенос; посреди челленджа — заново с новой даты; анкету можно заполнить заново', async () => {
    clock.set('2026-11-03T09:00:00Z');
    await paidUser(950, '2026-12-01');
    expect((await api('GET', '/api/me', 950)).body.membership.canChangeStart).toBe(false); // анкета ещё не отправлена
    await fixDaily(950);
    expect((await api('GET', '/api/me', 950)).body.membership.canChangeStart).toBe(true);
    expect((await api('POST', '/api/membership/change-start', 950, { date: '2026-11-02' })).status).toBe(400);
    calls = [];
    expect((await api('POST', '/api/membership/change-start', 950, { date: '2026-11-03' })).body).toEqual({ startsOn: '2026-11-03', endsOn: '2026-12-02' });
    const m = await prisma.flowMembership.findFirstOrThrow({ where: { userId: 950n } });
    expect(m.status).toBe('active');
    expect(await prisma.taskOccurrence.count({ where: { membershipId: m.id } })).toBe(30);
    expect(calls.some((c) => String(c.body.text ?? c.body.caption).includes('Твой челлендж начался'))).toBe(true);
    // идёт 5-й день, много пропустила — начинает заново с 10-го
    clock.set('2026-11-07T09:00:00Z');
    expect((await api('GET', '/api/home', 950)).body.flow.day).toBe(5);
    expect((await api('POST', '/api/membership/change-start', 950, { date: '2026-11-10' })).body).toEqual({ startsOn: '2026-11-10', endsOn: '2026-12-09' });
    expect((await api('GET', '/api/home', 950)).body).toMatchObject({ state: 'waiting', flow: { startsOn: '2026-11-10' } });
    const occ = await prisma.taskOccurrence.findFirstOrThrow({ where: { membershipId: m.id }, orderBy: { windowStart: 'asc' } });
    expect(occ.windowStart.toISOString().slice(0, 10)).toBe('2026-11-10');
    // заполнить анкету заново: цели снова можно менять, дата — в конце анкеты
    expect((await api('POST', '/api/membership/refill', 950)).body).toEqual({ ok: true });
    const mm = (await api('GET', '/api/membership', 950)).body.membership;
    expect(mm).toMatchObject({ status: 'reserved', canEdit: true });
    expect(mm.goals).toHaveLength(1);
    expect((await api('GET', '/api/home', 950)).body.state).toBe('registration');
    await api('POST', '/api/membership/start', 950, { date: '2026-11-08' });
    expect((await api('POST', '/api/membership/fix', 950)).status).toBe(200);
    expect((await prisma.flowMembership.findFirstOrThrow({ where: { userId: 950n } })).startsOn!.toISOString().slice(0, 10)).toBe('2026-11-08');
  });
});

describe('местное время участницы (05.11)', () => {
  it('Киев: в 23:09 по Киеву (00:09 по Москве) идёт ещё прежний день — отчёт за него принимается', async () => {
    clock.set('2026-11-03T09:00:00Z');
    await paidUser(990, '2026-12-01');
    await api('POST', '/api/membership/start', 990, { date: '2026-11-03' });
    const { taskId } = await fixDaily(990);
    expect((await api('PATCH', '/api/me', 990, { timezone: 'Europe/Kyiv' })).status).toBe(200);
    // 4 ноября, 23:09 по Киеву = 00:09 5 ноября по Москве
    clock.set('2026-11-04T21:09:00Z');
    const h = (await api('GET', '/api/home', 990)).body;
    expect(h.flow).toMatchObject({ today: '2026-11-04', day: 2 });
    const media = await upload(990);
    const r = await api('POST', '/api/reports', 990, { items: [{ taskId, done: true }], mediaIds: [media.body.id], publicAck: true });
    expect(r.status).toBe(200);
    const rep = await prisma.dailyReport.findFirstOrThrow({ where: { membership: { userId: 990n } } });
    expect(rep.date.toISOString().slice(0, 10)).toBe('2026-11-04');
    // у участницы из Москвы в это же время уже 5 ноября
    await paidUser(991, '2026-12-01');
    await api('POST', '/api/membership/start', 991, { date: '2026-11-05' });
    await fixDaily(991);
    expect((await api('GET', '/api/home', 991)).body.flow).toMatchObject({ today: '2026-11-05', day: 1 });
  });
});
