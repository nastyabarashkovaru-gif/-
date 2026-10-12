import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { validateLevelCurve, SPHERES } from '@rostok/shared';
import { config } from '../config.js';
import { one, pool, q } from '../db.js';
import { AppError, badRequest, notFound } from '../errors.js';
import { hashToken } from '../auth.js';
import { invalidateConfig } from '../appConfig.js';
import { getProvider } from '../payments/index.js';
import { processRefund } from '../services/subscription.js';

export type Role = 'owner' | 'analyst' | 'support';
export interface Admin { id: number; login: string; role: Role }

/** RBAC: какие роли могут выполнять действие. */
export const PERMS = {
  metrics: ['owner', 'analyst'],
  export: ['owner', 'analyst'],
  config_read: ['owner', 'analyst'],
  config_write: ['owner'],
  support: ['owner', 'support'],
  payments: ['owner', 'support'],
  refund: ['owner'],
  errors: ['owner', 'support'],
  audit: ['owner'],
} as const satisfies Record<string, readonly Role[]>;
export type Perm = keyof typeof PERMS;

export function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(pw, salt, 32).toString('hex')}`;
}
function checkPassword(pw: string, stored: string) {
  const [, salt, hash] = stored.split('$');
  const calc = scryptSync(pw, Buffer.from(salt, 'hex'), 32);
  return timingSafeEqual(calc, Buffer.from(hash, 'hex'));
}

/** Владелец создаётся из ADMIN_LOGIN/ADMIN_PASSWORD при первом запуске (пароль потом можно сменить только в БД). */
export async function bootstrapAdmin() {
  if (!config.adminLogin || !config.adminPassword) return;
  if (config.adminPassword.length < 10) {
    console.warn('[admin] ADMIN_PASSWORD короче 10 символов — владелец не создан');
    return;
  }
  await pool.query(
    `INSERT INTO admin_users(login, password_hash, role) VALUES ($1,$2,'owner') ON CONFLICT (login) DO NOTHING`,
    [config.adminLogin, hashPassword(config.adminPassword)],
  );
}

const attempts = new Map<string, { n: number; at: number }>();
export async function adminLogin(login: string, password: string, ip: string) {
  const k = `${ip}:${login}`;
  const a = attempts.get(k);
  if (a && a.n >= 5 && Date.now() - a.at < 15 * 60_000) throw new AppError(429, 'rate_limited', 'Слишком много попыток, подожди 15 минут');
  const u = await one<any>(pool, 'SELECT * FROM admin_users WHERE login=$1 AND disabled_at IS NULL', [login]);
  if (!u || !checkPassword(password, u.password_hash)) {
    attempts.set(k, { n: (a?.n ?? 0) + 1, at: Date.now() });
    await audit(null, 'login_failed', login);
    throw new AppError(401, 'bad_credentials', 'Неверный логин или пароль');
  }
  attempts.delete(k);
  const token = randomBytes(32).toString('base64url');
  await pool.query(`INSERT INTO admin_sessions(token_hash, admin_id, expires_at) VALUES ($1,$2, now() + interval '12 hours')`, [hashToken(token), u.id]);
  await audit(u.id, 'login', login);
  return { token, role: u.role as Role, login: u.login };
}

export async function adminFromToken(token?: string): Promise<Admin | null> {
  if (!token) return null;
  return (await one<Admin>(
    pool,
    `SELECT a.id, a.login, a.role FROM admin_sessions s JOIN admin_users a ON a.id=s.admin_id WHERE s.token_hash=$1 AND s.expires_at > now() AND a.disabled_at IS NULL`,
    [hashToken(token)],
  )) ?? null;
}

export async function audit(adminId: number | null, action: string, target: string | null, details: Record<string, unknown> = {}) {
  await pool.query('INSERT INTO admin_audit_log(admin_id, action, target, details) VALUES ($1,$2,$3,$4)', [adminId, action, target, details]);
}

// ------------------------------------------------------------ метрики
const range = (days: number) => `now() - interval '${Math.max(1, Math.min(365, Math.floor(days)))} days'`;
const REAL = `(SELECT id FROM users WHERE NOT is_demo)`;

export async function summary(days: number) {
  const since = range(days);
  const ev = async (name: string) =>
    (await one<{ n: number }>(pool, `SELECT count(DISTINCT user_id)::int AS n FROM analytics_events WHERE name=$1 AND created_at > ${since}`, [name]))!.n;
  const subs = await one<any>(
    pool,
    `SELECT count(*) FILTER (WHERE status IN ('active','cancel_at_period_end') AND current_period_end > now())::int AS active,
            count(*) FILTER (WHERE status='cancel_at_period_end')::int AS canceling,
            count(*) FILTER (WHERE status='expired' AND updated_at > ${since})::int AS churned,
            count(*) FILTER (WHERE status='refunded')::int AS refunded
     FROM subscriptions`,
  );
  const revenue = await q<any>(
    pool,
    `SELECT currency, sum(amount)::int AS amount, count(*) FILTER (WHERE amount>0)::int AS payments, count(*) FILTER (WHERE type='refund')::int AS refunds
     FROM payment_events WHERE amount IS NOT NULL AND created_at > ${since} AND provider <> 'mock' GROUP BY currency`,
  );
  const sandbox = await one<any>(pool, `SELECT count(*)::int AS n FROM payment_events WHERE provider='mock' AND created_at > ${since}`);
  const daily = await q<any>(
    pool,
    `SELECT to_char(date_trunc('day', created_at),'YYYY-MM-DD') AS day,
       count(DISTINCT user_id) FILTER (WHERE name='app_open')::int AS opens,
       count(DISTINCT user_id) FILTER (WHERE name='purchase_success')::int AS purchases,
       count(*) FILTER (WHERE name='task_completed')::int AS completions
     FROM analytics_events WHERE created_at > ${since} GROUP BY 1 ORDER BY 1`,
  );
  return {
    days,
    opened: await ev('app_open'),
    onboardingStarted: await ev('onboarding_slide_view'),
    onboardingCompleted: await ev('tutorial_complete'),
    paywall: await ev('paywall_view'),
    checkoutStarted: await ev('checkout_start'),
    paid: await ev('purchase_success'),
    activeSubscribers: subs.active,
    canceling: subs.canceling,
    churned: subs.churned,
    refunded: subs.refunded,
    revenue,
    sandboxPayments: sandbox.n,
    daily,
  };
}

export async function funnel(days: number) {
  const since = range(days);
  const steps: [string, string][] = [
    ['Запуск', `SELECT DISTINCT user_id FROM analytics_events WHERE name='app_open' AND created_at > ${since}`],
    ['Продающие слайды', `SELECT DISTINCT user_id FROM analytics_events WHERE name='onboarding_slide_view' AND created_at > ${since}`],
    ['Обучение', `SELECT DISTINCT user_id FROM analytics_events WHERE name='tutorial_start' AND created_at > ${since}`],
    ['Тестовый полив', `SELECT DISTINCT user_id FROM analytics_events WHERE name='tutorial_watering' AND created_at > ${since}`],
    ['Выбор сфер', `SELECT DISTINCT user_id FROM analytics_events WHERE name='spheres_selected' AND created_at > ${since}`],
    ['Paywall', `SELECT DISTINCT user_id FROM analytics_events WHERE name='paywall_view' AND created_at > ${since}`],
    ['Начало оплаты', `SELECT DISTINCT user_id FROM analytics_events WHERE name='checkout_start' AND created_at > ${since}`],
    ['Оплата', `SELECT DISTINCT user_id FROM analytics_events WHERE name='purchase_success' AND created_at > ${since}`],
    ['Первая задача', `SELECT DISTINCT user_id FROM analytics_events WHERE name='task_created' AND created_at > ${since}`],
    ['Первое выполнение', `SELECT DISTINCT user_id FROM analytics_events WHERE name='task_completed' AND created_at > ${since}`],
    ['Первый полив', `SELECT DISTINCT user_id FROM analytics_events WHERE name='watering_success' AND created_at > ${since}`],
    ['Активен 7 дней', `SELECT user_id FROM garden_open_days GROUP BY user_id HAVING count(*) >= 7`],
    ['Активен 30 дней', `SELECT user_id FROM garden_open_days GROUP BY user_id HAVING count(*) >= 30`],
  ];
  const out = [];
  let prev: Set<number> | null = null;
  for (const [label, sql] of steps) {
    const ids = new Set((await q<{ user_id: number }>(pool, `SELECT user_id FROM (${sql}) x WHERE user_id IN ${REAL}`)).map((r) => r.user_id));
    const kept: Set<number> = prev ? new Set([...ids].filter((i) => prev!.has(i))) : ids;
    out.push({ step: label, users: kept.size });
    prev = kept;
  }
  return out;
}

export async function retention() {
  const rows = await q<any>(
    pool,
    `WITH first AS (SELECT user_id, min(local_date) AS d0 FROM garden_open_days WHERE user_id IN ${REAL} GROUP BY user_id)
     SELECT to_char(date_trunc('week', f.d0),'YYYY-MM-DD') AS cohort, count(DISTINCT f.user_id)::int AS size,
       ${[1, 3, 7, 14, 30].map((n) => `count(DISTINCT o.user_id) FILTER (WHERE o.local_date = f.d0 + ${n})::int AS d${n}`).join(',')}
     FROM first f LEFT JOIN garden_open_days o ON o.user_id=f.user_id GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
  );
  return rows;
}

export async function productStats() {
  const one_ = async (sql: string) => (await one<any>(pool, sql))!;
  const occ = await one_(`SELECT count(*) FILTER (WHERE status='done')::int AS done, count(*) FILTER (WHERE status IN ('missed','partial','expired'))::int AS missed FROM task_occurrences`);
  const drops = await one_(
    `SELECT COALESCE(sum(amount),0)::int AS earned, count(DISTINCT (user_id, created_at::date))::int AS user_days
     FROM drop_ledger WHERE type IN ('task_reward','habit_reward') AND user_id IN ${REAL}`,
  );
  const firstWater = await one_(
    `SELECT avg(EXTRACT(EPOCH FROM (w.first - u.activated_at)) / 3600)::float AS hours
     FROM users u JOIN (SELECT user_id, min(created_at) AS first FROM waterings GROUP BY user_id) w ON w.user_id=u.id WHERE u.activated_at IS NOT NULL AND NOT u.is_demo`,
  );
  const levels = await q<any>(pool, `SELECT level, count(*)::int AS n FROM trees WHERE user_id IN ${REAL} GROUP BY level ORDER BY level LIMIT 60`);
  const spheres = await q<any>(pool, `SELECT sphere_id AS sphere, count(*)::int AS tasks FROM tasks WHERE deleted_at IS NULL AND user_id IN ${REAL} GROUP BY 1 ORDER BY 2 DESC`);
  const shares = await one_(
    `SELECT count(*)::int AS tasks, count(*) FILTER (WHERE hardcore)::int AS hardcore, count(*) FILTER (WHERE terms_locked_at IS NOT NULL)::int AS with_rewards,
       count(*) FILTER (WHERE kind='habit')::int AS habits
     FROM tasks WHERE deleted_at IS NULL AND user_id IN ${REAL}`,
  );
  const ch = await one_(`SELECT count(DISTINCT user_id)::int AS n FROM challenge_participants`);
  const users = await one_(`SELECT count(*)::int AS n FROM users WHERE activated_at IS NOT NULL AND NOT is_demo`);
  return {
    completionRate: occ.done + occ.missed ? occ.done / (occ.done + occ.missed) : null,
    avgDropsPerDay: drops.user_days ? drops.earned / drops.user_days : null,
    avgHoursToFirstWatering: firstWater.hours,
    levelDistribution: levels,
    popularSpheres: spheres.map((s: any) => ({ ...s, name: SPHERES.find((x) => x.id === s.sphere)?.name })),
    hardcoreShare: shares.tasks ? shares.hardcore / shares.tasks : null,
    rewardsShare: shares.tasks ? shares.with_rewards / shares.tasks : null,
    habitsShare: shares.tasks ? shares.habits / shares.tasks : null,
    challengeUsersShare: users.n ? ch.n / users.n : null,
  };
}

// ------------------------------------------------------------ конфиги
const EDITABLE = ['brand', 'onboarding', 'paywall', 'notification_texts', 'flags', 'asset_manifest', 'level_curve'] as const;

export async function getConfig() {
  const rows = await q<any>(pool, 'SELECT key, value, updated_at FROM app_config ORDER BY key');
  const levels = await q<any>(pool, 'SELECT from_level, cost FROM tree_level_config ORDER BY from_level');
  const plans = await q<any>(pool, 'SELECT * FROM subscription_plans ORDER BY sort');
  return {
    values: Object.fromEntries(rows.map((r) => [r.key, r.value])),
    levelCurve: { table: levels.map((l) => l.cost), tail: rows.find((r) => r.key === 'level_curve_tail')?.value },
    plans,
    provider: getProvider().id,
  };
}

export async function setConfig(admin: Admin, key: string, value: unknown) {
  if (!(EDITABLE as readonly string[]).includes(key)) throw badRequest('Этот ключ нельзя менять');
  if (key === 'level_curve') {
    if (!validateLevelCurve(value)) throw badRequest('Кривая: неубывающие целые 1..500, потолок ≥ последнего значения, rate 0..1');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM tree_level_config');
      for (let i = 0; i < value.table.length; i++) await c.query('INSERT INTO tree_level_config(from_level,cost) VALUES ($1,$2)', [i + 1, value.table[i]]);
      await c.query(`INSERT INTO app_config(key,value,updated_by) VALUES ('level_curve_tail',$1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`, [JSON.stringify(value.tail), admin.id]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  } else {
    if (typeof value !== 'object' || value === null) throw badRequest('Ожидается объект');
    if (JSON.stringify(value).length > 100_000) throw badRequest('Слишком большой конфиг');
    await pool.query(`INSERT INTO app_config(key,value,updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`, [key, JSON.stringify(value), admin.id]);
  }
  invalidateConfig();
  await audit(admin.id, 'config_update', key, { value });
  return { ok: true };
}

/** Тарифы: в админке меняются только тексты и активность. Суммы — через настройку провайдера и миграцию. */
export async function updatePlan(admin: Admin, id: string, p: { title?: string; subtitle?: string; terms?: string; isActive?: boolean }) {
  const plan = await one<any>(pool, 'SELECT * FROM subscription_plans WHERE id=$1', [id]);
  if (!plan) throw notFound('Тариф не найден');
  await pool.query(
    `UPDATE subscription_plans SET title=COALESCE($2,title), subtitle=COALESCE($3,subtitle), terms=COALESCE($4,terms), is_active=COALESCE($5,is_active) WHERE id=$1`,
    [id, p.title ?? null, p.subtitle ?? null, p.terms ?? null, p.isActive ?? null],
  );
  await audit(admin.id, 'plan_update', id, p);
  return { ok: true };
}

// ------------------------------------------------------------ поддержка
export async function lookupUser(admin: Admin, telegramId: string) {
  if (!/^-?\d{1,20}$/.test(telegramId)) throw badRequest('Telegram ID — число');
  const u = await one<any>(pool, 'SELECT id, telegram_id, first_name, username, timezone, created_at, activated_at, is_demo, bot_started, bot_blocked FROM users WHERE telegram_id=$1', [telegramId]);
  await audit(admin.id, 'support_lookup', telegramId);
  if (!u) throw notFound('Пользователь не найден');
  const sub = await one<any>(pool, 'SELECT plan_id, status, current_period_end, auto_renew, cancel_requested_at, retention_offer_used_at FROM subscriptions WHERE user_id=$1', [u.id]);
  const payments = await q<any>(pool, 'SELECT type, plan_id, amount, currency, charge_id, access_until, created_at FROM payment_events WHERE user_id=$1 ORDER BY id DESC LIMIT 30', [u.id]);
  const trees = await q<any>(pool, 'SELECT sphere_id, level, available_drops, total_earned_drops, total_spent_drops, total_penalty_drops, health_visual_state FROM trees WHERE user_id=$1 ORDER BY sphere_id', [u.id]);
  const tasks = await q<any>(pool, 'SELECT id, sphere_id, kind, status, hardcore, completions_count, terms_locked_at IS NOT NULL AS locked, created_at FROM tasks WHERE user_id=$1 AND deleted_at IS NULL ORDER BY id', [u.id]);
  // Названия задач и ответы о привычках не показываем — минимально необходимые данные
  return { user: u, subscription: sub ?? null, payments, trees, tasks };
}

export async function payments(limit = 100) {
  return q<any>(pool, `SELECT p.id, p.provider, p.type, p.plan_id, p.amount, p.currency, p.charge_id, p.access_until, p.created_at, u.telegram_id
    FROM payment_events p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.id DESC LIMIT $1`, [Math.min(500, limit)]);
}

export async function refund(admin: Admin, chargeId: string) {
  const p = await one<any>(pool, `SELECT p.*, u.telegram_id FROM payment_events p JOIN users u ON u.id=p.user_id WHERE charge_id=$1 AND type IN ('payment_succeeded','renewal')`, [chargeId]);
  if (!p) throw notFound('Платёж не найден');
  const provider = getProvider();
  if (p.provider !== provider.id) throw badRequest('Платёж другого провайдера');
  await provider.refund({ telegramId: p.telegram_id, chargeId });
  await audit(admin.id, 'refund', chargeId);
  // Для Stars подтверждение придёт также апдейтом refunded_payment — повтор будет проигнорирован
  return processRefund({ provider: provider.id, chargeId, eventKey: `admin-refund:${chargeId}` });
}

export async function errors() {
  const errs = await q<any>(pool, 'SELECT * FROM error_log ORDER BY id DESC LIMIT 200');
  const jobs = await q<any>(pool, 'SELECT * FROM job_state ORDER BY name');
  return { errors: errs, jobs };
}
export async function auditLog() {
  return q<any>(pool, 'SELECT l.*, a.login FROM admin_audit_log l LEFT JOIN admin_users a ON a.id=l.admin_id ORDER BY l.id DESC LIMIT 300');
}

// ------------------------------------------------------------ CSV
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // защита от CSV-инъекций
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export async function exportCsv(admin: Admin, kind: string) {
  const sql: Record<string, string> = {
    // Без названий задач и содержимого привычек
    events: `SELECT e.id, e.user_id, e.name, e.props, e.source, e.created_at FROM analytics_events e WHERE e.name <> 'habit_checkin' ORDER BY e.created_at DESC LIMIT 50000`,
    payments: `SELECT p.id, p.provider, p.type, p.user_id, p.plan_id, p.amount, p.currency, p.access_until, p.created_at FROM payment_events p ORDER BY p.id DESC LIMIT 50000`,
    subscriptions: `SELECT user_id, plan_id, status, current_period_end, auto_renew, cancel_requested_at, created_at FROM subscriptions ORDER BY user_id`,
    users: `SELECT id, created_at, activated_at, timezone, best_open_streak, is_demo FROM users ORDER BY id`,
  };
  if (!sql[kind]) throw badRequest('Неизвестный экспорт');
  const rows = await q<any>(pool, sql[kind]);
  await audit(admin.id, 'export', kind, { rows: rows.length });
  const cols = rows.length ? Object.keys(rows[0]) : [];
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
}
