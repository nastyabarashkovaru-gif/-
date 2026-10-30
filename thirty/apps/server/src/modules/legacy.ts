import { randomBytes, timingSafeEqual } from 'node:crypto';
import { addMonths, localDate, planPurchase, startOfLocalDay, subscriptionStatusOn, toDbDate, addDays, type ISODate } from '@thirty/domain';
import { z } from 'zod';
import { clock } from '../clock';
import { prisma } from '../db';
import { forbidden } from '../http';
import { appLink } from '../lib/telegram';
import { getSetting, setSetting } from '../settings';
import { blockingSubscription, reviveMembership } from './billing';
import { ensureFlow } from './flows';
import { displayName } from './users';

/**
 * Переход оплативших до запуска приложения: секретная ссылка (владелица отправляет её в прежний платный чат)
 * даёт участие на один месяц — ближайший поток, без оплаты и без автопродления — и ведёт сразу в анкету.
 * Ограничения: срок действия, число активаций, повторно тот же человек месяц не получает. Каждая активация — в админ-бот.
 */
export const LEGACY_REASON = 'legacy';
export const legacyClaimInput = z.object({ code: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/) });

export const newLegacyCode = () => randomBytes(9).toString('base64url');

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function legacyInfo() {
  const cfg = await getSetting('legacy.invite');
  const claims = await prisma.subscription.findMany({ where: { cancelReason: LEGACY_REASON }, include: { user: true }, orderBy: { createdAt: 'desc' } });
  return {
    ...cfg,
    link: cfg.code ? appLink(`legacy_${cfg.code}`) : null,
    uses: claims.length,
    claims: claims.map((s) => ({ userId: s.userId.toString(), name: displayName(s.user), username: s.user.username, at: s.createdAt })),
  };
}

export async function regenerateLegacyCode() {
  const cfg = await getSetting('legacy.invite');
  await setSetting('legacy.invite', { ...cfg, code: newLegacyCode() });
}

export async function legacyClaim(userId: bigint, code: string) {
  const cfg = await getSetting('legacy.invite');
  if (!cfg.enabled || !cfg.code || !same(code, cfg.code)) throw forbidden('legacy_invalid', 'Ссылка недействительна. Напиши в поддержку — поможем.');
  const tz = await getSetting('flow.timezone');
  const now = clock.now();
  if (cfg.expiresAt && now >= startOfLocalDay(addDays(cfg.expiresAt as ISODate, 1), tz)) throw forbidden('legacy_expired', 'Срок действия ссылки закончился. Напиши в поддержку — поможем.');
  const plan = planPurchase({ now, tz, months: 1, lateJoinUntilDay: await getSetting('flow.lateJoinUntilDay') });
  // Уже есть доступ к этому потоку (оплата или прежняя активация) — просто ведём дальше
  if (await blockingSubscription(userId, plan.firstFlow)) return { ok: true, already: true };
  if (await prisma.subscription.findFirst({ where: { userId, cancelReason: LEGACY_REASON } })) throw forbidden('legacy_used', 'Ты уже переходила по этой ссылке. Продлить участие можно в профиле.');
  const uses = await prisma.subscription.count({ where: { cancelReason: LEGACY_REASON } });
  if (uses >= cfg.maxUses) throw forbidden('legacy_limit', 'Места по этой ссылке закончились. Напиши в поддержку — поможем.');
  const tariff = await prisma.tariff.findUniqueOrThrow({ where: { id: 'm1' } });
  const today = localDate(now, tz);
  const flow = await ensureFlow(plan.firstFlow);
  await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.create({
      data: {
        userId, tariffId: tariff.id, autoRenew: false, renewalPrice: tariff.promoPrice, priceVariant: 'promo',
        status: subscriptionStatusOn({ today, paidFromFlow: plan.firstFlow, paidThroughFlow: plan.firstFlow, autoRenew: false, nextChargeDate: null }),
        paidFromFlow: toDbDate(plan.firstFlow), paidThroughFlow: toDbDate(plan.firstFlow), nextChargeDate: null,
        canceledAt: now, cancelReason: LEGACY_REASON, providerDeactivatedAt: now,
      },
    });
    const existing = await tx.flowMembership.findUnique({ where: { userId_flowId: { userId, flowId: flow.id } } });
    if (existing) await reviveMembership(tx, existing.id, sub.id, tariff.id);
    else await tx.flowMembership.create({ data: { userId, flowId: flow.id, subscriptionId: sub.id, tariffId: tariff.id } });
    await tx.user.update({ where: { id: userId }, data: { onboardingStage: 'paid' } });
  });
  const u = await prisma.user.findUnique({ where: { id: userId } });
  const { notifyAdmins, escAdmin } = await import('./adminBot');
  void notifyAdmins(`🎟 <b>Перенос из прошлых потоков</b>\n${u ? escAdmin(displayName(u)) + (u.username ? ` (@${escAdmin(u.username)})` : '') : userId}\nУчастие: ${escAdmin(flow.title)} · активация ${uses + 1} из ${cfg.maxUses}`).catch(() => undefined);
  return { ok: true, flow: flow.title, until: addMonths(plan.firstFlow, 1) };
}
