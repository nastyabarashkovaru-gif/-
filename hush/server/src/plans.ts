import type { TgUser } from './auth';
import { config } from './config';
import { pool } from './db';

export type Plan = 'month' | 'quarter' | 'year';

/** Цены — только на сервере: клиент не может их подменить */
export const PLANS: Record<Plan, { amount: number; months: number; title: string }> = {
  month: { amount: 299, months: 1, title: 'hush. Premium — 1 месяц' },
  quarter: { amount: 499, months: 3, title: 'hush. Premium — 3 месяца' },
  year: { amount: 1499, months: 12, title: 'hush. Premium — 1 год' },
};

export const isPlan = (v: unknown): v is Plan => typeof v === 'string' && v in PLANS;

export interface PlanState {
  plan: Plan | null;
  autoRenew: boolean;
  renewsAt: string | null;
  /** Есть ли подписка с автосписанием в CloudPayments */
  hasSubscription: boolean;
}

export async function getPlan(user: Pick<TgUser, 'id' | 'username'>): Promise<PlanState> {
  const { rows } = await pool.query(
    `SELECT plan, auto_renew, renews_at, subscription_id FROM entitlements
     WHERE user_id = $1 AND (renews_at IS NULL OR renews_at > now())`,
    [user.id],
  );
  const row = rows[0];
  if (row) {
    return {
      plan: row.plan,
      autoRenew: row.auto_renew,
      renewsAt: row.renews_at ? new Date(row.renews_at).toISOString() : null,
      hasSubscription: Boolean(row.subscription_id),
    };
  }
  // Тестовая выдача годового Premium (GRANT_PREMIUM_IDS), пока нет оплаченной подписки
  const granted = config.grantPremiumIds;
  if (granted.has(String(user.id)) || (user.username && granted.has(user.username.toLowerCase()))) {
    return { plan: 'year', autoRenew: false, renewsAt: null, hasSubscription: false };
  }
  return { plan: null, autoRenew: false, renewsAt: null, hasSubscription: false };
}
