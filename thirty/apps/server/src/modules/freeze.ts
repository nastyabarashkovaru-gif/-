import { addDays, addMonths, daysBetween, fromDbDate, generateOccurrences, humanDate, toDbDate, type ISODate } from '@thirty/domain';
import { clock } from '../clock';
import { prisma } from '../db';
import { badRequest, forbidden, notFound } from '../http';
import { tg } from '../lib/telegram';
import { currentMembership, memberWindow } from './flows';

/**
 * Заморозка челленджа (18.11): с сегодняшнего дня челлендж на паузе до выбранной даты.
 * Прогресс, цели и отчёты сохраняются; задачи с сегодняшнего дня снимаются (пропусков нет), напоминаний нет.
 * Подписка сдвигается на длину паузы (округление вверх до месяца), чтобы не списать оплату во время паузы.
 * В дату окончания (или раньше — кнопкой «Продолжить челлендж») челлендж продолжается с того же дня.
 */
export async function freezeChallenge(userId: bigint, until: ISODate, opts: { notify?: boolean } = {}) {
  const m = await currentMembership(userId);
  if (!m || !['active', 'registered'].includes(m.status) || !m.startsOn) throw forbidden('no_challenge', 'Нет идущего челленджа');
  const w = memberWindow(m);
  if (w.paused) throw badRequest('already_paused', 'Челлендж уже на паузе');
  if (w.phase === 'finished') throw badRequest('finished', 'Челлендж уже завершён');
  const today = w.today;
  if (until <= today) throw badRequest('bad_date', 'Дата окончания паузы — позже сегодняшнего дня');
  const gapDays = daysBetween(today, until);
  // ещё не начался — просто переносим старт
  if (w.phase === 'upcoming') {
    await prisma.flowMembership.update({ where: { id: m.id }, data: { startsOn: toDbDate(addDays(w.start, gapDays)) } });
  } else {
    await prisma.$transaction([
      prisma.taskOccurrence.deleteMany({ where: { membershipId: m.id, status: 'pending', windowEnd: { gte: toDbDate(today) } } }),
      prisma.flowMembership.update({ where: { id: m.id }, data: { pausedFrom: toDbDate(today), pausedUntil: toDbDate(until) } }),
    ]);
  }
  const months = Math.ceil(gapDays / 30);
  const subNote = await shiftSubscription(userId, months);
  console.log(`[freeze] ${userId}: пауза ${today} → ${until}, подписка: ${subNote}`);
  if (opts.notify !== false) {
    await tg('sendMessage', {
      chat_id: Number(userId),
      text: `❄️ Твой челлендж на паузе до ${humanDate(until)}.\n\nПрогресс, цели и отчёты сохранены. ${humanDate(until)} челлендж продолжится с того же дня, а подписка сдвинута — во время паузы оплата не спишется.\n\nЗахочешь вернуться раньше — нажми «Продолжить челлендж» на главной в приложении 💜`,
    }).catch(() => undefined);
  }
  return { from: today, until, subscription: subNote };
}

/** Сдвиг подписки на N месяцев: оплаченный период и дата автосписания (и у провайдера) */
async function shiftSubscription(userId: bigint, months: number) {
  if (months <= 0) return 'без изменений';
  const sub = await prisma.subscription.findFirst({ where: { userId, status: { in: ['prestart', 'active', 'past_due', 'canceled_at_period_end'] } }, orderBy: { createdAt: 'desc' } });
  if (!sub) return 'действующей подписки нет';
  if (sub.priceVariant === 'tribute') return 'подписка в Tribute — сдвинуть можно только там';
  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: sub.id },
      data: {
        paidThroughFlow: toDbDate(addMonths(fromDbDate(sub.paidThroughFlow), months)),
        ...(sub.nextChargeDate ? { nextChargeDate: toDbDate(addMonths(fromDbDate(sub.nextChargeDate), months)) } : {}),
      },
    }),
  ]);
  const sched = await prisma.billingSchedule.findMany({ where: { subscriptionId: sub.id, status: { in: ['scheduled', 'synced'] } } });
  for (const b of sched) {
    await prisma.billingSchedule.update({ where: { id: b.id }, data: { dueDate: toDbDate(addMonths(fromDbDate(b.dueDate), months)), coversFromFlow: toDbDate(addMonths(fromDbDate(b.coversFromFlow), months)), status: 'scheduled' } });
  }
  if (sub.providerSubscriptionId && sub.autoRenew) {
    const { syncChargeDate } = await import('./billing');
    await syncChargeDate(sub.id).catch((e) => console.warn('[freeze] sync charge date', (e as Error).message));
  }
  return `оплаченный период и автосписание сдвинуты на ${months} мес.`;
}

/** Продолжить челлендж: с сегодняшнего дня, с того же дня челленджа; задачи — заново до нового конца */
export async function resumeChallenge(membershipId: string, opts: { notify?: boolean } = {}) {
  const m = await prisma.flowMembership.findUnique({ where: { id: membershipId }, include: { flow: true, goals: { include: { tasks: true } } } });
  if (!m) throw notFound();
  if (!m.pausedFrom) return { resumed: false };
  const w = memberWindow(m);
  const today = w.today;
  const from = fromDbDate(m.pausedFrom);
  const gap = Math.max(0, daysBetween(from, today));
  const pauses = [...(Array.isArray(m.pauses) ? (m.pauses as { from: ISODate; to: ISODate }[]) : []), ...(gap > 0 ? [{ from, to: addDays(today, -1) }] : [])];
  const pausedDays = (m.pausedDays ?? 0) + gap;
  const after = memberWindow({ ...m, pausedFrom: null, pausedUntil: null, pausedDays, pauses });
  const done = await prisma.taskOccurrence.findMany({ where: { membershipId, status: { not: 'pending' } }, select: { taskId: true } });
  const doneOnce = new Set(done.map((d) => d.taskId));
  const rows = m.goals.flatMap((g) =>
    g.tasks.flatMap((t) => {
      if (t.frequency === 'once' && doneOnce.has(t.id)) return [];
      // одноразовая задача со сроком на паузе или позже — срок сдвигается на длину паузы
      const due = t.dueDate ? fromDbDate(t.dueDate) : null;
      const shifted = t.frequency === 'once' && due ? (due >= from ? addDays(due, gap) : today) : null;
      const dueDate = shifted && shifted > after.end ? after.end : shifted;
      return generateOccurrences({ frequency: t.frequency, n: t.n, dueDate }, after.start, { startsOn: today, endsOn: after.end })
        .filter((o) => o.windowEnd >= today)
        .map((o) => ({ taskId: t.id, membershipId, windowStart: toDbDate(o.windowStart < today ? today : o.windowStart), windowEnd: toDbDate(o.windowEnd), slot: o.slot }));
    }),
  );
  await prisma.$transaction([
    prisma.flowMembership.update({ where: { id: membershipId }, data: { pausedFrom: null, pausedUntil: null, pausedDays, pauses } }),
    prisma.taskOccurrence.deleteMany({ where: { membershipId, status: 'pending', windowEnd: { gte: toDbDate(today) } } }),
    prisma.taskOccurrence.createMany({ data: rows, skipDuplicates: true }),
  ]);
  if (opts.notify !== false) {
    await tg('sendMessage', { chat_id: Number(m.userId), text: `🔥 С возвращением! Твой челлендж снова идёт — сегодня ${after.day}-й день из 30. Цели и прогресс на месте, вперёд 💜` }).catch(() => undefined);
  }
  return { resumed: true, day: after.day, endsOn: after.end };
}

/** Участница сама нажала «Продолжить челлендж» */
export async function resumeOwn(userId: bigint) {
  const m = await currentMembership(userId);
  if (!m?.pausedFrom) throw badRequest('not_paused', 'Челлендж не на паузе');
  return resumeChallenge(m.id, { notify: false });
}

/** Каждый час: пауза закончилась — челлендж продолжается сам */
export async function resumeDueFreezes(now = clock.now()) {
  const list = await prisma.flowMembership.findMany({ where: { pausedFrom: { not: null }, pausedUntil: { not: null } }, include: { flow: true } });
  let resumed = 0;
  for (const m of list) {
    const w = memberWindow(m, now);
    if (m.pausedUntil && w.today >= fromDbDate(m.pausedUntil)) {
      await resumeChallenge(m.id);
      resumed++;
    }
  }
  return { resumed };
}
