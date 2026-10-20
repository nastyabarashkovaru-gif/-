/**
 * HUSH 2.0 — анонимные вопросы и ответы.
 * А) «Пусть меня спрашивают»: постоянная личная ссылка u_<slug> → входящие вопросы.
 * Б) «Задать свой вопрос»: вопрос аудитории a_<id> → анонимные ответы.
 * Отправитель никогда не раскрывается: в ответах API нет его id, блокировка и жалоба — по id вопроса.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { pool, tx } from './db';
import { rateLimit } from './rateLimit';
import { handle, HttpError, newId } from './http';
import { appLink, notifyUser } from './telegram';
import { getPlan } from './plans';
import type { TgUser } from './auth';

const QUESTION_MAX = 300;
const ANSWER_MAX = 1000;
const ASK_MAX = 200;
/** Не больше 10 вопросов одному человеку от одного отправителя за час */
const PER_PAIR_PER_HOUR = 10;
/** Без подписки: 3 своих вопроса подписчикам и первые 3 ответа на каждый */
/** Бесплатно — 3 своих вопроса подписчикам (удалённые тоже считаются), дальше по подписке */
export const FREE_ASKS = 3;
export const FREE_ASK_ANSWERS = 3;

const isPremium = async (u: TgUser) => (await getPlan(u)).plan !== null;
const consentOf = (body: { revealIdentity?: unknown } | undefined) => body?.revealIdentity === true;

const DAILY: string[] = JSON.parse(readFileSync(path.join(__dirname, '../../shared/daily.json'), 'utf8'));

const clean = (v: unknown) => String(v ?? '').trim().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
const validKey = (v: unknown) => /^[\w-]{8,100}$/.test(String(v ?? ''));

export const personalLink = (slug: string) => appLink(`u_${slug}`);
export const askLink = (id: string) => appLink(`a_${id}`);

export async function logEvent(userId: number, name: string, source: string | null = null) {
  await pool.query('INSERT INTO events (user_id, name, source) VALUES ($1, $2, $3)', [userId, name, source]).catch(() => {});
}

/** Для /api/me: личная ссылка и счётчики */
export async function qaSummary(userId: number) {
  const { rows } = await pool.query(
    `SELECT u.ask_slug,
       (SELECT count(*) FROM inbox i WHERE i.recipient_id = u.id AND i.deleted_at IS NULL AND i.answer IS NULL AND i.story_at IS NULL
          -- пока вопросы не открылись (меньше 5), вопрос дня в счётчик не входит
          AND (i.kind <> 'system' OR (SELECT count(*) FROM inbox r WHERE r.recipient_id = u.id AND r.deleted_at IS NULL AND r.kind <> 'system') >= ${INBOX_THRESHOLD}))::int AS unanswered,
       (SELECT count(*) FROM asks a WHERE a.owner_id = u.id AND a.deleted_at IS NULL)::int AS asks,
       (SELECT count(*) FROM asks a WHERE a.owner_id = u.id)::int AS asks_created,
       (SELECT count(*) FROM inbox s WHERE s.sender_id = u.id AND s.kind = 'user' AND s.answer IS NOT NULL AND s.sender_seen_at IS NULL)::int AS sent_unread,
       (SELECT count(*) FROM inbox s WHERE s.sender_id = u.id AND s.kind = 'user')::int AS sent
     FROM users u WHERE u.id = $1`,
    [userId],
  );
  const r = rows[0] ?? {};
  return {
    askSlug: r.ask_slug ?? null,
    link: r.ask_slug ? personalLink(r.ask_slug) : null,
    unanswered: r.unanswered ?? 0,
    asks: r.asks ?? 0,
    asksCreated: r.asks_created ?? 0,
    freeAsks: FREE_ASKS,
    sentUnread: r.sent_unread ?? 0,
    sent: r.sent ?? 0,
  };
}

async function isBlocked(ownerId: number, senderId: number) {
  const { rowCount } = await pool.query('SELECT 1 FROM blocks WHERE owner_id = $1 AND blocked_id = $2', [ownerId, senderId]);
  return Boolean(rowCount);
}

/** Вопрос дня от hush: не больше одного в день (МСК), только у тех, кто завёл личную ссылку */
async function deliverDaily(userId: number) {
  const { rows } = await pool.query(
    `UPDATE users SET daily_last_at = (now() AT TIME ZONE 'Europe/Moscow')::date
     WHERE id = $1 AND ask_slug IS NOT NULL
       AND (daily_last_at IS NULL OR daily_last_at < (now() AT TIME ZONE 'Europe/Moscow')::date)
     RETURNING id`,
    [userId],
  );
  if (!rows.length) return;
  const got = await pool.query("SELECT text FROM inbox WHERE recipient_id = $1 AND kind = 'system'", [userId]);
  const used = new Set(got.rows.map((r) => r.text));
  const fresh = DAILY.filter((q) => !used.has(q));
  const pool_ = fresh.length ? fresh : DAILY;
  const text = pool_[Math.floor(Math.random() * pool_.length)];
  await pool.query("INSERT INTO inbox (id, recipient_id, sender_id, kind, text) VALUES ($1, $2, NULL, 'system', $3)", [newId(12), userId, text]);
}

interface InboxRow {
  id: string;
  kind: string;
  text: string;
  answer: string | null;
  answered_at: Date | null;
  story_at: Date | null;
  created_at: Date;
}
const INBOX_COLS = 'id, kind, text, answer, answered_at, story_at, created_at';
const inboxView = (r: InboxRow) => ({
  id: r.id,
  text: r.text,
  // Вопрос дня и вопрос самому себе выглядят как обычные анонимные
  from: 'anon',
  status: r.answer ? 'answered' : r.story_at ? 'story' : 'new',
  answer: r.answer,
  answeredAt: r.answered_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
});

async function ownInbox(id: string, userId: number): Promise<InboxRow & { sender_id: string | null }> {
  const { rows } = await pool.query('SELECT * FROM inbox WHERE id = $1 AND recipient_id = $2 AND deleted_at IS NULL', [id, userId]);
  if (!rows[0]) throw new HttpError('not_found');
  return rows[0];
}

async function ownAsk(id: string, userId: number) {
  const { rows } = await pool.query('SELECT * FROM asks WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL', [id, userId]);
  if (!rows[0]) throw new HttpError('not_found');
  return rows[0] as { id: string; owner_id: string; text: string; created_at: Date };
}

/** Вопросы открываются, когда их наберётся 5 (анонимность); после этого все бесплатны — платно только «узнать, кто спросил» */
export const INBOX_THRESHOLD = 5;

async function inboxAccess(user: TgUser) {
  const { rows } = await pool.query<{ id: string; kind: string }>(
    'SELECT id, kind FROM inbox WHERE recipient_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC',
    [user.id],
  );
  // Порог считаем только по настоящим вопросам (вопрос дня не помогает его набрать)
  const collected = rows.filter((r) => r.kind !== 'system').length;
  if (collected < INBOX_THRESHOLD) return { collected, gated: true, open: new Set<string>() };
  const premium = await isPremium(user);
  return { collected, gated: false, premium, open: new Set(rows.map((r) => r.id)) };
}

/** Ответ, сторис, «узнать автора» — только по открытому вопросу (набралось 5, и он бесплатный или есть подписка) */
async function requireOpen(user: TgUser, id: string) {
  const access = await inboxAccess(user);
  if (access.gated) throw new HttpError('not_found');
  if (!access.open.has(id)) throw new HttpError('premium_required');
}

type Identity = { firstName: string; lastName?: string; username?: string; photoUrl?: string };
/**
 * Авторы для подписчика: профиль — только если автор разрешил (consent), иначе null («пожелал остаться анонимным»).
 * Без подписки не вызывается: клиент вообще не узнаёт, кто дал согласие.
 */
async function authorsOf(rows: Array<{ id: string; consent: boolean; authorId: string | null; kind: string }>) {
  // Вопрос самому себе с согласием тоже показывает профиль (свой) — иначе при проверке своей ссылки «Разрешить» выглядит сломанным
  const named = (r: { consent: boolean; authorId: string | null; kind: string }) => r.consent && r.authorId && (r.kind === 'user' || r.kind === 'self');
  const ids = [...new Set(rows.filter(named).map((r) => r.authorId as string))];
  const users = new Map<string, Identity>();
  if (ids.length) {
    const { rows: us } = await pool.query('SELECT id, first_name, last_name, username, photo_url FROM users WHERE id = ANY($1::bigint[])', [ids]);
    for (const u of us) users.set(String(u.id), { firstName: u.first_name, lastName: u.last_name ?? undefined, username: u.username ?? undefined, photoUrl: u.photo_url ?? undefined });
  }
  return new Map(rows.map((r) => [r.id, (named(r) && users.get(String(r.authorId))) || null]));
}

export const qaApi = Router();

/* ───────────── Личная ссылка ───────────── */

qaApi.post(
  '/me/link',
  rateLimit('link', 30, 60 * 60_000),
  handle(async (req) => {
    const existing = await pool.query('SELECT ask_slug FROM users WHERE id = $1', [req.user.id]);
    let slug: string | null = existing.rows[0]?.ask_slug ?? null;
    if (!slug) {
      // Постоянный код создаётся один раз; при редком совпадении — новая попытка
      for (let i = 0; i < 5 && !slug; i++) {
        const candidate = newId(8);
        const { rows } = await pool.query(
          'UPDATE users SET ask_slug = $2, link_created_at = now() WHERE id = $1 AND ask_slug IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE ask_slug = $2) RETURNING ask_slug',
          [req.user.id, candidate],
        );
        slug = rows[0]?.ask_slug ?? (await pool.query('SELECT ask_slug FROM users WHERE id = $1', [req.user.id])).rows[0]?.ask_slug ?? null;
      }
      if (!slug) throw new Error('slug allocation failed');
      await logEvent(req.user.id, 'link_created', String(req.body?.source ?? '').slice(0, 40) || null);
    }
    return { slug, link: personalLink(slug) };
  }),
);

/* ───────────── Входящие ───────────── */

qaApi.get(
  '/inbox',
  rateLimit('read', 240, 60_000),
  handle(async (req) => {
    await deliverDaily(req.user.id);
    const access = await inboxAccess(req.user);
    // Пока не набралось 5 вопросов — только счётчик, сами вопросы не уходят с сервера
    if (access.gated) return { items: [], gate: { collected: access.collected, required: INBOX_THRESHOLD } };
    const { rows } = await pool.query<InboxRow & { sender_id: string | null; consent_reveal: boolean }>(
      `SELECT ${INBOX_COLS}, sender_id, consent_reveal FROM inbox WHERE recipient_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 300`,
      [req.user.id],
    );
    // С подпиской авторы видны сразу на месте кнопки «Узнать, кто спросил»
    const authors = access.premium
      ? await authorsOf(rows.map((r) => ({ id: r.id, consent: Boolean(r.consent_reveal), authorId: r.sender_id, kind: r.kind })))
      : null;
    // Открытые сверху (новые первыми), закрытые по подписке — внизу
    const open = rows.filter((r) => access.open.has(r.id));
    const locked = rows.filter((r) => !access.open.has(r.id));
    return {
      items: [
        ...open.map((r) => ({ ...inboxView(r), ...(authors ? { author: authors.get(r.id) ?? null } : {}) })),
        ...locked.map((r) => ({ ...inboxView(r), text: null, answer: null, locked: true })),
      ],
    };
  }),
);

qaApi.post(
  '/inbox/:id/answer',
  rateLimit('answer', 120, 60 * 60_000),
  handle(async (req) => {
    const q = await ownInbox(req.params.id, req.user.id);
    await requireOpen(req.user, q.id);
    const text = clean(req.body?.text);
    if (!text || text.length > ANSWER_MAX) throw new HttpError('invalid');
    // Личный ответ: его увидит только тот, кто спросил (во вкладке «Я спросил(а)»)
    const { rows } = await pool.query<InboxRow>(
      `UPDATE inbox SET answer = $2, answered_at = now(), sender_seen_at = NULL WHERE id = $1 RETURNING ${INBOX_COLS}`,
      [q.id, text],
    );
    if (!q.answer) {
      await logEvent(req.user.id, 'inbox_answered', `private_${q.kind}`);
      if (q.kind === 'user' && q.sender_id) {
        void notifyUser(Number(q.sender_id), `Тебе ответили на вопрос 💜\n\n«${q.text.slice(0, 120)}»`, 'Смотреть ответ', 'tab_asks');
      }
    }
    return inboxView(rows[0]);
  }),
);

qaApi.delete(
  '/inbox/:id/answer',
  handle(async (req) => {
    const q = await ownInbox(req.params.id, req.user.id);
    const { rows } = await pool.query<InboxRow>(
      `UPDATE inbox SET answer = NULL, answered_at = NULL WHERE id = $1 RETURNING ${INBOX_COLS}`,
      [q.id],
    );
    return inboxView(rows[0]);
  }),
);

/** Ответ в сторис: пользователь скопировал карточку вопроса — отмечаем и сообщаем спросившему */
qaApi.post(
  '/inbox/:id/story',
  rateLimit('answer', 120, 60 * 60_000),
  handle(async (req) => {
    const q = await ownInbox(req.params.id, req.user.id);
    await requireOpen(req.user, q.id);
    const { rows } = await pool.query<InboxRow>(
      `UPDATE inbox SET story_at = COALESCE(story_at, now()) WHERE id = $1 RETURNING ${INBOX_COLS}`,
      [q.id],
    );
    if (!q.story_at) {
      await logEvent(req.user.id, 'inbox_answered', `story_${q.kind}`);
      if (q.kind === 'user' && q.sender_id) {
        void notifyUser(Number(q.sender_id), `${req.user.first_name} ответил(а) на твой вопрос в сторис 👀\n\n«${q.text.slice(0, 120)}»`, 'Открыть hush.', 'tab_asks');
      }
    }
    return inboxView(rows[0]);
  }),
);

/** «Я спросил(а)»: вопросы, которые пользователь задал другим людям, и их личные ответы */
qaApi.get(
  '/sent',
  rateLimit('read', 240, 60_000),
  handle(async (req) => {
    const { rows } = await pool.query(
      `SELECT i.id, i.text, i.answer, i.answered_at, i.story_at, i.created_at, i.sender_seen_at, u.first_name, u.photo_url
       FROM inbox i JOIN users u ON u.id = i.recipient_id
       WHERE i.sender_id = $1 AND i.kind = 'user' ORDER BY COALESCE(i.answered_at, i.story_at, i.created_at) DESC LIMIT 300`,
      [req.user.id],
    );
    // Открыл список — личные ответы прочитаны
    await pool.query(
      "UPDATE inbox SET sender_seen_at = now() WHERE sender_id = $1 AND kind = 'user' AND answer IS NOT NULL AND sender_seen_at IS NULL",
      [req.user.id],
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        text: r.text,
        recipient: { firstName: r.first_name, photoUrl: r.photo_url },
        // Удалённый получателем вопрос остаётся у спросившего, просто без ответа
        answer: r.answer,
        status: r.answer ? 'answered' : r.story_at ? 'story' : 'waiting',
        unread: Boolean(r.answer && !r.sender_seen_at),
        answeredAt: (r.answered_at ?? r.story_at)?.toISOString() ?? null,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }),
);

qaApi.delete(
  '/inbox/:id',
  handle(async (req) => {
    const q = await ownInbox(req.params.id, req.user.id);
    await pool.query('UPDATE inbox SET deleted_at = now() WHERE id = $1', [q.id]);
  }),
);

qaApi.post(
  '/inbox/:id/report',
  rateLimit('report', 60, 60 * 60_000),
  handle(async (req) => {
    const q = await ownInbox(req.params.id, req.user.id);
    await pool.query('INSERT INTO reports (reporter_id, target_kind, target_id, reason) VALUES ($1, $2, $3, $4)', [
      req.user.id,
      'inbox',
      q.id,
      clean(req.body?.reason).slice(0, 200) || null,
    ]);
    await pool.query('UPDATE inbox SET reported_at = now(), deleted_at = now() WHERE id = $1', [q.id]);
    console.warn(`[report] inbox ${q.id} от пользователя ${req.user.id}`);
  }),
);

qaApi.post(
  '/inbox/:id/block',
  rateLimit('report', 60, 60 * 60_000),
  handle(async (req) => {
    const q = await ownInbox(req.params.id, req.user.id);
    // Вопрос дня и свои вопросы блокировать некого — просто убираем
    if (q.kind === 'user' && q.sender_id) {
      await pool.query('INSERT INTO blocks (owner_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, q.sender_id]);
    }
    await pool.query('UPDATE inbox SET deleted_at = now() WHERE recipient_id = $1 AND sender_id = $2 AND kind = $3', [req.user.id, q.sender_id, 'user']);
    await pool.query('UPDATE inbox SET deleted_at = now() WHERE id = $1', [q.id]);
  }),
);

/* ───────────── Форма вопроса по личной ссылке ───────────── */

async function recipientBySlug(slug: string) {
  const { rows } = await pool.query('SELECT id, first_name, photo_url FROM users WHERE ask_slug = $1', [slug]);
  if (!rows[0]) throw new HttpError('not_found');
  return rows[0] as { id: string; first_name: string; photo_url: string | null };
}

qaApi.get(
  '/public/u/:slug',
  rateLimit('read', 240, 60_000),
  handle(async (req) => {
    const r = await recipientBySlug(req.params.slug);
    const own = Number(r.id) === req.user.id;
    if (!own) await logEvent(req.user.id, 'link_opened', 'personal');
    return { firstName: r.first_name, photoUrl: r.photo_url, own };
  }),
);

qaApi.post(
  '/public/u/:slug/questions',
  rateLimit('send', 30, 10 * 60_000),
  handle(async (req) => {
    const r = await recipientBySlug(req.params.slug);
    const recipientId = Number(r.id);
    const text = clean(req.body?.text);
    const key = String(req.body?.idempotencyKey ?? '');
    if (!text || text.length > QUESTION_MAX || !validKey(key)) throw new HttpError('invalid');
    const self = recipientId === req.user.id;

    // Заблокированный отправитель видит обычный успех — вопрос просто не доходит
    if (!self && (await isBlocked(recipientId, req.user.id))) return { status: 'sent' };

    const created = await tx(async (db) => {
      const dup = await db.query('SELECT 1 FROM inbox WHERE idempotency_key = $1 AND sender_id = $2', [key, req.user.id]);
      if (dup.rowCount) return false;
      const recent = await db.query(
        "SELECT count(*)::int AS n FROM inbox WHERE recipient_id = $1 AND sender_id = $2 AND created_at > now() - interval '1 hour'",
        [recipientId, req.user.id],
      );
      if (recent.rows[0].n >= PER_PAIR_PER_HOUR) throw new HttpError('rate_limited');
      await db.query(
        'INSERT INTO inbox (id, recipient_id, sender_id, kind, text, idempotency_key, consent_reveal) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [newId(12), recipientId, req.user.id, self ? 'self' : 'user', text, key, consentOf(req.body)],
      );
      return true;
    });
    if (created && !self) {
      await logEvent(req.user.id, 'question_sent', 'personal');
      // Текст вопроса в пуш не кладём: вопросы открываются с 5-го, часть — по подписке
      void notifyUser(recipientId, 'Тебе задали новый анонимный вопрос 🤫\n\nОткрой hush., чтобы его прочитать', 'Открыть вопросы');
    }
    return { status: 'sent' };
  }),
);

/* ───────────── Свои вопросы аудитории ───────────── */

qaApi.post(
  '/asks',
  rateLimit('ask-create', 30, 60 * 60_000),
  handle(async (req) => {
    const text = clean(req.body?.text);
    if (text.length < 3 || text.length > ASK_MAX) throw new HttpError('invalid');
    // Бесплатно — 3 вопроса (удалённые тоже считаются), дальше по подписке
    if (!(await isPremium(req.user))) {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM asks WHERE owner_id = $1', [req.user.id]);
      if (rows[0].n >= FREE_ASKS) throw new HttpError('premium_required');
    }
    const id = newId(8);
    await pool.query('INSERT INTO asks (id, owner_id, text) VALUES ($1, $2, $3)', [id, req.user.id, text]);
    await logEvent(req.user.id, 'ask_created', String(req.body?.source ?? '').slice(0, 40) || null);
    return { id, text, createdAt: new Date().toISOString(), answerCount: 0, link: askLink(id) };
  }),
);

qaApi.get(
  '/asks',
  rateLimit('read', 240, 60_000),
  handle(async (req) => {
    const { rows } = await pool.query(
      `SELECT a.id, a.text, a.created_at,
         (SELECT count(*) FROM ask_answers x WHERE x.ask_id = a.id AND x.deleted_at IS NULL)::int AS answer_count,
         (SELECT max(created_at) FROM ask_answers x WHERE x.ask_id = a.id AND x.deleted_at IS NULL) AS last_answer_at
       FROM asks a WHERE a.owner_id = $1 AND a.deleted_at IS NULL ORDER BY a.created_at DESC`,
      [req.user.id],
    );
    return {
      items: rows.map((a) => ({
        id: a.id,
        text: a.text,
        createdAt: a.created_at.toISOString(),
        answerCount: a.answer_count,
        lastAnswerAt: a.last_answer_at?.toISOString() ?? null,
        link: askLink(a.id),
      })),
    };
  }),
);

qaApi.get(
  '/asks/:id',
  rateLimit('read', 240, 60_000),
  handle(async (req) => {
    const a = await ownAsk(req.params.id, req.user.id);
    // Результаты видны сразу, без порога ответивших
    const { rows } = await pool.query(
      'SELECT id, text, created_at, respondent_id, kind, consent_reveal FROM ask_answers WHERE ask_id = $1 AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 500',
      [a.id],
    );
    // Без подписки открыты первые 3 ответа; текст закрытых не покидает сервер. С подпиской — сразу и авторы
    const premium = await isPremium(req.user);
    const authors = premium
      ? await authorsOf(rows.map((x) => ({ id: x.id, consent: Boolean(x.consent_reveal), authorId: x.respondent_id, kind: x.kind })))
      : null;
    const answers = rows.map((x, i) => {
      const locked = !premium && i >= FREE_ASK_ANSWERS;
      return { id: x.id, text: locked ? null : x.text, locked, createdAt: x.created_at.toISOString(), ...(authors ? { author: authors.get(x.id) ?? null } : {}) };
    });
    return {
      ask: { id: a.id, text: a.text, createdAt: a.created_at.toISOString(), answerCount: rows.length, link: askLink(a.id) },
      // Без подписки — по порядку: сверху 3 бесплатных (самые ранние), ниже закрытые новые; с подпиской — новые сверху
      answers: premium ? answers.reverse() : answers,
    };
  }),
);

qaApi.delete(
  '/asks/:id',
  handle(async (req) => {
    const a = await ownAsk(req.params.id, req.user.id);
    await pool.query('UPDATE asks SET deleted_at = now() WHERE id = $1', [a.id]);
  }),
);

async function ownAskAnswer(askId: string, answerId: string, userId: number) {
  const a = await ownAsk(askId, userId);
  const { rows } = await pool.query('SELECT * FROM ask_answers WHERE id = $1 AND ask_id = $2 AND deleted_at IS NULL', [answerId, a.id]);
  if (!rows[0]) throw new HttpError('not_found');
  return rows[0] as { id: string; respondent_id: string; kind: string };
}

qaApi.delete(
  '/asks/:id/answers/:aid',
  handle(async (req) => {
    const x = await ownAskAnswer(req.params.id, req.params.aid, req.user.id);
    await pool.query('UPDATE ask_answers SET deleted_at = now() WHERE id = $1', [x.id]);
  }),
);

qaApi.post(
  '/asks/:id/answers/:aid/report',
  rateLimit('report', 60, 60 * 60_000),
  handle(async (req) => {
    const x = await ownAskAnswer(req.params.id, req.params.aid, req.user.id);
    await pool.query('INSERT INTO reports (reporter_id, target_kind, target_id, reason) VALUES ($1, $2, $3, $4)', [
      req.user.id,
      'ask_answer',
      x.id,
      clean(req.body?.reason).slice(0, 200) || null,
    ]);
    await pool.query('UPDATE ask_answers SET deleted_at = now() WHERE id = $1', [x.id]);
    console.warn(`[report] ask_answer ${x.id} от пользователя ${req.user.id}`);
  }),
);

qaApi.post(
  '/asks/:id/answers/:aid/block',
  rateLimit('report', 60, 60 * 60_000),
  handle(async (req) => {
    const x = await ownAskAnswer(req.params.id, req.params.aid, req.user.id);
    if (x.kind === 'user') {
      await pool.query('INSERT INTO blocks (owner_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, x.respondent_id]);
    }
    await pool.query('UPDATE ask_answers SET deleted_at = now() WHERE id = $1', [x.id]);
  }),
);

/* ───────────── Ответ подписчика на чужой вопрос ───────────── */

async function publicAsk(id: string) {
  const { rows } = await pool.query(
    'SELECT a.id, a.owner_id, a.text, u.first_name, u.photo_url FROM asks a JOIN users u ON u.id = a.owner_id WHERE a.id = $1 AND a.deleted_at IS NULL',
    [id],
  );
  if (!rows[0]) throw new HttpError('not_found');
  return rows[0] as { id: string; owner_id: string; text: string; first_name: string; photo_url: string | null };
}

qaApi.get(
  '/public/asks/:id',
  rateLimit('read', 240, 60_000),
  handle(async (req) => {
    const a = await publicAsk(req.params.id);
    const own = Number(a.owner_id) === req.user.id;
    const answered = await pool.query('SELECT 1 FROM ask_answers WHERE ask_id = $1 AND respondent_id = $2', [a.id, req.user.id]);
    if (!own) await logEvent(req.user.id, 'link_opened', 'ask');
    return { id: a.id, text: a.text, firstName: a.first_name, photoUrl: a.photo_url, own, answered: Boolean(answered.rowCount) };
  }),
);

qaApi.post(
  '/public/asks/:id/answers',
  rateLimit('send', 30, 10 * 60_000),
  handle(async (req) => {
    const a = await publicAsk(req.params.id);
    const ownerId = Number(a.owner_id);
    const text = clean(req.body?.text);
    const key = String(req.body?.idempotencyKey ?? '');
    if (!text || text.length > ANSWER_MAX || !validKey(key)) throw new HttpError('invalid');
    const self = ownerId === req.user.id;
    if (!self && (await isBlocked(ownerId, req.user.id))) return { status: 'sent' };

    const created = await tx(async (db) => {
      const dup = await db.query('SELECT 1 FROM ask_answers WHERE idempotency_key = $1 AND respondent_id = $2', [key, req.user.id]);
      if (dup.rowCount) return false;
      const inserted = await db.query(
        `INSERT INTO ask_answers (id, ask_id, respondent_id, kind, text, idempotency_key, consent_reveal) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (ask_id, respondent_id) DO NOTHING RETURNING id`,
        [newId(12), a.id, req.user.id, self ? 'self' : 'user', text, key, consentOf(req.body)],
      );
      if (!inserted.rowCount) throw new HttpError('already_answered');
      return true;
    });
    if (created && !self) {
      await logEvent(req.user.id, 'ask_answer_sent', null);
      void notifyUser(ownerId, `Тебе ответили на вопрос 💜\n\n«${a.text.slice(0, 120)}»`, 'Смотреть ответ', 'tab_asks');
    }
    return { status: 'sent' };
  }),
);

/* ───────────── «Узнать автора» ───────────── */

/**
 * Раскрытие автора вопроса/ответа: 1) согласие автора (вопрос дня и вопрос самому себе — всегда анонимны,
 * за них не предлагаем платить), 2) подписка (безлимит), 3) только разрешённые поля профиля.
 */
async function reveal(req: { user: TgUser }, consent: boolean, authorId: string | null, kind: string, target: string) {
  const log = (result: string) => logEvent(req.user.id, 'reveal', `${target}_${result}`);
  // Сначала подписка: без неё не сообщаем, разрешил ли автор себя показать
  if (!(await isPremium(req.user))) {
    await log('requires_plan');
    return { status: 'requires_plan' as const };
  }
  if (!consent || !authorId || (kind !== 'user' && kind !== 'self')) {
    await log('anonymous');
    return { status: 'anonymous' as const };
  }
  const { rows } = await pool.query('SELECT first_name, last_name, username, photo_url FROM users WHERE id = $1', [authorId]);
  const u = rows[0];
  if (!u) return { status: 'anonymous' as const };
  await log('revealed');
  return {
    status: 'revealed' as const,
    identity: { firstName: u.first_name, lastName: u.last_name ?? undefined, username: u.username ?? undefined, photoUrl: u.photo_url ?? undefined },
  };
}

qaApi.post(
  '/inbox/:id/reveal',
  rateLimit('reveal', 120, 60 * 60_000),
  handle(async (req) => {
    const q = await ownInbox(req.params.id, req.user.id);
    await requireOpen(req.user, q.id);
    return reveal(req, Boolean((q as { consent_reveal?: boolean }).consent_reveal), q.sender_id, q.kind, 'inbox');
  }),
);

qaApi.post(
  '/asks/:id/answers/:aid/reveal',
  rateLimit('reveal', 120, 60 * 60_000),
  handle(async (req) => {
    const x = await ownAskAnswer(req.params.id, req.params.aid, req.user.id);
    return reveal(req, Boolean((x as { consent_reveal?: boolean }).consent_reveal), x.respondent_id, x.kind, 'ask');
  }),
);

/* ───────────── Профиль ───────────── */

qaApi.get(
  '/me/activity',
  rateLimit('read', 240, 60_000),
  handle(async (req) => {
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*) FROM inbox WHERE recipient_id = $1 AND kind <> 'system' AND deleted_at IS NULL)::int AS received,
         (SELECT count(*) FROM inbox WHERE recipient_id = $1 AND answer IS NOT NULL AND deleted_at IS NULL)::int AS answered,
         (SELECT count(*) FROM asks WHERE owner_id = $1 AND deleted_at IS NULL)::int AS asks,
         (SELECT count(*) FROM ask_answers x JOIN asks a ON a.id = x.ask_id WHERE a.owner_id = $1 AND x.deleted_at IS NULL)::int AS ask_answers,
         (SELECT count(*) FROM inbox WHERE sender_id = $1 AND kind = 'user')::int AS sent`,
      [req.user.id],
    );
    const r = rows[0];
    return { received: r.received, answered: r.answered, asks: r.asks, askAnswers: r.ask_answers, sent: r.sent };
  }),
);
