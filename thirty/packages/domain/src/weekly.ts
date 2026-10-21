import { addDays, type ISODate } from './dates';

export const CARD_DAYS = [7, 14, 21, 28] as const;

/**
 * Карточка недели k (1..4): дни [start + 7(k−1), start + 7k − 1]; сравнение с предыдущими 7 днями
 * (для первой недели база 0). k = 5 — итоговая карточка за весь поток.
 */
export function weekCardStats(params: {
  flowStart: ISODate;
  flowEnd: ISODate;
  week: number;
  successfulDates: ISODate[];
  completedByDate: Record<ISODate, number>;
}) {
  const { flowStart, flowEnd, week } = params;
  const success = new Set(params.successfulDates);
  const range = (from: ISODate, to: ISODate) => {
    let days = 0;
    let completed = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (success.has(d)) days++;
      completed += params.completedByDate[d] ?? 0;
    }
    return { successfulDays: days, completed };
  };
  if (week === 5) {
    const total = range(flowStart, flowEnd);
    return { from: flowStart, to: flowEnd, ...total, previous: null, delta: null };
  }
  const from = addDays(flowStart, 7 * (week - 1));
  const to = addDays(from, 6) > flowEnd ? flowEnd : addDays(from, 6);
  const cur = range(from, to);
  const previous = week === 1 ? { successfulDays: 0, completed: 0 } : range(addDays(from, -7), addDays(from, -1));
  return { from, to, ...cur, previous, delta: cur.successfulDays - previous.successfulDays };
}

/** Какая карточка положена в день потока (номер дня с 1) */
export function cardForFlowDay(dayNumber: number): number | null {
  const idx = (CARD_DAYS as readonly number[]).indexOf(dayNumber);
  return idx === -1 ? null : idx + 1;
}
