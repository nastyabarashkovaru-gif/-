import { DateTime } from 'luxon';
import { plural, sphereById, type SphereId } from '@rostok/shared';
import type { Task } from '../api/types';

export const sphereName = (s: SphereId | string) => sphereById(s)?.name ?? s;

export function fmtDate(iso: string | null | undefined, withTime = false) {
  if (!iso) return '';
  const d = DateTime.fromISO(iso).setLocale('ru');
  return withTime ? d.toFormat('d MMMM, HH:mm') : d.toFormat('d MMMM yyyy');
}

export function frequencyLabel(t: Pick<Task, 'kind' | 'timesPerWeek' | 'deadlineAt'>) {
  if (t.kind === 'daily') return 'Каждый день';
  if (t.kind === 'weekly') return `${t.timesPerWeek} ${plural(t.timesPerWeek ?? 1, 'раз', 'раза', 'раз')} в неделю`;
  if (t.kind === 'habit') return 'Ежедневный вопрос';
  return t.deadlineAt ? `До ${fmtDate(t.deadlineAt, true)}` : 'Один раз';
}

export function deadlineLeft(iso: string) {
  const diff = DateTime.fromISO(iso).diffNow(['days', 'hours', 'minutes']);
  if (diff.toMillis() <= 0) return 'дедлайн прошёл';
  if (diff.days >= 1) return `осталось ${Math.floor(diff.days)} ${plural(Math.floor(diff.days), 'день', 'дня', 'дней')}`;
  if (diff.hours >= 1) return `осталось ${Math.floor(diff.hours)} ч`;
  return `осталось ${Math.max(1, Math.floor(diff.minutes))} мин`;
}

export const userName = (first?: string | null) => first || 'Друг';
