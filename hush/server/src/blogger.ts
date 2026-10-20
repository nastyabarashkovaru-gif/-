/**
 * Программа для блогеров: отдельная ссылка t.me/<bot>/app?startapp=blogger (или bl_<метка> — для разных волн/менеджеров).
 * Кто открыл приложение по ней, помечается блогером (users.blogger_at). Задание: получить личную ссылку, выложить её в сторис
 * и прислать скриншот сторис прямо в приложении. Владелец смотрит скриншот в админке и выдаёт Premium вручную —
 * без промокодов: доступ привязан к Telegram-аккаунту блогера, передать или «слить» его нельзя.
 */
import express, { Router, type Request, type Response } from 'express';
import type { TgUser } from './auth';
import { isAdmin } from './admin';
import { config } from './config';
import { pool, tx } from './db';
import { handle, HttpError } from './http';
import { rateLimit } from './rateLimit';
import { appLink, notifyUser } from './telegram';

/** Сколько дней Premium получает блогер за сторис */
export const BLOGGER_PREMIUM_DAYS = 30;
/** Скриншот — не больше ~3 МБ (после сжатия на телефоне обычно 200–500 КБ) */
const MAX_IMAGE = 4_000_000;

export const isBloggerParam = (p?: string) => p === 'blogger' || Boolean(p?.startsWith('bl_'));

/** Вызывается при каждом входе со start_param блогерской ссылки: помечаем один раз */
export async function markBlogger(userId: number, startParam: string): Promise<void> {
  await pool.query(
    'UPDATE users SET blogger_at = now(), blogger_campaign = $2 WHERE id = $1 AND blogger_at IS NULL',
    [userId, startParam.slice(0, 40)],
  );
}

export type BloggerStatus = 'none' | 'pending' | 'approved' | 'rejected';

/** Для /api/me: null — не блогер */
export async function bloggerState(userId: number): Promise<{ status: BloggerStatus; premiumDays: number } | null> {
  const { rows } = await pool.query(
    `SELECT u.blogger_at, u.blogger_premium_at,
       (SELECT status FROM blogger_proofs p WHERE p.user_id = u.id ORDER BY created_at DESC LIMIT 1) AS last_status
     FROM users u WHERE u.id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r?.blogger_at) return null;
  const status: BloggerStatus = r.blogger_premium_at ? 'approved' : (r.last_status as BloggerStatus | null) ?? 'none';
  return { status, premiumDays: BLOGGER_PREMIUM_DAYS };
}

/* ───────────── Блогер присылает скриншот сторис ───────────── */

export const bloggerApi = Router();
bloggerApi.use(express.json({ limit: '6mb' }));

bloggerApi.post(
  '/proof',
  rateLimit('blogger-proof', 10, 60 * 60_000),
  handle(async (req) => {
    const state = await bloggerState(req.user.id);
    if (!state) throw new HttpError('forbidden');
    if (state.status === 'approved') return { status: 'approved' as const };
    const image = String(req.body?.image ?? '');
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_IMAGE) throw new HttpError('invalid');
    await pool.query("INSERT INTO blogger_proofs (user_id, image, status) VALUES ($1, $2, 'pending')", [req.user.id, image]);
    // Владельцу — пуш, чтобы проверить сразу
    const who = req.user.username ? `@${req.user.username}` : req.user.first_name;
    void notifyAdmins(`Новый скриншот сторис от блогера ${who} 📸\n\nПроверь и выдай Premium в статистике.`);
    return { status: 'pending' as const };
  }),
);

async function notifyAdmins(text: string) {
  const ids = [...config.adminIds];
  if (!ids.length) return;
  const { rows } = await pool.query('SELECT id FROM users WHERE id::text = ANY($1) OR lower(username) = ANY($1)', [ids]);
  for (const r of rows) await notifyUser(Number(r.id), text, 'Открыть статистику', 'admin');
}

/* ───────────── Админка: список блогеров, скриншот, выдача Premium ───────────── */

export const bloggerAdminApi = Router();
bloggerAdminApi.use(express.json({ limit: '16kb' }));
bloggerAdminApi.use((req: Request, res: Response, next) => {
  if (!isAdmin(req.user as TgUser)) {
    res.status(403).json({ code: 'forbidden' });
    return;
  }
  next();
});

bloggerAdminApi.get(
  '/',
  handle(async () => {
    const [funnel, list] = await Promise.all([
      pool.query(`
        SELECT COUNT(*)::int AS opened,
          COUNT(*) FILTER (WHERE u.ask_slug IS NOT NULL)::int AS made_link,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM events e WHERE e.user_id = u.id AND e.name IN ('story_shared', 'story_sheet_opened')))::int AS story_clicked,
          COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM blogger_proofs p WHERE p.user_id = u.id))::int AS proof_sent,
          COUNT(*) FILTER (WHERE u.blogger_premium_at IS NOT NULL)::int AS premium_given,
          COUNT(*) FILTER (WHERE u.blogger_premium_at IS NULL AND EXISTS (SELECT 1 FROM blogger_proofs p WHERE p.user_id = u.id AND p.status = 'pending'))::int AS waiting
        FROM users u WHERE u.blogger_at IS NOT NULL`),
      pool.query(`
        SELECT u.id, u.first_name, u.username, u.blogger_at, u.blogger_campaign, u.blogger_premium_at, u.ask_slug IS NOT NULL AS has_link,
          EXISTS (SELECT 1 FROM events e WHERE e.user_id = u.id AND e.name IN ('story_shared', 'story_sheet_opened')) AS story_clicked,
          (SELECT COUNT(*) FROM users g WHERE g.referred_by = u.id)::int AS guests,
          (SELECT COUNT(*) FROM inbox i WHERE i.recipient_id = u.id AND i.kind = 'user')::int AS questions,
          (SELECT json_build_object('id', p.id, 'status', p.status, 'createdAt', p.created_at) FROM blogger_proofs p
            WHERE p.user_id = u.id ORDER BY p.created_at DESC LIMIT 1) AS proof
        FROM users u WHERE u.blogger_at IS NOT NULL
        -- Сначала те, кто ждёт проверки
        ORDER BY (u.blogger_premium_at IS NULL AND EXISTS (SELECT 1 FROM blogger_proofs p WHERE p.user_id = u.id AND p.status = 'pending')) DESC,
          u.blogger_at DESC
        LIMIT 300`),
    ]);
    return {
      link: appLink('blogger'),
      premiumDays: BLOGGER_PREMIUM_DAYS,
      funnel: funnel.rows[0],
      bloggers: list.rows.map((r) => ({
        id: String(r.id),
        firstName: r.first_name,
        username: r.username,
        openedAt: r.blogger_at.toISOString(),
        campaign: r.blogger_campaign,
        premiumAt: r.blogger_premium_at?.toISOString() ?? null,
        hasLink: r.has_link,
        storyClicked: r.story_clicked,
        guests: r.guests,
        questions: r.questions,
        proof: r.proof ? { id: String(r.proof.id), status: r.proof.status, createdAt: r.proof.createdAt } : null,
      })),
    };
  }),
);

bloggerAdminApi.get(
  '/proofs/:id',
  handle(async (req) => {
    const { rows } = await pool.query('SELECT image FROM blogger_proofs WHERE id = $1', [Number(req.params.id) || 0]);
    if (!rows[0]) throw new HttpError('not_found');
    return { image: rows[0].image as string };
  }),
);

/** Выдать Premium на BLOGGER_PREMIUM_DAYS дней (если уже есть подписка — продлеваем её срок) */
bloggerAdminApi.post(
  '/:id/approve',
  handle(async (req) => {
    const userId = Number(req.params.id);
    const done = await tx(async (db) => {
      const { rows } = await db.query('SELECT blogger_premium_at FROM users WHERE id = $1 AND blogger_at IS NOT NULL FOR UPDATE', [userId]);
      if (!rows[0]) throw new HttpError('not_found');
      if (rows[0].blogger_premium_at) return false;
      await db.query(
        `INSERT INTO entitlements (user_id, plan, auto_renew, renews_at, source)
         VALUES ($1, 'month', FALSE, now() + make_interval(days => $2), 'blogger')
         ON CONFLICT (user_id) DO UPDATE SET
           renews_at = GREATEST(COALESCE(entitlements.renews_at, now()), now()) + make_interval(days => $2), updated_at = now()`,
        [userId, BLOGGER_PREMIUM_DAYS],
      );
      await db.query('UPDATE users SET blogger_premium_at = now() WHERE id = $1', [userId]);
      await db.query("UPDATE blogger_proofs SET status = 'approved', reviewed_at = now() WHERE user_id = $1 AND status = 'pending'", [userId]);
      return true;
    });
    if (done)
      void notifyUser(userId, `Спасибо за сторис! 💜\n\nТебе выдан hush. Premium на ${BLOGGER_PREMIUM_DAYS} дней: узнавай, кто тебя спросил, и смотри все ответы.`, 'Открыть hush.');
    return { status: done ? 'approved' : 'already' };
  }),
);

bloggerAdminApi.post(
  '/:id/reject',
  handle(async (req) => {
    const userId = Number(req.params.id);
    const r = await pool.query("UPDATE blogger_proofs SET status = 'rejected', reviewed_at = now() WHERE user_id = $1 AND status = 'pending'", [userId]);
    if (r.rowCount)
      void notifyUser(userId, 'Не получилось засчитать скриншот 🙏\n\nВыложи в сторис свою ссылку hush. и пришли скриншот ещё раз — мы сразу проверим.', 'Отправить скриншот');
    return { status: 'rejected' };
  }),
);
