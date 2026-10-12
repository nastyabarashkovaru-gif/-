
import { pool, migrate, one } from '../src/db.js';
import { seed } from '../src/seed.js';
import { ensureUserRows } from '../src/auth.js';
import { clock } from '../src/clock.js';
import { invalidateConfig } from '../src/appConfig.js';
import { checkout, mockConfirm } from '../src/services/subscription.js';

export async function resetDb() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  invalidateConfig();
  await migrate();
  await seed();
}

let tg = 1000;
export async function makeUser(tz = 'Europe/Moscow', paid = true) {
  const u = (await one<{ id: number }>(pool, 'INSERT INTO users(telegram_id, first_name, timezone) VALUES ($1,$2,$3) RETURNING id', [++tg, `U${tg}`, tz]))!;
  await ensureUserRows(pool, u.id);
  if (paid) {
    const c = await checkout(u.id, 'month');
    await mockConfirm(u.id, c.intentId);
  }
  return u.id;
}

/** Установить серверное время: локальная дата/время в таймзоне Москвы (UTC+3). */
export const at = (iso: string) => clock.set(new Date(iso));

export const tree = (userId: number, sphere: string) =>
  one<any>(pool, 'SELECT * FROM trees WHERE user_id=$1 AND sphere_id=$2', [userId, sphere]);

export async function giveDrops(userId: number, sphere: string, n: number) {
  await pool.query('UPDATE trees SET available_drops=available_drops+$3 WHERE user_id=$1 AND sphere_id=$2', [userId, sphere, n]);
}

export { pool, clock };
