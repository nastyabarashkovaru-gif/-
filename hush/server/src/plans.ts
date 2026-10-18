import type { TgUser } from './auth';
import { config } from './config';
import { pool } from './db';

export type Plan = 'month' | 'quarter' | 'year';

/**
 * Цены — только на сервере: клиент не может их подменить.
 * amount — цена по предложению (первые 3 часа после показа тарифов), standard — обычная цена.
 */
export const PLANS: Record<Plan, { amount: number; standard: number; months: number; title: string }> = {
  month: { amount: 299, standard: 990, months: 1, title: 'hush. Premium — 1 месяц' },
  quarter: { amount: 499, standard: 1490, months: 3, title: 'hush. Premium — 3 месяца' },
  year: { amount: 1490, standard: 6990, months: 12, title: 'hush. Premium — 1 год' },
};

/** Предложение действует 3 часа с первого показа тарифов */
export const OFFER_HOURS = 3;
/** Скидка удержания: −50% на один следующий платёж */
export const RETENTION_DISCOUNT = 0.5;

export interface Pricing {
  prices: Record<Plan, number>;
  /** Обычные цены (зачёркнутые на экране тарифов) */
  standard: Record<Plan, number>;
  /** Конец предложения 299 ₽ за месяц; null — предложения нет или оно ещё не началось */
  offerEndsAt: string | null;
  /** Пользователь отменял подписку — предложение ему не положено */
  returning: boolean;
}

/**
 * Цены для пользователя: по предложению в течение 3 часов с первого показа тарифов,
 * потом и после отмены подписки — обычные.
 * start = true запускает таймер предложения, если он ещё не запущен.
 */
export async function pricingFor(userId: number, start = false): Promise<Pricing> {
  const { rows } = await pool.query(
    start
      ? `UPDATE users SET offer_started_at = COALESCE(offer_started_at, now()) WHERE id = $1 RETURNING cancelled_at, offer_started_at`
      : 'SELECT cancelled_at, offer_started_at FROM users WHERE id = $1',
    [userId],
  );
  const returning = Boolean(rows[0]?.cancelled_at);
  const started = rows[0]?.offer_started_at ? new Date(rows[0].offer_started_at).getTime() : null;
  const endsAt = started === null ? null : started + OFFER_HOURS * 3600_000;
  // Пока таймер не запущен, предложение ещё впереди — показываем 299 ₽
  const offerActive = !returning && (endsAt === null || endsAt > Date.now());
  const pick = (plan: Plan) => (offerActive ? PLANS[plan].amount : PLANS[plan].standard);
  return {
    prices: { month: pick('month'), quarter: pick('quarter'), year: pick('year') },
    standard: { month: PLANS.month.standard, quarter: PLANS.quarter.standard, year: PLANS.year.standard },
    offerEndsAt: offerActive && endsAt !== null ? new Date(endsAt).toISOString() : null,
    returning,
  };
}

/** Разовое раскрытие одного автора на тарифах 1 и 3 месяца */
export const REVEAL_PRICE = 99;

export const isPlan = (v: unknown): v is Plan => typeof v === 'string' && v in PLANS;
/** Для новых покупок продаётся только месячный тариф; 3 месяца и год остаются у уже оформивших */
export const SOLD_PLANS: Plan[] = ['month'];

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
