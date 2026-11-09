import { addMonths, localDate, subscriptionStatusOn, toDbDate, type ISODate } from '@thirty/domain';
import { clock } from '../clock';
import { prisma } from '../db';
import { badRequest, forbidden } from '../http';
import { getSetting } from '../settings';
import { tg } from '../lib/telegram';
import { LIVE_STATUSES } from './billing';
import { ensureFlow } from './flows';
import { track } from './analytics';

/**
 * Оплата через Tribute (зарубежные карты, 07.11). Tribute выдаёт доступ только к общему чату клуба —
 * приложение открывается по отдельной ссылке (startapp=tribute), пока человек в этом чате.
 * Подписка помечается priceVariant = 'tribute': денег через нас не проходит, продлевает её членство в чате.
 * Тариф (сколько целей) человек выбирает сам при первом входе — тот, что оплатил в Tribute.
 */
export const TRIBUTE = 'tribute';
const MEMBER = ['creator', 'administrator', 'member'];

/**
 * Состоит ли человек в чате клуба (куда пускает Tribute). Проверяем все привязанные группы клуба (кроме канала):
 * общий чат и тематические. null — Telegram не ответил (не делаем выводов). Каждый ответ пишем в лог для разбора.
 */
export async function inClubChat(userId: bigint): Promise<boolean | null> {
  const chats = await prisma.telegramChat.findMany({ where: { kind: { in: ['flow', 'topic'] }, active: true, telegramChatId: { not: null } } });
  if (!chats.length) {
    console.warn(`[tribute] ${userId}: нет привязанных чатов клуба`);
    return null;
  }
  let unknown = false;
  for (const c of chats) {
    try {
      const r = await tg<{ status: string; is_member?: boolean }>('getChatMember', { chat_id: Number(c.telegramChatId), user_id: Number(userId) });
      console.log(`[tribute] ${userId} в «${c.title}» (${c.kind} ${c.telegramChatId}): ${r.status}${r.is_member !== undefined ? ` is_member=${r.is_member}` : ''}`);
      if (MEMBER.includes(r.status) || (r.status === 'restricted' && r.is_member)) return true;
    } catch (e) {
      console.warn(`[tribute] ${userId} в «${c.title}» (${c.kind} ${c.telegramChatId}): ошибка ${(e as Error).message}`);
      if (!/not found|PARTICIPANT|user not found/i.test((e as Error).message)) unknown = true;
    }
  }
  return unknown ? null : false;
}

const isTribute = (s: { priceVariant: string }) => s.priceVariant === TRIBUTE;
const currentMonth = async () => `${localDate(clock.now(), await getSetting('flow.timezone')).slice(0, 7)}-01` as ISODate;

export async function tributeStatus(userId: bigint) {
  const live = await prisma.subscription.findFirst({ where: { userId, status: { in: [...LIVE_STATUSES] } } });
  if (live) return { hasAccess: true, viaTribute: isTribute(live), inChat: true };
  return { hasAccess: false, viaTribute: false, inChat: await inClubChat(userId) };
}

/** Первый вход по ссылке Tribute: человек в чате клуба → доступ к приложению с выбранным тарифом */
export async function activateTribute(userId: bigint, tariffId: string) {
  const live = await prisma.subscription.findFirst({ where: { userId, status: { in: [...LIVE_STATUSES] } } });
  if (live) return { ok: true, already: true };
  const tariff = await prisma.tariff.findUnique({ where: { id: tariffId } });
  if (!tariff || !tariff.active) throw badRequest('tariff_not_found', 'Выбери тариф');
  const inChat = await inClubChat(userId);
  if (inChat !== true) throw forbidden('not_in_chat', inChat === null ? 'Не получилось проверить чат — попробуй через минуту' : 'Мы не нашли тебя в чате клуба. Сначала оплати в Tribute и вступи в чат по ссылке от Tribute');
  const month = await currentMonth();
  const through = addMonths(month, 1);
  const today = localDate(clock.now(), await getSetting('flow.timezone'));
  await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.create({
      data: {
        userId, tariffId: tariff.id, renewalPrice: 0, priceVariant: TRIBUTE, autoRenew: true, nextChargeDate: null,
        status: subscriptionStatusOn({ today, paidFromFlow: month, paidThroughFlow: through, autoRenew: true, nextChargeDate: null }),
        paidFromFlow: toDbDate(month), paidThroughFlow: toDbDate(through), providerCustomer: { source: TRIBUTE },
      },
    });
    const flow = await ensureFlow(month, tx);
    const existing = await tx.flowMembership.findUnique({ where: { userId_flowId: { userId, flowId: flow.id } } });
    if (!existing) await tx.flowMembership.create({ data: { userId, flowId: flow.id, subscriptionId: sub.id, tariffId: tariff.id } });
    else if (existing.status === 'revoked') {
      await tx.goal.deleteMany({ where: { membershipId: existing.id } });
      await tx.flowMembership.update({ where: { id: existing.id }, data: { status: 'reserved', subscriptionId: sub.id, tariffId: tariff.id, goalsLockedAt: null, registeredAt: null, finalSubmittedAt: null, startsOn: null } });
    } else await tx.flowMembership.update({ where: { id: existing.id }, data: { subscriptionId: sub.id, tariffId: tariff.id } });
    await tx.user.update({ where: { id: userId }, data: { onboardingStage: 'paid' } });
  });
  await track({ userId, eventName: 'tribute_activated', tariffId: tariff.id });
  return { ok: true };
}

/** Доступ по Tribute закончился (человека нет в чате клуба): участие закрывается, как при удалении */
async function endTribute(userId: bigint) {
  const { removeMember } = await import('./removeMember');
  await removeMember(userId, { closeSubscription: true });
  await prisma.subscription.updateMany({ where: { userId, priceVariant: TRIBUTE, cancelReason: 'removed_by_admin', canceledAt: { gte: new Date(clock.now().getTime() - 60_000) } }, data: { cancelReason: 'tribute_ended' } });
  await track({ userId, eventName: 'tribute_ended' });
}

/** Вышел или удалён из общего чата клуба — если доступ был по Tribute, закрываем сразу */
export async function onClubChatLeft(userId: bigint) {
  const live = await prisma.subscription.findFirst({ where: { userId, priceVariant: TRIBUTE, status: { in: [...LIVE_STATUSES] } } });
  if (live) await endTribute(userId);
}

/** Ежедневно: в чате — продлеваем на месяц вперёд; нет в чате — закрываем. Telegram не ответил — ничего не меняем */
export async function syncTribute() {
  const subs = await prisma.subscription.findMany({ where: { priceVariant: TRIBUTE, status: { in: [...LIVE_STATUSES] } } });
  const through = addMonths(await currentMonth(), 1);
  let extended = 0, ended = 0;
  for (const s of subs) {
    const inChat = await inClubChat(s.userId);
    if (inChat === true) {
      if (s.paidThroughFlow.toISOString().slice(0, 10) < through) {
        await prisma.subscription.update({ where: { id: s.id }, data: { paidThroughFlow: toDbDate(through) } });
        extended++;
      }
    } else if (inChat === false) {
      await endTribute(s.userId);
      ended++;
    }
  }
  return { extended, ended };
}
