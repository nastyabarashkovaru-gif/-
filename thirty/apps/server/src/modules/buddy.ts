import { randomBytes } from 'node:crypto';
import { canRequestReplacement, matchBuddies } from '@thirty/domain';
import { clock } from '../clock';
import { prisma, serializable, type Tx } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../http';
import { memberStats } from './rating';
import { displayName } from './users';
import { track } from './analytics';
import { notify } from './notify';

const ELIGIBLE = ['reserved', 'registered', 'active'] as const;

async function membershipIn(userId: bigint, flowId: string, db: Tx | typeof prisma = prisma) {
  return db.flowMembership.findFirst({ where: { userId, flowId, status: { in: [...ELIGIBLE] } } });
}

/** Создать пару транзакционно: первичный ключ BuddyAssignment(flowId, userId) не даст назначить второго бадди */
async function createPair(tx: Tx, flowId: string, a: bigint, b: bigint, source: string, matchReason?: string) {
  const pair = await tx.buddyPair.create({ data: { flowId, userA: a, userB: b, source, matchReason } });
  await tx.buddyAssignment.createMany({ data: [{ flowId, userId: a, pairId: pair.id }, { flowId, userId: b, pairId: pair.id }] });
  return pair;
}

export async function createInvite(userId: bigint, flowId: string) {
  if (!(await membershipIn(userId, flowId))) throw forbidden('no_membership');
  if (await prisma.buddyAssignment.findUnique({ where: { flowId_userId: { flowId, userId } } })) throw conflict('already_paired', 'У вас уже есть бадди');
  const existing = await prisma.buddyInvite.findFirst({ where: { flowId, fromUserId: userId, status: 'pending' } });
  const invite = existing ?? (await prisma.buddyInvite.create({ data: { flowId, fromUserId: userId, token: randomBytes(9).toString('base64url') } }));
  await track({ userId, eventName: 'buddy_invite_sent', screenId: 'S16', flowId });
  return { token: invite.token, startParam: `bd_${invite.token}` };
}

/** Принять приглашение: оба оплатили этот поток и оба свободны → пара «по приглашению» (не перераспределяется) */
export async function acceptInvite(userId: bigint, token: string) {
  const invite = await prisma.buddyInvite.findUnique({ where: { token } });
  if (!invite || invite.status !== 'pending') throw notFound('invite_not_found', 'Приглашение недействительно');
  if (invite.fromUserId === userId) throw badRequest('self_invite', 'Нельзя пригласить самого себя');
  const pair = await serializable(async (tx) => {
    const [mine, theirs] = await Promise.all([membershipIn(userId, invite.flowId, tx), membershipIn(invite.fromUserId, invite.flowId, tx)]);
    if (!mine) throw forbidden('no_membership', 'Чтобы стать бадди, нужно участие в этом же потоке');
    if (!theirs) throw conflict('inviter_inactive');
    const taken = await tx.buddyAssignment.findMany({ where: { flowId: invite.flowId, userId: { in: [userId, invite.fromUserId] } } });
    if (taken.length) throw conflict('already_paired', 'У кого-то из вас уже есть бадди');
    const p = await createPair(tx, invite.flowId, invite.fromUserId, userId, 'invite');
    await tx.buddyInvite.update({ where: { id: invite.id }, data: { status: 'accepted', toUserId: userId } });
    return p;
  });
  await onMatched(pair.flowId, [pair.userA, pair.userB]);
  return { pairId: pair.id };
}

async function onMatched(flowId: string, users: bigint[]) {
  for (const u of users) {
    await track({ userId: u, eventName: 'buddy_matched', flowId, dedupeKey: `buddy_matched:${flowId}:${u}` });
    await notify(u, 'buddy_matched', {}, `buddy_matched:${flowId}:${u}:${clock.now().toISOString().slice(0, 13)}`);
  }
}

/**
 * Автоподбор для всех свободных участников потока. Идемпотентен: уже назначенные не трогаются,
 * повторный запуск ничего не меняет. Пары по приглашению не перераспределяются.
 */
export async function autoMatch(flowId: string) {
  const members = await prisma.flowMembership.findMany({ where: { flowId, status: { in: [...ELIGIBLE] } }, include: { user: true } });
  const assigned = new Set((await prisma.buddyAssignment.findMany({ where: { flowId } })).map((a) => a.userId.toString()));
  const pool = members
    .filter((m) => !assigned.has(m.userId.toString()))
    .map((m) => ({ userId: m.userId.toString(), interests: m.user.interests, city: m.user.city, timezone: m.user.timezone }));
  const { pairs, unmatched } = matchBuddies(pool, `${flowId}:${pool.length}`);
  let created = 0;
  for (const p of pairs) {
    try {
      await serializable((tx) => createPair(tx, flowId, BigInt(p.a), BigInt(p.b), 'auto', p.reason));
      created++;
      await onMatched(flowId, [BigInt(p.a), BigInt(p.b)]);
    } catch (e) {
      // Гонка с ручным приглашением — эту пару пропускаем, человек уже с бадди
      if (!(e instanceof Error && /Unique|P2002/.test(e.message))) throw e;
    }
  }
  return { created, waiting: unmatched.length };
}

export async function buddyOf(userId: bigint, flowId: string) {
  const a = await prisma.buddyAssignment.findUnique({ where: { flowId_userId: { flowId, userId } }, include: { pair: true } });
  if (!a) return null;
  const otherId = a.pair.userA === userId ? a.pair.userB : a.pair.userA;
  return { pair: a.pair, otherId };
}

/** Карточка бадди на главной: имя, разрешённый прогресс, «Написать» */
export async function buddyCard(userId: bigint, flowId: string) {
  const b = await buddyOf(userId, flowId);
  if (!b) {
    const waiting = await prisma.buddyInvite.findFirst({ where: { flowId, fromUserId: userId, status: 'pending' } });
    return { state: waiting ? 'invited' : 'waiting' } as const;
  }
  const other = await prisma.user.findUniqueOrThrow({ where: { id: b.otherId } });
  const m = await prisma.flowMembership.findFirst({ where: { userId: b.otherId, flowId }, include: { flow: true } });
  const showProgress = other.visibility !== 'hidden' && m && m.status === 'active';
  const percent = showProgress ? Math.round((await memberStats(m.id, m.flow)).ratio * 100) : null;
  return {
    state: 'paired' as const,
    pairId: b.pair.id,
    source: b.pair.source,
    since: b.pair.createdAt,
    buddy: {
      id: other.id.toString(),
      name: displayName(other),
      photoUrl: other.photoUrl,
      percent,
      writeUrl: other.username ? `https://t.me/${other.username}` : `tg://user?id=${other.id}`,
    },
  };
}

/**
 * Замена бадди: по взаимному согласию (нужны запросы обоих) или при отсутствии связи > 5 дней
 * (декларация, видна модератору). Пара распускается, оба возвращаются в пул и сразу пробуют переподбор.
 */
export async function requestReplacement(userId: bigint, flowId: string, reason: 'mutual' | 'no_contact_5d', comment?: string) {
  const b = await buddyOf(userId, flowId);
  if (!b) throw notFound('no_buddy');
  const now = clock.now();
  if (!canRequestReplacement(reason, null, b.pair.createdAt, now)) throw forbidden('too_early', 'Замена по отсутствию связи доступна через 5 дней после назначения');
  const existing = await prisma.buddyReplacement.findFirst({ where: { pairId: b.pair.id, requesterId: userId, status: 'open' } });
  if (!existing) await prisma.buddyReplacement.create({ data: { pairId: b.pair.id, requesterId: userId, reason, comment } });
  if (reason === 'mutual') {
    const partner = await prisma.buddyReplacement.findFirst({ where: { pairId: b.pair.id, requesterId: b.otherId, reason: 'mutual', status: 'open' } });
    if (!partner) return { state: 'waiting_partner' as const };
  }
  await dissolvePair(b.pair.id, 'approved');
  const rematch = await autoMatch(flowId);
  const now2 = await buddyOf(userId, flowId);
  return { state: now2 ? ('rematched' as const) : ('waiting_pool' as const), rematch };
}

export async function dissolvePair(pairId: string, replacementStatus = 'approved', decidedBy?: string) {
  await prisma.$transaction([
    prisma.buddyAssignment.deleteMany({ where: { pairId } }),
    prisma.buddyPair.update({ where: { id: pairId }, data: { status: 'dissolved', dissolvedAt: clock.now() } }),
    prisma.buddyReplacement.updateMany({ where: { pairId, status: 'open' }, data: { status: replacementStatus, decidedBy } }),
  ]);
}
