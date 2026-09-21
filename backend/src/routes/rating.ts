import { Router } from 'express';
import db from '../db';
import { requireTelegramAuth } from '../auth/telegramAuth';
import { UserRow } from '../types';

const router = Router();

interface RatingEntry {
  userId: number;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  trainingDays: number;
  manualRank: number | null;
}

// Рейтинг видит только тех, кто в том же потоке (стартовал в тот же день — 1 или 14 число)
function buildRating(monthOnly: boolean, streamStartDate: string): RatingEntry[] {
  const users = db
    .prepare('SELECT * FROM users WHERE onboarding_completed = 1 AND challenge_start_date = ?')
    .all(streamStartDate) as UserRow[];

  const entries: RatingEntry[] = users.map((u) => {
    const count = monthOnly
      ? (db
          .prepare(
            `SELECT COUNT(*) as c FROM daily_reports
             WHERE user_id = ? AND cycle = ? AND training_done = 1 AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now')`
          )
          .get(u.id, u.cycle) as { c: number }).c
      : (db
          .prepare(`SELECT COUNT(*) as c FROM daily_reports WHERE user_id = ? AND cycle = ? AND training_done = 1`)
          .get(u.id, u.cycle) as {
          c: number;
        }).c;

    return {
      userId: u.id,
      username: u.username,
      firstName: u.first_name,
      photoUrl: u.photo_url,
      trainingDays: count,
      manualRank: u.manual_rank,
    };
  });

  entries.sort((a, b) => {
    if (a.manualRank !== null && b.manualRank !== null) return a.manualRank - b.manualRank;
    if (a.manualRank !== null) return -1;
    if (b.manualRank !== null) return 1;
    return b.trainingDays - a.trainingDays;
  });

  return entries;
}

function currentUserStream(telegramId: number): string | null {
  const row = db.prepare('SELECT challenge_start_date FROM users WHERE id = ?').get(telegramId) as
    | { challenge_start_date: string }
    | undefined;
  return row?.challenge_start_date ?? null;
}

router.get('/overall', requireTelegramAuth, (req, res) => {
  const stream = currentUserStream(req.tgUser!.id);
  if (!stream) return res.json([]);
  res.json(buildRating(false, stream).map((e, i) => ({ ...e, place: i + 1 })));
});

router.get('/monthly', requireTelegramAuth, (req, res) => {
  const stream = currentUserStream(req.tgUser!.id);
  if (!stream) return res.json([]);
  res.json(buildRating(true, stream).map((e, i) => ({ ...e, place: i + 1 })));
});

// Призовой фонд — сумма "цены слова" участников ТВОЕГО потока
router.get('/prize-fund', requireTelegramAuth, (req, res) => {
  const stream = currentUserStream(req.tgUser!.id);
  if (!stream) return res.json({ total: 0 });

  const row = db
    .prepare(
      `SELECT COALESCE(SUM(price_of_word), 0) as total FROM users WHERE onboarding_completed = 1 AND challenge_start_date = ?`
    )
    .get(stream) as { total: number };
  res.json({ total: row.total });
});

export default router;
