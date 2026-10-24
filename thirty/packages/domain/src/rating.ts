import { eachDay, addDays, type ISODate } from './dates';

export interface OccurrenceFact {
  windowStart: ISODate;
  windowEnd: ISODate;
  done: boolean;
}

export interface MemberFacts {
  flowStart: ISODate;
  flowEnd: ISODate;
  /** Сегодня в часовом поясе потока */
  today: ISODate;
  occurrences: OccurrenceFact[];
  /** Даты принятых отчётов */
  reportDates: ISODate[];
}

export interface MemberStats {
  /** Выполнено обязательных выполнений (по всем целям) */
  completed: number;
  /** Знаменатель: всё, у чего окно закрыто, плюс уже выполненное в открытых окнах */
  scheduled: number;
  /** completion_ratio ∈ [0, 1] */
  ratio: number;
  /** Полностью закрытые дни: отчёт сдан и все выполнения с окном, заканчивающимся в этот день, сделаны */
  successfulDays: number;
  /** Прошедшие дни без отчёта */
  missedReports: number;
  /** Пропущенные обязательные выполнения в закрытых окнах */
  missedOccurrences: number;
  currentStreak: number;
  longestStreak: number;
  /** Пока без единого пропуска */
  perfectSoFar: boolean;
  /** Статус каждого дня для календаря */
  days: { date: ISODate; state: 'success' | 'partial' | 'missed' | 'today' | 'future' }[];
}

/**
 * Расчёт по плану обязательств. Все цели участника идут в один пул выполнений,
 * поэтому 1 цель и 3 цели с одинаковым процентом весят одинаково — без бонуса за число целей.
 */
export function computeStats(f: MemberFacts): MemberStats {
  const reports = new Set(f.reportDates);
  const closedBefore = f.today; // окна, закончившиеся раньше сегодняшнего дня, закрыты
  let completed = 0;
  let scheduled = 0;
  let missedOccurrences = 0;
  const dueByDay = new Map<ISODate, { total: number; done: number }>();
  for (const o of f.occurrences) {
    const closed = o.windowEnd < closedBefore;
    if (o.done) completed++;
    if (closed || o.done) scheduled++;
    if (closed && !o.done) missedOccurrences++;
    const agg = dueByDay.get(o.windowEnd) ?? { total: 0, done: 0 };
    agg.total++;
    if (o.done) agg.done++;
    dueByDay.set(o.windowEnd, agg);
  }

  const days: MemberStats['days'] = [];
  let successfulDays = 0;
  let missedReports = 0;
  let run = 0;
  let longest = 0;
  let current = 0;
  const lastDay = f.flowEnd;
  for (const date of eachDay(f.flowStart, lastDay)) {
    const due = dueByDay.get(date) ?? { total: 0, done: 0 };
    const hasReport = reports.has(date);
    const allDone = due.done === due.total;
    if (date > f.today) {
      days.push({ date, state: 'future' });
      continue;
    }
    if (date === f.today) {
      if (hasReport && allDone) {
        successfulDays++;
        run++;
        longest = Math.max(longest, run);
        current = run;
        days.push({ date, state: 'success' });
      } else {
        current = run; // сегодняшний день ещё не потерян
        days.push({ date, state: 'today' });
      }
      continue;
    }
    if (hasReport && allDone) {
      successfulDays++;
      run++;
      longest = Math.max(longest, run);
      days.push({ date, state: 'success' });
    } else {
      if (!hasReport) missedReports++;
      run = 0;
      days.push({ date, state: hasReport ? 'partial' : 'missed' });
    }
    current = run;
  }
  if (f.today > lastDay) current = run;

  return {
    completed,
    scheduled,
    ratio: scheduled === 0 ? 0 : completed / scheduled,
    successfulDays,
    missedReports,
    missedOccurrences,
    currentStreak: current,
    longestStreak: longest,
    perfectSoFar: missedReports === 0 && missedOccurrences === 0,
    days,
  };
}

/**
 * Идеальный результат после окончания потока: 100% всех обязательств (знаменатель = все выполнения месяца),
 * ни одного пропущенного отчёта и подтверждение достижения всех выбранных целей в итоговой анкете.
 */
export function isPerfect(f: MemberFacts, goalsAchieved: (boolean | null)[]): boolean {
  const after = addDays(f.flowEnd, 1);
  const stats = computeStats({ ...f, today: after > f.today ? after : f.today });
  return (
    f.occurrences.length > 0 &&
    stats.completed === f.occurrences.length &&
    stats.missedReports === 0 &&
    goalsAchieved.length > 0 &&
    goalsAchieved.every((a) => a === true)
  );
}

export interface RankInput {
  userId: string;
  ratio: number;
  /** Отчёты, сданные вовремя (в свой день) */
  reportDays?: number;
  successfulDays: number;
  longestStreak: number;
  /** ISO время подачи итоговой анкеты; раньше — выше. null — в конце */
  finalSubmittedAt?: string | null;
}

/**
 * Публичные правила сортировки (одинаковые для всех тарифов):
 * 1) процент выполненных запланированных действий; 2) больше отчётов, сданных вовремя (решение владельца 24.10);
 * 3) полностью закрытые дни; 4) самая длинная серия; 5) кто раньше подал итоговую анкету. Число целей и фото не учитываются.
 * Равные по всем критериям получают одинаковое место.
 */
export function rank<T extends RankInput>(rows: T[]): (T & { rank: number })[] {
  const key = (r: RankInput) => [-round6(r.ratio), -(r.reportDays ?? 0), -r.successfulDays, -r.longestStreak, r.finalSubmittedAt ?? '9999'] as const;
  const cmp = (a: RankInput, b: RankInput) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  };
  const sorted = [...rows].sort((a, b) => cmp(a, b) || a.userId.localeCompare(b.userId));
  let prev: T | null = null;
  let prevRank = 0;
  return sorted.map((r, i) => {
    const rnk = prev && cmp(prev, r) === 0 ? prevRank : i + 1;
    prev = r;
    prevRank = rnk;
    return { ...r, rank: rnk };
  });
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Сравнение с прошлым месяцем: в первом месяце база 0 и честная подпись «стартовая точка» */
export function compareWithPrevious(previousSuccessfulDays: number | null, currentSuccessfulDays: number) {
  const firstMonth = previousSuccessfulDays === null;
  const baseline = previousSuccessfulDays ?? 0;
  return { firstMonth, baseline, current: currentSuccessfulDays, delta: currentSuccessfulDays - baseline };
}
