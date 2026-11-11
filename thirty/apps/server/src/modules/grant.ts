import { randomBytes } from 'node:crypto';
import { addMonths, chargeDateFor, fromDbDate, localDate, subscriptionStatusOn, toDbDate, type ISODate } from '@thirty/domain';
import { clock } from '../clock';
import { prisma } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../http';
import { getSetting } from '../settings';
import { LIVE_STATUSES, reviveMembership, syncChargeDate } from './billing';
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

// ───────────── Подарочная ссылка (11.11) ─────────────

const RANK: Record<string, number> = { m1: 1, m3: 2, m6: 3 };

/**
 * Продлить действующую подписку: доступ не меньше чем на N месяцев с текущего, тариф — не ниже подарочного.
 * Автопродление (CloudPayments) сдвигается на 28-е последнего оплаченного месяца; у Tribute срок ведёт Tribute — меняем только тариф.
 */
async function extendAccess(subId: string, tariffId: string, months: number) {
  const sub = await prisma.subscription.findUniqueOrThrow({ where: { id: subId } });
  const tariff = (RANK[tariffId] ?? 0) > (RANK[sub.tariffId] ?? 0) ? tariffId : sub.tariffId;
  const tz = await getSetting('flow.timezone');
  const month = `${localDate(clock.now(), tz).slice(0, 7)}-01` as ISODate;
  const want = addMonths(month, months - 1);
  const through = sub.priceVariant === 'tribute' ? fromDbDate(sub.paidThroughFlow) : (fromDbDate(sub.paidThroughFlow) > want ? fromDbDate(sub.paidThroughFlow) : want);
  const charge = sub.autoRenew && sub.priceVariant !== 'tribute' ? chargeDateFor(through) : null;
  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({ where: { id: sub.id }, data: { tariffId: tariff, paidThroughFlow: toDbDate(through), ...(charge ? { nextChargeDate: toDbDate(charge) } : {}) } });
    await tx.flowMembership.updateMany({ where: { subscriptionId: sub.id, status: { not: 'revoked' } }, data: { tariffId: tariff } });
    if (charge && fromDbDate(sub.paidThroughFlow) !== through) {
      await tx.billingSchedule.updateMany({ where: { subscriptionId: sub.id, status: { in: ['scheduled', 'synced'] } }, data: { status: 'canceled' } });
      const months2 = (await tx.tariff.findUniqueOrThrow({ where: { id: tariff } })).months;
      await tx.billingSchedule.upsert({
        where: { subscriptionId_coversFromFlow: { subscriptionId: sub.id, coversFromFlow: toDbDate(addMonths(through, 1)) } },
        create: { subscriptionId: sub.id, dueDate: toDbDate(charge), coversFromFlow: toDbDate(addMonths(through, 1)), months: months2, amount: sub.renewalPrice },
        update: { dueDate: toDbDate(charge), status: 'scheduled', months: months2, amount: sub.renewalPrice },
      });
    }
  });
  if (charge) await syncChargeDate(sub.id);
  return { ok: true, until: addMonths(through, 1), extended: true };
}

type GiftLink = { tariffId: string; months: number; note: string; usedBy?: string | null; usedAt?: string | null };
const giftKey = (code: string) => `gift.link.${code}`;

/** Новая одноразовая подарочная ссылка: код хранится в настройках, ссылка — t.me/<бот>/app?startapp=gift_<код> */
export async function createGiftLink(tariffId: string, months: number, note: string) {
  const code = randomBytes(9).toString('base64url');
  await prisma.setting.create({ data: { key: giftKey(code), value: { tariffId, months, note, usedBy: '' } } });
  return code;
}

/** Открыла подарочную ссылку: доступ на N месяцев (новый или продление действующего). Ссылка — для одного человека */
export async function redeemGift(userId: bigint, code: string) {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(code)) throw notFound('gift_not_found', 'Ссылка недействительна');
  const row = await prisma.setting.findUnique({ where: { key: giftKey(code) } });
  if (!row) throw notFound('gift_not_found', 'Ссылка недействительна');
  const g = row.value as GiftLink;
  if (g.usedBy && g.usedBy !== userId.toString()) throw forbidden('gift_used', 'Эта ссылка уже использована');
  if (g.usedBy === userId.toString()) return { ok: true, already: true };
  // Сначала занимаем ссылку, чтобы два человека не открыли её одновременно
  const taken = await prisma.setting.updateMany({ where: { key: giftKey(code), value: { path: ['usedBy'], equals: '' } }, data: { value: { ...g, usedBy: userId.toString(), usedAt: new Date().toISOString() } } });
  if (!taken.count) throw forbidden('gift_used', 'Эта ссылка уже использована');
  const live = await prisma.subscription.findFirst({ where: { userId, status: { in: [...LIVE_STATUSES] } } });
  const r = live ? await extendAccess(live.id, g.tariffId, g.months) : await grantAccess(userId, g.tariffId, g.months, `подарочная ссылка: ${g.note}`);
  await track({ userId, eventName: 'access_granted', tariffId: g.tariffId, metadata: { months: g.months, gift: true, extended: Boolean(live) } });
  return r;
}

/** Разовая подарочная ссылка по просьбе владелицы — создаётся при запуске один раз, ссылка пишется в лог */
export async function giftLinkOnce(name: string, tariffId: string, months: number) {
  const key = `gift.once.${name}`;
  const done = await prisma.setting.findUnique({ where: { key } });
  const code = done ? (done.value as { code: string }).code : await createGiftLink(tariffId, months, name);
  if (!done) await prisma.setting.create({ data: { key, value: { code } } });
  const { appLink } = await import('../lib/telegram');
  console.log(`[gift] ${name}: ${appLink(`gift_${code}`)}`);
}
