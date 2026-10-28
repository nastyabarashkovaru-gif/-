import { MAIN_FUNNEL, funnelRates, localDate, addDays } from '@thirty/domain';
import { Prisma } from '@prisma/client';
import { clock } from '../clock';
import { prisma } from '../db';

export interface Range {
  from: Date;
  to: Date;
}

export interface FunnelFilters extends Range {
  tariffId?: string;
  variant?: string;
  device?: string;
}

/**
 * Сквозная воронка по когорте: пользователи, впервые пришедшие в периоде — нажали /start в боте
 * (первое приветствие в журнале бота) или сразу открыли приложение по прямой ссылке.
 * Шаг засчитывается, если пользователь совершил событие (и все предыдущие шаги) — абсолютные числа,
 * % от предыдущего шага, % от входа, медианное время до следующего шага.
 */
export async function funnel(f: FunnelFilters) {
  const extra: Prisma.Sql[] = [];
  if (f.variant) extra.push(Prisma.sql`AND EXISTS (SELECT 1 FROM "AnalyticsEvent" v WHERE v."userId" = c."userId" AND v.variant = ${f.variant})`);
  if (f.device) extra.push(Prisma.sql`AND EXISTS (SELECT 1 FROM "AnalyticsEvent" d WHERE d."userId" = c."userId" AND d.device = ${f.device})`);
  const cohort = await prisma.$queryRaw<{ userId: bigint; first: Date }[]>`
    SELECT c."userId", c.first FROM (
      SELECT "userId", MIN(ts) AS first FROM (
        SELECT "userId", ts FROM "AnalyticsEvent" WHERE "eventName" = 'app_open' AND "userId" IS NOT NULL
        UNION ALL
        SELECT "userId", "sentAt" AS ts FROM "BotMessageLog" WHERE "templateKey" = 'welcome' AND "sentAt" IS NOT NULL
      ) x GROUP BY "userId"
    ) c WHERE c.first >= ${f.from} AND c.first < ${f.to} ${extra.length ? Prisma.join(extra, ' ') : Prisma.empty}`;
  const ids = cohort.map((c) => c.userId);
  const firstTs = new Map<string, Date>(cohort.map((c) => [c.userId.toString(), c.first]));
  const steps: { key: string; title: string; count: number; medianMinToNext: number | null }[] = [];
  let current = new Set(ids.map(String));
  let prevTimes = firstTs;
  const breakdown: Record<string, number> = {};
  for (const [i, step] of MAIN_FUNNEL.entries()) {
    if (i === 0) {
      steps.push({ key: step.key, title: step.title, count: current.size, medianMinToNext: null });
      continue;
    }
    const where: Prisma.AnalyticsEventWhereInput = { userId: { in: [...current].map((x) => BigInt(x)) }, eventName: step.event };
    if (step.screen) where.screenId = step.screen;
    if (f.tariffId && ['tariff_select', 'payment_start', 'payment_success'].includes(step.event)) where.tariffId = f.tariffId;
    const rows = await prisma.analyticsEvent.groupBy({ by: ['userId'], where, _min: { ts: true } });
    const times = new Map(rows.map((r) => [r.userId!.toString(), r._min.ts!]));
    const deltas = rows.map((r) => (r._min.ts!.getTime() - (prevTimes.get(r.userId!.toString())?.getTime() ?? r._min.ts!.getTime())) / 60_000).filter((x) => x >= 0).sort((a, b) => a - b);
    steps[steps.length - 1].medianMinToNext = deltas.length ? Math.round(deltas[Math.floor(deltas.length / 2)]) : null;
    if (step.event === 'tariff_select') {
      const by = await prisma.analyticsEvent.groupBy({ by: ['tariffId'], where: { userId: { in: [...current].map((x) => BigInt(x)) }, eventName: 'tariff_select' }, _count: { _all: true } });
      for (const b of by) breakdown[b.tariffId ?? 'unknown'] = b._count._all;
    }
    current = new Set(rows.map((r) => r.userId!.toString()));
    prevTimes = times;
    steps.push({ key: step.key, title: step.title, count: current.size, medianMinToNext: null });
  }
  return { steps: funnelRates(steps).map((s, i) => ({ ...s, medianMinToNext: steps[i].medianMinToNext })), tariffClicks: breakdown, cohortSize: ids.length };
}

/** Аналитика по экранам: просмотры, уникальные, среднее время, выходы (последний экран сессии), ошибки */
export async function screens(r: Range) {
  const views = await prisma.$queryRaw<{ screen: string; views: bigint; users: bigint }[]>`
    SELECT "screenId" AS screen, COUNT(*) AS views, COUNT(DISTINCT "userId") AS users
    FROM "AnalyticsEvent" WHERE "eventName" = 'screen_view' AND ts >= ${r.from} AND ts < ${r.to} AND "screenId" IS NOT NULL
    GROUP BY "screenId" ORDER BY "screenId"`;
  const time = await prisma.$queryRaw<{ screen: string; avg_ms: number | null; errors: bigint }[]>`
    SELECT "screenId" AS screen, AVG(NULLIF(metadata->>'durationMs','')::float) AS avg_ms,
      COUNT(*) FILTER (WHERE (metadata->>'error') = 'true') AS errors
    FROM "AnalyticsEvent" WHERE "eventName" = 'screen_exit' AND ts >= ${r.from} AND ts < ${r.to} GROUP BY "screenId"`;
  const exits = await prisma.$queryRaw<{ screen: string; exits: bigint }[]>`
    SELECT screen, COUNT(*) AS exits FROM (
      SELECT DISTINCT ON ("sessionId") "screenId" AS screen FROM "AnalyticsEvent"
      WHERE "eventName" = 'screen_view' AND ts >= ${r.from} AND ts < ${r.to} AND "sessionId" <> 'server'
      ORDER BY "sessionId", ts DESC
    ) last GROUP BY screen`;
  const t = new Map(time.map((x) => [x.screen, x]));
  const e = new Map(exits.map((x) => [x.screen, Number(x.exits)]));
  return views.map((v) => ({
    screen: v.screen,
    views: Number(v.views),
    users: Number(v.users),
    avgSeconds: t.get(v.screen)?.avg_ms ? Math.round(t.get(v.screen)!.avg_ms! / 1000) : null,
    exits: e.get(v.screen) ?? 0,
    dropOffPct: Number(v.views) ? Math.round(((e.get(v.screen) ?? 0) / Number(v.views)) * 1000) / 10 : 0,
    errors: Number(t.get(v.screen)?.errors ?? 0),
  }));
}

/** Retention D1/D7/D14/D30 по дате первого открытия */
export async function retention(r: Range) {
  const rows = await prisma.$queryRaw<{ cohort: Date; size: bigint; d1: bigint; d7: bigint; d14: bigint; d30: bigint }[]>`
    WITH firsts AS (
      SELECT "userId", date_trunc('day', MIN(ts)) AS d0 FROM "AnalyticsEvent" WHERE "eventName" = 'app_open' AND "userId" IS NOT NULL GROUP BY "userId"
    ), days AS (
      SELECT DISTINCT e."userId", date_trunc('day', e.ts) AS d FROM "AnalyticsEvent" e WHERE e."eventName" = 'app_open' AND e."userId" IS NOT NULL
    )
    SELECT f.d0 AS cohort, COUNT(DISTINCT f."userId") AS size,
      COUNT(DISTINCT CASE WHEN dd.d = f.d0 + interval '1 day' THEN f."userId" END) AS d1,
      COUNT(DISTINCT CASE WHEN dd.d = f.d0 + interval '7 day' THEN f."userId" END) AS d7,
      COUNT(DISTINCT CASE WHEN dd.d = f.d0 + interval '14 day' THEN f."userId" END) AS d14,
      COUNT(DISTINCT CASE WHEN dd.d = f.d0 + interval '30 day' THEN f."userId" END) AS d30
    FROM firsts f LEFT JOIN days dd ON dd."userId" = f."userId"
    WHERE f.d0 >= ${r.from} AND f.d0 < ${r.to}
    GROUP BY f.d0 ORDER BY f.d0`;
  return rows.map((x) => {
    const size = Number(x.size);
    const pct = (n: bigint) => (size ? Math.round((Number(n) / size) * 1000) / 10 : 0);
    return { cohort: x.cohort.toISOString().slice(0, 10), size, d1: pct(x.d1), d7: pct(x.d7), d14: pct(x.d14), d30: pct(x.d30) };
  });
}

const distinctUsers = async (event: string, from: Date, to: Date) =>
  (await prisma.analyticsEvent.groupBy({ by: ['userId'], where: { eventName: event, ts: { gte: from, lt: to }, userId: { not: null } } })).length;

/** KPI дашборда A01 */
export async function dashboard(r: Range) {
  const now = clock.now();
  const day = 24 * 3600_000;
  const live = await prisma.subscription.findMany({ where: { status: { in: ['prestart', 'active', 'past_due', 'canceled_at_period_end'] } }, include: { tariff: true } });
  const mrr = Math.round(live.filter((s) => s.autoRenew).reduce((a, s) => a + s.renewalPrice / s.tariff.months, 0));
  const paid = await prisma.payment.aggregate({ where: { status: { in: ['paid', 'refunded'] }, paidAt: { gte: r.from, lt: r.to } }, _sum: { amount: true }, _count: true });
  const refunds = await prisma.payment.aggregate({ where: { status: 'refunded', refundedAt: { gte: r.from, lt: r.to } }, _sum: { amount: true }, _count: true });
  const activeFlows = await prisma.flow.findMany({ where: { status: 'active' } });
  const activeMembers = await prisma.flowMembership.count({ where: { flowId: { in: activeFlows.map((f) => f.id) }, status: 'active' } });
  const reports = await prisma.dailyReport.count({ where: { createdAt: { gte: r.from, lt: r.to }, status: 'accepted' } });
  const perfect = await prisma.leaderboardEntry.count({ where: { flowId: { in: activeFlows.map((f) => f.id) }, perfectSoFar: true } });
  const tz = 'Europe/Moscow';
  const today = localDate(now, tz);
  return {
    dau: await distinctUsers('app_open', new Date(now.getTime() - day), now),
    wau: await distinctUsers('app_open', new Date(now.getTime() - 7 * day), now),
    mau: await distinctUsers('app_open', new Date(now.getTime() - 30 * day), now),
    liveSubscriptions: live.length,
    subscriptionsByTariff: Object.fromEntries(['m1', 'm3', 'm6'].map((t) => [t, live.filter((s) => s.tariffId === t).length])),
    pastDue: live.filter((s) => s.status === 'past_due').length,
    canceledAtPeriodEnd: live.filter((s) => s.status === 'canceled_at_period_end').length,
    mrr,
    revenue: paid._sum.amount ?? 0,
    payments: paid._count,
    refunds: { amount: refunds._sum.amount ?? 0, count: refunds._count },
    renewals: {
      success: await prisma.payment.count({ where: { kind: { in: ['renewal', 'debt'] }, status: 'paid', paidAt: { gte: r.from, lt: r.to } } }),
      failed: await prisma.payment.count({ where: { kind: 'renewal', status: 'failed', createdAt: { gte: r.from, lt: r.to } } }),
    },
    churn: await prisma.subscription.count({ where: { canceledAt: { gte: r.from, lt: r.to } } }),
    activeMembers,
    reports,
    reportsPerActive: activeMembers ? Math.round((reports / activeMembers) * 10) / 10 : 0,
    perfectSoFar: perfect,
    prizeCandidatesAwaiting: await prisma.prizeCandidate.count({ where: { status: 'awaiting_review' } }),
    meetingClicks: await prisma.attendance.count({ where: { joinClickedAt: { gte: r.from, lt: r.to } } }),
    reviews: await prisma.review.count({ where: { createdAt: { gte: r.from, lt: r.to } } }),
    casesAllowed: await prisma.review.count({ where: { createdAt: { gte: r.from, lt: r.to }, consentRevokedAt: null, OR: [{ allowText: true }, { allowPhoto: true }] } }),
    cardsGenerated: await prisma.analyticsEvent.count({ where: { eventName: 'share_card_generated', ts: { gte: r.from, lt: r.to } } }),
    shareClicks: await prisma.analyticsEvent.count({ where: { eventName: 'share_clicked', ts: { gte: r.from, lt: r.to } } }),
    complaintsOpen: await prisma.complaint.count({ where: { status: 'open' } }),
    needsRefund: await prisma.payment.count({ where: { needsRefund: true } }),
    today,
    yesterday: addDays(today, -1),
  };
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Защита от CSV-инъекций формул в Excel
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(';'), ...rows.map((r) => cols.map((c) => esc(r[c])).join(';'))].join('\n');
}
