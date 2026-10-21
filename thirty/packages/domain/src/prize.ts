export interface PrizePoolFormula {
  /** Процент от подтверждённых поступлений за поток (0..100) */
  percentOfRevenue: number;
  /** Фиксированная добавка, ₽ */
  fixed: number;
  /** Потолок, ₽ (null — нет) */
  cap: number | null;
}

/** Фонд считается только из подтверждённых (paid, без возвратов) поступлений по формуле админа. Оборот ≠ фонд. */
export function prizePool(confirmedRevenue: number, f: PrizePoolFormula): number {
  const raw = Math.floor((confirmedRevenue * f.percentOfRevenue) / 100) + f.fixed;
  return Math.max(0, f.cap === null ? raw : Math.min(raw, f.cap));
}

export const MAX_PRIZE_PLACES = 3;

/**
 * Итог по проверенным (approved) претендентам, уже отсортированным объективным тай-брейком.
 * Больше трёх — места получают первые три по тай-брейку; случайная жеребьёвка не применяется без юридического одобрения.
 */
export function assignPlaces<T extends { userId: string }>(approvedSorted: T[]): { winners: (T & { place: number })[]; outcome: 'none' | 'winners' } {
  if (approvedSorted.length === 0) return { winners: [], outcome: 'none' };
  return {
    winners: approvedSorted.slice(0, MAX_PRIZE_PLACES).map((w, i) => ({ ...w, place: i + 1 })),
    outcome: 'winners',
  };
}
