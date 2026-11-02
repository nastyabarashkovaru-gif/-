import { addDays, daysBetween, type ISODate } from './dates';

/** Личный челлендж: 30 дней от выбранной даты старта (ТЗ 02.11) */
export const CHALLENGE_DAYS = 30;

export function challengeBounds(startsOn: ISODate) {
  return { startsOn, endsOn: addDays(startsOn, CHALLENGE_DAYS - 1), days: CHALLENGE_DAYS };
}

/** Фаза личного челленджа на дату: ещё не начался / идёт / завершён */
export function challengePhase(startsOn: ISODate, endsOn: ISODate, today: ISODate): 'upcoming' | 'active' | 'finished' {
  if (today < startsOn) return 'upcoming';
  if (today > endsOn) return 'finished';
  return 'active';
}

/** День челленджа (1…30); до старта — 0 */
export function challengeDay(startsOn: ISODate, endsOn: ISODate, today: ISODate): number {
  if (today < startsOn) return 0;
  return Math.min(daysBetween(startsOn, endsOn) + 1, daysBetween(startsOn, today) + 1);
}
