import { addDays, addMonths, coverage, localDate, startOfLocalDay, toDbDate, type ISODate } from '@thirty/domain';
import type { Prisma } from '@prisma/client';
import { clock } from '../clock';
import { prisma } from '../db';
import { getSetting } from '../settings';
import { ensureFlow } from './flows';

/**
 * Только для демо-сервиса: история за ~5 месяцев, чтобы на главной админки были видны воронка, графики, тарифы и удержание.
 * Люди синтетические (id 7 700 000 000+), в ленте и рейтинге текущего потока не появляются. Генератор детерминированный.
 */
const BASE_ID = 7_700_000_000n;
/** Отметка «история собрана целиком» (сбрасывается вместе с демо-данными); повторный запуск дописывает только недостающее */
const MARKER = 'demo.analytics';
const DAYS = 150;
const NAMES = ['Алина', 'Мария', 'Дарья', 'София', 'Полина', 'Ева', 'Анна', 'Виктория', 'Ксения', 'Елизавета', 'Вероника', 'Арина', 'Юлия', 'Кристина', 'Ольга', 'Наталья', 'Екатерина', 'Валерия', 'Алёна', 'Карина'];
const CATEGORIES = ['blog', 'weightloss', 'money', 'english', 'habits', 'selfdev'] as const;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDemoAnalytics() {
  const tz = await getSetting('flow.timezone');
  const now = clock.now();
  const today = localDate(now, tz);
  const thisMonth = `${today.slice(0, 7)}-01` as ISODate;
  const r = rng(30);
  const chance = (p: number) => r() < p;
  const tariffs = await prisma.tariff.findMany();
  const tariff = (id: string) => tariffs.find((t) => t.id === id)!;
  const busy = new Set((await prisma.flow.findMany({ select: { startsOn: true } })).map((f) => f.startsOn.toISOString().slice(0, 10)));

  const users: Prisma.UserCreateManyInput[] = [];
  const events: Prisma.AnalyticsEventCreateManyInput[] = [];
  const welcomes: Prisma.BotMessageLogCreateManyInput[] = [];
  const payments: Prisma.PaymentCreateManyInput[] = [];
  const subs: Prisma.SubscriptionCreateManyInput[] = [];
  const memberships: { userId: bigint; month: ISODate; tariffId: string; subscriptionId: string; outcome: string | null }[] = [];
  let idx = 0, ev = 0;
  const push = (userId: bigint, eventName: string, ts: Date, extra: Partial<Prisma.AnalyticsEventCreateManyInput> = {}) => {
    if (ts > now) return;
    events.push({ eventId: `demo-an-${++ev}`, userId, sessionId: `demo-s-${userId}`, eventName, ts, device: chance(0.82) ? 'ios' : 'android', ...extra });
  };

  for (let k = DAYS; k >= 0; k--) {
    const day = addDays(today, -k);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    // Рост к концу периода, волна рекламы раз в ~3 недели, выходные спокойнее
    const base = 18 + (DAYS - k) * 0.16 + 9 * Math.max(0, Math.sin((DAYS - k) / 3.4)) * (k % 21 < 7 ? 1.6 : 1) - (dow === 0 || dow === 6 ? 5 : 0);
    const n = k === 0 ? Math.round(base * Math.min(1, (now.getTime() - startOfLocalDay(today, tz).getTime()) / 86400_000)) : Math.max(4, Math.round(base * (0.8 + r() * 0.4)));
    const better = (DAYS - k) / DAYS; // воронку постепенно улучшали
    for (let i = 0; i < n; i++) {
      const id = BASE_ID + BigInt(++idx);
      const t0 = new Date(startOfLocalDay(day, tz).getTime() + (8 + r() * 15.5) * 3600_000);
      if (t0 > now) continue;
      users.push({ id, firstName: NAMES[idx % NAMES.length], username: null, createdAt: t0, allowsWrite: true, marketingOptIn: true, onboardingStage: 'new', visibility: 'hidden' }); // скрыты из поиска участников мини-приложения
      const viaBot = chance(0.93);
      if (viaBot) {
        welcomes.push({ userId: id, templateKey: 'welcome', dedupeKey: `welcome:${id}`, status: 'sent', sentAt: t0 });
        push(id, 'bot_start', t0, { sessionId: 'server' });
        if (!chance(0.74 + better * 0.08)) continue;
      }
      let t = new Date(t0.getTime() + (viaBot ? 30_000 + r() * 20 * 60_000 : 0));
      push(id, 'app_open', t);
      if (chance(0.35)) push(id, 'app_open', new Date(t.getTime() + (1 + r() * 30) * 3600_000));
      const step = (p: number, minutes: number) => { t = new Date(t.getTime() + (0.2 + r() * minutes) * 60_000); return chance(p); };
      let skip = false;
      if (!step(0.95, 1)) continue;
      push(id, 'onboarding_step_view', t, { screenId: 'O01' });
      if (chance(0.05)) skip = true; // сразу к тарифам
      if (!skip) {
        if (!step(0.78 + better * 0.06, 2)) continue;
        push(id, 'onboarding_step_view', t, { screenId: 'O02' });
        if (!step(0.74, 3)) continue;
        push(id, 'onboarding_step_view', t, { screenId: 'O03' });
      }
      if (!step(0.86, 2)) continue;
      push(id, 'tariff_view', t, { screenId: 'S06' });
      const tid = r() < 0.46 ? 'm1' : r() < 0.63 ? 'm3' : 'm6';
      if (!step(0.56 + better * 0.06, 4)) continue;
      push(id, 'tariff_select', t, { tariffId: tid });
      push(id, 'tariff_join_click', t, { tariffId: tid });
      if (!step(0.86, 2)) continue;
      push(id, 'payment_start', t, { tariffId: tid, screenId: 'S07' });
      if (!chance(0.5 + better * 0.06)) continue;
      // Часть оплачивает не сразу, а на следующий день
      const paidAt = new Date(t.getTime() + (chance(0.15) ? (20 + r() * 20) * 3600_000 : (1 + r() * 4) * 60_000));
      if (paidAt > now) continue;
      push(id, 'payment_success', paidAt, { tariffId: tid, screenId: 'S09' });
      const tf = tariff(tid);
      const paidDay = localDate(paidAt, tz);
      let from = addMonths(`${paidDay.slice(0, 7)}-01` as ISODate, 1);
      const subId = `demo-sub-${id}`;
      const refunded = chance(0.02);
      payments.push({ userId: id, subscriptionId: refunded ? null : subId, kind: 'initial', tariffId: tid, amount: tf.promoPrice, status: refunded ? 'refunded' : 'paid', paidAt, refundedAt: refunded ? new Date(paidAt.getTime() + 2 * 86400_000) : null, priceVariant: 'promo', months: tf.months, provider: 'mock', coversFromFlow: toDbDate(from), idempotencyKey: `demo-an:${id}:0`, createdAt: paidAt });
      if (refunded) continue;
      let last = coverage(from, tf.months).at(-1)!;
      let n2 = 0;
      const renewP = { m1: 0.64, m3: 0.72, m6: 0.8 }[tid as 'm1' | 'm3' | 'm6'];
      // Продления: автосписание 28-го числа последнего оплаченного месяца
      for (;;) {
        const next = addMonths(last, 1);
        const chargeDay = `${last.slice(0, 8)}28` as ISODate;
        if (chargeDay > today) break;
        const chargeAt = new Date(startOfLocalDay(chargeDay, tz).getTime() + 9 * 3600_000);
        if (chargeAt > now) break;
        if (!chance(renewP)) {
          if (chance(0.3)) payments.push({ userId: id, subscriptionId: subId, kind: 'renewal', tariffId: tid, amount: tf.promoPrice, status: 'failed', failureReason: 'insufficient_funds', provider: 'mock', idempotencyKey: `demo-an:${id}:f${++n2}`, createdAt: chargeAt });
          break;
        }
        payments.push({ userId: id, subscriptionId: subId, kind: 'renewal', tariffId: tid, amount: tf.promoPrice, status: 'paid', paidAt: chargeAt, priceVariant: 'promo', months: tf.months, provider: 'mock', coversFromFlow: toDbDate(next), idempotencyKey: `demo-an:${id}:${++n2}`, createdAt: chargeAt });
        push(id, 'subscription_renewal_success', chargeAt, { tariffId: tid, sessionId: 'server' });
        last = coverage(next, tf.months).at(-1)!;
      }
      const lastFlow = last;
      const status = lastFlow < thisMonth ? 'expired' : from > thisMonth ? 'prestart' : chance(0.08) ? 'canceled_at_period_end' : 'active';
      subs.push({ id: subId, userId: id, tariffId: tid, status, autoRenew: status !== 'expired' && status !== 'canceled_at_period_end', renewalPrice: tf.promoPrice, priceVariant: 'promo', paidFromFlow: toDbDate(from), paidThroughFlow: toDbDate(lastFlow), createdAt: paidAt });
      // Участие в прошедших потоках (текущий демо-поток не трогаем)
      for (let m = from; m <= lastFlow && m < thisMonth; m = addMonths(m, 1)) {
        if (busy.has(m)) continue;
        const o = r();
        memberships.push({ userId: id, month: m, tariffId: tid, subscriptionId: subId, outcome: o < 0.47 ? 'full' : o < 0.8 ? 'partial' : o < 0.9 ? 'none' : null });
      }
    }
  }

  await prisma.user.createMany({ data: users, skipDuplicates: true });
  await prisma.botMessageLog.createMany({ data: welcomes, skipDuplicates: true });
  for (let i = 0; i < events.length; i += 5000) await prisma.analyticsEvent.createMany({ data: events.slice(i, i + 5000), skipDuplicates: true });
  await prisma.subscription.createMany({ data: subs, skipDuplicates: true });
  await prisma.payment.createMany({ data: payments, skipDuplicates: true });

  const flowIds = new Map<string, string>();
  for (const m of new Set(memberships.map((x) => x.month))) {
    const f = await ensureFlow(m);
    await prisma.flow.update({ where: { id: f.id }, data: { status: 'finished' } });
    flowIds.set(m, f.id);
  }
  const rows = memberships.map((m) => ({ id: `demo-m-${m.userId}-${m.month}`, userId: m.userId, flowId: flowIds.get(m.month)!, tariffId: m.tariffId, subscriptionId: m.subscriptionId, status: 'finished' as const, finalSubmittedAt: m.outcome ? new Date(`${addDays(addMonths(m.month, 1), -1)}T15:00:00Z`) : null }));
  await prisma.flowMembership.createMany({ data: rows, skipDuplicates: true });
  await prisma.goal.createMany({
    data: memberships.map((m, i) => ({ id: `demo-g-${rows[i].id}`, membershipId: rows[i].id, category: CATEGORIES[i % CATEGORIES.length], title: 'Цель на месяц', successCriterion: 'Результат через 30 дней', finalOutcome: m.outcome, finalAchieved: m.outcome === null ? null : m.outcome === 'full' })),
    skipDuplicates: true,
  });
  // Пропуски отчётов для блока «Участники клуба» по прошедшим потокам
  await prisma.leaderboardEntry.createMany({
    data: rows.map((m, i) => {
      const missed = i % 10 < 3 ? 0 : 1 + (i % 7);
      return { flowId: m.flowId, userId: m.userId, ratio: (30 - missed) / 30, completed: 30 - missed, scheduled: 30, successfulDays: 30 - missed, missedReports: missed, longestStreak: 30 - missed, currentStreak: 0, perfectSoFar: missed === 0, reportDays: 30 - missed, rank: i + 1 };
    }),
    skipDuplicates: true,
  });
  await prisma.setting.upsert({ where: { key: MARKER }, create: { key: MARKER, value: { at: now.toISOString() } }, update: { value: { at: now.toISOString() } } });
  return { users: users.length, events: events.length, payments: payments.length };
}

/** История для админки есть? (после сброса демо-данных её нужно собрать заново) */
export async function ensureDemoAnalytics() {
  if (await prisma.setting.findUnique({ where: { key: MARKER } })) return;
  const res = await seedDemoAnalytics();
  console.log(`[demo] история для админки: ${res.users} человек, ${res.events} событий, ${res.payments} платежей`);
}
