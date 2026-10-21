import type { User } from '@prisma/client';
import { clock } from '../clock';
import { prisma, isUniqueViolation } from '../db';
import { feature } from '../settings';
import { registerBotClick } from './bot';

/**
 * Обработка параметра запуска Mini App:
 * m_<logId>_<screen> — клик по кнопке бота; ref_<code> — реферальный визит нового пользователя.
 */
export async function handleStartParam(user: User, startParam: string | undefined) {
  if (!startParam) return;
  if (startParam.startsWith('m_')) await registerBotClick(user.id, startParam);
  if (startParam.startsWith('ref_')) await registerReferralVisit(user, startParam.slice(4));
}

async function registerReferralVisit(visitor: User, code: string) {
  // Засчитываем только по-настоящему новых пользователей (первые 10 минут после создания)
  if (clock.now().getTime() - visitor.createdAt.getTime() > 10 * 60_000) return;
  const link = await prisma.referralLink.findUnique({ where: { code } });
  if (!link || link.userId === visitor.id) return;
  try {
    await prisma.referralVisit.create({ data: { code, visitorId: visitor.id } });
  } catch (e) {
    if (isUniqueViolation(e)) return;
    throw e;
  }
  // Реферальное восстановление цены (только при включённом флаге и после истечения своего таймера)
  if (await feature('offer_referral_restore')) {
    const intro = await prisma.priceOffer.findUnique({ where: { userId_kind: { userId: link.userId, kind: 'intro' } } });
    const paid = await prisma.subscription.findFirst({ where: { userId: link.userId } });
    if (intro && !paid && intro.expiresAt < clock.now()) {
      try {
        await prisma.priceOffer.create({ data: { userId: link.userId, kind: 'referral_restore', expiresAt: new Date(clock.now().getTime() + 3 * 3600_000) } });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
  }
}
