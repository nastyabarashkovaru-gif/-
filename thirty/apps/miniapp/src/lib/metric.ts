/** Число с единицей измерения: 58.5, «кг» → «58,5 кг» */
export function formatMetric(value: number, unit: string): string {
  const s = Number.isInteger(value) ? value.toLocaleString('ru-RU') : value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  return unit ? `${s} ${unit}` : s;
}

/** «58,5» → 58.5; пусто или не число → null */
export function parseNumber(text: string): number | null {
  const t = text.replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
