import { addMonths, addDays, flowBounds, fromDbDate, localDate, humanDate, quote, cardForFlowDay, flowDayNumber, startOfLocalDay, dayDeadline, formatRub } from '@thirty/domain';
import { DateTime } from 'luxon';
import { clock } from '../clock';
import { prisma } from '../db';
import { pushNotification } from '../modules/notifications';
import { getSetting, feature } from '../settings';
import { sendTemplate } from '../modules/bot';
import { LIVE_STATUSES, startOffer } from '../modules/billing';
import { generateCard } from '../modules/cards';
import { promoWindow } from '../modules/promos';
import { memberStats } from '../modules/rating';
import { chainTestUsers } from '../modules/chainTest';
import { trackerOfferDue } from '../modules/journey';

type Send = (userId: bigint, key: string, vars: Record<string, string | number>, dedupe: string) => Promise<unknown>;

const minutesAgo = (now: Date, m: number) => new Date(now.getTime() - m * 60_000);

async function templates() {
  const rows = await prisma.botMessageTemplate.findMany();
  return new Map(rows.map((t) => [t.key, t]));
}

const fmtPrice = (n: number) => n.toLocaleString('ru-RU');

/** Цены для текстов цепочки — из настроек тарифов, чтобы совпадали с фактической оплатой */
export async function priceVars() {
  const tariffs = await prisma.tariff.findMany({ where: { active: true } });
  const v: Record<string, string> = {};
  for (const t of tariffs) {
    v[`p${t.months}`] = fmtPrice(quote(t, true).price);
    v[`r${t.months}`] = fmtPrice(quote(t, false).price);
  }
  return v;
}

/** Кто уже купил или имеет действующую подписку — им цепочка не идёт */
async function payers(): Promise<Set<string>> {
  const [paid, live] = await Promise.all([
    prisma.payment.findMany({ where: { status: 'paid', kind: 'initial' }, select: { userId: true } }),
    prisma.subscription.findMany({ where: { status: { in: [...LIVE_STATUSES] } }, select: { userId: true } }),
  ]);
  return new Set([...paid, ...live].map((r) => r.userId.toString()));
}

const OFFER_STAGES = ['chain_02', 'chain_03', 'chain_04', 'chain_05', 'chain_06', 'chain_07'];
const AFTER_STAGES = ['chain_08', 'chain_09'];
/** Сколько можно опоздать с сообщением (если сервер был недоступен): старое не досылаем */
const LATE_OFFER_MIN = 20;
const LATE_AFTER_MIN = 12 * 60;
const FLOW_EVE_HOUR = 12;
/** Кто нажал /start, но за это время не дошёл до тарифов — таймер скидки запускается сам, чтобы пошла цепочка 02–09 */
const AUTO_OFFER_AFTER_MIN = 10;
/** Давние /start (до появления правила) таймер не получают: им остаются сообщения 10–11 перед стартом потока */
const AUTO_OFFER_WINDOW_MIN = 24 * 60;

/**
 * Дожимная цепочка до оплаты (ТЗ владельца 25.10).
 * 02–07 — от первого показа предложения с таймером (PriceOffer intro, время на сервере), 08–09 — после окончания акции.
 * Если человек нажал /start и за 10 минут не открыл тарифы, таймер запускается сам — цепочка идёт и ему.
 * 10–11 — за 2 и 1 день до старта ближайшего потока (в 12:00 по времени потока, задним числом не шлём).
 * Перед каждой отправкой — проверка оплаты; дедупликация по ключу; согласие на рекламу и блокировка бота — в sendTemplate.
 */
export async function runPrePurchaseChains(now = clock.now(), send: Send = sendTemplate) {
  if (!(await feature('chain_prepurchase'))) return;
  const tpl = await templates();
  const on = (k: string) => Boolean(tpl.get(k)?.enabled);
  const paid = await payers();
  const vars = await priceVars();
  // В режиме проверки цепочки владельцу сообщения приходят по /start подряд — расписание их не дублирует
  for (const id of await chainTestUsers()) paid.add(id);

  // Таймер для тех, кто не дошёл до тарифов: от первого /start (приветствие в журнале бота)
  const starters = await prisma.botMessageLog.findMany({
    where: { templateKey: 'welcome', sentAt: { gt: minutesAgo(now, AUTO_OFFER_WINDOW_MIN), lte: minutesAgo(now, AUTO_OFFER_AFTER_MIN) }, user: { offers: { none: { kind: 'intro' } } } },
    select: { userId: true },
  });
  for (const s of starters) if (!paid.has(s.userId.toString())) await startOffer(s.userId, now);

  // 02–09: персональный таймер
  const offers = await prisma.priceOffer.findMany({ where: { kind: 'intro', consumedAt: null, startedAt: { gt: minutesAgo(now, 10 * 24 * 60) } } });
  for (const o of offers) {
    const uid = o.userId.toString();
    if (paid.has(uid)) continue;
    const plan = [
      ...OFFER_STAGES.filter(on).map((k) => ({ key: k, due: o.startedAt.getTime() + tpl.get(k)!.delayMinutes * 60_000, late: LATE_OFFER_MIN })),
      ...AFTER_STAGES.filter(on).map((k) => ({ key: k, due: o.expiresAt.getTime() + tpl.get(k)!.delayMinutes * 60_000, late: LATE_AFTER_MIN })),
    ].sort((a, b) => a.due - b.due);
    // Только самое свежее наступившее сообщение и только если оно не устарело
    const idx = plan.findLastIndex((p) => p.due <= now.getTime());
    if (idx < 0) continue;
    const stage = plan[idx];
    const next = plan[idx + 1];
    if (now.getTime() > stage.due + stage.late * 60_000 || (next && now.getTime() >= next.due)) continue;
    // 02–06 имеют смысл, только пока акция действует
    if (OFFER_STAGES.slice(0, 5).includes(stage.key) && now >= o.expiresAt) continue;
    if (AFTER_STAGES.includes(stage.key)) {
      const promo = await prisma.priceOffer.findFirst({ where: { userId: o.userId, kind: 'promo', consumedAt: null, expiresAt: { gt: now } } });
      if (promo) continue;
    }
    await send(o.userId, stage.key, vars, `${stage.key}:${o.id}`);
  }

  // 10–11: ближайший поток
  const tz = await getSetting('flow.timezone');
  const today = localDate(now, tz);
  const hour = DateTime.fromJSDate(now, { zone: tz }).hour;
  if (hour < FLOW_EVE_HOUR) return;
  const nextStart = addMonths(`${today.slice(0, 7)}-01`, 1);
  for (const key of ['chain_10', 'chain_11']) {
    if (!on(key)) continue;
    const sendDay = addDays(nextStart, -Math.round(tpl.get(key)!.delayMinutes / (24 * 60)));
    if (sendDay !== today) continue;
    if (key === 'chain_11') {
      const start = await prisma.promo.findUnique({ where: { code: 'СТАРТ' } });
      if (!start || !(await promoWindow(start, now))) {
        console.warn('[chain] сообщение 11 пропущено: промокод СТАРТ сейчас не действует');
        continue;
      }
    }
    // Только те, кто пришёл в бот до дня отправки; в разгар личного таймера не мешаем цепочке 02–07
    const users = await prisma.user.findMany({
      where: { allowsWrite: true, botBlocked: false, marketingOptIn: true, deletedAt: null, createdAt: { lt: startOfLocalDay(sendDay, tz) } },
      select: { id: true },
    });
    for (const u of users) {
      if (paid.has(u.id.toString())) continue;
      const running = await prisma.priceOffer.findFirst({ where: { userId: u.id, kind: 'intro', consumedAt: null, expiresAt: { gt: now } } });
      if (running) continue;
      await send(u.id, key, vars, `${key}:${nextStart}:${u.id}`);
    }
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
        // День 14: предложение получить трекеры за отзыв (кому подарок ещё не выдан и отзыв не на проверке)
        if (dayNum === 14 && hour >= 19 && (await trackerOfferDue(m.userId))) await send(m.userId, 'trackers_offer', {}, `trackers_offer:${m.id}`);
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
