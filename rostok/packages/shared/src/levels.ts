/**
 * Кривая стоимости полива. Хранится на сервере (app_config.level_curve), меняется без миграций.
 * table[i] — стоимость перехода с уровня i+1 на i+2. После таблицы — плавный рост к мягкому потолку.
 */
export interface LevelCurve {
  table: number[];
  tail: { ceiling: number; rate: number };
}

export const DEFAULT_LEVEL_CURVE: LevelCurve = {
  table: [1, 2, 3, 4, 5, 7, 9, 12, 15, 20, 25, 30, 35, 40, 45, 50],
  tail: { ceiling: 90, rate: 0.08 },
};

/** Стоимость полива, переводящего дерево с уровня `level` на `level + 1`. */
export function wateringCost(level: number, curve: LevelCurve = DEFAULT_LEVEL_CURVE): number {
  if (!Number.isInteger(level) || level < 1) throw new Error('level must be a positive integer');
  const t = curve.table;
  if (level - 1 < t.length) return t[level - 1];
  const last = t[t.length - 1];
  const n = level - t.length;
  const { ceiling, rate } = curve.tail;
  return Math.max(last, Math.round(last + (ceiling - last) * (1 - Math.exp(-rate * n))));
}

export function validateLevelCurve(c: unknown): c is LevelCurve {
  const v = c as LevelCurve;
  if (!v || !Array.isArray(v.table) || v.table.length < 1 || v.table.length > 200) return false;
  if (!v.table.every((x) => Number.isInteger(x) && x >= 1 && x <= 500)) return false;
  for (let i = 1; i < v.table.length; i++) if (v.table[i] < v.table[i - 1]) return false;
  if (!v.tail || !Number.isInteger(v.tail.ceiling) || v.tail.ceiling < v.table[v.table.length - 1] || v.tail.ceiling > 500) return false;
  if (typeof v.tail.rate !== 'number' || v.tail.rate <= 0 || v.tail.rate > 1) return false;
  return true;
}

/**
 * Уровень сада считается из суммарно потраченных на полив капель (cumulative_spent_drops).
 * Уровень n требует 5·n·(n−1) капель: 2 → 10, 3 → 30, 4 → 60, 5 → 100 …
 * Штрафы не уменьшают потраченные капли, поэтому уровень сада никогда не падает.
 */
export function gardenLevel(totalSpent: number): number {
  const s = Math.max(0, Math.floor(totalSpent));
  let n = Math.floor((1 + Math.sqrt(1 + 0.8 * s)) / 2);
  while (gardenThreshold(n + 1) <= s) n++;
  while (n > 1 && gardenThreshold(n) > s) n--;
  return Math.max(1, n);
}
export const gardenThreshold = (level: number) => 5 * level * (level - 1);

/** Декор острова, открывающийся на общих порогах уровня сада (без отдельных валют). */
export const ISLAND_DECOR: { level: number; id: string; name: string }[] = [
  { level: 2, id: 'flowers', name: 'Полевые цветы' },
  { level: 3, id: 'stones', name: 'Тропинка из камней' },
  { level: 5, id: 'pond', name: 'Маленький пруд' },
  { level: 7, id: 'mushrooms', name: 'Грибная полянка' },
  { level: 9, id: 'lanterns', name: 'Фонарики' },
  { level: 12, id: 'bench', name: 'Скамейка' },
  { level: 15, id: 'butterflies', name: 'Бабочки' },
];
export const decorForGardenLevel = (lvl: number) => ISLAND_DECOR.filter((d) => d.level <= lvl).map((d) => d.id);
