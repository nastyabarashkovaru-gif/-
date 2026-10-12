import { SPHERES, DEFAULT_LEVEL_CURVE } from '@rostok/shared';
import { pool, q } from './db.js';
import { DEFAULT_ASSET_MANIFEST, DEFAULT_BRAND, DEFAULT_FLAGS, DEFAULT_NOTIFICATION_TEXTS, DEFAULT_ONBOARDING, DEFAULT_PAYWALL, DEFAULT_PLANS } from './content.js';

/** Идемпотентный сид справочников. Не перезаписывает значения, изменённые в админке. */
export async function seed() {
  for (const s of SPHERES) {
    await pool.query(
      `INSERT INTO spheres(id,name,species,sort) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, species=EXCLUDED.species, sort=EXCLUDED.sort`,
      [s.id, s.name, s.species, s.sort],
    );
  }
  const [{ n }] = await q<{ n: number }>(pool, 'SELECT count(*)::int AS n FROM tree_level_config');
  if (n === 0) {
    for (let i = 0; i < DEFAULT_LEVEL_CURVE.table.length; i++) {
      await pool.query('INSERT INTO tree_level_config(from_level,cost) VALUES ($1,$2)', [i + 1, DEFAULT_LEVEL_CURVE.table[i]]);
    }
  }
  const defaults: Record<string, unknown> = {
    level_curve_tail: DEFAULT_LEVEL_CURVE.tail,
    brand: DEFAULT_BRAND,
    onboarding: DEFAULT_ONBOARDING,
    paywall: DEFAULT_PAYWALL,
    notification_texts: DEFAULT_NOTIFICATION_TEXTS,
    flags: DEFAULT_FLAGS,
    asset_manifest: DEFAULT_ASSET_MANIFEST,
  };
  for (const [key, value] of Object.entries(defaults)) {
    await pool.query('INSERT INTO app_config(key,value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [key, JSON.stringify(value)]);
  }
  for (const p of DEFAULT_PLANS) {
    await pool.query(
      `INSERT INTO subscription_plans(id,title,subtitle,kind,period_days,price_stars,display_price_rub,eligibility,is_active,sort,terms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
      [p.id, p.title, p.subtitle, p.kind, p.period_days, p.price_stars, p.display_price_rub, p.eligibility, p.is_active, p.sort, p.terms],
    );
  }
}
