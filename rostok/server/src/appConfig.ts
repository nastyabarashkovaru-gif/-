import { DEFAULT_LEVEL_CURVE, type LevelCurve } from '@rostok/shared';
import { pool, q, type Db } from './db.js';

let cache: { at: number; values: Record<string, any>; curve: LevelCurve } | null = null;
const TTL = 15_000;

export async function loadConfig(force = false) {
  if (!force && cache && Date.now() - cache.at < TTL) return cache;
  const rows = await q<{ key: string; value: any }>(pool, 'SELECT key, value FROM app_config');
  const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const levels = await q<{ cost: number }>(pool, 'SELECT cost FROM tree_level_config ORDER BY from_level');
  const curve: LevelCurve = {
    table: levels.length ? levels.map((l) => l.cost) : DEFAULT_LEVEL_CURVE.table,
    tail: values.level_curve_tail ?? DEFAULT_LEVEL_CURVE.tail,
  };
  cache = { at: Date.now(), values, curve };
  return cache;
}
export const invalidateConfig = () => { cache = null; };
export const getCurve = async () => (await loadConfig()).curve;
export const getValue = async <T = any>(key: string): Promise<T> => (await loadConfig()).values[key];

/** Кривая внутри транзакции полива читается свежей, чтобы цена была актуальной. */
export async function curveFresh(db: Db): Promise<LevelCurve> {
  const levels = await q<{ cost: number }>(db, 'SELECT cost FROM tree_level_config ORDER BY from_level');
  const tail = (await q<{ value: any }>(db, `SELECT value FROM app_config WHERE key='level_curve_tail'`))[0]?.value;
  return { table: levels.length ? levels.map((l) => l.cost) : DEFAULT_LEVEL_CURVE.table, tail: tail ?? DEFAULT_LEVEL_CURVE.tail };
}
