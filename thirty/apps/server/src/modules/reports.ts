import { fromDbDate, toDbDate, flowPhase } from '@thirty/domain';
import { z } from 'zod';
import { clock } from '../clock';
import { prisma } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../http';
import { getSetting } from '../settings';
import { signedMediaUrl } from '../lib/storage';
import { flowToday } from './flows';
import { track } from './analytics';

export const reportInput = z.object({
  items: z
    .array(
      z.object({
        taskId: z.string().uuid(),
        done: z.literal(true),
        mediaIds: z.array(z.string().uuid()).max(5).default([]),
        link: z.string().url().max(500).optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .max(100),
  text: z.string().trim().max(2000).optional(),
  /** Фото отчёта: минимум одно на весь отчёт */
  mediaIds: z.array(z.string().uuid()).max(6).default([]),
  /** Пользователь видел предупреждение, что отчёт публичный */
  publicAck: z.literal(true),
});

/**
 * Отчёт за сегодняшний день потока (по часовому поясу потока): один отчёт в день, задним числом не сдать.
 * Минимум одно фото на весь отчёт обязательно (решение владельца 24.10). Отчёт сразу публикуется в общий чат потока.
 */
export async function submitReport(userId: bigint, membershipId: string, input: z.infer<typeof reportInput>) {
  const m = await prisma.flowMembership.findUnique({ where: { id: membershipId }, include: { flow: true } });
  if (!m || m.userId !== userId) throw notFound('membership_not_found');
  if (m.status !== 'active') throw forbidden('not_active', 'Отчёты принимаются после отправки анкеты во время потока');
  const now = clock.now();
  const today = flowToday(m.flow, now);
  if (flowPhase(fromDbDate(m.flow.startsOn), today) !== 'active') throw forbidden('flow_not_active', 'Поток не идёт');
  const date = toDbDate(today);

  const taskIds = [...new Set(input.items.map((i) => i.taskId))];
  if (taskIds.length !== input.items.length) throw badRequest('duplicate_task', 'Одна задача — одна отметка в день');
  const tasks = await prisma.task.findMany({ where: { id: { in: taskIds }, goal: { membershipId } } });
  if (tasks.length !== taskIds.length) throw badRequest('unknown_task');

  const allMedia = [...new Set([...input.mediaIds, ...input.items.flatMap((i) => i.mediaIds)])];
  if (allMedia.length === 0) throw badRequest('photo_required', 'Прикрепи хотя бы одно фото — без него отчёт отправить нельзя');
  const own = await prisma.mediaFile.count({ where: { id: { in: allMedia }, ownerId: userId } });
  if (own !== allMedia.length) throw badRequest('bad_media');

  const existing = await prisma.dailyReport.findUnique({ where: { membershipId_date: { membershipId, date } } });
  if (existing?.status === 'rejected') throw conflict('report_rejected', 'Отчёт за сегодня отклонён модератором — можно подать апелляцию');
  if (existing) throw conflict('already_reported', 'Отчёт за сегодня уже отправлен');

  return prisma.$transaction(async (tx) => {
    const report = await tx.dailyReport.create({ data: { membershipId, date, text: input.text || null, mediaIds: input.mediaIds } });
    let marked = 0;
    for (const item of input.items) {
      // Свободное выполнение с окном, включающим сегодня; для «N раз в неделю» — ближайший незакрытый слот
      const occ = await tx.taskOccurrence.findFirst({
        where: { taskId: item.taskId, membershipId, status: 'pending', windowStart: { lte: date }, windowEnd: { gte: date } },
        orderBy: { slot: 'asc' },
      });
      if (!occ) continue;
      await tx.taskOccurrence.update({ where: { id: occ.id }, data: { status: 'done', doneAt: now } });
      const ri = await tx.reportItem.create({ data: { reportId: report.id, occurrenceId: occ.id, done: true, link: item.link, note: item.note } });
      if (item.mediaIds.length) await tx.reportEvidence.createMany({ data: item.mediaIds.map((mediaId) => ({ itemId: ri.id, mediaId })) });
      marked++;
    }
    await tx.feedMessage.create({ data: { flowId: m.flowId, userId, reportId: report.id, text: input.text || null, createdAt: now } });
    return { reportId: report.id, date: today, marked };
  }).then(async (r) => {
    await track({ userId, eventName: 'report_submitted', screenId: 'S21', flowId: m.flowId, metadata: { marked: r.marked, items: input.items.length, photos: allMedia.length } });
    return r;
  });
}

/** Что можно отметить сегодня: открытые выполнения по каждой задаче */
export async function todayChecklist(membershipId: string) {
  const m = await prisma.flowMembership.findUniqueOrThrow({ where: { id: membershipId }, include: { flow: true } });
  const today = flowToday(m.flow);
  const date = toDbDate(today);
  const goals = await prisma.goal.findMany({ where: { membershipId }, include: { tasks: true }, orderBy: { sort: 'asc' } });
  const occ = await prisma.taskOccurrence.findMany({ where: { membershipId, windowStart: { lte: date }, windowEnd: { gte: date } } });
  const report = await prisma.dailyReport.findUnique({ where: { membershipId_date: { membershipId, date } }, include: { items: { include: { occurrence: true } } } });
  const doneToday = new Set(report?.items.map((i) => i.occurrence.taskId) ?? []);
  const policy = await getSetting('evidence.policy');
  return {
    date: today,
    reportId: report?.id ?? null,
    reportStatus: report?.status ?? null,
    reportText: report?.text ?? null,
    reportPhotos: (report?.mediaIds ?? []).map((id) => signedMediaUrl(id)),
    goals: goals.map((g) => ({
      id: g.id,
      title: g.title,
      category: g.category,
      tasks: g.tasks.map((t) => {
        const open = occ.filter((o) => o.taskId === t.id);
        return {
          id: t.id,
          title: t.title,
          evidence: t.evidence,
          photoRequired: t.evidence === 'photo' || t.evidence === 'screenshot' || (t.evidence === 'checkbox_photo' && !!policy[g.category]?.photoRequired),
          policyNote: policy[g.category]?.note ?? null,
          dueToday: open.length > 0,
          remainingInWindow: open.filter((o) => o.status === 'pending').length,
          doneToday: doneToday.has(t.id),
        };
      }),
    })),
  };
}

export function serializeReport(r: Awaited<ReturnType<typeof loadReport>>) {
  if (!r) return null;
  const u = r.membership.user;
  return {
    id: r.id,
    date: fromDbDate(r.date),
    text: r.text,
    status: r.status,
    createdAt: r.createdAt,
    photos: r.mediaIds.map((id) => signedMediaUrl(id)),
    user: { id: u.id.toString(), name: u.displayName || [u.firstName, u.lastName].filter(Boolean).join(' '), photoUrl: u.photoUrl, city: u.city },
    flow: { id: r.membership.flowId, title: r.membership.flow.title },
    items: r.items.map((i) => ({
      task: i.occurrence.task.title,
      goal: i.occurrence.task.goal.isPublic ? i.occurrence.task.goal.title : 'Личная цель',
      category: i.occurrence.task.goal.category,
      link: i.link,
      note: i.note,
      media: i.evidence.map((e) => signedMediaUrl(e.mediaId)),
    })),
    reactions: Object.entries(
      r.reactions.reduce<Record<string, number>>((a, x) => ((a[x.emoji] = (a[x.emoji] ?? 0) + 1), a), {}),
    ).map(([emoji, count]) => ({ emoji, count })),
    commentsCount: r._count.comments,
  };
}

export const reportInclude = {
  membership: { include: { user: true, flow: true } },
  items: { include: { evidence: true, occurrence: { include: { task: { include: { goal: true } } } } } },
  reactions: true,
  _count: { select: { comments: true } },
} as const;

export async function loadReport(id: string) {
  return prisma.dailyReport.findUnique({ where: { id }, include: reportInclude });
}
