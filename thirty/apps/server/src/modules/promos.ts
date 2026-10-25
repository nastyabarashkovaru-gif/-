import { addDays, localDate, startOfLocalDay, dayDeadline, addMonths } from '@thirty/domain';
import type { Prisma, Promo } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { clock } from '../clock';
import { prisma } from '../db';
import { badRequest, conflict, notFound } from '../http';
import { getSetting } from '../settings';
import { track } from './analytics';

/**
 * Промокоды возвращают первоначальные акционные цены: открывают окно цены (PriceOffer kind=promo)
 * до конца срока промокода. Дополнительной скидки нет, со скидками не суммируются — цена та же, что в первые 3 часа.
 */

/** «старт», « START » → «СТАРТ»: латинские двойники кириллицы приводим к одному виду */
export function normalizeCode(raw: string): string {
  const up = raw.trim().toUpperCase().replace(/\s+/g, '');
  const ALIASES: Record<string, string> = { START: 'СТАРТ', CTAPT: 'СТАРТ' };
  return ALIASES[up] ?? up;
}

/** Окно действия промокода, в которое попадает момент now; null — сейчас не действует */
export async function promoWindow(p: Promo, now = clock.now()): Promise<{ from: Date; to: Date } | null> {
  if (!p.active) return null;
  if (p.window === 'flow_start') {
    const tz = await getSetting('flow.timezone');
    const today = localDate(now, tz);
    // Ближайшие старты потоков: 1-е число текущего и следующего месяца
    for (const start of [`${today.slice(0, 7)}-01`, addMonths(`${today.slice(0, 7)}-01`, 1)]) {
      const from = startOfLocalDay(addDays(start, -p.daysBefore), tz);
      const to = dayDeadline(addDays(start, p.daysAfter), tz);
      if (now >= from && now < to) return { from, to };
    }
    return null;
  }
  if (p.validFrom && now < p.validFrom) return null;
  if (p.validTo && now >= p.validTo) return null;
  return { from: p.validFrom ?? p.createdAt, to: p.validTo ?? new Date(now.getTime() + 365 * 24 * 3600_000) };
}

export async function hasPaid(userId: bigint) {
  const paid = await prisma.payment.findFirst({ where: { userId, status: 'paid', kind: 'initial' }, select: { id: true } });
  return Boolean(paid);
}

/** Применить промокод: проверка на сервере, затем окно акционной цены до конца срока промокода */
export async function applyPromo(userId: bigint, raw: string) {
  const code = normalizeCode(raw);
  if (!code) throw badRequest('promo_empty', 'Введи промокод');
  const promo = await prisma.promo.findUnique({ where: { code } });
  if (!promo) throw notFound('promo_not_found', 'Такого промокода нет');
  if (promo.kind === 'personal' && promo.userId !== userId) throw notFound('promo_not_found', 'Такого промокода нет');
  if (promo.maxUses !== null && promo.uses >= promo.maxUses) throw conflict('promo_used', 'Промокод уже использован');
  const win = await promoWindow(promo);
  if (!win) throw conflict('promo_expired', 'Срок действия промокода истёк');
  if (await hasPaid(userId)) throw conflict('already_paid', 'Ты уже в клубе — промокод не нужен');
  const now = clock.now();
  await prisma.$transaction([
    prisma.priceOffer.upsert({
      where: { userId_kind: { userId, kind: 'promo' } },
      create: { userId, kind: 'promo', startedAt: now, expiresAt: win.to, promoId: promo.id },
      update: { startedAt: now, expiresAt: win.to, promoId: promo.id, consumedAt: null },
    }),
    prisma.promoRedemption.upsert({ where: { promoId_userId: { promoId: promo.id, userId } }, create: { promoId: promo.id, userId, appliedAt: now }, update: { appliedAt: now } }),
  ]);
  await track({ userId, eventName: 'screen_view', screenId: 'PROMO', metadata: { promo: promo.code, kind: promo.kind } });
  return { ok: true, code: promo.code, expiresAt: win.to.toISOString() };
}

/** При успешной оплате: фиксируем использование промокода (одноразовый персональный — гасим) */
export async function redeemOnPayment(tx: Prisma.TransactionClient, userId: bigint, paymentId: string, now: Date) {
  const offer = await tx.priceOffer.findFirst({ where: { userId, kind: 'promo', consumedAt: null, expiresAt: { gt: now }, promoId: { not: null } } });
  if (!offer?.promoId) return;
  await tx.promoRedemption.updateMany({ where: { promoId: offer.promoId, userId, paymentId: null }, data: { paymentId, paidAt: now } });
  const p = await tx.promo.update({ where: { id: offer.promoId }, data: { uses: { increment: 1 } } });
  if (p.maxUses !== null && p.uses >= p.maxUses) await tx.promo.update({ where: { id: p.id }, data: { active: false } });
}

/** Персональный одноразовый промокод (за сторис) */
export async function issuePersonalPromo(userId: bigint, note: string) {
  const days = await getSetting('promo.personalDays');
  const now = clock.now();
  for (let i = 0; i < 5; i++) {
    const code = `ВЕРНИ${randomInt(10000, 99999)}`;
    try {
      return await prisma.promo.create({ data: { code, kind: 'personal', window: 'dates', validFrom: now, validTo: new Date(now.getTime() + days * 24 * 3600_000), userId, maxUses: 1, note } });
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
    }
  }
  throw conflict('promo_generate_failed');
}

/** Начальные промокоды: СТАРТ — с 00:00 за день до старта потока до конца дня старта */
export async function seedPromos() {
  await prisma.promo.upsert({
    where: { code: 'СТАРТ' },
    create: { code: 'СТАРТ', kind: 'public', window: 'flow_start', daysBefore: 1, daysAfter: 0, note: 'Сообщение 11: за день до старта потока' },
    update: {},
  });
}
