import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { pool } from './db';
import { isBloggerParam, markBlogger } from './blogger';

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  allows_write_to_pm?: boolean;
  /** start_param из подписанного initData (по какой ссылке открыли приложение) */
  start_param?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: TgUser;
    }
  }
}

const secretKey = createHmac('sha256', 'WebAppData').update(config.botToken).digest();

/**
 * Проверка подписи Telegram initData:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(initData: string, now = Date.now()): TgUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || now / 1000 - authDate > config.initDataMaxAgeSec) return null;

  try {
    const user = JSON.parse(params.get('user') || 'null') as TgUser | null;
    if (!user || typeof user.id !== 'number') return null;
    const startParam = params.get('start_param');
    if (startParam) user.start_param = startParam.slice(0, 64);
    return user;
  } catch {
    return null;
  }
}

export async function requireTelegram(req: Request, res: Response, next: NextFunction) {
  const header = req.get('authorization') || '';
  const initData = header.startsWith('tma ') ? header.slice(4) : '';
  const user = initData ? validateInitData(initData) : null;
  if (!user) {
    res.status(401).json({ code: 'unauthorized' });
    return;
  }
  req.user = user;
  try {
    const { rows } = await pool.query<{ inserted: boolean }>(
      `INSERT INTO users (id, first_name, last_name, username, photo_url, allows_write)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
         username = EXCLUDED.username, photo_url = EXCLUDED.photo_url,
         allows_write = users.allows_write OR EXCLUDED.allows_write, updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [user.id, user.first_name || 'Без имени', user.last_name ?? null, user.username ?? null, user.photo_url ?? null, Boolean(user.allows_write_to_pm)],
    );
    // Новый пользователь — запоминаем, откуда пришёл и кто привёл (для статистики блогеров)
    if (rows[0]?.inserted && user.start_param) await recordReferral(user.id, user.start_param).catch(() => {});
    // Блогерская ссылка — помечаем и новых, и уже зарегистрированных (один раз)
    if (isBloggerParam(user.start_param)) await markBlogger(user.id, user.start_param as string).catch(() => {});
    next();
  } catch (e) {
    next(e);
  }
}

/** Источник привлечения: start_param первого входа и владелец ссылки, по которой пришёл */
async function recordReferral(userId: number, startParam: string): Promise<void> {
  let owner: string | null = null;
  if (startParam.startsWith('u_')) {
    owner = (await pool.query('SELECT id FROM users WHERE ask_slug = $1', [startParam.slice(2)])).rows[0]?.id ?? null;
  } else if (startParam.startsWith('a_')) {
    owner = (await pool.query('SELECT owner_id AS id FROM asks WHERE id = $1', [startParam.slice(2)])).rows[0]?.id ?? null;
  } else if (/^[A-Z2-9]{8}$/.test(startParam)) {
    owner = (await pool.query('SELECT owner_id AS id FROM questionnaires WHERE id = $1', [startParam])).rows[0]?.id ?? null;
  }
  await pool.query('UPDATE users SET ref_source = $2, referred_by = $3 WHERE id = $1 AND ref_source IS NULL', [
    userId,
    startParam,
    owner && Number(owner) !== userId ? owner : null,
  ]);
}
