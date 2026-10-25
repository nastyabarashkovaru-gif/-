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

describe('дожимная цепочка до оплаты', () => {
  it('сообщение 1 — один раз; 2–7 по таймеру из реальных цен; пропущенные не досылаются; после оплаты — тишина', async () => {
    clock.set('2026-10-21T09:00:00Z');
    await start(300);
    await start(300);
    expect(sent()[0]).toContain('На связи Настя');
    expect(sent()[1]).toBe('Жми кнопку ниже, чтобы открыть приложение 👇');
    const app0 = await getApp();
    await app0.inject({ method: 'POST', url: '/api/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': webhookSecret }, payload: { message: { message_id: 3, chat: { id: 300, type: 'private' }, from: { id: 300 }, text: '/start hello' } } });
    expect(sent()[2]).toContain('На связи Настя');
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
    expect(sent().at(-1)).toContain('2 490 ₽ → 8 970 ₽');
    await runPrePurchaseChains(at(181));
    expect(sent().at(-1)).toContain('ТВОЯ СКИДКА СГОРЕЛА');
    expect(sent()).toHaveLength(5);
    expect(sent().join('\n')).not.toContain('ОСТАЛСЯ ВСЕГО ЧАС');
    // кнопки ведут на тарифы
    expect(calls.at(-1)!.body.reply_markup.inline_keyboard[0][0].web_app.url).toMatch(/startapp=m_[0-9a-f]{32}_tariffs/);

    await runPrePurchaseChains(at(180 + 2 * 24 * 60 + 1));
    expect(sent().at(-1)).toContain('спишь?');
    await runPrePurchaseChains(at(180 + 4 * 24 * 60 + 1));
    expect(sent().at(-1)).toContain('ВЕРНУТЬ СКИДКУ');
    expect(calls.at(-1)!.body.reply_markup.inline_keyboard[0][0].web_app.url).toMatch(/_restore$/);
    expect(await prisma.botMessageLog.count({ where: { userId: 300n, templateKey: { startsWith: 'chain_' }, status: 'sent' } })).toBe(7);

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
  });

  it('/stop прекращает цепочку; 10–11 — за 2 и 1 день до старта, не задним числом; СТАРТ возвращает акционные цены', async () => {
    clock.set('2026-10-20T09:00:00Z');
    await start(400);
    await start(401);
    await start(402);
    const app = await getApp();
    await app.inject({ method: 'POST', url: '/api/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': webhookSecret }, payload: { message: { message_id: 2, chat: { id: 402, type: 'private' }, from: { id: 402 }, text: '/stop' } } });
    clock.set('2026-10-30T08:00:00Z');
    await start(403); // пришёл в день отправки — сообщение 10 ему не положено
    calls = [];
    await runPrePurchaseChains(new Date('2026-10-30T08:30:00Z')); // 11:30 МСК — ещё рано
    expect(sent()).toHaveLength(0);
    await runPrePurchaseChains(new Date('2026-10-30T09:30:00Z'));
    await runPrePurchaseChains(new Date('2026-10-30T10:30:00Z'));
    expect(calls.filter((c) => sent().length && String(c.body.text).includes('ОСТАЛОСЬ ВСЕГО 2 ДНЯ')).map((c) => c.body.chat_id).sort()).toEqual([400, 401]);
    calls = [];
    await runPrePurchaseChains(new Date('2026-10-31T09:30:00Z'));
    expect(sent()).toHaveLength(3); // 400, 401, 403
    expect(sent()[0]).toContain('1 месяц: 2 990 ₽ → 999 ₽');

    // промокод СТАРТ: действует с 31.10 до конца 1.11, только акционная цена
    clock.set('2026-10-31T12:00:00Z');
    expect((await api('POST', '/api/promo/apply', 400, { code: ' старт ' })).body).toMatchObject({ ok: true, code: 'СТАРТ' });
    const st = await api('GET', '/api/offer', 400);
    expect(st.body.offer).toMatchObject({ active: true, kind: 'promo', promoCode: 'СТАРТ' });
    expect(st.body.tariffs.map((t: { price: number }) => t.price)).toEqual([999, 2490, 3990]);
    expect(await buy(400)).toBe(999);
    const red = await prisma.promoRedemption.findFirstOrThrow({ where: { userId: 400n } });
    expect(red.paymentId).not.toBeNull();
    clock.set('2026-11-02T09:00:00Z');
    expect((await api('POST', '/api/promo/apply', 401, { code: 'СТАРТ' })).body.code).toBe('promo_expired');
    expect((await api('POST', '/api/promo/apply', 401, { code: 'НЕТТАКОГО' })).body.code).toBe('promo_not_found');
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
    expect(sent().at(-1)).toContain('предлагает тебе стать парой');
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
  });

  it('режим проверки цепочки: /start сбрасывает покупку и присылает 02–11 подряд', async () => {
    process.env.CHAIN_TEST = '777';
    process.env.CHAIN_TEST_STEP_SEC = '1';
    try {
      await buy(777);
      expect((await api('GET', '/api/me', 777)).body.subscription).not.toBeNull();
      calls = [];
      await start(777);
      expect((await api('GET', '/api/me', 777)).body.subscription).toBeNull();
      await new Promise((r) => setTimeout(r, 10_500));
      const texts = sent();
      expect(texts.length).toBe(11);
      expect(texts[1]).toContain('получилось посмотреть');
      // Обычное расписание владельцу ничего не дублирует
      calls = [];
      await api('POST', '/api/offer/start', 777);
      await runPrePurchaseChains(new Date(clock.now().getTime() + 11 * 60_000));
      expect(sent().length).toBe(0);
    } finally {
      delete process.env.CHAIN_TEST;
      delete process.env.CHAIN_TEST_STEP_SEC;
    }
  }, 20_000);
});

