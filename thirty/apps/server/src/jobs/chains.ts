import { addDays, flowBounds, fromDbDate, localDate, humanDate, quote, cardForFlowDay, flowDayNumber, startOfLocalDay, dayDeadline, formatRub } from '@thirty/domain';
import { DateTime } from 'luxon';
import { clock } from '../clock';
import { prisma } from '../db';
import { pushNotification } from '../modules/notifications';
import { getSetting, feature } from '../settings';
import { sendTemplate } from '../modules/bot';
import { LIVE_STATUSES } from '../modules/billing';
import { generateCard } from '../modules/cards';
import { memberStats } from '../modules/rating';

type Send = (userId: bigint, key: string, vars: Record<string, string | number>, dedupe: string) => Promise<unknown>;

const minutesAgo = (now: Date, m: number) => new Date(now.getTime() - m * 60_000);

async function templates() {
  const rows = await prisma.botMessageTemplate.findMany();
  return new Map(rows.map((t) => [t.key, t]));
}

/** Пользователи, которые уже купили: им не шлём дожим до оплаты */
async function payers(): Promise<Set<string>> {
  const rows = await prisma.payment.findMany({ where: { status: 'paid', kind: 'initial' }, select: { userId: true } });
  return new Set(rows.map((r) => r.userId.toString()));
}

async function usersWithEvent(name: string, since: Date) {
  const rows = await prisma.analyticsEvent.groupBy({ by: ['userId'], where: { eventName: name, ts: { gt: since }, userId: { not: null } }, _max: { ts: true } });
  return new Map(rows.map((r) => [r.userId!.toString(), r._max.ts!]));
}

/**
 * Дожимные цепочки до оплаты (B04–B09). Каждое сообщение — максимум один раз на пользователя
 * (dedupeKey), с задержкой из шаблона; после оплаты сегмент исключается.
 */
export async function runPrePurchaseChains(now = clock.now(), send: Send = sendTemplate) {
  const tpl = await templates();
  const paid = await payers();
  const horizon = minutesAgo(now, 7 * 24 * 60);
  const opened = await usersWithEvent('app_open', horizon);
  const tariffView = await usersWithEvent('tariff_view', horizon);
  const tariffSelect = await usersWithEvent('tariff_select', horizon);
  const payStart = await usersWithEvent('payment_start', horizon);
  const sentThisTick = new Set<string>();
  const once = async (uid: string, key: string, vars: Record<string, string | number> = {}, suffix = '') => {
    if (paid.has(uid) || sentThisTick.has(uid)) return;
    const r = await send(BigInt(uid), key, vars, `${key}:${uid}${suffix}`);
    if (r === 'sent') sentThisTick.add(uid);
  };
  const delay = (key: string) => tpl.get(key)?.delayMinutes ?? 60;

  // Персональная цена: 60 и 15 минут до конца, «истекла» — с наивысшим приоритетом среди рекламных
  const offers = await prisma.priceOffer.findMany({ where: { consumedAt: null, expiresAt: { gt: minutesAgo(now, 24 * 60) } } });
  const tariffs = await prisma.tariff.findMany({ where: { active: true }, orderBy: { months: 'asc' } });
  for (const o of offers) {
    const uid = o.userId.toString();
    const left = (o.expiresAt.getTime() - now.getTime()) / 60_000;
    const selected = await prisma.analyticsEvent.findFirst({ where: { userId: o.userId, eventName: 'tariff_select' }, orderBy: { ts: 'desc' } });
    const t = tariffs.find((x) => x.id === selected?.tariffId) ?? tariffs.find((x) => x.highlighted) ?? tariffs[0];
    if (!t) continue;
    if (left > 45 && left <= 60) await once(uid, 'offer_ending_60', { tariff: t.title, price: quote(t, true).price }, `:${o.id}`);
    else if (left > 0 && left <= 15) await once(uid, 'offer_ending_15', {}, `:${o.id}`);
    else if (left <= 0 && left > -24 * 60 && o.kind === 'intro') {
      const referral = (await feature('offer_referral_restore')) ? '\n\nВернуть специальную цену можно, поделившись карточкой челленджа с друзьями.' : '';
      await once(uid, 'offer_expired', { price: formatRub(quote(tariffs[0], false).price).replace(' ₽', ''), referral_line: referral }, `:${o.id}`);
    }
  }

  // Начал оплату, но платёж не завершился: ждём окно webhook и проверяем серверный статус
  const pendingWindow = await getSetting('payment.pendingWindowMinutes');
  const stuck = await prisma.payment.findMany({ where: { kind: 'initial', status: { in: ['pending', 'failed'] }, createdAt: { lt: minutesAgo(now, Math.max(pendingWindow, delay('nudge_payment_incomplete'))), gt: horizon } } });
  for (const p of stuck) await once(p.userId.toString(), 'nudge_payment_incomplete', {}, `:${p.id}`);

  // Выбрал тариф, не начал оплату
  for (const [uid, ts] of tariffSelect) {
    if (payStart.has(uid) || ts > minutesAgo(now, delay('nudge_selected_no_payment'))) continue;
    const ev = await prisma.analyticsEvent.findFirst({ where: { userId: BigInt(uid), eventName: 'tariff_select' }, orderBy: { ts: 'desc' } });
    const t = tariffs.find((x) => x.id === ev?.tariffId);
    if (!t) continue;
    const offer = await prisma.priceOffer.findFirst({ where: { userId: BigInt(uid), consumedAt: null, expiresAt: { gt: now } } });
    const price = quote(t, Boolean(offer)).price;
    const line = offer ? `, специальная цена действует до ${DateTime.fromJSDate(offer.expiresAt, { zone: 'Europe/Moscow' }).toFormat('HH:mm')} МСК` : '';
    await once(uid, 'nudge_selected_no_payment', { tariff: t.title, price: price.toLocaleString('ru-RU'), offer_line: line });
  }

  // Видел тарифы, не выбрал
  for (const [uid, ts] of tariffView) {
    if (tariffSelect.has(uid) || ts > minutesAgo(now, delay('nudge_tariffs_no_select'))) continue;
    await once(uid, 'nudge_tariffs_no_select');
  }

  // Открыл, но не дошёл до тарифов
  for (const [uid, ts] of opened) {
    if (tariffView.has(uid) || ts > minutesAgo(now, delay('nudge_not_reached_tariffs'))) continue;
    await once(uid, 'nudge_not_reached_tariffs');
  }
}

/** После оплаты: незавершённая регистрация (B10), старт, конец периода (B11) */
export async function runPostPurchaseChains(now = clock.now(), send: Send = sendTemplate) {
  const tpl = await templates();
  const tz = await getSetting('flow.timezone');
  const today = localDate(now, tz);
  const reserved = await prisma.flowMembership.findMany({
    where: { status: { in: ['reserved', 'registered'] }, flow: { status: { not: 'finished' } } },
    include: { flow: true, user: true, subscription: true },
  });
  for (const m of reserved) {
    const uid = m.userId;
    const paidAt = m.createdAt;
    if (m.status === 'reserved') {
      const profileDone = m.user.interests.length > 0;
      const key = profileDone ? 'reg_goals' : 'reg_profile';
      if (paidAt < minutesAgo(now, tpl.get(key)?.delayMinutes ?? 120)) await send(uid, key, {}, `${key}:${m.id}:${today}`);
    } else {
      const hasBuddy = await prisma.buddyAssignment.findUnique({ where: { flowId_userId: { flowId: m.flowId, userId: uid } } });
      const invited = await prisma.buddyInvite.findFirst({ where: { flowId: m.flowId, fromUserId: uid } });
      if (!hasBuddy && !invited && m.registeredAt && m.registeredAt < minutesAgo(now, tpl.get('reg_buddy')?.delayMinutes ?? 240)) await send(uid, 'reg_buddy', {}, `reg_buddy:${m.id}`);
    }
    const startsOn = fromDbDate(m.flow.startsOn);
    for (const daysBefore of [3, 1]) {
      if (addDays(startsOn, -daysBefore) === today) await send(uid, 'flow_start_soon', { flow: m.flow.title, date: humanDate(startsOn) }, `flow_start_soon:${m.id}:${daysBefore}`);
    }
  }
  const ending = await prisma.subscription.findMany({ where: { status: 'canceled_at_period_end' } });
  for (const s of ending) {
    const paidUntil = addDays(flowBounds(fromDbDate(s.paidThroughFlow)).endsOn, 1);
    if (addDays(paidUntil, -7) === today) await send(s.userId, 'period_ending', { date: humanDate(paidUntil, true) }, `period_ending:${s.id}`);
  }
}

/**
 * Во время потока: напоминание об отчёте за 3 часа до дедлайна, поддержка после пропуска (утром),
 * карточки 7/14/21/28 дня (в полдень), отзыв на 14-й день, финал.
 */
export async function runFlowChains(now = clock.now(), send: Send = sendTemplate) {
  const flows = await prisma.flow.findMany({ where: { status: { in: ['active', 'finished'] }, finalizedAt: null } });
  for (const flow of flows) {
    const startsOn = fromDbDate(flow.startsOn);
    const endsOn = flowBounds(startsOn).endsOn;
    const today = localDate(now, flow.timezone);
    const hour = DateTime.fromJSDate(now, { zone: flow.timezone }).hour;
    const members = await prisma.flowMembership.findMany({ where: { flowId: flow.id, status: { in: ['active', 'finished'] } } });
    if (today >= startsOn && today <= endsOn) {
      const dayNum = flowDayNumber(startsOn, today);
      const hoursLeft = (dayDeadline(today, flow.timezone).getTime() - now.getTime()) / 3600_000;
      for (const m of members) {
        const report = await prisma.dailyReport.findUnique({ where: { membershipId_date: { membershipId: m.id, date: new Date(`${today}T00:00:00Z`) } } });
        if (!report && hoursLeft <= 3 && hoursLeft > 0.25) {
          await send(m.userId, 'report_reminder', { hours: Math.ceil(hoursLeft) }, `report_reminder:${m.id}:${today}`);
          await pushNotification(m.userId, 'report_due', { title: 'Пора сдать отчёт!', body: `До конца дня ${Math.ceil(hoursLeft)} ч. Отметь действия и прикрепи фото.`, link: '/?report=1' }, `report_due:${m.id}:${today}`);
        }
        if (hour >= 10 && today > startsOn) {
          const yesterday = addDays(today, -1);
          const y = await prisma.dailyReport.findUnique({ where: { membershipId_date: { membershipId: m.id, date: new Date(`${yesterday}T00:00:00Z`) } } });
          if (!y && !report) await send(m.userId, 'report_missed_comeback', {}, `comeback:${m.id}:${yesterday}`);
        }
        const week = cardForFlowDay(dayNum);
        if (week && hour >= 12) {
          const card = await generateCard(m.userId, m.id, week).catch(() => null);
          if (card) await send(m.userId, 'weekly_card', { week, days: card.stats.successfulDays }, `weekly_card:${m.id}:${week}`);
        }
        if (dayNum === 14 && hour >= 19) await send(m.userId, 'review_request', {}, `review_day14:${m.id}`);
      }
    }
    if (today === addDays(endsOn, 1) && hour >= 10) {
      for (const m of members) {
        await generateCard(m.userId, m.id, 5).catch(() => null);
        await send(m.userId, 'flow_finished', { flow: flow.title }, `flow_finished:${m.id}`);
        await send(m.userId, 'review_request', {}, `review_final:${m.id}`);
      }
    }
  }
}

/** Напоминание за час до созвона и просьба об отзыве после него */
export async function runMeetingChains(now = clock.now(), send: Send = sendTemplate) {
  const soon = await prisma.meeting.findMany({ where: { status: 'scheduled', startsAt: { gt: new Date(now.getTime() + 45 * 60_000), lte: new Date(now.getTime() + 60 * 60_000) } } });
  const after = await prisma.meeting.findMany({ where: { status: { in: ['scheduled', 'done'] }, startsAt: { lt: new Date(now.getTime() - 60 * 60_000), gt: new Date(now.getTime() - 6 * 3600_000) } }, include: { attendances: true } });
  if (!soon.length && !after.length) return;
  const subs = await prisma.subscription.findMany({ where: { status: { in: [...LIVE_STATUSES] } }, include: { user: true } });
  for (const mt of soon) {
    for (const s of subs) {
      // Участникам с интересом к направлению (или без выбранных интересов)
      if (s.user.interests.length && !s.user.interests.includes(mt.direction)) continue;
      await send(s.userId, 'meeting_soon', { title: mt.title }, `meeting_soon:${mt.id}:${s.userId}`);
    }
  }
  for (const mt of after) {
    for (const a of mt.attendances) if (a.joinClickedAt) await send(a.userId, 'review_request', {}, `review_meeting:${mt.id}:${a.userId}`);
  }
}

export { startOfLocalDay, memberStats };
