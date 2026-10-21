import { addDays, flowBounds, fromDbDate, tariffPerks } from '@thirty/domain';
import { z } from 'zod';
import { clock } from '../clock';
import { prisma } from '../db';
import { badRequest, forbidden, notFound } from '../http';
import { signedMediaUrl } from '../lib/storage';
import { flowToday } from './flows';
import { memberStats } from './rating';
import { track } from './analytics';

export const FINAL_WINDOW_DAYS = 3;

export const finalInput = z.object({
  goals: z.array(z.object({ goalId: z.string().uuid(), achieved: z.boolean(), comment: z.string().max(1000).optional() })).min(1),
  after: z.object({ text: z.string().max(2000).optional(), metrics: z.record(z.string().max(60)).default({}), mediaIds: z.array(z.string().uuid()).max(6).default([]) }).optional(),
});

/**
 * Итоговая анкета S33: с последнего дня потока до +3 дней. Ответ по каждой цели обязателен.
 * Повторно отправить нельзя — это часть обязательств для приза.
 */
export async function submitFinal(userId: bigint, membershipId: string, input: z.infer<typeof finalInput>) {
  const m = await prisma.flowMembership.findUnique({ where: { id: membershipId }, include: { flow: true, goals: true } });
  if (!m || m.userId !== userId) throw notFound();
  if (m.finalSubmittedAt) throw forbidden('already_submitted', 'Итоговая анкета уже отправлена');
  if (!['active', 'finished'].includes(m.status)) throw forbidden('not_member');
  const today = flowToday(m.flow);
  const endsOn = flowBounds(fromDbDate(m.flow.startsOn)).endsOn;
  if (today < endsOn || today > addDays(endsOn, FINAL_WINDOW_DAYS)) throw forbidden('final_closed', `Итоговая анкета доступна с последнего дня потока в течение ${FINAL_WINDOW_DAYS} дней`);
  const ids = new Set(m.goals.map((g) => g.id));
  if (input.goals.length !== m.goals.length || input.goals.some((g) => !ids.has(g.goalId))) throw badRequest('all_goals_required', 'Ответьте по каждой цели');
  if (input.after?.mediaIds.length) {
    const consent = await prisma.consent.findFirst({ where: { userId, kind: 'sensitive_photos', revokedAt: null } });
    if (!consent) throw forbidden('consent_required', 'Нужно согласие на хранение фото');
    const own = await prisma.mediaFile.count({ where: { id: { in: input.after.mediaIds }, ownerId: userId } });
    if (own !== input.after.mediaIds.length) throw badRequest('bad_media');
  }
  await prisma.$transaction(async (tx) => {
    for (const g of input.goals) await tx.goal.update({ where: { id: g.goalId }, data: { finalAchieved: g.achieved, finalComment: g.comment } });
    if (input.after) {
      await tx.beforeAfter.upsert({
        where: { membershipId_phase: { membershipId, phase: 'after' } },
        create: { membershipId, phase: 'after', text: input.after.text, metrics: input.after.metrics, mediaIds: input.after.mediaIds },
        update: { text: input.after.text, metrics: input.after.metrics, mediaIds: input.after.mediaIds },
      });
      if (input.after.mediaIds.length) await tx.mediaFile.updateMany({ where: { id: { in: input.after.mediaIds } }, data: { sensitive: true } });
    }
    await tx.flowMembership.update({ where: { id: membershipId }, data: { finalSubmittedAt: clock.now() } });
  });
  return { ok: true };
}

export const reviewInput = z.object({
  trigger: z.enum(['day14', 'final', 'meeting']),
  meetingId: z.string().uuid().optional(),
  rating: z.number().int().min(1).max(10).optional(),
  emotions: z.array(z.string().max(30)).max(10).default([]),
  changes: z.string().max(3000).optional(),
  result: z.string().max(3000).optional(),
  metrics: z.record(z.string().max(60)).default({}),
  mediaIds: z.array(z.string().uuid()).max(6).default([]),
  allowText: z.boolean().default(false),
  allowPhoto: z.boolean().default(false),
  allowName: z.boolean().default(false),
});

/** Отзыв: полностью добровольный, на рейтинг и приз не влияет; публикация — только по отдельным галочкам */
export async function submitReview(userId: bigint, input: z.infer<typeof reviewInput>) {
  if (input.mediaIds.length) {
    const own = await prisma.mediaFile.count({ where: { id: { in: input.mediaIds }, ownerId: userId } });
    if (own !== input.mediaIds.length) throw badRequest('bad_media');
  }
  const m = await prisma.flowMembership.findFirst({ where: { userId, status: { not: 'revoked' } }, orderBy: { createdAt: 'desc' } });
  const review = await prisma.review.create({ data: { ...input, userId, flowId: m?.flowId } });
  const consentKinds = [input.allowText && 'case_text', input.allowPhoto && 'case_photo', input.allowName && 'case_name'].filter(Boolean) as ('case_text' | 'case_photo' | 'case_name')[];
  for (const kind of consentKinds) await prisma.consent.create({ data: { userId, kind, version: '2026-10-v1', granted: true, context: review.id } });
  await track({ userId, eventName: 'review_submitted', screenId: 'S32', metadata: { trigger: input.trigger, rating: input.rating } });
  if (consentKinds.length) await track({ userId, eventName: 'review_publish_consent', screenId: 'S32', metadata: { kinds: consentKinds } });
  return { id: review.id };
}

/** Отзыв согласия на будущее использование кейса */
export async function revokeReviewConsent(userId: bigint, reviewId: string) {
  const r = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!r || r.userId !== userId) throw notFound();
  const now = clock.now();
  await prisma.$transaction([
    prisma.review.update({ where: { id: reviewId }, data: { allowText: false, allowPhoto: false, allowName: false, consentRevokedAt: now, featured: false } }),
    prisma.consent.updateMany({ where: { userId, context: reviewId, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  return { ok: true };
}

/** Архив и сравнение месяцев S34; фото «до/после» и карта трансформации — по тарифу */
export async function archive(userId: bigint) {
  const memberships = await prisma.flowMembership.findMany({
    where: { userId, status: { not: 'revoked' } },
    include: { flow: true, goals: true, beforeAfter: true },
    orderBy: { flow: { startsOn: 'asc' } },
  });
  const tariffMonths = Math.max(1, ...(await prisma.tariff.findMany({ where: { id: { in: memberships.map((m) => m.tariffId) } } })).map((t) => t.months));
  const perks = tariffPerks(tariffMonths);
  const months = [];
  for (const m of memberships) {
    const stats = ['active', 'finished'].includes(m.status) ? await memberStats(m.id, m.flow) : null;
    const before = m.beforeAfter.find((b) => b.phase === 'before');
    const after = m.beforeAfter.find((b) => b.phase === 'after');
    months.push({
      flowId: m.flowId,
      title: m.flow.title,
      startsOn: fromDbDate(m.flow.startsOn),
      status: m.status,
      percent: stats ? Math.round(stats.ratio * 100) : null,
      successfulDays: stats?.successfulDays ?? null,
      longestStreak: stats?.longestStreak ?? null,
      goals: m.goals.map((g) => ({ title: g.title, category: g.category, achieved: g.finalAchieved })),
      transformation: perks.transformationHistory
        ? {
            before: before ? { text: before.text, metrics: before.metrics, media: before.mediaIds.map((id) => signedMediaUrl(id)) } : null,
            after: after ? { text: after.text, metrics: after.metrics, media: after.mediaIds.map((id) => signedMediaUrl(id)) } : null,
          }
        : null,
    });
  }
  return { perks, months };
}
