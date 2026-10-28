import { createHmac } from 'node:crypto';
import { addDays, flowBounds, flowDayNumber, fromDbDate, quote } from '@thirty/domain';
import { z } from 'zod';
import { clock } from '../clock';
import { config } from '../config';
import { prisma } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../http';
import { getSetting } from '../settings';
import { currentMembership, flowToday, planningMembership } from './flows';
import { goalStats, memberStats } from './rating';
import { serializeGoal } from './goals';
import { notify } from './notify';
import { notifyTrackerReview } from './adminBot';
import { signedMediaUrl } from '../lib/storage';
import { displayName } from './users';
import { track } from './analytics';

/**
 * Путь участника вокруг финала потока (ТЗ владельца 27.10):
 * ожидания от клуба (анкета, шаг 1), обратная связь на предпоследний день, итоги на последний день,
 * «Поставить новую цель» / «Вернуться по прежней цене» (40 минут), отзыв за трекеры (раз в 14 дней), карточка результатов.
 */

const TRACKER_PROMPT_EVERY_DAYS = 14;
const TRACKER_FIRST_DAY = 14;
export const COMEBACK_MINUTES = 40;

type MembershipWithFlow = NonNullable<Awaited<ReturnType<typeof currentMembership>>>;

function flowDays(m: MembershipWithFlow, now = clock.now()) {
  const startsOn = fromDbDate(m.flow.startsOn);
  const { endsOn, days } = flowBounds(startsOn);
  const today = flowToday(m.flow, now);
  return { startsOn, endsOn, days, today, day: flowDayNumber(startsOn, today) };
}

// ───────────── 1. Ожидания от клуба ─────────────

export const expectationInput = z.object({ expectation: z.string().trim().min(2, 'Расскажи, что хочешь получить от клуба').max(1000) });

/** Ответ сохраняется в текущем участии: у каждого потока свой ответ — так копится история */
export async function setExpectation(userId: bigint, input: z.infer<typeof expectationInput>) {
  const target = await planningMembership(userId);
  if (!target) throw forbidden('no_membership', 'Сначала выбери тариф');
  await prisma.flowMembership.update({ where: { id: target.id }, data: { expectation: input.expectation } });
  return { ok: true };
}

async function nextMembership(userId: bigint, after: Date) {
  return prisma.flowMembership.findFirst({ where: { userId, status: { in: ['reserved', 'registered', 'active'] }, flow: { startsOn: { gt: after } } }, include: { flow: true }, orderBy: { flow: { startsOn: 'asc' } } });
}

// ───────────── Подсказки на главной ─────────────

/** Что показать на главной: окно обратной связи (предпоследний и последний день), итоги, окно трекеров */
export async function homePrompts(userId: bigint, m: MembershipWithFlow) {
  const { endsOn, today, day } = flowDays(m);
  const running = ['active', 'finished'].includes(m.status);
  const feedbackDone = Boolean(await prisma.flowFeedback.findUnique({ where: { membershipId: m.id } }));
  const feedback = running && !feedbackDone && today >= addDays(endsOn, -1) && today <= endsOn;
  const finale = running && today >= endsOn;
  const trackers = m.status === 'active' && day >= TRACKER_FIRST_DAY && (await trackerPromptDue(userId));
  // Окно «Уже завтра заканчиваются…» — только в предпоследний день; в последний остаётся карточка на главной
  const feedbackPopup = feedback && today === addDays(endsOn, -1);
  const lastReview = await prisma.trackerReview.findFirst({ where: { userId, status: { not: 'replaced' } }, orderBy: { createdAt: 'desc' } });
  const trackersClarify = lastReview?.status === 'needs_info';
  return { feedback, feedbackPopup, feedbackDone, finale, finaleDone: Boolean(m.finalSubmittedAt), trackers, trackersClarify };
}

// ───────────── 2. Обратная связь на предпоследний день ─────────────

export const HELPED = ['Поддержка напарника', 'Общение в клубе', 'Мотивация и собственное желание'] as const;
export const HINDERED = ['Отсутствие напарника', 'Общение в клубе', 'Нехватка времени', 'Не рассчитала силы и время', 'Сложно было вернуться после пропуска'] as const;

const text = (max: number) => z.string().trim().min(1, 'Ответь, пожалуйста, на все вопросы').max(max);
export const feedbackInput = z.object({
  month: text(3000),
  helped: z.array(z.enum(HELPED)).max(HELPED.length).default([]),
  helpedOther: z.string().trim().max(500).optional(),
  hindered: z.array(z.enum(HINDERED)).max(HINDERED.length).default([]),
  hinderedOther: z.string().trim().max(500).optional(),
  benefit: text(3000),
  change: text(3000),
  needHelp: text(3000),
}).refine((v) => v.helped.length || v.helpedOther, { message: 'Выбери, что помогало, или напиши свой вариант', path: ['helped'] })
  .refine((v) => v.hindered.length || v.hinderedOther, { message: 'Выбери, что мешало, или напиши свой вариант', path: ['hindered'] });

export async function submitFeedback(userId: bigint, input: z.infer<typeof feedbackInput>) {
  const m = await currentMembership(userId);
  if (!m || !['active', 'finished'].includes(m.status)) throw forbidden('not_member');
  const { endsOn, today } = flowDays(m);
  if (today < addDays(endsOn, -1)) throw forbidden('feedback_not_open', 'Форма откроется на предпоследний день потока');
  if (await prisma.flowFeedback.findUnique({ where: { membershipId: m.id } })) throw conflict('feedback_done', 'Ты уже поделилась обратной связью — спасибо!');
  await prisma.flowFeedback.create({ data: { ...input, helpedOther: input.helpedOther || null, hinderedOther: input.hinderedOther || null, membershipId: m.id, userId, flowId: m.flowId, createdAt: clock.now() } });
  await track({ userId, eventName: 'feedback_submitted', flowId: m.flowId, dedupeKey: `feedback_submitted:${m.id}` });
  return { ok: true };
}

// ───────────── 3. Итоги потока ─────────────

/** Статистика и цели завершившегося потока — только из реальных данных */
export async function finaleData(userId: bigint) {
  const m = await currentMembership(userId);
  if (!m || !['active', 'finished'].includes(m.status)) throw forbidden('not_member');
  const { endsOn, today, days } = flowDays(m);
  if (today < endsOn) throw forbidden('finale_not_open', 'Итоги откроются в последний день потока');
  const stats = await memberStats(m.id, m.flow);
  const goals = await prisma.goal.findMany({ where: { membershipId: m.id }, include: { tasks: true }, orderBy: { sort: 'asc' } });
  const entry = await prisma.leaderboardEntry.findFirst({ where: { flowId: m.flowId, userId } });
  const participants = await prisma.leaderboardEntry.count({ where: { flowId: m.flowId } });
  const views = await Promise.all(goals.map(async (g) => {
    const s = serializeGoal(g);
    return {
      id: g.id,
      title: g.title,
      category: g.category,
      pointA: g.pointA,
      pointB: g.pointB,
      numeric: s.numeric,
      unit: s.unit,
      current: s.current,
      progress: s.progress,
      planPercent: Math.round((await goalStats(g.id, m.id, m.flow)).ratio * 100),
      outcome: g.finalOutcome,
    };
  }));
  // Достигнутые цели: отметка участника, а пока её нет — числовые цели со 100% прогресса
  const rated = views.some((g) => g.outcome);
  const achieved = rated ? views.filter((g) => g.outcome === 'full').length : views.filter((g) => g.numeric && (g.progress ?? 0) >= 100).length;
  const reportDays = await prisma.dailyReport.count({ where: { membershipId: m.id, status: 'accepted' } });
  return {
    membershipId: m.id,
    flow: { title: m.flow.title, days },
    stats: {
      reportDays,
      successfulDays: stats.successfulDays,
      percent: stats.scheduled > 0 ? Math.round(stats.ratio * 100) : null,
      longestStreak: stats.longestStreak,
      goalsTotal: views.length,
      goalsAchieved: rated || views.some((g) => g.numeric) ? achieved : null,
      rank: entry ? { place: entry.rank, of: participants } : null,
    },
    goals: views,
    result: m.finalResult,
    submitted: Boolean(m.finalSubmittedAt),
    expectation: m.expectation,
    next: await nextStep(userId, m),
  };
}

export const finaleInput = z.object({
  outcomes: z.array(z.object({ goalId: z.string().uuid(), outcome: z.enum(['full', 'partial', 'none']) })).min(1),
  result: z.string().trim().min(2, 'Напиши, какого результата удалось добиться').max(1000),
});

/** Оценка каждой цели и фактический результат; можно уточнять, пока не начался следующий поток */
export async function saveFinale(userId: bigint, input: z.infer<typeof finaleInput>) {
  const m = await currentMembership(userId);
  if (!m || !['active', 'finished'].includes(m.status)) throw forbidden('not_member');
  const { endsOn, today } = flowDays(m);
  if (today < endsOn) throw forbidden('finale_not_open', 'Итоги откроются в последний день потока');
  const goals = await prisma.goal.findMany({ where: { membershipId: m.id }, select: { id: true } });
  const ids = new Set(goals.map((g) => g.id));
  if (input.outcomes.length !== goals.length || input.outcomes.some((o) => !ids.has(o.goalId))) throw badRequest('all_goals_required', 'Оцени каждую цель');
  await prisma.$transaction([
    ...input.outcomes.map((o) => prisma.goal.update({ where: { id: o.goalId }, data: { finalOutcome: o.outcome, finalAchieved: o.outcome === 'full' } })),
    prisma.flowMembership.update({ where: { id: m.id }, data: { finalResult: input.result, finalSubmittedAt: m.finalSubmittedAt ?? clock.now() } }),
  ]);
  for (const o of input.outcomes.filter((x) => x.outcome === 'full')) await track({ userId, eventName: 'goal_completed', flowId: m.flowId, metadata: { goalId: o.goalId }, dedupeKey: `goal_completed:${o.goalId}` });
  return { ok: true, next: await nextStep(userId, m) };
}

// ───────────── 4. «Поставить новую цель» ─────────────

/**
 * Куда ведёт «Поставить новую цель»:
 * goals — оплачен следующий поток (анкета для него, старые цели не трогаем);
 * debt — продление не прошло, нужно оплатить долг; comeback — подписка закончилась (40 минут по прежней цене).
 */
async function nextStep(userId: bigint, m: MembershipWithFlow): Promise<{ kind: 'goals' | 'debt' | 'comeback'; flowStartsOn?: string }> {
  const next = await nextMembership(userId, m.flow.startsOn);
  if (next) return { kind: 'goals', flowStartsOn: fromDbDate(next.flow.startsOn) };
  const sub = await prisma.subscription.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
  if (sub?.status === 'past_due') return { kind: 'debt' };
  if (sub && ['prestart', 'active'].includes(sub.status) && sub.autoRenew) return { kind: 'goals' };
  return { kind: 'comeback' };
}

/** Подписка, после которой предлагается вернуться: последняя закончившаяся или отменённая */
async function endedSubscription(userId: bigint) {
  const sub = await prisma.subscription.findFirst({ where: { userId }, include: { tariff: true }, orderBy: { createdAt: 'desc' } });
  if (!sub) return null;
  if (sub.status === 'expired' || (sub.status === 'canceled_at_period_end' && !sub.autoRenew)) return sub;
  return null;
}

/** Предложение «Вернуться по прежней цене»: таймер 40 минут хранится на сервере и запускается один раз */
export async function comebackOffer(userId: bigint, start: boolean) {
  const sub = await endedSubscription(userId);
  if (!sub) return { available: false as const };
  const kind = `comeback:${sub.id}`;
  let offer = await prisma.priceOffer.findUnique({ where: { userId_kind: { userId, kind } } });
  const now = clock.now();
  if (!offer && start) {
    offer = await prisma.priceOffer
      .create({ data: { userId, kind, startedAt: now, expiresAt: new Date(now.getTime() + COMEBACK_MINUTES * 60_000), tariffId: sub.tariffId, amount: sub.renewalPrice } })
      .catch(async () => prisma.priceOffer.findUniqueOrThrow({ where: { userId_kind: { userId, kind } } }));
  }
  const msLeft = offer && !offer.consumedAt ? Math.max(0, offer.expiresAt.getTime() - now.getTime()) : 0;
  const tariffs = await prisma.tariff.findMany({ where: { active: true }, orderBy: { months: 'asc' } });
  return {
    available: true as const,
    started: Boolean(offer),
    active: msLeft > 0,
    msLeft,
    expiresAt: offer?.expiresAt.toISOString() ?? null,
    tariff: { id: sub.tariffId, title: sub.tariff.title, months: sub.tariff.months },
    price: sub.renewalPrice,
    // Все три тарифа — по тем же условиям, что и раньше (акционные или обычные цены); у прежнего тарифа — ровно его цена
    tariffs: tariffs.map((t) => {
      const q = quote(t, sub.priceVariant === 'promo');
      const price = t.id === sub.tariffId ? sub.renewalPrice : q.price;
      return { id: t.id, title: t.title, months: t.months, badge: t.badge, price, comparison: q.comparison, savingsPercent: q.comparison > 0 ? Math.round((1 - price / q.comparison) * 100) : 0, current: t.id === sub.tariffId };
    }),
  };
}

/** Цена тарифа по предложению «вернуться по прежней цене» (null — тариф недоступен) */
export async function comebackPrice(offer: { kind: string; tariffId: string | null; amount: number | null }, tariffId: string) {
  if (offer.tariffId === tariffId && offer.amount) return { price: offer.amount, variant: undefined as string | undefined };
  const sub = await prisma.subscription.findUnique({ where: { id: offer.kind.slice('comeback:'.length) } });
  const t = await prisma.tariff.findUnique({ where: { id: tariffId } });
  if (!sub || !t || !t.active) return null;
  const q = quote(t, sub.priceVariant === 'promo');
  return { price: q.price, variant: q.variant as string | undefined };
}

/** Для оформления оплаты: действующее предложение «по прежней цене» (проверка на сервере) */
export async function activeComeback(userId: bigint) {
  const offers = await prisma.priceOffer.findMany({ where: { userId, kind: { startsWith: 'comeback:' }, consumedAt: null, expiresAt: { gt: clock.now() } } });
  return offers[0] ?? null;
}

// ───────────── 5. Отзыв за трекеры ─────────────

async function trackerPromptDue(userId: bigint) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { trackerPromptAt: true, trackersGrantedAt: true } });
  if (!u || u.trackersGrantedAt) return false;
  const last = await prisma.trackerReview.findFirst({ where: { userId, status: { not: 'replaced' } }, orderBy: { createdAt: 'desc' } });
  // На проверке или ждём новый скриншот — общие напоминания не показываем
  if (last && (last.status === 'pending' || last.status === 'needs_info')) return false;
  if (!u.trackerPromptAt) return true;
  return clock.now().getTime() - u.trackerPromptAt.getTime() >= TRACKER_PROMPT_EVERY_DAYS * 24 * 3600_000;
}

/** Сообщение бота на 14-й день: подарок ещё не выдан и отзыв не на проверке */
export async function trackerOfferDue(userId: bigint) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { trackersGrantedAt: true } });
  if (!u || u.trackersGrantedAt) return false;
  const last = await prisma.trackerReview.findFirst({ where: { userId, status: { not: 'replaced' } }, orderBy: { createdAt: 'desc' } });
  return !last || last.status === 'needs_info';
}

/** Окно показали — следующий раз через 14 дней */
export async function trackerPrompted(userId: bigint) {
  await prisma.user.update({ where: { id: userId }, data: { trackerPromptAt: clock.now() } });
  await track({ userId, eventName: 'trackers_offer_view', metadata: { place: 'popup' } });
  return { ok: true };
}

export async function trackerState(userId: bigint) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { trackersGrantedAt: true } });
  const last = await prisma.trackerReview.findFirst({ where: { userId, status: { not: 'replaced' } }, orderBy: { createdAt: 'desc' } });
  const status = u.trackersGrantedAt ? 'granted' : last?.status ?? 'none';
  const support = await getSetting('support.username');
  return {
    status,
    screenshot: last ? signedMediaUrl(last.mediaId) : null,
    supportUrl: `https://t.me/${support.replace(/^@/, '')}`,
    links: status === 'granted' ? await getSetting('trackers.links') : null,
  };
}

export const trackerInput = z.object({ mediaId: z.string().uuid() });

export async function submitTrackerReview(userId: bigint, input: z.infer<typeof trackerInput>) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.trackersGrantedAt) throw conflict('trackers_granted', 'Трекеры уже у тебя 💜');
  const last = await prisma.trackerReview.findFirst({ where: { userId, status: { not: 'replaced' } }, orderBy: { createdAt: 'desc' } });
  if (last?.status === 'pending') throw conflict('review_pending', 'Отзыв уже на проверке');
  const media = await prisma.mediaFile.findUnique({ where: { id: input.mediaId } });
  if (!media || media.ownerId !== userId) throw badRequest('media_not_found', 'Прикрепи скриншот отзыва');
  // Новый скриншот заменяет заявку, по которой просили уточнение
  const r = await prisma.$transaction(async (tx) => {
    await tx.trackerReview.updateMany({ where: { userId, status: 'needs_info' }, data: { status: 'replaced' } });
    return tx.trackerReview.create({ data: { userId, mediaId: media.id, createdAt: clock.now() } });
  });
  await notifyTrackerReview(r.id).catch((e) => console.error('[admin-bot]', (e as Error).message));
  await track({ userId, eventName: 'trackers_review_sent' });
  return trackerState(userId);
}

/** Решение администратора: выдать трекеры (один раз) или запросить новый скриншот */
export async function decideTrackerReview(id: string, decision: 'grant' | 'clarify', admin: string) {
  const r = await prisma.trackerReview.findUnique({ where: { id } });
  if (!r) throw notFound();
  if (r.status !== 'pending') throw conflict('already_decided', r.status === 'granted' ? 'Трекеры уже выданы' : 'Уже запрошено уточнение');
  const now = clock.now();
  if (decision === 'clarify') {
    const res = await prisma.trackerReview.updateMany({ where: { id, status: 'pending' }, data: { status: 'needs_info', decidedBy: admin, decidedAt: now } });
    if (!res.count) throw conflict('already_decided');
    await notify(r.userId, 'trackers_need_info', {}, `trackers_need_info:${id}`);
    return { ok: true };
  }
  // Защита от повторной выдачи: заявка и пользователь меняются атомарно, только если подарок ещё не выдан
  const granted = await prisma.$transaction(async (tx) => {
    const res = await tx.trackerReview.updateMany({ where: { id, status: 'pending' }, data: { status: 'granted', decidedBy: admin, decidedAt: now } });
    if (!res.count) return false;
    const u = await tx.user.updateMany({ where: { id: r.userId, trackersGrantedAt: null }, data: { trackersGrantedAt: now } });
    return u.count > 0;
  });
  if (!granted) throw conflict('already_granted', 'Трекеры уже выданы');
  await track({ userId: r.userId, eventName: 'trackers_issued', dedupeKey: `trackers_issued:${r.userId}` });
  const links = await getSetting('trackers.links');
  // Одна таблица на все три трекера — одна ссылка; разные — по ссылке на каждый
  const same = links.tasks && links.tasks === links.week && links.week === links.finance;
  const block = same
    ? `🎁 Трекер задач\n🎁 Трекер недели\n🎁 Трекер финансов\n\nЗабирай здесь: ${links.tasks}`
    : `🎁 Трекер задач — ${links.tasks || '—'}\n🎁 Трекер недели — ${links.week || '—'}\n🎁 Трекер финансов — ${links.finance || '—'}`;
  await notify(r.userId, 'trackers_granted', { links: block }, `trackers_granted:${r.userId}`);
  return { ok: true };
}

export async function trackerReviewCard(id: string) {
  const r = await prisma.trackerReview.findUnique({ where: { id } });
  if (!r) return null;
  const u = await prisma.user.findUnique({ where: { id: r.userId } });
  return { r, name: u ? displayName(u) : String(r.userId), username: u?.username ?? null };
}

// ───────────── 6. Карточка результатов для сторис ─────────────

export const resultCardInput = z.object({
  name: z.string().trim().max(40).optional(),
  result: z.string().trim().max(60).optional(),
  showDays: z.boolean().default(true),
  showGoal: z.boolean().default(true),
  showPercent: z.boolean().default(false),
  showRank: z.boolean().default(false),
});

export interface ResultCard {
  name?: string;
  result?: string;
  days?: number;
  goal?: string;
  percent?: number;
  rank?: string;
  link: string;
}

/** Собирает карточку из реальных данных и правок участника (правки в базу не пишутся) */
export async function buildResultCard(userId: bigint, input: z.infer<typeof resultCardInput>): Promise<ResultCard> {
  const f = await finaleData(userId);
  const link = await getSetting('stories.botLink');
  const full = f.goals.filter((g) => g.outcome === 'full').length;
  const partial = f.goals.some((g) => g.outcome === 'partial');
  const goalText = f.goals.length === 0 ? undefined : full === f.goals.length ? (f.goals.length > 1 ? 'Все цели достигнуты' : 'Цель достигнута') : full > 0 ? `Достигнуто целей: ${full} из ${f.goals.length}` : partial ? 'Цель достигнута частично' : undefined;
  const rank = f.stats.rank ? (f.stats.rank.place <= 3 ? `${f.stats.rank.place}-е место в рейтинге` : `Топ-${Math.max(5, Math.ceil(f.stats.rank.place / 5) * 5)} участников`) : undefined;
  return {
    name: input.name || undefined,
    result: input.result || f.result || undefined,
    days: input.showDays ? f.stats.reportDays : undefined,
    goal: input.showGoal ? goalText : undefined,
    percent: input.showPercent && f.stats.percent !== null ? f.stats.percent : undefined,
    rank: input.showRank ? rank : undefined,
    link,
  };
}

/** Подписанная ссылка на PNG: содержимое карточки внутри токена, без id и персональных данных из базы */
export function resultCardToken(card: ResultCard) {
  const body = Buffer.from(JSON.stringify(card)).toString('base64url');
  const sig = createHmac('sha256', config.MEDIA_SIGNING_SECRET).update(`rc.${body}`).digest('base64url').slice(0, 22);
  return `${body}.${sig}`;
}

export function readResultCardToken(token: string): ResultCard | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', config.MEDIA_SIGNING_SECRET).update(`rc.${body}`).digest('base64url').slice(0, 22);
  if (expected !== sig) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as ResultCard;
  } catch {
    return null;
  }
}

