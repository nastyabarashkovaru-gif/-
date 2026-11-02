import { localDate, toDbDate } from '@thirty/domain';
import { clock } from '../clock';
import { prisma } from '../db';
import { notFound } from '../http';
import { getSetting, setSetting } from '../settings';
import { ensureFlow } from './flows';

/** Наблюдатели: организатор смотрит поток изнутри, но не участвует в подборе бадди, рейтинге и списке участниц */
export async function observerIds() {
  return new Set(await getSetting('flow.observers'));
}

export const OBSERVER_REASON = 'observer';

/** Добавить в текущий поток наблюдателем: доступ как у участницы (тестовая подписка — не в выручке), без анкеты */
export async function addObserver(userId: bigint) {
  if (!(await prisma.user.findUnique({ where: { id: userId } }))) throw notFound('user_not_found');
  const tz = await getSetting('flow.timezone');
  const flowStart = `${localDate(clock.now(), tz).slice(0, 7)}-01`;
  const flow = await ensureFlow(flowStart);
  const list = await getSetting('flow.observers');
  if (!list.includes(String(userId))) await setSetting('flow.observers', [...list, String(userId)]);
  // если уже стоит в паре — пару распускаем, партнёрше подбираем новую
  const a = await prisma.buddyAssignment.findUnique({ where: { flowId_userId: { flowId: flow.id, userId } } });
  if (a) {
    const { dissolvePair, autoMatch } = await import('./buddy');
    await dissolvePair(a.pairId, 'approved');
    await autoMatch(flow.id);
  }
  const existing = await prisma.flowMembership.findUnique({ where: { userId_flowId: { userId, flowId: flow.id } } });
  if (existing) {
    if (existing.status === 'revoked' || existing.status === 'reserved') await prisma.flowMembership.update({ where: { id: existing.id }, data: { status: 'active' } });
    return { flow: flow.title, already: existing.status !== 'revoked' };
  }
  const tariff = await prisma.tariff.findUniqueOrThrow({ where: { id: 'm1' } });
  await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.create({
      data: {
        userId, tariffId: tariff.id, status: 'active', autoRenew: false, renewalPrice: 0, priceVariant: 'promo', test: true,
        paidFromFlow: toDbDate(flowStart), paidThroughFlow: toDbDate(flowStart), nextChargeDate: null,
        canceledAt: clock.now(), cancelReason: OBSERVER_REASON, providerDeactivatedAt: clock.now(),
      },
    });
    await tx.flowMembership.create({ data: { userId, flowId: flow.id, subscriptionId: sub.id, tariffId: tariff.id, status: 'active' } });
  });
  return { flow: flow.title, already: false };
}

/** Убрать наблюдателя: доступ к потоку закрывается */
export async function removeObserver(userId: bigint) {
  const list = await getSetting('flow.observers');
  await setSetting('flow.observers', list.filter((x) => x !== String(userId)));
  const subs = await prisma.subscription.findMany({ where: { userId, cancelReason: OBSERVER_REASON, status: { not: 'expired' } } });
  for (const s of subs) {
    await prisma.subscription.update({ where: { id: s.id }, data: { status: 'expired' } });
    await prisma.flowMembership.updateMany({ where: { subscriptionId: s.id }, data: { status: 'revoked' } });
  }
  return { ok: true };
}
