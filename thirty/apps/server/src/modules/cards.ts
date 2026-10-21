import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import QRCode from 'qrcode';
import { Resvg } from '@resvg/resvg-js';
import { cardForFlowDay, flowBounds, flowDayNumber, fromDbDate, plural, weekCardStats } from '@thirty/domain';
import { clock } from '../clock';
import { prisma, isUniqueViolation } from '../db';
import { forbidden, notFound } from '../http';
import { appLink } from '../lib/telegram';
import { flowToday } from './flows';
import { loadFacts } from './rating';
import { computeStats } from '@thirty/domain';
import { track } from './analytics';

/** Персональная реферальная ссылка: startapp=ref_<code> */
export async function referralLink(userId: bigint) {
  const existing = await prisma.referralLink.findUnique({ where: { userId } });
  if (existing) return existing;
  for (;;) {
    try {
      return await prisma.referralLink.create({ data: { userId, code: randomBytes(5).toString('base64url') } });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
}

export async function cardStats(membershipId: string, week: number) {
  const m = await prisma.flowMembership.findUniqueOrThrow({ where: { id: membershipId }, include: { flow: true, user: true } });
  const facts = await loadFacts(membershipId, m.flow);
  const stats = computeStats(facts);
  const completedByDate: Record<string, number> = {};
  for (const o of facts.occurrences) if (o.done) completedByDate[o.windowEnd] = (completedByDate[o.windowEnd] ?? 0) + 1;
  const successfulDates = stats.days.filter((d) => d.state === 'success').map((d) => d.date);
  const w = weekCardStats({ flowStart: facts.flowStart, flowEnd: facts.flowEnd, week, successfulDates, completedByDate });
  return { m, stats, w };
}

/** Какие карточки уже доступны: каждые 7 дней от старта (7/14/21/28) и итоговая после финала */
export async function availableCards(membershipId: string) {
  const m = await prisma.flowMembership.findUniqueOrThrow({ where: { id: membershipId }, include: { flow: true } });
  const startsOn = fromDbDate(m.flow.startsOn);
  const today = flowToday(m.flow);
  const day = flowDayNumber(startsOn, today);
  const weeks = [1, 2, 3, 4].filter((w) => day >= w * 7);
  if (today > flowBounds(startsOn).endsOn) weeks.push(5);
  return weeks;
}

/** Создать/обновить карточку недели (идемпотентно) */
export async function generateCard(userId: bigint, membershipId: string, week: number) {
  const weeks = await availableCards(membershipId);
  if (!weeks.includes(week)) throw forbidden('card_not_ready', 'Карточка появится по итогам недели');
  const { m, stats, w } = await cardStats(membershipId, week);
  if (m.userId !== userId) throw notFound();
  const payload = {
    week,
    from: w.from,
    to: w.to,
    successfulDays: w.successfulDays,
    previous: w.previous?.successfulDays ?? null,
    delta: w.delta,
    percent: Math.round(stats.ratio * 100),
    streak: stats.currentStreak,
    totalDays: flowBounds(fromDbDate(m.flow.startsOn)).days,
    flowTitle: m.flow.title,
  };
  const card = await prisma.shareCard.upsert({
    where: { membershipId_week: { membershipId, week } },
    create: { membershipId, week, stats: payload },
    update: { stats: payload },
  });
  await track({ userId, eventName: 'share_card_generated', screenId: 'S31', flowId: m.flowId, metadata: { week }, dedupeKey: `card:${membershipId}:${week}:${clock.now().toISOString().slice(0, 10)}` });
  const ref = await referralLink(userId);
  return { id: card.id, stats: payload, link: appLink(`ref_${ref.code}`) };
}

export { cardForFlowDay };

// ───────────── Рендер PNG ─────────────

const here = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIRS = [path.resolve(here, '../../assets/fonts'), path.resolve(here, '../assets/fonts'), path.resolve(process.cwd(), 'assets/fonts')];
const fontDir = FONT_DIRS.find((d) => existsSync(d));
const fontFiles = fontDir ? ['Inter-Regular.otf', 'Inter-SemiBold.otf', 'Inter-Bold.otf'].map((f) => path.join(fontDir, f)) : [];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function renderCardPng(stats: Record<string, any>, link: string): Promise<Buffer> {
  const qr = QRCode.create(link, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const cell = 240 / size;
  let qrRects = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (qr.modules.get(x, y)) qrRects += `<rect x="${(x * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${(cell + 0.3).toFixed(2)}" height="${(cell + 0.3).toFixed(2)}"/>`;
  const final = stats.week === 5;
  const title = final ? 'Итог месяца' : `Неделя ${stats.week}`;
  const big = final ? `${stats.percent}%` : `${stats.successfulDays} из 7`;
  const sub = final ? `выполнено обязательств · ${stats.flowTitle}` : `${plural(stats.successfulDays, 'успешный день', 'успешных дня', 'успешных дней')} · ${stats.flowTitle}`;
  const delta = stats.delta === null || stats.delta === undefined ? '' : stats.week === 1 ? `+${stats.successfulDays} к стартовой точке 0` : `${stats.delta >= 0 ? '+' : '−'}${Math.abs(stats.delta)} к прошлой неделе`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <rect width="1080" height="1920" fill="#FFF9F2"/>
  <text x="96" y="200" font-family="Inter" font-weight="700" font-size="64" fill="#FF6B35">30 дней</text>
  <text x="96" y="262" font-family="Inter" font-size="36" fill="#20211F" fill-opacity="0.6">клуб дисциплины</text>
  <rect x="64" y="360" width="952" height="760" rx="48" fill="#FFFFFF"/>
  <text x="128" y="470" font-family="Inter" font-weight="600" font-size="40" fill="#20211F" fill-opacity="0.55">${esc(title.toUpperCase())}</text>
  <text x="128" y="640" font-family="Inter" font-weight="700" font-size="150" fill="#20211F">${esc(big)}</text>
  <text x="128" y="720" font-family="Inter" font-size="40" fill="#20211F" fill-opacity="0.6">${esc(sub)}</text>
  ${delta ? `<rect x="128" y="790" width="824" height="110" rx="28" fill="#E3F5EA"/><text x="168" y="862" font-family="Inter" font-weight="600" font-size="44" fill="#2FB56C">${esc(delta)} ↑</text>` : ''}
  <text x="128" y="1010" font-family="Inter" font-size="40" fill="#20211F">Серия: <tspan font-weight="700">${stats.streak} ${plural(stats.streak, 'день', 'дня', 'дней')}</tspan>   ·   Всего: <tspan font-weight="700">${stats.percent}%</tspan></text>
  <rect x="64" y="1200" width="952" height="150" rx="48" fill="#FF6B35"/>
  <text x="540" y="1295" text-anchor="middle" font-family="Inter" font-weight="600" font-size="52" fill="#FFFFFF">Присоединяйся к челленджу</text>
  <g transform="translate(96,1480)"><rect x="-16" y="-16" width="272" height="272" rx="24" fill="#FFFFFF"/><g fill="#20211F">${qrRects}</g></g>
  <text x="400" y="1560" font-family="Inter" font-weight="600" font-size="40" fill="#20211F">Сканируй и начни</text>
  <text x="400" y="1620" font-family="Inter" font-weight="600" font-size="40" fill="#20211F">свои 30 дней</text>
  <text x="400" y="1690" font-family="Inter" font-size="30" fill="#20211F" fill-opacity="0.5">${esc(link.replace('https://', ''))}</text>
</svg>`;
  const r = new Resvg(svg, { font: { fontFiles, loadSystemFonts: fontFiles.length === 0, defaultFontFamily: 'Inter' }, fitTo: { mode: 'width', value: 1080 } });
  return Buffer.from(r.render().asPng());
}
