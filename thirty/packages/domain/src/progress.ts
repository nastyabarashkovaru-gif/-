/**
 * Прогресс количественной цели между точками А и Б (решение владельца 24.10):
 * (текущее − А) / (Б − А) × 100%, ограничено 0–100. Работает и на рост, и на снижение показателя.
 */

/** Первое число в тексте: «58,5 кг» → 58.5, «1 000 подписчиков» → 1000, «100 000 ₽» → 100000 */
export function parseMetric(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.replace(/ /g, ' ').match(/-?\d{1,3}(?:[ ]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(/ /g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Единица измерения — текст после числа в точке Б: «57 кг» → «кг» */
export function metricUnit(text: string | null | undefined): string {
  if (!text) return '';
  const m = text.replace(/ /g, ' ').match(/-?\d{1,3}(?:[ ]\d{3})+(?:[.,]\d+)?|-?\d+(?:[.,]\d+)?/);
  if (!m) return '';
  return text.slice((m.index ?? 0) + m[0].length).trim().slice(0, 40);
}

/** Числовая цель: в обеих точках есть числа, и они различаются */
export function isNumericGoal(pointA: string | null | undefined, pointB: string | null | undefined): boolean {
  const a = parseMetric(pointA);
  const b = parseMetric(pointB);
  return a !== null && b !== null && a !== b;
}

export function goalProgressPercent(pointA: string | null | undefined, pointB: string | null | undefined, current: number | null | undefined): number | null {
  const a = parseMetric(pointA);
  const b = parseMetric(pointB);
  if (a === null || b === null || a === b || current === null || current === undefined) return null;
  const pct = ((current - a) / (b - a)) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)));
}

export function formatMetric(value: number, unit: string): string {
  const s = Number.isInteger(value) ? value.toLocaleString('ru-RU') : value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return unit ? `${s} ${unit}` : s;
}
