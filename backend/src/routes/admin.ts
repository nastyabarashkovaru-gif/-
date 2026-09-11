import { Router } from 'express';
import db from '../db';
import { requireAdminAuth, signAdminToken } from '../auth/adminAuth';
import { UserRow, DailyReportRow, PaymentRow } from '../types';

const router = Router();

const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

router.post('/login', (req, res) => {
  const { login, password } = req.body as { login?: string; password?: string };
  if (login === ADMIN_LOGIN && password === ADMIN_PASSWORD) {
    return res.json({ token: signAdminToken() });
  }
  res.status(401).json({ error: 'invalid_credentials' });
});

router.use(requireAdminAuth);

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
    extraTasks: JSON.parse(row.extra_tasks || '[]'),
    onboardingCompleted: !!row.onboarding_completed,
    manualRank: row.manual_rank,
    goalConfirmedWinner: !!row.goal_confirmed_winner,
    createdAt: row.created_at,
  };
}

// Все анкеты участников
router.get('/users', (_req, res) => {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as UserRow[];
  res.json(rows.map(serializeUser));
});

// Анкета + все отчёты одного участника
router.get('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id)) as UserRow | undefined;
  if (!user) return res.status(404).json({ error: 'not_found' });
  const reports = db
    .prepare('SELECT * FROM daily_reports WHERE user_id = ? ORDER BY day_number ASC')
    .all(user.id) as DailyReportRow[];
  res.json({
    ...serializeUser(user),
    reports: reports.map((r) => ({
      dayNumber: r.day_number,
      date: r.date,
      trainingDone: !!r.training_done,
      trainingMediaUrl: r.training_media_url,
      trainingMediaType: r.training_media_type,
      extraTasksDone: JSON.parse(r.extra_tasks_done || '{}'),
    })),
  });
});

// Редактирование рейтинга участника (ручной ранг) и подтверждение победителя
router.put('/users/:id/rating', (req, res) => {
  const { manualRank, goalConfirmedWinner } = req.body as { manualRank?: number | null; goalConfirmedWinner?: boolean };
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!user) return res.status(404).json({ error: 'not_found' });

  db.prepare('UPDATE users SET manual_rank = ?, goal_confirmed_winner = ? WHERE id = ?').run(
    manualRank === undefined ? user.manual_rank : manualRank,
    goalConfirmedWinner === undefined ? user.goal_confirmed_winner : goalConfirmedWinner ? 1 : 0,
    id
  );

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
  res.json(serializeUser(updated));
});

// Все платежи
router.get('/payments', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, u.username, u.first_name FROM payments p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC`
    )
    .all() as (PaymentRow & { username: string | null; first_name: string | null })[];
  res.json(rows);
});

// Пометить оплату как проведённую вручную (спорные случаи)
router.put('/payments/:id/mark-paid', (req, res) => {
  const id = Number(req.params.id);
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as PaymentRow | undefined;
  if (!payment) return res.status(404).json({ error: 'not_found' });

  db.prepare(`UPDATE payments SET status = 'manual_paid', paid_at = datetime('now') WHERE id = ?`).run(id);
  const updated = db.prepare('SELECT * FROM payments WHERE id = ?').get(id) as PaymentRow;
  res.json(updated);
});

export default router;
