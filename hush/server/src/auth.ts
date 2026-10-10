import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { pool } from './db';

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  allows_write_to_pm?: boolean;
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
    return user && typeof user.id === 'number' ? user : null;
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
    await pool.query(
      `INSERT INTO users (id, first_name, last_name, username, photo_url, allows_write)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
         username = EXCLUDED.username, photo_url = EXCLUDED.photo_url,
         allows_write = users.allows_write OR EXCLUDED.allows_write, updated_at = now()`,
      [user.id, user.first_name || 'Без имени', user.last_name ?? null, user.username ?? null, user.photo_url ?? null, Boolean(user.allows_write_to_pm)],
    );
    next();
  } catch (e) {
    next(e);
  }
}
