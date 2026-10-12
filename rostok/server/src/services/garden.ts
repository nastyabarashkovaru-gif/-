import type { PoolClient } from 'pg';
import { SPHERES, gardenLevel, gardenThreshold, decorForGardenLevel, wateringCost, localDate, openStreak, diffDays, isSphereId, weekStart, type LevelCurve } from '@rostok/shared';
import { curveFresh, getCurve } from '../appConfig.js';
import { clock } from '../clock.js';
import { one, pool, q, tx, type Db } from '../db.js';
import { AppError, badRequest } from '../errors.js';
import { track } from '../analytics.js';
import { applyDrops, type TreeRow } from './ledger.js';

export function treeView(t: TreeRow, curve: LevelCurve) {
  const cost = wateringCost(t.level, curve);
  return {
    sphere: t.sphere_id,
    level: t.level,
    availableDrops: t.available_drops,
    totalEarnedDrops: t.total_earned_drops,
    totalSpentDrops: t.total_spent_drops,
    totalPenaltyDrops: t.total_penalty_drops,
    nextCost: cost,
    canWater: t.available_drops >= cost,
    healthVisualState: t.health_visual_state,
    visualVariant: t.visual_variant,
  };
}

export async function userTz(db: Db, userId: number): Promise<string> {
  return (await one<{ timezone: string }>(db, 'SELECT timezone FROM users WHERE id=$1', [userId]))!.timezone;
}

/** Отметка открытия Mini App: уникальные локальные календарные дни; рекорд хранится отдельно. */
export async function recordOpen(userId: number) {
  const tz = await userTz(pool, userId);
  const today = localDate(clock.now(), tz);
  await pool.query('INSERT INTO garden_open_days(user_id, local_date) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, today]);
  const s = await streakInfo(pool, userId, today);
  await pool.query('UPDATE users SET best_open_streak=GREATEST(best_open_streak,$2), last_seen_at=now() WHERE id=$1', [userId, s.current]);
  return s;
}

async function streakInfo(db: Db, userId: number, today: string) {
  const days = (await q<{ d: string }>(db, `SELECT local_date AS d FROM garden_open_days WHERE user_id=$1 AND local_date > $2::date - 400 ORDER BY 1`, [userId, today])).map((r) => r.d);
  const current = openStreak(days, today);
  const best = (await one<{ b: number }>(db, 'SELECT best_open_streak AS b FROM users WHERE id=$1', [userId]))!.b;
  return { current, best: Math.max(best, current) };
}

export async function getGarden(userId: number) {
  const curve = await getCurve();
  const user = (await one<any>(pool, 'SELECT id, first_name, timezone, activated_at FROM users WHERE id=$1', [userId]))!;
  const today = localDate(clock.now(), user.timezone);
  const trees = await q<TreeRow>(pool, 'SELECT * FROM trees WHERE user_id=$1', [userId]);
  const order = new Map(SPHERES.map((s) => [s.id, s.sort]));
  trees.sort((a, b) => order.get(a.sphere_id as any)! - order.get(b.sphere_id as any)!);
  const spent = trees.reduce((s, t) => s + t.total_spent_drops, 0);
  const gl = gardenLevel(spent);
  const progress = await todayProgress(pool, userId, today);
  const streak = await streakInfo(pool, userId, today);
  return {
    today,
    streak,
    garden: {
      level: gl,
      totalSpentDrops: spent,
      levelFloor: gardenThreshold(gl),
      nextLevelAt: gardenThreshold(gl + 1),
      decor: decorForGardenLevel(gl),
    },
    trees: trees.map((t) => treeView(t, curve)),
    todayProgress: progress,
  };
}

/** «Сегодня: 4 из 7» — задачи, запланированные на сегодня (ежедневные, привычки, недельные с остатком, одноразовые с дедлайном сегодня). */
export async function todayProgress(db: Db, userId: number, today: string) {
  const rows = await q<any>(
    db,
    `SELECT t.id, t.kind, t.times_per_week, t.deadline_at, u.timezone,
       EXISTS (SELECT 1 FROM task_completions c WHERE c.task_id=t.id AND c.local_date=$2) AS done_today,
       EXISTS (SELECT 1 FROM habit_checkins h WHERE h.task_id=t.id AND h.local_date=$2) AS answered_today,
       (SELECT count(*)::int FROM task_completions c WHERE c.task_id=t.id AND c.local_date >= $3 AND c.local_date < $2) AS week_done_before
     FROM tasks t JOIN users u ON u.id=t.user_id
     WHERE t.user_id=$1 AND t.deleted_at IS NULL AND (t.status='active' OR (t.status='completed' AND t.kind='once'))`,
    [userId, today, weekStart(today)],
  );
  let total = 0;
  let done = 0;
  for (const r of rows) {
    if (r.kind === 'daily') { total++; if (r.done_today) done++; }
    else if (r.kind === 'habit') { total++; if (r.answered_today) done++; }
    else if (r.kind === 'weekly') {
      if (r.week_done_before < r.times_per_week) { total++; if (r.done_today) done++; }
    } else if (r.kind === 'once') {
      if (localDate(new Date(r.deadline_at), r.timezone) === today) { total++; if (r.done_today) done++; }
    }
  }
  return { done, total };
}

/**
 * Атомарный полив: в одной транзакции проверяются цена, баланс, уровень и ключ идемпотентности.
 * UNIQUE(tree_id, from_level) гарантирует ровно один полив на уровень даже при параллельных запросах.
 */
export async function water(userId: number, sphere: string, idempotencyKey: string, expectedLevel?: number) {
  if (!isSphereId(sphere)) throw badRequest('Неизвестная сфера');
  if (!idempotencyKey || idempotencyKey.length > 100) throw badRequest('Нужен ключ идемпотентности');
  const res = await tx(async (c) => {
    const tree = (await one<TreeRow>(c, 'SELECT * FROM trees WHERE user_id=$1 AND sphere_id=$2 FOR UPDATE', [userId, sphere]))!;
    const curve = await curveFresh(c);
    const dup = await one<any>(c, 'SELECT * FROM waterings WHERE user_id=$1 AND idempotency_key=$2', [userId, idempotencyKey]);
    if (dup || (expectedLevel !== undefined && expectedLevel !== tree.level)) {
      return { duplicate: true, tree, curve, watering: dup, newGardenLevels: [] as number[] };
    }
    const cost = wateringCost(tree.level, curve);
    if (tree.available_drops < cost) {
      throw new AppError(409, 'not_enough_drops', `Для следующего полива нужно ещё ${cost - tree.available_drops}`, {
        need: cost - tree.available_drops, cost, available: tree.available_drops,
      });
    }
    const spentBefore = (await one<{ s: number }>(c, 'SELECT COALESCE(sum(total_spent_drops),0)::int AS s FROM trees WHERE user_id=$1', [userId]))!.s;
    const w = (await one<any>(
      c,
      `INSERT INTO waterings(tree_id,user_id,from_level,to_level,cost,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tree.id, userId, tree.level, tree.level + 1, cost, idempotencyKey],
    ))!;
    await applyDrops(c, { tree, type: 'watering', requested: -cost, sourceType: 'watering', sourceId: w.id, key: `water:${tree.id}:${tree.level}` });
    await c.query('UPDATE trees SET level=level+1, last_activity_at=now() WHERE id=$1', [tree.id]);
    await c.query('INSERT INTO tree_unlocks(tree_id, level, watering_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [tree.id, tree.level + 1, w.id]);
    const before = gardenLevel(spentBefore);
    const after = gardenLevel(spentBefore + cost);
    const newGardenLevels: number[] = [];
    for (let l = before + 1; l <= after; l++) {
      await c.query('INSERT INTO garden_levels(user_id, level) VALUES ($1,$2) ON CONFLICT DO NOTHING', [userId, l]);
      newGardenLevels.push(l);
    }
    await track(c, userId, 'watering_success', { sphere, from_level: tree.level, cost }, `water:${w.id}`);
    await track(c, userId, 'level_unlocked', { sphere, level: tree.level + 1 }, `lvl:${w.id}`);
    tree.level += 1;
    return { duplicate: false, tree, curve, watering: w, newGardenLevels };
  });
  const view = treeView(res.tree, res.curve);
  return { duplicate: res.duplicate, tree: view, newGardenLevels: res.newGardenLevels, newDecor: res.newGardenLevels.flatMap((l) => decorForGardenLevel(l).filter((d) => !decorForGardenLevel(l - 1).includes(d))) };
}

export async function getTree(userId: number, sphere: string) {
  if (!isSphereId(sphere)) throw badRequest('Неизвестная сфера');
  const curve = await getCurve();
  const tree = await one<TreeRow>(pool, 'SELECT * FROM trees WHERE user_id=$1 AND sphere_id=$2', [userId, sphere]);
  if (!tree) throw new AppError(404, 'not_found', 'Дерево не найдено');
  const unlocks = await q<any>(pool, 'SELECT level, unlocked_at FROM tree_unlocks WHERE tree_id=$1 ORDER BY level DESC LIMIT 20', [tree.id]);
  const ledger = await q<any>(pool, 'SELECT type, amount, requested_amount, balance_after, created_at FROM drop_ledger WHERE tree_id=$1 ORDER BY id DESC LIMIT 30', [tree.id]);
  const nextGift = await one<any>(
    pool,
    `SELECT r.id, r.title, r.threshold, t.completions_count, t.title AS task_title
     FROM reward_promises r JOIN tasks t ON t.id=r.task_id
     WHERE r.user_id=$1 AND t.sphere_id=$2 AND r.status='locked' AND t.deleted_at IS NULL
     ORDER BY (r.threshold - t.completions_count) ASC LIMIT 1`,
    [userId, sphere],
  );
  return { tree: treeView(tree, curve), unlocks, ledger, nextGift: nextGift ?? null };
}

/** Возраст сада: календарные дни с первой активации (не путать с серией входов). */
export function gardenAgeDays(activatedAt: Date | null, tz: string): number {
  if (!activatedAt) return 0;
  return diffDays(localDate(clock.now(), tz), localDate(activatedAt, tz)) + 1;
}

export async function lockTreeBySphere(c: PoolClient, userId: number, sphereId: string) {
  return (await one<TreeRow>(c, 'SELECT * FROM trees WHERE user_id=$1 AND sphere_id=$2 FOR UPDATE', [userId, sphereId]))!;
}
