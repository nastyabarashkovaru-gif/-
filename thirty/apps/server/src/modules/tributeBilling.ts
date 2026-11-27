import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { localDate, startOfMonth, toDbDate } from '@thirty/domain';
import type { TributeEntitlement } from '@prisma/client';
import { z } from 'zod';
import { clock } from '../clock';
import { config } from '../config';
import { prisma, serializable, type Tx } from '../db';
import { HttpError } from '../http';
import { getSetting } from '../settings';
import { openAppButton, tg } from '../lib/telegram';
import { LIVE_STATUSES } from './billing';
import { ensureFlow, memberWindow } from './flows';

const tariffIds = { monthly: 'm1', quarterly: 'm3', halfyearly: 'm6' } as const;
const subscriptionEvent = z.object({
  name: z.enum(['new_subscription', 'renewed_subscription', 'cancelled_subscription']),
  created_at: z.string().datetime({ offset: true }),
  payload: z.object({
    subscription_id: z.number().int().safe().positive(),
    telegram_user_id: z.number().int().safe().nonnegative(),
    period: z.string(),
    expires_at: z.string().datetime({ offset: true }),
    type: z.string(),
  }),
});
const subscriberList = z.object({ result: z.array(z.object({
  subscriptionId: z.number().int().safe().positive(),
  telegramUserId: z.number().int().safe().nonnegative(),
  status: z.enum(['active', 'pre_cancelled', 'cancelled']),
  activatedAt: z.string().datetime({ offset: true }),
  expireAt: z.string().datetime({ offset: true }),
  period: z.string(),
})) });

function tariffForPeriod(period: string) {
  return Object.hasOwn(tariffIds, period) ? tariffIds[period as keyof typeof tariffIds] : undefined;
}

async function closeExpired(tx: Tx, now: Date, userId?: bigint) {
  const rows = await tx.subscription.findMany({
    where: { userId, tributeExpiresAt: { lte: now }, status: { in: [...LIVE_STATUSES] } },
    select: { id: true },
  });
  const ids = rows.map((row) => row.id);
  if (!ids.length) return;
  await tx.subscription.updateMany({
    where: { id: { in: ids } },
    data: { status: 'expired', autoRenew: false, cancelReason: 'tribute_expired' },
  });
  await tx.flowMembership.updateMany({
    where: { subscriptionId: { in: ids }, status: { in: ['reserved', 'registered', 'active'] } },
    data: { status: 'revoked' },
  });
}

export async function expireTributeFor(userId: bigint) {
  const now = clock.now();
  const expired = await prisma.subscription.findFirst({
    where: { userId, tributeExpiresAt: { lte: now }, status: { in: [...LIVE_STATUSES] } },
    select: { id: true },
  });
  if (expired) await serializable((tx) => closeExpired(tx, now, userId));
}

async function applyEntitlement(tx: Tx, entitlement: TributeEntitlement, now: Date, tz: string) {
  const { userId, tariffId, expiresAt, autoRenew } = entitlement;
  if (expiresAt <= now) {
    await tx.subscription.updateMany({ where: { userId, tributeExpiresAt: { not: null }, status: { in: [...LIVE_STATUSES] } }, data: { tributeExpiresAt: expiresAt } });
    await closeExpired(tx, now, userId);
    return 'expired';
  }
  await closeExpired(tx, now, userId);
  const live = await tx.subscription.findFirst({ where: { userId, status: { in: [...LIVE_STATUSES] } } });
  if (live && live.priceVariant !== 'tribute') return 'other_subscription';
  const user = await tx.user.upsert({
    where: { id: userId },
    create: { id: userId, firstName: 'Участник', createdAt: now, onboardingStage: 'paid' },
    update: {},
  });
  if (user.deletedAt) return 'deleted_account';
  const today = localDate(now, tz);
  const month = startOfMonth(today);
  const lastMonth = startOfMonth(localDate(new Date(expiresAt.getTime() - 1), tz));
  const tariff = await tx.tariff.findUniqueOrThrow({ where: { id: tariffId } });
  const paid = {
    tariffId, tributeExpiresAt: expiresAt, paidThroughFlow: toDbDate(lastMonth), autoRenew,
    status: autoRenew ? 'active' as const : 'canceled_at_period_end' as const,
    canceledAt: autoRenew ? null : entitlement.eventAt,
    cancelReason: autoRenew ? null : 'tribute_cancelled',
  };
  const sub = live
    ? await tx.subscription.update({ where: { id: live.id }, data: paid })
    : await tx.subscription.create({ data: { ...paid, userId, priceVariant: 'tribute', renewalPrice: 0, paidFromFlow: toDbDate(month), providerCustomer: { source: 'tribute' } } });

  const memberships = await tx.flowMembership.findMany({
    where: { userId, status: { in: ['reserved', 'registered', 'active'] } }, include: { flow: true },
  });
  const current = memberships.filter((m) => memberWindow(m, now).phase !== 'finished');
  if (current.length) {
    await tx.flowMembership.updateMany({
      where: { id: { in: current.map((m) => m.id) } }, data: { subscriptionId: sub.id, tariffId },
    });
  } else {
    const flow = await ensureFlow(month, tx);
    const previous = await tx.flowMembership.findUnique({ where: { userId_flowId: { userId, flowId: flow.id } }, include: { flow: true } });
    if (!previous) await tx.flowMembership.create({ data: { userId, flowId: flow.id, subscriptionId: sub.id, tariffId } });
    else if (previous.status === 'revoked') {
      const phase = memberWindow(previous, now).phase;
      const status = phase === 'finished' ? 'finished' : previous.goalsLockedAt ? (phase === 'active' ? 'active' : 'registered') : 'reserved';
      await tx.flowMembership.update({ where: { id: previous.id }, data: { status, subscriptionId: sub.id, tariffId } });
    } else {
      await tx.flowMembership.update({ where: { id: previous.id }, data: { subscriptionId: sub.id, tariffId } });
    }
  }
  await tx.user.update({
    where: { id: userId },
    data: { ...(user.onboardingStage === 'registered' ? {} : { onboardingStage: 'paid' }), ...(tariff.months >= 6 ? { sixMonthBadge: true } : {}) },
  });
  return 'applied';
}

async function recordEntitlement(tx: Tx, values: Omit<TributeEntitlement, 'pending'>, now: Date, tz: string) {
  const { userId } = values;
  const entitlement = await tx.tributeEntitlement.upsert({ where: { userId }, create: values, update: values });
  const status = await applyEntitlement(tx, entitlement, now, tz);
  await tx.tributeEntitlement.update({ where: { userId }, data: { pending: status === 'other_subscription' } });
  return status;
}

export async function receiveTributeWebhook(body: Buffer, signature: unknown) {
  const key = config.TRIBUTE_API_KEY;
  const offerId = config.TRIBUTE_SUBSCRIPTION_ID;
  if (!key || !/^\d+$/.test(offerId) || config.DEMO_MODE) throw new HttpError(503, 'tribute_not_configured');
  const expected = createHmac('sha256', key).update(body).digest();
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature) || !timingSafeEqual(Buffer.from(signature, 'hex'), expected)) {
    throw new HttpError(401, 'bad_signature');
  }
  let message: unknown;
  try { message = JSON.parse(body.toString('utf8')); } catch { throw new HttpError(400, 'bad_json'); }
  const parsed = subscriptionEvent.safeParse(message);
  if (!parsed.success) {
    const name = z.object({ name: z.string() }).safeParse(message);
    if (name.success && !subscriptionEvent.shape.name.options.some((value) => value === name.data.name)) return { ok: true, status: 'ignored' };
    throw new HttpError(400, 'invalid_tribute_event');
  }
  const { payload, name, created_at } = parsed.data;
  const tariffId = tariffForPeriod(payload.period);
  if (!tariffId || !payload.telegram_user_id || payload.type !== 'regular' || String(payload.subscription_id) !== offerId) {
    return { ok: true, status: 'ignored' };
  }
  const userId = BigInt(payload.telegram_user_id);
  const eventAt = new Date(created_at);
  const expiresAt = new Date(payload.expires_at);
  const autoRenew = name !== 'cancelled_subscription';
  const now = clock.now();
  const tz = await getSetting('flow.timezone');
  const bodyHash = createHash('sha256').update(`tribute:${name}:${userId}:${offerId}:${eventAt.toISOString()}:${expiresAt.toISOString()}:${tariffId}`).digest('hex');

  const status = await serializable(async (tx) => {
    const prior = await tx.tributeEntitlement.findUnique({ where: { userId } });
    if (prior && (prior.eventAt > eventAt || (prior.eventAt.getTime() === eventAt.getTime() && (!prior.autoRenew || autoRenew)))) return 'duplicate_or_old';
    // An explicit cancellation stays active until the paid period ends. A past event cannot shorten a later purchase.
    const result = await recordEntitlement(tx, { userId, offerId, tariffId, expiresAt, eventAt, autoRenew }, now, tz);
    await tx.paymentEvent.upsert({
      where: { bodyHash },
      create: { provider: 'tribute', signatureValid: true, bodyHash, status: result, processedAt: now, payload: { name, tariffId, offerId, userId: userId.toString(), expiresAt: payload.expires_at } },
      update: {},
    });
    return result;
  });
  if (status === 'applied' && name === 'new_subscription') {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { allowsWrite: true, botBlocked: true } });
    if (user?.allowsWrite && !user.botBlocked) {
      void tg('sendMessage', {
        chat_id: Number(userId), text: 'Оплата подтверждена 💜 Твой доступ к «30 дням» уже открыт.',
        reply_markup: { inline_keyboard: [[openAppButton('Открыть приложение')]] },
      }).catch(() => console.warn('[tribute] could not send the app button'));
    }
  }
  return { ok: true, status };
}

/** Enable only after verifying that Tribute exposes the customer list to this API key. */
export async function reconcileTributeSubscribers() {
  const { TRIBUTE_API_KEY: key, TRIBUTE_SUBSCRIPTION_ID: offerId, TRIBUTE_SUBSCRIBER_SYNC: enabled } = config;
  if (!enabled || !key || !/^\d+$/.test(offerId) || config.DEMO_MODE) return;
  const snapshotAt = clock.now();
  const url = new URL('https://tribute.tg/api/v1/subscribers');
  url.searchParams.set('subscriptionID', offerId);
  const response = await fetch(url, { headers: { 'Api-Key': key }, signal: AbortSignal.timeout(12_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Tribute subscriber list returned HTTP ${response.status}`);
  const list = subscriberList.safeParse(await response.json());
  if (!list.success) throw new Error('Tribute subscriber list format changed');
  const newest = new Map<number, (typeof list.data.result)[number]>();
  for (const item of list.data.result) {
    if (!item.telegramUserId || String(item.subscriptionId) !== offerId || !tariffForPeriod(item.period) || new Date(item.expireAt) <= snapshotAt) continue;
    const prior = newest.get(item.telegramUserId);
    if (!prior || new Date(item.activatedAt) > new Date(prior.activatedAt)) newest.set(item.telegramUserId, item);
  }
  const tz = await getSetting('flow.timezone');
  let matched = 0;
  for (const [telegramId, item] of newest) {
    const userId = BigInt(telegramId);
    const expiresAt = new Date(item.expireAt);
    const status = await serializable(async (tx) => {
      const prior = await tx.tributeEntitlement.findUnique({ where: { userId } });
      if (prior && (prior.eventAt >= snapshotAt || prior.expiresAt >= expiresAt)) return 'already_recorded';
      return recordEntitlement(tx, {
        userId, offerId, tariffId: tariffForPeriod(item.period)!, expiresAt, eventAt: snapshotAt, autoRenew: item.status === 'active',
      }, snapshotAt, tz);
    });
    if (status === 'applied') matched++;
  }
  if (matched) console.log(`[tribute] restored verified access for ${matched} subscribers`);
}

export async function maintainVerifiedTribute() {
  if (!config.TRIBUTE_SUBSCRIPTION_ID && !config.TRIBUTE_VERIFIED_ACCESS) return;
  const now = clock.now();
  await serializable((tx) => closeExpired(tx, now));
  const pending = await prisma.tributeEntitlement.findMany({ where: { pending: true, expiresAt: { gt: now } }, orderBy: { eventAt: 'asc' } });
  if (!pending.length) return;
  const tz = await getSetting('flow.timezone');
  for (const row of pending) {
    await serializable(async (tx) => {
      const current = await tx.tributeEntitlement.findUnique({ where: { userId: row.userId } });
      if (!current?.pending) return;
      const status = await applyEntitlement(tx, current, now, tz);
      if (status !== 'other_subscription') await tx.tributeEntitlement.update({ where: { userId: row.userId }, data: { pending: false } });
    });
  }
}
