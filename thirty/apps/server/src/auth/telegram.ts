import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../db';
import { HttpError } from '../http';

export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  allows_write_to_pm?: boolean;
}

export interface InitData {
  user: TgUser;
  startParam?: string;
  authDate: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    tg?: InitData;
    user?: User;
  }
}

/**
 * Проверка подписи initData по документации Telegram:
 * secret = HMAC_SHA256(key="WebAppData", msg=bot_token); hash = HMAC_SHA256(secret, data_check_string)
 */
export function validateInitData(initData: string, botToken: string, now = Date.now(), maxAgeSec = config.INIT_DATA_MAX_AGE_SEC): InitData | null {
  if (!botToken || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expected = createHmac('sha256', secret).update(dataCheckString).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const authDate = Number(params.get('auth_date'));
  if (!authDate || now / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get('user') ?? 'null') as TgUser | null;
    if (!user || typeof user.id !== 'number') return null;
    const sp = params.get('start_param');
    return { user, authDate, startParam: sp && /^[A-Za-z0-9_-]{1,512}$/.test(sp) ? sp : undefined };
  } catch {
    return null;
  }
}

/** Подписать initData (для тестов и dev) */
export function signInitData(user: TgUser, botToken: string, opts: { authDate?: number; startParam?: string } = {}): string {
  const params = new URLSearchParams();
  params.set('auth_date', String(opts.authDate ?? Math.floor(Date.now() / 1000)));
  params.set('query_id', 'AAH-test');
  params.set('user', JSON.stringify(user));
  if (opts.startParam) params.set('start_param', opts.startParam);
  const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

function readInitData(req: FastifyRequest): InitData | null {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('tma ')) return validateInitData(header.slice(4), config.BOT_TOKEN);
  if (config.DEV_AUTH) {
    // В демо-версии вход без Telegram только с ключом владельца
    if (config.DEMO_MODE && req.headers['x-demo-key'] !== config.DEMO_KEY) return null;
    const dev = req.headers['x-dev-user'];
    if (typeof dev === 'string' && /^\d{1,15}$/.test(dev)) {
      return { user: { id: Number(dev), first_name: `Тест ${dev}`, allows_write_to_pm: true }, authDate: Date.now() / 1000 };
    }
  }
  return null;
}

/** preHandler: проверка Telegram и upsert пользователя. user_id с клиента не принимается — только из подписи. */
export async function requireUser(req: FastifyRequest, _reply: FastifyReply) {
  const tg = readInitData(req);
  if (!tg) throw new HttpError(401, 'unauthorized');
  req.tg = tg;
  const u = tg.user;
  const user = await prisma.user.upsert({
    where: { id: BigInt(u.id) },
    create: {
      id: BigInt(u.id),
      firstName: (u.first_name || 'Участник').slice(0, 64),
      lastName: u.last_name?.slice(0, 64),
      username: u.username?.slice(0, 64),
      photoUrl: u.photo_url?.slice(0, 512),
      allowsWrite: Boolean(u.allows_write_to_pm),
    },
    update: {
      firstName: (u.first_name || 'Участник').slice(0, 64),
      lastName: u.last_name?.slice(0, 64) ?? null,
      username: u.username?.slice(0, 64) ?? null,
      photoUrl: u.photo_url?.slice(0, 512) ?? null,
      ...(u.allows_write_to_pm ? { allowsWrite: true } : {}),
    },
  });
  if (user.deletedAt) throw new HttpError(403, 'account_deleted');
  req.user = user;
  // Подписанный start_param (t.me/...?startapp=) или параметр из URL кнопки web_app (только для учёта кликов)
  const urlParam = req.headers['x-start-param'];
  const sp = tg.startParam ?? (typeof urlParam === 'string' && /^m_[0-9a-f]{32}_[a-z_]{1,24}$/.test(urlParam) ? urlParam : undefined);
  if (sp && req.method === 'GET' && req.url.startsWith('/api/me')) {
    const { handleStartParam } = await import('../modules/entry');
    await handleStartParam(user, sp).catch((e) => console.warn('[entry]', (e as Error).message));
  }
}
