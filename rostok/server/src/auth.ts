import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isValidTimezone } from '@rostok/shared';
import { config } from './config.js';
import { clock } from './clock.js';
import { one, pool, tx, type Db } from './db.js';
import { AppError } from './errors.js';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

/**
 * Проверка подписи Telegram initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 * secret = HMAC_SHA256("WebAppData", bot_token); hash = HMAC_SHA256(secret, data_check_string).
 */
export function verifyInitData(initData: string, botToken: string, nowSec: number, ttlSec: number): TelegramUser {
  if (!botToken) throw new AppError(503, 'auth_unavailable', 'Вход через Telegram не настроен');
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new AppError(401, 'bad_init_data', 'Нет подписи Telegram');
  params.delete('hash');
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = createHmac('sha256', secret).update(dataCheck).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== calc.length || !timingSafeEqual(given, calc)) throw new AppError(401, 'bad_init_data', 'Подпись Telegram не прошла проверку');
  const authDate = Number(params.get('auth_date'));
  if (!authDate || nowSec - authDate > ttlSec || authDate - nowSec > 300) throw new AppError(401, 'init_data_expired', 'Сессия Telegram устарела, открой приложение заново');
  const user = JSON.parse(params.get('user') || 'null') as TelegramUser | null;
  if (!user?.id) throw new AppError(401, 'bad_init_data', 'Нет данных пользователя');
  return user;
}

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

async function createSession(db: Db, userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(clock.now().getTime() + config.sessionDays * 86400_000);
  await db.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,$3)', [hashToken(token), userId, expires]);
  return token;
}

export async function ensureUserRows(db: Db, userId: number) {
  await db.query('INSERT INTO user_settings(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  await db.query('INSERT INTO onboarding_progress(user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  await db.query(
    `INSERT INTO trees(user_id, sphere_id) SELECT $1, id FROM spheres ON CONFLICT (user_id, sphere_id) DO NOTHING`,
    [userId],
  );
}

export async function loginTelegram(initData: string, timezone?: string) {
  const tg = verifyInitData(initData, config.botToken, Math.floor(clock.now().getTime() / 1000), config.initDataTtl);
  return tx(async (c) => {
    const tz = timezone && isValidTimezone(timezone) ? timezone : null;
    const u = await one<{ id: number }>(
      c,
      `INSERT INTO users(telegram_id, first_name, last_name, username, photo_url, language_code, timezone, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'Europe/Moscow'),now())
       ON CONFLICT (telegram_id) DO UPDATE SET first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name,
         username=EXCLUDED.username, photo_url=EXCLUDED.photo_url, language_code=EXCLUDED.language_code, last_seen_at=now()
       RETURNING id`,
      [tg.id, tg.first_name ?? null, tg.last_name ?? null, tg.username ?? null, tg.photo_url ?? null, tg.language_code ?? null, tz],
    );
    await ensureUserRows(c, u!.id);
    if (tz) await updateTimezone(c, u!.id, tz);
    return { token: await createSession(c, u!.id), userId: u!.id };
  });
}

/** Демо-вход для браузера (только APP_ENV != production): отдельный пользователь на устройство. */
export async function loginDemo(deviceId: string, timezone?: string, name?: string) {
  if (!config.demoLogin) throw new AppError(403, 'demo_disabled', 'Демо-вход отключён');
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(deviceId)) throw new AppError(400, 'bad_device', 'Некорректный идентификатор устройства');
  // Демо-пользователи получают отрицательный псевдо-telegram_id, чтобы не пересекаться с реальными
  const pseudoId = -Number(BigInt('0x' + hashToken('demo:' + deviceId).slice(0, 12)));
  const tz = timezone && isValidTimezone(timezone) ? timezone : 'Europe/Moscow';
  return tx(async (c) => {
    const u = await one<{ id: number }>(
      c,
      `INSERT INTO users(telegram_id, is_demo, first_name, timezone, last_seen_at) VALUES ($1,true,$2,$3,now())
       ON CONFLICT (telegram_id) DO UPDATE SET last_seen_at=now() RETURNING id`,
      [pseudoId, (name || 'Гость').slice(0, 40), tz],
    );
    await ensureUserRows(c, u!.id);
    await updateTimezone(c, u!.id, tz);
    return { token: await createSession(c, u!.id), userId: u!.id };
  });
}

/** Смена таймзоны: не чаще раза в 6 часов. Повторных начислений не будет — уникальность по логическим периодам. */
export async function updateTimezone(db: Db, userId: number, tz: string) {
  if (!isValidTimezone(tz)) return;
  await db.query(
    `UPDATE users SET timezone=$2, timezone_changed_at=now()
     WHERE id=$1 AND timezone<>$2 AND (timezone_changed_at IS NULL OR timezone_changed_at < now() - interval '6 hours')`,
    [userId, tz],
  );
}

export async function userFromToken(token: string | undefined) {
  if (!token) return null;
  return one<{ id: number; timezone: string; is_demo: boolean }>(
    pool,
    `SELECT u.id, u.timezone, u.is_demo FROM sessions s JOIN users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expires_at > now() AND u.deleted_at IS NULL`,
    [hashToken(token)],
  );
}
