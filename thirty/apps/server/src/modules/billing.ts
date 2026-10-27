import { createHash } from 'node:crypto';
import {
  addMonths, chargeDateFor, coverage, fromDbDate, humanDate, localDate, offerActive, offerMsLeft, planPurchase, planRenewal, quote,
  subscriptionStatusOn, toDbDate, type ISODate,
} from '@thirty/domain';
import type { Payment, Prisma, Subscription, Tariff } from '@prisma/client';
import { clock } from '../clock';
import { config } from '../config';
import { prisma, serializable, isUniqueViolation, type Tx } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../http';
import { getSetting } from '../settings';
import { paymentProvider } from '../payments';
import type { ParsedWebhook, SubscriptionRef } from '../payments/types';
import { ensureFlow } from './flows';
import { redeemOnPayment } from './promos';
import { track } from './analytics';
import { notify } from './notify';
import { registerBotConversion } from './bot';

export const LIVE_STATUSES = ['prestart', 'active', 'past_due', 'canceled_at_period_end'] as const;

// ───────────── Персональное предложение (таймер 3 часа) ─────────────

/** Таймер стартует один раз при первом показе тарифов и хранится на сервере; повторное открытие его не сбрасывает */
export async function startOffer(userId: bigint) {
  const minutes = await getSetting('offer.durationMinutes');
  const now = clock.now();
  try {
    return await prisma.priceOffer.create({ data: { userId, kind: 'intro', startedAt: now, expiresAt: new Date(now.getTime() + minutes * 60_000) } });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return prisma.priceOffer.findUniqueOrThrow({ where: { userId_kind: { userId, kind: 'intro' } } });
  }
}

/** Действующее окно цены: вводное или восстановленное по реферальной механике */
export async function currentOffer(userId: bigint) {
  const offers = await prisma.priceOffer.findMany({ where: { userId } });
  const now = clock.now();
  // Таймер первых 3 часов важнее окна промокода (цены одинаковые, но таймер честнее показывает срок)
  const active = offers.filter((o) => offerActive(o, now)).sort((a, b) => (a.kind === 'intro' ? -1 : b.kind === 'intro' ? 1 : 0))[0];
  const intro = offers.find((o) => o.kind === 'intro') ?? null;
  return { active: active ?? null, intro, msLeft: offerMsLeft(active, now), started: Boolean(intro) };
}

export function tariffView(t: Tariff, promo: boolean) {
  const q = quote(t, promo);
  const promoQ = quote(t, true);
  return {
    id: t.id,
    title: t.title,
    months: t.months,
    goalLimit: t.goalLimit,
    features: t.features as string[],
    highlighted: t.highlighted,
    badge: t.badge,
    price: q.price,
    variant: q.variant,
    promoPrice: promoQ.price,
    regularPrice: t.regularPrice,
    comparison: q.comparison,
    comparisonLabel: `стоимость ${t.months} ${t.months === 1 ? 'отдельного месяца' : 'отдельных месяцев'}`,
    savingsPercent: q.savingsPercent,
    perMonth: q.perMonth,
    // Продление — по той же цене, по которой куплен первый период (решение владельца)
    renewalPrice: q.price,
  };
}

export async function offerState(userId: bigint) {
  const tariffs = await prisma.tariff.findMany({ where: { active: true }, orderBy: [{ sort: 'asc' }, { months: 'asc' }] });
  const o = await currentOffer(userId);
  const promo = Boolean(o.active);
  return {
    offer: { started: o.started, active: promo, expiresAt: o.active?.expiresAt ?? o.intro?.expiresAt ?? null, msLeft: o.msLeft, kind: o.active?.kind ?? null, promoCode: o.active?.promoId ? (await prisma.promo.findUnique({ where: { id: o.active.promoId } }))?.code ?? null : null },
    tariffs: tariffs.map((t) => tariffView(t, promo)),
  };
}

// ───────────── Checkout ─────────────

/** Перед оплатой — две галочки (решение владельца 25.10): оферта (включает правила клуба, 18+, публичность отчётов, автопродление) и персональные данные */
export const REQUIRED_CONSENTS = ['personal_data', 'offer'] as const;

/** Детали платежа для экрана S07: какие потоки, когда следующее списание и на какую сумму */
export async function checkoutPreview(userId: bigint, tariffId: string) {
  const tariff = await prisma.tariff.findUnique({ where: { id: tariffId } });
  if (!tariff || !tariff.active) throw notFound('tariff_not_found');
  const tz = await getSetting('flow.timezone');
  const plan = planPurchase({ now: clock.now(), tz, months: tariff.months, lateJoinUntilDay: await getSetting('flow.lateJoinUntilDay') });
  const o = await currentOffer(userId);
  const view = tariffView(tariff, Boolean(o.active));
  return {
    tariff: view,
    offer: { active: Boolean(o.active), msLeft: o.msLeft },
    flows: plan.flows.map((f) => ({ startsOn: f, title: monthName(f) })),
    startsOn: plan.firstFlow,
    paidUntil: fromDbDateEnd(plan.lastFlow),
    nextCharge: { date: plan.chargeDate, amount: view.price, covers: plan.renewalFlows.map(monthName) },
    text: {
      today: `Сегодня спишем ${view.price.toLocaleString('ru-RU')} ₽ за ${tariff.months === 1 ? 'поток' : `${tariff.months} потока подряд`}: ${plan.flows.map(monthName).join(', ')}.`,
      renewal: `Автопродление: ${humanDate(plan.chargeDate, true)} спишем ${view.price.toLocaleString('ru-RU')} ₽ за следующие ${tariff.months === 1 ? 'месяц' : `${tariff.months} ${tariff.months < 5 ? 'месяца' : 'месяцев'}`} (${plan.renewalFlows.map(monthName).join(', ')}). Отключить можно в любой момент до этой даты через поддержку.`,
    },
  };
}

function monthName(iso: ISODate) {
  const names = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  return `${names[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}
function fromDbDateEnd(lastFlow: ISODate) {
  return addMonths(lastFlow, 1);
}

/**
 * Создание платежа. Повторное нажатие «Оплатить» с тем же ключом возвращает ту же ссылку.
 * Цена фиксируется в ссылке; ссылка на акционную цену истекает вместе с таймером.
 */
export async function createCheckout(userId: bigint, tariffId: string, idempotencyKey: string) {
  const tariff = await prisma.tariff.findUnique({ where: { id: tariffId } });
  if (!tariff || !tariff.active) throw notFound('tariff_not_found');
  const consents = await prisma.consent.findMany({ where: { userId, revokedAt: null, granted: true, context: null } });
  const have = new Set(consents.map((c) => c.kind));
  const missing = REQUIRED_CONSENTS.filter((k) => !have.has(k));
  if (missing.length) throw badRequest('consents_required', 'Подтвердите согласия перед оплатой', { missing });
  const live = await prisma.subscription.findFirst({ where: { userId, status: { in: [...LIVE_STATUSES] } } });
  if (live) throw conflict('already_subscribed', 'У вас уже есть действующая подписка');

  const key = `checkout:${userId}:${idempotencyKey}`;
  const existing = await prisma.payment.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    if (existing.tariffId !== tariffId) throw conflict('idempotency_mismatch');
    return { paymentId: existing.id, url: existing.paymentUrl!, amount: existing.amount };
  }

  const o = await currentOffer(userId);
  const promo = Boolean(o.active);
  const q = quote(tariff, promo);
  const tz = await getSetting('flow.timezone');
  const plan = planPurchase({ now: clock.now(), tz, months: tariff.months, lateJoinUntilDay: await getSetting('flow.lateJoinUntilDay') });

  const payment = await prisma.payment.create({
    data: {
      userId,
      kind: 'initial',
      tariffId,
      priceVariant: q.variant,
      amount: q.price,
      coversFromFlow: toDbDate(plan.firstFlow),
      months: tariff.months,
      idempotencyKey: key,
      status: 'initiated',
      provider: paymentProvider().name,
    },
  });
  const { url } = await paymentProvider().createPayment({
    paymentId: payment.id,
    amount: q.price,
    title: `30 дней — ${tariff.title}`,
    providerSubscriptionId: null,
    userId: userId.toString(),
    linkExpiresAt: promo && o.active ? new Date(o.active.expiresAt.getTime() + 15 * 60_000) : new Date(clock.now().getTime() + 24 * 3600_000),
    successUrl: appUrl(`pay_${payment.id}`),
    returnUrl: appUrl(`pay_${payment.id}`),
    notificationUrl: `${config.PUBLIC_URL}/api/payments/${paymentProvider().name}/webhook`,
  });
  await prisma.payment.update({ where: { id: payment.id }, data: { paymentUrl: url, status: 'pending' } });
  await prisma.user.update({ where: { id: userId }, data: { onboardingStage: 'checkout' } });
  await track({ userId, eventName: 'payment_start', screenId: 'S07', tariffId, metadata: { amount: q.price, variant: q.variant, paymentId: payment.id } });
  return { paymentId: payment.id, url, amount: q.price };
}

export function appUrl(startParam: string) {
  const bot = config.BOT_USERNAME || 'bot';
  return `https://t.me/${bot}/${config.APP_SHORT_NAME}?startapp=${encodeURIComponent(startParam)}`;
}

// ───────────── Webhook ─────────────

/**
 * Единая точка обработки уведомлений провайдера. Доступ выдаётся только здесь (не по redirect клиента).
 * Повторный webhook отсекается по хэшу тела и по уникальному id операции провайдера.
 */
export async function handleWebhook(parsed: ParsedWebhook, rawBody: string) {
  const bodyHash = createHash('sha256').update(rawBody).digest('hex');
  let event;
  try {
    event = await prisma.paymentEvent.create({
      data: { provider: paymentProvider().name, bodyHash, signatureValid: parsed.valid, status: parsed.status, payload: parsed.raw as object, paymentId: null },
    });
  } catch (e) {
    if (isUniqueViolation(e)) return { duplicate: true };
    throw e;
  }
  if (!parsed.valid) {
    await prisma.paymentEvent.update({ where: { id: event.id }, data: { error: 'bad_signature', processedAt: clock.now() } });
    return { rejected: 'bad_signature' };
  }
  // Уведомления по другим продуктам магазина (не «30 дней») — пропускаем с ответом 200, чтобы провайдер не повторял
  if (!(await isOurEvent(parsed))) {
    await prisma.paymentEvent.update({ where: { id: event.id }, data: { processedAt: clock.now(), error: 'foreign_event_ignored' } });
    return { ignored: 'foreign' };
  }
  try {
    let result: unknown;
    if (parsed.kind === 'payment' && parsed.paymentId) result = await handlePaymentEvent(parsed, event.id);
    else if (parsed.kind === 'renewal') result = await handleRenewalEvent(parsed);
    else if (parsed.kind === 'subscription_status') result = await handleSubscriptionStatus(parsed);
    else result = { ignored: true };
    await prisma.paymentEvent.update({ where: { id: event.id }, data: { processedAt: clock.now() } });
    return result;
  } catch (e) {
    await prisma.paymentEvent.update({ where: { id: event.id }, data: { error: (e as Error).message.slice(0, 500) } });
    throw e;
  }
}

/** Событие относится к «30 дням»: наш номер заказа или подписка одного из наших тарифов / уже известная подписка */
async function isOurEvent(p: ParsedWebhook): Promise<boolean> {
  if (p.customer.accountId && /^\d+$/.test(p.customer.accountId) && (await prisma.subscription.findFirst({ where: { userId: BigInt(p.customer.accountId) } }))) return true;
  if (p.paymentId && (await prisma.payment.findUnique({ where: { id: p.paymentId } }).catch(() => null))) return true;
  if (p.providerSubscriptionId) {
    const known = await prisma.subscription.findFirst({ where: { providerSubscriptionId: p.providerSubscriptionId } });
    if (known) return true;
  }
  return false;
}

async function handlePaymentEvent(p: ParsedWebhook, eventId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: p.paymentId! } });
  if (!payment) throw new Error(`payment ${p.paymentId} not found`);
  await prisma.paymentEvent.update({ where: { id: eventId }, data: { paymentId: payment.id } });
  if (p.status === 'paid') {
    if (p.amount !== null && p.amount !== payment.amount) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'disputed', failureReason: `amount_mismatch:${p.amount}` } });
      return { disputed: 'amount_mismatch' };
    }
    if (payment.kind === 'debt') return markDebtPaid(payment, p);
    if (payment.kind === 'upsell') {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'paid', paidAt: clock.now(), providerOrderId: p.providerOrderId } });
      await track({ userId: payment.userId, eventName: 'upsell_purchase', metadata: { code: payment.upsellCode } });
      return { upsell: true };
    }
    return markInitialPaid(payment, p);
  }
  if (p.status === 'refunded') return markRefunded(payment.id, 'provider');
  if (p.status === 'failed' || p.status === 'canceled') {
    if (payment.status === 'paid') return { ignored: 'already_paid' };
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed', failureReason: p.status } });
    await track({ userId: payment.userId, eventName: 'payment_failed', tariffId: payment.tariffId ?? undefined, metadata: { paymentId: payment.id, reason: p.status } });
    return { failed: true };
  }
  return { ignored: p.status };
}

/** Отменённое участие снова действует: старая анкета удаляется, заполняется заново */
export async function reviveMembership(tx: Prisma.TransactionClient, membershipId: string, subscriptionId: string, tariffId: string) {
  await tx.goal.deleteMany({ where: { membershipId } });
  await tx.flowMembership.update({ where: { id: membershipId }, data: { status: 'reserved', subscriptionId, tariffId, goalsLockedAt: null, registeredAt: null, finalSubmittedAt: null } });
}

/** Первичная оплата: подписка + членство во всех оплаченных потоках, одной транзакцией */
async function markInitialPaid(payment: Payment, p: ParsedWebhook) {
  if (payment.status === 'paid') return { alreadyPaid: true };
  const tariff = await prisma.tariff.findUniqueOrThrow({ where: { id: payment.tariffId! } });
  const firstFlow = fromDbDate(payment.coversFromFlow!);
  const flows = coverage(firstFlow, payment.months!);
  const lastFlow = flows[flows.length - 1];
  const now = clock.now();
  const tz = await getSetting('flow.timezone');
  // План от фактической даты оплаты; потоки фиксируются по моменту создания ссылки
  const paidOn = localDate(now, tz);
  const target = chargeDateFor(lastFlow);
  const natural = addMonths(paidOn, payment.months!);
  const chargeDate = natural <= target ? target : (p.nextChargeDate ?? natural);
  const needsShift = chargeDate !== (p.nextChargeDate ?? natural);

  const outcome = await serializable(async (tx) => {
    const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (fresh.status === 'paid') return { alreadyPaid: true as const };
    const live = await tx.subscription.findFirst({ where: { userId: payment.userId, status: { in: [...LIVE_STATUSES] } } });
    if (live) {
      // Вторая оплата при живой подписке: деньги приняты, доступ не дублируется, нужен возврат
      await tx.payment.update({ where: { id: payment.id }, data: { status: 'paid', paidAt: now, providerOrderId: p.providerOrderId, needsRefund: true } });
      return { duplicate: true as const };
    }
    const sub = await tx.subscription.create({
      data: {
        userId: payment.userId,
        tariffId: tariff.id,
        status: subscriptionStatusOn({ today: paidOn, paidFromFlow: firstFlow, paidThroughFlow: lastFlow, autoRenew: true, nextChargeDate: chargeDate }),
        renewalPrice: payment.amount,
        priceVariant: payment.priceVariant ?? 'promo',
        paidFromFlow: toDbDate(firstFlow),
        paidThroughFlow: toDbDate(lastFlow),
        nextChargeDate: toDbDate(chargeDate),
        providerSubscriptionId: p.providerSubscriptionId,
        providerCustomer: p.customer,
      },
    });
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'paid', paidAt: now, providerOrderId: p.providerOrderId, subscriptionId: sub.id } });
    for (const f of flows) {
      const flow = await ensureFlow(f, tx);
      const existing = await tx.flowMembership.findUnique({ where: { userId_flowId: { userId: payment.userId, flowId: flow.id } } });
      // Повторная покупка после возврата/отмены: прежнее участие в потоке начинается заново
      if (existing?.status === 'revoked') await reviveMembership(tx, existing.id, sub.id, tariff.id);
      else if (!existing) await tx.flowMembership.create({ data: { userId: payment.userId, flowId: flow.id, subscriptionId: sub.id, tariffId: tariff.id } });
    }
    await tx.billingSchedule.create({
      data: { subscriptionId: sub.id, dueDate: toDbDate(chargeDate), coversFromFlow: toDbDate(addMonths(lastFlow, 1)), months: tariff.months, amount: payment.amount },
    });
    await redeemOnPayment(tx, payment.userId, payment.id, now);
    await tx.priceOffer.updateMany({ where: { userId: payment.userId, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    await tx.user.update({ where: { id: payment.userId }, data: { onboardingStage: 'paid', ...(tariff.months >= 6 ? { sixMonthBadge: true } : {}) } });
    return { subscription: sub };
  });

  if ('duplicate' in outcome) {
    await notify(payment.userId, 'payment_duplicate', {}, `dup:${payment.id}`);
    return outcome;
  }
  if ('alreadyPaid' in outcome) return outcome;
  const sub = outcome.subscription;
  if (needsShift && sub.providerSubscriptionId) await syncChargeDate(sub.id);
  await registerBotConversion(payment.userId);
  await track({ userId: payment.userId, eventName: 'payment_success', screenId: 'S09', tariffId: tariff.id, metadata: { amount: payment.amount, paymentId: payment.id }, dedupeKey: `payment_success:${payment.id}` });
  await notify(
    payment.userId,
    'payment_success',
    { tariff: tariff.title, flows: flows.map(monthName).join(', '), next_date: humanDate(chargeDate, true), next_amount: payment.amount },
    `payment_success:${payment.id}`,
  );
  return { subscriptionId: sub.id };
}

function refOf(sub: Subscription): SubscriptionRef | null {
  if (!sub.providerSubscriptionId) return null;
  return { providerSubscriptionId: sub.providerSubscriptionId, customer: (sub.providerCustomer ?? {}) as SubscriptionRef['customer'] };
}

/** Перенос даты следующего списания у провайдера (на 28-е); при ошибке задача повторит попытку */
export async function syncChargeDate(subscriptionId: string) {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  const ref = refOf(sub);
  if (!ref || !sub.nextChargeDate || !sub.autoRenew || sub.providerLocked) return;
  const date = fromDbDate(sub.nextChargeDate);
  try {
    await paymentProvider().setNextChargeDate(ref, date, sub.renewalPrice);
    await prisma.billingSchedule.updateMany({ where: { subscriptionId, dueDate: sub.nextChargeDate, status: 'scheduled' }, data: { status: 'synced', providerSyncedAt: clock.now(), syncError: null } });
  } catch (e) {
    await prisma.billingSchedule.updateMany({ where: { subscriptionId, dueDate: sub.nextChargeDate }, data: { syncError: (e as Error).message.slice(0, 300) } });
  }
}

async function findSubscriptionForEvent(p: ParsedWebhook) {
  if (!p.providerSubscriptionId) return null;
  const subs = await prisma.subscription.findMany({ where: { providerSubscriptionId: p.providerSubscriptionId }, include: { tariff: true }, orderBy: { createdAt: 'desc' } });
  // CloudPayments: у каждого покупателя своя подписка; если её id ещё не известен — привязываем по AccountId (tg id)
  if (!subs.length && p.customer.accountId && /^\d+$/.test(p.customer.accountId)) {
    const sub = await prisma.subscription.findFirst({ where: { userId: BigInt(p.customer.accountId), providerSubscriptionId: null, status: { in: [...LIVE_STATUSES] } }, include: { tariff: true }, orderBy: { createdAt: 'desc' } });
    if (sub) {
      const linked = await prisma.subscription.update({ where: { id: sub.id }, data: { providerSubscriptionId: p.providerSubscriptionId, providerCustomer: { ...(sub.providerCustomer as object), ...p.customer } }, include: { tariff: true } });
      await syncChargeDate(linked.id);
      return linked;
    }
  }
  if (subs.length <= 1) return subs[0] ?? null;
  // id подписки в кабинете общий для всех покупателей тарифа — различаем по контактам и tg-id
  const tg = String(p.raw.customer_extra ?? '').replace(/^tg:/, '');
  return (
    subs.find((s) => s.userId.toString() === tg) ??
    subs.find((s) => {
      const c = s.providerCustomer as { phone?: string; email?: string };
      return (p.customer.phone && c.phone === p.customer.phone) || (p.customer.email && c.email === p.customer.email);
    }) ??
    null
  );
}

/** Автоплатёж: успешный → продление на следующие N потоков; неуспешный → past_due и уведомление */
async function handleRenewalEvent(p: ParsedWebhook) {
  const sub = await findSubscriptionForEvent(p);
  if (!sub) throw new Error('subscription_for_renewal_not_found');
  const orderKey = p.providerOrderId ?? `${sub.id}:${p.nextChargeDate ?? clock.now().toISOString().slice(0, 10)}`;
  if (p.status !== 'paid') {
    try {
      await prisma.payment.create({
        data: { userId: sub.userId, subscriptionId: sub.id, kind: 'renewal', tariffId: sub.tariffId, amount: p.amount ?? sub.renewalPrice, status: 'failed', failureReason: p.status, idempotencyKey: `renewal-failed:${orderKey}`, providerOrderId: p.providerOrderId ? `failed:${p.providerOrderId}` : undefined },
      });
    } catch (e) {
      if (isUniqueViolation(e)) return { duplicate: true };
      throw e;
    }
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'past_due' } });
    await track({ userId: sub.userId, eventName: 'subscription_renewal_failed', tariffId: sub.tariffId });
    await notify(sub.userId, 'renewal_failed', { amount: sub.renewalPrice }, `renewal_failed:${orderKey}`);
    return { renewalFailed: true };
  }
  return extendSubscription(sub, { amount: p.amount ?? sub.renewalPrice, providerOrderId: p.providerOrderId, idempotencyKey: `renewal:${orderKey}`, kind: 'renewal', nextChargeFromProvider: p.nextChargeDate });
}

async function extendSubscription(
  sub: Subscription & { tariff: Tariff },
  pay: { amount: number; providerOrderId: string | null; idempotencyKey: string; kind: 'renewal' | 'debt'; paymentId?: string; nextChargeFromProvider?: string | null },
) {
  const plan = planRenewal(fromDbDate(sub.paidThroughFlow), sub.tariff.months);
  const now = clock.now();
  const res = await serializable(async (tx) => {
    let paymentId = pay.paymentId;
    if (paymentId) {
      const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      if (p.status === 'paid') return { duplicate: true as const };
      await tx.payment.update({ where: { id: paymentId }, data: { status: 'paid', paidAt: now, providerOrderId: pay.providerOrderId, coversFromFlow: toDbDate(plan.flows[0]), months: plan.flows.length } });
    } else {
      const existing = await tx.payment.findUnique({ where: { idempotencyKey: pay.idempotencyKey } });
      if (existing) return { duplicate: true as const };
      const created = await tx.payment.create({
        data: { userId: sub.userId, subscriptionId: sub.id, kind: pay.kind, tariffId: sub.tariffId, amount: pay.amount, status: 'paid', paidAt: now, providerOrderId: pay.providerOrderId, idempotencyKey: pay.idempotencyKey, coversFromFlow: toDbDate(plan.flows[0]), months: plan.flows.length },
      });
      paymentId = created.id;
    }
    for (const f of plan.flows) {
      const flow = await ensureFlow(f, tx);
      await tx.flowMembership.upsert({
        where: { userId_flowId: { userId: sub.userId, flowId: flow.id } },
        create: { userId: sub.userId, flowId: flow.id, subscriptionId: sub.id, tariffId: sub.tariffId },
        update: {},
      });
    }
    await tx.billingSchedule.updateMany({ where: { subscriptionId: sub.id, status: { in: ['scheduled', 'synced'] } }, data: { status: 'charged' } });
    await tx.billingSchedule.upsert({
      where: { subscriptionId_coversFromFlow: { subscriptionId: sub.id, coversFromFlow: toDbDate(addMonths(plan.lastFlow, 1)) } },
      create: { subscriptionId: sub.id, dueDate: toDbDate(plan.nextChargeDate), coversFromFlow: toDbDate(addMonths(plan.lastFlow, 1)), months: sub.tariff.months, amount: sub.renewalPrice },
      update: {},
    });
    const updated = await tx.subscription.update({
      where: { id: sub.id },
      data: { paidThroughFlow: toDbDate(plan.lastFlow), nextChargeDate: toDbDate(plan.nextChargeDate), status: sub.autoRenew ? 'active' : 'canceled_at_period_end' },
    });
    return { subscription: updated };
  });
  if ('duplicate' in res) return res;
  // Продление происходит 28-го, следующая дата тоже 28-е — переносить нужно, только если провайдер прислал другую
  if (pay.nextChargeFromProvider && pay.nextChargeFromProvider !== plan.nextChargeDate) await syncChargeDate(sub.id);
  await track({ userId: sub.userId, eventName: 'subscription_renewal_success', tariffId: sub.tariffId, metadata: { kind: pay.kind } });
  await notify(sub.userId, 'renewal_success', { flows: plan.flows.map(monthName).join(', '), next_date: humanDate(plan.nextChargeDate, true) }, `renewal_success:${pay.idempotencyKey}`);
  return { extended: plan.flows };
}

async function handleSubscriptionStatus(p: ParsedWebhook) {
  const sub = await findSubscriptionForEvent(p);
  if (!sub) return { ignored: 'unknown_subscription' };
  if (p.subscriptionActive === false && sub.autoRenew) {
    await prisma.subscription.update({ where: { id: sub.id }, data: { autoRenew: false, status: 'canceled_at_period_end', providerDeactivatedAt: clock.now(), canceledAt: clock.now(), cancelReason: 'provider' } });
    await prisma.billingSchedule.updateMany({ where: { subscriptionId: sub.id, status: { in: ['scheduled', 'synced'] } }, data: { status: 'canceled' } });
  }
  return { status: true };
}

// ───────────── Долг, отмена, возврат ─────────────

/**
 * Ручная оплата долга при past_due: новая ссылка на подписку провайдера; после успеха старая подписка
 * провайдера отключается, чтобы не было двойного списания.
 */
export async function createDebtPayment(userId: bigint) {
  const sub = await prisma.subscription.findFirst({ where: { userId, status: 'past_due' }, include: { tariff: true } });
  if (!sub) throw conflict('no_debt', 'Задолженности нет');
  const key = `debt:${sub.id}:${fromDbDate(sub.paidThroughFlow)}`;
  const existing = await prisma.payment.findUnique({ where: { idempotencyKey: key } });
  if (existing && existing.status !== 'failed') return { paymentId: existing.id, url: existing.paymentUrl!, amount: existing.amount };
  const payment = existing
    ? await prisma.payment.update({ where: { id: existing.id }, data: { status: 'initiated', failureReason: null } })
    : await prisma.payment.create({ data: { userId, subscriptionId: sub.id, kind: 'debt', tariffId: sub.tariffId, amount: sub.renewalPrice, idempotencyKey: key, priceVariant: sub.priceVariant } });
  const { url } = await paymentProvider().createPayment({
    paymentId: payment.id,
    amount: sub.renewalPrice,
    title: `30 дней — продление (${sub.tariff.title})`,
    providerSubscriptionId: null,
    userId: userId.toString(),
    successUrl: appUrl(`pay_${payment.id}`),
    returnUrl: appUrl('profile'),
    notificationUrl: `${config.PUBLIC_URL}/api/payments/${paymentProvider().name}/webhook`,
  });
  await prisma.payment.update({ where: { id: payment.id }, data: { paymentUrl: url, status: 'pending' } });
  return { paymentId: payment.id, url, amount: sub.renewalPrice };
}

async function markDebtPaid(payment: Payment, p: ParsedWebhook) {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: payment.subscriptionId! }, include: { tariff: true } });
  const oldRef = refOf(sub);
  const res = await extendSubscription(sub, { amount: payment.amount, providerOrderId: p.providerOrderId, idempotencyKey: payment.idempotencyKey, kind: 'debt', paymentId: payment.id });
  if (!('duplicate' in res) && p.providerSubscriptionId) {
    if (oldRef && oldRef.providerSubscriptionId !== p.providerSubscriptionId) await paymentProvider().setActive(oldRef, false).catch(() => undefined);
    await prisma.subscription.update({ where: { id: sub.id }, data: { providerSubscriptionId: p.providerSubscriptionId, providerCustomer: p.customer } });
    await syncChargeDate(sub.id);
  }
  return res;
}

/**
 * Отмена автопродления самим пользователем (после трёх экранов удержания).
 * Доступ сохраняется до конца оплаченного периода. Если провайдер недоступен — задача повторит отключение.
 */
export async function cancelAutoRenew(userId: bigint, reason: string | undefined) {
  const sub = await prisma.subscription.findFirst({ where: { userId, status: { in: [...LIVE_STATUSES] } }, include: { tariff: true } });
  if (!sub) throw notFound('no_subscription');
  if (!sub.autoRenew) return { alreadyCanceled: true, paidUntil: addMonths(fromDbDate(sub.paidThroughFlow), 1) };
  await prisma.$transaction([
    prisma.subscription.update({ where: { id: sub.id }, data: { autoRenew: false, status: 'canceled_at_period_end', canceledAt: clock.now(), cancelReason: reason?.slice(0, 500) } }),
    prisma.billingSchedule.updateMany({ where: { subscriptionId: sub.id, status: { in: ['scheduled', 'synced'] } }, data: { status: 'canceled' } }),
  ]);
  await deactivateAtProvider(sub.id);
  const paidUntil = addMonths(fromDbDate(sub.paidThroughFlow), 1);
  await track({ userId, eventName: 'cancel_completed', screenId: 'S38', tariffId: sub.tariffId, metadata: { reason } });
  await notify(userId, 'cancel_confirmed', { paid_until: humanDate(paidUntil, true) }, `cancel:${sub.id}:${clock.now().toISOString().slice(0, 10)}`);
  return { canceled: true, paidUntil };
}

export async function deactivateAtProvider(subscriptionId: string) {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  if (sub.providerDeactivatedAt || sub.autoRenew) return;
  const ref = refOf(sub);
  if (!ref) {
    await prisma.subscription.update({ where: { id: sub.id }, data: { providerDeactivatedAt: clock.now() } });
    return;
  }
  try {
    await paymentProvider().setActive(ref, false);
    await prisma.subscription.update({ where: { id: sub.id }, data: { providerDeactivatedAt: clock.now() } });
  } catch (e) {
    console.warn('[billing] deactivate failed, will retry:', (e as Error).message);
  }
}

/** Вернуть автопродление до конца оплаченного периода */
export async function resumeAutoRenew(userId: bigint) {
  const sub = await prisma.subscription.findFirst({ where: { userId, status: 'canceled_at_period_end' } });
  if (!sub) throw notFound('no_subscription');
  const ref = refOf(sub);
  if (ref) await paymentProvider().setActive(ref, true);
  const today = localDate(clock.now(), await getSetting('flow.timezone'));
  const next = sub.nextChargeDate ? fromDbDate(sub.nextChargeDate) : null;
  if (next && next <= today) throw forbidden('too_late', 'Дата продления уже прошла — оформите новую подписку');
  await prisma.subscription.update({
    where: { id: sub.id },
    data: { autoRenew: true, providerDeactivatedAt: null, canceledAt: null, status: subscriptionStatusOn({ today, paidFromFlow: fromDbDate(sub.paidFromFlow), paidThroughFlow: fromDbDate(sub.paidThroughFlow), autoRenew: true, nextChargeDate: next }) },
  });
  await prisma.billingSchedule.updateMany({ where: { subscriptionId: sub.id, status: 'canceled' }, data: { status: 'scheduled' } });
  if (ref) await syncChargeDate(sub.id);
  return { resumed: true };
}

/**
 * Возврат (из кабинета CloudPayments — отмечается админом, либо пришёл webhook): платёж refunded,
 * не начавшиеся и текущие потоки этого платежа отзываются, автопродление выключается.
 */
export async function markRefunded(paymentId: string, source: 'provider' | 'admin') {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.status === 'refunded') return { alreadyRefunded: true };
  const now = clock.now();
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: paymentId }, data: { status: 'refunded', refundedAt: now, needsRefund: false } });
    if (!payment.subscriptionId || payment.needsRefund || !payment.coversFromFlow || !payment.months) return;
    const flows = coverage(fromDbDate(payment.coversFromFlow), payment.months).map(toDbDate);
    await tx.flowMembership.updateMany({
      where: { userId: payment.userId, subscriptionId: payment.subscriptionId, flow: { startsOn: { in: flows } }, status: { not: 'finished' } },
      data: { status: 'revoked' },
    });
    if (payment.kind === 'initial') {
      await tx.subscription.update({ where: { id: payment.subscriptionId }, data: { status: 'expired', autoRenew: false, canceledAt: now, cancelReason: `refund:${source}` } });
    } else {
      const prevThrough = addMonths(fromDbDate(payment.coversFromFlow), -1);
      await tx.subscription.update({ where: { id: payment.subscriptionId }, data: { paidThroughFlow: toDbDate(prevThrough), autoRenew: false, status: 'canceled_at_period_end', cancelReason: `refund:${source}` } });
    }
    await tx.billingSchedule.updateMany({ where: { subscriptionId: payment.subscriptionId, status: { in: ['scheduled', 'synced'] } }, data: { status: 'canceled' } });
  });
  if (payment.subscriptionId) await deactivateAtProvider(payment.subscriptionId);
  return { refunded: true };
}

/** Ежедневная сверка статусов подписок по календарю (past_due, expired) */
export async function refreshSubscriptionStatuses() {
  const tz = await getSetting('flow.timezone');
  const today = localDate(clock.now(), tz);
  const subs = await prisma.subscription.findMany({ where: { status: { in: [...LIVE_STATUSES] } } });
  const changed: { id: string; from: string; to: string }[] = [];
  for (const s of subs) {
    const next = subscriptionStatusOn({ today, paidFromFlow: fromDbDate(s.paidFromFlow), paidThroughFlow: fromDbDate(s.paidThroughFlow), autoRenew: s.autoRenew, nextChargeDate: s.nextChargeDate ? fromDbDate(s.nextChargeDate) : null });
    if (next !== s.status) {
      await prisma.subscription.update({ where: { id: s.id }, data: { status: next } });
      changed.push({ id: s.id, from: s.status, to: next });
    }
    if (!s.autoRenew && !s.providerDeactivatedAt) await deactivateAtProvider(s.id);
  }
  return changed;
}

export async function subscriptionSummary(userId: bigint) {
  const sub = await prisma.subscription.findFirst({ where: { userId }, include: { tariff: true }, orderBy: { createdAt: 'desc' } });
  const payments = await prisma.payment.findMany({ where: { userId, status: { in: ['paid', 'refunded', 'failed', 'disputed'] } }, orderBy: { createdAt: 'desc' }, take: 50 });
  return {
    subscription: sub
      ? {
          id: sub.id,
          status: sub.status,
          tariffId: sub.tariffId,
          tariffTitle: sub.tariff.title,
          months: sub.tariff.months,
          goalLimit: sub.tariff.goalLimit,
          price: sub.renewalPrice,
          /** Сколько будет стоить вступление заново, без скидки */
          regularPrice: quote(sub.tariff, false).price,
          autoRenew: sub.autoRenew,
          paidFrom: fromDbDate(sub.paidFromFlow),
          paidUntil: addMonths(fromDbDate(sub.paidThroughFlow), 1),
          nextCharge: sub.autoRenew && sub.nextChargeDate ? { date: fromDbDate(sub.nextChargeDate), amount: sub.renewalPrice } : null,
          canResume: sub.status === 'canceled_at_period_end' && !sub.cancelReason?.startsWith('refund') && paymentProvider().name !== 'cloudpayments',
        }
      : null,
    payments: payments.map((p) => ({ id: p.id, kind: p.kind, amount: p.amount, status: p.status, paidAt: p.paidAt, createdAt: p.createdAt })),
  };
}

export type { Tx };
