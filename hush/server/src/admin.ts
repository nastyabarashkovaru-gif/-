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

  // HUSH 2.0: вопросы-ответы без самостоятельных и системных (они не активность подписчиков)
  const [links, questions, inboxAnswers, asks, askAnswers, funnel, referrers, sources, guestConversion] = await Promise.all([
    one(`SELECT ${period('link_created_at')} FROM users WHERE ask_slug IS NOT NULL`),
    one(`SELECT ${period('created_at')} FROM inbox WHERE kind = 'user'`),
    one(`SELECT ${period('answered_at')} FROM inbox WHERE answered_at IS NOT NULL AND kind <> 'self'`),
    one(`SELECT ${period('created_at')} FROM asks`),
    one(`SELECT ${period('created_at')} FROM ask_answers WHERE kind = 'user'`),
    all(`SELECT name, NULL AS source, COUNT(*)::int AS count, COUNT(DISTINCT user_id)::int AS users FROM events
         WHERE name IN ('app_open','start_choice','link_created','share_clicked','link_copied','link_opened','question_typing_started',
                        'question_sent','ask_created','ask_answer_sent','inbox_answered','guest_create_link','paywall_opened','story_shared')
           AND created_at >= now() - interval '30 days'
         GROUP BY name ORDER BY name`),
    all(`SELECT r.id, r.username, r.first_name, COUNT(u.id)::int AS invited,
           COUNT(u.id) FILTER (WHERE u.ask_slug IS NOT NULL)::int AS made_link
         FROM users u JOIN users r ON r.id = u.referred_by
         GROUP BY r.id, r.username, r.first_name ORDER BY invited DESC LIMIT 20`),
    all(`SELECT CASE WHEN ref_source IS NULL THEN 'Напрямую'
                     WHEN ref_source LIKE 'u\\_%' THEN 'Личная ссылка'
                     WHEN ref_source LIKE 'a\\_%' THEN 'Свой вопрос'
                     WHEN ref_source LIKE 'ref\\_%' THEN ref_source
                     ELSE 'Анкета (старая)' END AS source,
           COUNT(*)::int AS users
         FROM users WHERE id > 0 GROUP BY 1 ORDER BY users DESC LIMIT 20`),
    one(`SELECT COUNT(*) FILTER (WHERE referred_by IS NOT NULL)::int AS guests,
           COUNT(*) FILTER (WHERE referred_by IS NOT NULL AND ask_slug IS NOT NULL)::int AS guests_with_link
         FROM users`),
  ]);

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
             (SELECT COUNT(*) FROM inbox WHERE kind = 'user' AND created_at >= d AND created_at < d + interval '1 day')::int AS questions,
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
  res.json({ qa: { links, questions, inboxAnswers, asks, askAnswers, funnel, referrers, sources, guestConversion }, users, questionnaires, responses, revenue, paymentsCount, byKind, testPayments, active, cancelled, days, upsell, stories, offers });
});
