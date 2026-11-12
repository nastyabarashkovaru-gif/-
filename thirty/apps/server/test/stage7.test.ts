import { beforeEach, describe, expect, it } from 'vitest';
import { api, clock, getApp, grantMembership, prisma, resetDb } from './helpers';
import { setTelegramTransport, webhookSecret } from '../src/lib/telegram';
import { seedTemplates } from '../src/modules/bot';
import { seedPromos } from '../src/modules/promos';
import { runPrePurchaseChains } from '../src/jobs/chains';
import { decideStoryRequest } from '../src/modules/stories';
import { paymentProvider, setPaymentProvider } from '../src/payments';
import { MockProvider, signMock } from '../src/payments/mock';
import { handleWebhook } from '../src/modules/billing';
import { dashboard } from '../src/modules/adminAnalytics';
import { CloudPaymentsProvider } from '../src/payments/cloudpayments';
import { adminBotLinkCode, adminBotSecret, setAdminBotTransport } from '../src/modules/adminBot';
import { config } from '../src/config';

let calls: { method: string; body: Record<string, any> }[] = [];
let adminCalls: { method: string; body: Record<string, any> }[] = [];
const sent = () => calls.filter((c) => c.method === 'sendMessage' || c.method === 'sendPhoto').map((c) => String(c.body.text ?? c.body.caption ?? '').replace(/[\u00a0\u202f]/g, ' ').replace(/<\/?b>/g, ''));

beforeEach(async () => {
  await resetDb();
  await seedTemplates();
  await seedPromos();
  setPaymentProvider(new MockProvider());
  calls = [];
  adminCalls = [];
  config.ADMIN_BOT_TOKEN = '1:ADMIN_TEST';
  setAdminBotTransport(async (method, body) => {
    adminCalls.push({ method, body });
    return { message_id: 1 } as never;
  });
  setTelegramTransport(async (method, body) => {
    calls.push({ method, body });
    return { message_id: 1 } as never;
  });
});

async function start(id: number) {
  const app = await getApp();
  await app.inject({ method: 'POST', url: '/api/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': webhookSecret }, payload: { message: { message_id: 1, chat: { id, type: 'private' }, from: { id, first_name: 'Аня' }, text: '/start' } } });
}

async function buy(userId: number) {
  await api('POST', '/api/consents', userId, { kinds: ['offer', 'personal_data'] });
  const co = await api('POST', '/api/checkout', userId, { tariffId: 'm1', idempotencyKey: `buy-${userId}-${Date.now()}` });
  expect(co.status).toBe(200);
  const data = { order_num: co.body.paymentId, order_id: `pd-${co.body.paymentId}`, sum: `${co.body.amount}.00`, payment_status: 'success', customer_extra: `tg:${userId}`, subscription_id: 'pd-sub' };
  await handleWebhook(paymentProvider().parseWebhook({ sign: signMock(data) }, data), JSON.stringify(data));
  return co.body.amount as number;
}

describe('после оплаты', () => {
  it('сообщение: анкета до старта + личная ссылка в общий чат (чат открыт сразу, даже если привязан к другому потоку)', async () => {
    clock.set('2026-10-21T09:00:00Z');
    const other = await prisma.flow.create({ data: { startsOn: new Date('2026-10-01T00:00:00Z'), endsOn: new Date('2026-10-31T00:00:00Z'), title: 'Октябрь 2026' } });
    await prisma.telegramChat.create({ data: { kind: 'flow', flowId: other.id, telegramChatId: -100777n, title: 'Чат «Ноябрь»' } });
    setTelegramTransport(async (method, body) => {
      calls.push({ method, body });
      return (method === 'createChatInviteLink' ? { invite_link: 'https://t.me/+invite777' } : { message_id: 1 }) as never;
    });
    await prisma.user.create({ data: { id: 950n, firstName: 'Аня', allowsWrite: true } });
    await buy(950);
    const msg = calls.find((c) => c.method === 'sendMessage' && Number(c.body.chat_id) === 950 && String(c.body.text).includes('определена в пару'))!;
    expect(msg).toBeTruthy();
    expect(String(msg.body.text)).toContain('https://t.me/+invite777');
    expect(String(msg.body.text)).toContain('Добро пожаловать');
    const kb = (msg.body.reply_markup as { inline_keyboard: { text: string; url?: string; web_app?: unknown }[][] }).inline_keyboard.flat();
    expect(kb.find((b) => b.text.startsWith('Зайти в чат'))?.url).toBe('https://t.me/+invite777');
    expect(kb.find((b) => b.text.startsWith('Заполнить анкету'))?.web_app).toBeTruthy();
    // в разделе «Сообщество» чат потока открыт
    expect((await api('GET', '/api/club', 950)).body.flowChat).toMatchObject({ title: 'Чат «Ноябрь»' });
  });
});

describe('проверка на себе', () => {
  it('купила → «Начать путь заново» → снова тарифы → дожим приходит', async () => {
    const { startOver } = await import('../src/modules/startOver');
    clock.set('2026-10-21T09:00:00Z');
    await start(960);
    await api('POST', '/api/offer/start', 960);
    await buy(960);
    await startOver(960n);
    calls = [];
    clock.set('2026-10-21T12:00:00Z');
    await api('POST', '/api/offer/start', 960);
    await runPrePurchaseChains(new Date('2026-10-21T12:11:00Z'));
    expect(sent().some((t) => t.includes('получилось посмотреть'))).toBe(true);
  });
});

describe('дожимная цепочка до оплаты', () => {
  it('сообщение 1 — на каждый /start; 2–7 по таймеру из реальных цен; пропущенные не досылаются; после оплаты — тишина', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await start(300);
    await start(300);
    expect(sent()[0]).toContain('на связи Настя');
    expect(sent()[1]).toContain('на связи Настя');
    const app0 = await getApp();
    await app0.inject({ method: 'POST', url: '/api/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': webhookSecret }, payload: { message: { message_id: 3, chat: { id: 300, type: 'private' }, from: { id: 300 }, text: '/start hello' } } });
    expect(sent()[2]).toContain('на связи Настя');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 300n } })).marketingOptIn).toBe(true);
    calls = [];

    await api('POST', '/api/offer/start', 300); // первый показ предложения: таймер на сервере
    const at = (m: number) => new Date(Date.parse('2026-10-21T09:00:00Z') + m * 60_000);
    await runPrePurchaseChains(at(5));
    expect(sent()).toHaveLength(0);
    await runPrePurchaseChains(at(11));
    await runPrePurchaseChains(at(12));
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toContain('получилось посмотреть');
    await runPrePurchaseChains(at(61));
    const photo = calls.find((c) => c.method === 'sendPhoto')!;
    expect(photo.body.photo).toMatch(/\/img\/chain-value\.png$/);
    expect(photo.body.caption).toContain('всего за 999 ₽ в месяц');
    // сервер «лежал» с 61-й по 152-ю минуту: 04 не досылаем, приходит только актуальное 05
    await runPrePurchaseChains(at(152));
    expect(sent().at(-1)).toContain('ЧТО Ж, Я ВИЖУ');
    await runPrePurchaseChains(at(171));
    expect(sent().at(-1)).toContain('2 990 ₽ → 8 970 ₽');
    await runPrePurchaseChains(at(181));
    expect(sent().at(-1)).toContain('ТВОЯ СКИДКА СГОРЕЛА');
    expect(sent()).toHaveLength(5);
    expect(sent().join('\n')).not.toContain('ОСТАЛСЯ ВСЕГО ЧАС');
    // кнопки ведут на тарифы
    expect(calls.at(-1)!.body.reply_markup.inline_keyboard[0][0].web_app.url).toMatch(/startapp=m_[0-9a-f]{32}_tariffs/);

    await runPrePurchaseChains(at(180 + 1 * 24 * 60 + 1));
    expect(sent().at(-1)).toContain('спишь?');
    // «вернуть скидку через сторис» выключено (02.11): скидка и так возвращается при новом заходе
    await runPrePurchaseChains(at(180 + 2 * 24 * 60 + 1));
    expect(sent().join('\n')).not.toContain('ВЕРНУТЬ СКИДКУ');
    // 03.11: ещё три коротких — каждые сутки после «спишь?»
    expect(sent().at(-1)).toContain('Ты опять это сделал');
    await runPrePurchaseChains(at(180 + 3 * 24 * 60 + 1));
    expect(sent().at(-1)).toContain('Я все еще жду тебя');
    clock.set(at(180 + 4 * 24 * 60 + 1).toISOString());
    await runPrePurchaseChains(at(180 + 4 * 24 * 60 + 1));
    expect(sent().at(-1)).toContain('Неожиданно');
    expect(await prisma.botMessageLog.count({ where: { userId: 300n, templateKey: { startsWith: 'chain_' }, status: 'sent' } })).toBe(9);
    // статистика в админке: оплата после «Неожиданно…» засчитывается этому сообщению
    await prisma.payment.create({ data: { userId: 300n, kind: 'initial', status: 'paid', amount: 999, paidAt: at(180 + 4 * 24 * 60 + 30), idempotencyKey: 'bot-stat-300' } });
    const { homeBot } = await import('../src/modules/adminHome');
    const stat = await homeBot({ from: '2026-10-20', to: '2026-10-31' } as never);
    expect(stat.top[0]).toMatchObject({ key: 'chain_14', paid: 1 });
    expect(stat.all.find((x) => x.key === 'chain_02')).toMatchObject({ sent: 1, paid: 0 });
    await prisma.payment.deleteMany({ where: { idempotencyKey: 'bot-stat-300' } });

    // тестовая оплата (проверка владелицы после «Начать путь заново») покупкой не считается — цепочка идёт
    clock.set('2026-10-21T09:00:00Z');
    await start(302);
    await api('POST', '/api/offer/start', 302);
    await prisma.payment.create({ data: { userId: 302n, kind: 'initial', status: 'paid', amount: 999, test: true, paidAt: at(1), idempotencyKey: 'test-pay-302' } });
    calls = [];
    await runPrePurchaseChains(at(12));
    expect(sent().some((t) => t.includes('получилось посмотреть'))).toBe(true);
    await prisma.priceOffer.updateMany({ where: { userId: 302n }, data: { consumedAt: at(13) } });

    // оплатившему цепочка не идёт
    clock.set('2026-10-21T09:00:00Z');
    await start(301);
    await api('POST', '/api/offer/start', 301);
    clock.set(at(30));
    await buy(301);
    calls = [];
    await runPrePurchaseChains(at(61));
    await runPrePurchaseChains(at(181));
    expect(sent()).toHaveLength(0);

    // тестовая оплата (TestMode у CloudPayments или пометка в админке) не входит в выручку и подписки
    const range = { from: new Date('2026-10-01T00:00:00Z'), to: new Date('2026-11-01T00:00:00Z') };
    expect((await dashboard(range)).revenue).toBeGreaterThan(0);
    await prisma.payment.updateMany({ where: { userId: 301n }, data: { test: true } });
    await prisma.subscription.updateMany({ where: { userId: 301n }, data: { test: true } });
    const d = await dashboard(range);
    expect(d).toMatchObject({ revenue: 0, payments: 0, liveSubscriptions: 0, mrr: 0 });
    const cp = new CloudPaymentsProvider();
    expect(cp.parseWebhook({}, { __kind: 'pay', TestMode: '1', InvoiceId: 'x' }).test).toBe(true);
    expect(cp.parseWebhook({}, { __kind: 'pay', TestMode: '0', InvoiceId: 'x' }).test).toBe(false);
  });

  it('не дошла до тарифов за 10 минут после /start — таймер запускается сам и цепочка идёт; давним /start — нет', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await start(310);
    clock.set('2026-10-19T09:00:00Z');
    await start(311); // нажала /start двое суток назад — таймер задним числом не включаем
    calls = [];
    const at = (m: number) => new Date(Date.parse('2026-10-21T09:00:00Z') + m * 60_000);
    await runPrePurchaseChains(at(5));
    expect(await prisma.priceOffer.count({ where: { userId: 310n } })).toBe(0);
    await runPrePurchaseChains(at(10));
    const offer = await prisma.priceOffer.findFirstOrThrow({ where: { userId: 310n, kind: 'intro' } });
    expect(offer.startedAt).toEqual(at(10));
    expect(sent()).toHaveLength(0);
    await runPrePurchaseChains(at(21));
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toContain('получилось посмотреть');
    expect(await prisma.priceOffer.count({ where: { userId: 311n } })).toBe(0);
    // открыла тарифы позже — таймер тот же, не сбрасывается
    clock.set(at(40));
    expect((await api('POST', '/api/offer/start', 310)).status).toBe(200);
    expect((await prisma.priceOffer.findFirstOrThrow({ where: { userId: 310n, kind: 'intro' } })).startedAt).toEqual(at(10));
  });

  it('/stop прекращает цепочку; старты в боте 11.11 и дальше каждые 4 дня: послезавтра, завтра + СТАРТ, сегодня', async () => {
    const { nextMarketingStart } = await import('../src/modules/promos');
    expect(['2026-11-07', '2026-11-11', '2026-11-12', '2026-11-15', '2026-11-16'].map((d) => nextMarketingStart(d as never))).toEqual(['2026-11-11', '2026-11-11', '2026-11-15', '2026-11-15', '2026-11-19']);
    clock.set('2026-11-01T09:00:00Z');
    await start(400);
    expect(String(calls.at(-1)!.body.caption ?? calls.at(-1)!.body.text)).toContain('СТАРТ УЖЕ 11 НОЯБРЯ 🔥‼️\nВХОД ЗАКРОЕТСЯ ЧЕРЕЗ 10 ДНЕЙ!');
    await start(401);
    await start(402);
    const app = await getApp();
    await app.inject({ method: 'POST', url: '/api/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': webhookSecret }, payload: { message: { message_id: 2, chat: { id: 402, type: 'private' }, from: { id: 402 }, text: '/stop' } } });
    clock.set('2026-11-09T08:00:00Z');
    await start(403); // пришёл в день отправки — «послезавтра» ему не положено
    const to = (needle: string) => calls.filter((c) => String(c.body.text ?? c.body.caption).includes(needle)).map((c) => Number(c.body.chat_id)).sort();
    calls = [];
    await runPrePurchaseChains(new Date('2026-11-09T08:30:00Z')); // 11:30 МСК — ещё рано
    expect(to('СТАРТ УЖЕ ПОСЛЕЗАВТРА')).toEqual([]);
    await runPrePurchaseChains(new Date('2026-11-09T09:30:00Z'));
    await runPrePurchaseChains(new Date('2026-11-09T10:30:00Z'));
    expect(to('СТАРТ УЖЕ ПОСЛЕЗАВТРА — 11 ноября')).toEqual([400, 401]);
    calls = [];
    await runPrePurchaseChains(new Date('2026-11-10T09:30:00Z'));
    expect(to('ЗАВТРА, 11 ноября, СТАРТУЕМ')).toEqual([400, 401, 403]);
    expect(to('ВЕРНУЛА ТВОЮ СКИДКУ')).toEqual([400, 401, 403]);
    expect(sent().join(' ')).toContain('1 месяц: 2 990 ₽ → 999 ₽');

    // промокод СТАРТ: действует с 10.11 до конца 11.11, только акционная цена
    clock.set('2026-11-10T12:00:00Z');
    expect((await api('POST', '/api/promo/apply', 400, { code: ' старт ' })).body).toMatchObject({ ok: true, code: 'СТАРТ' });
    const st = await api('GET', '/api/offer', 400);
    expect(st.body.offer).toMatchObject({ active: true, kind: 'promo', promoCode: 'СТАРТ' });
    expect(st.body.tariffs.map((t: { price: number }) => t.price)).toEqual([999, 2990, 3990]);
    expect(await buy(400)).toBe(999);
    const red = await prisma.promoRedemption.findFirstOrThrow({ where: { userId: 400n } });
    expect(red.paymentId).not.toBeNull();
    // день старта: «Сегодня старт» — всем, кто ещё не купил
    calls = [];
    await runPrePurchaseChains(new Date('2026-11-11T09:30:00Z'));
    expect(to('СЕГОДНЯ СТАРТ — 11 ноября')).toEqual([401, 403]);
    clock.set('2026-11-12T09:00:00Z');
    expect((await api('POST', '/api/promo/apply', 401, { code: 'СТАРТ' })).body.code).toBe('promo_expired');
    expect((await api('POST', '/api/promo/apply', 401, { code: 'НЕТТАКОГО' })).body.code).toBe('promo_not_found');
    // не успела к своему старту — про следующие старты (15.11) уже не пишем; новичок 12.11 получает свой 15.11
    clock.set('2026-11-12T09:00:00Z');
    await start(404);
    expect(String(calls.at(-1)!.body.caption ?? calls.at(-1)!.body.text)).toContain('СТАРТ УЖЕ 15 НОЯБРЯ 🔥‼️\nВХОД ЗАКРОЕТСЯ ЧЕРЕЗ 3 ДНЯ!');
    calls = [];
    await runPrePurchaseChains(new Date('2026-11-12T09:30:00Z'));
    expect(to('ПОСЛЕЗАВТРА')).toEqual([]);
    await runPrePurchaseChains(new Date('2026-11-13T09:30:00Z'));
    expect(to('СТАРТ УЖЕ ПОСЛЕЗАВТРА — 15 ноября')).toEqual([404]);
  });

  it('«Вернуть скидку»: заявка на сторис → проверка → одноразовый персональный промокод', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await start(500);
    await start(501);
    const card = await (await getApp()).inject({ method: 'GET', url: '/api/public/story-card.png' });
    expect(card.statusCode).toBe(200);
    expect(card.headers['content-type']).toBe('image/png');
    const shot = async (ownerId: number) => (await prisma.mediaFile.create({ data: { ownerId: BigInt(ownerId), storageKey: `media/test-${ownerId}.jpg`, mime: 'image/jpeg', size: 1 } })).id;
    const shot500 = await shot(500);
    expect((await api('POST', '/api/story-requests', 500, { instagram: 'anya.fit' })).status).toBe(400); // без скриншота нельзя
    expect((await api('POST', '/api/story-requests', 500, { mediaId: shot500, instagram: 'not a nick!' })).status).toBe(400);
    expect((await api('POST', '/api/story-requests', 501, { mediaId: shot500 })).body.code).toBe('media_not_found'); // чужой файл
    const req = await api('POST', '/api/story-requests', 500, { mediaId: shot500, instagram: '@anya.fit' });
    expect(req.body.request).toMatchObject({ status: 'pending', instagram: 'anya.fit' });
    expect((await api('POST', '/api/story-requests', 500, { mediaId: shot500 })).body.code).toBe('story_pending');
    // владелец получает заявку в служебном боте (подписка по секретной ссылке) и одной кнопкой высылает промокод
    expect(adminCalls).toHaveLength(0); // никто не подписан
    const admin = await getApp();
    const hook = (payload: object) => admin.inject({ method: 'POST', url: '/api/telegram/admin-webhook', headers: { 'x-telegram-bot-api-secret-token': adminBotSecret() }, payload });
    expect((await admin.inject({ method: 'POST', url: '/api/telegram/admin-webhook', payload: {} })).statusCode).toBe(401);
    await hook({ message: { chat: { id: 77, type: 'private' }, text: '/start wrong' } });
    await hook({ message: { chat: { id: 77, type: 'private' }, text: `/start ${adminBotLinkCode()}` } });
    const req2 = await api('POST', '/api/story-requests', 501, { mediaId: await shot(501), instagram: 'masha' });
    const adminCard = adminCalls.find((c) => c.method === 'sendPhoto' && String(c.body.caption).includes('@masha'))!;
    expect(adminCard.body.photo).toMatch(/\/api\/media\/.+sig=/);
    expect(adminCard.body.chat_id).toBe(77);
    expect(adminCard.body.reply_markup.inline_keyboard[0][0]).toMatchObject({ text: '✅ Выслать промокод', callback_data: `sa:${req2.body.request.id}` });
    await hook({ callback_query: { id: 'q0', from: { id: 99 }, data: `sa:${req2.body.request.id}`, message: { chat: { id: 99 }, message_id: 5 } } }); // чужой чат
    expect((await api('GET', '/api/story-requests/mine', 501)).body.request.status).toBe('pending');
    await hook({ callback_query: { id: 'q1', from: { id: 77 }, data: `sa:${req2.body.request.id}`, message: { chat: { id: 77 }, message_id: 5, caption: 'заявка', photo: [{}] } } });
    const mine2 = (await api('GET', '/api/story-requests/mine', 501)).body.request;
    expect(mine2.status).toBe('approved');
    expect(sent().at(-1)).toContain(mine2.promo.code);
    expect(adminCalls.find((c) => c.method === 'editMessageCaption')!.body.caption).toContain('отправлен');
    const { code } = await decideStoryRequest(req.body.request.id, 'approve', 'owner');
    expect(code).toMatch(/^ВЕРНИ\d{5}$/);
    expect(sent().at(-1)).toContain(code);
    expect((await api('GET', '/api/story-requests/mine', 500)).body.request.promo.code).toBe(code);
    // чужой персональный код не работает
    expect((await api('POST', '/api/promo/apply', 501, { code })).body.code).toBe('promo_not_found');
    expect((await api('POST', '/api/promo/apply', 500, { code: code!.toLowerCase() })).body.ok).toBe(true);
    expect(await buy(500)).toBe(999);
    const promo = await prisma.promo.findUniqueOrThrow({ where: { code: code! } });
    expect(promo).toMatchObject({ uses: 1, active: false });
  });

  it('предложение стать парой: пуш в боте, подтверждение или отказ в приложении', async () => {
    clock.set('2026-10-21T09:00:00Z');
    for (const id of [801, 802, 803]) {
      await start(id);
      await grantMembership(id, '2026-11-01', 'm1');
    }
    calls = [];
    const p1 = await api('POST', '/api/buddy/propose/802', 801);
    expect(p1.body).toMatchObject({ matched: false });
    expect(sent().at(-1)).toContain('предлагает тебе стать бадди');
    // «Принять / Отклонить» прямо в боте
    expect(calls.at(-1)!.body.reply_markup.inline_keyboard[0].map((b: { text: string }) => b.text)).toEqual(['Принять', 'Отклонить']);
    expect((await api('GET', '/api/participants/802', 801)).body.buddy.state).toBe('sent');
    const prof = await api('GET', '/api/participants/801', 802);
    expect(prof.body.buddy).toMatchObject({ state: 'incoming' });
    const inc = await api('GET', '/api/buddy/proposals', 802);
    expect(inc.body.incoming[0].user.id).toBe('801');
    expect((await api('POST', `/api/buddy/proposals/${inc.body.incoming[0].id}`, 803, { accept: true })).status).toBe(404); // не ему
    expect((await api('POST', `/api/buddy/proposals/${inc.body.incoming[0].id}`, 802, { accept: true })).body).toMatchObject({ accepted: true });
    expect((await api('GET', '/api/buddy', 801)).body.state).toBe('paired');
    expect((await api('GET', '/api/participants/802', 801)).body.buddy.state).toBe('paired');
    expect((await api('POST', '/api/buddy/propose/801', 803)).body.code).toBe('target_paired');
    // отказ
    await grantMembership(804, '2026-11-01', 'm1');
    const p2 = await api('POST', '/api/buddy/propose/804', 803);
    expect((await api('POST', `/api/buddy/proposals/${p2.body.proposalId}`, 804, { accept: false })).body).toEqual({ accepted: false });
    const n = await api('GET', '/api/notifications', 803);
    expect(n.body.items[0].title).toContain('отклонено');
    expect(sent().some((t) => t.includes('пока не готова стать парой'))).toBe(true);
    // ответ кнопкой в боте
    await grantMembership(805, '2026-11-01', 'm1');
    const p3 = await api('POST', '/api/buddy/propose/805', 803);
    const app = await getApp();
    await app.inject({ method: 'POST', url: '/api/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': webhookSecret }, payload: { callback_query: { id: 'q9', from: { id: 805 }, data: `bp:a:${p3.body.proposalId}`, message: { chat: { id: 805 } } } } });
    expect((await api('GET', '/api/buddy', 803)).body.state).toBe('paired');
    expect(sent().some((t) => t.includes('Ура! Мы нашли тебе бадди'))).toBe(true);
  });

  it('режим проверки цепочки: /start сбрасывает покупку и присылает 02–11 подряд', async () => {
    process.env.CHAIN_TEST = '777';
    process.env.CHAIN_TEST_STEP_SEC = '1';
    try {
      await buy(777);
      const me0 = (await api('GET', '/api/me', 777)).body;
      expect(me0.subscription).not.toBeNull();
      const firstStart = me0.membership.flow.startsOn;
      calls = [];
      await start(777);
      expect((await api('GET', '/api/me', 777)).body.subscription).toBeNull();
      await new Promise((r) => setTimeout(r, 16_500));
      const texts = sent();
      expect(texts.length).toBe(14); // 09 «вернуть скидку» выключено; 12–14 (03.11), 10–11 и 15 — старты каждые 4 дня (07.11)
      expect(texts[1]).toContain('получилось посмотреть');
      // Обычное расписание владельцу ничего не дублирует
      calls = [];
      await api('POST', '/api/offer/start', 777);
      await runPrePurchaseChains(new Date(clock.now().getTime() + 11 * 60_000));
      expect(sent().length).toBe(0);
      // Повторная покупка после сброса возвращает ближайший поток, а не следующий
      await buy(777);
      const me1 = (await api('GET', '/api/me', 777)).body;
      expect(me1.membership).toMatchObject({ status: 'reserved', flow: { startsOn: firstStart } });
    } finally {
      delete process.env.CHAIN_TEST;
      delete process.env.CHAIN_TEST_STEP_SEC;
    }
  }, 30_000);
});


describe('повышение тарифа из анкеты (05.11)', () => {
  it('1 месяц → 3 месяца: доплата разницы, автопродление по цене 3 месяцев, старая подписка закрывается только после оплаты', async () => {
    const { mockCalls } = await import('../src/payments/mock');
    clock.set('2026-11-05T09:00:00Z');
    await start(970);
    await api('POST', '/api/offer/start', 970);
    const paid = await buy(970);
    expect(paid).toBe(999);
    const g = await api('POST', '/api/goals', 970, { category: 'habits', title: 'Первая цель', pointA: 'а', pointB: 'б' });
    expect(g.status).toBe(200);
    // вторую цель на 1 месяце не добавить
    expect((await api('POST', '/api/goals', 970, { category: 'blog', title: 'Вторая цель', pointA: 'а', pointB: 'б' })).status).toBe(409);
    const offer = (await api('GET', '/api/upgrade', 970)).body;
    expect(offer).toMatchObject({ available: true, amount: 1991, paid: 999, price: 2990, to: { goalLimit: 3 }, renewal: { amount: 2990, date: '2027-02-28', months: 3 } });
    const co = await api('POST', '/api/upgrade/checkout', 970, { idempotencyKey: 'upgrade-970-1' });
    expect(co.body.amount).toBe(1991);
    // пока не оплачено — прежняя подписка жива
    const before = await prisma.subscription.findFirstOrThrow({ where: { userId: 970n } });
    expect(before.status).not.toBe('expired');
    mockCalls.length = 0;
    const data = { order_num: co.body.paymentId, order_id: `pd-${co.body.paymentId}`, sum: '1991.00', payment_status: 'success', customer_extra: 'tg:970', subscription_id: 'pd-sub-up' };
    expect(await handleWebhook(paymentProvider().parseWebhook({ sign: signMock(data) }, data), JSON.stringify(data))).toMatchObject({ upgraded: true });
    const subs = await prisma.subscription.findMany({ where: { userId: 970n }, orderBy: { createdAt: 'asc' } });
    expect(subs).toHaveLength(2);
    expect(subs[0]).toMatchObject({ status: 'expired', autoRenew: false, cancelReason: 'upgraded' });
    expect(subs[1]).toMatchObject({ tariffId: 'm3', renewalPrice: 2990, autoRenew: true, providerSubscriptionId: 'pd-sub-up' });
    expect(subs[1].paidThroughFlow.toISOString().slice(0, 10)).toBe('2027-02-01'); // куплен декабрь → декабрь–февраль
    expect(subs[1].nextChargeDate!.toISOString().slice(0, 10)).toBe('2027-02-28');
    // автопродление прежней подписки выключено у провайдера
    expect(mockCalls.some((c) => c.method === 'setActive' && c.arg === false)).toBe(true);
    // теперь можно до 3 целей; оплачены три месяца
    expect((await api('GET', '/api/membership', 970)).body.membership.goalLimit).toBe(3);
    expect((await api('POST', '/api/goals', 970, { category: 'blog', title: 'Вторая цель', pointA: 'а', pointB: 'б' })).status).toBe(200);
    expect(await prisma.flowMembership.count({ where: { userId: 970n, tariffId: 'm3' } })).toBe(3);
    expect((await api('GET', '/api/upgrade', 970)).body.available).toBe(false);
    expect((await api('GET', `/api/payments/${co.body.paymentId}`, 970)).body).toMatchObject({ kind: 'upgrade', status: 'paid' });
  });
});

describe('выдать доступ вручную (11.11)', () => {
  it('3 месяца без оплаты: подписка без автопродления, участие в текущем месяце, до 3 целей; разово по нику', async () => {
    clock.set('2026-11-11T09:00:00Z');
    await start(1970);
    await prisma.user.update({ where: { id: 1970n }, data: { username: 'Curly_Bob' } });
    const { grantOnceByUsername } = await import('../src/modules/grant');
    await grantOnceByUsername('curly_bob', 'm3', 3, 'тест');
    await grantOnceByUsername('curly_bob', 'm3', 3, 'тест'); // второй раз не выдаётся
    const subs = await prisma.subscription.findMany({ where: { userId: 1970n } });
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ tariffId: 'm3', autoRenew: false, renewalPrice: 0, cancelReason: 'gift', status: 'canceled_at_period_end' });
    expect(subs[0].paidThroughFlow.toISOString().slice(0, 10)).toBe('2027-01-01');
    const me = (await api('GET', '/api/me', 1970)).body;
    expect(me.membership).toMatchObject({ status: 'reserved', tariffId: 'm3' });
    expect((await api('GET', '/api/membership', 1970)).body.membership.goalLimit).toBe(3);
  });
});

describe('подарочная ссылка (11.11)', () => {
  it('новенькой — 3 месяца; с действующей подпиской на 1 месяц — продление и тариф «3 месяца»; второй раз не работает', async () => {
    clock.set('2026-11-11T09:00:00Z');
    const { createGiftLink } = await import('../src/modules/grant');
    const a = await createGiftLink('m3', 3, 'тест');
    await start(1980);
    expect((await api('POST', '/api/gift/redeem', 1980, { code: a })).body).toMatchObject({ ok: true, until: '2027-02-01' });
    expect((await api('GET', '/api/me', 1980)).body.membership).toMatchObject({ tariffId: 'm3' });
    await start(1981);
    expect((await api('POST', '/api/gift/redeem', 1981, { code: a })).status).toBe(403); // уже использована
    // купила 1 месяц через CloudPayments — продлеваем
    const b = await createGiftLink('m3', 3, 'тест2');
    await api('POST', '/api/offer/start', 1981);
    await buy(1981);
    const before = await prisma.subscription.findFirstOrThrow({ where: { userId: 1981n } });
    expect(before.tariffId).toBe('m1');
    expect((await api('POST', '/api/gift/redeem', 1981, { code: b })).body).toMatchObject({ ok: true, extended: true, until: '2027-02-01' });
    const after = await prisma.subscription.findUniqueOrThrow({ where: { id: before.id } });
    expect(after).toMatchObject({ tariffId: 'm3', autoRenew: true });
    expect(after.paidThroughFlow.toISOString().slice(0, 10)).toBe('2027-01-01');
    expect(after.nextChargeDate!.toISOString().slice(0, 10)).toBe('2027-01-28');
    expect((await api('GET', '/api/membership', 1981)).body.membership.goalLimit).toBe(3);
  });
});

describe('оплата из бота (12.11)', () => {
  it('«ХОЧУ ОПЛАТИТЬ ВХОД» → «Выбери свой тариф» с ценами → кнопка тарифа сразу открывает оплату', async () => {
    clock.set('2026-11-12T09:00:00Z');
    await start(1990);
    const app = await getApp();
    const cb = (data: string) => app.inject({ method: 'POST', url: '/api/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': webhookSecret }, payload: { callback_query: { id: 'q1', from: { id: 1990 }, message: { chat: { id: 1990 } }, data } } });
    calls = [];
    await cb('how_to_join');
    const how = calls.find((c) => String(c.body.text ?? c.body.caption).includes('Ого, смело'))!;
    expect(JSON.stringify(how.body.reply_markup)).toContain('choose_tariff');
    calls = [];
    await cb('choose_tariff');
    const pick = calls.find((c) => String(c.body.caption ?? c.body.text).includes('Выбери свой тариф'))!;
    // картинка со сравнением тарифов и цели под каждым тарифом
    expect(pick.method).toBe('sendPhoto');
    expect(String(pick.body.photo)).toMatch(/\/img\/tariffs-compare-h\.jpg$/);
    expect(String(pick.body.caption)).toContain('Доступ к коммьюнити, приложению и полезным материалам придет сразу после оплаты');
    expect(String(pick.body.caption)).toContain('(безлимит целей)');
    pick.body.text = pick.body.caption;
    expect(String(pick.body.text).replace(/[\u00a0\u202f]/g, ' ')).toContain('<s>8 970 ₽</s> → <b>2 990 ₽</b>');
    expect(String(pick.body.text)).toContain('🔥 3 месяца');
    const kb = (pick.body.reply_markup as { inline_keyboard: { text: string; url?: string }[][] }).inline_keyboard.flat();
    expect(kb.map((b) => b.text)).toEqual(['😍 1 месяц', '😍🔥 3 месяца — ХИТ', '😍 6 месяцев', '🌍 Оплатить зарубежной картой']);
    const m3 = kb[1].url!;
    expect(m3).toMatch(/\/pay\/new\/1990\.m3\.\d+\.[A-Za-z0-9_-]{22}$/);
    const path = new URL(m3).pathname;
    const r = await app.inject({ method: 'GET', url: path });
    expect(r.statusCode).toBe(302);
    const p = await prisma.payment.findFirstOrThrow({ where: { userId: 1990n } });
    expect(p).toMatchObject({ tariffId: 'm3', amount: 2990, kind: 'initial' });
    expect(r.headers.location).toContain(p.id);
    // подделка токена и чужой тариф не проходят
    expect((await app.inject({ method: 'GET', url: path.replace('.m3.', '.m6.') })).body).toContain('Ссылка устарела');
    // оферта открывается страницей
    expect((await app.inject({ method: 'GET', url: '/doc/offer' })).body).toContain('Публичная оферта');
  });
});
