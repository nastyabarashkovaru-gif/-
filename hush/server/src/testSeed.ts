/**
 * Тестовые ответы для проверки экранов владельцем (по его просьбе).
 * TEST_SEED_USERNAME=<username> — при старте дополняет последнюю анкету этого пользователя
 *   тестовыми ответами до 5 (идемпотентно). Респонденты — фиктивные пользователи с id < 0 и именем «Тест: друг N».
 * TEST_CLEANUP=true — удаляет всех тестовых респондентов и их ответы.
 */
import { randomBytes } from 'node:crypto';
import type { Question } from './catalog';
import { config } from './config';
import { pool, tx } from './db';
import { notifyThresholdReached } from './telegram';

const SAMPLES: Record<string, string[]> = {
  q1: ['Честность, упорство и умение поддержать в нужный момент.', 'Ты внимательный, смешной и очень надёжный.', 'Харизма, целеустремлённость, доброта.', 'Ум, чувство юмора и умение слушать.'],
  q9: ['С тобой можно говорить обо всём и не бояться осуждения.', 'Ты заряжаешь энергией.', 'Потому что с тобой всегда весело и спокойно одновременно.', 'Ты настоящий друг.'],
  q2: ['Ты лучше всех умеешь слушать — с тобой хочется говорить часами.', 'В умении быстро разобраться в чём угодно.', 'Ты никогда не сдаёшься.', 'В том, как ты находишь общий язык с людьми.'],
  q3: ['Ты постоянно опаздываешь и делаешь вид, что это нормально.', 'Когда ты перебиваешь и не даёшь договорить.', 'Иногда ты слишком резко отвечаешь, когда устаёшь.', 'Ты часто откладываешь ответ на сообщения.'],
  q4: ['Ты часто сидишь в телефоне, когда с тобой разговаривают.', 'Сразу споришь, даже не дослушав.', 'Иногда кажешься высокомерной, хотя это не так.', 'Слишком много сарказма.'],
  q5: ['Иногда мне кажется, что ты совсем не замечаешь чужие чувства.', 'Что я давно хотела извиниться за ту ссору.', 'Что ты для меня важнее, чем я показываю.', 'Что ты зря сомневаешься в себе.'],
  q6: ['Ты часто обещаешь и забываешь — людей это задевает.', 'Ты закрываешься, когда тебе плохо.', 'Со стороны ты кажешься холоднее, чем есть.', 'Ты слишком строга к себе.'],
  q10: ['Тёплая, упрямая, настоящая.', 'Яркая, громкая, своя.', 'Спокойная, умная, загадочная.', 'Добрая, смелая, честная.'],
  q7: ['Тому, как легко ты знакомишься с людьми и располагаешь их к себе.', 'Твоей уверенности — ты просто делаешь, а я сомневаюсь.', 'Твоему чувству стиля.', 'Твоей дисциплине.'],
  q8: ['Ты достойна большего и зря соглашаешься на меньшее.', 'Не всем нужно нравиться — и это нормально.', 'Ты слишком много берёшь на себя.', 'Тебе пора больше отдыхать.'],
};
const GENERIC = ['Сложно сказать одним предложением, но ты точно особенный человек.', 'Думаю, ты и сама об этом догадываешься.', 'Честно — даже не знаю, что ответить, но мне с тобой хорошо.', 'Ты всегда умеешь удивить.'];

export async function runTestSeed(): Promise<void> {
  if (process.env.TEST_CLEANUP === 'true') {
    const r = await pool.query('DELETE FROM responses WHERE respondent_id < 0');
    await pool.query('DELETE FROM users WHERE id < 0 AND NOT EXISTS (SELECT 1 FROM responses WHERE respondent_id = users.id)');
    console.log(`[test] удалено тестовых ответов: ${r.rowCount}`);
  }
  const username = (process.env.TEST_SEED_USERNAME || '').replace(/^@/, '').toLowerCase();
  if (!username) return;

  const { rows } = await pool.query(
    `SELECT q.id, q.owner_id, q.questions FROM questionnaires q JOIN users u ON u.id = q.owner_id
     WHERE lower(u.username) = $1 ORDER BY q.created_at DESC LIMIT 1`,
    [username],
  );
  const q = rows[0] as { id: string; owner_id: string; questions: Question[] } | undefined;
  if (!q) {
    console.warn(`[test] у @${username} нет анкет — тестовые ответы не добавлены`);
    return;
  }

  const notify = await tx(async (db) => {
    const { rows: c } = await db.query('SELECT count(*)::int AS n FROM responses WHERE questionnaire_id = $1', [q.id]);
    const need = config.resultsThreshold - c[0].n;
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
