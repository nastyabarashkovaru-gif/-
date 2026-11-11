import { addMonths, localDate, subscriptionStatusOn, toDbDate, type ISODate } from '@thirty/domain';
import { clock } from '../clock';
import { prisma } from '../db';
import { badRequest, conflict, notFound } from '../http';
import { getSetting } from '../settings';
import { LIVE_STATUSES, reviveMembership } from './billing';
import { ensureFlow } from './flows';
import { track } from './analytics';

/** Доступ, выданный вручную (подарок, бартер, оплата вне приложения) — без списаний и автопродления (11.11) */
export const GIFT_REASON = 'gift';

/**
 * Выдать доступ на N месяцев с текущего месяца: подписка без оплаты и автопродления, участие в текущем месяце.
 * Дальше всё как у обычной участницы: анкета, дата старта — ближайший старт, следующие челленджи — пока доступ действует.
 */
export async function grantAccess(userId: bigint, tariffId: string, months: number, note: string) {
  if (!Number.isInteger(months) || months < 1 || months > 12) throw badRequest('bad_months', 'Срок — от 1 до 12 месяцев');
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound('user_not_found', 'Участница не найдена — пусть сначала откроет бота');
  const tariff = await prisma.tariff.findUnique({ where: { id: tariffId } });
  if (!tariff) throw badRequest('tariff_not_found', 'Нет такого тарифа');
  const live = await prisma.subscription.findFirst({ where: { userId, status: { in: [...LIVE_STATUSES] } } });
  if (live) throw conflict('already_subscribed', 'У участницы уже есть действующая подписка');
  const tz = await getSetting('flow.timezone');
  const today = localDate(clock.now(), tz);
  const month = `${today.slice(0, 7)}-01` as ISODate;
  const through = addMonths(month, months - 1);
  const now = clock.now();
  await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.create({
      data: {
        userId, tariffId: tariff.id, renewalPrice: 0, priceVariant: 'promo', autoRenew: false, nextChargeDate: null,
        status: subscriptionStatusOn({ today, paidFromFlow: month, paidThroughFlow: through, autoRenew: false, nextChargeDate: null }),
        paidFromFlow: toDbDate(month), paidThroughFlow: toDbDate(through),
        canceledAt: now, cancelReason: GIFT_REASON, providerDeactivatedAt: now, providerCustomer: { source: GIFT_REASON, note: note.slice(0, 200) },
      },
    });
    const flow = await ensureFlow(month, tx);
    const existing = await tx.flowMembership.findUnique({ where: { userId_flowId: { userId, flowId: flow.id } } });
    if (!existing) await tx.flowMembership.create({ data: { userId, flowId: flow.id, subscriptionId: sub.id, tariffId: tariff.id } });
    else if (existing.status === 'revoked') await reviveMembership(tx, existing.id, sub.id, tariff.id);
    else await tx.flowMembership.update({ where: { id: existing.id }, data: { subscriptionId: sub.id, tariffId: tariff.id } });
    await tx.user.update({ where: { id: userId }, data: { onboardingStage: 'paid' } });
  });
  await track({ userId, eventName: 'access_granted', tariffId: tariff.id, metadata: { months, note } });
  return { ok: true, until: addMonths(through, 1) };
}

/** Разовая выдача по нику (просьба владелицы) — при запуске сервера, один раз на ник */
export async function grantOnceByUsername(username: string, tariffId: string, months: number, note: string) {
  const key = `grant.once.${username.toLowerCase()}`;
  if (await prisma.setting.findUnique({ where: { key } })) return;
  const user = await prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } } });
  if (!user) {
    console.warn(`[grant] @${username} не найдена — пусть откроет бота, выдача повторится при следующем запуске`);
    return;
  }
  try {
    const r = await grantAccess(user.id, tariffId, months, note);
    console.log(`[grant] @${username}: доступ «${tariffId}» до ${r.until}`);
  } catch (e) {
    console.warn(`[grant] @${username}: ${(e as Error).message}`);
  }
  await prisma.setting.create({ data: { key, value: { at: new Date().toISOString() } } });
}
