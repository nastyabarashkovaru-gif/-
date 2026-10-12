import type { PoolClient } from 'pg';
import { one } from '../db.js';

export type LedgerType = 'task_reward' | 'habit_reward' | 'penalty' | 'watering' | 'habit_correction' | 'adjustment';

export interface TreeRow {
  id: number;
  user_id: number;
  sphere_id: string;
  level: number;
  available_drops: number;
  total_earned_drops: number;
  total_spent_drops: number;
  total_penalty_drops: number;
  health_visual_state: 'normal' | 'withered';
  visual_variant: number;
  last_activity_at: Date | null;
}

export async function lockTree(c: PoolClient, userId: number, sphereId: string): Promise<TreeRow> {
  const t = await one<TreeRow>(c, 'SELECT * FROM trees WHERE user_id=$1 AND sphere_id=$2 FOR UPDATE', [userId, sphereId]);
  if (!t) throw new Error(`tree missing for user ${userId} sphere ${sphereId}`);
  return t;
}

/**
 * Единственная точка изменения баланса капель. Вызывается внутри транзакции.
 * Отрицательные суммы урезаются до доступного баланса (без долга). Повтор ключа — no-op.
 */
export async function applyDrops(
  c: PoolClient,
  p: { tree: TreeRow; type: LedgerType; requested: number; sourceType: string; sourceId: number | null; key: string },
): Promise<{ applied: boolean; amount: number; balance: number }> {
  const existing = await one<{ amount: number; balance_after: number }>(c, 'SELECT amount, balance_after FROM drop_ledger WHERE idempotency_key=$1', [p.key]);
  if (existing) return { applied: false, amount: existing.amount, balance: p.tree.available_drops };
  const t = p.tree;
  const amount = p.requested >= 0 ? p.requested : -Math.min(t.available_drops, -p.requested);
  const balance = t.available_drops + amount;
  let earned = t.total_earned_drops;
  let spent = t.total_spent_drops;
  let penalty = t.total_penalty_drops;
  if (p.type === 'task_reward' || p.type === 'habit_reward' || p.type === 'adjustment') earned += Math.max(amount, 0);
  if (p.type === 'habit_correction') earned = Math.max(0, earned + amount);
  if (p.type === 'penalty') penalty += -amount;
  if (p.type === 'watering') spent += -amount;
  await c.query(
    `INSERT INTO drop_ledger(user_id,tree_id,type,amount,requested_amount,source_type,source_id,idempotency_key,balance_after)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [t.user_id, t.id, p.type, amount, p.requested, p.sourceType, p.sourceId, p.key, balance],
  );
  await c.query(
    `UPDATE trees SET available_drops=$2, total_earned_drops=$3, total_spent_drops=$4, total_penalty_drops=$5, updated_at=now() WHERE id=$1`,
    [t.id, balance, earned, spent, penalty],
  );
  t.available_drops = balance;
  t.total_earned_drops = earned;
  t.total_spent_drops = spent;
  t.total_penalty_drops = penalty;
  return { applied: true, amount, balance };
}
