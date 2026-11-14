import { createHmac } from 'node:crypto';
import { addDays, startOfIsoWeek, type ISODate } from '@thirty/domain';
import { z } from 'zod';
import { config } from '../config';
import { prisma } from '../db';
import { forbidden, notFound } from '../http';
import { getSetting } from '../settings';
import { currentMembership, memberWindow } from './flows';
import { loadFacts, weeklyLeaderboard } from './rating';
import { track } from './analytics';

/**
 * Итоги недели (ТЗ 14.11): после каждой из 4 недель личного челленджа — окно «Твой прогресс»
 * (выполнение, задачи, дни с отчётами, место в рейтинге недели) и карточка для сторис из конструктора.
 */
const WEEKS = 4;
/** Окно всплывает в течение 3 дней после окончания недели; позже — только в разделе карточек */
const POPUP_DAYS = 3;

function praise(week: number, percent: number) {
  if (percent < 50) {
    return {
      label: 'ТЫ В ИГРЕ',
      text: 'Неделя была непростой — но ты здесь, и это главное. Новая неделя — новый шанс: начни с малого и вернись в свой ритм 💜',
    };
  }
  return [
    { label: 'ТВОЯ ПОБЕДА', text: 'Ты сделала первые шаги к своей цели. Семь дней действий — отличный фундамент для новых привычек. Продолжай в том же духе!' },
    { label: 'ТВОЯ ПОБЕДА', text: 'Две недели позади! Ты уже не просто начала — ты держишь темп. Самое сложное — не сдаться в середине пути, и ты справляешься 🔥' },
    { label: 'ТВОЯ ПОБЕДА', text: 'Три недели в деле! Новые привычки уже становятся частью тебя. Впереди финишная прямая — не сбавляй скорость!' },
    { label: 'ТВОЯ ПОБЕДА', text: 'Четыре недели подряд ты держишь слово, данное себе. Это уже не челлендж, а твой новый образ жизни. Финал совсем близко!' },
  ][week - 1];
}

async function memberOf(userId: bigint) {
  const m = await currentMembership(userId);
  if (!m || !['active', 'finished'].includes(m.status) || !m.startsOn) throw forbidden('not_member', 'Итоги недели появятся после первой недели челленджа');
  return m;
}

/** Завершённые недели: неделя N закончилась, когда наступил день 7N+1 (или челлендж уже позади) */
function doneWeeks(w: ReturnType<typeof memberWindow>) {
  return Array.from({ length: WEEKS }, (_, i) => i + 1).filter((n) => w.today > addDays(w.start, 7 * n - 1));
}

export async function weekResult(userId: bigint, week?: number) {
  const m = await memberOf(userId);
  const w = memberWindow(m);
  const weeks = doneWeeks(w);
  const n = week ?? weeks.at(-1);
  if (!n || !weeks.includes(n)) throw notFound('week_not_ready');
  const from = addDays(w.start, 7 * (n - 1));
  const to = addDays(from, 6);
  const facts = await loadFacts(m.id, m.flow);
  const occ = facts.occurrences.filter((o) => o.windowEnd >= from && o.windowEnd <= to);
  const total = occ.length;
  const done = occ.filter((o) => o.done).length;
  const activeDays = new Set(facts.reportDates.filter((d) => d >= from && d <= to)).size;
  const percent = total ? Math.round((done / total) * 100) : 0;
  // Место — в рейтинге последней законченной календарной недели (пн–вс), как на экране «Рейтинг»
  const lastWeek = addDays(startOfIsoWeek(w.today), -7) as ISODate;
  const lb = await weeklyLeaderboard(userId, lastWeek).catch(() => null);
  const rank = lb?.me?.eligible && lb.me.rank ? { place: lb.me.rank, of: lb.rows.length } : null;
  return { week: n, of: WEEKS, weeks, from, to, percent, done, total, activeDays, days: 7, rank, ...praise(n, percent) };
}

/** Какое окно итогов показать на главной (не показанное ещё и не старше 3 дней) */
export async function pendingWeekResult(userId: bigint, m: { id: string; startsOn: Date | null; status: string; flow: Parameters<typeof memberWindow>[0]['flow']; timezone?: string | null }) {
  if (!['active', 'finished'].includes(m.status) || !m.startsOn) return null;
  const w = memberWindow(m);
  const n = doneWeeks(w).at(-1);
  if (!n) return null;
  const ended = addDays(w.start, 7 * n - 1);
  if (w.today > addDays(ended, POPUP_DAYS)) return null;
  const seen = await prisma.analyticsEvent.findUnique({ where: { eventId: `srv:week_result_seen:${m.id}:${n}` } });
  return seen ? null : n;
}

export async function markWeekSeen(userId: bigint, week: number) {
  const m = await memberOf(userId);
  await track({ userId, eventName: 'week_result_seen', metadata: { week }, dedupeKey: `week_result_seen:${m.id}:${week}` });
  return { ok: true };
}

// ───────────── Карточка для сторис ─────────────

export const weekCardInput = z.object({
  week: z.number().int().min(1).max(WEEKS),
  name: z.string().trim().max(40).optional(),
  result: z.string().trim().max(60).optional(),
  showPercent: z.boolean().default(true),
  showTasks: z.boolean().default(true),
  showDays: z.boolean().default(true),
  showRank: z.boolean().default(false),
});

export interface WeekCard { week: number; name?: string; result?: string; rows: string[]; link: string }

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

export async function buildWeekCard(userId: bigint, input: z.infer<typeof weekCardInput>): Promise<WeekCard> {
  const r = await weekResult(userId, input.week);
  const rows: string[] = [];
  if (input.showPercent) rows.push(`${r.percent}% выполнения за неделю`);
  if (input.showTasks && r.total) rows.push(`${r.done} из ${r.total} ${plural(r.total, 'задачи', 'задач', 'задач')} выполнено`);
  if (input.showDays) rows.push(`${r.activeDays} из 7 дней с отчётами`);
  if (input.showRank && r.rank) rows.push(r.rank.place <= 10 ? `${r.rank.place}-е место в рейтинге недели` : `Топ-${Math.ceil(r.rank.place / 10) * 10} в рейтинге недели`);
  await track({ userId, eventName: 'week_card_built', metadata: { week: input.week } });
  return { week: input.week, name: input.name || undefined, result: input.result || undefined, rows, link: await getSetting('stories.botLink') };
}

export function weekCardToken(card: WeekCard) {
  const body = Buffer.from(JSON.stringify(card)).toString('base64url');
  const sig = createHmac('sha256', config.MEDIA_SIGNING_SECRET).update(`wc.${body}`).digest('base64url').slice(0, 22);
  return `${body}.${sig}`;
}

export function readWeekCardToken(token: string): WeekCard | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', config.MEDIA_SIGNING_SECRET).update(`wc.${body}`).digest('base64url').slice(0, 22);
  if (expected !== sig) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString()) as WeekCard;
  } catch {
    return null;
  }
}
