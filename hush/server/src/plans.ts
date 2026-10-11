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

/** Повторное оформление после отмены подписки — по тарифу ×3 */
export const RETURNING_MULTIPLIER = 3;
/** Скидка удержания: −50% на один следующий платёж */
export const RETENTION_DISCOUNT = 0.5;

export async function priceMultiplier(userId: number): Promise<number> {
  const { rows } = await pool.query('SELECT cancelled_at FROM users WHERE id = $1', [userId]);
  return rows[0]?.cancelled_at ? RETURNING_MULTIPLIER : 1;
}

/** Разовое раскрытие одного автора на тарифах 1 и 3 месяца */
export const REVEAL_PRICE = 99;

export const isPlan = (v: unknown): v is Plan => typeof v === 'string' && v in PLANS;

export interface PlanState {
  plan: Plan | null;
  autoRenew: boolean;
  renewsAt: string | null;
  /** Есть ли подписка с автосписанием в CloudPayments */
  hasSubscription: boolean;
  /** Обычная сумма автосписания */
  amount: number | null;
  /** Сумма следующего списания (со скидкой удержания, если она принята) */
  nextChargeAmount: number | null;
  /** Можно ли предложить скидку удержания при отмене */
  retentionOfferAvailable: boolean;
}

export async function getPlan(user: Pick<TgUser, 'id' | 'username'>): Promise<PlanState> {
  const { rows } = await pool.query(
    `SELECT plan, auto_renew, renews_at, subscription_id, base_amount, discount_next, retention_used FROM entitlements
     WHERE user_id = $1 AND (renews_at IS NULL OR renews_at > now())`,
    [user.id],
  );
  const row = rows[0];
  if (row) {
    const amount = row.base_amount === null ? null : Number(row.base_amount);
    return {
      plan: row.plan,
      autoRenew: row.auto_renew,
      renewsAt: row.renews_at ? new Date(row.renews_at).toISOString() : null,
      hasSubscription: Boolean(row.subscription_id),
      amount,
      nextChargeAmount: amount === null ? null : row.discount_next ? Math.round(amount * RETENTION_DISCOUNT) : amount,
      retentionOfferAvailable: Boolean(row.subscription_id && row.auto_renew && !row.retention_used && amount),
    };
  }
  // Тестовая выдача годового Premium (GRANT_PREMIUM_IDS), пока нет оплаченной подписки
  const granted = config.grantPremiumIds;
  if (granted.has(String(user.id)) || (user.username && granted.has(user.username.toLowerCase()))) {
    return { plan: 'year', autoRenew: false, renewsAt: null, hasSubscription: false, amount: null, nextChargeAmount: null, retentionOfferAvailable: false };
  }
  return { plan: null, autoRenew: false, renewsAt: null, hasSubscription: false, amount: null, nextChargeAmount: null, retentionOfferAvailable: false };
}
