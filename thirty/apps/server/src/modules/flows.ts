import { addDays, addMonths, challengeBounds, challengeDay, challengePhase, flowBounds, flowPhase, fromDbDate, localDate, toDbDate, type ISODate } from '@thirty/domain';
import type { Flow, FlowMembership } from '@prisma/client';
import { clock } from '../clock';
import { prisma, type Tx } from '../db';
import { getSetting } from '../settings';
import { track } from './analytics';

export async function ensureFlow(startsOn: ISODate, db: Tx | typeof prisma = prisma): Promise<Flow> {
  const b = flowBounds(startsOn);
  const tz = await getSetting('flow.timezone');
  return db.flow.upsert({
    where: { startsOn: toDbDate(b.startsOn) },
    create: { startsOn: toDbDate(b.startsOn), endsOn: toDbDate(b.endsOn), title: b.title, timezone: tz },
    update: {},
  });
}

export function flowToday(flow: Pick<Flow, 'timezone'>, now = clock.now()): ISODate {
  return localDate(now, flow.timezone);
}

export function flowInfo(flow: Flow, now = clock.now()) {
  const startsOn = fromDbDate(flow.startsOn);
  const today = flowToday(flow, now);
  const b = flowBounds(startsOn);
  return { id: flow.id, startsOn, endsOn: b.endsOn, days: b.days, title: flow.title, timezone: flow.timezone, today, phase: flowPhase(startsOn, today) };
}

/**
 * Окно личного челленджа (ТЗ 02.11): 30 дней от личной даты старта. Дата ещё не выбрана — ориентир:
 * не раньше сегодняшнего дня и не раньше месяца, к которому относится участие (челлендж пока не начался).
 */
export function memberWindow(m: { startsOn: Date | null; flow: Flow }, now = clock.now()) {
  const today = flowToday(m.flow, now);
  const chosen = m.startsOn ? fromDbDate(m.startsOn) : null;
  const flowStart = fromDbDate(m.flow.startsOn);
  const start = chosen ?? (flowStart > today ? flowStart : today);
  const b = challengeBounds(start);
  // не выбранная дата: челлендж считается ещё не начавшимся
  const phase = chosen ? challengePhase(b.startsOn, b.endsOn, today) : ('upcoming' as const);
  return { start: b.startsOn, end: b.endsOn, days: b.days, today, phase, day: chosen ? challengeDay(b.startsOn, b.endsOn, today) : 0, chosen: Boolean(chosen) };
}

/** Сведения о челлендже для клиента: те же поля, что у потока (startsOn/endsOn/days/phase), но личные */
export function challengeInfo(m: { startsOn: Date | null; flow: Flow }, now = clock.now()) {
  const w = memberWindow(m, now);
  return { id: m.flow.id, startsOn: w.start, endsOn: w.end, days: w.days, title: m.flow.title, timezone: m.flow.timezone, today: w.today, phase: w.phase, day: w.day, chosen: w.chosen };
}

/**
 * Текущее участие: идущий челлендж, иначе ближайший предстоящий (сразу после финала — завершённый,
 * пока не подведены итоги), иначе последний завершённый (для финала и архива).
 */
export async function currentMembership(userId: bigint): Promise<(FlowMembership & { flow: Flow }) | null> {
  const list = await prisma.flowMembership.findMany({
    where: { userId, status: { not: 'revoked' } },
    include: { flow: true },
    orderBy: [{ startsOn: 'asc' }, { flow: { startsOn: 'asc' } }],
  });
  if (!list.length) return null;
  const now = clock.now();
  const active = list.find((m) => memberWindow(m, now).phase === 'active');
  if (active) return active;
  const upcoming = list.filter((m) => memberWindow(m, now).phase === 'upcoming').sort((a, b) => (memberWindow(a, now).start < memberWindow(b, now).start ? -1 : 1))[0];
  if (upcoming) {
    const finished = [...list].reverse().find((m) => memberWindow(m, now).phase === 'finished');
    if (finished && !finished.finalSubmittedAt) return finished;
    return upcoming;
  }
  return list[list.length - 1];
}

/**
 * Участие, для которого заполняется анкета: обычно текущее. С последнего дня потока, когда анкета текущего
 * уже зафиксирована, — следующий оплаченный поток («Поставить новую цель»): старые цели и отчёты не трогаем.
 */
export async function planningMembership(userId: bigint): Promise<(FlowMembership & { flow: Flow }) | null> {
  const m = await currentMembership(userId);
  if (!m || !m.goalsLockedAt || !['active', 'finished'].includes(m.status)) return m;
  const w = memberWindow(m);
  if (w.today < w.end) return m;
  const next = await prisma.flowMembership.findFirst({
    where: { userId, id: { not: m.id }, status: { in: ['reserved', 'registered'] }, goalsLockedAt: null },
    include: { flow: true },
    orderBy: { flow: { startsOn: 'asc' } },
  });
  if (next) return next;
  // «Поставить новую цель» (ТЗ 02.11): подписка действует — следующий личный челлендж создаётся сразу
  return (await createNextChallenge(userId, m, w.end)) ?? m;
}

/** Следующий 30-дневный челлендж при действующей подписке: «контейнер» — месяц, следующий за окончанием текущего */
async function createNextChallenge(userId: bigint, m: FlowMembership & { flow: Flow }, currentEnd: ISODate) {
  const { LIVE_STATUSES } = await import('./billing');
  const sub = await prisma.subscription.findFirst({ where: { userId, status: { in: [...LIVE_STATUSES] } }, orderBy: { createdAt: 'desc' } });
  if (!sub) return null;
  let month = `${addDays(currentEnd, 1).slice(0, 7)}-01`;
  for (let i = 0; i < 3; i++) {
    const flow = await ensureFlow(month);
    const taken = await prisma.flowMembership.findUnique({ where: { userId_flowId: { userId, flowId: flow.id } } });
    if (!taken) {
      const created = await prisma.flowMembership.create({ data: { userId, flowId: flow.id, subscriptionId: sub.id, tariffId: sub.tariffId, buddyMode: m.buddyMode } });
      return prisma.flowMembership.findUniqueOrThrow({ where: { id: created.id }, include: { flow: true } });
    }
    if (taken.status === 'reserved' && !taken.goalsLockedAt) return prisma.flowMembership.findUniqueOrThrow({ where: { id: taken.id }, include: { flow: true } });
    month = addMonths(month, 1);
  }
  return null;
}

/**
 * Участие для главной: обычно текущее. Если в последний день потока итоги подведены, а анкета следующего
 * потока уже заполнена — показываем следующий поток (обратный отсчёт до нового старта).
 */
export async function homeMembership(userId: bigint): Promise<(FlowMembership & { flow: Flow }) | null> {
  const m = await currentMembership(userId);
  if (!m || !m.finalSubmittedAt || !['active', 'finished'].includes(m.status)) return m;
  const w = memberWindow(m);
  if (w.today < w.end) return m;
  const next = await prisma.flowMembership.findFirst({
    where: { userId, id: { not: m.id }, status: 'registered', goalsLockedAt: { not: null } },
    include: { flow: true },
    orderBy: { startsOn: 'asc' },
  });
  return next ?? m;
}

/** Какой по счёту месяц участия (1, 2, 3…): от него зависит цвет темы и плашка «твой N-й месяц дисциплины» */
export async function monthNumber(userId: bigint, m: Pick<FlowMembership, 'id'> & { flow: Pick<Flow, 'startsOn'> }) {
  return prisma.flowMembership.count({ where: { userId, status: { not: 'revoked' }, flow: { startsOn: { lte: m.flow.startsOn } } } });
}

/** Поток, предшествующий данному, у того же пользователя (для сравнения месяцев) */
export async function previousMembership(userId: bigint, flowStartsOn: Date) {
  return prisma.flowMembership.findFirst({
    where: { userId, status: { not: 'revoked' }, flow: { startsOn: { lt: flowStartsOn } } },
    include: { flow: true },
    orderBy: { flow: { startsOn: 'desc' } },
  });
}

/** Переводит потоки и членства по статусам; идемпотентно */
export async function refreshFlowStatuses(now = clock.now()) {
  const flows = await prisma.flow.findMany({ where: { status: { not: 'finished' } } });
  for (const flow of flows) {
    const info = flowInfo(flow, now);
    if (info.phase === flow.status) continue;
    // Поток — только «контейнер» месяца (чаты, архив); статусы участий — по личным датам (ниже)
    await prisma.flow.update({ where: { id: flow.id }, data: { status: info.phase } });
  }
  await refreshChallengeStatuses(now);
}

/**
 * Личные челленджи: в дату старта анкета блокируется и участница становится активной (бот поздравляет),
 * через 30 дней — завершённой. Идемпотентно.
 */
export async function refreshChallengeStatuses(now = clock.now()) {
  const list = await prisma.flowMembership.findMany({ where: { status: { in: ['registered', 'active'] }, startsOn: { not: null } }, include: { flow: true } });
  for (const m of list) {
    const w = memberWindow(m, now);
    if (m.status === 'registered' && w.phase !== 'upcoming') {
      await prisma.flowMembership.update({ where: { id: m.id }, data: { status: w.phase === 'finished' ? 'finished' : 'active', goalsLockedAt: m.goalsLockedAt ?? now } });
      await track({ userId: m.userId, eventName: 'challenge_started', flowId: m.flowId, dedupeKey: `challenge_started:${m.id}` });
      const { notify } = await import('./notify');
      await notify(m.userId, 'challenge_started', { day_count: w.days }, `challenge_started:${m.id}`).catch(() => undefined);
    } else if (m.status === 'active' && w.phase === 'finished') {
      await prisma.flowMembership.update({ where: { id: m.id }, data: { status: 'finished' } });
      await track({ userId: m.userId, eventName: 'challenge_completed', flowId: m.flowId, dedupeKey: `challenge_completed:${m.id}` });
    }
  }
}
