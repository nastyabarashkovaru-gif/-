import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tgUser?: TelegramUser;
    }
  }
}

/**
 * Проверяет подпись initData, присланного Telegram Web App.
 * См. https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(initData: string, botToken: string): TelegramUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const pairs: string[] = [];
  params.forEach((value, key) => {
    pairs.push(`${key}=${value}`);
  });
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  const userJson = params.get('user');
  if (!userJson) return null;
  try {
    return JSON.parse(userJson) as TelegramUser;
  } catch {
    return null;
  }
}

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const DEV_MODE = process.env.DEV_MODE === 'true';

/**
 * Middleware: ожидает заголовок X-Telegram-Init-Data с сырой initData строкой
 * из window.Telegram.WebApp.initData на фронтенде.
 * В DEV_MODE (без initData) принимает заголовок X-Dev-User-Id для локальной разработки.
 */
export function requireTelegramAuth(req: Request, res: Response, next: NextFunction) {
  const initData = req.header('X-Telegram-Init-Data');

  if (initData && BOT_TOKEN) {
    const user = verifyInitData(initData, BOT_TOKEN);
    if (user) {
      req.tgUser = user;
      return next();
    }
    if (!DEV_MODE) {
      return res.status(401).json({ error: 'invalid_init_data' });
    }
  }

  if (DEV_MODE) {
    const devId = req.header('X-Dev-User-Id');
    if (devId) {
      req.tgUser = {
        id: Number(devId),
        username: req.header('X-Dev-Username') || `dev_${devId}`,
        first_name: req.header('X-Dev-First-Name') || 'Dev User',
      };
      return next();
    }
  }

  return res.status(401).json({ error: 'unauthorized', message: 'Missing or invalid Telegram init data' });
}
