import { addDays, fromDbDate, generateOccurrences, toDbDate, validateSchedule } from '@thirty/domain';
import type { Flow, FlowMembership, Frequency } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config';
import { prisma, serializable } from '../db';
import { badRequest, forbidden, notFound } from '../http';
import { homeMembership, memberWindow } from './flows';

const grantSchema = z.object({ userId: z.string(), membershipId: z.string() });
let grant: z.infer<typeof grantSchema> | null = null;

/** Resolve the username once and pin the grant to the participant and their current challenge. */
export async function initializeTaskCorrection() {
  grant = null;
  const username = config.TASK_CORRECTION_USERNAME.trim().replace(/^@/, '').toLowerCase();
  if (!username || config.DEMO_MODE) return 'disabled';
  const key = `task.correction.${username}`;
  const prior = await prisma.setting.findUnique({ where: { key } });
  if (prior) {
    grant = grantSchema.parse(prior.value);
  } else {
    const matches = await prisma.user.findMany({
      where: { username: { equals: username, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
      take: 2,
    });
    if (matches.length !== 1) {
      console.warn('[task-correction] participant could not be uniquely matched');
      return 'participant_not_matched';
    }
    const m = await homeMembership(matches[0].id);
    if (!m || !m.goalsLockedAt || !['active', 'registered'].includes(m.status) || memberWindow(m).phase === 'finished') {
      console.warn('[task-correction] no current locked challenge');
      return 'no_current_locked_challenge';
    }
    const row = await prisma.setting.upsert({
      where: { key },
      create: { key, value: { userId: m.userId.toString(), membershipId: m.id } },
      update: {},
    });
    grant = grantSchema.parse(row.value);
  }
  console.log('[task-correction] personal access enabled');
  return 'granted';
}

type Membership = FlowMembership & { flow: Flow };

export function taskCorrectionFrom(m: Membership) {
  if (!grant || grant.membershipId !== m.id || grant.userId !== m.userId.toString()) return null;
  if (!m.goalsLockedAt || !['active', 'registered'].includes(m.status)) return null;
  const w = memberWindow(m);
  if (w.phase === 'finished') return null;
  return w.phase === 'upcoming' ? w.start : addDays(w.today, 1);
}

export async function correctTask(
  userId: bigint,
  taskId: string,
  input: { title: string; frequency: Frequency; n: number; dueDate?: string | null },
) {
  return serializable(async (tx) => {
    const task = await tx.task.findUnique({ where: { id: taskId }, include: { goal: { include: { membership: { include: { flow: true } } } } } });
    if (!task || task.goal.membership.userId !== userId) throw notFound('task_not_found');
    const m = task.goal.membership;
    const from = taskCorrectionFrom(m);
    if (!from) throw forbidden('task_correction_unavailable', 'Редактирование задачи недоступно');

    const n = input.frequency === 'daily' || input.frequency === 'once' ? 1 : input.n;
    const dueDate = input.frequency === 'once' ? input.dueDate ?? null : null;
    const oldDueDate = task.dueDate ? fromDbDate(task.dueDate) : null;
    if (task.frequency === input.frequency && task.n === n && oldDueDate === dueDate) {
      return tx.task.update({ where: { id: taskId }, data: { title: input.title } });
    }
    const w = memberWindow(m);
    if (w.paused || from > w.end) throw badRequest('task_schedule_unavailable', 'Сейчас можно исправить название задачи');
    const schedule = { frequency: input.frequency, n, dueDate };
    const error = validateSchedule(schedule);
    if (error) throw badRequest('bad_schedule', error);
    if (dueDate && (dueDate < from || dueDate > w.end)) {
      throw badRequest('due_date_out_of_flow', 'Выбери дату в оставшихся днях челленджа');
    }

    const alreadyCompleted = task.frequency === 'once' && input.frequency === 'once' &&
      (await tx.taskOccurrence.count({ where: { taskId, status: 'done' } })) > 0;
    const future = alreadyCompleted ? [] : generateOccurrences(schedule, from, { startsOn: from, endsOn: w.end });
    await tx.taskOccurrence.deleteMany({
      where: { taskId, status: 'pending', windowEnd: { gte: toDbDate(from) }, reportItems: { none: {} } },
    });
    if (future.length) await tx.taskOccurrence.createMany({
      data: future.map((o) => ({ taskId, membershipId: m.id, windowStart: toDbDate(o.windowStart), windowEnd: toDbDate(o.windowEnd), slot: o.slot })),
      skipDuplicates: true,
    });
    return tx.task.update({
      where: { id: taskId },
      data: { title: input.title, frequency: input.frequency, n, dueDate: dueDate ? toDbDate(dueDate) : null },
    });
  });
}
