import { Router } from 'express';
import db from '../db';
import { requireTelegramAuth } from '../auth/telegramAuth';
import { UserRow, ExtraTaskDef } from '../types';

const router = Router();

const MANDATORY_TASK: ExtraTaskDef = { id: 'training', label: 'Ежедневная тренировка' };

function serializeUser(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    firstName: row.first_name,
    photoUrl: row.photo_url,
    age: row.age,
    city: row.city,
    goal: row.goal,
    beforePhoto: row.before_photo,
    beforeDescription: row.before_description,
    measurements: row.measurements,
    priceOfWord: row.price_of_word,
    forceMajeureAllowed: row.force_majeure_allowed,
    extraTasks: JSON.parse(row.extra_tasks || '[]') as ExtraTaskDef[],
    onboardingCompleted: !!row.onboarding_completed,
    manualRank: row.manual_rank,
    goalConfirmedWinner: !!row.goal_confirmed_winner,
    createdAt: row.created_at,
    challengeStartDate: row.challenge_start_date,
  };
}

// Получить/создать текущего пользователя (автозаполнение из Telegram при первом входе)
router.get('/me', requireTelegramAuth, (req, res) => {
  const tg = req.tgUser!;
  let row = db.prepare('SELECT * FROM users WHERE id = ?').get(tg.id) as UserRow | undefined;

  if (!row) {
    db.prepare(
      `INSERT INTO users (id, username, first_name, photo_url) VALUES (?, ?, ?, ?)`
    ).run(tg.id, tg.username || null, tg.first_name || null, tg.photo_url || null);
    row = db.prepare('SELECT * FROM users WHERE id = ?').get(tg.id) as UserRow;
  } else {
    // держим имя/ник/фото в актуальном состоянии по данным Telegram
    db.prepare('UPDATE users SET username = ?, first_name = ?, photo_url = COALESCE(?, photo_url) WHERE id = ?').run(
      tg.username || null,
      tg.first_name || null,
      tg.photo_url || null,
      tg.id
    );
    row = db.prepare('SELECT * FROM users WHERE id = ?').get(tg.id) as UserRow;
  }

  res.json(serializeUser(row));
});

// Заполнение/редактирование анкеты
router.put('/me', requireTelegramAuth, (req, res) => {
  const tg = req.tgUser!;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(tg.id) as UserRow | undefined;
  if (!existing) return res.status(404).json({ error: 'not_found' });

  const {
    age,
    city,
    goal,
    beforePhoto,
    beforeDescription,
    measurements,
    priceOfWord,
    forceMajeureAllowed,
    extraTasks,
  } = req.body as {
    age?: number;
    city?: string;
    goal?: string;
    beforePhoto?: string;
    beforeDescription?: string;
    measurements?: string;
    priceOfWord?: number;
    forceMajeureAllowed?: number;
    extraTasks?: { id: string; label: string; isCustom?: boolean }[];
  };

  if (priceOfWord !== undefined && (typeof priceOfWord !== 'number' || priceOfWord < 0)) {
    return res.status(400).json({ error: 'invalid_price_of_word' });
  }
  if (forceMajeureAllowed !== undefined && (typeof forceMajeureAllowed !== 'number' || forceMajeureAllowed < 0)) {
    return res.status(400).json({ error: 'invalid_force_majeure' });
  }

  const safeExtraTasks = Array.isArray(extraTasks)
    ? extraTasks.filter((t) => t && typeof t.id === 'string' && typeof t.label === 'string')
    : JSON.parse(existing.extra_tasks || '[]');

  db.prepare(
    `UPDATE users SET
      age = COALESCE(?, age),
      city = COALESCE(?, city),
      goal = COALESCE(?, goal),
      before_photo = COALESCE(?, before_photo),
      before_description = COALESCE(?, before_description),
      measurements = COALESCE(?, measurements),
      price_of_word = COALESCE(?, price_of_word),
      force_majeure_allowed = COALESCE(?, force_majeure_allowed),
      extra_tasks = ?,
      onboarding_completed = 1,
      challenge_start_date = CASE WHEN onboarding_completed = 0 THEN date('now') ELSE challenge_start_date END
    WHERE id = ?`
  ).run(
    age ?? null,
    city ?? null,
    goal ?? null,
    beforePhoto ?? null,
    beforeDescription ?? null,
    measurements ?? null,
    priceOfWord ?? null,
    forceMajeureAllowed ?? null,
    JSON.stringify(safeExtraTasks),
    tg.id
  );

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(tg.id) as UserRow;
  res.json(serializeUser(row));
});

// Начать новые 100 дней: новая анкета, новая цель, прогресс обнуляется
router.post('/me/restart', requireTelegramAuth, (req, res) => {
  const tg = req.tgUser!;
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(tg.id) as UserRow | undefined;
  if (!existing) return res.status(404).json({ error: 'not_found' });

  db.prepare(
    `UPDATE users SET
      cycle = cycle + 1,
      challenge_start_date = date('now'),
      onboarding_completed = 0,
      goal = NULL,
      before_photo = NULL,
      before_description = NULL,
      measurements = NULL,
      manual_rank = NULL,
      goal_confirmed_winner = 0
    WHERE id = ?`
  ).run(tg.id);

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(tg.id) as UserRow;
  res.json(serializeUser(row));
});

// Список участников (для раздела "Участники"), поиск по нику
router.get('/', requireTelegramAuth, (req, res) => {
  const search = (req.query.search as string) || '';
  let rows: UserRow[];
  if (search.trim()) {
    rows = db
      .prepare(`SELECT * FROM users WHERE onboarding_completed = 1 AND username LIKE ? ORDER BY created_at DESC`)
      .all(`%${search.trim()}%`) as UserRow[];
  } else {
    rows = db
      .prepare(`SELECT * FROM users WHERE onboarding_completed = 1 ORDER BY created_at DESC`)
      .all() as UserRow[];
  }
  res.json(rows.map(serializeUser));
});

// Анкета конкретного участника
router.get('/:id', requireTelegramAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id)) as UserRow | undefined;
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json(serializeUser(row));
});

export const MANDATORY_TRAINING_TASK = MANDATORY_TASK;
export default router;
