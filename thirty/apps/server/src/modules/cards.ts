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
const fontFiles = fontDir ? ['Inter-Regular.otf', 'Inter-SemiBold.otf', 'Inter-Bold.otf', 'Inter-Light.otf', 'InterDisplay-Light.otf', 'InterDisplay-ExtraLight.otf'].map((f) => path.join(fontDir, f)).filter((f) => existsSync(f)) : [];

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
  ${delta ? (() => {
    const up = stats.week === 1 || stats.delta >= 0;
    return `<rect x="128" y="790" width="824" height="110" rx="28" fill="${up ? '#E3F5EA' : '#F1F0ED'}"/><text x="168" y="862" font-family="Inter" font-weight="600" font-size="44" fill="${up ? '#2FB56C' : '#6B6B66'}">${esc(delta)}${up ? ' ↑' : ''}</text>`;
  })() : ''}
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

/** Карточка для сторис «Я иду на челлендж 30 дней»: пустые строки под цели и отметка аккаунта */
export function renderStoryCardPng(account: string): Buffer {
  const lines = [0, 1, 2]
    .map((i) => {
      const y = 1010 + i * 170;
      return `<text x="170" y="${y}" font-family="Inter" font-weight="700" font-size="54" fill="#6C51DF">${i + 1}.</text><line x1="240" y1="${y + 12}" x2="900" y2="${y + 12}" stroke="#D7D2F4" stroke-width="4" stroke-dasharray="14 12" stroke-linecap="round"/>`;
    })
    .join('');
  const tag = account ? `@${esc(account.replace(/^@/, ''))}` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <rect width="1080" height="1920" fill="#F3F0FF"/>
  <circle cx="980" cy="160" r="260" fill="#E6DFFF"/>
  <circle cx="80" cy="1780" r="300" fill="#E6DFFF"/>
  <rect x="96" y="150" width="132" height="110" rx="30" fill="#7150E7"/>
  <text x="162" y="228" text-anchor="middle" font-family="Inter" font-weight="600" font-size="60" fill="#FFFFFF">30</text>
  <text x="252" y="228" font-family="Inter" font-weight="600" font-size="56" fill="#211C35">дней</text>
  <text x="96" y="430" font-family="Inter" font-weight="700" font-size="92" fill="#211C35">Я иду</text>
  <text x="96" y="540" font-family="Inter" font-weight="700" font-size="92" fill="#211C35">на челлендж</text>
  <text x="96" y="650" font-family="Inter" font-weight="700" font-size="92" fill="#7150E7">«30 дней»</text>
  <rect x="96" y="760" width="888" height="660" rx="48" fill="#FFFFFF"/>
  <text x="150" y="870" font-family="Inter" font-weight="600" font-size="46" fill="#77718C">Мои цели на месяц:</text>
  ${lines}
  <text x="540" y="1560" text-anchor="middle" font-family="Inter" font-size="44" fill="#77718C">Новые привычки, новые люди,</text>
  <text x="540" y="1620" text-anchor="middle" font-family="Inter" font-size="44" fill="#77718C">новая версия меня</text>
  ${tag ? `<rect x="${540 - (tag.length * 15 + 60)}" y="1690" width="${tag.length * 30 + 120}" height="100" rx="50" fill="#6C51DF"/><text x="540" y="1757" text-anchor="middle" font-family="Inter" font-weight="600" font-size="46" fill="#FFFFFF">${tag}</text>` : ''}
</svg>`;
  const r = new Resvg(svg, { font: { fontFiles, loadSystemFonts: fontFiles.length === 0, defaultFontFamily: 'Inter' }, fitTo: { mode: 'width', value: 1080 } });
  return Buffer.from(r.render().asPng());
}

/** Перенос текста по словам для SVG (у SVG нет автопереноса) */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = `${cut[maxLines - 1].replace(/[.,;:!?]?$/, '')}…`;
    return cut;
  }
  return lines;
}

function qrSvg(link: string, px: number) {
  const qr = QRCode.create(link, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const cell = px / size;
  let rects = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (qr.modules.get(x, y)) rects += `<rect x="${(x * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${(cell + 0.3).toFixed(2)}" height="${(cell + 0.3).toFixed(2)}"/>`;
  return rects;
}

/** Карточка результатов месяца для сторис (1080×1920): тёмная, тонкий шрифт, маленький QR на бота */
export function renderResultCardPng(card: { name?: string; result?: string; days?: number; goal?: string; percent?: number; rank?: string; link: string }): Buffer {
  const rows: string[] = [];
  if (card.days !== undefined) rows.push(`${card.days} ${plural(card.days, 'день', 'дня', 'дней')} с отчётами`);
  if (card.goal) rows.push(card.goal);
  if (card.percent !== undefined) rows.push(`${card.percent}% дисциплины`);
  if (card.rank) rows.push(card.rank);
  const result = card.result ? wrap(card.result, 22, 3) : [];
  const D = 'Inter Display';
  const check = (x: number, y: number, r: number) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="#2FBF71"/><path d="M${x - r * 0.42} ${y + r * 0.02}l${r * 0.3} ${r * 0.3} ${r * 0.56}-${r * 0.6}" stroke="#0B0A10" stroke-width="${(r * 0.2).toFixed(1)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  let y = 690;
  const resultSvg = result.length
    ? `<text x="120" y="${y}" font-family="Inter" font-weight="300" font-size="26" letter-spacing="6" fill="#8D88A3">МОЙ РЕЗУЛЬТАТ</text>` +
      result.map((l, i) => `<text x="120" y="${y + 100 + i * 84}" font-family="${D}" font-weight="300" font-size="72" fill="#F6F4FB">${esc(l)}</text>`).join('')
    : '';
  if (result.length) y += 100 + result.length * 84 + 50;
  const rowsSvg = rows
    .map((t, i) => {
      const ry = y + 40 + i * 86;
      return `${check(138, ry - 12, 17)}<text x="180" y="${ry}" font-family="Inter" font-weight="300" font-size="38" fill="#E4E1EE">${esc(t)}</text>`;
    })
    .join('');
  const link = card.link.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <radialGradient id="glow" cx="0.85" cy="0.08" r="0.6"><stop offset="0" stop-color="#7150E7" stop-opacity="0.38"/><stop offset="1" stop-color="#7150E7" stop-opacity="0"/></radialGradient>
    <radialGradient id="glow2" cx="0.1" cy="0.95" r="0.5"><stop offset="0" stop-color="#2FBF71" stop-opacity="0.10"/><stop offset="1" stop-color="#2FBF71" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1080" height="1920" fill="#0B0A10"/>
  <rect width="1080" height="1920" fill="url(#glow)"/>
  <rect width="1080" height="1920" fill="url(#glow2)"/>
  <rect x="120" y="150" width="76" height="62" rx="18" fill="none" stroke="#B7A6FF" stroke-width="2"/>
  <text x="158" y="193" text-anchor="middle" font-family="Inter" font-weight="400" font-size="32" fill="#E9E4FF">30</text>
  <text x="214" y="193" font-family="Inter" font-weight="300" font-size="32" fill="#E9E4FF">дней</text>
  <text x="120" y="400" font-family="${D}" font-weight="200" font-size="92" letter-spacing="4" fill="#FFFFFF">МОИ 30 ДНЕЙ</text>
  ${check(860, 368, 26)}
  ${card.name ? `<text x="120" y="470" font-family="Inter" font-weight="300" font-size="36" fill="#B7A6FF">${esc(card.name)}</text>` : ''}
  <line x1="120" y1="560" x2="960" y2="560" stroke="#2A2733" stroke-width="2"/>
  ${resultSvg}
  ${rowsSvg}
  <line x1="120" y1="1560" x2="960" y2="1560" stroke="#2A2733" stroke-width="2"/>
  <g transform="translate(120,1620)"><rect x="-10" y="-10" width="170" height="170" rx="18" fill="#F6F4FB"/><g fill="#0B0A10">${qrSvg(card.link, 150)}</g></g>
  <text x="330" y="1690" font-family="Inter" font-weight="300" font-size="38" fill="#F6F4FB">Присоединяйся и ты к нам!</text>
  <text x="330" y="1745" font-family="Inter" font-weight="300" font-size="28" fill="#8D88A3">${esc(link)}</text>
</svg>`;
  const r = new Resvg(svg, { font: { fontFiles, loadSystemFonts: fontFiles.length === 0, defaultFontFamily: 'Inter' }, fitTo: { mode: 'width', value: 1080 } });
  return Buffer.from(r.render().asPng());
}
