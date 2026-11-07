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
 * Повышение тарифа из анкеты (просьба владельца 05.11): у кого куплен 1 месяц (одна цель) — «3 месяца» (до 3 целей).
 * Сейчас — доплата разницы (цена 3 месяцев минус уже оплаченный месяц), дальше — автопродление по цене 3 месяцев.
 * Прежняя подписка отменяется только после успешной оплаты новой.
 */
const FROM = 'm1';
const TO = 'm3';

async function upgradeContext(userId: bigint) {
  const m = await planningMembership(userId);
  if (!m || m.tariffId !== FROM || !m.subscriptionId) return null;
  const sub = await prisma.subscription.findUnique({ where: { id: m.subscriptionId } });
  if (!sub || sub.priceVariant === 'tribute' || sub.tariffId !== FROM || !['prestart', 'active', 'canceled_at_period_end'].includes(sub.status)) return null;
  const firstFlow = fromDbDate(m.flow.startsOn);
  // Оплачен только месяц этой анкеты (без уже оплаченного продления) — иначе разница считается иначе, через поддержку
  if (fromDbDate(sub.paidThroughFlow) !== firstFlow) return null;
  const target = await prisma.tariff.findUnique({ where: { id: TO } });
  if (!target || !target.active) return null;
  // Цена — того же вида, что и прежняя покупка: по акции → «3 месяца» по акции, по обычной цене → по обычной
  const promo = sub.priceVariant !== 'regular';
  const price = quote(target, promo).price;
  const paid = sub.renewalPrice;
  const amount = price - paid;
  if (amount <= 0) return null;
  const flows = coverage(firstFlow, target.months);
  const chargeDate = chargeDateFor(flows[flows.length - 1]);
  return { m, sub, target, price, paid, amount, flows, firstFlow, chargeDate, promo };
}

export async function upgradeOffer(userId: bigint) {
  const c = await upgradeContext(userId);
  if (!c) return { available: false as const };
  return {
    available: true as const,
    from: { title: '1 месяц', goalLimit: 1 },
    to: { id: c.target.id, title: c.target.title, goalLimit: c.target.goalLimit, months: c.target.months },
    amount: c.amount,
    paid: c.paid,
    price: c.price,
    renewal: { amount: c.price, date: c.chargeDate, months: c.target.months },
    until: addMonths(c.flows[c.flows.length - 1], 1),
  };
}

export async function createUpgradeCheckout(userId: bigint, idempotencyKey: string) {
  const c = await upgradeContext(userId);
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
