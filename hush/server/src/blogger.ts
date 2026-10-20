/**
 * Программа для блогеров: ссылка t.me/<bot>/app?startapp=blogger или bl_<рассыльщик> (метка — кто из команды привёл блогера).
 * Кто открыл приложение по ней, помечается блогером (users.blogger_at, blogger_campaign). Интерфейс у него обычный;
 * вместо тарифов (например, по «Узнать, кто спросил») — подарок: прикрепить скриншот выложенной сторис, и Premium на 3 месяца
 * включается сразу, без ручной проверки. Доступ привязан к Telegram-аккаунту — промокодов, которые могут утечь, нет.
 * Скриншоты и вся воронка/выручка по блогерам и рассыльщикам — в админке.
 */
import express, { Router, type Request, type Response } from 'express';
import type { TgUser } from './auth';
import { isAdmin } from './admin';
import { pool, tx } from './db';
import { handle, HttpError } from './http';
import { rateLimit } from './rateLimit';
import { appLink, notifyUser } from './telegram';

/** Подарочный Premium блогеру за сторис — 3 месяца */
export const BLOGGER_PREMIUM_DAYS = 90;
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

export type BloggerStatus = 'none' | 'approved';

/** Для /api/me: null — не блогер */
export async function bloggerState(userId: number): Promise<{ status: BloggerStatus; premiumDays: number } | null> {
  const { rows } = await pool.query('SELECT blogger_at, blogger_premium_at FROM users WHERE id = $1', [userId]);
  const r = rows[0];
  if (!r?.blogger_at) return null;
  return { status: r.blogger_premium_at ? 'approved' : 'none', premiumDays: BLOGGER_PREMIUM_DAYS };
}

/** Выдать подарочный Premium (если уже есть подписка — продлеваем её срок). false — уже выдавали */
async function grantPremium(userId: number): Promise<boolean> {
  return tx(async (db) => {
    const { rows } = await db.query('SELECT blogger_premium_at FROM users WHERE id = $1 AND blogger_at IS NOT NULL FOR UPDATE', [userId]);
    if (!rows[0]) throw new HttpError('not_found');
    if (rows[0].blogger_premium_at) return false;
    await db.query(
      `INSERT INTO entitlements (user_id, plan, auto_renew, renews_at, source)
       VALUES ($1, 'quarter', FALSE, now() + make_interval(days => $2), 'blogger')
       ON CONFLICT (user_id) DO UPDATE SET
         renews_at = GREATEST(COALESCE(entitlements.renews_at, now()), now()) + make_interval(days => $2), updated_at = now()`,
      [userId, BLOGGER_PREMIUM_DAYS],
    );
    await db.query('UPDATE users SET blogger_premium_at = now() WHERE id = $1', [userId]);
    return true;
  });
}

/* ───────────── Блогер прикрепляет скриншот сторис → Premium сразу ───────────── */

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
    await pool.query("INSERT INTO blogger_proofs (user_id, image, status) VALUES ($1, $2, 'approved')", [req.user.id, image]);
    if (await grantPremium(req.user.id))
      void notifyUser(
        req.user.id,
        `Поздравляем! 🎉\n\nТебе открыт подарочный hush. Premium на 3 месяца: узнавай, кто тебя спросил, и смотри все ответы 💜`,
        'Открыть hush.',
      );
    return { status: 'approved' as const };
  }),
);

/* ───────────── Админка: воронка, выручка по блогерам и рассыльщикам, вопросы блогера ───────────── */

export const bloggerAdminApi = Router();
bloggerAdminApi.use(express.json({ limit: '16kb' }));
bloggerAdminApi.use((req: Request, res: Response, next) => {
  if (!isAdmin(req.user as TgUser)) {
    res.status(403).json({ code: 'forbidden' });
    return;
  }
  next();
});

/** Метка рассыльщика из ссылки: blogger → без метки, bl_ivan → ivan */
const managerOf = (campaign: string | null) => (campaign && campaign.startsWith('bl_') ? campaign.slice(3) : null);

bloggerAdminApi.get(
  '/',
  handle(async () => {
    // Пришедшие по ссылкам блогера — referred_by (личная ссылка или свой вопрос блогера); выручка — их настоящие оплаты
    const { rows } = await pool.query(`
      SELECT u.id, u.first_name, u.username, u.blogger_at, u.blogger_campaign, u.blogger_premium_at, u.ask_slug IS NOT NULL AS has_link,
        EXISTS (SELECT 1 FROM events e WHERE e.user_id = u.id AND e.name IN ('story_shared', 'story_sheet_opened')) AS story_clicked,
        (SELECT p.id FROM blogger_proofs p WHERE p.user_id = u.id ORDER BY p.created_at DESC LIMIT 1) AS proof_id,
        (SELECT COUNT(*) FROM inbox i WHERE i.recipient_id = u.id AND i.kind = 'user')::int AS questions,
        (SELECT COUNT(*) FROM users g WHERE g.referred_by = u.id)::int AS guests,
        (SELECT COUNT(*) FROM users g WHERE g.referred_by = u.id AND g.ask_slug IS NOT NULL)::int AS guests_links,
        (SELECT COUNT(*) FROM asks a JOIN users g ON g.id = a.owner_id WHERE g.referred_by = u.id)::int AS guests_asks,
        (SELECT COUNT(*) FROM questionnaires q JOIN users g ON g.id = q.owner_id WHERE g.referred_by = u.id)::int AS guests_questionnaires,
        (SELECT COUNT(DISTINCT p.user_id) FROM payments p JOIN users g ON g.id = p.user_id WHERE g.referred_by = u.id AND NOT p.test_mode)::int AS payers,
        (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN users g ON g.id = p.user_id WHERE g.referred_by = u.id AND NOT p.test_mode) AS revenue
      FROM users u WHERE u.blogger_at IS NOT NULL
      ORDER BY revenue DESC, guests DESC, u.blogger_at DESC
      LIMIT 500`);
    const bloggers = rows.map((r) => ({
      id: String(r.id),
      firstName: r.first_name,
      username: r.username,
      openedAt: r.blogger_at.toISOString(),
      manager: managerOf(r.blogger_campaign),
      premiumAt: r.blogger_premium_at?.toISOString() ?? null,
      hasLink: r.has_link,
      storyClicked: r.story_clicked,
      proofId: r.proof_id ? String(r.proof_id) : null,
      questions: r.questions,
      guests: r.guests,
      guestsLinks: r.guests_links,
      guestsAsks: r.guests_asks,
      guestsQuestionnaires: r.guests_questionnaires,
      payers: r.payers,
      revenue: Number(r.revenue),
    }));
    const sum = (k: 'guests' | 'questions' | 'revenue' | 'payers' | 'guestsLinks') => bloggers.reduce((n, b) => n + b[k], 0);
    // По рассыльщикам: сколько блогеров привёл, сколько людей и денег они принесли
    const managers = new Map<string, { manager: string; bloggers: number; withStory: number; guests: number; revenue: number }>();
    for (const b of bloggers) {
      const key = b.manager ?? '—';
      const m = managers.get(key) ?? { manager: key, bloggers: 0, withStory: 0, guests: 0, revenue: 0 };
      m.bloggers += 1;
      if (b.proofId) m.withStory += 1;
      m.guests += b.guests;
      m.revenue += b.revenue;
      managers.set(key, m);
    }
    return {
      link: appLink('blogger'),
      premiumDays: BLOGGER_PREMIUM_DAYS,
      funnel: {
        opened: bloggers.length,
        made_link: bloggers.filter((b) => b.hasLink).length,
        story_clicked: bloggers.filter((b) => b.storyClicked).length,
        proof_sent: bloggers.filter((b) => b.proofId).length,
        premium_given: bloggers.filter((b) => b.premiumAt).length,
      },
      totals: { guests: sum('guests'), guestsLinks: sum('guestsLinks'), questions: sum('questions'), payers: sum('payers'), revenue: sum('revenue') },
      managers: [...managers.values()].sort((a, b) => b.revenue - a.revenue || b.guests - a.guests),
      bloggers,
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

/** Какие вопросы задавали блогеру — для идей в маркетинге (без отправителей) */
bloggerAdminApi.get(
  '/:id/questions',
  handle(async (req) => {
    const { rows } = await pool.query(
      `SELECT i.text, i.created_at FROM inbox i JOIN users u ON u.id = i.recipient_id
       WHERE i.recipient_id = $1 AND u.blogger_at IS NOT NULL AND i.kind = 'user' ORDER BY i.created_at DESC LIMIT 300`,
      [Number(req.params.id) || 0],
    );
    return { items: rows.map((r) => ({ text: r.text as string, createdAt: r.created_at.toISOString() })) };
  }),
);

/** Выдать Premium вручную (например, если скриншот прислали в личку) */
bloggerAdminApi.post(
  '/:id/approve',
  handle(async (req) => {
    const userId = Number(req.params.id);
    const done = await grantPremium(userId);
    if (done)
      void notifyUser(userId, `Поздравляем! 🎉\n\nТебе открыт подарочный hush. Premium на 3 месяца 💜`, 'Открыть hush.');
    return { status: done ? 'approved' : 'already' };
  }),
);
