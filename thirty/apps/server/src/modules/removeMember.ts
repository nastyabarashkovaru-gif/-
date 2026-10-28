import { clock } from '../clock';
import { prisma } from '../db';
import { deactivateAtProvider, LIVE_STATUSES } from './billing';
import { autoMatch, dissolvePair } from './buddy';
import { removeExpiredMembers } from './chats';

/**
 * «Удалить участника» из текущего и будущих потоков: в подбор бадди он больше не попадает, из пар выходит
 * (партнёр возвращается в пул и сразу получает нового бадди, если подбор уже идёт), из закрытых чатов удаляется.
 * Анкета и отчёты сохраняются — участника можно вернуть. Деньги не возвращаются (возврат — в кабинете CloudPayments).
 */
export async function removeMember(userId: bigint, opts: { closeSubscription: boolean }) {
  const now = clock.now();
  const memberships = await prisma.flowMembership.findMany({
    where: { userId, status: { not: 'revoked' }, flow: { status: { in: ['upcoming', 'active'] } } },
    include: { flow: true },
  });
  const flowIds = memberships.map((m) => m.flowId);
  const pairs = await prisma.buddyPair.findMany({ where: { flowId: { in: flowIds }, status: 'active', OR: [{ userA: userId }, { userB: userId }] } });
  for (const p of pairs) await dissolvePair(p.id, 'approved', 'admin');
  await prisma.$transaction([
    prisma.flowMembership.updateMany({ where: { id: { in: memberships.map((m) => m.id) } }, data: { status: 'revoked' } }),
    prisma.buddyInvite.updateMany({ where: { fromUserId: userId, flowId: { in: flowIds }, status: 'pending' }, data: { status: 'expired' } }),
    prisma.leaderboardEntry.deleteMany({ where: { userId, flowId: { in: flowIds } } }),
  ]);
  let subscriptions = 0;
  if (opts.closeSubscription) {
    const live = await prisma.subscription.findMany({ where: { userId, status: { in: [...LIVE_STATUSES] } } });
    for (const s of live) {
      await prisma.subscription.update({ where: { id: s.id }, data: { status: 'expired', autoRenew: false, canceledAt: now, cancelReason: 'removed_by_admin' } });
      await deactivateAtProvider(s.id);
      subscriptions++;
    }
  }
  // Бывший партнёр — снова в подборе (в окно автоподбора это сделает и расписание, здесь — сразу)
  const rematched = [];
  for (const p of pairs) rematched.push(await autoMatch(p.flowId).catch(() => null));
  await removeExpiredMembers().catch((e) => console.warn('[remove-member] chats', (e as Error).message));
  return { flows: memberships.map((m) => m.flow.title), pairsDissolved: pairs.length, subscriptionsClosed: subscriptions, rematched: rematched.filter(Boolean).length };
}

/** Вернуть участника в потоки, из которых его удалили (если они ещё не закончились) */
export async function restoreMember(userId: bigint) {
  const ms = await prisma.flowMembership.findMany({ where: { userId, status: 'revoked', flow: { status: { in: ['upcoming', 'active'] } } }, include: { flow: true, goals: { select: { id: true } } } });
  for (const m of ms) {
    const status = m.flow.status === 'active' && m.goalsLockedAt ? 'active' : m.registeredAt && m.goals.length ? 'registered' : 'reserved';
    await prisma.flowMembership.update({ where: { id: m.id }, data: { status } });
  }
  return { flows: ms.map((m) => m.flow.title) };
}
