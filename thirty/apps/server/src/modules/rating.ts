import { computeStats, fromDbDate, isPerfect, rank, flowBounds, weekStats, participationDays, rankWeekly, startOfIsoWeek, addDays, localDate, toDbDate, type ISODate, type MemberStats } from '@thirty/domain';
import { getSetting } from '../settings';
import { displayName } from './users';
import type { Flow } from '@prisma/client';
import { clock } from '../clock';
import { prisma } from '../db';
import { flowToday, memberWindow } from './flows';

/** Факты участника из БД → доменный расчёт. Отклонённые модерацией отчёты не засчитываются. */
export async function loadFacts(membershipId: string, flow: Flow, now = clock.now()) {
  const [occ, reports, m] = await Promise.all([
    prisma.taskOccurrence.findMany({ where: { membershipId }, select: { windowStart: true, windowEnd: true, status: true, taskId: true } }),
    prisma.dailyReport.findMany({ where: { membershipId, status: 'accepted' }, select: { date: true } }),
    prisma.flowMembership.findUnique({ where: { id: membershipId }, select: { startsOn: true } }),
  ]);
  // Личный челлендж: 30 дней от личной даты старта
  const w = memberWindow({ startsOn: m?.startsOn ?? null, flow }, now);
  return {
    flowStart: w.start,
    flowEnd: w.end,
    today: flowToday(flow, now),
    occurrences: occ.map((o) => ({ windowStart: fromDbDate(o.windowStart), windowEnd: fromDbDate(o.windowEnd), done: o.status === 'done', taskId: o.taskId })),
    reportDates: reports.map((r) => fromDbDate(r.date)),
  };
}

export async function memberStats(membershipId: string, flow: Flow): Promise<MemberStats> {
  return computeStats(await loadFacts(membershipId, flow));
}

/** Статистика по одной цели (карточка цели S20) */
export async function goalStats(goalId: string, membershipId: string, flow: Flow) {
  const facts = await loadFacts(membershipId, flow);
  const tasks = await prisma.task.findMany({ where: { goalId }, select: { id: true } });
  const ids = new Set(tasks.map((t) => t.id));
  return computeStats({ ...facts, occurrences: facts.occurrences.filter((o) => ids.has(o.taskId)) });
}

export interface LeaderRow {
  userId: string;
  name: string;
  photoUrl: string | null;
  ratio: number;
  completed: number;
  scheduled: number;
  successfulDays: number;
  missedReports: number;
  longestStreak: number;
  currentStreak: number;
  perfectSoFar: boolean;
  goals: number;
  rank: number;
}

/**
 * Рейтинг потока: пересчёт для всех активных участников и снапшот в LeaderboardEntry.
 * 1000 участников × 3 цели × 31 день ≈ 100k строк — один запрос, расчёт в памяти.
 */
export async function computeLeaderboard(flowId: string, now = clock.now()): Promise<LeaderRow[]> {
  const flow = await prisma.flow.findUniqueOrThrow({ where: { id: flowId } });
  const observers = await (await import('./observers')).observerIds();
  const members = (await prisma.flowMembership.findMany({
    where: { flowId, status: { in: ['active', 'finished', 'registered'] } },
    include: { user: true, _count: { select: { goals: true } } },
  })).filter((m) => !observers.has(m.userId.toString()));
  const ids = members.map((m) => m.id);
  const [occ, reports] = await Promise.all([
    prisma.taskOccurrence.findMany({ where: { membershipId: { in: ids } }, select: { membershipId: true, windowStart: true, windowEnd: true, status: true } }),
    prisma.dailyReport.findMany({ where: { membershipId: { in: ids }, status: 'accepted' }, select: { membershipId: true, date: true, late: true } }),
  ]);
  const byM = new Map<string, { o: typeof occ; r: string[]; onTime: number }>();
  for (const id of ids) byM.set(id, { o: [], r: [], onTime: 0 });
  for (const o of occ) byM.get(o.membershipId)!.o.push(o);
  for (const r of reports) {
    const d = byM.get(r.membershipId)!;
    d.r.push(fromDbDate(r.date));
    if (!r.late) d.onTime++;
  }
  const startsOn = fromDbDate(flow.startsOn);
  const endsOn = flowBounds(startsOn).endsOn;
  const today = flowToday(flow, now);
  const rows = members.map((m) => {
    const d = byM.get(m.id)!;
    const s = computeStats({
      flowStart: startsOn,
      flowEnd: endsOn,
      today,
      occurrences: d.o.map((o) => ({ windowStart: fromDbDate(o.windowStart), windowEnd: fromDbDate(o.windowEnd), done: o.status === 'done' })),
      reportDates: d.r,
    });
    return {
      userId: m.userId.toString(),
      name: m.user.displayName || [m.user.firstName, m.user.lastName].filter(Boolean).join(' '),
      photoUrl: m.user.photoUrl,
      ratio: s.ratio,
      reportDays: d.onTime,
      completed: s.completed,
      scheduled: s.scheduled,
      successfulDays: s.successfulDays,
      missedReports: s.missedReports,
      longestStreak: s.longestStreak,
      currentStreak: s.currentStreak,
      perfectSoFar: s.perfectSoFar,
      goals: m._count.goals,
      finalSubmittedAt: m.finalSubmittedAt?.toISOString() ?? null,
    };
  });
  const ranked = rank(rows);
  await prisma.$transaction([
    prisma.leaderboardEntry.deleteMany({ where: { flowId } }),
    prisma.leaderboardEntry.createMany({
      data: ranked.map((r) => ({
        flowId,
        userId: BigInt(r.userId),
        ratio: r.ratio,
        completed: r.completed,
        scheduled: r.scheduled,
        successfulDays: r.successfulDays,
        missedReports: r.missedReports,
        longestStreak: r.longestStreak,
        currentStreak: r.currentStreak,
        perfectSoFar: r.perfectSoFar,
        reportDays: r.reportDays,
        rank: r.rank,
        computedAt: now,
      })),
    }),
  ]);
  return ranked;
}

/** Финал потока: все с идеальным результатом и подтверждёнными целями → очередь ручной проверки */
export async function selectPrizeCandidates(flowId: string, now = clock.now()) {
  const flow = await prisma.flow.findUniqueOrThrow({ where: { id: flowId } });
  const members = await prisma.flowMembership.findMany({
    where: { flowId, status: { in: ['active', 'finished'] }, finalSubmittedAt: { not: null } },
    include: { goals: true },
  });
  const board = await computeLeaderboard(flowId, now);
  const byUser = new Map(board.map((r) => [r.userId, r]));
  let created = 0;
  for (const m of members) {
    const facts = await loadFacts(m.id, flow, now);
    if (!isPerfect(facts, m.goals.map((g) => g.finalAchieved))) continue;
    const row = byUser.get(m.userId.toString());
    const exists = await prisma.prizeCandidate.findUnique({ where: { flowId_userId: { flowId, userId: m.userId } } });
    if (exists) continue;
    await prisma.prizeCandidate.create({
      data: {
        flowId,
        userId: m.userId,
        tiebreak: { ratio: row?.ratio ?? 1, successfulDays: row?.successfulDays ?? 0, longestStreak: row?.longestStreak ?? 0, finalSubmittedAt: m.finalSubmittedAt?.toISOString() ?? null },
      },
    });
    created++;
  }
  return { candidates: created };
}

// ───────────── Недельный рейтинг дисциплины (ТЗ 02.11) ─────────────

/** Окно личного челленджа участника (пока — даты потока; с личными стартами — своя дата и 30 дней) */
export function challengeWindow(m: { flow: Flow; startsOn?: Date | null }) {
  const w = memberWindow({ startsOn: m.startsOn ?? null, flow: m.flow });
  return { start: w.start, end: w.end };
}

/** Сколько дней участия нужно, чтобы попасть в основной рейтинг недели */
export const WEEKLY_MIN_DAYS = 7;

/**
 * Рейтинг недели (пн–вс) для всего клуба: % выполнения запланированных действий.
 * В топ попадают участники с 7+ днями в челлендже; свой результат виден всегда.
 */
export async function weeklyLeaderboard(viewerId: bigint | null, weekStartArg?: ISODate, now = clock.now()) {
  const tz = await getSetting('flow.timezone');
  const today = localDate(now, tz);
  const weekStart = weekStartArg ? startOfIsoWeek(weekStartArg) : startOfIsoWeek(today);
  const weekEnd = addDays(weekStart, 6);
  const observers = await (await import('./observers')).observerIds();
  const members = (await prisma.flowMembership.findMany({
    where: { status: { in: ['active', 'finished', 'registered'] }, goalsLockedAt: { not: null } },
    include: { flow: true, user: true },
  })).filter((m) => !observers.has(m.userId.toString()) && !m.user.deletedAt);
  const inWeek = members.filter((m) => {
    const w = challengeWindow(m);
    return w.start <= weekEnd && w.end >= weekStart;
  });
  const ids = inWeek.map((m) => m.id);
  const [occ, reports] = await Promise.all([
    prisma.taskOccurrence.findMany({ where: { membershipId: { in: ids }, windowEnd: { gte: toDbDate(weekStart), lte: toDbDate(weekEnd) } }, select: { membershipId: true, windowStart: true, windowEnd: true, status: true, taskId: true } }),
    prisma.dailyReport.findMany({ where: { membershipId: { in: ids }, status: 'accepted', date: { gte: toDbDate(weekStart), lte: toDbDate(weekEnd) } }, select: { membershipId: true, date: true } }),
  ]);
  const byUser = new Map<string, { user: (typeof inWeek)[number]['user']; planned: number; done: number; fullDays: number; days: number }>();
  for (const m of inWeek) {
    const w = challengeWindow(m);
    const s = weekStats(
      {
        flowStart: w.start, flowEnd: w.end, today,
        occurrences: occ.filter((o) => o.membershipId === m.id).map((o) => ({ windowStart: fromDbDate(o.windowStart), windowEnd: fromDbDate(o.windowEnd), done: o.status === 'done', taskId: o.taskId })),
        reportDates: reports.filter((r) => r.membershipId === m.id).map((r) => fromDbDate(r.date)),
      },
      weekStart, weekEnd,
    );
    const key = m.userId.toString();
    const agg = byUser.get(key) ?? { user: m.user, planned: 0, done: 0, fullDays: 0, days: 0 };
    agg.planned += s.planned;
    agg.done += s.done;
    agg.fullDays += s.fullDays;
    // дни участия — по всем челленджам до конца рассматриваемой недели
    agg.days = Math.max(agg.days, participationDays(w.start, w.end, weekEnd < today ? addDays(weekEnd, 1) : today));
    byUser.set(key, agg);
  }
  const all = [...byUser.entries()].map(([userId, a]) => ({
    userId,
    name: displayName(a.user),
    username: a.user.username,
    photoUrl: a.user.photoUrl,
    percent: a.planned > 0 ? Math.round((a.done / a.planned) * 100) : 0,
    hasPlan: a.planned > 0,
    fullDays: a.fullDays,
    done: a.done,
    planned: a.planned,
    days: a.days,
  }));
  const eligible = all.filter((r) => r.days >= WEEKLY_MIN_DAYS && r.hasPlan);
  const rows = rankWeekly(eligible);
  const mine = viewerId ? all.find((r) => r.userId === viewerId.toString()) ?? null : null;
  const myRow = mine ? rows.find((r) => r.userId === mine.userId) ?? null : null;
  return {
    week: { from: weekStart, to: weekEnd, current: weekStart === startOfIsoWeek(today) },
    minDays: WEEKLY_MIN_DAYS,
    rows,
    me: mine ? { ...mine, rank: myRow?.rank ?? null, eligible: Boolean(myRow), daysLeft: Math.max(0, WEEKLY_MIN_DAYS - mine.days) } : null,
  };
}
