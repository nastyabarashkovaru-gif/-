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
import { PAYMENT_CONFIRMED_APP_TEXT } from './templates';
import { tributeOfferIds } from './tributeOffer';

const tariffIds = { monthly: 'm1', quarterly: 'm3', halfyearly: 'm6' } as const;
const subscriptionNames = z.enum(['new_subscription', 'renewed_subscription', 'cancelled_subscription']);
const webhookEnvelope = z.object({ name: z.string().optional(), test: z.unknown() });
const subscriptionEvent = z.object({
  name: subscriptionNames,
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
const offerList = z.object({ result: z.array(z.object({
  subscriptionId: z.number().int().safe().positive(),
  currency: z.string(),
  periods: z.array(z.object({ period: z.string(), price: z.number() })),
})) });

function tariffForPeriod(period: string) {
  return Object.hasOwn(tariffIds, period) ? tariffIds[period as keyof typeof tariffIds] : undefined;
}

async function closeExpired(tx: Tx, userId: bigint, now: Date) {
  const subscription = await tx.subscription.findFirst({
    where: { userId, tributeExpiresAt: { not: null }, status: { in: [...LIVE_STATUSES] } },
    select: { id: true, tributeExpiresAt: true },
  });
  if (!subscription) return;
  await tx.subscription.update({
    where: { id: subscription.id },
    data: { status: 'expired', autoRenew: false, cancelReason: 'tribute_expired', ...(subscription.tributeExpiresAt! > now ? { tributeExpiresAt: now } : {}) },
  });
  await tx.flowMembership.updateMany({
    where: { subscriptionId: subscription.id, status: { in: ['reserved', 'registered', 'active'] } },
    data: { status: 'revoked' },
  });
}

export async function expireTributeFor(userId: bigint) {
  const now = clock.now();
  const expired = await prisma.subscription.findFirst({
    where: { userId, tributeExpiresAt: { lte: now }, status: { in: [...LIVE_STATUSES] } },
    select: { id: true },
  });
  if (expired) {
    const tz = await getSetting('flow.timezone');
    await serializable((tx) => refreshEntitlement(tx, userId, now, tz));
  }
}

async function applyEntitlement(tx: Tx, entitlement: TributeEntitlement, now: Date, tz: string) {
  const { userId, tariffId, expiresAt, autoRenew } = entitlement;
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
  const { userId, offerId } = values;
  await tx.tributeEntitlement.upsert({ where: { userId_offerId: { userId, offerId } }, create: values, update: values });
  return refreshEntitlement(tx, userId, now, tz);
}

async function refreshEntitlement(tx: Tx, userId: bigint, now: Date, tz: string) {
  // Tariff IDs m6, m3 and m1 sort in order of the access they grant. On expiry, fall back to the next paid offer.
  const entitlement = await tx.tributeEntitlement.findFirst({
    where: { userId, expiresAt: { gt: now } },
    orderBy: [{ tariffId: 'desc' }, { expiresAt: 'desc' }, { offerId: 'asc' }],
  });
  if (!entitlement) {
    await closeExpired(tx, userId, now);
    return 'expired';
  }
  const status = await applyEntitlement(tx, entitlement, now, tz);
  const pending = status === 'other_subscription';
  await tx.tributeEntitlement.updateMany({ where: { userId, pending: !pending }, data: { pending } });
  return status;
}

export async function receiveTributeWebhook(body: Buffer, signature: unknown) {
  const key = config.TRIBUTE_API_KEY;
  const offerIds = tributeOfferIds();
  if (!key || !offerIds.length || config.DEMO_MODE) throw new HttpError(503, 'tribute_not_configured');
  const expected = createHmac('sha256', key).update(body).digest();
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature) || !timingSafeEqual(Buffer.from(signature, 'hex'), expected)) {
    throw new HttpError(401, 'bad_signature');
  }
  const raw = body.toString('utf8');
  if (/^(?:ping|test)?$/i.test(raw.trim())) return { ok: true, status: 'test' };
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    console.warn('[tribute] signed webhook was not valid JSON');
    throw new HttpError(400, 'bad_json');
  }
  const envelope = webhookEnvelope.safeParse(message);
  if (envelope.success) {
    if (envelope.data.test === true || !envelope.data.name) return { ok: true, status: 'test' };
    if (!subscriptionNames.safeParse(envelope.data.name).success) return { ok: true, status: 'ignored' };
  }
  const parsed = subscriptionEvent.safeParse(message);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.') || 'body').join(', ');
    console.warn(`[tribute] signed webhook did not match subscription fields: ${fields}`);
    throw new HttpError(400, 'invalid_tribute_event');
  }
  const { payload, name, created_at } = parsed.data;
  const offerId = String(payload.subscription_id);
  const tariffId = tariffForPeriod(payload.period);
  if (!tariffId || !payload.telegram_user_id || payload.type !== 'regular' || !offerIds.includes(offerId)) {
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
    const prior = await tx.tributeEntitlement.findUnique({ where: { userId_offerId: { userId, offerId } } });
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
        chat_id: Number(userId), text: PAYMENT_CONFIRMED_APP_TEXT,
        reply_markup: { inline_keyboard: [[openAppButton('Открыть приложение')]] },
      }).catch(() => console.warn('[tribute] could not send the app button'));
    }
  }
  return { ok: true, status };
}

async function getTributeSubscribers(key: string, offerId: string) {
  const url = new URL('https://tribute.tg/api/v1/subscribers');
  url.searchParams.set('subscriptionID', offerId);
  const response = await fetch(url, { headers: { 'Api-Key': key }, signal: AbortSignal.timeout(12_000), redirect: 'error' });
  if (!response.ok) throw new HttpError(response.status, 'tribute_subscribers_http', `Tribute subscriber list returned HTTP ${response.status}`);
  const list = subscriberList.safeParse(await response.json());
  if (!list.success) throw new Error('Tribute subscriber list format changed');
  return list.data.result;
}

/** Read-only verification of the configured offer and migration coverage. */
export async function checkTributeReadiness() {
  const key = config.TRIBUTE_API_KEY;
  const [offerId] = tributeOfferIds();
  if (!key || !offerId || config.DEMO_MODE) return;
  const now = clock.now();
  const [offers, subscribers, legacy] = await Promise.allSettled([
    (async () => {
      const response = await fetch('https://tribute.tg/api/v1/subscriptions', { headers: { 'Api-Key': key }, signal: AbortSignal.timeout(12_000), redirect: 'error' });
      if (!response.ok) return { http: response.status };
      const body = offerList.safeParse(await response.json());
      if (!body.success) return { http: response.status, valid: false };
      const offer = body.data.result.find((item) => String(item.subscriptionId) === offerId);
      return { http: response.status, found: Boolean(offer), currency: offer?.currency, periods: offer?.periods };
    })(),
    getTributeSubscribers(key, offerId),
    prisma.subscription.findMany({
      where: { priceVariant: 'tribute', tributeExpiresAt: null, status: { in: [...LIVE_STATUSES] }, test: false },
      select: { userId: true },
    }),
  ]);
  const active = subscribers.status === 'fulfilled' ? subscribers.value.filter((item) => String(item.subscriptionId) === offerId && new Date(item.expireAt) > now) : null;
  const verifiedUsers = active && new Set(active.filter((item) => item.telegramUserId && tariffForPeriod(item.period)).map((item) => String(item.telegramUserId)));
  return {
    offerId,
    offer: offers.status === 'fulfilled' ? offers.value : { available: false },
    subscriberList: subscribers.status === 'fulfilled' ? { available: true }
      : { available: false, http: subscribers.reason instanceof HttpError ? subscribers.reason.status : undefined },
    activeSubscriptions: active?.length,
    verifiedSubscribers: verifiedUsers?.size,
    withoutTelegram: active?.filter((item) => !item.telegramUserId).length,
    legacySubscriptions: legacy.status === 'fulfilled' ? legacy.value.length : undefined,
    legacyMatched: verifiedUsers && legacy.status === 'fulfilled' ? legacy.value.filter((item) => verifiedUsers.has(String(item.userId))).length : undefined,
  };
}

/** Enable only after verifying that Tribute exposes the customer list to this API key. */
export async function reconcileTributeSubscribers() {
  const { TRIBUTE_API_KEY: key, TRIBUTE_SUBSCRIBER_SYNC: enabled } = config;
  const offerIds = tributeOfferIds();
  if (!enabled || !key || !offerIds.length || config.DEMO_MODE) return;
  const snapshotAt = clock.now();
  const snapshots = await Promise.allSettled(offerIds.map((id) => getTributeSubscribers(key, id)));
  const tz = await getSetting('flow.timezone');
  const matched = new Set<bigint>();
  for (const [index, snapshot] of snapshots.entries()) {
    const offerId = offerIds[index];
    if (snapshot.status === 'rejected') {
      console.warn(`[tribute] subscriber snapshot unavailable for offer ${offerId}`);
      continue;
    }
    const newest = new Map<number, (typeof snapshot.value)[number]>();
    for (const item of snapshot.value) {
      if (!item.telegramUserId || String(item.subscriptionId) !== offerId || !tariffForPeriod(item.period) || new Date(item.expireAt) <= snapshotAt) continue;
      const prior = newest.get(item.telegramUserId);
      if (!prior || new Date(item.activatedAt) > new Date(prior.activatedAt)) newest.set(item.telegramUserId, item);
    }
    for (const [telegramId, item] of newest) {
      const userId = BigInt(telegramId);
      const expiresAt = new Date(item.expireAt);
      const status = await serializable(async (tx) => {
        const prior = await tx.tributeEntitlement.findUnique({ where: { userId_offerId: { userId, offerId } } });
        if (prior && (prior.eventAt >= snapshotAt || prior.expiresAt >= expiresAt)) return 'already_recorded';
        return recordEntitlement(tx, {
          userId, offerId, tariffId: tariffForPeriod(item.period)!, expiresAt, eventAt: snapshotAt, autoRenew: item.status === 'active',
        }, snapshotAt, tz);
      });
      if (status === 'applied') matched.add(userId);
    }
  }
  if (matched.size) console.log(`[tribute] restored verified access for ${matched.size} subscribers`);
}

export async function maintainVerifiedTribute() {
  if (!tributeOfferIds().length && !config.TRIBUTE_VERIFIED_ACCESS) return;
  const now = clock.now();
  const [expired, pending] = await Promise.all([
    prisma.subscription.findMany({ where: { tributeExpiresAt: { lte: now }, status: { in: [...LIVE_STATUSES] } }, select: { userId: true } }),
    prisma.tributeEntitlement.findMany({ where: { pending: true, expiresAt: { gt: now } }, select: { userId: true } }),
  ]);
  const users = new Set([...expired, ...pending].map((row) => row.userId));
  if (!users.size) return;
  const tz = await getSetting('flow.timezone');
  for (const userId of users) await serializable((tx) => refreshEntitlement(tx, userId, now, tz));
}
