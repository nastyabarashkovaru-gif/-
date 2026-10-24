import { plural, canAddGoal, isNumericGoal, metricUnit, goalProgressPercent, flowPhase, fromDbDate, generateOccurrences, toDbDate, dayOfMonth, type ISODate } from '@thirty/domain';
import type { FlowMembership, Flow, Goal, Task } from '@prisma/client';
import { z } from 'zod';
import { clock } from '../clock';
import { prisma } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../http';
import { getSetting } from '../settings';
import { flowToday } from './flows';
import { track } from './analytics';

export const CONFIRM_METHODS = ['screenshot', 'photo_video', 'document', 'daily_reports', 'other'] as const;

export const goalInput = z.object({
  category: z.enum(['money', 'weightloss', 'blog', 'english', 'habits', 'selfdev', 'other']),
  title: z.string().trim().min(3).max(200),
  successCriterion: z.string().trim().max(300).default(''),
  pointA: z.string().trim().max(300).nullable().optional(),
  pointB: z.string().trim().max(300).nullable().optional(),
  confirmMethod: z.enum(CONFIRM_METHODS).nullable().optional(),
  confirmNote: z.string().trim().max(300).nullable().optional(),
  isPublic: z.boolean().default(true),
});
/** PATCH: без значений по умолчанию, чтобы частичное обновление не затирало поля */
export const goalPatch = goalInput.extend({ successCriterion: z.string().trim().max(300), isPublic: z.boolean() }).partial();

export const taskInput = z.object({
  title: z.string().trim().min(2).max(160),
  frequency: z.enum(['daily', 'every_n_days', 'n_per_week', 'once']),
  n: z.number().int().min(1).max(31).default(1),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  evidence: z.enum(['checkbox', 'photo', 'screenshot', 'checkbox_photo', 'link']).optional(),
  criteria: z.string().trim().max(300).optional(),
});

type MembershipFull = FlowMembership & { flow: Flow };

/**
 * Можно ли менять цели и задачи: до старта потока — да; после старта — только если анкета ещё не зафиксирована
 * и идёт окно позднего входа (первый день потока по умолчанию).
 */
export async function canEditGoals(m: MembershipFull, now = clock.now()): Promise<boolean> {
  if (m.status === 'revoked' || m.status === 'finished') return false;
  // После отправки анкеты («Это твоё обещание себе») цели и план менять нельзя
  if (m.goalsLockedAt) return false;
  const today = flowToday(m.flow, now);
  const startsOn = fromDbDate(m.flow.startsOn);
  if (today < startsOn) return true;
  if (m.goalsLockedAt) return false;
  const lateJoinUntilDay = await getSetting('flow.lateJoinUntilDay');
  return flowPhase(startsOn, today) === 'active' && dayOfMonth(today) <= lateJoinUntilDay;
}

async function loadOwnMembership(userId: bigint, membershipId: string): Promise<MembershipFull> {
  const m = await prisma.flowMembership.findUnique({ where: { id: membershipId }, include: { flow: true } });
  if (!m || m.userId !== userId) throw notFound('membership_not_found');
  return m;
}

async function assertEditable(m: MembershipFull) {
  if (!(await canEditGoals(m))) throw forbidden('goals_locked', 'После старта потока цели и задачи менять нельзя');
}

export async function goalLimitFor(m: FlowMembership): Promise<number | null> {
  const tariff = await prisma.tariff.findUnique({ where: { id: m.tariffId } });
  return tariff ? tariff.goalLimit : 1;
}

export async function createGoal(userId: bigint, membershipId: string, input: z.infer<typeof goalInput>) {
  const m = await loadOwnMembership(userId, membershipId);
  await assertEditable(m);
  const limit = await goalLimitFor(m);
  const count = await prisma.goal.count({ where: { membershipId } });
  if (!canAddGoal(limit, count)) throw conflict('goal_limit', `В вашем тарифе ${limit === 1 ? 'одна цель' : `до ${limit} целей`} в месяц`);
  const goal = await prisma.goal.create({ data: { ...input, membershipId, sort: count } });
  await track({ userId, eventName: 'goal_created', screenId: 'S13', flowId: m.flowId, metadata: { category: input.category } });
  return goal;
}

async function ownGoal(userId: bigint, goalId: string) {
  const goal = await prisma.goal.findUnique({ where: { id: goalId }, include: { membership: { include: { flow: true } } } });
  if (!goal || goal.membership.userId !== userId) throw notFound('goal_not_found');
  return goal;
}

export async function updateGoal(userId: bigint, goalId: string, input: z.infer<typeof goalPatch>) {
  const goal = await ownGoal(userId, goalId);
  await assertEditable(goal.membership);
  return prisma.goal.update({ where: { id: goalId }, data: input });
}

export async function deleteGoal(userId: bigint, goalId: string) {
  const goal = await ownGoal(userId, goalId);
  await assertEditable(goal.membership);
  await prisma.goal.delete({ where: { id: goalId } });
  await unfixIfNeeded(goal.membershipId);
}

async function policyEvidence(category: string, requested?: Task['evidence']): Promise<{ evidence: Task['evidence']; selfReported: boolean }> {
  const policy = (await getSetting('evidence.policy'))[category];
  let evidence = requested ?? policy?.evidence ?? 'checkbox';
  // Если по категории фото обязательно, галочку без фото выбрать нельзя
  if (policy?.photoRequired && (evidence === 'checkbox' || evidence === 'link')) evidence = policy.evidence;
  return { evidence, selfReported: evidence === 'checkbox' };
}

export async function createTask(userId: bigint, goalId: string, input: z.infer<typeof taskInput>) {
  const goal = await ownGoal(userId, goalId);
  await assertEditable(goal.membership);
  if (input.frequency === 'n_per_week' && input.n > 7) throw badRequest('bad_schedule', 'Не больше 7 раз в неделю');
  const dueDate = checkDueDate(goal.membership, input.frequency, input.dueDate);
  const count = await prisma.task.count({ where: { goalId } });
  if (count >= 10) throw conflict('task_limit', 'Не больше 10 задач на цель');
  const { evidence, selfReported } = await policyEvidence(goal.category, input.evidence);
  const task = await prisma.task.create({
    data: { goalId, title: input.title, frequency: input.frequency, n: input.frequency === 'daily' || input.frequency === 'once' ? 1 : input.n, dueDate, evidence, selfReported, criteria: input.criteria },
  });
  await track({ userId, eventName: 'task_created', screenId: 'S14', flowId: goal.membership.flowId, metadata: { frequency: input.frequency, evidence } });
  await unfixIfNeeded(goal.membershipId);
  return task;
}

/** Дедлайн одноразовой задачи — день внутри месяца потока */
function checkDueDate(m: MembershipFull, frequency: string, dueDate: string | null | undefined): Date | null {
  if (frequency !== 'once') return null;
  if (!dueDate) throw badRequest('due_date_required', 'Выбери дату, до которой выполнишь задачу');
  const { startsOn, endsOn } = { startsOn: fromDbDate(m.flow.startsOn), endsOn: fromDbDate(m.flow.endsOn) };
  if (dueDate < startsOn || dueDate > endsOn) throw badRequest('due_date_out_of_flow', 'Дата должна быть внутри месяца челленджа');
  return toDbDate(dueDate);
}

async function ownTask(userId: bigint, taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { goal: { include: { membership: { include: { flow: true } } } } } });
  if (!task || task.goal.membership.userId !== userId) throw notFound('task_not_found');
  return task;
}

export async function updateTask(userId: bigint, taskId: string, input: Partial<z.infer<typeof taskInput>>) {
  const task = await ownTask(userId, taskId);
  await assertEditable(task.goal.membership);
  const data: Partial<Task> = {};
  if (input.title) data.title = input.title;
  if (input.criteria !== undefined) data.criteria = input.criteria;
  if (input.frequency) {
    data.frequency = input.frequency;
    data.n = input.frequency === 'daily' || input.frequency === 'once' ? 1 : (input.n ?? task.n);
    if (input.frequency === 'n_per_week' && data.n > 7) throw badRequest('bad_schedule', 'Не больше 7 раз в неделю');
  } else if (input.n) data.n = input.n;
  const freq = input.frequency ?? task.frequency;
  data.dueDate = freq === 'once' ? checkDueDate(task.goal.membership, freq, input.dueDate === undefined && task.dueDate ? fromDbDate(task.dueDate) : input.dueDate) : null;
  if (input.evidence) Object.assign(data, await policyEvidence(task.goal.category, input.evidence));
  const updated = await prisma.task.update({ where: { id: taskId }, data });
  await unfixIfNeeded(task.goal.membershipId);
  return updated;
}

export async function deleteTask(userId: bigint, taskId: string) {
  const task = await ownTask(userId, taskId);
  await assertEditable(task.goal.membership);
  await prisma.task.delete({ where: { id: taskId } });
  await unfixIfNeeded(task.goal.membershipId);
}

/** Любое изменение до старта снимает фиксацию: план выполнений надо пересобрать и зафиксировать заново */
async function unfixIfNeeded(membershipId: string) {
  await prisma.$transaction([
    prisma.taskOccurrence.deleteMany({ where: { membershipId } }),
    prisma.flowMembership.updateMany({ where: { id: membershipId, status: 'registered' }, data: { status: 'reserved', registeredAt: null } }),
  ]);
}

/**
 * Отправка анкеты: у каждой цели есть точки А/Б, способ подтверждения и действия; генерируется план
 * обязательных выполнений на весь месяц, анкета блокируется (решение владельца: после отправки менять нельзя).
 */
export async function fixGoals(userId: bigint, membershipId: string) {
  const m = await loadOwnMembership(userId, membershipId);
  await assertEditable(m);
  const goals = await prisma.goal.findMany({ where: { membershipId }, include: { tasks: true } });
  if (!goals.length) throw badRequest('no_goals', 'Добавьте хотя бы одну цель');
  const empty = goals.find((g) => g.tasks.length === 0);
  if (empty) throw badRequest('goal_without_tasks', `Добавь действия к цели «${empty.title}»`);
  const noPoints = goals.find((g) => !g.pointA || !g.pointB || !g.confirmMethod);
  if (noPoints) throw badRequest('goal_without_points', `Заполни точку А, точку Б и способ подтверждения для цели «${noPoints.title}»`);
  const startsOn = fromDbDate(m.flow.startsOn);
  const now = clock.now();
  const started = flowToday(m.flow, now) >= startsOn;
  const rows = goals.flatMap((g) =>
    g.tasks.flatMap((t) =>
      generateOccurrences({ frequency: t.frequency, n: t.n, dueDate: t.dueDate ? fromDbDate(t.dueDate) : null }, startsOn).map((o) => ({
        taskId: t.id,
        membershipId,
        windowStart: toDbDate(o.windowStart),
        windowEnd: toDbDate(o.windowEnd),
        slot: o.slot,
      })),
    ),
  );
  await prisma.$transaction([
    prisma.taskOccurrence.deleteMany({ where: { membershipId } }),
    prisma.taskOccurrence.createMany({ data: rows }),
    prisma.flowMembership.update({
      where: { id: membershipId },
      data: { status: started ? 'active' : 'registered', registeredAt: now, goalsLockedAt: now },
    }),
    // Категории целей становятся интересами: по ним открываются тематические чаты
    prisma.user.update({ where: { id: userId }, data: { interests: [...new Set(goals.map((g) => g.category))] } }),
  ]);
  return { occurrences: rows.length, locked: true };
}

export function serializeGoal(g: Goal & { tasks: Task[] }) {
  return {
    id: g.id,
    category: g.category,
    title: g.title,
    successCriterion: g.successCriterion,
    pointA: g.pointA,
    pointB: g.pointB,
    confirmMethod: g.confirmMethod,
    confirmNote: g.confirmNote,
    numeric: isNumericGoal(g.pointA, g.pointB),
    unit: metricUnit(g.pointB),
    current: g.currentValue,
    progress: goalProgressPercent(g.pointA, g.pointB, g.currentValue),
    isPublic: g.isPublic,
    finalAchieved: g.finalAchieved,
    tasks: g.tasks.map((t) => ({ id: t.id, title: t.title, frequency: t.frequency, n: t.n, dueDate: t.dueDate ? fromDbDate(t.dueDate) : null, evidence: t.evidence, criteria: t.criteria, selfReported: t.selfReported })),
  };
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function scheduleLabel(t: Pick<Task, 'frequency' | 'n'> & { dueDate?: Date | null }): string {
  if (t.frequency === 'daily') return 'Ежедневно';
  if (t.frequency === 'once') {
    if (!t.dueDate) return 'Однократно';
    const [, m, d] = fromDbDate(t.dueDate).split('-').map(Number);
    return `Однократно, до ${d} ${MONTHS_GEN[m - 1]}`;
  }
  if (t.frequency === 'every_n_days') return t.n === 1 ? 'Каждый день' : `Раз в ${t.n} ${plural(t.n, 'день', 'дня', 'дней')}`;
  return `${t.n} ${plural(t.n, 'раз', 'раза', 'раз')} в неделю`;
}

export type { ISODate };
