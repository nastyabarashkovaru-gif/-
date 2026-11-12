import { createHmac } from 'node:crypto';
import { clock } from '../clock';
import { config } from '../config';
import { prisma } from '../db';

/**
 * Оплата прямо из бота (12.11): «ХОЧУ ОПЛАТИТЬ ВХОД» → сообщение «🔥 Выбери свой тариф» с кнопками-ссылками.
 * Кнопка тарифа ведёт на /pay/new/<токен>: сервер создаёт платёж CloudPayments и сразу открывает страницу оплаты.
 * Токен подписан и привязан к человеку и тарифу — переслать чужому нельзя (оплата запишется на того, кому выдан токен).
 */
const TTL_SEC = 24 * 3600;
const sign = (s: string) => createHmac('sha256', `${config.BOT_TOKEN}:botpay`).update(s).digest('base64url').slice(0, 22);

export function payToken(userId: bigint, tariffId: string, now = clock.now()) {
  const exp = Math.floor(now.getTime() / 1000) + TTL_SEC;
  const body = `${userId}.${tariffId}.${exp}`;
  return `${body}.${sign(body)}`;
}

export function readPayToken(token: string, now = clock.now()): { userId: bigint; tariffId: string } | null {
  const m = /^(\d+)\.(m1|m3|m6)\.(\d+)\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return null;
  if (sign(`${m[1]}.${m[2]}.${m[3]}`) !== m[4]) return null;
  if (Number(m[3]) < now.getTime() / 1000) return null;
  return { userId: BigInt(m[1]), tariffId: m[2] };
}

export const payUrl = (userId: bigint, tariffId: string) => `${config.PUBLIC_URL.replace(/\/$/, '')}/pay/new/${payToken(userId, tariffId)}`;

/** «Выбери свой тариф»: таймер скидки запускается (или идёт дальше), цены — из настроек тарифов */
export async function sendTariffPicker(userId: bigint) {
  const { startOffer } = await import('./billing');
  const { priceVars } = await import('../jobs/chains');
  const { sendTemplate } = await import('./bot');
  const { track } = await import('./analytics');
  await startOffer(userId);
  const base = config.PUBLIC_URL.replace(/\/$/, '');
  const vars = {
    ...(await priceVars()),
    pay_m1: payUrl(userId, 'm1'), pay_m3: payUrl(userId, 'm3'), pay_m6: payUrl(userId, 'm6'),
    offer_url: `${base}/doc/offer`, privacy_url: `${base}/doc/privacy`,
  };
  await track({ userId, eventName: 'bot_tariffs_open' });
  return sendTemplate(userId, 'tariffs_pick', vars, `tariffs_pick:${userId}:${clock.now().getTime()}`);
}

/** Нажала тариф в боте: клик по сообщению — в статистику сообщений */
export async function markPickClick(userId: bigint) {
  const log = await prisma.botMessageLog.findFirst({ where: { userId, templateKey: 'tariffs_pick', status: 'sent' }, orderBy: { sentAt: 'desc' } });
  if (log && !log.clickedAt) await prisma.botMessageLog.update({ where: { id: log.id }, data: { clickedAt: clock.now() } });
}
