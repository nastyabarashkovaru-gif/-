import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOPIC_CHATS, addDays, addMonths, localDate } from '@thirty/domain';
import { DateTime } from 'luxon';
import { clock } from '../clock';
import { config } from '../config';
import { prisma } from '../db';
import { forbidden } from '../http';
import { newKey, storage } from '../lib/storage';
import { seed } from '../seed';
import { clearSettingsCache } from '../settings';
import { ensureFlow, refreshFlowStatuses } from './flows';
import { createGoal, createTask, fixGoals } from './goals';
import { submitReport } from './reports';
import { computeLeaderboard } from './rating';
import { postChat } from './feedChat';

/**
 * Демо-версия для владельца (отдельный сервис с DEMO_MODE=true и своей схемой БД).
 * Сценарии пересоздают данные и переводят «часы» сервера: новый человек → ожидание старта → идёт челлендж.
 * В обычной версии приложения этот модуль недоступен.
 */

const TZ = 'Europe/Moscow';
const here = path.dirname(fileURLToPath(import.meta.url));
const PHOTO_DIR = [path.resolve(here, '../../assets/demo'), path.resolve(here, '../assets/demo'), path.resolve(process.cwd(), 'assets/demo')].find((d) => existsSync(d));

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

async function photo(ownerId: bigint, i: number): Promise<string> {
  const file = PHOTO_DIR ? path.join(PHOTO_DIR, `p${i % 5}.jpg`) : null;
  const buf = file && existsSync(file) ? readFileSync(file) : Buffer.from('/9j/4AAQSkZJRgABAQ==', 'base64');
  const key = newKey('jpg');
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
  const [age, occupation, aspiration] = ABOUT[name] ?? [25, null, null];
  const about = { displayName: name, city, age, occupation, aspiration, onboardingStage: 'paid' };
  await prisma.user.upsert({ where: { id: userId }, create: { id: userId, firstName: name, allowsWrite: true, ...about }, update: about });
  const tariff = await prisma.tariff.findUniqueOrThrow({ where: { id: tariffId } });
  const sub = await prisma.subscription.create({
    data: { userId, tariffId, status: 'prestart', renewalPrice: tariff.promoPrice, paidFromFlow: new Date(`${flowStart}T00:00:00Z`), paidThroughFlow: new Date(`${addMonths(flowStart, tariff.months - 1)}T00:00:00Z`), nextChargeDate: new Date(`${addMonths(flowStart, tariff.months - 1).slice(0, 8)}28T00:00:00Z`) },
  });
  await prisma.payment.create({ data: { userId, subscriptionId: sub.id, kind: 'initial', tariffId, amount: tariff.promoPrice, status: 'paid', paidAt: clock.now(), priceVariant: 'promo', months: tariff.months, provider: 'mock', idempotencyKey: `demo:${userId}` } });
  return prisma.flowMembership.create({ data: { userId, flowId, tariffId, subscriptionId: sub.id } });
}

async function fillGoals(userId: bigint, membershipId: string, goals: readonly (readonly [string, string, string, string, readonly (readonly [string, string])[]])[]) {
  for (const [category, title, pointA, pointB, tasks] of goals) {
    const g = await createGoal(userId, membershipId, { category: category as never, title, successCriterion: pointB, pointA, pointB, confirmMethod: 'screenshot', isPublic: true });
    for (const [t, frequency] of tasks) await createTask(userId, g.id, { title: t, frequency: frequency as never, n: 3, dueDate: null });
  }
  await fixGoals(userId, membershipId);
}

const OWNER_GOALS = [
  ['blog', 'Набрать 1 000 подписчиков за 30 дней', '250 подписчиков', '1 000 подписчиков', [['Опубликовать 1 Reels', 'daily'], ['Анализировать статистику роликов', 'n_per_week']]],
  ['weightloss', 'Снизить вес на 3 кг за 30 дней', '60 кг', '57 кг', [['Пройти 8 000 шагов', 'daily'], ['Силовая тренировка', 'n_per_week']]],
] as const;

/** Участники + (по желанию) владелец с заполненной анкетой; часы — до старта */
async function prepareWaiting(ownerId: bigint, ownerName: string) {
  await wipe();
  const flowStart = demoFlowStart();
  clock.set(at(addDays(flowStart, -7), 12));
  const flow = await ensureFlow(flowStart);
  await prisma.flow.update({ where: { id: flow.id }, data: { status: 'upcoming' } });
  await demoChats(flow.id);
  for (const p of PEOPLE) {
    const m = await enroll(p.id, p.name, p.city, 'm3', flow.id, flowStart);
    await fillGoals(p.id, m.id, p.goals);
  }
  const mine = await enroll(ownerId, ownerName, 'Москва', 'm3', flow.id, flowStart);
  await fillGoals(ownerId, mine.id, OWNER_GOALS);
  // Бадди владельца — Алина
  const pair = await prisma.buddyPair.create({ data: { flowId: flow.id, userA: ownerId, userB: PEOPLE[0].id, source: 'auto', matchReason: 'Общая цель: блог' } });
  await prisma.buddyAssignment.createMany({ data: [{ flowId: flow.id, userId: ownerId, pairId: pair.id }, { flowId: flow.id, userId: PEOPLE[0].id, pairId: pair.id }] });
  return { flow, flowStart, membershipId: mine.id };
}

async function dayReports(flowStart: string, day: number, ownerId: bigint | null, ownerMembershipId: string | null, withText: boolean) {
  const date = addDays(flowStart, day - 1);
  const memberships = await prisma.flowMembership.findMany({ where: { flow: { startsOn: new Date(`${flowStart}T00:00:00Z`) } } });
  for (const [k, p] of PEOPLE.entries()) {
    if (((day * 7 + k * 13) % 100) / 100 > p.rate) continue;
    const m = memberships.find((x) => x.userId === p.id);
    if (!m) continue;
    clock.set(at(date, 9 + k, (day * 7) % 50));
    await reportFor(p.id, m.id, k + day, withText ? TEXTS[(k + day) % TEXTS.length] : undefined);
  }
  if (ownerId && ownerMembershipId && day % 5 !== 3) {
    clock.set(at(date, 20, 15));
    await reportFor(ownerId, ownerMembershipId, day, withText ? 'Отличный день, всё по плану! 🚀' : undefined, day);
  }
}

async function reportFor(userId: bigint, membershipId: string, seedIdx: number, text?: string, ownerDay?: number) {
  const goals = await prisma.goal.findMany({ where: { membershipId }, include: { tasks: true } });
  const date = new Date(`${localDate(clock.now(), TZ)}T00:00:00Z`);
  const open = await prisma.taskOccurrence.findMany({ where: { membershipId, status: 'pending', windowStart: { lte: date }, windowEnd: { gte: date } } });
  const items = [...new Set(open.map((o) => o.taskId))].map((taskId) => ({ taskId, done: true as const, mediaIds: [] }));
  const progress = ownerDay ? goals.filter((g) => g.category === 'blog' || g.category === 'weightloss').map((g) => ({ goalId: g.id, value: g.category === 'blog' ? 250 + ownerDay * 38 : Math.round((60 - ownerDay * 0.12) * 10) / 10 })) : [];
  await submitReport(userId, membershipId, { items, mediaIds: [await photo(userId, seedIdx)], text, progress, publicAck: true }).catch(() => undefined);
}

export type Scenario = 'fresh' | 'waiting' | 'active';

/** Переключение сценария; для «fresh» возвращает новый id пользователя (начать как новый человек) */
export async function runScenario(ownerId: bigint, ownerName: string, scenario: Scenario) {
  assertDemo();
  if (scenario === 'fresh') {
    await wipe();
    const flowStart = demoFlowStart();
    // Несколько участников уже в клубе — чтобы после оплаты было с кем знакомиться
    clock.set(at(addDays(flowStart, -7), 12));
    const flow = await ensureFlow(flowStart);
    await demoChats(flow.id);
    for (const p of PEOPLE) {
      const m = await enroll(p.id, p.name, p.city, 'm3', flow.id, flowStart);
      await fillGoals(p.id, m.id, p.goals);
    }
    const newId = BigInt(800000 + Math.floor(Math.random() * 99999));
    return { userId: newId.toString(), go: '/welcome' };
  }
  const { flow, flowStart, membershipId } = await prepareWaiting(ownerId, ownerName);
  if (scenario === 'waiting') {
    clock.set(at(addDays(flowStart, -7), 10, 30));
    return { userId: ownerId.toString(), go: '/' };
  }
  // Идёт челлендж: 12 дней отчётов, переписка в чате, текущий — 13-й день, отчёт за сегодня ещё не сдан
  for (let day = 1; day <= 12; day++) {
    clock.set(at(addDays(flowStart, day - 1), 0, 5));
    await refreshFlowStatuses();
    await dayReports(flowStart, day, ownerId, membershipId, day >= 10);
  }
  clock.set(at(addDays(flowStart, 12), 8, 40));
  await refreshFlowStatuses();
  await dayReports(flowStart, 13, null, null, true);
  const last = await prisma.feedMessage.findFirst({ where: { flowId: flow.id, userId: PEOPLE[1].id }, orderBy: { createdAt: 'desc' } });
  clock.set(at(addDays(flowStart, 12), 11, 0));
  if (last) await postChat(PEOPLE[4].id, { text: 'Ааа, умница! 💜 Я тоже сегодня не сдалась!', replyToId: last.id });
  const mineLast = await prisma.feedMessage.findFirst({ where: { flowId: flow.id, userId: ownerId }, orderBy: { createdAt: 'desc' } });
  if (mineLast) await postChat(PEOPLE[0].id, { text: 'Ты молодец, так держать! 🔥', replyToId: mineLast.id });
  await computeLeaderboard(flow.id);
  return { userId: ownerId.toString(), go: '/' };
}

/** Перемотать время на следующий день (10:00): участники сдают отчёты, у владельца новый день */
export async function advanceDay() {
  assertDemo();
  const today = localDate(clock.now(), TZ);
  const next = addDays(today, 1);
  const flow = await prisma.flow.findFirst({ where: { startsOn: { lte: new Date(`${next}T00:00:00Z`) } }, orderBy: { startsOn: 'desc' } });
  if (flow) {
    const flowStart = flow.startsOn.toISOString().slice(0, 10);
    const day = Math.round((Date.parse(next) - Date.parse(flowStart)) / 86_400_000) + 1;
    clock.set(at(next, 0, 5));
    await refreshFlowStatuses();
    if (day >= 1 && day <= 31) await dayReports(flowStart, day, null, null, true);
    clock.set(at(next, 10, 0));
    await computeLeaderboard(flow.id);
  } else clock.set(at(next, 10, 0));
  return { now: clock.now().toISOString() };
}

export function demoInfo() {
  return { demo: config.DEMO_MODE, now: clock.now().toISOString() };
}
