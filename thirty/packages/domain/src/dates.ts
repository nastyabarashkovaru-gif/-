import { DateTime } from 'luxon';

/** Дата без времени в часовом поясе потока: 'YYYY-MM-DD' */
export type ISODate = string;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(v: unknown): v is ISODate {
  return typeof v === 'string' && ISO_RE.test(v) && DateTime.fromISO(v, { zone: 'utc' }).isValid;
}

function d(iso: ISODate): DateTime {
  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  if (!dt.isValid || !ISO_RE.test(iso)) throw new Error(`Invalid ISODate: ${iso}`);
  return dt;
}

const fmt = (dt: DateTime): ISODate => dt.toFormat('yyyy-LL-dd');

/** Локальная дата момента времени в указанном часовом поясе */
export function localDate(instant: Date, tz: string): ISODate {
  return fmt(DateTime.fromJSDate(instant, { zone: tz }));
}

export function addDays(iso: ISODate, n: number): ISODate {
  return fmt(d(iso).plus({ days: n }));
}

/** Сдвиг на n месяцев с прижатием к концу месяца (31.01 + 1 мес = 28/29.02) */
export function addMonths(iso: ISODate, n: number): ISODate {
  return fmt(d(iso).plus({ months: n }));
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round(d(b).diff(d(a), 'days').days);
}

export function eachDay(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let cur = start; cur <= end; cur = addDays(cur, 1)) out.push(cur);
  return out;
}

export function startOfMonth(iso: ISODate): ISODate {
  return fmt(d(iso).startOf('month'));
}

export function endOfMonth(iso: ISODate): ISODate {
  return fmt(d(iso).endOf('month'));
}

export function dayOfMonth(iso: ISODate): number {
  return d(iso).day;
}

/** Понедельник недели, в которую попадает дата */
export function startOfIsoWeek(iso: ISODate): ISODate {
  return fmt(d(iso).startOf('week'));
}

export function withDay(iso: ISODate, day: number): ISODate {
  const dt = d(iso);
  return fmt(dt.set({ day: Math.min(day, dt.daysInMonth ?? 28) }));
}

/** Момент начала локального дня в часовом поясе (UTC Date) */
export function startOfLocalDay(iso: ISODate, tz: string): Date {
  return DateTime.fromISO(iso, { zone: tz }).startOf('day').toJSDate();
}

/** Дедлайн дня — начало следующего локального дня */
export function dayDeadline(iso: ISODate, tz: string): Date {
  return startOfLocalDay(addDays(iso, 1), tz);
}

/** ISODate ↔ Date для полей Postgres DATE (Prisma отдаёт полночь UTC) */
export function toDbDate(iso: ISODate): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}
export function fromDbDate(date: Date): ISODate {
  return date.toISOString().slice(0, 10);
}

const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function monthTitle(iso: ISODate): string {
  const dt = d(iso);
  return `${MONTHS_NOM[dt.month - 1]} ${dt.year}`;
}

/** «1 ноября», с годом — «1 ноября 2026» */
export function humanDate(iso: ISODate, withYear = false): string {
  const dt = d(iso);
  return `${dt.day} ${MONTHS_GEN[dt.month - 1]}${withYear ? ` ${dt.year}` : ''}`;
}
