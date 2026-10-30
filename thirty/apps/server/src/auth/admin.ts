import { createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminRole, AdminUser } from '@prisma/client';
import { config, isProd } from '../config';
import { prisma } from '../db';
import { HttpError } from '../http';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, saltHex, hashHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

// ───────────── TOTP (RFC 6238, SHA-1, 30 c, 6 цифр) — совместимо с Google Authenticator ─────────────

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret: string, time = Date.now(), step = 30): string {
  const counter = Math.floor(time / 1000 / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const offset = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}

export function verifyTotp(secret: string, code: string, time = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((w) => totp(secret, time + w * 30_000) === code);
}

export function newTotpSecret() {
  return base32Encode(randomBytes(20));
}

// ───────────── Сессия ─────────────

const COOKIE = 'thirty_admin';
const CSRF_COOKIE = 'thirty_csrf';
const SESSION_TTL_SEC = 12 * 3600;

interface SessionPayload {
  sub: string;
  role: AdminRole;
  /** 2FA пройдена (или не требуется) */
  mfa: boolean;
  exp: number;
  csrf: string;
}

function sign(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', config.ADMIN_JWT_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token: string): SessionPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', config.ADMIN_JWT_SECRET).update(body).digest('base64url');
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload;
    return p.exp * 1000 > Date.now() ? p : null;
  } catch {
    return null;
  }
}

export function issueSession(reply: FastifyReply, admin: AdminUser, mfa: boolean) {
  const csrf = randomBytes(16).toString('hex');
  const token = sign({ sub: admin.id, role: admin.role, mfa, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC, csrf });
  const base = { path: '/', sameSite: 'strict' as const, secure: isProd, maxAge: SESSION_TTL_SEC };
  reply.setCookie(COOKIE, token, { ...base, httpOnly: true });
  reply.setCookie(CSRF_COOKIE, csrf, { ...base, httpOnly: false });
  return { csrf };
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AdminUser;
    adminSession?: SessionPayload;
  }
}

/** Роли → разрешения (RBAC) */
export const PERMISSIONS = {
  dashboard: ['owner', 'admin', 'analyst', 'support', 'moderator'],
  analytics: ['owner', 'admin', 'analyst'],
  tariffs: ['owner', 'admin'],
  payments: ['owner', 'admin', 'support'],
  refunds: ['owner', 'admin'],
  flows: ['owner', 'admin'],
  users: ['owner', 'admin', 'support', 'moderator'],
  usersEdit: ['owner', 'admin'],
  moderation: ['owner', 'admin', 'moderator'],
  rating: ['owner', 'admin', 'moderator', 'analyst'],
  prizes: ['owner', 'admin', 'moderator'],
  buddy: ['owner', 'admin', 'moderator', 'support'],
  chats: ['owner', 'admin'],
  meetings: ['owner', 'admin', 'expert'],
  reviews: ['owner', 'admin', 'moderator', 'analyst'],
  bot: ['owner', 'admin'],
  upsells: ['owner', 'admin'],
  settings: ['owner', 'admin'],
  roles: ['owner'],
  audit: ['owner', 'admin'],
  experiments: ['owner', 'admin', 'analyst'],
  export: ['owner', 'admin', 'analyst'],
} satisfies Record<string, AdminRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: AdminRole, perm: Permission) {
  return (PERMISSIONS[perm] as AdminRole[]).includes(role);
}

/** Требуется 2FA для owner/admin (обязательно по ТЗ) и для остальных, если она включена */
/** Вход по логину и паролю, без кода из приложения-аутентификатора (решение владельца 30.10: доступ для сотрудников) */
export function mfaRequired(_admin: AdminUser) {
  return false;
}

export async function requireAdmin(req: FastifyRequest) {
  const token = req.cookies?.[COOKIE];
  const session = token ? verify(token) : null;
  if (!session) throw new HttpError(401, 'admin_unauthorized');
  const admin = await prisma.adminUser.findUnique({ where: { id: session.sub } });
  if (!admin || !admin.active) throw new HttpError(401, 'admin_unauthorized');
  if (!session.mfa) throw new HttpError(401, 'mfa_required');
  // CSRF: для изменяющих запросов заголовок должен совпасть с токеном сессии
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const header = req.headers['x-csrf-token'];
    if (typeof header !== 'string' || header !== session.csrf) throw new HttpError(403, 'csrf');
  }
  req.admin = admin;
  req.adminSession = session;
}

export function readSession(req: FastifyRequest): SessionPayload | null {
  const token = req.cookies?.[COOKIE];
  return token ? verify(token) : null;
}

export function requirePerm(perm: Permission) {
  return async (req: FastifyRequest) => {
    if (!req.admin || !can(req.admin.role, perm)) throw new HttpError(403, 'forbidden', 'Недостаточно прав');
  };
}

export async function audit(req: FastifyRequest, action: string, entity: string, entityId: string | null, data: { before?: unknown; after?: unknown; reason?: string } = {}) {
  const ser = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x))));
  await prisma.auditLog.create({
    data: { adminId: req.admin?.id ?? null, action, entity, entityId, before: ser(data.before), after: ser(data.after), reason: data.reason, ip: req.ip },
  });
}
