import { addDays, humanDate, plural, canAddGoal, isNumericGoal, metricUnit, goalProgressPercent, flowPhase, fromDbDate, generateOccurrences, toDbDate, dayOfMonth, type ISODate } from '@thirty/domain';
import type { FlowMembership, Flow, Goal, Task } from '@prisma/client';
import { z } from 'zod';
import { clock } from '../clock';
import { prisma } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../http';
import { getSetting } from '../settings';
import { flowToday, memberToday, memberWindow } from './flows';
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
export async function canEditGoals(m: MembershipFull, _now = clock.now()): Promise<boolean> {
  if (m.status === 'revoked' || m.status === 'finished') return false;
  // После отправки анкеты («Это твоё обещание себе») цели и план менять нельзя; до этого — можно (личные старты, ТЗ 02.11)
  return !m.goalsLockedAt;
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
  const w = memberWindow(m);
  const from = w.start > w.today ? w.start : w.today;
  if (dueDate < from || dueDate > w.end) throw badRequest('due_date_out_of_flow', 'Дата должна быть внутри твоих 30 дней челленджа');
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
  const noPoints = goals.find((g) => !g.pointA || !g.pointB);
  if (noPoints) throw badRequest('goal_without_points', `Заполни точку А и точку Б для цели «${noPoints.title}»`);
  const now = clock.now();
  // Дату старта не выбрали — начинаем с начала месяца участия или сегодня, если он уже идёт
  if (!m.startsOn) {
    const auto = memberWindow(m, now).start;
    m.startsOn = toDbDate(auto);
    await prisma.flowMembership.update({ where: { id: m.id }, data: { startsOn: m.startsOn } });
  }
  const w = memberWindow(m, now);
  const startsOn = w.start;
  const started = w.phase !== 'upcoming';
  const rows = goals.flatMap((g) =>
    g.tasks.flatMap((t) =>
      generateOccurrences({ frequency: t.frequency, n: t.n, dueDate: t.dueDate ? fromDbDate(t.dueDate) : null }, startsOn, { startsOn: w.start, endsOn: w.end }).map((o) => ({
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

/**
 * «X раз в неделю» можно поменять и во время потока (решение владельца 02.11): прошлые недели не трогаем,
 * в текущей и следующих неделях норма пересчитывается, уже сделанные отметки сохраняются.
 */
export async function changeWeeklyCount(userId: bigint, taskId: string, n: number) {
  if (!Number.isInteger(n) || n < 1 || n > 7) throw badRequest('bad_schedule', 'От 1 до 7 раз в неделю');
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { goal: { include: { membership: { include: { flow: true } } } } } });
  if (!task || task.goal.membership.userId !== userId) throw notFound('task_not_found');
  const m = task.goal.membership;
  if (m.status === 'revoked' || m.status === 'finished') throw forbidden('goals_locked', 'Поток уже завершён');
  if (task.frequency !== 'n_per_week') throw badRequest('not_weekly', 'Менять можно только действия «X раз в неделю»');
  if (await canEditGoals(m)) return updateTask(userId, taskId, { n });
  const today = memberToday(m, clock.now());
  const w = memberWindow(m);
  const plan = generateOccurrences({ frequency: 'n_per_week', n }, w.start, { startsOn: w.start, endsOn: w.end }).filter((o) => o.windowEnd >= today);
  const byWeek = new Map<string, { windowStart: ISODate; windowEnd: ISODate; need: number }>();
  for (const o of plan) {
    const w = byWeek.get(o.windowStart) ?? { windowStart: o.windowStart, windowEnd: o.windowEnd, need: 0 };
    w.need++;
    byWeek.set(o.windowStart, w);
  }
  await prisma.$transaction(async (tx) => {
    for (const w of byWeek.values()) {
      const have = await tx.taskOccurrence.findMany({ where: { taskId, windowStart: toDbDate(w.windowStart) }, include: { _count: { select: { reportItems: true } } }, orderBy: { slot: 'asc' } });
      if (have.length < w.need) {
        const maxSlot = have.reduce((a, o) => Math.max(a, o.slot), -1);
        await tx.taskOccurrence.createMany({ data: Array.from({ length: w.need - have.length }, (_, i) => ({ taskId, membershipId: m.id, windowStart: toDbDate(w.windowStart), windowEnd: toDbDate(w.windowEnd), slot: maxSlot + 1 + i })) });
      } else if (have.length > w.need) {
        // убираем только пустые (не отмеченные) — сделанное остаётся засчитанным
        const removable = have.filter((o) => o.status !== 'done' && o._count.reportItems === 0).reverse();
        const drop = removable.slice(0, have.length - w.need).map((o) => o.id);
        if (drop.length) await tx.taskOccurrence.deleteMany({ where: { id: { in: drop } } });
      }
    }
    await tx.task.update({ where: { id: taskId }, data: { n } });
  });
  return { ok: true, n };
}

/**
 * «Когда начнём твой челлендж?» (ТЗ 02.11): сегодня или дата в будущем. Пока анкета не отправлена — можно поменять.
 * Новый челлендж не может начаться раньше, чем закончится текущий.
 */
export async function setChallengeStart(userId: bigint, membershipId: string, date: ISODate) {
  const m = await loadOwnMembership(userId, membershipId);
  if (m.goalsLockedAt) throw forbidden('goals_locked', 'Анкета уже отправлена — дату старта поменять нельзя');
  const today = memberToday(m);
  if (date < today) throw badRequest('start_in_past', 'Нельзя выбрать дату в прошлом');
  if (date > addDays(today, 90)) throw badRequest('start_too_far', 'Выбери дату в ближайшие 3 месяца');
  const others = await prisma.flowMembership.findMany({ where: { userId, id: { not: m.id }, status: { in: ['registered', 'active'] }, startsOn: { not: null } }, include: { flow: true } });
  for (const o of others) {
    const ow = memberWindow(o);
    if (date <= ow.end && addDays(date, 29) >= ow.start) throw conflict('start_overlap', `Твой текущий челлендж идёт до ${humanDate(ow.end)} — новый можно начать с ${humanDate(addDays(ow.end, 1))}`);
  }
  await prisma.flowMembership.update({ where: { id: m.id }, data: { startsOn: toDbDate(date) } });
  await track({ userId, eventName: 'challenge_start_selected', flowId: m.flowId, metadata: { date, today: date === today } });
  return { startsOn: date, endsOn: addDays(date, 29) };
}

/**
 * Смена даты старта в любой момент (просьба владельца 05.11): до старта — перенос, посреди челленджа — начать заново
 * с новой даты (прежний прогресс обнуляется, отчёты остаются в ленте). Цели и план остаются; заполнить анкету
 * заново — restartQuestionnaire. Заменяет разовую кнопку «Начать челлендж раньше» (03.11).
 */
export function canChangeStart(m: FlowMembership) {
  return (m.status === 'registered' || m.status === 'active') && Boolean(m.goalsLockedAt) && Boolean(m.startsOn);
}

async function latestAllowedStart(m: FlowMembership & { flow: Flow }) {
  // Следующий оплаченный челлендж с уже выбранной датой: новые 30 дней должны закончиться до него
  const next = await prisma.flowMembership.findMany({ where: { userId: m.userId, id: { not: m.id }, status: { in: ['registered', 'active'] }, startsOn: { gt: m.startsOn ?? new Date(0) } }, include: { flow: true } });
  const starts = next.map((o) => memberWindow(o).start).sort();
  return starts.length ? addDays(starts[0], -30) : null;
}

export async function changeStart(userId: bigint, membershipId: string, date: ISODate) {
  const m = await loadOwnMembership(userId, membershipId);
  if (!canChangeStart(m)) throw forbidden('start_change_unavailable', 'Сейчас дату старта поменять нельзя — напиши в поддержку, поможем');
  const today = memberToday(m);
  if (date < today) throw badRequest('start_in_past', 'Нельзя выбрать дату в прошлом');
  if (date > addDays(today, 90)) throw badRequest('start_too_far', 'Выбери дату в ближайшие 3 месяца');
  if (date === today && (await prisma.dailyReport.findUnique({ where: { membershipId_date: { membershipId, date: toDbDate(today) } } }))) {
    throw badRequest('reported_today', 'Сегодня ты уже отправила отчёт — начни заново с завтрашнего дня');
  }
  const limit = await latestAllowedStart(m);
  if (limit && date > limit) throw conflict('start_overlap', `Следующий челлендж уже запланирован — выбери дату не позже ${humanDate(limit)}`);
  const start = toDbDate(date);
  const w = memberWindow({ ...m, startsOn: start });
  const tasks = await prisma.task.findMany({ where: { goal: { membershipId } } });
  const rows = tasks.flatMap((t) =>
    generateOccurrences({ frequency: t.frequency, n: t.n, dueDate: t.dueDate ? fromDbDate(t.dueDate) : null }, w.start, { startsOn: w.start, endsOn: w.end }).map((o) => ({
      taskId: t.id, membershipId, windowStart: toDbDate(o.windowStart), windowEnd: toDbDate(o.windowEnd), slot: o.slot,
    })),
  );
  const restart = m.status === 'active';
  await prisma.$transaction([
    prisma.taskOccurrence.deleteMany({ where: { membershipId } }),
    prisma.taskOccurrence.createMany({ data: rows }),
    prisma.flowMembership.update({ where: { id: membershipId }, data: { startsOn: start, status: 'registered' } }),
  ]);
  await track({ userId, eventName: 'challenge_start_changed', flowId: m.flowId, metadata: { date, from: fromDbDate(m.startsOn!), restart } });
  // Старт сегодня — челлендж начинается сразу
  if (date === today) await (await import('./flows')).refreshChallengeStatuses();
  return { startsOn: date, endsOn: w.end };
}

/** Заполнить анкету заново: цели и план можно поменять, дата старта выбирается в конце анкеты */
export async function restartQuestionnaire(userId: bigint, membershipId: string) {
  const m = await loadOwnMembership(userId, membershipId);
  if (!canChangeStart(m)) throw forbidden('start_change_unavailable', 'Сейчас анкету заполнить заново нельзя — напиши в поддержку, поможем');
  await prisma.$transaction([
    prisma.taskOccurrence.deleteMany({ where: { membershipId } }),
    prisma.flowMembership.update({ where: { id: membershipId }, data: { status: 'reserved', goalsLockedAt: null, registeredAt: null, startsOn: null } }),
  ]);
  await track({ userId, eventName: 'challenge_start_changed', flowId: m.flowId, metadata: { refill: true, restart: m.status === 'active' } });
  return { ok: true };
}
