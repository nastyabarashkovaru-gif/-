import { addDays, startOfLocalDay, type ISODate } from '@thirty/domain';
import { prisma } from '../db';
import { getSetting } from '../settings';
import type { DayRange } from './adminHome';

/**
 * Карта сообщений бота для раздела «Аналитика» (ТЗ 14.11).
 * Структура — из реальных шаблонов бота (тексты, кнопки, задержки берутся из базы при каждом запросе),
 * статистика — только из фактических событий: журнал отправок, нажатия, подтверждённые оплаты.
 */

type Btn = { text: string; screen?: string; url?: string; callback?: string };

/** Ключ кнопки: куда она ведёт (не текст) — при смене подписи статистика остаётся у той же кнопки */
export function buttonKey(b: Btn) {
  if (b.callback) return `cb:${b.callback}`;
  if (b.url !== undefined) return `url:${b.url}`;
  return `screen:${b.screen}`;
}

/** Кнопка, которая ведёт к выбору тарифа в боте */
const toPicker = (b: Btn) => b.callback === 'choose_tariff' || b.screen === 'tariffs';
/** Кнопка оплаты (открывает платёжную страницу) */
const payKeys = new Set(['url:{pay_m1}', 'url:{pay_m3}', 'url:{pay_m6}', 'url:{pay_again}']);
/** Кнопки-ссылки на сторонние ресурсы: Telegram не сообщает боту о таких нажатиях */
const untracked = (b: Btn) => b.url !== undefined && !b.url.startsWith('{pay_');

const strip = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

function fmtDelay(min: number) {
  if (min <= 0) return 'сразу';
  if (min < 60) return `через ${min} мин`;
  if (min % (24 * 60) === 0) return min === 24 * 60 ? 'через 24 часа' : `через ${min / (24 * 60)} дн.`;
  if (min % 60 === 0) return `через ${min / 60} ч`;
  return `через ${Math.floor(min / 60)} ч ${min % 60} мин`;
}

interface NodeDef { key: string; col: number; row: number }
interface EdgeDef { from: string; to: string; label: string; kind: 'auto' | 'button' }

/** Последовательность из настроек бота: тексты, кнопки и задержки — из шаблонов, порядок — из механики цепочки */
async function layout() {
  const tpls = await prisma.botMessageTemplate.findMany();
  const t = new Map(tpls.map((x) => [x.key, x]));
  const on = (k: string) => Boolean(t.get(k)?.enabled);
  const offerMin = await getSetting('offer.durationMinutes');
  const nodes: NodeDef[] = [];
  const edges: EdgeDef[] = [];
  const welcomeBtn = ((t.get('welcome')?.buttons as Btn[] | undefined) ?? []).find((b) => b.callback === 'how_to_join');
  const howBtn = ((t.get('how_to_join')?.buttons as Btn[] | undefined) ?? []).find(toPicker);

  // Ряд 1: приветствие → «как вступить» → выбор тарифа → «оплата не завершилась»
  nodes.push({ key: 'welcome', col: 0, row: 0 });
  nodes.push({ key: 'how_to_join', col: 1, row: 0 });
  edges.push({ from: 'welcome', to: 'how_to_join', kind: 'button', label: `«${welcomeBtn?.text ?? 'Ознакомился'}» или через 7 мин` });
  nodes.push({ key: 'tariffs_pick', col: 2, row: 0 });
  edges.push({ from: 'how_to_join', to: 'tariffs_pick', kind: 'button', label: `«${howBtn?.text ?? 'Хочу оплатить'}»` });
  if (on('pay_retry') || t.get('pay_retry')) {
    nodes.push({ key: 'pay_retry', col: 3, row: 0 });
    edges.push({ from: 'tariffs_pick', to: 'pay_retry', kind: 'auto', label: `не оплатила — ${fmtDelay(t.get('pay_retry')?.delayMinutes ?? 5)}` });
  }

  // Ряд 2: таймер скидки (через 10 мин после /start без тарифов) и дожимы от него
  const timer = ['chain_02', 'chain_03', 'chain_04', 'chain_05', 'chain_06', 'chain_07']
    .filter((k) => on(k))
    .map((k) => ({ key: k, at: t.get(k)!.delayMinutes }));
  const after = ['chain_08', 'chain_09', 'chain_12', 'chain_13', 'chain_14']
    .filter((k) => on(k))
    .map((k) => ({ key: k, at: offerMin + t.get(k)!.delayMinutes }));
  // новые дожимы, которых нет в известной последовательности, — в конец ряда
  const known = new Set(['chain_02', 'chain_03', 'chain_04', 'chain_05', 'chain_06', 'chain_07', 'chain_08', 'chain_09', 'chain_12', 'chain_13', 'chain_14', 'chain_10', 'chain_11', 'chain_15']);
  const extra = tpls.filter((x) => x.key.startsWith('chain_') && !known.has(x.key) && x.enabled).map((x) => ({ key: x.key, at: offerMin + x.delayMinutes }));
  const seq = [...timer, ...after, ...extra].sort((a, b) => a.at - b.at);
  let prev = { key: 'welcome', at: -10 };
  seq.forEach((s, i) => {
    nodes.push({ key: s.key, col: i + 1, row: 1 });
    edges.push({ from: prev.key, to: s.key, kind: 'auto', label: i === 0 ? `не открыла тарифы за 10 мин → таймер скидки, ${fmtDelay(s.at)}` : fmtDelay(s.at - prev.at) });
    prev = s;
  });

  // Ряд 3: перед ближайшим стартом (в 12:00)
  const starts = [
    { key: 'chain_10', label: 'за 2 дня до старта, в 12:00' },
    { key: 'chain_11', label: 'за 1 день до старта' },
    { key: 'chain_15', label: 'в день старта' },
  ].filter((s) => on(s.key));
  let p2 = 'welcome';
  starts.forEach((s, i) => {
    nodes.push({ key: s.key, col: i + 1, row: 2 });
    edges.push({ from: p2, to: s.key, kind: 'auto', label: i === 0 ? `к ближайшему старту: ${s.label}` : s.label });
    p2 = s.key;
  });
  return { t, nodes, edges };
}

/** Карта за период: отправки, нажатия по каждой кнопке, оплаты по кнопкам оплаты — по уникальным людям */
export async function funnelMap(r: DayRange) {
  const zone = await getSetting('flow.timezone');
  const from = startOfLocalDay(r.from as ISODate, zone);
  const to = startOfLocalDay(addDays(r.to as ISODate, 1), zone);
  const { t, nodes, edges } = await layout();
  const keys = nodes.map((n) => n.key);

  // Отправки: журнал бота (проверочные отправки владелице не считаем)
  const logs = await prisma.botMessageLog.findMany({
    where: { templateKey: { in: keys }, status: 'sent', sentAt: { gte: from, lt: to }, NOT: [{ dedupeKey: { startsWith: 'test:' } }, { dedupeKey: { startsWith: 'preview:' } }] },
    select: { userId: true, templateKey: true, clickedAt: true, id: true },
  });
  const sent = new Map<string, Set<string>>();
  for (const l of logs) (sent.get(l.templateKey) ?? sent.set(l.templateKey, new Set()).get(l.templateKey)!).add(l.userId.toString());

  // Нажатия: новые события с точной кнопкой + то, что было записано до них (журнал и прежние события)
  const clicks = new Map<string, Set<string>>(); // `${template}|${buttonKey}` → люди
  const add = (tpl: string, key: string, uid: bigint | string | null) => {
    if (uid === null || uid === undefined) return;
    const k = `${tpl}|${key}`;
    (clicks.get(k) ?? clicks.set(k, new Set()).get(k)!).add(uid.toString());
  };
  const payByClick = new Map<string, Set<string>>(); // `${template}|${buttonKey}` → paymentId
  const addPay = (tpl: string, key: string, paymentId: unknown) => {
    if (typeof paymentId !== 'string') return;
    const k = `${tpl}|${key}`;
    (payByClick.get(k) ?? payByClick.set(k, new Set()).get(k)!).add(paymentId);
  };
  const events = await prisma.analyticsEvent.findMany({
    where: { ts: { gte: from, lt: to }, eventName: { in: ['bot_button_click', 'bot_pay_click', 'tribute_click', 'bot_tariffs_open', 'bot_how_to_join_click'] } },
    select: { userId: true, eventName: true, tariffId: true, screenId: true, metadata: true },
  });
  for (const e of events) {
    const m = (e.metadata ?? {}) as Record<string, unknown>;
    if (e.eventName === 'bot_button_click') {
      add(String(m.template), String(m.key), e.userId);
      addPay(String(m.template), String(m.key), m.paymentId);
    } else if (e.eventName === 'bot_pay_click' && !m.tracked) {
      // до точного учёта (14.11): кнопки тарифа вели из «Выбери свой тариф»
      add('tariffs_pick', `url:{pay_${e.tariffId}}`, e.userId);
      addPay('tariffs_pick', `url:{pay_${e.tariffId}}`, m.paymentId);
    } else if (e.eventName === 'tribute_click' && e.screenId === 'bot' && !m.tracked) {
      add('tariffs_pick', 'url:{pay_tribute}', e.userId);
    } else if (e.eventName === 'bot_tariffs_open' && !m.tracked) {
      // до точного учёта «Выбери свой тариф» открывали из «Как вступить»
      add('how_to_join', 'cb:choose_tariff', e.userId);
    } else if (e.eventName === 'bot_how_to_join_click') {
      add('welcome', 'cb:how_to_join', e.userId);
    }
  }
  // Журнал: нажатие на сообщение с одной отслеживаемой кнопкой (дожимы, приветствие)
  for (const l of logs) {
    if (!l.clickedAt) continue;
    const btns = ((t.get(l.templateKey)?.buttons as Btn[] | undefined) ?? []).filter((b) => !untracked(b));
    if (l.templateKey === 'welcome') add('welcome', 'cb:how_to_join', l.userId);
    else if (btns.length === 1) add(l.templateKey, buttonKey(btns[0]), l.userId);
  }

  // Оплаты: только подтверждённые, без тестовых
  const payIds = [...new Set([...payByClick.values()].flatMap((s) => [...s]))];
  const paid = new Map((await prisma.payment.findMany({ where: { id: { in: payIds }, paidAt: { not: null }, test: false }, select: { id: true, userId: true } })).map((p) => [p.id, p.userId.toString()]));

  // Превью с настоящими ценами и датой ближайшего старта вместо {r1}, {p3}, {start_date}
  const { priceVars } = await import('../jobs/chains');
  const { nextMarketingStart } = await import('./promos');
  const { humanDate, localDate } = await import('@thirty/domain');
  const sample: Record<string, string> = { ...(await priceVars()), start_date: humanDate(nextMarketingStart(localDate(new Date(), zone))), days_left: 'N дней' };
  const fill = (txt: string) => txt.replace(/\{(\w+)\}/g, (m, k: string) => sample[k] ?? '…');
  const out = nodes.map((n) => {
    const tpl = t.get(n.key);
    const recipients = sent.get(n.key)?.size ?? 0;
    const buttons = ((tpl?.buttons as Btn[] | undefined) ?? []).map((b) => {
      const key = buttonKey(b);
      if (untracked(b)) return { text: b.text, key, clicks: null, pct: null, note: 'Telegram не сообщает о нажатиях на кнопки-ссылки' };
      const who = clicks.get(`${n.key}|${key}`)?.size ?? 0;
      const isPay = payKeys.has(key);
      const payers = isPay ? new Set([...(payByClick.get(`${n.key}|${key}`) ?? [])].map((id) => paid.get(id)).filter(Boolean)).size : null;
      return {
        text: b.text,
        key,
        to: toPicker(b) ? 'tariffs_pick' : null,
        clicks: who,
        pct: recipients ? Math.round((who / recipients) * 1000) / 10 : null,
        paid: payers,
        paidPct: isPay && who ? Math.round(((payers ?? 0) / who) * 1000) / 10 : null,
      };
    });
    const text = fill(strip(tpl?.text ?? ''));
    return {
      key: n.key,
      col: n.col,
      row: n.row,
      title: tpl?.title ?? n.key,
      enabled: Boolean(tpl?.enabled),
      preview: text.length > 70 ? `${text.slice(0, 70).trim()}…` : text,
      text,
      sent: recipients,
      buttons,
      note: n.key === 'welcome' ? 'Считается первый /start каждого человека — повторные /start в журнал не записываются' : null,
    };
  });
  return { range: r, nodes: out, edges };
}

/** Выручка и прибыль: успешные оплаты за период, возвраты, фактическая комиссия CloudPayments из уведомлений */
export async function funnelMoney(r: DayRange) {
  const zone = await getSetting('flow.timezone');
  const from = startOfLocalDay(r.from as ISODate, zone);
  const to = startOfLocalDay(addDays(r.to as ISODate, 1), zone);
  const [paid, refunded] = await Promise.all([
    prisma.payment.findMany({ where: { test: false, paidAt: { gte: from, lt: to }, status: { in: ['paid', 'refunded'] } }, select: { id: true, amount: true, providerOrderId: true } }),
    prisma.payment.findMany({ where: { test: false, status: 'refunded', refundedAt: { gte: from, lt: to } }, select: { amount: true } }),
  ]);
  const revenue = paid.reduce((s, p) => s + p.amount, 0);
  const refunds = refunded.reduce((s, p) => s + p.amount, 0);
  // Комиссия: поле TotalFee из уведомления CloudPayments об этой оплате (по номеру транзакции)
  const tx = new Map(paid.filter((p) => p.providerOrderId?.startsWith('cp:')).map((p) => [p.providerOrderId!.slice(3), p]));
  const events = tx.size
    ? await prisma.paymentEvent.findMany({ where: { provider: 'cloudpayments', status: 'paid', createdAt: { gte: new Date(from.getTime() - 86400_000), lt: new Date(to.getTime() + 86400_000) } }, select: { payload: true } })
    : [];
  const fee = new Map<string, number>();
  for (const e of events) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const id = String(p.TransactionId ?? '');
    const f = Number(String(p.TotalFee ?? '').replace(',', '.'));
    if (tx.has(id) && p.TotalFee !== undefined && p.TotalFee !== '' && Number.isFinite(f)) fee.set(id, f);
  }
  const commission = Math.round([...fee.values()].reduce((s, f) => s + f, 0) * 100) / 100;
  const noFee = paid.length - fee.size;
  return {
    revenue,
    refunds,
    commission: fee.size ? commission : null,
    noFeeData: noFee,
    profit: revenue - refunds - (fee.size ? commission : 0),
    payments: paid.length,
  };
}

/**
 * Конверсия из зашедших в бота в покупку (16.11): кто впервые нажал /start в периоде (приветствие в журнале — первое),
 * сколько из них оплатили (подтверждённая оплата, без тестовых; оплата могла быть и позже периода).
 */
export async function botConversion(r: DayRange) {
  const zone = await getSetting('flow.timezone');
  const from = startOfLocalDay(r.from as ISODate, zone);
  const to = startOfLocalDay(addDays(r.to as ISODate, 1), zone);
  const entered = await prisma.botMessageLog.findMany({
    where: { templateKey: 'welcome', status: 'sent', sentAt: { gte: from, lt: to }, NOT: [{ dedupeKey: { startsWith: 'test:' } }, { dedupeKey: { startsWith: 'preview:' } }] },
    select: { userId: true },
    distinct: ['userId'],
  });
  const ids = entered.map((e) => e.userId);
  const buyers = ids.length
    ? (await prisma.payment.findMany({ where: { userId: { in: ids }, test: false, paidAt: { not: null }, status: { in: ['paid', 'refunded'] } }, select: { userId: true }, distinct: ['userId'] })).length
    : 0;
  return { entered: ids.length, buyers, percent: ids.length ? Math.round((buyers / ids.length) * 1000) / 10 : null };
}
