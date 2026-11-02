import { fromDbDate, flowBounds, localDate, daysBetween } from '@thirty/domain';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { clock } from '../clock';
import { currentMembership } from './flows';
import { prisma } from '../db';
import { badRequest, forbidden, notFound } from '../http';
import { getSetting } from '../settings';
import { loadReport, reportInclude, serializeReport } from './reports';
import { challengeWindow, memberStats } from './rating';
import { scheduleLabel } from './goals';
import { displayName } from './users';

export const REACTIONS = ['🔥', '💪', '👏', '❤️'] as const;

/** Лента: принятые отчёты активных потоков, новые сверху или популярные за 3 дня */
export async function feed(params: { cursor?: string; sort: 'new' | 'popular'; flowId?: string; limit?: number }) {
  const tz = await getSetting('flow.timezone');
  const today = localDate(clock.now(), tz);
  const activeFlows = (await prisma.flow.findMany({ where: { status: 'active' } })).filter((f) => fromDbDate(f.startsOn) <= today && flowBounds(fromDbDate(f.startsOn)).endsOn >= today);
  const flowIds = params.flowId ? [params.flowId] : activeFlows.map((f) => f.id);
  const limit = Math.min(params.limit ?? 20, 50);
  const where: Prisma.DailyReportWhereInput = {
    status: 'accepted',
    membership: { flowId: { in: flowIds }, status: { not: 'revoked' }, user: { deletedAt: null } },
    items: { some: {} },
  };
  if (params.sort === 'popular') {
    where.createdAt = { gt: new Date(clock.now().getTime() - 3 * 24 * 3600_000) };
    const rows = await prisma.dailyReport.findMany({ where, include: reportInclude, take: 200 });
    rows.sort((a, b) => b.reactions.length + b._count.comments * 2 - (a.reactions.length + a._count.comments * 2));
    const offset = Number(params.cursor ?? 0) || 0;
    const page = rows.slice(offset, offset + limit);
    return { items: page.map(serializeReport), nextCursor: offset + limit < rows.length ? String(offset + limit) : null };
  }
  const rows = await prisma.dailyReport.findMany({
    where,
    include: reportInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
  });
  const next = rows.length > limit ? rows[limit - 1].id : null;
  return { items: rows.slice(0, limit).map(serializeReport), nextCursor: next };
}

export async function react(userId: bigint, reportId: string, emoji: string) {
  if (!(REACTIONS as readonly string[]).includes(emoji)) throw badRequest('bad_emoji');
  const r = await prisma.dailyReport.findUnique({ where: { id: reportId } });
  if (!r || r.status !== 'accepted') throw notFound();
  const where = { reportId_userId_emoji: { reportId, userId, emoji } };
  const existing = await prisma.reportReaction.findUnique({ where });
  if (existing) await prisma.reportReaction.delete({ where });
  else await prisma.reportReaction.create({ data: { reportId, userId, emoji } });
  return { active: !existing };
}

export const commentInput = z.object({ text: z.string().trim().min(1).max(1000) });

/** Комментировать могут только участники с оплаченным членством (антиспам) */
export async function addComment(userId: bigint, reportId: string, text: string) {
  const isMember = await prisma.flowMembership.findFirst({ where: { userId, status: { in: ['registered', 'active', 'finished'] } } });
  if (!isMember) throw forbidden('members_only', 'Комментировать могут участники клуба');
  const recent = await prisma.reportComment.count({ where: { userId, createdAt: { gt: new Date(clock.now().getTime() - 60_000) } } });
  if (recent >= 5) throw forbidden('too_fast', 'Слишком много комментариев, подождите минуту');
  const r = await prisma.dailyReport.findUnique({ where: { id: reportId } });
  if (!r || r.status !== 'accepted') throw notFound();
  return prisma.reportComment.create({ data: { reportId, userId, text } });
}

export async function comments(reportId: string) {
  const rows = await prisma.reportComment.findMany({ where: { reportId, hidden: false }, include: { user: true }, orderBy: { createdAt: 'asc' }, take: 200 });
  return rows.map((c) => ({ id: c.id, text: c.text, createdAt: c.createdAt, user: { id: c.userId.toString(), name: displayName(c.user), photoUrl: c.user.photoUrl } }));
}

export const complaintInput = z.object({
  kind: z.enum(['report', 'comment', 'buddy', 'user']),
  reportId: z.string().uuid().optional(),
  targetUserId: z.string().regex(/^\d+$/).optional(),
  reason: z.string().trim().min(3).max(1000),
});

export async function complain(userId: bigint, input: z.infer<typeof complaintInput>) {
  const open = await prisma.complaint.count({ where: { reporterId: userId, createdAt: { gt: new Date(clock.now().getTime() - 3600_000) } } });
  if (open >= 10) throw forbidden('too_many');
  return prisma.complaint.create({
    data: { reporterId: userId, kind: input.kind, reportId: input.reportId, targetUserId: input.targetUserId ? BigInt(input.targetUserId) : undefined, reason: input.reason },
  });
}

export async function reportDetails(id: string) {
  const r = await loadReport(id);
  if (!r || r.status !== 'accepted') throw notFound();
  return { report: serializeReport(r), comments: await comments(id) };
}

/**
 * Поиск участников всех потоков с учётом видимости: hidden — не в поиске;
 * members — только для участников того же потока. Фильтр по дате старта потока, городу, категории цели.
 */
/**
 * Текущее участие для профиля и списка: идущий сейчас челлендж; если нет — последний начавшийся; иначе ближайший будущий.
 * (При оплате нескольких месяцев сразу есть участия и в будущих потоках — показывать нужно текущий, а не самый поздний.)
 */
function pickCurrent<T extends { flow: Parameters<typeof challengeWindow>[0]['flow'] }>(list: T[], today: string): T | undefined {
  const w = (m: T) => challengeWindow(m);
  const running = list.find((m) => w(m).start <= today && w(m).end >= today);
  if (running) return running;
  const started = list.filter((m) => w(m).start <= today).sort((a, b) => (w(a).start < w(b).start ? 1 : -1))[0];
  if (started) return started;
  return [...list].sort((a, b) => (w(a).start > w(b).start ? 1 : -1))[0];
}

export async function participants(viewerId: bigint, q: { q?: string; flowStart?: string; city?: string; category?: string; cursor?: string; buddy?: string }) {
  const viewerFlows = (await prisma.flowMembership.findMany({ where: { userId: viewerId, status: { not: 'revoked' } }, select: { flowId: true } })).map((m) => m.flowId);
  const membershipFilter: Prisma.FlowMembershipWhereInput = { status: { in: ['registered', 'active', 'finished'] } };
  if (q.flowStart && /^\d{4}-\d{2}-\d{2}$/.test(q.flowStart)) membershipFilter.flow = { startsOn: new Date(`${q.flowStart}T00:00:00Z`) };
  if (q.category) membershipFilter.goals = { some: { category: q.category as never, isPublic: true } };
  const observers = [...(await (await import('./observers')).observerIds())].map((x) => BigInt(x));
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(observers.length ? { id: { notIn: observers } } : {}),
    memberships: { some: membershipFilter },
    OR: [{ visibility: 'public' }, { visibility: 'members', memberships: { some: { flowId: { in: viewerFlows } } } }],
  };
  const and: Prisma.UserWhereInput[] = [];
  // Фильтр по бадди: без пары / с бадди (активная пара в любом потоке)
  if (q.buddy === 'free' || q.buddy === 'paired') {
    const pairedIds = [...new Set((await prisma.buddyAssignment.findMany({ select: { userId: true } })).map((a) => a.userId))];
    and.push(q.buddy === 'free' ? { id: { notIn: pairedIds } } : { id: { in: pairedIds } });
  }
  if (q.q) q.q = q.q.trim().replace(/^@+/, '');
  if (q.q) and.push({ OR: [{ firstName: { contains: q.q, mode: 'insensitive' } }, { lastName: { contains: q.q, mode: 'insensitive' } }, { displayName: { contains: q.q, mode: 'insensitive' } }, { username: { contains: q.q, mode: 'insensitive' } }] });
  if (q.city) and.push({ city: { equals: q.city, mode: 'insensitive' } });
  if (and.length) where.AND = and;
  const rows = await prisma.user.findMany({
    where,
    take: 31,
    ...(q.cursor ? { cursor: { id: BigInt(q.cursor) }, skip: 1 } : {}),
    orderBy: { id: 'asc' },
    include: { memberships: { where: { status: { not: 'revoked' } }, include: { flow: true, goals: { where: { isPublic: true } } }, orderBy: { flow: { startsOn: 'desc' } } } },
  });
  const todayL = localDate(clock.now(), await getSetting('flow.timezone'));
  // в списке — текущее участие (а не самое позднее оплаченное)
  for (const u of rows) {
    const cur = pickCurrent(u.memberships, todayL);
    u.memberships = cur ? [cur] : [];
  }
  const page = rows.slice(0, 30);
  const entries = await prisma.leaderboardEntry.findMany({
    where: { OR: page.filter((u) => u.memberships[0]).map((u) => ({ userId: u.id, flowId: u.memberships[0].flowId })) },
  });
  const pct = new Map(entries.map((e) => [`${e.flowId}:${e.userId}`, Math.round(e.ratio * 100)]));
  return {
    items: page.map((u) => ({
      id: u.id.toString(),
      name: displayName(u),
      photoUrl: u.photoUrl,
      city: u.city,
      flowStart: u.memberships[0] ? fromDbDate(u.memberships[0].flow.startsOn) : null,
      flowTitle: u.memberships[0]?.flow.title ?? null,
      categories: [...new Set(u.memberships[0]?.goals.map((g) => g.category) ?? [])],
      goal: u.memberships[0]?.goals.sort((a, b) => a.sort - b.sort)[0]?.title ?? null,
      percent: u.memberships[0] ? (pct.get(`${u.memberships[0].flowId}:${u.id}`) ?? null) : null,
      sixMonthBadge: u.sixMonthBadge,
    })),
    nextCursor: rows.length > 30 ? rows[29].id.toString() : null,
  };
}

export async function participantProfile(viewerId: bigint, id: string) {
  if (!/^\d+$/.test(id)) throw notFound();
  const u = await prisma.user.findUnique({ where: { id: BigInt(id) } });
  if (!u || u.deletedAt) throw notFound();
  const memberships = await prisma.flowMembership.findMany({ where: { userId: u.id, status: { not: 'revoked' } }, include: { flow: true, goals: { include: { tasks: { orderBy: { createdAt: 'asc' } } } } }, orderBy: { flow: { startsOn: 'desc' } } });
  const viewerFlows = new Set((await prisma.flowMembership.findMany({ where: { userId: viewerId }, select: { flowId: true } })).map((m) => m.flowId));
  const self = viewerId === u.id;
  const visible = self || u.visibility === 'public' || (u.visibility === 'members' && memberships.some((m) => viewerFlows.has(m.flowId)));
  if (!visible) return { id, name: displayName(u), hidden: true };
  const today = localDate(clock.now(), await getSetting('flow.timezone'));
  const current = pickCurrent(memberships, today);
  const stats = current && ['active', 'finished'].includes(current.status) ? await memberStats(current.id, current.flow) : null;
  const win = current ? challengeWindow(current) : null;
  const length = win ? daysBetween(win.start, win.end) + 1 : 0;
  const dayNumber = win && today >= win.start ? Math.min(length, daysBetween(win.start, today) + 1) : 0;
  return {
    id,
    name: displayName(u),
    photoUrl: u.photoUrl,
    city: u.city,
    age: u.age,
    occupation: u.occupation,
    aspiration: u.aspiration,
    sixMonthBadge: u.sixMonthBadge,
    writeUrl: u.username ? `https://t.me/${u.username}` : `tg://user?id=${u.id}`,
    flow: current ? { title: current.flow.title, startsOn: fromDbDate(current.flow.startsOn) } : null,
    // Личный челлендж: дата старта, день из 30 (до старта — 0)
    challenge: win ? { startsOn: win.start, endsOn: win.end, day: dayNumber, length } : null,
    goals: current?.goals.filter((g) => g.isPublic).sort((a, b) => a.sort - b.sort).map((g) => ({ title: g.title, category: g.category, pointA: g.pointA, pointB: g.pointB, tasks: g.tasks.map((t) => ({ title: t.title, schedule: scheduleLabel(t) })) })) ?? [],
    stats: stats ? { percent: Math.round(stats.ratio * 100), successfulDays: stats.successfulDays, currentStreak: stats.currentStreak } : null,
    flowsCount: memberships.length,
    buddy: await buddyState(viewerId, u.id),
  };
}

/** Можно ли предложить этому участнику стать парой и в каком состоянии предложение */
async function buddyState(viewerId: bigint, targetId: bigint) {
  if (viewerId === targetId) return { state: 'self' as const };
  const m = await currentMembership(viewerId);
  if (!m) return { state: 'unavailable' as const };
  const theirs = await prisma.flowMembership.findFirst({ where: { userId: targetId, flowId: m.flowId, status: { in: ['reserved', 'registered', 'active'] } } });
  if (!theirs) return { state: 'other_flow' as const };
  const assigned = await prisma.buddyAssignment.findMany({ where: { flowId: m.flowId, userId: { in: [viewerId, targetId] } } });
  const mine = assigned.find((a) => a.userId === viewerId);
  const their = assigned.find((a) => a.userId === targetId);
  if (mine && their && mine.pairId === their.pairId) return { state: 'paired' as const };
  if (mine) return { state: 'viewer_paired' as const };
  if (their) return { state: 'taken' as const };
  const incoming = await prisma.buddyInvite.findFirst({ where: { flowId: m.flowId, fromUserId: targetId, toUserId: viewerId, status: 'pending' } });
  if (incoming) return { state: 'incoming' as const, proposalId: incoming.id };
  const sent = await prisma.buddyInvite.findFirst({ where: { flowId: m.flowId, fromUserId: viewerId, toUserId: targetId, status: 'pending' } });
  if (sent) return { state: 'sent' as const };
  return { state: 'can_propose' as const };
}
