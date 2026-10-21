import { computeStats, fromDbDate, isPerfect, rank, flowBounds, type MemberStats } from '@thirty/domain';
import type { Flow } from '@prisma/client';
import { clock } from '../clock';
import { prisma } from '../db';
import { flowToday } from './flows';

/** Факты участника из БД → доменный расчёт. Отклонённые модерацией отчёты не засчитываются. */
export async function loadFacts(membershipId: string, flow: Flow, now = clock.now()) {
  const [occ, reports] = await Promise.all([
    prisma.taskOccurrence.findMany({ where: { membershipId }, select: { windowStart: true, windowEnd: true, status: true, taskId: true } }),
    prisma.dailyReport.findMany({ where: { membershipId, status: 'accepted' }, select: { date: true } }),
  ]);
  const startsOn = fromDbDate(flow.startsOn);
  return {
    flowStart: startsOn,
    flowEnd: flowBounds(startsOn).endsOn,
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
  const members = await prisma.flowMembership.findMany({
    where: { flowId, status: { in: ['active', 'finished', 'registered'] } },
    include: { user: true, _count: { select: { goals: true } } },
  });
  const ids = members.map((m) => m.id);
  const [occ, reports] = await Promise.all([
    prisma.taskOccurrence.findMany({ where: { membershipId: { in: ids } }, select: { membershipId: true, windowStart: true, windowEnd: true, status: true } }),
    prisma.dailyReport.findMany({ where: { membershipId: { in: ids }, status: 'accepted' }, select: { membershipId: true, date: true } }),
  ]);
  const byM = new Map<string, { o: typeof occ; r: string[] }>();
  for (const id of ids) byM.set(id, { o: [], r: [] });
  for (const o of occ) byM.get(o.membershipId)!.o.push(o);
  for (const r of reports) byM.get(r.membershipId)!.r.push(fromDbDate(r.date));
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
