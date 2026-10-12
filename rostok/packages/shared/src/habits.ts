import { addDays, type LocalDate } from './periods.js';

export interface HabitCheckin {
  date: LocalDate;
  /** true — «Да» (вредная привычка случилась), false — «Нет» */
  yes: boolean;
}

/** Сколько подряд идущих «Нет» после последнего «Да» нужно, чтобы дерево вернулось в норму. */
export const HABIT_RECOVERY_DAYS = 3;

/**
 * Увядание по одной привычке.
 * После последнего «Да» дерево увядшее, пока не наберётся серия из 3 последовательных календарных дней с ответом «Нет».
 * День без ответа прерывает серию (не ухудшая состояние). Повторные «Да» перезапускают отсчёт.
 */
export function isHabitWithered(checkins: HabitCheckin[]): boolean {
  const sorted = [...checkins].sort((a, b) => (a.date < b.date ? -1 : 1));
  let lastYes = -1;
  sorted.forEach((c, i) => {
    if (c.yes) lastYes = i;
  });
  if (lastYes < 0) return false;
  let run = 0;
  let prev = sorted[lastYes].date;
  for (let i = lastYes + 1; i < sorted.length; i++) {
    const c = sorted[i];
    run = addDays(prev, 1) === c.date ? run + 1 : 1;
    prev = c.date;
    if (run >= HABIT_RECOVERY_DAYS) return false;
  }
  return true;
}

/** Дерево здоровья нормальное, только если ни у одной привычки нет активного периода увядания. */
export function healthTreeState(perHabit: HabitCheckin[][]): 'normal' | 'withered' {
  return perHabit.some(isHabitWithered) ? 'withered' : 'normal';
}

/** Целевое нетто-изменение баланса за день привычки по ответу. */
export function habitTargetAmount(yes: boolean, drops: number, hardcore: boolean): number {
  return yes ? (hardcore ? -1 : 0) : drops;
}
