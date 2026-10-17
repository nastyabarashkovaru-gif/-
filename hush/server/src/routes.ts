import { Router } from 'express';
import { catalogQuestion, type Question } from './catalog';
import { config } from './config';
import { pool, tx } from './db';
import { isAdmin } from './admin';
import { qaApi, qaSummary } from './qa';
import { getPlan, pricingFor, REVEAL_PRICE } from './plans';
import { rateLimit } from './rateLimit';
import { appLink, bot, notifyThresholdReached } from './telegram';

import { handle, HttpError, newId } from './http';
export { handle, HttpError, newId };


interface QRow {
  id: string;
  owner_id: string;
  questions: Question[];
  created_at: Date;
  respondent_count: string;
}

const summary = (q: QRow) => ({
  id: q.id,
  createdAt: q.created_at.toISOString(),
  questions: q.questions,
  respondentCount: Number(q.respondent_count),
});

const Q_SELECT = `SELECT q.*, (SELECT count(*) FROM responses r WHERE r.questionnaire_id = q.id) AS respondent_count FROM questionnaires q`;

async function ownQuestionnaire(id: string, userId: number): Promise<QRow> {
  const { rows } = await pool.query<QRow>(`${Q_SELECT} WHERE q.id = $1`, [id]);
  // Чужая анкета неотличима от несуществующей
  if (!rows[0] || Number(rows[0].owner_id) !== userId) throw new HttpError('not_found');
  return rows[0];
}

/** Нормализация вопросов из запроса: готовые — только из каталога, свои — только Premium */
function parseQuestions(input: unknown): { questions: Question[]; hasCustom: boolean; hasLibrary: boolean } {
  if (!Array.isArray(input) || input.length !== 5) throw new HttpError('invalid');
  let hasCustom = false;
  let hasLibrary = false;
  const questions = input.map((raw, i): Question => {
    const item = raw as Partial<Question>;
    if (item?.custom) {
      const text = String(item.text ?? '').trim().replace(/\s+/g, ' ');
      if (!text || text.length > config.customQuestionMaxLength) throw new HttpError('invalid');
      hasCustom = true;
      return { id: `c${i + 1}`, text, custom: true };
    }
    const q = catalogQuestion(String(item?.id ?? ''));
    if (!q) throw new HttpError('invalid');
    if (q.premium) hasLibrary = true;
    return { id: q.id, text: q.text };
  });
  const texts = new Set(questions.map((q) => q.text.toLowerCase()));
  if (new Set(questions.map((q) => q.id)).size !== 5 || texts.size !== 5) throw new HttpError('invalid');
  return { questions, hasCustom, hasLibrary };
}

export const api = Router();
// HUSH 2.0: вопросы и ответы (личная ссылка, входящие, свои вопросы)
api.use(qaApi);

/* ───────────────────────── Владелец ───────────────────────── */

api.get(
  '/me',
  rateLimit('read', 240, 60_000),
  handle(async (req) => {
    const u = req.user;
    const [plan, list] = await Promise.all([
      getPlan(u),
      pool.query<QRow>(`${Q_SELECT} WHERE q.owner_id = $1 ORDER BY q.created_at DESC`, [u.id]),
    ]);
    return {
      me: { id: String(u.id), firstName: u.first_name, lastName: u.last_name, username: u.username, photoUrl: u.photo_url, isAdmin: isAdmin(req.user) },
      // HUSH 2.0: личная ссылка и счётчики вопросов
      qa: await qaSummary(u.id),
      entitlement: {
        plan: plan.plan,
        autoRenew: plan.autoRenew,
        renewsAt: plan.renewsAt,
        amount: plan.amount,
        nextChargeAmount: plan.nextChargeAmount,
        retentionOfferAvailable: plan.retentionOfferAvailable,
        demo: false,
      },
      // Цены, которые увидит и заплатит пользователь
      pricing: await pricingFor(u.id),
      questionnaires: list.rows.map(summary),
      app: { botUsername: bot.username, appShortName: config.appShortName },
    };
  }),
);

const EVENTS = new Set([
  'new_questionnaire_clicked',
  'new_questionnaire_paywall_shown',
  'custom_question_clicked',
  'custom_question_paywall_shown',
  'custom_question_created',
  'premium_upsell_clicked',
  'question_library_clicked',
  'question_library_paywall_shown',
  'story_sheet_opened',
  'story_shared',
  // HUSH 2.0
  'app_open',
  'start_choice',
  'share_clicked',
  'link_copied',
  'question_typing_started',
  'guest_create_link',
  'paywall_opened',
  'card_shared',
]);

/** События аналитики: пользователь берётся из подписи Telegram, время — серверное */
api.post(
  '/events',
  rateLimit('events', 120, 60_000),
  handle(async (req) => {
    const name = String(req.body?.name ?? '');
    const source = String(req.body?.source ?? '').slice(0, 40) || null;
    if (!EVENTS.has(name)) throw new HttpError('invalid');
    await pool.query('INSERT INTO events (user_id, name, source) VALUES ($1, $2, $3)', [req.user.id, name, source]);
  }),
);

/** Ошибки приложения на устройствах — только в лог сервера */
api.post(
  '/client-errors',
  rateLimit('client-errors', 20, 60 * 60_000),
  handle(async (req) => {
    const field = (key: string, max: number) => String(req.body?.[key] ?? '').slice(0, max);
    console.error(
      `[client-error] user=${req.user.id} where=${field('where', 40)} ${field('message', 300)}\n  ua=${field('ua', 200)}\n  ${field('stack', 1500)}`,
    );
  }),
);

/** Пользователь разрешил боту писать ему (WebApp.requestWriteAccess) */
api.post(
  '/me/write-access',
  handle(async (req) => {
    await pool.query('UPDATE users SET allows_write = TRUE WHERE id = $1', [req.user.id]);
  }),
);

api.post(
  '/questionnaires',
  rateLimit('create', 10, 60 * 60_000),
  handle(async (req) => {
    const { questions, hasCustom, hasLibrary } = parseQuestions(req.body?.questions);
    const { plan } = await getPlan(req.user);
    return tx(async (db) => {
      // Блокировка строки пользователя: две параллельные анкеты не обойдут бесплатный лимит
      await db.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [req.user.id]);
      if (!plan) {
        const { rows } = await db.query('SELECT count(*)::int AS n FROM questionnaires WHERE owner_id = $1', [req.user.id]);
        // Свои вопросы, расширенная библиотека и анкеты после первой — только по подписке
        if (hasCustom || hasLibrary || rows[0].n >= config.freeQuestionnaires) throw new HttpError('premium_required');
      }
      const id = newId(8);
      const { rows } = await db.query<QRow>(
        `INSERT INTO questionnaires (id, owner_id, questions) VALUES ($1, $2, $3)
         RETURNING *, 0 AS respondent_count`,
        [id, req.user.id, JSON.stringify(questions)],
      );
      return summary(rows[0]);
    });
  }),
);

api.get(
  '/questionnaires/:id',
  handle(async (req) => summary(await ownQuestionnaire(req.params.id, req.user.id))),
);

interface RRow {
  id: string;
  answers: Array<{ questionId: string; text: string }>;
  created_at: Date;
}

const totalLength = (r: RRow) => r.answers.reduce((n, a) => n + a.text.length, 0);

/** Порядок карточек: самый содержательный ответ первым, дальше по времени */
async function orderedResponses(questionnaireId: string): Promise<RRow[]> {
  const { rows } = await pool.query<RRow>(
    'SELECT id, answers, created_at FROM responses WHERE questionnaire_id = $1 ORDER BY created_at, id',
    [questionnaireId],
  );
  if (rows.length === 0) return rows;
  const best = rows.reduce((top, r) => (totalLength(r) > totalLength(top) ? r : top), rows[0]);
  return [best, ...rows.filter((r) => r !== best)];
}

api.get(
  '/questionnaires/:id/results',
  rateLimit('read', 240, 60_000),
  handle(async (req) => {
    const q = await ownQuestionnaire(req.params.id, req.user.id);
    const responses = await orderedResponses(q.id);
    if (responses.length < config.resultsThreshold) throw new HttpError('threshold_not_met');
    const premium = (await getPlan(req.user)).plan !== null;

    return {
      questionnaireId: q.id,
      respondentCount: responses.length,
      respondents: responses.map((r, index) => {
        const open =
          premium || index < config.freeOpenRespondents
            ? new Set(r.answers.map((a) => a.questionId))
            : new Set(
                [...r.answers]
                  .sort((a, b) => b.text.length - a.text.length)
                  .slice(0, config.freeVisibleAnswers)
                  .map((a) => a.questionId),
              );
        const answers = q.questions.map((question) => {
          const isOpen = open.has(question.id);
          const text = r.answers.find((a) => a.questionId === question.id)?.text ?? '';
          // Текст закрытого ответа не покидает сервер
          return { questionId: question.id, question: question.text, text: isOpen ? text : null, locked: !isOpen };
        });
        answers.sort((a, b) => Number(a.locked) - Number(b.locked));
        return { id: r.id, number: index + 1, answers };
      }),
    };
  }),
);

api.post(
  '/questionnaires/:id/respondents/:rid/reveal',
  rateLimit('reveal', 60, 60 * 60_000),
  handle(async (req) => {
    const q = await ownQuestionnaire(req.params.id, req.user.id);
    const { rows } = await pool.query(
      `SELECT r.id, r.consent_reveal, u.first_name, u.last_name, u.username, u.photo_url
       FROM responses r JOIN users u ON u.id = r.respondent_id
       WHERE r.id = $1 AND r.questionnaire_id = $2`,
      [req.params.rid, q.id],
    );
    const r = rows[0];
    if (!r) throw new HttpError('not_found');
    const log = (result: string) =>
      pool.query('INSERT INTO reveals (questionnaire_id, response_id, owner_id, result) VALUES ($1, $2, $3, $4)', [
        q.id,
        r.id,
        req.user.id,
        result,
      ]);

    // 1) Согласие проверяется до любых проверок оплаты
    if (!r.consent_reveal) {
      await log('anonymous');
      return { status: 'anonymous' };
    }
    // 2) Без подписки раскрытие недоступно
    const { plan } = await getPlan(req.user);
    if (!plan) {
      await log('requires_plan');
      return { status: 'requires_plan' };
    }
    // 3) Годовой — безлимит; 1 и 3 месяца — разовая покупка за 99 ₽ для каждого автора
    if (plan !== 'year') {
      const bought = await pool.query('SELECT 1 FROM reveal_purchases WHERE owner_id = $1 AND response_id = $2', [req.user.id, r.id]);
      if (!bought.rowCount) {
        await log('requires_purchase');
        return { status: 'requires_purchase', price: REVEAL_PRICE };
      }
    }
    await log('revealed');
    // 4) Только разрешённые поля профиля
    return {
      status: 'revealed',
      identity: { firstName: r.first_name, lastName: r.last_name ?? undefined, username: r.username ?? undefined, photoUrl: r.photo_url ?? undefined },
    };
  }),
);

/* ───────────────────────── Респондент ───────────────────────── */

async function publicQuestionnaire(id: string, userId: number) {
  const { rows } = await pool.query('SELECT id, owner_id, questions FROM questionnaires WHERE id = $1', [id]);
  const q = rows[0];
  if (!q) throw new HttpError('not_found');
  if (Number(q.owner_id) === userId) throw new HttpError('own_questionnaire');
  return q as { id: string; owner_id: string; questions: Question[] };
}

api.get(
  '/public/questionnaires/:id',
  rateLimit('read', 240, 60_000),
  handle(async (req) => {
    const q = await publicQuestionnaire(req.params.id, req.user.id);
    const { rowCount } = await pool.query('SELECT 1 FROM responses WHERE questionnaire_id = $1 AND respondent_id = $2', [
      q.id,
      req.user.id,
    ]);
    if (rowCount) throw new HttpError('already_answered');
    return { id: q.id, questions: q.questions };
  }),
);

api.post(
  '/public/questionnaires/:id/responses',
  rateLimit('submit', 30, 60 * 60_000),
  handle(async (req) => {
    const q = await publicQuestionnaire(req.params.id, req.user.id);
    const body = req.body ?? {};
    const idempotencyKey = String(body.idempotencyKey ?? '');
    const consent = body.consent ?? {};
    if (!/^[\w-]{8,100}$/.test(idempotencyKey) || typeof consent.revealIdentity !== 'boolean') throw new HttpError('invalid');

    // Ровно по одному непустому ответу на каждый вопрос анкеты
    const input: unknown[] = Array.isArray(body.answers) ? body.answers : [];
    if (input.length !== q.questions.length) throw new HttpError('invalid');
    const answers = q.questions.map((question) => {
      const found = input.find((a) => (a as { questionId?: string })?.questionId === question.id) as { text?: unknown } | undefined;
      const text = String(found?.text ?? '').trim();
      if (!text || text.length > config.answerMaxLength) throw new HttpError('invalid');
      return { questionId: question.id, text };
    });

    const decidedAt = new Date(String(consent.decidedAt ?? ''));
    const result = await tx(async (db) => {
      // Повтор того же запроса (ретрай сети) — успех без дубля
      const dup = await db.query('SELECT 1 FROM responses WHERE idempotency_key = $1 AND respondent_id = $2', [
        idempotencyKey,
        req.user.id,
      ]);
      if (dup.rowCount) return { notify: false };

      const inserted = await db.query(
        `INSERT INTO responses (id, questionnaire_id, respondent_id, answers, consent_reveal, consent_version, consent_decided_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING RETURNING id`,
        [
          newId(12),
          q.id,
          req.user.id,
          JSON.stringify(answers),
          consent.revealIdentity,
          String(consent.disclosureVersion ?? 'unknown').slice(0, 40),
          Number.isNaN(decidedAt.getTime()) ? new Date() : decidedAt,
          idempotencyKey,
        ],
      );
      if (!inserted.rowCount) throw new HttpError('already_answered');

      // Порог достигнут → отмечаем уведомление один раз (атомарно)
      const { rows } = await db.query(
        `UPDATE questionnaires SET notified_at = now()
         WHERE id = $1 AND notified_at IS NULL
           AND (SELECT count(*) FROM responses WHERE questionnaire_id = $1) >= $2
         RETURNING owner_id`,
        [q.id, config.resultsThreshold],
      );
      return { notify: rows.length > 0 };
    });

    if (result.notify) void notifyThresholdReached(Number(q.owner_id));
  }),
);

/** Ссылка на анкету — удобно для отладки */
api.get(
  '/questionnaires/:id/link',
  handle(async (req) => {
    const q = await ownQuestionnaire(req.params.id, req.user.id);
    return { link: appLink(q.id) };
  }),
);
