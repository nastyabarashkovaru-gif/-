import { DateTime } from 'luxon';

/** Все календарные расчёты — в IANA-таймзоне пользователя; в БД хранится UTC. */
export type LocalDate = string; // YYYY-MM-DD

export function isValidTimezone(tz: string): boolean {
  try {
    return DateTime.now().setZone(tz).isValid;
  } catch {
    return false;
  }
}

export function localDate(now: Date, tz: string): LocalDate {
  return DateTime.fromJSDate(now, { zone: tz }).toISODate()!;
}

export function addDays(d: LocalDate, n: number): LocalDate {
  return DateTime.fromISO(d, { zone: 'UTC' }).plus({ days: n }).toISODate()!;
}

export function diffDays(a: LocalDate, b: LocalDate): number {
  return Math.round(DateTime.fromISO(a, { zone: 'UTC' }).diff(DateTime.fromISO(b, { zone: 'UTC' }), 'days').days);
}

/** Понедельник недели, в которую входит дата (неделя Пн–Вс). */
export function weekStart(d: LocalDate): LocalDate {
  const dt = DateTime.fromISO(d, { zone: 'UTC' });
  return dt.minus({ days: dt.weekday - 1 }).toISODate()!;
}
export const weekEnd = (d: LocalDate): LocalDate => addDays(weekStart(d), 6);

export const dayKey = (d: LocalDate) => `D:${d}`;
export const weekKey = (d: LocalDate) => `W:${weekStart(d)}`;
export const ONCE_KEY = 'O:once';

/** Момент начала локального дня в UTC (учитывает DST). */
export function startOfLocalDay(d: LocalDate, tz: string): Date {
  return DateTime.fromISO(d, { zone: tz }).startOf('day').toJSDate();
}

/** Перебор дат включительно. */
export function dateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Дедлайн из локальной даты и времени пользователя → точный UTC timestamp. */
export function deadlineFromLocal(date: LocalDate, time: string, tz: string): Date | null {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone: tz });
  return dt.isValid ? dt.toJSDate() : null;
}

/** Серия уникальных календарных дней открытия, заканчивающаяся сегодня (или вчера, если сегодня ещё не открывали). */
export function openStreak(days: LocalDate[], today: LocalDate): number {
  const set = new Set(days);
  let cur = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(cur)) {
    n++;
    cur = addDays(cur, -1);
  }
  return n;
}

/** Самая длинная серия подряд идущих дней в списке. */
export function longestStreak(days: LocalDate[]): number {
  const sorted = [...new Set(days)].sort();
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}
