import { addMonths, dayOfMonth, endOfMonth, eachDay, localDate, monthTitle, startOfMonth, daysBetween, type ISODate } from './dates';

export interface FlowBounds {
  startsOn: ISODate;
  endsOn: ISODate;
  /** Фактическое число дней потока: 28–31 */
  days: number;
  title: string;
}

/** Поток = календарный месяц, начинается 1-го числа */
export function flowBounds(anyDateInMonth: ISODate): FlowBounds {
  const startsOn = startOfMonth(anyDateInMonth);
  const endsOn = endOfMonth(anyDateInMonth);
  return { startsOn, endsOn, days: daysBetween(startsOn, endsOn) + 1, title: monthTitle(startsOn) };
}

export function flowDays(startsOn: ISODate): ISODate[] {
  const b = flowBounds(startsOn);
  return eachDay(b.startsOn, b.endsOn);
}

/** Номер дня потока, начиная с 1 */
export function flowDayNumber(startsOn: ISODate, date: ISODate): number {
  return daysBetween(startsOn, date) + 1;
}

/**
 * Ближайший поток, в который можно попасть при покупке сейчас.
 * До 1-го числа — следующий месяц. В первые `lateJoinUntilDay` дней месяца — текущий (0 = только следующий).
 */
export function nearestJoinableFlow(now: Date, tz: string, lateJoinUntilDay = 1): ISODate {
  const today = localDate(now, tz);
  if (dayOfMonth(today) <= lateJoinUntilDay) return startOfMonth(today);
  return addMonths(startOfMonth(today), 1);
}

export type FlowPhase = 'upcoming' | 'active' | 'finished';

export function flowPhase(startsOn: ISODate, today: ISODate): FlowPhase {
  const { endsOn } = flowBounds(startsOn);
  if (today < startsOn) return 'upcoming';
  if (today > endsOn) return 'finished';
  return 'active';
}
