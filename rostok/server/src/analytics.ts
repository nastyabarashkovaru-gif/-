import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { pool } from './db.js';

/** События, которые может присылать клиент (остальные — только сервер). */
export const CLIENT_EVENTS = new Set([
  'app_open', 'onboarding_slide_view', 'tutorial_start', 'tutorial_step', 'tutorial_watering', 'tutorial_complete',
  'spheres_selected', 'paywall_view', 'checkout_start', 'subscription_cancel_attempt', 'challenge_demo_view',
]);

/** Серверное событие. Ключ дедупликации делает запись идемпотентной. Содержимое привычек сюда не пишем. */
export async function track(db: Db, userId: number | null, name: string, props: Record<string, unknown> = {}, dedupeId?: string) {
  const id = dedupeId ? uuidFromKey(dedupeId) : randomUUID();
  await db.query(
    `INSERT INTO analytics_events(id,user_id,name,props,source) VALUES ($1,$2,$3,$4,'server') ON CONFLICT (id) DO NOTHING`,
    [id, userId, name, props],
  );
}

export async function trackClient(userId: number, id: string, name: string, props: Record<string, unknown>) {
  if (!CLIENT_EVENTS.has(name)) return false;
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props ?? {}).slice(0, 10)) {
    if (['string', 'number', 'boolean'].includes(typeof v)) safe[k] = typeof v === 'string' ? v.slice(0, 64) : v;
  }
  await pool.query(
    `INSERT INTO analytics_events(id,user_id,name,props,source) VALUES ($1,$2,$3,$4,'client') ON CONFLICT (id) DO NOTHING`,
    [id, userId, name, safe],
  );
  return true;
}

import { createHash } from 'node:crypto';
function uuidFromKey(key: string): string {
  const h = createHash('sha256').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
