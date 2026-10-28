import { prisma } from '../db';
import { getSetting } from '../settings';

/**
 * «Сейчас с нами уже N участников»: стартовое число из админки + каждая новая первая оплата после момента,
 * когда это число задали (тестовые и возвращённые оплаты не считаются, один человек — один раз).
 */
export async function communityCount() {
  const base = Number.parseInt(await getSetting('community.count'), 10) || 0;
  const since = await getSetting('community.countSince');
  if (!since) return base;
  const rows = await prisma.payment.groupBy({ by: ['userId'], where: { kind: 'initial', status: 'paid', test: false, paidAt: { gte: new Date(since) } } });
  return base + rows.length;
}
