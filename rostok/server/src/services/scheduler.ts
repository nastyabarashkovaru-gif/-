import { addDays, dateRange, dayKey, localDate, ONCE_KEY, weekKey, weekStart } from '@rostok/shared';
import { clock } from '../clock.js';
import { one, pool, q, tx } from '../db.js';
import { track } from '../analytics.js';
import { applyDrops } from './ledger.js';
import { lockTreeBySphere } from './garden.js';
import { loadSchedules, nextProcessAt, scheduleAt, type TaskRow } from './tasks.js';

/**
 * Закрытие прошедших периодов задачи: пропуски, штрафы хардкора, истечение одноразовых.
 * Идемпотентно (курсор processed_through + уникальные ключи ledger/occurrences) и не зависит от входа пользователя:
 * после простоя catch-up обрабатывает все пропущенные периоды ровно один раз.
 * Период, в котором задача создана, — «льготный»: штрафов за него нет.
 */
export async function processTask(taskId: number): Promise<void> {
  await tx(async (c) => {
    const t = await one<TaskRow & { timezone: string }>(
      c, `SELECT t.*, u.timezone FROM tasks t JOIN users u ON u.id=t.user_id WHERE t.id=$1 FOR UPDATE OF t`, [taskId],
    );
    if (!t || t.deleted_at || t.status !== 'active') {
      if (t) await c.query('UPDATE tasks SET next_process_at=NULL WHERE id=$1', [taskId]);
      return;
    }
    const now = clock.now();
    const tz = t.timezone;
    const today = localDate(now, tz);

    if (t.kind === 'once') {
      if (now.getTime() <= t.deadline_at!.getTime()) {
        await c.query('UPDATE tasks SET next_process_at=deadline_at WHERE id=$1', [t.id]);
        return;
      }
      await c.query(`UPDATE tasks SET status='expired', next_process_at=NULL, updated_at=now() WHERE id=$1`, [t.id]);
      const dl = localDate(t.deadline_at!, tz);
      let penalty = 0;
      if (t.hardcore && t.penalty_drops) {
        const tree = await lockTreeBySphere(c, t.user_id, t.sphere_id);
        const r = await applyDrops(c, { tree, type: 'penalty', requested: -t.penalty_drops, sourceType: 'task_penalty', sourceId: t.id, key: `pen:${t.id}:${ONCE_KEY}` });
        penalty = -r.amount;
        await track(c, t.user_id, 'drops_penalized', { amount: penalty, sphere: t.sphere_id, kind: 'once' }, `pen:${t.id}:once`);
      }
      await c.query(
        `INSERT INTO task_occurrences(task_id,period_key,period_start,period_end,required,done,status,penalty_applied)
         VALUES ($1,$2,$3,$3,1,0,'expired',$4) ON CONFLICT (task_id, period_key) DO NOTHING`,
        [t.id, ONCE_KEY, dl, penalty],
      );
      return;
    }

    const scheds = await loadSchedules(c, t.id);
    const penalize = async (key: string, amount: number) => {
      const tree = await lockTreeBySphere(c, t.user_id, t.sphere_id);
      const r = await applyDrops(c, { tree, type: 'penalty', requested: -amount, sourceType: 'task_penalty', sourceId: t.id, key: `pen:${t.id}:${key}` });
      if (r.applied && r.amount < 0) await track(c, t.user_id, 'drops_penalized', { amount: -r.amount, sphere: t.sphere_id, kind: t.kind }, `pen:${t.id}:${key}`);
      return -r.amount;
    };

    if (t.kind === 'weekly') {
      const curWeek = weekStart(today);
      let w = addDays(weekStart(t.created_local_date), 7); // неделя создания — льготная
      if (t.processed_through) w = w > addDays(t.processed_through, 1) ? w : addDays(t.processed_through, 1);
      let through = t.processed_through;
      for (; w < curWeek; w = addDays(w, 7)) {
        const s = scheduleAt(scheds, w);
        const end = addDays(w, 6);
        const done = (await one<{ n: number }>(c, 'SELECT count(*)::int AS n FROM task_completions WHERE task_id=$1 AND local_date BETWEEN $2 AND $3', [t.id, w, end]))!.n;
        const required = s.times_per_week ?? 1;
        const missing = Math.max(0, required - done);
        let pen = 0;
        if (missing > 0 && s.hardcore) pen = await penalize(weekKey(w), missing);
        await c.query(
          `INSERT INTO task_occurrences(task_id,period_key,period_start,period_end,required,done,status,penalty_applied)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (task_id, period_key) DO NOTHING`,
          [t.id, weekKey(w), w, end, required, done, missing === 0 ? 'done' : done > 0 ? 'partial' : 'missed', pen],
        );
        through = end;
      }
      await c.query('UPDATE tasks SET processed_through=$2, next_process_at=$3 WHERE id=$1', [t.id, through, nextProcessAt('weekly', today, tz)]);
      return;
    }

    // daily / habit: каждый прошедший день после дня создания
    const from = t.processed_through && t.processed_through >= t.created_local_date ? addDays(t.processed_through, 1) : addDays(t.created_local_date, 1);
    const to = addDays(today, -1);
    let through = t.processed_through;
    if (from <= to) {
      const days = dateRange(from, to);
      if (t.kind === 'daily') {
        const done = new Set((await q<{ d: string }>(c, 'SELECT local_date::text AS d FROM task_completions WHERE task_id=$1 AND local_date BETWEEN $2 AND $3', [t.id, from, to])).map((r) => r.d));
        for (const d of days) {
          const s = scheduleAt(scheds, d);
          const ok = done.has(d);
          const pen = !ok && s.hardcore ? await penalize(dayKey(d), 1) : 0;
          await c.query(
            `INSERT INTO task_occurrences(task_id,period_key,period_start,period_end,required,done,status,penalty_applied)
             VALUES ($1,$2,$3,$3,1,$4,$5,$6) ON CONFLICT (task_id, period_key) DO NOTHING`,
            [t.id, dayKey(d), d, ok ? 1 : 0, ok ? 'done' : 'missed', pen],
          );
        }
      } else {
        const ans = new Map((await q<{ d: string; yes: boolean }>(c, 'SELECT local_date::text AS d, answer_yes AS yes FROM habit_checkins WHERE task_id=$1 AND local_date BETWEEN $2 AND $3', [t.id, from, to])).map((r) => [r.d, r.yes]));
        for (const d of days) {
          const s = scheduleAt(scheds, d);
          const a = ans.get(d);
          // Пропуск ответа штрафуется только при хардкоре и явном согласии пользователя
          const pen = a === undefined && s.hardcore && t.habit_missing_penalty ? await penalize(dayKey(d), 1) : 0;
          await c.query(
            `INSERT INTO task_occurrences(task_id,period_key,period_start,period_end,required,done,status,penalty_applied)
             VALUES ($1,$2,$3,$3,1,$4,$5,$6) ON CONFLICT (task_id, period_key) DO NOTHING`,
            [t.id, dayKey(d), d, a === false ? 1 : 0, a === undefined ? 'unanswered' : a ? 'missed' : 'done', pen],
          );
        }
      }
      through = to;
    }
    await c.query('UPDATE tasks SET processed_through=$2, next_process_at=$3 WHERE id=$1', [t.id, through, nextProcessAt(t.kind, today, tz)]);
  });
}

/** Все задачи, у которых наступило время обработки. */
export async function processDueTasks(limit = 500): Promise<number> {
  const due = await q<{ id: number }>(
    pool,
    `SELECT id FROM tasks WHERE deleted_at IS NULL AND status='active' AND (next_process_at IS NULL OR next_process_at <= $1) ORDER BY next_process_at NULLS FIRST LIMIT $2`,
    [clock.now(), limit],
  );
  for (const { id } of due) await processTask(id);
  return due.length;
}
