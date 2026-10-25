import { z } from 'zod';
import { clock } from '../clock';
import { prisma } from '../db';
import { badRequest, conflict, notFound } from '../http';
import { notify } from './notify';
import { notifyStoryRequest } from './adminBot';
import { hasPaid, issuePersonalPromo } from './promos';

/** «Вернуть скидку»: участник выкладывает карточку в сторис и отправляет заявку; модератор проверяет и выдаёт персональный промокод */

export const storyInput = z.object({
  mediaId: z.string().uuid(),
  instagram: z.union([z.literal(''), z.string().trim().min(2).max(60).regex(/^@?[A-Za-z0-9._]+$/, 'Укажи ник в Instagram, например @nastya')]).optional(),
});

export async function myStoryRequest(userId: bigint) {
  const r = await prisma.storyRequest.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } });
  if (!r) return { request: null };
  const promo = r.promoId ? await prisma.promo.findUnique({ where: { id: r.promoId } }) : null;
  return {
    request: {
      id: r.id,
      status: r.status,
      instagram: r.instagram,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      promo: promo ? { code: promo.code, validTo: promo.validTo?.toISOString() ?? null, used: !promo.active } : null,
    },
  };
}

export async function submitStoryRequest(userId: bigint, input: z.infer<typeof storyInput>) {
  if (await hasPaid(userId)) throw conflict('already_paid', 'Ты уже в клубе — промокод не нужен');
  const open = await prisma.storyRequest.findFirst({ where: { userId, status: { in: ['pending', 'approved'] } } });
  if (open?.status === 'pending') throw conflict('story_pending', 'Заявка уже на проверке');
  if (open?.status === 'approved') throw conflict('story_approved', 'Промокод уже выдан');
  const media = await prisma.mediaFile.findUnique({ where: { id: input.mediaId } });
  if (!media || media.ownerId !== userId) throw badRequest('media_not_found', 'Прикрепи скриншот сторис');
  const created = await prisma.storyRequest.create({ data: { userId, instagram: (input.instagram ?? '').trim().replace(/^@/, ''), mediaId: media.id, createdAt: clock.now() } });
  await notifyStoryRequest(created.id).catch((e) => console.error('[admin-bot]', (e as Error).message));
  return myStoryRequest(userId);
}

export async function decideStoryRequest(id: string, decision: 'approve' | 'reject', admin: string, reason?: string) {
  const r = await prisma.storyRequest.findUnique({ where: { id } });
  if (!r) throw notFound();
  if (r.status !== 'pending') throw conflict('already_decided', 'Заявка уже рассмотрена');
  const now = clock.now();
  if (decision === 'reject') {
    await prisma.storyRequest.update({ where: { id }, data: { status: 'rejected', reason: reason ?? null, decidedBy: admin, decidedAt: now } });
    await notify(r.userId, 'story_rejected', { reason: reason ?? 'сторис не найдена' }, `story_rejected:${id}`);
    return { ok: true };
  }
  const promo = await issuePersonalPromo(r.userId, r.instagram ? `Сторис @${r.instagram}` : 'Сторис');
  await prisma.storyRequest.update({ where: { id }, data: { status: 'approved', promoId: promo.id, decidedBy: admin, decidedAt: now } });
  const until = promo.validTo!.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
  await notify(r.userId, 'promo_issued', { code: promo.code, until: `${until} МСК` }, `promo_issued:${id}`);
  return { ok: true, code: promo.code };
}
