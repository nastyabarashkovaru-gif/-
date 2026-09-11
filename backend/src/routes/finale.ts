import { Router } from 'express';
import db from '../db';
import { requireTelegramAuth } from '../auth/telegramAuth';
import { UserRow } from '../types';
import { randomQuote } from '../quotes';

const router = Router();
const CHALLENGE_DAYS = Number(process.env.CHALLENGE_DAYS || 100);

// Статус финала челленджа для текущего пользователя (после дня 100)
router.get('/status', requireTelegramAuth, (req, res) => {
  const tg = req.tgUser!;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(tg.id) as UserRow | undefined;
  if (!user) return res.status(404).json({ error: 'not_found' });

  const totalReported = db
    .prepare('SELECT COUNT(*) as c FROM daily_reports WHERE user_id = ? AND cycle = ? AND day_number <= ? AND training_done = 1')
    .get(tg.id, user.cycle, CHALLENGE_DAYS) as { c: number };

  const completedDays = totalReported.c;
  const missedDays = CHALLENGE_DAYS - completedDays;
  const reachedEnd = missedDays <= user.force_majeure_allowed;

  const place = (db
    .prepare(
      `SELECT COUNT(*) + 1 as rank FROM users u
       WHERE u.onboarding_completed = 1 AND u.id != ? AND (
         (SELECT COUNT(*) FROM daily_reports WHERE user_id = u.id AND cycle = u.cycle AND training_done = 1)
       ) > (
         SELECT COUNT(*) FROM daily_reports WHERE user_id = ? AND cycle = ? AND training_done = 1
       )`
    )
    .get(tg.id, tg.id, user.cycle) as { rank: number }).rank;

  if (user.goal_confirmed_winner) {
    res.json({
      state: 'winner',
      message: `Поздравляем, ты победил(а)! Забираешь призовой фонд.`,
      place,
      completedDays,
      missedDays,
    });
    return;
  }

  if (!reachedEnd) {
    res.json({
      state: 'not_finished',
      message:
        'В этот раз дойти до конца не получилось — бывает, это не конец. Не расстраивайся: 100 дней — это марафон, и главное, что ты попробовал(а). Нужно внести цену слова в общий фонд клуба.',
      amountDue: user.price_of_word,
      completedDays,
      missedDays,
    });
    return;
  }

  res.json({
    state: 'finished_unconfirmed',
    message: `Ты дошёл(ла) до конца — не пропустил(а) ни одного дня (с учётом форс-мажоров)! Это уже победа над собой, независимо от рейтинга. Твоё место в списке: #${place}`,
    quote: randomQuote(),
    place,
    completedDays,
    missedDays,
  });
});

export default router;
