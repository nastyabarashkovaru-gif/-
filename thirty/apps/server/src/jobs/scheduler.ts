import { addMonths, flowBounds, fromDbDate, localDate, startOfMonth, addDays } from '@thirty/domain';
import { clock } from '../clock';
import { prisma } from '../db';
import { getSetting } from '../settings';
import { ensureFlow, refreshFlowStatuses } from '../modules/flows';
import { refreshSubscriptionStatuses, syncChargeDate } from '../modules/billing';
import { autoMatch } from '../modules/buddy';
import { computeLeaderboard, selectPrizeCandidates } from '../modules/rating';
import { removeExpiredMembers } from '../modules/chats';
import { FINAL_WINDOW_DAYS } from '../modules/finale';
import { runFlowChains, runMeetingChains, runPostPurchaseChains, runPrePurchaseChains } from './chains';

const LOCK_ID = 30_300_030;

type Task = { name: string; everyMin: number; run: () => Promise<unknown> };

export const TASKS: Task[] = [
  { name: 'flows', everyMin: 1, run: maintainFlows },
  { name: 'subscriptions', everyMin: 30, run: refreshSubscriptionStatuses },
  { name: 'charge-date-sync', everyMin: 60, run: retryChargeDateSync },
  { name: 'buddy', everyMin: 15, run: buddyMatching },
  { name: 'leaderboard', everyMin: 10, run: leaderboards },
  { name: 'finalize', everyMin: 30, run: finalizeFlows },
  { name: 'chats-cleanup', everyMin: 60, run: removeExpiredMembers },
  { name: 'chains-pre', everyMin: 1, run: () => runPrePurchaseChains() },
  { name: 'chains-post', everyMin: 30, run: () => runPostPurchaseChains() },
  { name: 'chains-flow', everyMin: 15, run: () => runFlowChains() },
  { name: 'chains-meetings', everyMin: 5, run: () => runMeetingChains() },
];

/** Потоки на 2 месяца вперёд существуют всегда; статусы переводятся по календарю */
export async function maintainFlows() {
  const tz = await getSetting('flow.timezone');
  const cur = startOfMonth(localDate(clock.now(), tz));
  for (let i = 0; i <= 2; i++) await ensureFlow(addMonths(cur, i));
  await refreshFlowStatuses();
}

/** Автоподбор бадди: за сутки до старта и в первые дни потока (для поздних участников) */
export async function buddyMatching() {
  const flows = await prisma.flow.findMany({ where: { status: { not: 'finished' } } });
  for (const f of flows) {
    const startsOn = fromDbDate(f.startsOn);
    const today = localDate(clock.now(), f.timezone);
    if (today >= addDays(startsOn, -1) && today <= addDays(startsOn, 2)) await autoMatch(f.id);
  }
}

async function leaderboards() {
  for (const f of await prisma.flow.findMany({ where: { status: 'active' } })) await computeLeaderboard(f.id);
}

/** Финал: после окна итоговой анкеты — автоматический отбор претендентов в очередь ручной проверки */
export async function finalizeFlows() {
  for (const f of await prisma.flow.findMany({ where: { status: 'finished', finalizedAt: null } })) {
    const endsOn = flowBounds(fromDbDate(f.startsOn)).endsOn;
    if (localDate(clock.now(), f.timezone) <= addDays(endsOn, FINAL_WINDOW_DAYS)) continue;
    await selectPrizeCandidates(f.id);
    await prisma.flow.update({ where: { id: f.id }, data: { finalizedAt: clock.now() } });
  }
}

async function retryChargeDateSync() {
  const rows = await prisma.billingSchedule.findMany({ where: { status: 'scheduled', syncError: { not: null } }, take: 50 });
  for (const r of rows) await syncChargeDate(r.subscriptionId);
}

const lastRun = new Map<string, number>();

/** Один тик: под advisory lock, чтобы при нескольких инстансах задачи не шли параллельно */
export async function tick() {
  const [{ locked }] = await prisma.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${LOCK_ID}) AS locked`;
  if (!locked) return;
  try {
    for (const t of TASKS) {
      const prev = lastRun.get(t.name) ?? 0;
      if (Date.now() - prev < t.everyMin * 60_000 - 5_000) continue;
      lastRun.set(t.name, Date.now());
      try {
        await t.run();
      } catch (e) {
        console.error(`[job:${t.name}]`, (e as Error).message);
      }
    }
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_ID})`;
  }
}

export function startScheduler() {
  const timer = setInterval(() => void tick(), 60_000);
  void tick();
  return () => clearInterval(timer);
}
