import { clock } from '../clock';
import { prisma } from '../db';
import { deactivateAtProvider, LIVE_STATUSES } from './billing';

/**
 * «Начать путь заново» (только для владельца, обычно для проверки на себе): человек снова проходит путь новичка
 * и может купить по-настоящему. Автосписание отключается у CloudPayments, подписка закрывается, анкета и цели удаляются,
 * таймер скидки и промокоды обнуляются, приветствие и дожимы бота придут снова.
 * Прежние оплаты помечаются тестовыми (не входят в выручку), но не удаляются и не считаются возвратом.
 */
export async function startOver(userId: bigint) {
  const now = clock.now();
  const live = await prisma.subscription.findMany({ where: { userId, status: { in: [...LIVE_STATUSES] } } });
  for (const s of live) {
    await prisma.subscription.update({ where: { id: s.id }, data: { status: 'expired', autoRenew: false, canceledAt: now, cancelReason: 'start_over', test: true } });
    await deactivateAtProvider(s.id);
  }
  const subs = await prisma.subscription.findMany({ where: { id: { in: live.map((s) => s.id) } } });
  const memberships = await prisma.flowMembership.findMany({ where: { userId }, select: { id: true, flowId: true } });
  const ids = memberships.map((m) => m.id);
  const pairs = await prisma.buddyPair.findMany({ where: { OR: [{ userA: userId }, { userB: userId }] }, select: { id: true } });
  await prisma.$transaction([
    prisma.payment.updateMany({ where: { userId, status: { in: ['paid', 'refunded'] } }, data: { test: true } }),
    prisma.subscription.updateMany({ where: { userId }, data: { test: true } }),
    prisma.goal.deleteMany({ where: { membershipId: { in: ids } } }),
    prisma.flowFeedback.deleteMany({ where: { userId } }),
    prisma.flowMembership.updateMany({ where: { userId }, data: { status: 'revoked', expectation: null, finalResult: null, finalSubmittedAt: null, goalsLockedAt: null, registeredAt: null } }),
    prisma.leaderboardEntry.deleteMany({ where: { userId } }),
    prisma.buddyAssignment.deleteMany({ where: { OR: [{ userId }, { pairId: { in: pairs.map((p) => p.id) } }] } }),
    prisma.buddyPair.updateMany({ where: { id: { in: pairs.map((p) => p.id) } }, data: { status: 'dissolved' } }),
    prisma.buddyInvite.updateMany({ where: { fromUserId: userId, status: 'pending' }, data: { status: 'expired' } }),
    prisma.priceOffer.deleteMany({ where: { userId } }),
    prisma.promoRedemption.deleteMany({ where: { userId } }),
    prisma.storyRequest.deleteMany({ where: { userId } }),
    prisma.botMessageLog.deleteMany({ where: { userId, OR: [{ templateKey: 'welcome' }, { templateKey: { startsWith: 'chain_' } }, { templateKey: { startsWith: 'reg_' } }] } }),
    prisma.user.update({ where: { id: userId }, data: { onboardingStage: 'new', lastScreen: null, interests: [], age: null, occupation: null, city: null, marketingOptIn: true } }),
  ]);
  return {
    subscriptions: subs.map((s) => ({ id: s.id, providerSubscriptionId: s.providerSubscriptionId, autopayOff: Boolean(s.providerDeactivatedAt) || !s.providerSubscriptionId })),
    memberships: ids.length,
  };
}
