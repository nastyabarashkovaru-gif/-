import { Router } from 'express';
import db from '../db';
import { requireTelegramAuth } from '../auth/telegramAuth';
import { upload, uploadsPublicPath } from '../upload';
import { DailyReportRow, UserRow } from '../types';

const router = Router();
const CHALLENGE_DAYS = Number(process.env.CHALLENGE_DAYS || 100);

function serializeReport(row: DailyReportRow) {
  return {
    dayNumber: row.day_number,
    date: row.date,
    trainingDone: !!row.training_done,
    trainingMediaUrl: row.training_media_url,
    trainingMediaType: row.training_media_type,
    extraTasksDone: JSON.parse(row.extra_tasks_done || '{}') as Record<string, boolean>,
  };
}

// Загрузка фото/видео-доказательства тренировки
router.post('/upload', requireTelegramAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const mediaType = req.file.mimetype.startsWith('video') ? 'video' : 'photo';
  res.json({ url: `${uploadsPublicPath}/${req.file.filename}`, mediaType });
});

// Сетка прогресса на 100 дней для текущего пользователя
router.get('/me', requireTelegramAuth, (req, res) => {
  const tg = req.tgUser!;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(tg.id) as UserRow | undefined;
  if (!user) return res.status(404).json({ error: 'not_found' });

  const reports = db
    .prepare('SELECT * FROM daily_reports WHERE user_id = ? AND cycle = ? ORDER BY day_number ASC')
    .all(tg.id, user.cycle) as DailyReportRow[];

  const byDay = new Map(reports.map((r) => [r.day_number, r]));
  const grid = [];
  for (let day = 1; day <= CHALLENGE_DAYS; day++) {
    const r = byDay.get(day);
    grid.push(
      r
        ? serializeReport(r)
        : { dayNumber: day, date: null, trainingDone: false, trainingMediaUrl: null, trainingMediaType: null, extraTasksDone: {} }
    );
  }

  const completedTrainingDays = reports.filter((r) => r.training_done).length;
  const missedDays = Math.max(0, CHALLENGE_DAYS - completedTrainingDays);

  res.json({
    challengeDays: CHALLENGE_DAYS,
    startDate: user.challenge_start_date,
    grid,
    completedTrainingDays,
    missedDays,
    forceMajeureAllowed: user.force_majeure_allowed,
  });
});

// Отметка дня: тренировка (фото/видео обязательны) + доп. задачи
router.post('/day/:day', requireTelegramAuth, (req, res) => {
  const tg = req.tgUser!;
  const dayNumber = Number(req.params.day);
  if (!Number.isInteger(dayNumber) || dayNumber < 1 || dayNumber > CHALLENGE_DAYS) {
    return res.status(400).json({ error: 'invalid_day' });
  }

  const { trainingDone, trainingMediaUrl, trainingMediaType, extraTasksDone } = req.body as {
    trainingDone: boolean;
    trainingMediaUrl?: string;
    trainingMediaType?: string;
    extraTasksDone?: Record<string, boolean>;
  };

  if (trainingDone && !trainingMediaUrl) {
    return res.status(400).json({ error: 'training_requires_media', message: 'Нужно прикрепить фото или видео тренировки' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(tg.id) as UserRow | undefined;
  if (!user) return res.status(404).json({ error: 'not_found' });

  const existing = db
    .prepare('SELECT * FROM daily_reports WHERE user_id = ? AND cycle = ? AND day_number = ?')
    .get(tg.id, user.cycle, dayNumber) as DailyReportRow | undefined;

  const today = new Date().toISOString().slice(0, 10);

  if (existing) {
    db.prepare(
      `UPDATE daily_reports SET training_done = ?, training_media_url = ?, training_media_type = ?, extra_tasks_done = ?
       WHERE user_id = ? AND cycle = ? AND day_number = ?`
    ).run(
      trainingDone ? 1 : 0,
      trainingMediaUrl ?? existing.training_media_url,
      trainingMediaType ?? existing.training_media_type,
      JSON.stringify(extraTasksDone || {}),
      tg.id,
      user.cycle,
      dayNumber
    );
  } else {
    db.prepare(
      `INSERT INTO daily_reports (user_id, cycle, day_number, date, training_done, training_media_url, training_media_type, extra_tasks_done)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tg.id,
      user.cycle,
      dayNumber,
      today,
      trainingDone ? 1 : 0,
      trainingMediaUrl ?? null,
      trainingMediaType ?? null,
      JSON.stringify(extraTasksDone || {})
    );
  }

  const row = db
    .prepare('SELECT * FROM daily_reports WHERE user_id = ? AND cycle = ? AND day_number = ?')
    .get(tg.id, user.cycle, dayNumber) as DailyReportRow;
  res.json(serializeReport(row));
});

export default router;
