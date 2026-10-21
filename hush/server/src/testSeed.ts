/**
 * Тестовые ответы для проверки экранов владельцем (по его просьбе).
 * TEST_SEED_USERNAME=<username> — при старте дополняет последнюю анкету этого пользователя
 *   тестовыми ответами до 5 (идемпотентно). Респонденты — фиктивные пользователи с id < 0 и именем «Тест: друг N».
 *   TEST_SEED_COUNT=N — вместо этого добавить ровно N ответов.
 * TEST_INBOX_USERNAME=<username> [+ TEST_INBOX_COUNT=N] — присылает во «Мне задали» N (по умолчанию 5) тестовых вопросов
 *   от фиктивных подписчиков; нечётные разрешают раскрыть профиль, чётные — анонимные.
 * TEST_CLEANUP=true — удаляет всех тестовых респондентов и их ответы.
 * TEST_RESET_USERNAME=<username> — снимает у пользователя отметку об отмене и таймер предложения 299 ₽ и Premium,
 *   оплаченный только тестовыми платежами (если есть хоть один боевой платёж — подписку не трогает).
 * TEST_GRANT_YEAR_USERNAME=<username> / TEST_GRANT_MONTH_USERNAME=<username> — выдаёт Premium вручную (source 'manual', без автопродления) на год / месяц;
 *   подписку с автосписанием в CloudPayments при этом отменяет, чтобы она не списывала поверх.
 * TEST_RESET_QA_USERNAME=<username> — HUSH 2.0 с нуля: удаляет личную ссылку, входящие, свои вопросы с ответами и анкеты
 *   (подписку и платежи не трогает).
 * TEST_REVOKE_MANUAL_PREMIUM_USERNAME=<username> — снимает только выданный вручную Premium (source 'manual'); платежи не трогает.
 * TEST_REVOKE_ALL_PREMIUM_USERNAME=<username> — полностью отключает подписку (отменяет в CloudPayments, удаляет доступ); история платежей остаётся.
 * TEST_RESET_OFFER_SINCE=<ISO-время> — сбрасывает таймер 3-часового предложения у всех, кто его запустил после этого времени.
 * TEST_RESET_OFFER_USERNAMES=<u1,u2> — заново запускает 3-часовое предложение у этих пользователей (таймер и отметка об отмене подписки).
 * TEST_RESET_STATS=true — статистика в админке начинается заново с этого момента (данные пользователей и платежи не удаляются).
 * TEST_UNBLOGGER_USERNAME=<username> — убирает пользователя из блогеров (метка, скриншоты, подарочный Premium).
 * TEST_CLEAR_INBOX_USERNAME=<username> — удаляет все полученные вопросы (ссылка остаётся), вопрос дня придёт заново.
 * TEST_DELETE_QUESTIONNAIRES_USERNAME=<username> — удаляет все анкеты пользователя вместе с ответами (начать заново).
 */
import { randomBytes } from 'node:crypto';
import { CATALOG, type Question } from './catalog';
import { newId } from './routes';
import { config } from './config';
import { cpApi } from './billing';
import { getPlan } from './plans';
import { pool, tx } from './db';
import { notifyThresholdReached } from './telegram';

const SAMPLES: Record<string, string[]> = {
  q1: ['Честность, упорство и умение поддержать в нужный момент.', 'Ты внимательный, смешной и очень надёжный.', 'Харизма, целеустремлённость, доброта.', 'Ум, чувство юмора и умение слушать.'],
  q9: ['С тобой можно говорить обо всём и не бояться осуждения.', 'Ты заряжаешь энергией.', 'Потому что с тобой всегда весело и спокойно одновременно.', 'Ты настоящий друг.'],
  q2: ['Ты лучше всех умеешь слушать — с тобой хочется говорить часами.', 'В умении быстро разобраться в чём угодно.', 'Ты никогда не сдаёшься.', 'В том, как ты находишь общий язык с людьми.'],
  q3: ['Ты постоянно опаздываешь и делаешь вид, что это нормально.', 'Когда ты перебиваешь и не даёшь договорить.', 'Иногда ты слишком резко отвечаешь, когда устаёшь.', 'Ты часто откладываешь ответ на сообщения.'],
  q4: ['Ты часто сидишь в телефоне, когда с тобой разговаривают.', 'Сразу споришь, даже не дослушав.', 'Иногда кажется, что ты смотришь свысока, хотя это не так.', 'Слишком много сарказма.'],
  q5: ['Иногда мне кажется, что ты совсем не замечаешь чужие чувства.', 'Что я давно хотела извиниться за ту ссору.', 'Что ты для меня важнее, чем я показываю.', 'Что ты зря сомневаешься в себе.'],
  q6: ['Ты часто обещаешь и забываешь — людей это задевает.', 'Ты закрываешься, когда тебе плохо.', 'Со стороны ты кажешься холоднее, чем есть.', 'Ты слишком строго к себе относишься.'],
  q10: ['Тёплая, упрямая, настоящая.', 'Яркая, громкая, своя.', 'Спокойная, умная, загадочная.', 'Добрая, смелая, честная.'],
  q7: ['Тому, как легко ты знакомишься с людьми и располагаешь их к себе.', 'Твоей уверенности — ты просто делаешь, а я сомневаюсь.', 'Твоему чувству стиля.', 'Твоей дисциплине.'],
  q8: ['Ты заслуживаешь большего и зря соглашаешься на меньшее.', 'Не всем нужно нравиться — и это нормально.', 'Ты слишком много берёшь на себя.', 'Тебе пора больше отдыхать.'],
};
const GENERIC = ['Сложно сказать одним предложением, но ты точно особенный человек.', 'Думаю, ты и так об этом догадываешься.', 'Честно — даже не знаю, что ответить, но мне с тобой хорошо.', 'Ты всегда умеешь удивить.'];

export async function runTestSeed(): Promise<void> {
  if (process.env.TEST_CLEANUP === 'true') {
    await pool.query('DELETE FROM inbox WHERE sender_id < 0');
    await pool.query('DELETE FROM ask_answers WHERE respondent_id < 0');
    const r = await pool.query('DELETE FROM responses WHERE respondent_id < 0');
    await pool.query('DELETE FROM users WHERE id < 0 AND NOT EXISTS (SELECT 1 FROM responses WHERE respondent_id = users.id)');
    console.log(`[test] удалено тестовых ответов: ${r.rowCount}`);
  }
  const resetName = (process.env.TEST_RESET_USERNAME || '').replace(/^@/, '').toLowerCase();
  if (resetName) {
    const { rows } = await pool.query('SELECT id FROM users WHERE lower(username) = $1', [resetName]);
    for (const { id } of rows) {
      await pool.query('UPDATE users SET cancelled_at = NULL, offer_started_at = NULL WHERE id = $1', [id]);
      const real = await pool.query('SELECT 1 FROM payments WHERE user_id = $1 AND test_mode = FALSE LIMIT 1', [id]);
      if (real.rowCount) {
        console.log(`[test] @${resetName}: есть боевые платежи — подписку не трогаю, отметка отмены снята`);
      } else {
        const del = await pool.query('DELETE FROM entitlements WHERE user_id = $1', [id]);
        const rev = await pool.query('DELETE FROM reveal_purchases WHERE owner_id = $1', [id]);
        console.log(`[test] @${resetName}: отметка отмены снята, тестовых подписок удалено ${del.rowCount}, тестовых раскрытий ${rev.rowCount}`);
      }
    }
    if (!rows.length) console.warn(`[test] @${resetName} не найден`);
  }

  for (const [envName, plan, period] of [
    ['TEST_GRANT_YEAR_USERNAME', 'year', '1 year'],
    ['TEST_GRANT_MONTH_USERNAME', 'month', '1 month'],
  ] as const) {
  const grantName = (process.env[envName] || '').replace(/^@/, '').toLowerCase();
  if (grantName) {
    const { rows } = await pool.query(
      'SELECT u.id, e.subscription_id FROM users u LEFT JOIN entitlements e ON e.user_id = u.id WHERE lower(u.username) = $1',
      [grantName],
    );
    for (const { id, subscription_id } of rows) {
      if (subscription_id) {
        try {
          await cpApi('subscriptions/cancel', { Id: subscription_id });
          console.log(`[test] @${grantName}: подписка ${subscription_id} в CloudPayments отменена`);
        } catch (e) {
          console.warn(`[test] @${grantName}: не удалось отменить подписку ${subscription_id}: ${(e as Error).message}`);
        }
      }
      await pool.query(
        `INSERT INTO entitlements (user_id, plan, auto_renew, renews_at, source)
         VALUES ($1, $2, FALSE, now() + $3::interval, 'manual')
         ON CONFLICT (user_id) DO UPDATE SET plan = $2, auto_renew = FALSE, renews_at = now() + $3::interval,
           source = 'manual', subscription_id = NULL, base_amount = NULL, discount_next = FALSE, updated_at = now()`,
        [id, plan, period],
      );
      console.log(`[test] @${grantName}: выдан Premium (${plan}) на ${period}`);
    }
    if (!rows.length) console.warn(`[test] @${grantName} не найден`);
  }
  }

  const inboxName = (process.env.TEST_INBOX_USERNAME || '').replace(/^@/, '').toLowerCase();
  if (inboxName) {
    const { rows } = await pool.query('SELECT id FROM users WHERE lower(username) = $1', [inboxName]);
    const count = Math.min(Number(process.env.TEST_INBOX_COUNT) || 5, 20);
    const QUESTIONS = [
      'Какой твой самый большой секрет?',
      'В кого ты сейчас влюблён(а)?',
      'Что ты никогда не рассказывал(а) подписчикам?',
      'О чём ты больше всего жалеешь?',
      'Что тебя бесит в людях?',
      'Какая твоя самая странная привычка?',
      'Что бы ты изменил(а) в себе?',
    ];
    for (const { id } of rows) {
      for (let i = 0; i < count; i++) {
        const fakeId = -Number(BigInt('0x' + randomBytes(5).toString('hex')) % 1_000_000_000n) - 1;
        await pool.query('INSERT INTO users (id, first_name, username) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
          fakeId,
          `Тест: подписчик ${i + 1}`,
          `test_follower_${i + 1}`,
        ]);
        await pool.query(
          "INSERT INTO inbox (id, recipient_id, sender_id, kind, text, consent_reveal, created_at) VALUES ($1, $2, $3, 'user', $4, $5, now() - make_interval(mins => $6))",
          [`T${randomBytes(6).toString('hex')}`, id, fakeId, QUESTIONS[i % QUESTIONS.length], i % 2 === 0, i * 3],
        );
      }
      console.log(`[test] @${inboxName}: прислано тестовых вопросов ${count} (раскрыть можно: ${Math.ceil(count / 2)})`);
    }
    if (!rows.length) console.warn(`[test] @${inboxName} не найден`);
  }

  const revokeName = (process.env.TEST_REVOKE_MANUAL_PREMIUM_USERNAME || '').replace(/^@/, '').toLowerCase();
  if (revokeName) {
    const r = await pool.query(
      "DELETE FROM entitlements WHERE source = 'manual' AND user_id IN (SELECT id FROM users WHERE lower(username) = $1)",
      [revokeName],
    );
    await pool.query('UPDATE users SET offer_started_at = NULL WHERE lower(username) = $1', [revokeName]);
    console.log(`[test] @${revokeName}: снят ручной Premium (${r.rowCount}), таймер предложения сброшен`);
  }

  const revokeAll = (process.env.TEST_REVOKE_ALL_PREMIUM_USERNAME || '').replace(/^@/, '').toLowerCase();
  if (revokeAll) {
    const { rows } = await pool.query(
      'SELECT e.user_id, e.subscription_id FROM entitlements e JOIN users u ON u.id = e.user_id WHERE lower(u.username) = $1',
      [revokeAll],
    );
    for (const e of rows) {
      if (e.subscription_id) {
        try {
          await cpApi('subscriptions/cancel', { Id: e.subscription_id });
        } catch (err) {
          console.log(`[test] @${revokeAll}: отмена в CloudPayments не удалась: ${(err as Error).message}`);
        }
      }
      await pool.query('DELETE FROM entitlements WHERE user_id = $1', [e.user_id]);
    }
    await pool.query('UPDATE users SET offer_started_at = NULL, cancelled_at = NULL WHERE lower(username) = $1', [revokeAll]);
    const u = (await pool.query('SELECT id, username FROM users WHERE lower(username) = $1', [revokeAll])).rows[0];
    const left = u ? (await getPlan(u)).plan : null;
    console.log(`[test] @${revokeAll}: подписка отключена (${rows.length}), таймер предложения сброшен; тариф сейчас: ${left}`);
  }

  const offerSince = process.env.TEST_RESET_OFFER_SINCE;
  if (offerSince) {
    const r = await pool.query('UPDATE users SET offer_started_at = NULL WHERE offer_started_at >= $1::timestamptz', [offerSince]);
    console.log(`[test] таймер предложения сброшен: ${r.rowCount}`);
  }

  const offerUsers = (process.env.TEST_RESET_OFFER_USERNAMES || '').split(',').map((u) => u.trim().replace(/^@/, '').toLowerCase()).filter(Boolean);
  if (offerUsers.length) {
    const r = await pool.query('UPDATE users SET offer_started_at = NULL, cancelled_at = NULL WHERE lower(username) = ANY($1)', [offerUsers]);
    console.log(`[test] предложение заново для ${offerUsers.join(', ')}: ${r.rowCount}`);
  }

  if (process.env.TEST_RESET_STATS === 'true') {
    await pool.query(
      "INSERT INTO app_settings (key, value) VALUES ('stats_since', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [new Date().toISOString()],
    );
    console.log('[test] статистика админки начинается заново с', new Date().toISOString());
  }

  const unblogger = (process.env.TEST_UNBLOGGER_USERNAME || '').replace(/^@/, '').toLowerCase();
  if (unblogger) {
    const { rows } = await pool.query('SELECT id FROM users WHERE lower(username) = $1', [unblogger]);
    for (const u of rows) {
      await pool.query('DELETE FROM blogger_proofs WHERE user_id = $1', [u.id]);
      const e = await pool.query("DELETE FROM entitlements WHERE user_id = $1 AND source = 'blogger'", [u.id]);
      await pool.query('UPDATE users SET blogger_at = NULL, blogger_campaign = NULL, blogger_premium_at = NULL WHERE id = $1', [u.id]);
      console.log(`[test] @${unblogger}: убран из блогеров, подарочный Premium снят: ${e.rowCount}`);
    }
  }

  const clearInbox = (process.env.TEST_CLEAR_INBOX_USERNAME || '').replace(/^@/, '').toLowerCase();
  if (clearInbox) {
    const r = await pool.query('DELETE FROM inbox WHERE recipient_id IN (SELECT id FROM users WHERE lower(username) = $1)', [clearInbox]);
    await pool.query('UPDATE users SET daily_last_at = NULL WHERE lower(username) = $1', [clearInbox]);
    console.log(`[test] @${clearInbox}: удалено входящих вопросов: ${r.rowCount}`);
  }

  const qaName = (process.env.TEST_RESET_QA_USERNAME || '').replace(/^@/, '').toLowerCase();
  if (qaName) {
    const { rows } = await pool.query('SELECT id FROM users WHERE lower(username) = $1', [qaName]);
    for (const { id } of rows) {
      const inbox = await pool.query('DELETE FROM inbox WHERE recipient_id = $1', [id]);
      const asks = await pool.query('DELETE FROM asks WHERE owner_id = $1', [id]);
      const qs = await pool.query('DELETE FROM questionnaires WHERE owner_id = $1', [id]);
      await pool.query('UPDATE users SET ask_slug = NULL, link_created_at = NULL, daily_last_at = NULL WHERE id = $1', [id]);
      console.log(`[test] @${qaName}: сброшено — входящих ${inbox.rowCount}, своих вопросов ${asks.rowCount}, анкет ${qs.rowCount}, ссылка удалена`);
    }
    if (!rows.length) console.warn(`[test] @${qaName} не найден`);
  }

  const wipeName = (process.env.TEST_DELETE_QUESTIONNAIRES_USERNAME || '').replace(/^@/, '').toLowerCase();
  if (wipeName) {
    const r = await pool.query(
      `DELETE FROM questionnaires WHERE owner_id IN (SELECT id FROM users WHERE lower(username) = $1) RETURNING id`,
      [wipeName],
    );
    console.log(`[test] @${wipeName}: удалено анкет ${r.rowCount} (${r.rows.map((x) => x.id).join(', ')})`);
  }

  const username = (process.env.TEST_SEED_USERNAME || '').replace(/^@/, '').toLowerCase();
  if (!username) return;

  const { rows } = await pool.query(
    `SELECT q.id, q.owner_id, q.questions FROM questionnaires q JOIN users u ON u.id = q.owner_id
     WHERE lower(u.username) = $1 ORDER BY q.created_at DESC LIMIT 1`,
    [username],
  );
  let q = rows[0] as { id: string; owner_id: string; questions: Question[] } | undefined;
  if (!q) {
    // Анкеты нет — создаём из первых 5 базовых вопросов (пользователь должен хотя бы раз открыть приложение)
    const { rows: u } = await pool.query('SELECT id FROM users WHERE lower(username) = $1', [username]);
    if (!u[0]) {
      console.warn(`[test] @${username} ещё не открывал приложение — анкету создать не для кого`);
      return;
    }
    const questions = CATALOG.filter((x) => !x.premium).slice(0, config.resultsThreshold);
    const id = newId(8);
    await pool.query('INSERT INTO questionnaires (id, owner_id, questions) VALUES ($1, $2, $3)', [id, u[0].id, JSON.stringify(questions)]);
    console.log(`[test] @${username}: создана анкета ${id}`);
    q = { id, owner_id: u[0].id, questions };
  }

  const notify = await tx(async (db) => {
    const { rows: c } = await db.query('SELECT count(*)::int AS n FROM responses WHERE questionnaire_id = $1', [q.id]);
    // TEST_SEED_COUNT=N — добавить ровно N ответов; иначе дополнить до порога
    const extra = Number(process.env.TEST_SEED_COUNT) || 0;
    const need = extra > 0 ? Math.min(extra, 20) : config.resultsThreshold - c[0].n;
    for (let i = 0; i < need; i++) {
      const n = c[0].n + i + 1;
      const fakeId = -Number(BigInt('0x' + randomBytes(5).toString('hex')) % 1_000_000_000n) - 1;
      await db.query('INSERT INTO users (id, first_name, username) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
        fakeId,
        `Тест: друг ${n}`,
        `test_friend_${n}`,
      ]);
      const answers = q.questions.map((question, k) => {
        const pool = SAMPLES[question.id] ?? GENERIC;
        // Первый тестовый ответ — развёрнутый, остальные короче
        const text = i === 0 ? `${pool[(k + i) % pool.length]} ${pool[(k + i + 1) % pool.length]}` : pool[(k + i) % pool.length];
        return { questionId: question.id, text };
      });
      await db.query(
        `INSERT INTO responses (id, questionnaire_id, respondent_id, answers, consent_reveal, consent_version, consent_decided_at, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, 'test', now(), $6)`,
        [`T${randomBytes(6).toString('hex')}`, q.id, fakeId, JSON.stringify(answers), i % 2 === 0, `test-${randomBytes(8).toString('hex')}`],
      );
    }
    console.log(`[test] анкета ${q.id}: добавлено тестовых ответов ${Math.max(need, 0)}`);
    const { rows: u } = await db.query(
      `UPDATE questionnaires SET notified_at = now()
       WHERE id = $1 AND notified_at IS NULL AND (SELECT count(*) FROM responses WHERE questionnaire_id = $1) >= $2
       RETURNING owner_id`,
      [q.id, config.resultsThreshold],
    );
    return u.length > 0;
  });
  if (notify) await notifyThresholdReached(Number(q.owner_id));
}
