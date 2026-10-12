import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { clock } from '../clock.js';
import { one, pool, q, tx, type Db } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { track } from '../analytics.js';
import { getProvider } from '../payments/index.js';
import type { PlanRow } from '../payments/provider.js';
import { getValue } from '../appConfig.js';

export type SubStatus = 'none' | 'pending' | 'active' | 'cancel_at_period_end' | 'expired' | 'payment_failed' | 'refunded';
interface SubRow {
  id: number; user_id: number; plan_id: string | null; provider: string; status: SubStatus; current_period_start: Date | null;
  current_period_end: Date | null; provider_ref: string | null; auto_renew: boolean; cancel_requested_at: Date | null;
  retention_offer_used_at: Date | null; next_charge_plan_id: string | null; ever_paid: boolean;
}

/** Короткое окно на случай, если продление Stars приходит на несколько минут позже конца периода. */
const RENEWAL_GRACE_MS = 15 * 60_000;

export function hasAccess(s: Pick<SubRow, 'status' | 'current_period_end' | 'auto_renew'> | undefined, now = clock.now()): boolean {
  if (!s || !s.current_period_end) return false;
  if (!['active', 'cancel_at_period_end', 'payment_failed'].includes(s.status)) return false;
  const grace = s.auto_renew && s.status === 'active' ? RENEWAL_GRACE_MS : 0;
  return now.getTime() < s.current_period_end.getTime() + grace;
}

export async function getEntitlement(db: Db, userId: number) {
  const s = await one<SubRow>(db, 'SELECT * FROM subscriptions WHERE user_id=$1', [userId]);
  return { access: hasAccess(s), sub: s ?? null };
}

async function plans(db: Db): Promise<PlanRow[]> {
  return q<PlanRow>(db, 'SELECT * FROM subscription_plans ORDER BY sort');
}

function planView(p: PlanRow) {
  return {
    id: p.id, title: p.title, subtitle: p.subtitle, kind: p.kind, periodDays: p.period_days,
    priceStars: p.price_stars, displayPriceRub: p.display_price_rub, terms: p.terms,
  };
}

/** Тарифы, доступные пользователю на paywall. Цены и условия — только с сервера. */
export async function availablePlans(userId: number) {
  const all = await plans(pool);
  const { sub } = await getEntitlement(pool, userId);
  const flags = (await getValue<any>('flags')) ?? {};
  const returning = !!sub?.ever_paid;
  return all
    .filter((p) => p.is_active)
    .filter((p) => p.eligibility === 'all' || (p.eligibility === 'returning' && returning && flags.winbackOffer))
    .map(planView);
}

export async function subscriptionState(userId: number) {
  const { access, sub } = await getEntitlement(pool, userId);
  const provider = getProvider();
  const plan = sub?.plan_id ? await one<PlanRow>(pool, 'SELECT * FROM subscription_plans WHERE id=$1', [sub.plan_id]) : null;
  const nextPlan = sub?.next_charge_plan_id ? await one<PlanRow>(pool, 'SELECT * FROM subscription_plans WHERE id=$1', [sub.next_charge_plan_id]) : null;
  return {
    access,
    status: sub?.status ?? 'none',
    plan: plan ? planView(plan) : null,
    accessUntil: sub?.current_period_end ?? null,
    autoRenew: sub?.auto_renew ?? false,
    provider: provider.id,
    isSandbox: provider.id === 'mock',
    nextCharge: sub?.auto_renew && sub.current_period_end ? { at: sub.current_period_end, plan: nextPlan ? planView(nextPlan) : plan ? planView(plan) : null } : null,
  };
}

/** Информация для двухшаговой отмены. Удерживающее предложение — только если провайдер умеет менять следующий платёж. */
export async function cancelInfo(userId: number) {
  const { sub } = await getEntitlement(pool, userId);
  if (!sub || sub.status !== 'active' || !sub.auto_renew) return { cancellable: false };
  const all = await plans(pool);
  const flags = (await getValue<any>('flags')) ?? {};
  const provider = getProvider();
  const standard = all.find((p) => p.id === 'month')!;
  const winback = all.find((p) => p.eligibility === 'returning' && p.is_active && flags.winbackOffer);
  const current = all.find((p) => p.id === sub.plan_id);
  const retention = all.find((p) => p.eligibility === 'retention' && p.is_active);
  const offerAvailable = !!(flags.retentionOffer && provider.supportsNextChargeOverride && retention && !sub.retention_offer_used_at && current?.kind === 'recurring');
  return {
    cancellable: true,
    accessUntil: sub.current_period_end,
    // Предупреждение о цене повторного подключения — только если по тарифной политике она действительно выше текущей
    rejoinPrice: winback && current && winback.price_stars > current.price_stars ? planView(winback) : null,
    currentPlan: current ? planView(current) : null,
    retentionOffer: offerAvailable
      ? { plan: planView(retention!), thenPlan: planView(standard), chargeAt: sub.current_period_end }
      : null,
  };
}

export async function checkout(userId: number, planId: string) {
  const plan = await one<PlanRow>(pool, 'SELECT * FROM subscription_plans WHERE id=$1', [planId]);
  if (!plan || !plan.is_active || plan.eligibility === 'retention') throw notFound('Тариф недоступен');
  const allowed = (await availablePlans(userId)).some((p) => p.id === plan.id);
  if (!allowed) throw new AppError(403, 'plan_not_eligible', 'Этот тариф тебе недоступен');
  const { access, sub } = await getEntitlement(pool, userId);
  if (access && sub?.auto_renew) throw conflict('Подписка уже активна и продлевается автоматически', 'already_active');
  const provider = getProvider();
  const user = (await one<{ telegram_id: number; is_demo: boolean }>(pool, 'SELECT telegram_id, is_demo FROM users WHERE id=$1', [userId]))!;
  if (provider.id === 'telegram_stars' && user.is_demo) throw new AppError(403, 'demo_user', 'Оплата доступна только из Telegram');
  const intentId = randomUUID();
  await pool.query(
    `INSERT INTO payment_intents(id,user_id,plan_id,provider,amount,currency) VALUES ($1,$2,$3,$4,$5,$6)`,
    [intentId, userId, plan.id, provider.id, plan.price_stars, provider.currency],
  );
  await pool.query(
    `INSERT INTO subscriptions(user_id, provider, status) VALUES ($1,$2,'pending')
     ON CONFLICT (user_id) DO UPDATE SET status=CASE WHEN subscriptions.status IN ('none','expired','refunded','payment_failed') THEN 'pending' ELSE subscriptions.status END, updated_at=now()`,
    [userId, provider.id],
  );
  await track(pool, userId, 'checkout_start', { plan: plan.id }, `checkout:${intentId}`);
  const res = await provider.createCheckout({ intentId, plan, telegramId: user.telegram_id });
  if (res.url) await pool.query('UPDATE payment_intents SET invoice_link=$2 WHERE id=$1', [intentId, res.url]);
  return res;
}

/** Проверка перед оплатой (pre_checkout_query): интент существует, не оплачен, сумма и валюта совпадают. */
export async function validateIntent(intentId: string, amount: number, currency: string, telegramId: number) {
  const it = await one<any>(
    pool,
    `SELECT i.*, u.telegram_id FROM payment_intents i JOIN users u ON u.id=i.user_id WHERE i.id=$1`,
    [intentId],
  ).catch(() => undefined);
  if (!it) return 'Заказ не найден';
  if (it.status !== 'pending') return 'Заказ уже обработан';
  if (it.amount !== amount || it.currency !== currency) return 'Сумма изменилась, попробуй ещё раз';
  if (Number(it.telegram_id) !== Number(telegramId)) return 'Заказ принадлежит другому пользователю';
  return null;
}

export interface PaymentSucceeded {
  provider: 'telegram_stars' | 'mock';
  eventKey: string;
  intentId: string;
  chargeId: string;
  amount: number;
  currency: string;
  isRecurring?: boolean;
  isFirstRecurring?: boolean;
  subscriptionExpiration?: Date | null;
  telegramId?: number | null;
  raw?: Record<string, unknown>;
}

/**
 * Единственное место, где открывается доступ. Идемпотентно: повторный вебхук с тем же event_key ничего не продлевает.
 */
export async function processPaymentSucceeded(e: PaymentSucceeded) {
  return tx(async (c) => {
    const intent = await one<any>(c, 'SELECT * FROM payment_intents WHERE id=$1 FOR UPDATE', [e.intentId]);
    if (!intent) throw new AppError(404, 'intent_not_found', 'Платёж без заказа');
    if (e.telegramId != null) {
      const u = await one<{ telegram_id: number }>(c, 'SELECT telegram_id FROM users WHERE id=$1', [intent.user_id]);
      if (Number(u!.telegram_id) !== Number(e.telegramId)) throw new AppError(400, 'user_mismatch', 'Платёж от другого пользователя');
    }
    const plan = (await one<PlanRow>(c, 'SELECT * FROM subscription_plans WHERE id=$1', [intent.plan_id]))!;
    const ins = await one<{ id: number }>(
      c,
      `INSERT INTO payment_events(provider,event_key,type,user_id,intent_id,plan_id,amount,currency,charge_id,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (event_key) DO NOTHING RETURNING id`,
      [e.provider, e.eventKey, e.isRecurring && !e.isFirstRecurring ? 'renewal' : 'payment_succeeded', intent.user_id, intent.id, plan.id, e.amount, e.currency, e.chargeId, e.raw ?? {}],
    );
    if (!ins) return { duplicate: true };
    if (e.currency !== intent.currency) throw new AppError(400, 'currency_mismatch', 'Валюта не совпадает');
    const sub = await lockSub(c, intent.user_id, e.provider);
    const now = clock.now();
    const renewal = !!(e.isRecurring && !e.isFirstRecurring);
    // Первичная оплата рекуррентной подписки: план из интента; продления — по текущему плану подписки
    const effPlan = renewal && sub.plan_id ? (await one<PlanRow>(c, 'SELECT * FROM subscription_plans WHERE id=$1', [sub.plan_id]))! : plan;
    const base = hasAccess(sub, now) && sub.current_period_end! > now ? sub.current_period_end! : now;
    const until = e.subscriptionExpiration ?? new Date(base.getTime() + effPlan.period_days * 86400_000);
    await c.query(
      `UPDATE subscriptions SET plan_id=$2, provider=$3, status='active', current_period_start=$4, current_period_end=$5,
         provider_ref=CASE WHEN $6::boolean THEN $7 ELSE provider_ref END, auto_renew=$8, cancel_requested_at=NULL,
         ever_paid=true, updated_at=now() WHERE id=$1`,
      [sub.id, renewal ? sub.plan_id : plan.id === 'retention_month' ? 'month' : plan.id, e.provider, base, until,
        plan.kind === 'recurring' && !renewal, e.chargeId, renewal || plan.kind === 'recurring'],
    );
    await c.query('UPDATE payment_events SET access_until=$2 WHERE id=$1', [ins.id, until]);
    await c.query(`UPDATE payment_intents SET status='paid', paid_at=now() WHERE id=$1 AND status='pending'`, [intent.id]);
    await c.query('UPDATE users SET activated_at=COALESCE(activated_at, $2) WHERE id=$1', [intent.user_id, now]);
    await c.query(`UPDATE onboarding_progress SET completed_at=COALESCE(completed_at, now()), step=CASE WHEN step='done' THEN 'done' ELSE 'first_task' END WHERE user_id=$1`, [intent.user_id]);
    await track(c, intent.user_id, 'purchase_success', { plan: effPlan.id, amount: e.amount, currency: e.currency, renewal }, `purchase:${e.eventKey}`);
    return { duplicate: false, userId: intent.user_id, until };
  });
}

async function lockSub(c: PoolClient, userId: number, provider: string): Promise<SubRow> {
  await c.query(`INSERT INTO subscriptions(user_id, provider, status) VALUES ($1,$2,'none') ON CONFLICT (user_id) DO NOTHING`, [userId, provider]);
  return (await one<SubRow>(c, 'SELECT * FROM subscriptions WHERE user_id=$1 FOR UPDATE', [userId]))!;
}

/** Возврат: доступ, оплаченный этим платежом, закрывается. Повторное событие — no-op. */
export async function processRefund(p: { provider: string; chargeId: string; eventKey: string; raw?: Record<string, unknown> }) {
  return tx(async (c) => {
    const paid = await one<any>(c, `SELECT * FROM payment_events WHERE charge_id=$1 AND type IN ('payment_succeeded','renewal') ORDER BY id DESC LIMIT 1`, [p.chargeId]);
    if (!paid) throw notFound('Платёж не найден');
    const ins = await one(
      c,
      `INSERT INTO payment_events(provider,event_key,type,user_id,intent_id,plan_id,amount,currency,charge_id,payload)
       VALUES ($1,$2,'refund',$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (event_key) DO NOTHING RETURNING id`,
      [p.provider, p.eventKey, paid.user_id, paid.intent_id, paid.plan_id, -paid.amount, paid.currency, p.chargeId, p.raw ?? {}],
    );
    if (!ins) return { duplicate: true };
    const sub = await lockSub(c, paid.user_id, p.provider);
    const latest = await one<any>(c, `SELECT id FROM payment_events WHERE user_id=$1 AND type IN ('payment_succeeded','renewal') ORDER BY id DESC LIMIT 1`, [paid.user_id]);
    if (latest?.id === paid.id) {
      await c.query(`UPDATE subscriptions SET status='refunded', current_period_end=LEAST(current_period_end, now()), auto_renew=false, updated_at=now() WHERE id=$1`, [sub.id]);
    } else if (paid.access_until && sub.current_period_end) {
      // Возврат более раннего платежа: сокращаем доступ на оплаченный им период
      const plan = await one<PlanRow>(c, 'SELECT * FROM subscription_plans WHERE id=$1', [paid.plan_id]);
      const cut = (plan?.period_days ?? 30) * 86400_000;
      await c.query(`UPDATE subscriptions SET current_period_end=GREATEST(now(), current_period_end - make_interval(secs => $2::double precision / 1000)), updated_at=now() WHERE id=$1`, [sub.id, cut]);
    }
    return { duplicate: false, userId: paid.user_id };
  });
}

export async function cancelSubscription(userId: number) {
  const user = (await one<{ telegram_id: number }>(pool, 'SELECT telegram_id FROM users WHERE id=$1', [userId]))!;
  const { sub } = await getEntitlement(pool, userId);
  if (!sub || !sub.auto_renew || !['active', 'payment_failed'].includes(sub.status)) {
    if (sub?.status === 'cancel_at_period_end') return { status: sub.status, accessUntil: sub.current_period_end };
    throw conflict('Нет активного автопродления', 'not_cancellable');
  }
  await getProvider().cancelAutoRenew({ telegramId: user.telegram_id, providerRef: sub.provider_ref });
  const r = await tx(async (c) => {
    const s = await lockSub(c, userId, sub.provider);
    await c.query(
      `UPDATE subscriptions SET status=CASE WHEN status='active' THEN 'cancel_at_period_end' ELSE status END, auto_renew=false,
         cancel_requested_at=now(), next_charge_plan_id=NULL, updated_at=now() WHERE id=$1`,
      [s.id],
    );
    await c.query(
      `INSERT INTO payment_events(provider,event_key,type,user_id,plan_id) VALUES ($1,$2,'canceled',$3,$4) ON CONFLICT DO NOTHING`,
      [s.provider, `cancel:${s.id}:${clock.now().getTime()}`, userId, s.plan_id],
    );
    await track(c, userId, 'subscription_canceled', { plan: s.plan_id ?? '' });
    return { status: 'cancel_at_period_end' as const, accessUntil: s.current_period_end };
  });
  return r;
}

export async function acceptRetentionOffer(userId: number) {
  const info = await cancelInfo(userId);
  if (!info.cancellable || !info.retentionOffer) throw conflict('Предложение недоступно', 'offer_unavailable');
  return tx(async (c) => {
    const s = await lockSub(c, userId, getProvider().id);
    if (s.retention_offer_used_at) throw conflict('Предложение уже использовано', 'offer_used');
    await c.query(`UPDATE subscriptions SET next_charge_plan_id=$2, retention_offer_used_at=now(), updated_at=now() WHERE id=$1`, [s.id, info.retentionOffer!.plan.id]);
    await c.query(
      `INSERT INTO payment_events(provider,event_key,type,user_id,plan_id) VALUES ($1,$2,'retention_offer',$3,$4)`,
      [s.provider, `retention:${s.id}`, userId, info.retentionOffer!.plan.id],
    );
    await track(c, userId, 'retention_offer_accepted', {}, `retention:${s.id}`);
    return { nextChargeAt: s.current_period_end, nextChargePlan: info.retentionOffer!.plan, thenPlan: info.retentionOffer!.thenPlan };
  });
}

/** Песочница: подтверждение «оплаты» проходит через тот же обработчик, что и реальный вебхук. */
export async function mockConfirm(userId: number, intentId: string) {
  if (getProvider().id !== 'mock') throw new AppError(403, 'sandbox_only', 'Только в песочнице');
  const it = await one<any>(pool, 'SELECT * FROM payment_intents WHERE id=$1 AND user_id=$2', [intentId, userId]);
  if (!it) throw notFound('Заказ не найден');
  return processPaymentSucceeded({
    provider: 'mock', eventKey: `mock:pay:${intentId}`, intentId, chargeId: `mock_${intentId}`, amount: it.amount, currency: it.currency,
    isRecurring: false,
  });
}

/** Фоновая работа: истечение доступа и (в песочнице) имитация автопродления. */
export async function processSubscriptions() {
  const now = clock.now();
  const provider = getProvider();
  if (provider.id === 'mock') {
    const due = await q<SubRow>(pool, `SELECT * FROM subscriptions WHERE auto_renew AND status='active' AND current_period_end <= $1`, [now]);
    for (const s of due) {
      const planId = s.next_charge_plan_id ?? s.plan_id!;
      const plan = (await one<PlanRow>(pool, 'SELECT * FROM subscription_plans WHERE id=$1', [planId]))!;
      const intentId = randomUUID();
      await pool.query(`INSERT INTO payment_intents(id,user_id,plan_id,provider,amount,currency) VALUES ($1,$2,$3,'mock',$4,'XTR')`, [intentId, s.user_id, plan.id, plan.price_stars]);
      await processPaymentSucceeded({
        provider: 'mock', eventKey: `mock:renew:${s.id}:${s.current_period_end!.getTime()}`, intentId, chargeId: `mock_${intentId}`,
        amount: plan.price_stars, currency: 'XTR', isRecurring: true, isFirstRecurring: false,
        subscriptionExpiration: new Date(s.current_period_end!.getTime() + 30 * 86400_000),
      });
      await pool.query('UPDATE subscriptions SET next_charge_plan_id=NULL WHERE id=$1', [s.id]);
    }
  }
  await pool.query(
    `UPDATE subscriptions SET status='payment_failed', updated_at=now()
     WHERE status='active' AND auto_renew AND current_period_end + interval '15 minutes' < $1`, [now],
  );
  await pool.query(
    `UPDATE subscriptions SET status='expired', auto_renew=false, updated_at=now()
     WHERE (status IN ('active','cancel_at_period_end') AND current_period_end < $1 AND NOT auto_renew)
        OR (status='payment_failed' AND current_period_end + interval '3 days' < $1)`, [now],
  );
}

export function assertPlanId(id: unknown): string {
  if (typeof id !== 'string' || !/^[a-z0-9_]{1,40}$/.test(id)) throw badRequest('Неизвестный тариф');
  return id;
}
