/**
 * Статистика для владельца: открывается в Mini App (startapp=admin), доступ — по подписи Telegram
 * и списку ADMIN_IDS. Суммы — до комиссии CloudPayments и чеков; тестовые платежи считаются отдельно.
 */
import { Router, type Request, type Response } from 'express';
import type { TgUser } from './auth';
import { config } from './config';
import { pool } from './db';

export const isAdmin = (u: Pick<TgUser, 'id' | 'username'>) =>
  config.adminIds.has(String(u.id)) || Boolean(u.username && config.adminIds.has(u.username.toLowerCase()));

export const adminApi = Router();

const one = async (sql: string) => (await pool.query(sql)).rows[0];
const all = async (sql: string) => (await pool.query(sql)).rows;

adminApi.get('/stats', async (req: Request, res: Response) => {
  if (!isAdmin(req.user)) {
    res.status(403).json({ code: 'forbidden' });
    return;
  }
  const period = (col: string) => `
    COUNT(*) FILTER (WHERE ${col} >= date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow') AS today,
    COUNT(*) FILTER (WHERE ${col} >= now() - interval '7 days') AS d7,
    COUNT(*) FILTER (WHERE ${col} >= now() - interval '30 days') AS d30,
    COUNT(*) AS total`;
  const money = `
    COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow'), 0) AS today,
    COALESCE(SUM(amount) FILTER (WHERE created_at >= now() - interval '7 days'), 0) AS d7,
    COALESCE(SUM(amount) FILTER (WHERE created_at >= now() - interval '30 days'), 0) AS d30,
    COALESCE(SUM(amount), 0) AS total`;

  const [users, questionnaires, responses, revenue, paymentsCount, byKind, testPayments, active, cancelled, days, upsell, stories, offers] =
    await Promise.all([
      one(`SELECT ${period('created_at')} FROM users`),
      one(`SELECT ${period('created_at')} FROM questionnaires`),
      one(`SELECT ${period('created_at')} FROM responses`),
      one(`SELECT ${money} FROM payments WHERE NOT test_mode`),
      one(`SELECT ${period('created_at')} FROM payments WHERE NOT test_mode`),
      all(`SELECT plan, COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS sum FROM payments WHERE NOT test_mode GROUP BY plan ORDER BY sum DESC`),
      one(`SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS sum FROM payments WHERE test_mode`),
      all(`SELECT plan, COUNT(*)::int AS count, COUNT(*) FILTER (WHERE auto_renew)::int AS renewing FROM entitlements
           WHERE source = 'provider' AND (renews_at IS NULL OR renews_at > now()) GROUP BY plan`),
      one(`SELECT COUNT(*)::int AS count FROM users WHERE cancelled_at IS NOT NULL`),
      // По дням (МСК) с первого пользователя, но не больше 180 дней: для графика и таблицы
      all(`WITH bounds AS (
             SELECT date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') AS today,
                    GREATEST(
                      date_trunc('day', COALESCE(MIN(created_at), now()) AT TIME ZONE 'Europe/Moscow'),
                      date_trunc('day', now() AT TIME ZONE 'Europe/Moscow') - interval '179 days'
                    ) AS first
             FROM users
           )
           SELECT to_char(d AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS date,
             to_char(d AT TIME ZONE 'Europe/Moscow', 'DD.MM') AS day,
             (SELECT COUNT(*) FROM users WHERE created_at >= d AND created_at < d + interval '1 day')::int AS users,
             (SELECT COUNT(*) FROM questionnaires WHERE created_at >= d AND created_at < d + interval '1 day')::int AS questionnaires,
             (SELECT COUNT(*) FROM responses WHERE created_at >= d AND created_at < d + interval '1 day')::int AS responses,
             (SELECT COUNT(*) FROM payments WHERE NOT test_mode AND created_at >= d AND created_at < d + interval '1 day')::int AS payments,
             (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE NOT test_mode AND created_at >= d AND created_at < d + interval '1 day') AS revenue
           FROM bounds, generate_series(bounds.first AT TIME ZONE 'Europe/Moscow', bounds.today AT TIME ZONE 'Europe/Moscow', interval '1 day') AS d
           ORDER BY d DESC`),
      all(`SELECT * FROM upsell_conversion`).catch(() => []),
      all(`SELECT name, source, COUNT(*)::int AS count FROM events WHERE name IN ('story_sheet_opened', 'story_shared')
           GROUP BY name, source ORDER BY name, count DESC`),
      one(`SELECT COUNT(*) FILTER (WHERE offer_started_at IS NOT NULL)::int AS paywall_opened,
             (SELECT COUNT(DISTINCT user_id) FROM payments WHERE NOT test_mode AND plan <> 'reveal')::int AS paying_users
           FROM users`),
    ]);
  res.json({ users, questionnaires, responses, revenue, paymentsCount, byKind, testPayments, active, cancelled, days, upsell, stories, offers });
});
