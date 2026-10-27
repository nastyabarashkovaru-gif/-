import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOPIC_CHATS, addDays, addMonths, flowBounds, localDate } from '@thirty/domain';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { clock } from '../clock';
import { config } from '../config';
import { prisma } from '../db';
import { forbidden } from '../http';
import { storage } from '../lib/storage';
import { seed } from '../seed';
import { clearSettingsCache } from '../settings';
import { ensureFlow, refreshFlowStatuses } from './flows';
import { createGoal, createTask, fixGoals } from './goals';
import { submitReport } from './reports';
import { computeLeaderboard } from './rating';
import { postChat } from './feedChat';

/**
 * Демо-версия для владельца (отдельный сервис с DEMO_MODE=true и своей схемой БД).
 * Панель собирает данные под переключатели (статус, день, тариф, отчёты, цель, отзыв, подписка, таймер)
 * и переводит «часы» сервера. Сообщения в Telegram не уходят (нет токена бота), оплата — тестовая.
 * В обычной версии приложения этот модуль недоступен.
 */

const TZ = 'Europe/Moscow';
const here = path.dirname(fileURLToPath(import.meta.url));
const PHOTO_DIR = [path.resolve(here, '../../assets/demo'), path.resolve(here, '../assets/demo'), path.resolve(process.cwd(), 'assets/demo')].find((d) => existsSync(d));

/** «Часы» демо хранятся в базе: после перезапуска сервера демо-данные и время остаются согласованными */
const CLOCK_KEY = 'demo.clock';

async function saveClock() {
  const value = { at: clock.now().toISOString() };
  await prisma.setting.upsert({ where: { key: CLOCK_KEY }, create: { key: CLOCK_KEY, value }, update: { value } });
}

export async function restoreDemoClock() {
  const row = await prisma.setting.findUnique({ where: { key: CLOCK_KEY } });
  // Данные собраны до появления сохранённого времени — берём время последнего сообщения в ленте
  const last = row ? null : await prisma.feedMessage.findFirst({ orderBy: { createdAt: 'desc' } });
  const at = (row?.value as { at?: string } | null)?.at ?? (last ? new Date(last.createdAt.getTime() + 60_000).toISOString() : undefined);
  if (at) {
    clock.set(at);
    console.log(`[demo] время демо: ${at}`);
  }
}

export function assertDemo() {
  if (!config.DEMO_MODE) throw forbidden('not_demo');
}

/** Ближайший поток по реальному календарю (1-е число следующего месяца) */
function demoFlowStart(): string {
  const today = localDate(new Date(), TZ);
  return addMonths(`${today.slice(0, 7)}-01`, 1);
}
const at = (date: string, hour: number, minute = 0) => DateTime.fromISO(date, { zone: TZ }).set({ hour, minute }).toJSDate();

const PEOPLE = [
  { id: 990001n, name: 'Алина', city: 'Москва', rate: 0.92, goals: [['blog', 'Набрать 5 000 подписчиков', '3 000 подписчиков', '5 000 подписчиков', [['Опубликовать Reels', 'daily']]]] },
  { id: 990002n, name: 'Мария', city: 'Санкт-Петербург', rate: 0.8, goals: [['weightloss', 'Снизить вес на 4 кг', '70 кг', '66 кг', [['Тренировка', 'daily'], ['10 000 шагов', 'daily']]]] },
  { id: 990003n, name: 'Даша', city: 'Казань', rate: 0.45, goals: [['money', 'Заработать 150 000 ₽', '50 000 ₽', '150 000 ₽', [['Созвон с клиентом', 'daily']]]] },
  { id: 990004n, name: 'София', city: 'Москва', rate: 0.28, goals: [['english', 'Пройти 30 уроков английского', '0 уроков', '30 уроков', [['Урок английского', 'daily']]]] },
  { id: 990005n, name: 'Полина', city: 'Екатеринбург', rate: 1, goals: [['habits', 'Вставать в 7:00 все 30 дней', 'Встаю в 9:00', 'Встаю в 7:00', [['Подъём в 7:00', 'daily']]]] },
  { id: 990006n, name: 'Ева', city: 'Новосибирск', rate: 0.65, goals: [['blog', 'Запустить блог о путешествиях', '0 постов', '30 постов', [['Пост в блог', 'daily']]]] },
] as const;

const TEXTS = ['Провела три созвона. Один клиент уже согласился!', 'Тренировка сделана, 9 000 шагов пройдено! 💪', 'Сегодня выложила новый Reels! Уже 2 000 просмотров 🔥', 'День закрыт, всё по плану 💜', 'Было тяжело, но сделала!', 'Встала в 7:00 без будильника 😍', 'Урок пройден, новые слова выучены 🇬🇧'];

/** Демо-фото на временном диске пропадают при перезапуске сервера — восстанавливаем их по ключам demo/p{N}-… */
export async function ensureDemoPhotos() {
  if (!PHOTO_DIR) {
    console.warn('[demo] assets/demo не найдена — фото в отчётах будут пустыми');
    return;
  }
  const files = [0, 1, 2, 3, 4].map((i) => readFileSync(path.join(PHOTO_DIR!, `p${i}.jpg`)));
  const rows = await prisma.mediaFile.findMany({ where: { storageKey: { startsWith: 'demo/' } }, select: { storageKey: true } });
  for (const r of rows) {
    const i = Number(/demo\/p(\d)-/.exec(r.storageKey)?.[1] ?? 0);
    await storage.put(r.storageKey, files[i] ?? files[0], 'image/jpeg');
  }
}

async function photo(ownerId: bigint, i: number): Promise<string> {
  const n = i % 5;
  const key = `demo/p${n}-${randomUUID()}.jpg`;
  const buf = PHOTO_DIR ? readFileSync(path.join(PHOTO_DIR, `p${n}.jpg`)) : Buffer.alloc(0);
  await storage.put(key, buf, 'image/jpeg');
  const m = await prisma.mediaFile.create({ data: { ownerId, storageKey: key, mime: 'image/jpeg', size: buf.length } });
  return m.id;
}

/** Полная очистка демо-данных (только в демо-схеме) */
async function wipe() {
  clock.set(null);
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(`SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`);
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  clearSettingsCache();
  await seed();
}

const ABOUT: Record<string, [number, string, string]> = {
  Алина: [24, 'Веду блог о красоте и работаю SMM-менеджером', 'Хочу, чтобы блог стал основным источником дохода'],
  Мария: [29, 'Работаю дизайнером интерьеров', 'Хочу вернуть энергию и любить своё отражение'],
  Даша: [31, 'Фрилансер, делаю сайты', 'Хочу стабильный доход и своих постоянных клиентов'],
  София: [22, 'Учусь в университете на экономиста', 'Хочу свободно говорить на английском и поехать по обмену'],
  Полина: [27, 'Работаю в банке', 'Хочу успевать больше и не чувствовать себя уставшей'],
  Ева: [26, 'Путешествую и снимаю видео', 'Хочу запустить свой блог о путешествиях'],
  Анастасия: [28, 'Развиваю блог и создаю свой проект «30 дней»', 'Хочу вдохновлять людей и вырасти в блоге'],
};

/** Чаты-заглушки: в демо замки снимаются так же, как в настоящем приложении, но в Telegram не ведут */
async function demoChats(flowId: string) {
  await prisma.telegramChat.create({ data: { kind: 'flow', flowId, telegramChatId: -1009000000000n, title: 'Общий чат потока' } });
  for (const [i, t] of TOPIC_CHATS.entries()) {
    await prisma.telegramChat.create({ data: { kind: 'topic', topic: t.id, telegramChatId: -1009000000001n - BigInt(i), title: `Чат «${t.title}»` } });
  }
}

async function enroll(userId: bigint, name: string, city: string, tariffId: string, flowId: string, flowStart: string) {
  const [age, occupation] = ABOUT[name] ?? [25, null];
  const about = { displayName: name, city, age, occupation, onboardingStage: 'paid' };
  await prisma.user.upsert({ where: { id: userId }, create: { id: userId, firstName: name, allowsWrite: true, ...about }, update: about });
  const tariff = await prisma.tariff.findUniqueOrThrow({ where: { id: tariffId } });
  const sub = await prisma.subscription.create({
    data: { userId, tariffId, status: 'prestart', renewalPrice: tariff.promoPrice, paidFromFlow: new Date(`${flowStart}T00:00:00Z`), paidThroughFlow: new Date(`${addMonths(flowStart, tariff.months - 1)}T00:00:00Z`), nextChargeDate: new Date(`${addMonths(flowStart, tariff.months - 1).slice(0, 8)}28T00:00:00Z`) },
  });
  await prisma.payment.create({ data: { userId, subscriptionId: sub.id, kind: 'initial', tariffId, amount: tariff.promoPrice, status: 'paid', paidAt: clock.now(), priceVariant: 'promo', months: tariff.months, provider: 'mock', coversFromFlow: new Date(`${flowStart}T00:00:00Z`), idempotencyKey: `demo:${userId}:${flowStart}` } });
  const expectation = ABOUT[name]?.[2] ?? null;
  return prisma.flowMembership.create({ data: { userId, flowId, tariffId, subscriptionId: sub.id, expectation } });
}

type GoalSeed = readonly [string, string, string, string, readonly (readonly [string, string])[]];

async function fillGoals(userId: bigint, membershipId: string, goals: readonly GoalSeed[]) {
  for (const [category, title, pointA, pointB, tasks] of goals) {
    const g = await createGoal(userId, membershipId, { category: category as never, title, successCriterion: pointB, pointA, pointB, confirmMethod: 'screenshot', isPublic: true });
    for (const [t, frequency] of tasks) await createTask(userId, g.id, { title: t, frequency: frequency as never, n: 3, dueDate: null });
  }
  await fixGoals(userId, membershipId);
}

const OWNER_GOALS: readonly GoalSeed[] = [
  ['blog', 'Набрать 1 000 подписчиков за 30 дней', '250 подписчиков', '1 000 подписчиков', [['Опубликовать 1 Reels', 'daily'], ['Анализировать статистику роликов', 'n_per_week']]],
  ['weightloss', 'Снизить вес на 3 кг за 30 дней', '60 кг', '57 кг', [['Пройти 8 000 шагов', 'daily'], ['Силовая тренировка', 'n_per_week']]],
  ['habits', 'Вставать в 7:00 все 30 дней', 'Встаю в 9:00', 'Встаю в 7:00', [['Подъём в 7:00', 'daily']]],
];
/** Сколько целей у владельца в демо: лимит тарифа (1 месяц — одна, 3 месяца — две из трёх возможных, 6 месяцев — три) */
const OWNER_GOAL_COUNT: Record<string, number> = { m1: 1, m3: 2, m6: 3 };

// ───────────── Панель демо: состояние по переключателям ─────────────

export const demoStateInput = z.object({
  status: z.enum(['prepay', 'paid', 'waiting', 'active', 'done_sub', 'done_nosub']),
  day: z.number().int().min(1).max(30).default(13),
  tariff: z.enum(['m1', 'm3', 'm6']).default('m3'),
  reports: z.enum(['all', 'some', 'many']).default('some'),
  outcome: z.enum(['full', 'partial', 'none']).default('full'),
  review: z.enum(['none', 'pending', 'needs_info', 'granted']).default('none'),
  subscription: z.enum(['active', 'ended', 'renewed']).default('active'),
  timer: z.number().int().min(0).max(2400).default(2400),
});
export type DemoState = z.infer<typeof demoStateInput>;

/** Сдаёт ли владелец отчёт в этот день: все / есть пропуски / много пропусков */
const ownerReports = (s: DemoState, day: number) => (s.reports === 'all' ? true : s.reports === 'some' ? day % 5 !== 3 : day % 3 === 1);

/** Текущее значение числовой цели к дню day при выбранном итоге (достигнута / частично / нет) */
function ownerProgress(goal: { category: string }, day: number, days: number, outcome: DemoState['outcome']) {
  const share = { full: 1, partial: 0.5, none: 0.12 }[outcome] * Math.min(1, day / days);
  if (goal.category === 'blog') return Math.round(250 + 750 * share);
  if (goal.category === 'weightloss') return Math.round((60 - 3 * share) * 10) / 10;
  return null;
}

async function participants(flowId: string, flowStart: string) {
  await demoChats(flowId);
  for (const p of PEOPLE) {
    const m = await enroll(p.id, p.name, p.city, 'm3', flowId, flowStart);
    await fillGoals(p.id, m.id, p.goals);
  }
}

async function dayReports(flowStart: string, day: number, days: number, owner: { id: bigint; membershipId: string; s: DemoState } | null, withText: boolean) {
  const date = addDays(flowStart, day - 1);
  const memberships = await prisma.flowMembership.findMany({ where: { flow: { startsOn: new Date(`${flowStart}T00:00:00Z`) } } });
  for (const [k, p] of PEOPLE.entries()) {
    if (((day * 7 + k * 13) % 100) / 100 > p.rate) continue;
    const m = memberships.find((x) => x.userId === p.id);
    if (!m) continue;
    clock.set(at(date, 9 + k, (day * 7) % 50));
    await reportFor(p.id, m.id, k + day, withText ? TEXTS[(k + day) % TEXTS.length] : undefined);
  }
  if (owner && ownerReports(owner.s, day)) {
    clock.set(at(date, 20, 15));
    await reportFor(owner.id, owner.membershipId, day, withText ? 'Отличный день, всё по плану! 🚀' : undefined, { day, days, outcome: owner.s.outcome });
  }
}

async function reportFor(userId: bigint, membershipId: string, seedIdx: number, text?: string, owner?: { day: number; days: number; outcome: DemoState['outcome'] }) {
  const goals = await prisma.goal.findMany({ where: { membershipId } });
  const date = new Date(`${localDate(clock.now(), TZ)}T00:00:00Z`);
  const open = await prisma.taskOccurrence.findMany({ where: { membershipId, status: 'pending', windowStart: { lte: date }, windowEnd: { gte: date } } });
  const items = [...new Set(open.map((o) => o.taskId))].map((taskId) => ({ taskId, done: true as const, mediaIds: [] }));
  const progress = owner ? goals.map((g) => ({ goalId: g.id, value: ownerProgress(g, owner.day, owner.days, owner.outcome) })).filter((x): x is { goalId: string; value: number } => x.value !== null) : [];
  await submitReport(userId, membershipId, { items, mediaIds: [await photo(userId, seedIdx)], text, progress, publicAck: true }).catch(() => undefined);
}

/** Прошлый месяц владельца (меньше успешных дней) — для «на N дней больше, чем в предыдущем месяце» */
async function previousMonth(ownerId: bigint, flowStart: string) {
  const prevStart = addMonths(flowStart, -1);
  clock.set(at(addDays(prevStart, -3), 12));
  const flow = await ensureFlow(prevStart);
  const m = await prisma.flowMembership.create({ data: { userId: ownerId, flowId: flow.id, tariffId: 'm3', expectation: 'Хочу начать вставать раньше' } });
  await fillGoals(ownerId, m.id, [['habits', 'Вставать в 7:00 все 30 дней', 'Встаю в 9:00', 'Встаю в 7:00', [['Подъём в 7:00', 'daily']]]]);
  const days = flowBounds(prevStart).days;
  for (let day = 1; day <= days; day++) {
    clock.set(at(addDays(prevStart, day - 1), 0, 5));
    await refreshFlowStatuses();
    if (day % 3 !== 1) continue;
    clock.set(at(addDays(prevStart, day - 1), 21, 0));
    await reportFor(ownerId, m.id, day);
  }
}

/** Отзыв за трекеры в нужном статусе */
async function trackerReview(ownerId: bigint, status: DemoState['review']) {
  await prisma.setting.upsert({
    where: { key: 'trackers.links' },
    create: { key: 'trackers.links', value: { tasks: 'https://docs.google.com/spreadsheets/', week: 'https://docs.google.com/spreadsheets/', finance: 'https://docs.google.com/spreadsheets/' } },
    update: {},
  });
  clearSettingsCache();
  if (status === 'none') return;
  const r = await prisma.trackerReview.create({ data: { userId: ownerId, mediaId: await photo(ownerId, 2), status, createdAt: clock.now(), ...(status !== 'pending' ? { decidedBy: 'demo', decidedAt: clock.now() } : {}) } });
  if (status === 'granted') await prisma.user.update({ where: { id: ownerId }, data: { trackersGrantedAt: clock.now() } });
  return r;
}

/** Ответы других участниц — чтобы в админке было что посмотреть */
async function othersFinale(flowId: string) {
  const ms = await prisma.flowMembership.findMany({ where: { flowId, userId: { in: PEOPLE.map((p) => p.id) } }, include: { goals: true } });
  const answers = [
    ['Было непросто, но я ни разу не сдалась 💜', ['Поддержка напарника', 'Общение в клубе'], ['Нехватка времени'], 'Окружение и ежедневные отчёты', 'Больше созвонов с экспертами', 'Нет, всё хорошо'],
    ['Месяц прошёл продуктивно, привычка закрепилась', ['Мотивация и собственное желание'], ['Сложно было вернуться после пропуска'], 'Планеры и чат', 'Напоминания в боте пораньше', 'Хочу разбор питания'],
    ['Сделала больше, чем планировала', ['Поддержка напарника'], ['Не рассчитала силы и время'], 'Бадди — это лучшее', 'Ничего, всё отлично', 'Нет'],
  ] as const;
  for (const [i, m] of ms.slice(0, 4).entries()) {
    const a = answers[i % answers.length];
    await prisma.flowFeedback.create({ data: { membershipId: m.id, userId: m.userId, flowId, month: a[0], helped: [...a[1]], hindered: [...a[2]], benefit: a[3], change: a[4], needHelp: a[5] } });
    for (const g of m.goals) await prisma.goal.update({ where: { id: g.id }, data: { finalOutcome: ['full', 'partial', 'full', 'none'][i], finalAchieved: i % 2 === 0 } });
    await prisma.flowMembership.update({ where: { id: m.id }, data: { finalResult: ['+1 800 подписчиков', 'Минус 2,5 кг', '120 000 ₽ за месяц', 'Прошла 14 уроков'][i], finalSubmittedAt: clock.now() } });
  }
  const shot = await photo(PEOPLE[1].id, 3);
  await prisma.trackerReview.create({ data: { userId: PEOPLE[1].id, mediaId: shot, createdAt: clock.now() } });
}

let queue: Promise<unknown> = Promise.resolve();

/** Собирает демо-данные под выбранные переключатели и ставит «часы» сервера (запросы выполняются по очереди) */
export function applyDemoState(ownerId: bigint, ownerName: string, s: DemoState) {
  assertDemo();
  const run = queue.then(async () => {
    const res = await buildDemoState(ownerId, ownerName, s);
    await saveClock();
    return res;
  });
  queue = run.catch(() => undefined);
  return run;
}

async function buildDemoState(ownerId: bigint, ownerName: string, s: DemoState) {
  await wipe();
  const flowStart = demoFlowStart();
  const { days } = flowBounds(flowStart);
  clock.set(at(addDays(flowStart, -7), 12));
  const flow = await ensureFlow(flowStart);
  await prisma.flow.update({ where: { id: flow.id }, data: { status: 'upcoming' } });
  await participants(flow.id, flowStart);

  if (s.status === 'prepay') {
    const newId = BigInt(800000 + Math.floor(Math.random() * 99999));
    return { userId: newId.toString(), go: '/welcome' };
  }
  if (s.status === 'paid') {
    const mine = await enroll(ownerId, ownerName, 'Москва', s.tariff, flow.id, flowStart);
    await prisma.flowMembership.update({ where: { id: mine.id }, data: { expectation: null } });
    await prisma.user.update({ where: { id: ownerId }, data: { age: null, occupation: null, city: null } });
    return { userId: ownerId.toString(), go: '/reg/about' };
  }

  const mine = await enroll(ownerId, ownerName, 'Москва', s.tariff, flow.id, flowStart);
  await fillGoals(ownerId, mine.id, OWNER_GOALS.slice(0, OWNER_GOAL_COUNT[s.tariff]));
  const pair = await prisma.buddyPair.create({ data: { flowId: flow.id, userA: ownerId, userB: PEOPLE[0].id, source: 'auto', matchReason: 'Общая цель: блог' } });
  await prisma.buddyAssignment.createMany({ data: [{ flowId: flow.id, userId: ownerId, pairId: pair.id }, { flowId: flow.id, userId: PEOPLE[0].id, pairId: pair.id }] });
  if (s.status === 'waiting') {
    clock.set(at(addDays(flowStart, -7), 11, 30));
    await trackerReview(ownerId, 'none');
    return { userId: ownerId.toString(), go: '/' };
  }

  await previousMonth(ownerId, flowStart);
  const done = s.status === 'done_sub' || s.status === 'done_nosub';
  const today = done ? days : s.day;
  const owner = { id: ownerId, membershipId: mine.id, s };
  for (let day = 1; day <= today; day++) {
    clock.set(at(addDays(flowStart, day - 1), 0, 5));
    await refreshFlowStatuses();
    // В текущий день владелец ещё не сдал отчёт (если челлендж идёт); в финале — последний день закрыт
    await dayReports(flowStart, day, days, day < today || done ? owner : null, day >= today - 3);
  }
  const date = addDays(flowStart, today - 1);
  const last = await prisma.feedMessage.findFirst({ where: { flowId: flow.id, userId: PEOPLE[1].id }, orderBy: { createdAt: 'desc' } });
  clock.set(at(date, 21, 0));
  if (last) await postChat(PEOPLE[4].id, { text: 'Ааа, умница! 💜 Я тоже сегодня не сдалась!', replyToId: last.id });
  const mineLast = await prisma.feedMessage.findFirst({ where: { flowId: flow.id, userId: ownerId }, orderBy: { createdAt: 'desc' } });
  if (mineLast) await postChat(PEOPLE[0].id, { text: 'Ты молодец, так держать! 🔥', replyToId: mineLast.id });
  await computeLeaderboard(flow.id);
  await trackerReview(ownerId, s.review);

  if (!done) {
    clock.set(at(date, 12, 0));
    return { userId: ownerId.toString(), go: '/' };
  }

  // Последний день потока: итоги, обратная связь и всё, что связано с подпиской
  clock.set(at(date, 19, 0));
  await othersFinale(flow.id);
  const sub = await prisma.subscription.findFirstOrThrow({ where: { userId: ownerId, paidFromFlow: new Date(`${flowStart}T00:00:00Z`) }, include: { tariff: true } });
  const nextStart = addMonths(flowStart, 1);
  const subState = s.status === 'done_sub' ? 'active' : s.subscription === 'renewed' ? 'renewed' : 'ended';
  if (subState === 'active') {
    // Оплачен следующий поток (продление 28-го или тариф на несколько месяцев) — анкета для него ещё не заполнена
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'active', autoRenew: true, paidThroughFlow: new Date(`${addMonths(flowStart, Math.max(1, sub.tariff.months - 1))}T00:00:00Z`) } });
    const next = await ensureFlow(nextStart);
    await prisma.flowMembership.create({ data: { userId: ownerId, flowId: next.id, tariffId: s.tariff, subscriptionId: sub.id } });
  } else {
    // Автопродление отключено, оплачен только текущий поток
    await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'canceled_at_period_end', autoRenew: false, paidThroughFlow: new Date(`${flowStart}T00:00:00Z`), cancelReason: 'demo' } });
    const now = clock.now();
    const expiresAt = new Date(now.getTime() + s.timer * 1000 - (s.timer === 0 ? 1000 : 0));
    await prisma.priceOffer.create({ data: { userId: ownerId, kind: `comeback:${sub.id}`, startedAt: new Date(expiresAt.getTime() - 40 * 60_000), expiresAt, tariffId: sub.tariffId, amount: sub.renewalPrice, ...(subState === 'renewed' ? { consumedAt: now } : {}) } });
    if (subState === 'renewed') {
      // Вернулась по прежней цене: новая подписка со следующего потока, анкета для него ещё впереди
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } });
      const renewed = await prisma.subscription.create({
        data: { userId: ownerId, tariffId: sub.tariffId, status: 'prestart', renewalPrice: sub.renewalPrice, priceVariant: sub.priceVariant, paidFromFlow: new Date(`${nextStart}T00:00:00Z`), paidThroughFlow: new Date(`${addMonths(nextStart, sub.tariff.months - 1)}T00:00:00Z`), nextChargeDate: new Date(`${addMonths(nextStart, sub.tariff.months - 1).slice(0, 8)}28T00:00:00Z`) },
      });
      await prisma.payment.create({ data: { userId: ownerId, subscriptionId: renewed.id, kind: 'initial', tariffId: sub.tariffId, amount: sub.renewalPrice, status: 'paid', paidAt: now, priceVariant: sub.priceVariant, months: sub.tariff.months, provider: 'mock', coversFromFlow: new Date(`${nextStart}T00:00:00Z`), idempotencyKey: `demo:renewed:${ownerId}` } });
      const next = await ensureFlow(nextStart);
      await prisma.flowMembership.create({ data: { userId: ownerId, flowId: next.id, tariffId: sub.tariffId, subscriptionId: renewed.id } });
    }
  }
  return { userId: ownerId.toString(), go: '/' };
}

export type Scenario = 'fresh' | 'waiting' | 'active';

/** Быстрые сценарии (кнопки панели) — частные случаи состояния */
export async function runScenario(ownerId: bigint, ownerName: string, scenario: Scenario) {
  const base = demoStateInput.parse({ status: scenario === 'fresh' ? 'prepay' : scenario, day: 13 });
  return applyDemoState(ownerId, ownerName, base);
}

/** Перемотать время на следующий день (10:00): участники сдают отчёты, у владельца новый день */
export async function advanceDay() {
  assertDemo();
  const today = localDate(clock.now(), TZ);
  const next = addDays(today, 1);
  const flow = await prisma.flow.findFirst({ where: { startsOn: { lte: new Date(`${next}T00:00:00Z`) } }, orderBy: { startsOn: 'desc' } });
  if (flow) {
    const flowStart = flow.startsOn.toISOString().slice(0, 10);
    const { days } = flowBounds(flowStart);
    const day = Math.round((Date.parse(next) - Date.parse(flowStart)) / 86_400_000) + 1;
    clock.set(at(next, 0, 5));
    await refreshFlowStatuses();
    if (day >= 1 && day <= days) await dayReports(flowStart, day, days, null, true);
    clock.set(at(next, 10, 0));
    await computeLeaderboard(flow.id);
  } else clock.set(at(next, 10, 0));
  await saveClock();
  return { now: clock.now().toISOString() };
}

export function demoInfo() {
  return {
    demo: config.DEMO_MODE,
    now: clock.now().toISOString(),
    // Вход в демо-админку (данные в ней тоже демонстрационные)
    admin: config.DEMO_MODE && config.ADMIN_BOOTSTRAP_LOGIN ? { url: '/admin/', login: config.ADMIN_BOOTSTRAP_LOGIN, password: config.ADMIN_BOOTSTRAP_PASSWORD } : null,
  };
}
