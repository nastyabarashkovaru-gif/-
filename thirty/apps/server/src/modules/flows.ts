import { flowBounds, flowPhase, fromDbDate, localDate, toDbDate, type ISODate } from '@thirty/domain';
import type { Flow, FlowMembership } from '@prisma/client';
import { clock } from '../clock';
import { prisma, type Tx } from '../db';
import { getSetting } from '../settings';

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
 * Текущее членство пользователя: активный поток, иначе ближайший оплаченный предстоящий,
 * иначе последний завершённый (для финала и архива).
 */
export async function currentMembership(userId: bigint): Promise<(FlowMembership & { flow: Flow }) | null> {
  const list = await prisma.flowMembership.findMany({
    where: { userId, status: { not: 'revoked' } },
    include: { flow: true },
    orderBy: { flow: { startsOn: 'asc' } },
  });
  if (!list.length) return null;
  const now = clock.now();
  const active = list.find((m) => flowInfo(m.flow, now).phase === 'active');
  if (active) return active;
  const upcoming = list.find((m) => flowInfo(m.flow, now).phase === 'upcoming');
  if (upcoming) {
    // Сразу после финала показываем завершённый поток, пока не начался следующий
    const finished = [...list].reverse().find((m) => flowInfo(m.flow, now).phase === 'finished');
    if (finished && !finished.finalSubmittedAt) return finished;
    return upcoming;
  }
  return list[list.length - 1];
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
    await prisma.flow.update({ where: { id: flow.id }, data: { status: info.phase } });
    if (info.phase === 'active') {
      // Старт: зафиксированные анкеты блокируются, участники становятся активными
      await prisma.flowMembership.updateMany({
        where: { flowId: flow.id, status: 'registered' },
        data: { status: 'active', goalsLockedAt: now },
      });
    }
    if (info.phase === 'finished') {
      await prisma.flowMembership.updateMany({ where: { flowId: flow.id, status: 'active' }, data: { status: 'finished' } });
    }
  }
}
