import { addMonths, chargeDateFor, coverage, fromDbDate, humanDate, localDate, quote, subscriptionStatusOn, toDbDate, type ISODate } from '@thirty/domain';
import type { Payment } from '@prisma/client';
import { clock } from '../clock';
import { config } from '../config';
import { prisma, serializable } from '../db';
import { conflict, notFound } from '../http';
import { getSetting } from '../settings';
import { paymentProvider } from '../payments';
import type { ParsedWebhook } from '../payments/types';
import { appUrl, deactivateAtProvider, syncChargeDate } from './billing';
import { ensureFlow, planningMembership } from './flows';
import { track } from './analytics';
import { paymentAlert } from './paymentAlerts';

/**
 * Повышение тарифа (05.11 из анкеты; 15.11 — в любой момент с главной): 1 месяц → 3 или 6, 3 месяца → 6.
 * Доплата — разница между ценой нового тарифа и уже оплаченным текущим периодом; новый срок считается
 * от начала оплаченного периода; дальше — автопродление по цене нового тарифа.
 * Прежняя подписка отменяется только после успешной оплаты новой.
 */
async function currentSubscription(userId: bigint) {
  const subs = await prisma.subscription.findMany({ where: { userId, status: { in: ['prestart', 'active', 'canceled_at_period_end'] } }, include: { tariff: true }, orderBy: { createdAt: 'desc' } });
  return subs.find((s) => s.priceVariant !== 'tribute') ?? null;
}

async function upgradeContext(userId: bigint, toId?: string) {
  const sub = await currentSubscription(userId);
  if (!sub) return null;
  const targets = (await prisma.tariff.findMany({ where: { active: true, months: { gt: sub.tariff.months } }, orderBy: { months: 'asc' } })).filter((t) => !toId || t.id === toId);
  const target = targets[0];
  if (!target) return null;
  // Текущий оплаченный период: последние «months» месяцев до paidThroughFlow
  const firstFlow = addMonths(fromDbDate(sub.paidThroughFlow), -(sub.tariff.months - 1)) as ISODate;
  // Цена — того же вида, что и прежняя покупка: по акции → по акции, по обычной цене → по обычной
  const promo = sub.priceVariant !== 'regular';
  const price = quote(target, promo).price;
  const paid = sub.renewalPrice;
  const amount = price - paid;
  if (amount <= 0) return null;
  const flows = coverage(firstFlow, target.months);
  const chargeDate = chargeDateFor(flows[flows.length - 1]);
  return { sub, target, price, paid, amount, flows, firstFlow, chargeDate, promo };
}

const offerOf = (c: NonNullable<Awaited<ReturnType<typeof upgradeContext>>>) => ({
  to: { id: c.target.id, title: c.target.title, goalLimit: c.target.goalLimit, months: c.target.months },
  amount: c.amount,
  paid: c.paid,
  price: c.price,
  renewal: { amount: c.price, date: c.chargeDate, months: c.target.months },
  until: addMonths(c.flows[c.flows.length - 1], 1),
});

/** Почему повышение недоступно — для админки (16.11) */
export async function upgradeBlockReason(userId: bigint): Promise<string | null> {
  const all = await prisma.subscription.findMany({ where: { userId }, include: { tariff: true }, orderBy: { createdAt: 'desc' } });
  if (!all.length) return 'нет ни одной подписки (оплата не записалась или доступ выдан без подписки)';
  const live = all.filter((s) => ['prestart', 'active', 'canceled_at_period_end'].includes(s.status));
  if (!live.length) return `нет действующей подписки: последняя — «${all[0].tariff.title}», статус ${all[0].status}`;
  if (live.every((s) => s.priceVariant === 'tribute')) return 'подписка оформлена через Tribute — повышение там';
  const sub = live.find((s) => s.priceVariant !== 'tribute')!;
  if (sub.tariff.months >= 6) return 'уже максимальный тариф';
  return null;
}

/** Что можно купить сверх текущего тарифа: ближайший вариант (для анкеты) и все варианты (для главной) */
export async function upgradeOffer(userId: bigint) {
  const sub = await currentSubscription(userId);
  if (!sub) return { available: false as const, options: [] };
  const targets = await prisma.tariff.findMany({ where: { active: true, months: { gt: sub.tariff.months } }, orderBy: { months: 'asc' } });
  const options = [];
  for (const t of targets) {
    const c = await upgradeContext(userId, t.id);
    if (c) options.push(offerOf(c));
  }
  if (!options.length) return { available: false as const, options: [] };
  return {
    available: true as const,
    from: { id: sub.tariff.id, title: sub.tariff.title, goalLimit: sub.tariff.goalLimit, months: sub.tariff.months },
    ...options[0],
    options,
  };
}

export async function createUpgradeCheckout(userId: bigint, idempotencyKey: string, toId?: string) {
  const c = await upgradeContext(userId, toId);
  if (!c) throw conflict('upgrade_unavailable', 'Повысить тариф сейчас нельзя — напиши в поддержку, поможем');
  const key = `upgrade:${userId}:${idempotencyKey}`;
  const existing = await prisma.payment.findUnique({ where: { idempotencyKey: key } });
  if (existing) return { paymentId: existing.id, url: existing.paymentUrl!, amount: existing.amount };
  const payment = await prisma.payment.create({
    data: {
      userId, kind: 'upgrade', tariffId: c.target.id, priceVariant: c.promo ? 'promo' : 'regular', amount: c.amount, subscriptionId: c.sub.id,
      coversFromFlow: toDbDate(c.firstFlow), months: c.target.months, idempotencyKey: key, status: 'initiated', provider: paymentProvider().name,
    },
  });
  const { url } = await paymentProvider().createPayment({
    paymentId: payment.id,
    amount: c.amount,
    title: `30 дней — повышение до «${c.target.title}»`,
    providerSubscriptionId: null,
    userId: userId.toString(),
    linkExpiresAt: new Date(clock.now().getTime() + 24 * 3600_000),
    successUrl: appUrl(`pay_${payment.id}`),
    returnUrl: appUrl(`pay_${payment.id}`),
    notificationUrl: `${config.PUBLIC_URL}/api/payments/${paymentProvider().name}/webhook`,
  });
  await prisma.payment.update({ where: { id: payment.id }, data: { paymentUrl: url, status: 'pending' } });
  await track({ userId, eventName: 'payment_start', tariffId: c.target.id, metadata: { amount: c.amount, paymentId: payment.id, upgrade: true } });
  return { paymentId: payment.id, url, amount: c.amount };
}

/** Автопродление после повышения: цена 3 месяцев, первое списание — 28-го последнего оплаченного месяца */
export async function upgradeRecurrent(p: Payment) {
  if (!p.coversFromFlow || !p.months || !p.tariffId) return null;
  const tariff = await prisma.tariff.findUnique({ where: { id: p.tariffId } });
  if (!tariff) return null;
  const flows = coverage(fromDbDate(p.coversFromFlow), p.months);
  return { interval: 'Month', period: p.months, amount: quote(tariff, p.priceVariant !== 'regular').price, startDate: `${chargeDateFor(flows[flows.length - 1])}T09:00:00` };
}

export async function markUpgradePaid(payment: Payment, p: ParsedWebhook) {
  if (payment.status === 'paid') return { alreadyPaid: true };
  const tariff = await prisma.tariff.findUniqueOrThrow({ where: { id: payment.tariffId! } });
  const firstFlow = fromDbDate(payment.coversFromFlow!) as ISODate;
  const flows = coverage(firstFlow, payment.months!);
  const lastFlow = flows[flows.length - 1];
  const now = clock.now();
  const tz = await getSetting('flow.timezone');
  const today = localDate(now, tz);
  const chargeDate = chargeDateFor(lastFlow);
  const renewalPrice = quote(tariff, payment.priceVariant !== 'regular').price;
  const out = await serializable(async (tx) => {
    const fresh = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (fresh.status === 'paid') return null;
    const old = payment.subscriptionId ? await tx.subscription.findUnique({ where: { id: payment.subscriptionId } }) : null;
    if (!old) throw notFound('subscription_not_found');
    // Прежняя подписка закрывается (в той же транзакции — при сбое ничего не меняется): одна живая подписка на человека
    await tx.subscription.update({ where: { id: old.id }, data: { status: 'expired', autoRenew: false, canceledAt: now, cancelReason: 'upgraded' } });
    const sub = await tx.subscription.create({
      data: {
        userId: payment.userId, tariffId: tariff.id, renewalPrice, priceVariant: payment.priceVariant ?? 'promo',
        status: subscriptionStatusOn({ today, paidFromFlow: fromDbDate(old.paidFromFlow), paidThroughFlow: lastFlow, autoRenew: true, nextChargeDate: chargeDate }),
        paidFromFlow: old.paidFromFlow, paidThroughFlow: toDbDate(lastFlow), nextChargeDate: toDbDate(chargeDate),
        providerSubscriptionId: p.providerSubscriptionId, providerCustomer: p.customer, test: Boolean(p.test),
      },
    });
    await tx.billingSchedule.updateMany({ where: { subscriptionId: old.id, status: { in: ['scheduled', 'synced'] } }, data: { status: 'canceled' } });
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'paid', paidAt: now, providerOrderId: p.providerOrderId, subscriptionId: sub.id, test: Boolean(p.test) } });
    await tx.flowMembership.updateMany({ where: { subscriptionId: old.id }, data: { subscriptionId: sub.id, tariffId: tariff.id } });
    for (const f of flows) {
      const flow = await ensureFlow(f, tx);
      const existing = await tx.flowMembership.findUnique({ where: { userId_flowId: { userId: payment.userId, flowId: flow.id } } });
      if (!existing) await tx.flowMembership.create({ data: { userId: payment.userId, flowId: flow.id, subscriptionId: sub.id, tariffId: tariff.id } });
      else if (existing.status !== 'revoked') await tx.flowMembership.update({ where: { id: existing.id }, data: { subscriptionId: sub.id, tariffId: tariff.id } });
    }
    await tx.billingSchedule.create({ data: { subscriptionId: sub.id, dueDate: toDbDate(chargeDate), coversFromFlow: toDbDate(addMonths(lastFlow, 1)), months: tariff.months, amount: renewalPrice } });
    return { sub, oldId: old.id };
  });
  if (!out) return { alreadyPaid: true };
  // Автопродление прежней подписки выключаем у провайдера (при сбое задача повторит)
  await deactivateAtProvider(out.oldId);
  if (out.sub.providerSubscriptionId) await syncChargeDate(out.sub.id);
  paymentAlert('initial', { userId: payment.userId, amount: payment.amount, tariffId: tariff.id, test: p.test, note: `Повышение тарифа до «${tariff.title}»` });
  await track({ userId: payment.userId, eventName: 'payment_success', tariffId: tariff.id, metadata: { amount: payment.amount, paymentId: payment.id, upgrade: true }, dedupeKey: `payment_success:${payment.id}` });
  return { upgraded: true, subscriptionId: out.sub.id, nextCharge: humanDate(chargeDate) };
}
