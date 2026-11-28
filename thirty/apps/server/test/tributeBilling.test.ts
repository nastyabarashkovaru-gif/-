import { createHmac } from 'node:crypto';
import { TOPIC_CHATS } from '@thirty/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { setTelegramTransport } from '../src/lib/telegram';
import { accessibleChats, approvePendingRequests, onChatMemberUpdate, onJoinRequest, removeExpiredMembers } from '../src/modules/chats';
import { checkTributeReadiness, maintainVerifiedTribute, reconcileTributeSubscribers } from '../src/modules/tributeBilling';
import { api, clock, getApp, prisma, resetDb } from './helpers';

const key = 'tribute-integration-test-secret';
const initialTime = '2026-11-27T10:00:00.000Z';
const end = '2026-12-27T10:00:00.000Z';
const oldConfig = { key: config.TRIBUTE_API_KEY, offer: config.TRIBUTE_SUBSCRIPTION_ID, checkout: config.TRIBUTE_NEW_CHECKOUT_URL, active: config.TRIBUTE_VERIFIED_ACCESS };
const telegramCalls: string[] = [];

function event(userId: number, period = 'monthly', kind = 'new_subscription', createdAt = initialTime, expiresAt = end, offer = 123) {
  return {
    name: kind, created_at: createdAt, sent_at: createdAt,
    payload: { subscription_id: offer, telegram_user_id: userId, period, expires_at: expiresAt, type: 'regular' },
  };
}

async function webhook(message: object | string, trusted = true) {
  const payload = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
  const signature = createHmac('sha256', trusted ? key : 'incorrect-key').update(payload).digest('hex');
  return (await getApp()).inject({
    method: 'POST', url: '/api/payments/tribute/webhook', headers: { 'content-type': 'application/json', 'trbt-signature': signature }, payload,
  });
}

const addGoal = (userId: number, category: string) => api('POST', '/api/goals', userId, { title: `Цель ${category}`, category });

describe('Tribute checkout and paid access', () => {
  beforeEach(async () => {
    await resetDb();
    clock.set(new Date(initialTime));
    config.TRIBUTE_API_KEY = key;
    config.TRIBUTE_SUBSCRIPTION_ID = '123';
    config.TRIBUTE_VERIFIED_ACCESS = true;
    telegramCalls.length = 0;
    setTelegramTransport(async (method) => {
      telegramCalls.push(method);
      return true as never;
    });
  });

  afterEach(() => Object.assign(config, {
    TRIBUTE_API_KEY: oldConfig.key, TRIBUTE_SUBSCRIPTION_ID: oldConfig.offer, TRIBUTE_NEW_CHECKOUT_URL: oldConfig.checkout, TRIBUTE_VERIFIED_ACCESS: oldConfig.active,
  }));

  it('acknowledges signed test requests without granting access or weakening purchase validation', async () => {
    expect((await webhook({}, false)).statusCode).toBe(401);
    for (const probe of ['', 'ping', {}, { test: true }, { ...event(810), test: true }]) {
      const response = await webhook(probe);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, status: 'test' });
    }
    const incomplete = await webhook({ name: 'new_subscription', created_at: initialTime, payload: { subscription_id: 123 } });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json().code).toBe('invalid_tribute_event');
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.tributeEntitlement.count()).toBe(0);
    expect(telegramCalls).toEqual([]);
  });

  it('accepts the original signed bytes, requires a real offer and ignores attempts to select a tier', async () => {
    expect((await webhook(event(811), false)).statusCode).toBe(401);
    expect((await webhook(event(812, 'monthly', 'new_subscription', initialTime, end, 999))).json().status).toBe('ignored');
    expect((await webhook(event(813, 'weekly'))).json().status).toBe('ignored');
    expect((await api('POST', '/api/tribute/activate', 814, { tariffId: 'm6' })).status).toBe(403);
    expect((await api('POST', '/api/checkout', 814, { tariffId: 'm1', idempotencyKey: 'test-tribute-only' })).status).toBe(403);
    expect(await prisma.subscription.count()).toBe(0);

    const message = event(811);
    expect((await webhook(message)).json().status).toBe('applied');
    const retry = { ...message, sent_at: '2026-11-27T10:05:00.000Z' };
    expect((await webhook(retry)).json().status).toBe('duplicate_or_old');
    expect(await prisma.subscription.count()).toBe(1);
    expect(await prisma.paymentEvent.count({ where: { provider: 'tribute' } })).toBe(1);
    const me = (await api('GET', '/api/me', 811)).body;
    expect(me.subscription.tariffId).toBe('m1');
    expect(me.membership.tariffId).toBe('m1');
  });

  it('enforces the goal and chat allowances for all three purchases', async () => {
    await prisma.telegramChat.createMany({ data: TOPIC_CHATS.map((topic, i) => ({
      kind: 'topic', title: topic.title, topic: topic.id, telegramChatId: BigInt(-100600 - i), active: true,
    })) });
    for (const [userId, period, limit, expectedChats] of [[821, 'monthly', 1, 1], [822, 'quarterly', 3, 3], [823, 'halfyearly', 6, 5]] as const) {
      expect((await webhook(event(userId, period))).json().status).toBe('applied');
      for (const category of [...TOPIC_CHATS.map((topic) => topic.id), 'other'].slice(0, limit)) expect((await addGoal(userId, category)).status).toBe(200);
      if (limit < 6) expect((await addGoal(userId, 'other')).status).toBe(409);
      expect((await accessibleChats(BigInt(userId))).filter((chat) => chat.kind === 'topic')).toHaveLength(expectedChats);
    }
  });

  it('requires each participant to use their own Mini App invitation', async () => {
    const chat = await prisma.telegramChat.create({ data: { kind: 'topic', title: 'English', topic: 'english', telegramChatId: -100860n, active: true } });
    for (const id of [861, 862]) {
      await webhook(event(id));
      await addGoal(id, 'english');
    }
    const oldLink = 'https://t.me/+old';
    const newLink = 'https://t.me/+new';
    const ourBot = { id: 123456 };
    await prisma.chatMembership.create({ data: { chatId: chat.id, userId: 861n, inviteLink: oldLink } });
    setTelegramTransport(async (method) => {
      telegramCalls.push(method);
      return (method === 'createChatInviteLink' ? { invite_link: newLink } : true) as never;
    });

    const join = (id: number, url: string, creator = ourBot) => onJoinRequest(Number(chat.telegramChatId), id, { invite_link: url, creator });
    await join(861, oldLink);
    expect(telegramCalls.at(-1)).toBe('declineChatJoinRequest');
    const issued = await api('POST', `/api/chats/${chat.id}/invite`, 861);
    expect(issued.body.url).toBe(newLink);
    await join(861, newLink, { id: 99 });
    expect(telegramCalls.at(-1)).toBe('declineChatJoinRequest');
    await join(862, newLink);
    expect(telegramCalls.at(-1)).toBe('declineChatJoinRequest');
    expect(await approvePendingRequests()).toEqual({ tried: 0, approved: 0 });
    await join(861, newLink);
    expect(telegramCalls.filter((method) => method === 'approveChatJoinRequest')).toHaveLength(1);
    expect(await prisma.chatMembership.findUnique({ where: { chatId_userId: { chatId: chat.id, userId: 861n } } })).toMatchObject({ status: 'joined', invitedFromApp: true });
  });

  it('retains a cancelled paid period and cannot reopen it by repeating an earlier payment', async () => {
    await webhook(event(831));
    const goal = await addGoal(831, 'english');
    const chat = await prisma.telegramChat.create({ data: { kind: 'topic', title: 'English', topic: 'english', telegramChatId: -100831n, active: true } });
    await onChatMemberUpdate(Number(chat.telegramChatId), 831, 'member');
    const cancelledAt = '2026-12-01T12:00:00.000Z';
    clock.set(new Date(cancelledAt));
    expect((await webhook(event(831, 'monthly', 'cancelled_subscription', cancelledAt))).json().status).toBe('applied');
    expect((await api('GET', '/api/me', 831)).body.subscription).toMatchObject({ status: 'canceled_at_period_end', autoRenew: false });
    expect((await accessibleChats(831n)).map((item) => item.id)).toContain(chat.id);
    expect((await webhook(event(831))).json().status).toBe('duplicate_or_old');
    clock.set(new Date(end));
    expect(await accessibleChats(831n)).toHaveLength(0);
    await maintainVerifiedTribute();
    expect(await removeExpiredMembers()).toEqual({ removed: 1 });
    expect(telegramCalls).toContain('banChatMember');
    expect((await api('GET', '/api/me', 831)).body).toMatchObject({ membership: null, subscription: null });
    expect(await prisma.goal.findUnique({ where: { id: goal.body.id } })).not.toBeNull();
    expect(await prisma.subscription.findFirst({ where: { userId: 831n } })).toMatchObject({ status: 'expired' });
    expect((await webhook(event(831))).json().status).toBe('duplicate_or_old');
    const renewedUntil = '2027-01-27T10:00:00.000Z';
    expect((await webhook(event(831, 'monthly', 'renewed_subscription', end, renewedUntil))).json().status).toBe('applied');
    expect((await api('GET', '/api/me', 831)).body.subscription.tariffId).toBe('m1');
  });

  it('opens the replacement checkout and keeps an overlapping legacy renewal', async () => {
    config.TRIBUTE_NEW_CHECKOUT_URL = 'https://web.tribute.tg/s/20';
    const newCheckout = 'https://t.me/tribute/app?startapp=s20';
    expect((await api('GET', '/api/me', 871)).body.tributeCheckoutUrl).toBe(newCheckout);

    await webhook(event(871));
    const shorterEnd = '2026-12-15T10:00:00.000Z';
    await webhook(event(871, 'quarterly', 'new_subscription', initialTime, shorterEnd, 124));
    expect((await api('GET', '/api/me', 871)).body.subscription.tariffId).toBe('m3');
    const renewedAt = '2026-12-04T12:00:00.000Z';
    const renewedUntil = '2027-01-27T10:00:00.000Z';
    clock.set(new Date(renewedAt));
    expect((await webhook(event(871, 'monthly', 'renewed_subscription', renewedAt, renewedUntil))).json().status).toBe('applied');
    expect((await api('GET', '/api/me', 871)).body.subscription.tariffId).toBe('m3');

    clock.set(new Date(shorterEnd));
    expect((await api('GET', '/api/me', 871)).body.subscription.tariffId).toBe('m1');
    expect(await prisma.tributeEntitlement.count({ where: { userId: 871n } })).toBe(2);
    expect(await prisma.subscription.findFirst({ where: { userId: 871n } })).toMatchObject({ tributeExpiresAt: new Date(renewedUntil) });
  });

  it('restores an existing active subscription using the offer snapshot when authorised', async () => {
    await api('GET', '/api/me', 841);
    config.TRIBUTE_SUBSCRIBER_SYNC = true;
    const response = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: [
      { subscriptionId: 123, telegramUserId: 841, status: 'pre_cancelled', activatedAt: '2026-11-02T00:00:00Z', expireAt: end, period: 'halfyearly' },
      { subscriptionId: 999, telegramUserId: 842, status: 'active', activatedAt: initialTime, expireAt: end, period: 'monthly' },
    ] })));
    vi.stubGlobal('fetch', response);
    try {
      await reconcileTributeSubscribers();
      expect(response.mock.calls[0][0].searchParams.get('subscriptionID')).toBe('123');
      expect((await api('GET', '/api/me', 841)).body.subscription).toMatchObject({ tariffId: 'm6', status: 'canceled_at_period_end' });
      expect(await prisma.tributeEntitlement.count()).toBe(1);
    } finally {
      config.TRIBUTE_SUBSCRIBER_SYNC = false;
      vi.unstubAllGlobals();
    }
  });

  it('reports the configured offer and linkable subscribers without changing subscriptions', async () => {
    const fetchMock = vi.fn(async (url: URL | string) => new Response(JSON.stringify({ result: String(url).includes('/subscribers?')
      ? [
        { subscriptionId: 123, telegramUserId: 851, status: 'active', activatedAt: initialTime, expireAt: end, period: 'monthly' },
        { subscriptionId: 123, telegramUserId: 0, status: 'active', activatedAt: initialTime, expireAt: end, period: 'monthly' },
      ]
      : [{ subscriptionId: 123, currency: 'rub', periods: [{ period: 'monthly', price: 999 }] }],
    })));
    vi.stubGlobal('fetch', fetchMock);
    try {
      expect(await checkTributeReadiness()).toMatchObject({
        offer: { found: true, currency: 'rub', periods: [{ period: 'monthly', price: 999 }] },
        activeSubscriptions: 2, verifiedSubscribers: 1, withoutTelegram: 1, legacySubscriptions: 0, legacyMatched: 0,
      });
      expect(await prisma.subscription.count()).toBe(0);
      expect(await prisma.tributeEntitlement.count()).toBe(0);
      expect(telegramCalls).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
