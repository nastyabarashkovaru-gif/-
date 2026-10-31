import { addDays, addMonths, coverage, fromDbDate, localDate, startOfLocalDay, type ISODate } from '@thirty/domain';
import { clock } from '../clock';
import { prisma } from '../db';
import { getSetting } from '../settings';
import { LIVE_STATUSES } from './billing';
import { displayName } from './users';

/**
 * Главный экран админки: воронка «бот → оплата», динамика, деньги, тарифы, удержание, участники.
 * Все числа — уникальные люди из реальных данных; тестовые оплаты не учитываются.
 *
 * Когорта периода — люди, впервые пришедшие в эти дни: первый /start в боте или (если пришли по прямой ссылке) первое открытие
 * приложения. Шаги воронки считаются для этой когорты без ограничения по времени: открыла тарифы сегодня, оплатила завтра — переход засчитан.
 * Человек «дошёл до этапа», если совершил его или любой следующий (пропуск онбординга не выбивает из воронки).
 */

export interface DayRange {
  from: ISODate; // включительно, по времени потока
  to: ISODate; // включительно
}

type Step = { key: string; title: string; short: string; event?: string; screen?: string };
export const HOME_STEPS: Step[] = [
  { key: 'bot', title: 'Открыли бота', short: 'Бот' },
  // 31.10: знакомство перенесено в бота — экраны онбординга убраны, приложение открывается сразу на тарифах
  { key: 'how', title: 'Нажали «Ознакомился, как вступить?» в боте', short: 'Как вступить', event: 'bot_how_to_join_click' },
  { key: 'app', title: 'Открыли приложение', short: 'Приложение', event: 'app_open' },
  { key: 'tariffs', title: 'Экран тарифов', short: 'Тарифы', event: 'tariff_view' },
  // «Присоединиться» под тарифами → экран оформления; «Оплатить» там → страница оплаты CloudPayments
  { key: 'select', title: 'Нажали «Присоединиться» (под тарифами)', short: 'Присоединиться', event: 'tariff_join_click' },
  { key: 'pay_click', title: 'Нажали «Оплатить» (экран оформления)', short: 'Оплатить', event: 'payment_start' },
  { key: 'paid', title: 'Оплатили', short: 'Оплата' },
];
const STEP_EVENTS = [...new Set(HOME_STEPS.flatMap((s) => (s.event ? [s.event] : [])))];

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const change = (cur: number, prev: number | null) => (prev === null ? null : prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / prev) * 1000) / 10);
const daysBetween = (from: ISODate, to: ISODate) => Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1;

async function tz() {
  return getSetting('flow.timezone');
}

/** Первое касание каждого человека: /start (приветствие в журнале бота) или открытие приложения */
async function firstTouches() {
  const rows = await prisma.$queryRaw<{ userId: bigint; first: Date; viaBot: boolean }[]>`
    SELECT "userId", MIN(ts) AS first, bool_or(src = 'bot') AS "viaBot" FROM (
      SELECT "userId", ts, 'app' AS src FROM "AnalyticsEvent" WHERE "eventName" = 'app_open' AND "userId" IS NOT NULL
      UNION ALL
      SELECT "userId", ts, 'bot' AS src FROM "AnalyticsEvent" WHERE "eventName" = 'bot_start' AND "userId" IS NOT NULL
      UNION ALL
      SELECT "userId", "sentAt" AS ts, 'bot' AS src FROM "BotMessageLog" WHERE "templateKey" = 'welcome'
    ) x GROUP BY "userId"`;
  return rows;
}

/** Первые успешные покупки (не тестовые): кто, когда, тариф, сумма */
async function firstPurchases() {
  const rows = await prisma.payment.findMany({
    where: { kind: 'initial', status: { in: ['paid', 'refunded'] }, test: false, paidAt: { not: null } },
    orderBy: { paidAt: 'asc' },
    select: { userId: true, paidAt: true, tariffId: true, amount: true, status: true },
  });
  const first = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!first.has(r.userId.toString())) first.set(r.userId.toString(), r);
  return first;
}

async function funnelFor(cohort: bigint[], purchases: Map<string, { paidAt: Date | null }>) {
  const reached = HOME_STEPS.map(() => new Set<string>());
  const at = HOME_STEPS.map(() => new Map<string, number>());
  if (cohort.length) {
    const events = await prisma.analyticsEvent.groupBy({
      by: ['userId', 'eventName', 'screenId'],
      where: { userId: { in: cohort }, eventName: { in: STEP_EVENTS } },
      _min: { ts: true },
    });
    for (const e of events) {
      HOME_STEPS.forEach((s, i) => {
        if (s.event === e.eventName && (!s.screen || s.screen === e.screenId)) {
          const id = e.userId!.toString();
          reached[i].add(id);
          const t = e._min.ts!.getTime();
          at[i].set(id, Math.min(at[i].get(id) ?? t, t));
        }
      });
    }
  }
  for (const id of cohort.map(String)) {
    reached[0].add(id);
    const p = purchases.get(id);
    if (p) {
      reached[HOME_STEPS.length - 1].add(id);
      at[HOME_STEPS.length - 1].set(id, p.paidAt!.getTime());
    }
  }
  // «Дошёл до этапа» = совершил его или любой следующий
  for (let i = HOME_STEPS.length - 2; i >= 0; i--) for (const id of reached[i + 1]) reached[i].add(id);
  const counts = reached.map((s) => s.size);
  return HOME_STEPS.map((s, i) => {
    const prev = i === 0 ? counts[0] : counts[i - 1];
    // Медиана времени от предыдущего шага (минуты) — по тем, у кого известны оба момента
    const deltas: number[] = [];
    if (i > 0) for (const [id, t] of at[i]) {
      const p = at[i - 1].get(id);
      if (p !== undefined && t >= p) deltas.push((t - p) / 60_000);
    }
    deltas.sort((a, b) => a - b);
    return {
      key: s.key, title: s.title, short: s.short,
      count: counts[i],
      pctPrev: i === 0 ? 100 : pct(counts[i], prev),
      pctStart: pct(counts[i], counts[0]),
      lost: i === 0 ? 0 : Math.max(0, prev - counts[i]),
      lostPct: i === 0 ? 0 : prev > 0 ? Math.round(((prev - counts[i]) / prev) * 1000) / 10 : null,
      medianMinutes: deltas.length ? Math.round(deltas[Math.floor(deltas.length / 2)]) : null,
    };
  });
}

function summarize(steps: Awaited<ReturnType<typeof funnelFor>>) {
  const by = (k: string) => steps.find((s) => s.key === k)!.count;
  const bot = by('bot'), app = by('app'), tariffs = by('tariffs'), paid = by('paid');
  return {
    bot, app, tariffs, paid,
    conv: { botToApp: pct(app, bot), appToTariffs: pct(tariffs, app), tariffsToPaid: pct(paid, tariffs), botToPaid: pct(paid, bot) },
  };
}

/** Наибольший отток между соседними шагами (среди шагов, где было кому отвалиться) */
function worstStep(steps: Awaited<ReturnType<typeof funnelFor>>) {
  let worst: { from: string; to: string; lostPct: number; lost: number } | null = null;
  for (let i = 1; i < steps.length; i++) {
    const s = steps[i];
    if (s.lostPct === null || steps[i - 1].count < 1 || s.lost < 1) continue;
    if (!worst || s.lostPct > worst.lostPct) worst = { from: steps[i - 1].short, to: s.short, lostPct: s.lostPct, lost: s.lost };
  }
  return worst;
}

async function cohortOf(touches: Awaited<ReturnType<typeof firstTouches>>, r: DayRange, zone: string) {
  const from = startOfLocalDay(r.from, zone).getTime();
  const to = startOfLocalDay(addDays(r.to, 1), zone).getTime();
  return touches.filter((t) => t.first.getTime() >= from && t.first.getTime() < to);
}

/** Сравнимый предыдущий период той же длины */
export function previousRange(r: DayRange): DayRange {
  const n = daysBetween(r.from, r.to);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}

/** Есть ли вообще данные до начала периода (иначе сравнение «к прошлому периоду» не показываем) */
function hasHistoryBefore(touches: { first: Date }[], r: DayRange, zone: string) {
  const from = startOfLocalDay(r.from, zone).getTime();
  return touches.some((t) => t.first.getTime() < from);
}

export async function resolveRange(q: { from?: string; to?: string; period?: string }): Promise<DayRange & { period: string }> {
  const zone = await tz();
  const today = localDate(clock.now(), zone);
  const iso = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? (s as ISODate) : null);
  const period = q.period ?? (iso(q.from) ? 'custom' : '30d');
  if (period === 'custom' && iso(q.from)) {
    const from = iso(q.from)!, to = iso(q.to) ?? today;
    return from <= to ? { from, to, period } : { from: to, to: from, period };
  }
  if (period === 'today') return { from: today, to: today, period };
  if (period === '7d') return { from: addDays(today, -6), to: today, period };
  if (period === 'all') {
    const first = await prisma.$queryRaw<{ m: Date | null }[]>`
      SELECT LEAST((SELECT MIN(ts) FROM "AnalyticsEvent"), (SELECT MIN("sentAt") FROM "BotMessageLog" WHERE "templateKey" = 'welcome'), (SELECT MIN("paidAt") FROM "Payment" WHERE NOT test)) AS m`;
    const m = first[0]?.m;
    return { from: m ? localDate(m, zone) : today, to: today, period };
  }
  return { from: addDays(today, -29), to: today, period: '30d' };
}

/** Блоки 1–3: карточки воронки, воронка по экранам, динамика по дням */
export async function homeFunnel(r: DayRange) {
  const zone = await tz();
  const [touches, purchases] = await Promise.all([firstTouches(), firstPurchases()]);
  const cohort = await cohortOf(touches, r, zone);
  const steps = await funnelFor(cohort.map((c) => c.userId), purchases);
  const cur = summarize(steps);
  const prevR = previousRange(r);
  const hasPrev = hasHistoryBefore(touches, r, zone);
  const prev = hasPrev ? summarize(await funnelFor((await cohortOf(touches, prevR, zone)).map((c) => c.userId), purchases)) : null;

  // Динамика по дням: новые люди, открытия приложения, просмотры тарифов (уникальные за день), оплаты, конверсия когорты дня
  const days: ISODate[] = [];
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) days.push(d);
  const prevDays = days.map((_, i) => addDays(prevR.from, i));
  const fromTs = startOfLocalDay(prevR.from, zone), toTs = startOfLocalDay(addDays(r.to, 1), zone);
  const daily = await prisma.$queryRaw<{ eventName: string; userId: bigint; ts: Date }[]>`
    SELECT DISTINCT ON ("eventName", "userId", date_trunc('day', ts AT TIME ZONE ${zone})) "eventName", "userId", ts
    FROM "AnalyticsEvent" WHERE "eventName" IN ('app_open', 'tariff_view') AND "userId" IS NOT NULL AND ts >= ${fromTs} AND ts < ${toTs}`;
  const pays = await prisma.payment.findMany({ where: { status: { in: ['paid', 'refunded'] }, test: false, paidAt: { gte: fromTs, lt: toTs } }, select: { paidAt: true, kind: true, userId: true } });
  const series = (list: ISODate[]) => {
    const idx = new Map(list.map((d, i) => [d, i]));
    const z = () => list.map(() => 0);
    const out = { bot: z(), app: z(), tariffs: z(), payments: z(), conv: list.map(() => null as number | null) };
    const cohortDay = new Map<string, number>();
    for (const t of touches) {
      const i = idx.get(localDate(t.first, zone));
      if (i !== undefined) { out.bot[i]++; cohortDay.set(t.userId.toString(), i); }
    }
    for (const e of daily) {
      const i = idx.get(localDate(e.ts, zone));
      if (i === undefined) continue;
      if (e.eventName === 'app_open') out.app[i]++;
      else out.tariffs[i]++;
    }
    for (const p of pays) {
      const i = idx.get(localDate(p.paidAt!, zone));
      if (i !== undefined && p.kind === 'initial') out.payments[i]++;
    }
    const paidByDay = list.map(() => 0);
    for (const [id, i] of cohortDay) if (purchases.has(id)) paidByDay[i]++;
    out.conv = list.map((_, i) => (out.bot[i] ? Math.round((paidByDay[i] / out.bot[i]) * 1000) / 10 : null));
    return out;
  };

  return {
    range: r,
    previous: hasPrev ? prevR : null,
    cards: {
      bot: { count: cur.bot, change: prev ? change(cur.bot, prev.bot) : null },
      app: { count: cur.app, ofPrev: cur.conv.botToApp, change: prev ? change(cur.app, prev.app) : null },
      tariffs: { count: cur.tariffs, ofPrev: cur.conv.appToTariffs, change: prev ? change(cur.tariffs, prev.tariffs) : null },
      paid: { count: cur.paid, ofPrev: cur.conv.tariffsToPaid, change: prev ? change(cur.paid, prev.paid) : null },
    },
    hero: {
      botToPaid: cur.conv.botToPaid,
      previous: prev?.conv.botToPaid ?? null,
      // Изменение в процентных пунктах
      deltaPp: prev && cur.conv.botToPaid !== null && prev.conv.botToPaid !== null ? Math.round((cur.conv.botToPaid - prev.conv.botToPaid) * 10) / 10 : null,
    },
    conversions: cur.conv,
    steps,
    worst: worstStep(steps),
    daily: { days, prevDays: hasPrev ? prevDays : null, current: series(days), previous: hasPrev ? series(prevDays) : null },
    note: cohort.some((c) => !c.viaBot) ? 'В «Открыли бота» входят и те, кто открыл приложение по прямой ссылке, минуя /start.' : null,
  };
}

const KIND_TITLE: Record<string, string> = { initial: 'Первая покупка', renewal: 'Продление', debt: 'Продление (долг)', upsell: 'Доп. покупка' };

/** Блок 4–5: деньги и тарифы за период. Выручка — только успешные не тестовые оплаты; возвращённые не входят */
export async function homeMoney(r: DayRange) {
  const zone = await tz();
  const from = startOfLocalDay(r.from, zone), to = startOfLocalDay(addDays(r.to, 1), zone);
  const prevR = previousRange(r);
  const pFrom = startOfLocalDay(prevR.from, zone);
  const paid = await prisma.payment.findMany({ where: { status: 'paid', test: false, paidAt: { gte: pFrom, lt: to } }, select: { amount: true, paidAt: true, kind: true, userId: true, tariffId: true } });
  const refunded = await prisma.payment.aggregate({ where: { status: 'refunded', test: false, refundedAt: { gte: from, lt: to } }, _sum: { amount: true }, _count: true });
  const inCur = paid.filter((p) => p.paidAt! >= from);
  const inPrev = paid.filter((p) => p.paidAt! < from);
  const anyBefore = (await prisma.payment.count({ where: { status: { in: ['paid', 'refunded'] }, test: false, paidAt: { lt: from } } })) > 0;
  const sum = (l: typeof paid) => l.reduce((a, p) => a + p.amount, 0);
  const revenue = sum(inCur);
  const days: ISODate[] = [];
  for (let d = r.from; d <= r.to; d = addDays(d, 1)) days.push(d);
  const idx = new Map(days.map((d, i) => [d, i]));
  const revByDay = days.map(() => 0), cntByDay = days.map(() => 0);
  for (const p of inCur) {
    const i = idx.get(localDate(p.paidAt!, zone));
    if (i !== undefined) { revByDay[i] += p.amount; cntByDay[i]++; }
  }
  const prevRev = days.map(() => 0), prevCnt = days.map(() => 0);
  for (const p of inPrev) {
    const i = Math.round((Date.parse(localDate(p.paidAt!, zone)) - Date.parse(prevR.from)) / 86400_000);
    if (i >= 0 && i < days.length) { prevRev[i] += p.amount; prevCnt[i]++; }
  }

  // Тарифы: первые покупки за период (продление того же тарифа — не новая покупка)
  const tariffs = await prisma.tariff.findMany({ orderBy: [{ sort: 'asc' }, { months: 'asc' }] });
  const initial = inCur.filter((p) => p.kind === 'initial');
  const byTariff = tariffs
    .map((t) => {
      const l = initial.filter((p) => p.tariffId === t.id);
      return { id: t.id, title: t.title, months: t.months, count: l.length, revenue: sum(l), pct: pct(l.length, initial.length) };
    })
    .filter((t) => t.count > 0 || tariffs.find((x) => x.id === t.id)?.active);
  const top = [...byTariff].sort((a, b) => b.count - a.count)[0];

  const recent = await prisma.payment.findMany({
    where: { test: false, status: { in: ['paid', 'refunded', 'failed', 'disputed'] }, OR: [{ paidAt: { gte: from, lt: to } }, { paidAt: null, createdAt: { gte: from, lt: to } }] },
    orderBy: { createdAt: 'desc' }, take: 8, include: { user: true },
  });
  const tariffTitle = new Map(tariffs.map((t) => [t.id, t.title]));

  return {
    revenue,
    revenueChange: anyBefore ? change(revenue, sum(inPrev)) : null,
    payments: inCur.length,
    buyers: new Set(inCur.map((p) => p.userId.toString())).size,
    avgCheck: inCur.length ? Math.round(revenue / inCur.length) : 0,
    newPurchases: initial.length,
    renewals: inCur.filter((p) => p.kind === 'renewal' || p.kind === 'debt').length,
    refunds: { amount: refunded._sum.amount ?? 0, count: refunded._count },
    daily: { days, revenue: revByDay, count: cntByDay, prevRevenue: anyBefore ? prevRev : null, prevCount: anyBefore ? prevCnt : null },
    tariffs: byTariff,
    topTariff: top && top.count > 0 ? { title: top.title, pct: top.pct } : null,
    recent: recent.map((p) => ({
      id: p.id, at: p.paidAt ?? p.createdAt, name: displayName(p.user), userId: p.userId.toString(), tariff: p.tariffId ? tariffTitle.get(p.tariffId) ?? p.tariffId : '—',
      amount: p.amount, kind: p.kind, kindTitle: KIND_TITLE[p.kind] ?? p.kind, status: p.status,
    })),
  };
}

/**
 * Блок 6: удержание. Оплаченный период — непрерывный блок месяцев из одной оплаты (первая покупка, продление или долг).
 * Момент решения — начало месяца после блока. Учитываем только наступившие моменты (или уже оплаченные досрочно):
 * продлила — следующий месяц оплачен любым способом (автосписание, долг, новая покупка), не продлила — месяц наступил, а оплаты нет.
 * Пока срок не вышел, человек не считается ушедшим. Возвращённые оплаты не дают продления.
 */
export async function homeRetention(r: DayRange) {
  const zone = await tz();
  const today = localDate(clock.now(), zone);
  const thisMonth = `${today.slice(0, 7)}-01` as ISODate;
  const pays = await prisma.payment.findMany({
    where: { status: 'paid', test: false, kind: { in: ['initial', 'renewal', 'debt'] }, coversFromFlow: { not: null }, months: { not: null } },
    select: { userId: true, coversFromFlow: true, months: true, kind: true },
  });
  const covered = new Map<string, Set<ISODate>>();
  const blocks: { user: string; last: ISODate }[] = [];
  for (const p of pays) {
    const flows = coverage(fromDbDate(p.coversFromFlow!), p.months!);
    const id = p.userId.toString();
    const set = covered.get(id) ?? new Set<ISODate>();
    flows.forEach((f) => set.add(f));
    covered.set(id, set);
    blocks.push({ user: id, last: flows[flows.length - 1] });
  }
  const seen = new Set<string>();
  const decisions: { user: string; month: ISODate; renewed: boolean }[] = [];
  for (const b of blocks) {
    const next = addMonths(b.last, 1);
    const key = `${b.user}:${next}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const renewed = covered.get(b.user)!.has(next);
    // Срок ещё не вышел — решение не наступило: человек не считается ушедшим, а досрочное продление засчитается, когда придёт этот месяц
    if (next > thisMonth) continue;
    decisions.push({ user: b.user, month: next, renewed });
  }
  // Период: решения, срок которых пришёлся на выбранные месяцы (для «Всё время» — все)
  const fromM = `${r.from.slice(0, 7)}-01`, toM = `${r.to.slice(0, 7)}-01`;
  const inRange = decisions.filter((d) => d.month >= fromM && d.month <= toM);
  const renewed = inRange.filter((d) => d.renewed).length;
  const notRenewed = inRange.length - renewed;
  const live = await prisma.subscription.count({ where: { status: { in: [...LIVE_STATUSES] }, test: false } });
  const months = [...new Set(decisions.map((d) => d.month))].sort().slice(-12);
  const trend = months.map((m) => {
    const l = decisions.filter((d) => d.month === m);
    return { month: m, due: l.length, renewed: l.filter((d) => d.renewed).length, pct: pct(l.filter((d) => d.renewed).length, l.length) };
  });
  // Когорты по месяцу первого оплаченного потока: доля, у кого оплачен k-й месяц (только наступившие месяцы)
  const firstMonth = new Map<string, ISODate>();
  for (const [id, set] of covered) firstMonth.set(id, [...set].sort()[0]);
  const cohorts = [...new Set(firstMonth.values())].filter((m) => m <= thisMonth).sort().slice(-12).map((m) => {
    const users = [...firstMonth].filter(([, f]) => f === m).map(([id]) => id);
    const cells: (number | null)[] = [];
    for (let k = 0; k < 6; k++) {
      const mk = addMonths(m, k);
      if (mk > thisMonth) { cells.push(null); continue; }
      cells.push(pct(users.filter((id) => covered.get(id)!.has(mk)).length, users.length));
    }
    return { month: m, size: users.length, cells };
  });
  const failedCharges = await prisma.payment.count({ where: { kind: 'renewal', status: 'failed', test: false } });
  const pastDue = await prisma.subscription.count({ where: { status: 'past_due', test: false } });
  const canceling = await prisma.subscription.count({ where: { status: 'canceled_at_period_end', test: false } });
  return {
    due: inRange.length, renewed, notRenewed,
    renewedPct: pct(renewed, inRange.length), churnPct: pct(notRenewed, inRange.length),
    liveSubscriptions: live, pastDue, canceling, failedCharges,
    trend, cohorts,
  };
}

/** Блок 7: участники клуба — по выбранному потоку (по умолчанию текущий) */
export async function homeMembers(flowId?: string) {
  const zone = await tz();
  const today = localDate(clock.now(), zone);
  const flows = await prisma.flow.findMany({ orderBy: { startsOn: 'desc' }, take: 24 });
  const current = flows.find((f) => fromDbDate(f.startsOn) <= today && today < addMonths(fromDbDate(f.startsOn), 1));
  const flow = flows.find((f) => f.id === flowId) ?? current ?? flows[0];
  const total = (await prisma.flowMembership.groupBy({ by: ['userId'], where: { status: { not: 'revoked' } } })).length;
  const activeNow = current ? await prisma.flowMembership.count({ where: { flowId: current.id, status: 'active' } }) : 0;
  const nextStart = addMonths(`${today.slice(0, 7)}-01` as ISODate, 1);
  const nextFlow = flows.find((f) => fromDbDate(f.startsOn) === nextStart);
  const upcoming = nextFlow ? await prisma.flowMembership.count({ where: { flowId: nextFlow.id, status: { not: 'revoked' } } }) : 0;
  if (!flow) return { flows: [], flow: null, total, activeNow, upcoming };
  const ms = await prisma.flowMembership.findMany({ where: { flowId: flow.id, status: { not: 'revoked' } }, include: { goals: { select: { finalOutcome: true } } } });
  const lb = await prisma.leaderboardEntry.findMany({ where: { flowId: flow.id } });
  const started = ms.filter((m) => ['active', 'finished'].includes(m.status));
  const assessed = ms.filter((m) => m.goals.some((g) => g.finalOutcome));
  const achieved = assessed.filter((m) => m.goals.some((g) => g.finalOutcome === 'full'));
  return {
    flows: flows.map((f) => ({ id: f.id, title: f.title, startsOn: fromDbDate(f.startsOn) })),
    flow: { id: flow.id, title: flow.title, startsOn: fromDbDate(flow.startsOn), status: flow.status },
    total, activeNow, upcoming,
    inFlow: ms.length,
    started: started.length,
    finished: ms.filter((m) => m.status === 'finished').length,
    withMisses: lb.filter((e) => e.missedReports > 0).length,
    perfect: lb.filter((e) => e.perfectSoFar).length,
    perfectPct: pct(lb.filter((e) => e.perfectSoFar).length, started.length),
    achieved: achieved.length,
    achievedPct: pct(achieved.length, assessed.length),
    assessed: assessed.length,
  };
}

/** «Ещё»: цели, анкеты, обратная связь, трекеры, рефералы */
export async function homeInsights() {
  const goals = await prisma.goal.findMany({ select: { category: true, finalOutcome: true, membershipId: true } });
  const cats = new Map<string, number>();
  for (const g of goals) cats.set(g.category, (cats.get(g.category) ?? 0) + 1);
  const members = new Set(goals.map((g) => g.membershipId)).size;
  const assessed = goals.filter((g) => g.finalOutcome);
  const started = await prisma.flowMembership.count({ where: { status: { in: ['active', 'finished'] } } });
  const feedback = await prisma.flowFeedback.count();
  const expectations = await prisma.flowMembership.count({ where: { expectation: { not: null } } });
  const uniq = async (names: string[], extra?: { templateKey: string; table: 'sent' | 'click' }) => {
    const ev = await prisma.analyticsEvent.groupBy({ by: ['userId'], where: { eventName: { in: names }, userId: { not: null } } });
    const ids = new Set(ev.map((e) => e.userId!.toString()));
    if (extra) {
      const logs = await prisma.botMessageLog.findMany({ where: { templateKey: extra.templateKey, ...(extra.table === 'click' ? { clickedAt: { not: null } } : { status: 'sent' }) }, select: { userId: true } });
      logs.forEach((l) => ids.add(l.userId.toString()));
    }
    return ids.size;
  };
  const trackers = {
    saw: await uniq(['trackers_offer_view'], { templateKey: 'trackers_offer', table: 'sent' }),
    clicked: await uniq(['trackers_review_click'], { templateKey: 'trackers_offer', table: 'click' }),
    sent: (await prisma.trackerReview.groupBy({ by: ['userId'] })).length,
    approved: await prisma.trackerReview.count({ where: { status: 'granted' } }),
    issued: await prisma.user.count({ where: { trackersGrantedAt: { not: null } } }),
  };
  const visits = await prisma.referralVisit.findMany({ select: { visitorId: true } });
  const visitorIds = visits.map((v) => v.visitorId);
  const refPaid = visitorIds.length ? await prisma.payment.findMany({ where: { userId: { in: visitorIds }, status: 'paid', test: false }, select: { userId: true, amount: true } }) : [];
  const referral = {
    invited: visits.length,
    paidUsers: new Set(refPaid.map((p) => p.userId.toString())).size,
    revenue: refPaid.reduce((a, p) => a + p.amount, 0),
    rewards: await prisma.priceOffer.count({ where: { kind: 'referral_restore' } }),
  };
  return {
    goals: {
      total: goals.length,
      perMember: members ? Math.round((goals.length / members) * 10) / 10 : 0,
      categories: [...cats].map(([k, n]) => ({ category: k, count: n, pct: pct(n, goals.length) })).sort((a, b) => b.count - a.count),
      achievedPct: pct(assessed.filter((g) => g.finalOutcome === 'full').length, assessed.length),
      partialPct: pct(assessed.filter((g) => g.finalOutcome === 'partial').length, assessed.length),
      assessed: assessed.length,
    },
    expectations,
    feedback: { count: feedback, pct: pct(feedback, started) },
    trackers,
    referral,
  };
}
