import { flowBounds } from './calendar';
import { addDays, daysBetween, eachDay, startOfIsoWeek, type ISODate } from './dates';

export type Frequency = 'daily' | 'every_n_days' | 'n_per_week' | 'once';

export interface TaskSchedule {
  frequency: Frequency;
  /** every_n_days: шаг в днях; n_per_week: раз в неделю */
  n: number;
  /** once: последний день, когда задачу можно выполнить */
  dueDate?: ISODate | null;
}

export interface OccurrenceWindow {
  windowStart: ISODate;
  windowEnd: ISODate;
  slot: number;
}

export function validateSchedule(s: TaskSchedule): string | null {
  if (s.frequency === 'daily') return null;
  if (s.frequency === 'once') return s.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(s.dueDate) ? null : 'Нужна дата выполнения';
  if (!Number.isInteger(s.n) || s.n < 1) return 'n должно быть целым ≥ 1';
  if (s.frequency === 'every_n_days' && s.n > 31) return 'Шаг не больше 31 дня';
  if (s.frequency === 'n_per_week' && s.n > 7) return 'Не больше 7 раз в неделю';
  return null;
}

/**
 * Все обязательные выполнения задачи за поток. Генерируются один раз при фиксации целей
 * и больше не меняются — знаменатель рейтинга нельзя подправить задним числом.
 *
 * once: одно выполнение до дедлайна; в знаменатель попадает после дедлайна или как только выполнено.
 * n_per_week: недели с понедельника, обрезанные границами месяца;
 * в неполной неделе норма = ⌈n × дней / 7⌉ (но не больше дней в ней).
 */
export function generateOccurrences(task: TaskSchedule, flowStart: ISODate): OccurrenceWindow[] {
  const err = validateSchedule(task);
  if (err) throw new Error(err);
  const { startsOn, endsOn } = flowBounds(flowStart);
  const out: OccurrenceWindow[] = [];
  if (task.frequency === 'daily') {
    for (const day of eachDay(startsOn, endsOn)) out.push({ windowStart: day, windowEnd: day, slot: 0 });
    return out;
  }
  if (task.frequency === 'once') {
    // Одно выполнение с окном от старта потока до дедлайна (дедлайн не выходит за границы месяца)
    const due = task.dueDate! < startsOn ? startsOn : task.dueDate! > endsOn ? endsOn : task.dueDate!;
    out.push({ windowStart: startsOn, windowEnd: due, slot: 0 });
    return out;
  }
  if (task.frequency === 'every_n_days') {
    for (let day = startsOn; day <= endsOn; day = addDays(day, task.n)) out.push({ windowStart: day, windowEnd: day, slot: 0 });
    return out;
  }
  for (let monday = startOfIsoWeek(startsOn); monday <= endsOn; monday = addDays(monday, 7)) {
    const ws = monday < startsOn ? startsOn : monday;
    const sunday = addDays(monday, 6);
    const we = sunday > endsOn ? endsOn : sunday;
    const days = daysBetween(ws, we) + 1;
    const required = Math.min(days, Math.ceil((task.n * days) / 7));
    for (let slot = 0; slot < required; slot++) out.push({ windowStart: ws, windowEnd: we, slot });
  }
  return out;
}

/** Обязательные выполнения, которые можно закрыть отчётом за дату `date` */
export function openOn<T extends { windowStart: ISODate; windowEnd: ISODate }>(occ: T[], date: ISODate): T[] {
  return occ.filter((o) => o.windowStart <= date && date <= o.windowEnd);
}
