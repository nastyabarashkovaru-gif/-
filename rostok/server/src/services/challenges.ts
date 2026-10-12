import { randomBytes } from 'node:crypto';
import { isSphereId } from '@rostok/shared';
import { clock } from '../clock.js';
import { config } from '../config.js';
import { one, pool, q, tx } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../errors.js';
import { track } from '../analytics.js';
import { hashToken } from '../auth.js';

const INVITE_TTL_DAYS = 7;

export function inviteLink(token: string) {
  const param = `ch_${token}`;
  if (config.botUsername && config.appShortName) return `https://t.me/${config.botUsername}/${config.appShortName}?startapp=${param}`;
  if (config.botUsername) return `https://t.me/${config.botUsername}?startapp=${param}`;
  return `${config.publicUrl}/?startapp=${param}`;
}

async function assertBinding(userId: number, taskId?: number | null, sphereId?: string | null) {
  if (taskId) {
    const t = await one(pool, 'SELECT 1 FROM tasks WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL', [taskId, userId]);
    if (!t) throw badRequest('Задача не найдена');
    return { taskId, sphereId: null };
  }
  if (sphereId) {
    if (!isSphereId(sphereId)) throw badRequest('Неизвестная сфера');
    return { taskId: null, sphereId };
  }
  throw badRequest('Выбери задачу или сферу, выполнения которой будут считаться');
}

export async function createChallenge(userId: number, p: { title: string; goal: number; endsOn?: string | null; taskId?: number | null; sphereId?: string | null }) {
  const title = (p.title ?? '').trim();
  if (!title || title.length > 60) throw badRequest('Назови челлендж (до 60 символов)', 'validation');
  if (!Number.isInteger(p.goal) || p.goal < 1 || p.goal > 1000) throw badRequest('Цель — от 1 до 1000 выполнений', 'validation');
  if (p.endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(p.endsOn)) throw badRequest('Некорректная дата', 'validation');
  const b = await assertBinding(userId, p.taskId, p.sphereId);
  const id = await tx(async (c) => {
    const ch = (await one<{ id: number }>(c, 'INSERT INTO challenges(owner_id,title,goal,ends_on) VALUES ($1,$2,$3,$4) RETURNING id', [userId, title, p.goal, p.endsOn || null]))!;
    await c.query('INSERT INTO challenge_participants(challenge_id,user_id,task_id,sphere_id) VALUES ($1,$2,$3,$4)', [ch.id, userId, b.taskId, b.sphereId]);
    return ch.id;
  });
  return { id };
}

export async function createInvite(userId: number, challengeId: number) {
  const ch = await one<any>(pool, 'SELECT * FROM challenges WHERE id=$1 AND status=$2', [challengeId, 'active']);
  if (!ch) throw notFound('Челлендж не найден');
  if (!(await one(pool, 'SELECT 1 FROM challenge_participants WHERE challenge_id=$1 AND user_id=$2', [challengeId, userId]))) throw new AppError(403, 'forbidden', 'Нет доступа');
  const [{ n }] = await q<{ n: number }>(pool, 'SELECT count(*)::int AS n FROM challenge_participants WHERE challenge_id=$1', [challengeId]);
  if (n >= ch.max_participants) throw conflict('В челлендже уже все участники', 'challenge_full');
  const recent = await one<{ n: number }>(pool, `SELECT count(*)::int AS n FROM challenge_invites WHERE created_by=$1 AND created_at > now() - interval '1 hour'`, [userId]);
  if (recent!.n >= 20) throw new AppError(429, 'rate_limited', 'Слишком много приглашений, попробуй позже');
  const token = randomBytes(18).toString('base64url');
  await pool.query(
    `INSERT INTO challenge_invites(challenge_id, token_hash, created_by, expires_at) VALUES ($1,$2,$3,$4)`,
    [challengeId, hashToken(token), userId, new Date(clock.now().getTime() + INVITE_TTL_DAYS * 86400_000)],
  );
  await track(pool, userId, 'challenge_invited', {});
  return { token, link: inviteLink(token), expiresInDays: INVITE_TTL_DAYS };
}

async function inviteByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) throw notFound('Приглашение не найдено');
  return one<any>(
    pool,
    `SELECT i.*, c.title, c.goal, c.ends_on, c.max_participants, c.status AS ch_status, u.first_name AS owner_name
     FROM challenge_invites i JOIN challenges c ON c.id=i.challenge_id JOIN users u ON u.id=c.owner_id WHERE i.token_hash=$1`,
    [hashToken(token)],
  );
}

export async function previewInvite(token: string) {
  const i = await inviteByToken(token);
  if (!i || i.used_at || i.expires_at < clock.now() || i.ch_status !== 'active') throw notFound('Приглашение недействительно или уже использовано');
  return { title: i.title, goal: i.goal, endsOn: i.ends_on, ownerName: i.owner_name ?? 'Друг' };
}

export async function joinChallenge(userId: number, token: string, binding: { taskId?: number | null; sphereId?: string | null }) {
  const i = await inviteByToken(token);
  if (!i || i.used_at || i.expires_at < clock.now() || i.ch_status !== 'active') throw notFound('Приглашение недействительно или уже использовано');
  const b = await assertBinding(userId, binding.taskId, binding.sphereId);
  await tx(async (c) => {
    const inv = await one<any>(c, 'SELECT * FROM challenge_invites WHERE id=$1 FOR UPDATE', [i.id]);
    if (inv.used_at) throw notFound('Приглашение уже использовано');
    await c.query('SELECT id FROM challenges WHERE id=$1 FOR UPDATE', [i.challenge_id]);
    if (await one(c, 'SELECT 1 FROM challenge_participants WHERE challenge_id=$1 AND user_id=$2', [i.challenge_id, userId])) throw conflict('Ты уже участвуешь', 'already_joined');
    const [{ n }] = await q<{ n: number }>(c, 'SELECT count(*)::int AS n FROM challenge_participants WHERE challenge_id=$1', [i.challenge_id]);
    if (n >= i.max_participants) throw conflict('В челлендже уже все участники', 'challenge_full');
    await c.query('INSERT INTO challenge_participants(challenge_id,user_id,task_id,sphere_id) VALUES ($1,$2,$3,$4)', [i.challenge_id, userId, b.taskId, b.sphereId]);
    await c.query('UPDATE challenge_invites SET used_by=$2, used_at=now() WHERE id=$1', [i.id, userId]);
    await track(c, userId, 'challenge_joined', {}, `challenge_joined:${i.challenge_id}:${userId}`);
  });
  return { challengeId: i.challenge_id };
}

/** Прогресс — только подтверждённые сервером выполнения после вступления (и до даты окончания). */
export async function listChallenges(userId: number) {
  const rows = await q<any>(
    pool,
    `SELECT c.* FROM challenges c JOIN challenge_participants p ON p.challenge_id=c.id
     WHERE p.user_id=$1 AND c.status <> 'deleted' ORDER BY c.created_at DESC`,
    [userId],
  );
  const out = [];
  for (const ch of rows) {
    const parts = await q<any>(
      pool,
      `SELECT p.user_id, p.task_id, p.sphere_id, p.joined_at, u.first_name,
         (SELECT count(*)::int FROM task_completions tc
           WHERE tc.user_id=p.user_id AND tc.created_at >= p.joined_at
             AND ($2::date IS NULL OR tc.local_date <= $2::date)
             AND ((p.task_id IS NOT NULL AND tc.task_id=p.task_id) OR (p.task_id IS NULL AND tc.sphere_id=p.sphere_id))) AS progress
       FROM challenge_participants p JOIN users u ON u.id=p.user_id WHERE p.challenge_id=$1`,
      [ch.id, ch.ends_on],
    );
    parts.sort((a, b) => (a.user_id === userId ? -1 : b.user_id === userId ? 1 : 0));
    out.push({
      id: ch.id, title: ch.title, goal: ch.goal, endsOn: ch.ends_on, isOwner: ch.owner_id === userId,
      canInvite: parts.length < ch.max_participants,
      participants: parts.map((p) => ({
        isMe: p.user_id === userId, name: p.user_id === userId ? 'Ты' : p.first_name || 'Друг',
        progress: Math.min(p.progress, ch.goal), raw: p.progress,
        binding: p.user_id === userId ? { taskId: p.task_id, sphereId: p.sphere_id } : null,
      })),
    });
  }
  return out;
}

export async function leaveChallenge(userId: number, challengeId: number) {
  const ch = await one<any>(pool, 'SELECT * FROM challenges WHERE id=$1', [challengeId]);
  if (!ch) throw notFound('Челлендж не найден');
  if (ch.owner_id === userId) await pool.query(`UPDATE challenges SET status='deleted' WHERE id=$1`, [challengeId]);
  else await pool.query('DELETE FROM challenge_participants WHERE challenge_id=$1 AND user_id=$2', [challengeId, userId]);
  return { ok: true };
}
