import { createHmac } from 'node:crypto';
import { TOPIC_CHATS } from '@thirty/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { setTelegramTransport } from '../src/lib/telegram';
import { accessibleChats, onChatMemberUpdate, removeExpiredMembers } from '../src/modules/chats';
import { maintainVerifiedTribute, reconcileTributeSubscribers } from '../src/modules/tributeBilling';
import { api, clock, getApp, prisma, resetDb } from './helpers';

const key = 'tribute-integration-test-secret';
const initialTime = '2026-11-27T10:00:00.000Z';
const end = '2026-12-27T10:00:00.000Z';
const oldConfig = { key: config.TRIBUTE_API_KEY, offer: config.TRIBUTE_SUBSCRIPTION_ID, active: config.TRIBUTE_VERIFIED_ACCESS };
const telegramCalls: string[] = [];

function event(userId: number, period = 'monthly', kind = 'new_subscription', createdAt = initialTime, expiresAt = end, offer = 123) {
  return {
    name: kind, created_at: createdAt, sent_at: createdAt,
    payload: { subscription_id: offer, telegram_user_id: userId, period, expires_at: expiresAt, type: 'regular' },
  };
}

async function webhook(message: ReturnType<typeof event>, trusted = true) {
  const payload = JSON.stringify(message, null, 2);
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
    TRIBUTE_API_KEY: oldConfig.key, TRIBUTE_SUBSCRIPTION_ID: oldConfig.offer, TRIBUTE_VERIFIED_ACCESS: oldConfig.active,
  }));

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
});
