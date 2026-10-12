import type { PoolClient } from 'pg';
import {
  addDays, dateRange, diffDays, habitTargetAmount, healthTreeState, isSphereId, isTypoFix, localDate, weekStart,
  validateTaskInput, dayKey, weekKey, ONCE_KEY, TASK_LIMITS, type TaskInput, type TaskKind, type HabitCheckin,
} from '@rostok/shared';
import { clock } from '../clock.js';
import { one, pool, q, tx, type Db } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { track } from '../analytics.js';
import { applyDrops } from './ledger.js';
import { lockTreeBySphere, userTz } from './garden.js';

export interface TaskRow {
  id: number; user_id: number; sphere_id: string; title: string; description: string | null; kind: TaskKind;
  times_per_week: number | null; drops: number; hardcore: boolean; penalty_drops: number | null; deadline_at: Date | null;
  habit_question: string | null; habit_missing_penalty: boolean; status: string; terms_locked_at: Date | null;
  created_local_date: string; processed_through: string | null; completions_count: number; created_at: Date;
  deleted_at: Date | null; next_process_at: Date | null;
}
export interface ScheduleRow { effective_from: string; kind: string; times_per_week: number | null; drops: number; hardcore: boolean; sphere_id: string }

export const scheduleAt = (scheds: ScheduleRow[], date: string): ScheduleRow => {
  let cur = scheds[0];
  for (const s of scheds) if (s.effective_from <= date) cur = s;
  return cur;
};
export const loadSchedules = (db: Db, taskId: number) =>
  q<ScheduleRow>(db, 'SELECT effective_from, kind, times_per_week, drops, hardcore, sphere_id FROM task_schedules WHERE task_id=$1 ORDER BY effective_from', [taskId]);

async function lockTask(c: PoolClient, userId: number, taskId: number): Promise<TaskRow> {
  const t = await one<TaskRow>(c, 'SELECT * FROM tasks WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE', [taskId, userId]);
  if (!t) throw notFound('Задача не найдена');
  return t;
}

/** Начало следующего периода, с которого вступают в силу изменения расписания. */
export const nextPeriodStart = (kind: TaskKind, today: string) => (kind === 'weekly' ? addDays(weekStart(today), 7) : addDays(today, 1));

// ---------------------------------------------------------------- создание
export async function createTask(userId: number, input: TaskInput) {
  const now = clock.now();
  const err = validateTaskInput(input, now);
  if (err) throw badRequest(err, 'validation');
  if (!isSphereId(input.sphere)) throw badRequest('Неизвестная сфера');
  const rewards = input.rewards ?? [];
  const taskId = await tx(async (c) => {
    const tz = await userTz(c, userId);
    const today = localDate(now, tz);
    const isOnce = input.kind === 'once';
    const t = (await one<{ id: number }>(
      c,
      `INSERT INTO tasks(user_id, sphere_id, title, description, kind, times_per_week, drops, hardcore, penalty_drops,
         deadline_at, habit_question, habit_missing_penalty, created_local_date, terms_locked_at, next_process_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [
        userId, input.sphere, input.title.trim(), input.description?.trim() || null, input.kind,
        input.kind === 'weekly' ? input.timesPerWeek : null, input.drops, input.hardcore,
        isOnce && input.hardcore ? input.penaltyDrops : null, isOnce ? new Date(input.deadlineAt!) : null,
        input.kind === 'habit' ? (input.habitQuestion?.trim() || `${input.title.trim()} сегодня?`).slice(0, 120) : null,
        input.kind === 'habit' && input.hardcore && input.habitMissingPenaltyConsent === true,
        today, rewards.length ? now : null, isOnce ? new Date(input.deadlineAt!) : nextProcessAt(input.kind, today, tz),
      ],
    ))!;
    await c.query(
      `INSERT INTO task_schedules(task_id, effective_from, kind, times_per_week, drops, hardcore, sphere_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [t.id, today, input.kind, input.kind === 'weekly' ? input.timesPerWeek : null, input.drops, input.hardcore, input.sphere],
    );
    for (const r of rewards) {
      await c.query('INSERT INTO reward_promises(task_id, user_id, threshold, title) VALUES ($1,$2,$3,$4)', [t.id, userId, r.threshold, r.title.trim()]);
    }
    const first = !(await one(c, 'SELECT 1 FROM tasks WHERE user_id=$1 AND id<>$2 LIMIT 1', [userId, t.id]));
    await track(c, userId, 'task_created', { kind: input.kind, sphere: input.sphere, hardcore: input.hardcore, rewards: rewards.length, first }, `task_created:${t.id}`);
    return t.id;
  });
  return getTaskView(userId, taskId);
}

import { startOfLocalDay } from '@rostok/shared';
export function nextProcessAt(kind: TaskKind, today: string, tz: string): Date {
  return startOfLocalDay(nextPeriodStart(kind, today), tz);
}

// ---------------------------------------------------------------- изменение
export interface TaskPatch {
  title?: string; description?: string | null; sphere?: string; timesPerWeek?: number; drops?: number; hardcore?: boolean;
  penaltyDrops?: number | null; deadlineAt?: string; habitQuestion?: string; habitMissingPenaltyConsent?: boolean;
}

export async function updateTask(userId: number, taskId: number, patch: TaskPatch) {
  await tx(async (c) => {
    const t = await lockTask(c, userId, taskId);
    if (t.status !== 'active') throw conflict('Завершённую или просроченную задачу нельзя изменить', 'task_closed');
    const locked = !!t.terms_locked_at;
    const lockedFields: string[] = [];
    const changes = <K extends keyof TaskPatch>(k: K, cur: unknown) => patch[k] !== undefined && patch[k] !== cur;
    if (changes('sphere', t.sphere_id)) lockedFields.push('сферу');
    if (changes('timesPerWeek', t.times_per_week)) lockedFields.push('частоту');
    if (changes('drops', t.drops)) lockedFields.push('число капель');
    if (patch.deadlineAt !== undefined && t.deadline_at && new Date(patch.deadlineAt).getTime() !== t.deadline_at.getTime()) lockedFields.push('дедлайн');
    if (locked && lockedFields.length) {
      throw conflict(`У задачи есть обещанный подарок — нельзя менять ${lockedFields.join(', ')}`, 'terms_locked', { fields: lockedFields });
    }
    const title = patch.title !== undefined ? patch.title.trim() : t.title;
    if (!title) throw badRequest('Введи название задачи', 'validation');
    if (title.length > TASK_LIMITS.titleMax) throw badRequest('Название слишком длинное', 'validation');
    if (locked && title !== t.title && !isTypoFix(t.title, title)) {
      throw conflict('С обещанным подарком можно только исправить опечатку в названии', 'terms_locked', { fields: ['название'] });
    }
    const sphere = patch.sphere ?? t.sphere_id;
    if (!isSphereId(sphere)) throw badRequest('Неизвестная сфера');
    if (t.kind === 'habit' && sphere !== 'health') throw badRequest('Вредные привычки — только в сфере «Здоровье»', 'validation');
    const merged: TaskInput = {
      title, sphere, kind: t.kind, description: patch.description !== undefined ? patch.description : t.description,
      timesPerWeek: patch.timesPerWeek ?? t.times_per_week, drops: patch.drops ?? t.drops, hardcore: patch.hardcore ?? t.hardcore,
      penaltyDrops: patch.penaltyDrops !== undefined ? patch.penaltyDrops : t.penalty_drops,
      deadlineAt: patch.deadlineAt ?? t.deadline_at?.toISOString() ?? null,
      habitMissingPenaltyConsent: patch.habitMissingPenaltyConsent ?? t.habit_missing_penalty,
    };
    const err = validateTaskInput(merged, clock.now());
    if (err) throw badRequest(err, 'validation');

    await c.query(
      `UPDATE tasks SET title=$2, description=$3, sphere_id=$4, times_per_week=$5, drops=$6, hardcore=$7, penalty_drops=$8,
         deadline_at=$9, habit_question=COALESCE($10, habit_question), habit_missing_penalty=$11, updated_at=now(),
         next_process_at=CASE WHEN kind='once' THEN $9 ELSE next_process_at END
       WHERE id=$1`,
      [
        t.id, title, merged.description?.trim() || null, sphere, merged.timesPerWeek, merged.drops, merged.hardcore,
        t.kind === 'once' && merged.hardcore ? merged.penaltyDrops : null, t.kind === 'once' ? new Date(merged.deadlineAt!) : null,
        patch.habitQuestion?.trim().slice(0, 120) || null, t.kind === 'habit' && merged.hardcore && merged.habitMissingPenaltyConsent === true,
      ],
    );
    if (t.kind !== 'once') {
      // Капли/частота/хардкор — с будущего периода; история и прошлые начисления не меняются.
      const tz = await userTz(c, userId);
      const eff = nextPeriodStart(t.kind, localDate(clock.now(), tz));
      await c.query(
        `INSERT INTO task_schedules(task_id, effective_from, kind, times_per_week, drops, hardcore, sphere_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (task_id, effective_from) DO UPDATE SET times_per_week=EXCLUDED.times_per_week, drops=EXCLUDED.drops,
           hardcore=EXCLUDED.hardcore, sphere_id=EXCLUDED.sphere_id`,
        [t.id, eff, t.kind, merged.timesPerWeek ?? null, merged.drops, merged.hardcore, sphere],
      );
    }
  });
  return getTaskView(userId, taskId);
}

export async function deleteTask(userId: number, taskId: number) {
  await tx(async (c) => {
    const t = await lockTask(c, userId, taskId);
    if (t.terms_locked_at) throw conflict('У задачи есть обещанный подарок — её нельзя удалить. Если случилось непредвиденное, напиши в поддержку.', 'terms_locked');
    await c.query(`UPDATE tasks SET deleted_at=now(), status='deleted', next_process_at=NULL WHERE id=$1`, [t.id]);
    if (t.kind === 'habit') await recomputeHealth(c, userId);
  });
  return { ok: true };
}

// ---------------------------------------------------------------- подарки
export async function syncRewards(c: PoolClient, userId: number, taskId: number) {
  const { completions_count: n } = (await one<{ completions_count: number }>(c, 'SELECT completions_count FROM tasks WHERE id=$1', [taskId]))!;
  const unlocked = await q<{ id: number; threshold: number }>(
    c, `UPDATE reward_promises SET status='unlocked', unlocked_at=now() WHERE task_id=$1 AND status='locked' AND threshold <= $2 RETURNING id, threshold`, [taskId, n],
  );
  await c.query(`UPDATE reward_promises SET status='locked', unlocked_at=NULL WHERE task_id=$1 AND status='unlocked' AND threshold > $2`, [taskId, n]);
  for (const r of unlocked) await track(c, userId, 'reward_unlocked', { threshold: r.threshold }, `reward_unlocked:${r.id}:${n}`);
  return unlocked;
}

export async function addReward(userId: number, taskId: number, threshold: number, title: string) {
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > TASK_LIMITS.rewardThresholdMax) throw badRequest('Порог — целое число выполнений', 'validation');
  if (!title?.trim() || title.length > TASK_LIMITS.rewardTitleMax) throw badRequest('Назови подарок', 'validation');
  await tx(async (c) => {
    const t = await lockTask(c, userId, taskId);
    if (t.status !== 'active') throw conflict('Задача уже закрыта', 'task_closed');
    if (t.kind === 'once' && threshold !== 1) throw badRequest('У одноразовой задачи подарок возможен только за 1 выполнение', 'validation');
    if (threshold <= t.completions_count) throw badRequest(`Подарок можно назначить только на будущий порог — больше ${t.completions_count}`, 'validation');
    const r = await one(c, 'INSERT INTO reward_promises(task_id,user_id,threshold,title) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING id', [t.id, userId, threshold, title.trim()]);
    if (!r) throw conflict('На этом пороге уже есть подарок', 'duplicate_threshold');
    await c.query('UPDATE tasks SET terms_locked_at=COALESCE(terms_locked_at, now()) WHERE id=$1', [t.id]);
  });
  return getTaskView(userId, taskId);
}

export async function claimReward(userId: number, rewardId: number) {
  return tx(async (c) => {
    const r = await one<any>(c, 'SELECT * FROM reward_promises WHERE id=$1 AND user_id=$2 FOR UPDATE', [rewardId, userId]);
    if (!r) throw notFound('Подарок не найден');
    if (r.status === 'claimed') return { id: r.id, status: 'claimed' };
    if (r.status !== 'unlocked') throw conflict('Подарок ещё не открыт', 'reward_locked');
    await c.query(`UPDATE reward_promises SET status='claimed' WHERE id=$1`, [r.id]);
    await c.query('INSERT INTO reward_claims(promise_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [r.id, userId]);
    await track(c, userId, 'reward_claimed', {}, `reward_claimed:${r.id}`);
    return { id: r.id, status: 'claimed' };
  });
}

// ---------------------------------------------------------------- выполнение
export async function completeTask(userId: number, taskId: number) {
  const now = clock.now();
  const result = await tx(async (c) => {
    const t = await lockTask(c, userId, taskId);
    if (t.kind === 'habit') throw badRequest('Для привычки ответь «Да» или «Нет»', 'use_checkin');
    const tz = await userTz(c, userId);
    const today = localDate(now, tz);
    if (t.kind === 'once') {
      if (t.status === 'completed') return { already: true, drops: 0 };
      if (t.status === 'expired' || now.getTime() > t.deadline_at!.getTime()) {
        throw conflict('Дедлайн уже прошёл — задачу нельзя выполнить', 'deadline_passed');
      }
    } else if (t.status !== 'active') throw conflict('Задача закрыта', 'task_closed');
    if (t.processed_through && today <= t.processed_through) throw conflict('Этот день уже закрыт', 'period_closed');
    const last = await one<{ d: string }>(c, 'SELECT max(local_date)::text AS d FROM task_completions WHERE task_id=$1', [t.id]);
    if (last?.d && today < last.d) throw conflict('Этот день уже прошёл по прежнему часовому поясу', 'period_closed');
    if (await one(c, 'SELECT 1 FROM task_completions WHERE task_id=$1 AND local_date=$2', [t.id, today])) return { already: true, drops: 0 };

    const scheds = await loadSchedules(c, t.id);
    let drops = t.drops;
    let periodKey = ONCE_KEY;
    if (t.kind === 'daily') {
      drops = scheduleAt(scheds, today).drops;
      periodKey = dayKey(today);
    } else if (t.kind === 'weekly') {
      const ws = weekStart(today);
      const s = scheduleAt(scheds, ws);
      const done = (await one<{ n: number }>(c, 'SELECT count(*)::int AS n FROM task_completions WHERE task_id=$1 AND local_date BETWEEN $2 AND $3', [t.id, ws, addDays(ws, 6)]))!.n;
      if (done >= (s.times_per_week ?? 1)) throw conflict(`На этой неделе уже ${done} из ${s.times_per_week} — следующие выполнения со следующей недели`, 'week_limit');
      drops = scheduleAt(scheds, today).drops;
      periodKey = weekKey(today);
    }
    const tree = await lockTreeBySphere(c, userId, t.sphere_id);
    const comp = (await one<{ id: number }>(
      c,
      `INSERT INTO task_completions(task_id,user_id,tree_id,sphere_id,local_date,period_key,drops_awarded) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [t.id, userId, tree.id, t.sphere_id, today, periodKey, drops],
    ))!;
    await applyDrops(c, { tree, type: 'task_reward', requested: drops, sourceType: 'task_completion', sourceId: comp.id, key: `complete:${t.id}:${today}` });
    await c.query('UPDATE trees SET last_activity_at=now() WHERE id=$1', [tree.id]);
    await c.query(
      `UPDATE tasks SET completions_count=completions_count+1, status=CASE WHEN kind='once' THEN 'completed' ELSE status END,
        next_process_at=CASE WHEN kind='once' THEN NULL ELSE next_process_at END, updated_at=now() WHERE id=$1`,
      [t.id],
    );
    if (t.kind === 'once') {
      await c.query(
        `INSERT INTO task_occurrences(task_id, period_key, period_start, period_end, required, done, status) VALUES ($1,$2,$3,$3,1,1,'done') ON CONFLICT DO NOTHING`,
        [t.id, ONCE_KEY, today],
      );
    }
    const unlocked = await syncRewards(c, userId, t.id);
    const firstEver = (await one<{ n: number }>(c, 'SELECT count(*)::int AS n FROM task_completions WHERE user_id=$1', [userId]))!.n === 1;
    await track(c, userId, 'task_completed', { kind: t.kind, sphere: t.sphere_id, first: firstEver }, `task_completed:${comp.id}`);
    await track(c, userId, 'drops_earned', { amount: drops, sphere: t.sphere_id }, `drops_earned:${comp.id}`);
    return { already: false, drops, unlocked };
  });
  const task = await getTaskView(userId, taskId);
  const tree = await one<any>(pool, 'SELECT available_drops, level FROM trees WHERE user_id=$1 AND sphere_id=$2', [userId, task.sphere]);
  return { ...result, task, tree: { sphere: task.sphere, availableDrops: tree.available_drops, level: tree.level } };
}

// ---------------------------------------------------------------- привычки
export async function recomputeHealth(c: PoolClient, userId: number) {
  const rows = await q<{ task_id: number; d: string; yes: boolean }>(
    c,
    `SELECT h.task_id, h.local_date::text AS d, h.answer_yes AS yes FROM habit_checkins h JOIN tasks t ON t.id=h.task_id
     WHERE h.user_id=$1 AND t.kind='habit' AND t.deleted_at IS NULL ORDER BY h.local_date`,
    [userId],
  );
  const by = new Map<number, HabitCheckin[]>();
  for (const r of rows) by.set(r.task_id, [...(by.get(r.task_id) ?? []), { date: r.d, yes: r.yes }]);
  const state = healthTreeState([...by.values()]);
  await c.query(`UPDATE trees SET health_visual_state=$2, updated_at=now() WHERE user_id=$1 AND sphere_id='health'`, [userId, state]);
  return state;
}

export async function habitCheckin(userId: number, taskId: number, yes: boolean) {
  const now = clock.now();
  const res = await tx(async (c) => {
    const t = await lockTask(c, userId, taskId);
    if (t.kind !== 'habit') throw badRequest('Это не вредная привычка', 'not_habit');
    if (t.status !== 'active') throw conflict('Задача закрыта', 'task_closed');
    const tz = await userTz(c, userId);
    const today = localDate(now, tz);
    if (t.processed_through && today <= t.processed_through) throw conflict('Этот день уже закрыт', 'period_closed');
    const existing = await one<any>(c, 'SELECT * FROM habit_checkins WHERE task_id=$1 AND local_date=$2 FOR UPDATE', [t.id, today]);
    if (existing && existing.answer_yes === yes) return { changed: false, amount: 0 };
    const s = scheduleAt(await loadSchedules(c, t.id), today);
    const target = habitTargetAmount(yes, s.drops, s.hardcore);
    const applied = existing?.applied_amount ?? 0;
    const delta = target - applied;
    const revision = (existing?.revision ?? 0) + 1;
    const tree = await lockTreeBySphere(c, userId, 'health');
    let actual = 0;
    if (delta !== 0) {
      const type = existing ? 'habit_correction' : yes ? 'penalty' : 'habit_reward';
      const r = await applyDrops(c, { tree, type, requested: delta, sourceType: 'habit_checkin', sourceId: t.id, key: `habit:${t.id}:${today}:r${revision}` });
      actual = r.amount;
    }
    await c.query(
      `INSERT INTO habit_checkins(task_id,user_id,local_date,answer_yes,applied_amount,revision) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (task_id, local_date) DO UPDATE SET answer_yes=EXCLUDED.answer_yes, applied_amount=EXCLUDED.applied_amount, revision=EXCLUDED.revision, updated_at=now()`,
      [t.id, userId, today, yes, applied + actual, revision],
    );
    // «Нет» = успешный день: считается выполнением для подарков и челленджей.
    if (!yes) {
      await c.query(
        `INSERT INTO task_completions(task_id,user_id,tree_id,sphere_id,local_date,period_key,drops_awarded) VALUES ($1,$2,$3,'health',$4,$5,$6)`,
        [t.id, userId, tree.id, today, dayKey(today), Math.max(0, applied + actual)],
      );
      await c.query('UPDATE tasks SET completions_count=completions_count+1 WHERE id=$1', [t.id]);
    } else if (existing && !existing.answer_yes) {
      await c.query('DELETE FROM task_completions WHERE task_id=$1 AND local_date=$2', [t.id, today]);
      await c.query('UPDATE tasks SET completions_count=GREATEST(completions_count-1,0) WHERE id=$1', [t.id]);
    }
    await c.query('UPDATE trees SET last_activity_at=now() WHERE id=$1', [tree.id]);
    const unlocked = await syncRewards(c, userId, t.id);
    const state = await recomputeHealth(c, userId);
    await track(c, userId, 'habit_checkin', {}, `habit:${t.id}:${today}:r${revision}`);
    if (actual > 0) await track(c, userId, 'drops_earned', { amount: actual, sphere: 'health' }, `habit_earn:${t.id}:${today}:r${revision}`);
    if (actual < 0) await track(c, userId, 'drops_penalized', { amount: -actual, sphere: 'health' }, `habit_pen:${t.id}:${today}:r${revision}`);
    return { changed: true, amount: actual, healthState: state, unlocked };
  });
  const task = await getTaskView(userId, taskId);
  const tree = await one<any>(pool, `SELECT available_drops, level, health_visual_state FROM trees WHERE user_id=$1 AND sphere_id='health'`, [userId]);
  return { ...res, task, tree: { sphere: 'health', availableDrops: tree.available_drops, level: tree.level, healthVisualState: tree.health_visual_state } };
}

// ---------------------------------------------------------------- чтение
type Cell = { key: string; label: string; sub?: string; status: 'done' | 'missed' | 'yes' | 'unanswered' | 'today' | 'future' | 'grace' | 'partial' | 'expired' | 'pending'; done?: number; required?: number };

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const dayLabel = (d: string) => String(Number(d.slice(8, 10)));
const monthLabel = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1];

async function buildHistory(db: Db, t: TaskRow, today: string, fromDate: string | null, futureDays: number): Promise<Cell[]> {
  if (t.kind === 'once') {
    const status = t.status === 'completed' ? 'done' : t.status === 'expired' ? 'expired' : 'pending';
    return [{ key: ONCE_KEY, label: 'дедлайн', status }];
  }
  const start = fromDate && fromDate > t.created_local_date ? fromDate : t.created_local_date;
  if (t.kind === 'weekly') {
    const scheds = await loadSchedules(db, t.id);
    const comps = await q<{ d: string }>(db, 'SELECT local_date::text AS d FROM task_completions WHERE task_id=$1', [t.id]);
    const cells: Cell[] = [];
    const firstWeek = weekStart(start);
    const createdWeek = weekStart(t.created_local_date);
    for (let w = firstWeek; w <= addDays(weekStart(today), 7 * Math.ceil(futureDays / 7)); w = addDays(w, 7)) {
      const done = comps.filter((c) => c.d >= w && c.d <= addDays(w, 6)).length;
      const required = scheduleAt(scheds, w).times_per_week ?? 1;
      const end = addDays(w, 6);
      let status: Cell['status'];
      if (w > today) status = 'future';
      else if (end >= today) status = done >= required ? 'done' : 'today';
      else if (done >= required) status = 'done';
      else if (w === createdWeek) status = done > 0 ? 'partial' : 'grace';
      else status = done > 0 ? 'partial' : 'missed';
      cells.push({ key: weekKey(w), label: `${dayLabel(w)}–${dayLabel(end)}`, sub: monthLabel(end), status, done, required });
    }
    return cells;
  }
  const to = addDays(today, futureDays);
  if (t.kind === 'habit') {
    const rows = await q<{ d: string; yes: boolean }>(db, 'SELECT local_date::text AS d, answer_yes AS yes FROM habit_checkins WHERE task_id=$1 AND local_date >= $2', [t.id, start]);
    const map = new Map(rows.map((r) => [r.d, r.yes]));
    return dateRange(start, to).map((d) => {
      const a = map.get(d);
      const status: Cell['status'] = a === true ? 'yes' : a === false ? 'done' : d > today ? 'future' : d === today ? 'today' : d === t.created_local_date ? 'grace' : 'unanswered';
      return { key: d, label: dayLabel(d), sub: monthLabel(d), status };
    });
  }
  const rows = await q<{ d: string }>(db, 'SELECT local_date::text AS d FROM task_completions WHERE task_id=$1 AND local_date >= $2', [t.id, start]);
  const done = new Set(rows.map((r) => r.d));
  return dateRange(start, to).map((d) => {
    const status: Cell['status'] = done.has(d) ? 'done' : d > today ? 'future' : d === today ? 'today' : d === t.created_local_date ? 'grace' : 'missed';
    return { key: d, label: dayLabel(d), sub: monthLabel(d), status };
  });
}

async function taskView(db: Db, t: TaskRow, tz: string, opts: { historyDays?: number; full?: boolean } = {}) {
  const now = clock.now();
  const today = localDate(now, tz);
  const scheds = t.kind === 'once' ? [] : await loadSchedules(db, t.id);
  const rewards = await q<any>(db, 'SELECT id, threshold, title, status, unlocked_at FROM reward_promises WHERE task_id=$1 ORDER BY threshold', [t.id]);
  const doneToday = !!(await one(db, 'SELECT 1 FROM task_completions WHERE task_id=$1 AND local_date=$2', [t.id, today]));
  const checkin = t.kind === 'habit' ? await one<any>(db, 'SELECT answer_yes FROM habit_checkins WHERE task_id=$1 AND local_date=$2', [t.id, today]) : null;
  let week: { done: number; required: number } | null = null;
  if (t.kind === 'weekly') {
    const ws = weekStart(today);
    const done = (await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM task_completions WHERE task_id=$1 AND local_date BETWEEN $2 AND $3', [t.id, ws, addDays(ws, 6)]))!.n;
    week = { done, required: scheduleAt(scheds, ws).times_per_week ?? 1 };
  }
  const current = scheds.length ? scheduleAt(scheds, today) : null;
  const pending = scheds.find((s) => s.effective_from > today) ?? null;
  let canComplete = t.status === 'active' && !doneToday;
  if (t.kind === 'weekly' && week && week.done >= week.required) canComplete = false;
  if (t.kind === 'once' && t.deadline_at && now.getTime() > t.deadline_at.getTime()) canComplete = false;
  const hoursLeft = t.deadline_at ? (t.deadline_at.getTime() - now.getTime()) / 3600_000 : null;
  const fromDate = opts.full ? null : addDays(today, -(opts.historyDays ?? 21));
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    sphere: t.sphere_id,
    kind: t.kind,
    timesPerWeek: current?.times_per_week ?? t.times_per_week,
    drops: current?.drops ?? t.drops,
    hardcore: current?.hardcore ?? t.hardcore,
    penaltyDrops: t.penalty_drops,
    deadlineAt: t.deadline_at,
    habitQuestion: t.habit_question,
    habitMissingPenalty: t.habit_missing_penalty,
    status: t.status,
    locked: !!t.terms_locked_at,
    completionsCount: t.completions_count,
    createdLocalDate: t.created_local_date,
    today: { date: today, done: doneToday, answer: checkin ? (checkin.answer_yes ? 'yes' : 'no') : null, canComplete },
    week,
    deadlineSoon: t.kind === 'once' && t.status === 'active' && hoursLeft !== null && hoursLeft > 0 && hoursLeft <= 24,
    pendingSchedule: pending ? { effectiveFrom: pending.effective_from, drops: pending.drops, timesPerWeek: pending.times_per_week, hardcore: pending.hardcore } : null,
    rewards: rewards.map((r) => ({ id: r.id, threshold: r.threshold, title: r.title, status: r.status })),
    history: await buildHistory(db, t, today, fromDate, opts.full ? 14 : 3),
  };
}

export async function getTaskView(userId: number, taskId: number, full = false) {
  const t = await one<TaskRow>(pool, 'SELECT * FROM tasks WHERE id=$1 AND user_id=$2', [taskId, userId]);
  if (!t || (t.deleted_at && !full)) throw notFound('Задача не найдена');
  return taskView(pool, t, await userTz(pool, userId), { full });
}

export async function listTasks(userId: number) {
  const tz = await userTz(pool, userId);
  const rows = await q<TaskRow>(pool, `SELECT * FROM tasks WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at`, [userId]);
  const out = [];
  for (const t of rows) out.push(await taskView(pool, t, tz));
  return out;
}

export async function taskHistory(userId: number, taskId: number) {
  const view = await getTaskView(userId, taskId, true);
  const ledger = await q<any>(
    pool,
    `SELECT l.type, l.amount, l.requested_amount, l.created_at FROM drop_ledger l
     WHERE l.user_id=$1 AND (
       (l.source_type='task_completion' AND l.source_id IN (SELECT id FROM task_completions WHERE task_id=$2))
       OR (l.source_type IN ('task_penalty','habit_checkin') AND l.source_id=$2))
     ORDER BY l.id DESC LIMIT 200`,
    [userId, taskId],
  );
  return { task: view, ledger };
}

export { diffDays };
