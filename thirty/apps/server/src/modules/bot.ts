import { randomUUID } from 'node:crypto';
import type { BotMessageTemplate } from '@prisma/client';
import { clock } from '../clock';
import { prisma, isUniqueViolation } from '../db';
import { openAppButton, tg, TelegramError } from '../lib/telegram';
import { CHAIN_TEMPLATES, DEFAULT_TEMPLATES, HOW_TO_JOIN_BUTTONS, HOW_TO_JOIN_TEXT, WELCOME_BUTTONS, WELCOME_IMAGE, WELCOME_TEXT } from './templates';
import { config } from '../config';
import { setNotifier } from './notify';
import { track } from './analytics';

export async function seedTemplates() {
  for (const t of DEFAULT_TEMPLATES) {
    await prisma.botMessageTemplate.upsert({ where: { key: t.key }, create: { ...t, approved: false }, update: {} });
  }
  // Цепочка владельца: тексты утверждены
  for (const t of CHAIN_TEMPLATES) {
    await prisma.botMessageTemplate.upsert({ where: { key: t.key }, create: { ...t, approved: true }, update: {} });
  }
  // Разово: тексты с жирным шрифтом и картинка приветствия (25.10)
  const v2 = 'maintenance.chainV2';
  if (!(await prisma.setting.findUnique({ where: { key: v2 } }))) {
    for (const t of CHAIN_TEMPLATES) await prisma.botMessageTemplate.update({ where: { key: t.key }, data: { text: t.text } }).catch(() => undefined);
    await prisma.botMessageTemplate.update({ where: { key: 'welcome' }, data: { text: WELCOME_TEXT, imageUrl: WELCOME_IMAGE } }).catch(() => undefined);
    for (const k of ['promo_issued']) {
      const d = DEFAULT_TEMPLATES.find((x) => x.key === k);
      if (d) await prisma.botMessageTemplate.update({ where: { key: k }, data: { text: d.text } }).catch(() => undefined);
    }
    await prisma.setting.create({ data: { key: v2, value: { at: new Date().toISOString() } } });
  }
  // Разово (25.10): из сообщения 11 убрана фраза про «первые три часа»
  const v3 = 'maintenance.chainV3';
  if (!(await prisma.setting.findUnique({ where: { key: v3 } }))) {
    const t11 = await prisma.botMessageTemplate.findUnique({ where: { key: 'chain_11' } });
    if (t11) await prisma.botMessageTemplate.update({ where: { key: 'chain_11' }, data: { text: t11.text.replace(/\n*Это те же цены, которые были доступны тебе в первые три часа после знакомства с клубом\./, '') } });
    await prisma.setting.create({ data: { key: v3, value: { at: new Date().toISOString() } } });
  }
  // Разово (25.10): «30 дней» не разрывается переносом строки (неразрывный пробел)
  const v4 = 'maintenance.chainV4';
  if (!(await prisma.setting.findUnique({ where: { key: v4 } }))) {
    for (const t of await prisma.botMessageTemplate.findMany({ where: { text: { contains: '30 ' } } })) {
      const text = t.text.replace(/30 (дней|ДНЕЙ|днями|днях)/g, '30\u00a0$1');
      if (text !== t.text) await prisma.botMessageTemplate.update({ where: { key: t.key }, data: { text } });
    }
    await prisma.setting.create({ data: { key: v4, value: { at: new Date().toISOString() } } });
  }
  // Разово (26.10): в сообщении об оплате больше нет строки про следующее списание
  const v5 = 'maintenance.paymentSuccessV1';
  if (!(await prisma.setting.findUnique({ where: { key: v5 } }))) {
    const t = await prisma.botMessageTemplate.findUnique({ where: { key: 'payment_success' } });
    if (t) await prisma.botMessageTemplate.update({ where: { key: t.key }, data: { text: t.text.replace(/\nСледующее списание: \{next_date\}, \{next_amount\} ₽ \(отключить можно в профиле\)\./, '') } });
    await prisma.setting.create({ data: { key: v5, value: { at: new Date().toISOString() } } });
  }
  // Разово (27.10): трекеры одной таблицей — сообщение о выдаче с блоком ссылок
  const v6 = 'maintenance.trackersV1';
  if (!(await prisma.setting.findUnique({ where: { key: v6 } }))) {
    const d = DEFAULT_TEMPLATES.find((x) => x.key === 'trackers_granted');
    if (d) await prisma.botMessageTemplate.update({ where: { key: 'trackers_granted' }, data: { text: d.text } }).catch(() => undefined);
    await prisma.setting.create({ data: { key: v6, value: { at: new Date().toISOString() } } });
  }
  // Разово (29.10): «Сейчас с нами уже 274 участника» — дальше +1 за каждую новую оплату
  const v8 = 'maintenance.communityV1';
  if (!(await prisma.setting.findUnique({ where: { key: v8 } }))) {
    const { setSetting } = await import('../settings');
    await setSetting('community.count', '274');
    await setSetting('community.countSince', new Date().toISOString());
    await prisma.setting.create({ data: { key: v8, value: { at: new Date().toISOString() } } });
  }
  // Разово (30.10): сообщение после оплаты — анкета до старта и ссылка в чат (текст владельца)
  const v9 = 'maintenance.paymentSuccessV2';
  if (!(await prisma.setting.findUnique({ where: { key: v9 } }))) {
    const d = DEFAULT_TEMPLATES.find((x) => x.key === 'payment_success');
    if (d) await prisma.botMessageTemplate.update({ where: { key: 'payment_success' }, data: { text: d.text, buttons: d.buttons as object } }).catch(() => undefined);
    await prisma.setting.create({ data: { key: v9, value: { at: new Date().toISOString() } } });
  }
  // Код ссылки для перехода оплативших до запуска приложения — случайный, хранится только в базе
  const legacy = await prisma.setting.findUnique({ where: { key: 'legacy.invite' } });
  if (!legacy || !(legacy.value as { code?: string }).code) {
    const { newLegacyCode } = await import('./legacy');
    const { getSetting, setSetting } = await import('../settings');
    await setSetting('legacy.invite', { ...(await getSetting('legacy.invite')), code: newLegacyCode() });
  }
  // Разово (30.10): напоминание о конце периода ведёт к продлению (автопродление у CloudPayments не включается обратно)
  const v10 = 'maintenance.periodEndingV2';
  if (!(await prisma.setting.findUnique({ where: { key: v10 } }))) {
    const d = DEFAULT_TEMPLATES.find((x) => x.key === 'period_ending');
    if (d) await prisma.botMessageTemplate.update({ where: { key: 'period_ending' }, data: { text: d.text, buttons: d.buttons as object } }).catch(() => undefined);
    await prisma.setting.create({ data: { key: v10, value: { at: new Date().toISOString() } } });
  }
  // Разово (31.10): новый текст приветствия владельца (картинка и кнопка — прежние)
  const v11 = 'maintenance.welcomeV2';
  if (!(await prisma.setting.findUnique({ where: { key: v11 } }))) {
    await prisma.botMessageTemplate.update({ where: { key: 'welcome' }, data: { text: WELCOME_TEXT } }).catch(() => undefined);
    await prisma.setting.create({ data: { key: v11, value: { at: new Date().toISOString() } } });
  }
  // Разово (31.10): конец приветствия и кнопка — «Хочу вступить»
  const v12 = 'maintenance.welcomeV3';
  if (!(await prisma.setting.findUnique({ where: { key: v12 } }))) {
    await prisma.botMessageTemplate.update({ where: { key: 'welcome' }, data: { text: WELCOME_TEXT, buttons: WELCOME_BUTTONS } }).catch(() => undefined);
    await prisma.setting.create({ data: { key: v12, value: { at: new Date().toISOString() } } });
  }
  // Разово (31.10): приветствие как в прежнем боте — видео, правила PDF, три кнопки; второе сообщение «как вступить»
  const v13 = 'maintenance.welcomeV4';
  if (!(await prisma.setting.findUnique({ where: { key: v13 } }))) {
    await prisma.botMessageTemplate.update({ where: { key: 'welcome' }, data: { text: WELCOME_TEXT, buttons: WELCOME_BUTTONS, approved: true } }).catch(() => undefined);
    await prisma.setting.create({ data: { key: v13, value: { at: new Date().toISOString() } } });
  }
  // Разово (31.10): кнопка «Изучить ЧАСТЫЕ ВОПРОСЫ» убрана из обоих сообщений
  const v14 = 'maintenance.noFaqV1';
  if (!(await prisma.setting.findUnique({ where: { key: v14 } }))) {
    await prisma.botMessageTemplate.update({ where: { key: 'welcome' }, data: { buttons: WELCOME_BUTTONS } }).catch(() => undefined);
    await prisma.botMessageTemplate.update({ where: { key: 'how_to_join' }, data: { buttons: HOW_TO_JOIN_BUTTONS } }).catch(() => undefined);
    await prisma.setting.create({ data: { key: v14, value: { at: new Date().toISOString() } } });
  }
  // Разово (31.10): картинка приветствия в светлой теме (если владелец не ставила свою)
  const v15 = 'maintenance.welcomeLightV1';
  if (!(await prisma.setting.findUnique({ where: { key: v15 } }))) {
    await prisma.botMessageTemplate.updateMany({ where: { key: 'welcome', imageUrl: '{public_url}/img/bot-welcome.jpg' }, data: { imageUrl: WELCOME_IMAGE } });
    await prisma.setting.create({ data: { key: v15, value: { at: new Date().toISOString() } } });
  }
  // Разово (31.10): из «как вступить» убраны абзацы про минимальный срок и бездельников
  const v16 = 'maintenance.howToJoinV2';
  if (!(await prisma.setting.findUnique({ where: { key: v16 } }))) {
    await prisma.botMessageTemplate.update({ where: { key: 'how_to_join' }, data: { text: HOW_TO_JOIN_TEXT } }).catch(() => undefined);
    await prisma.setting.create({ data: { key: v16, value: { at: new Date().toISOString() } } });
  }
  // Разово (31.10): картинка приветствия от владельца (светлая, «Сообщество 30 дней»)
  const v17 = 'maintenance.welcomeImageV3';
  if (!(await prisma.setting.findUnique({ where: { key: v17 } }))) {
    await prisma.botMessageTemplate.update({ where: { key: 'welcome' }, data: { imageUrl: WELCOME_IMAGE } }).catch(() => undefined);
    await prisma.setting.create({ data: { key: v17, value: { at: new Date().toISOString() } } });
  }
  // Разово (02.11): новый текст приветствия от владельца — «ВХОД ЗАКРОЕТСЯ ЧЕРЕЗ 3 ДНЯ ‼️»
  const v21 = 'maintenance.welcomeV5';
  if (!(await prisma.setting.findUnique({ where: { key: v21 } }))) {
    await prisma.botMessageTemplate.update({ where: { key: 'welcome' }, data: { text: WELCOME_TEXT } }).catch(() => undefined);
    await prisma.setting.create({ data: { key: v21, value: { at: new Date().toISOString() } } });
  }
  // Разово (03.11): новые тексты владельца — приветствие, «как вступить», дожим 02–08 (новые 12–14 создаются выше)
  // ключ уникальный: «chainV3» уже был занят 26.10, из-за этого обновление 03.11 пропустилось
  const v22 = 'maintenance.ownerTexts0311';
  if (!(await prisma.setting.findUnique({ where: { key: v22 } }))) {
    await prisma.botMessageTemplate.update({ where: { key: 'welcome' }, data: { text: WELCOME_TEXT } }).catch(() => undefined);
    await prisma.botMessageTemplate.update({ where: { key: 'how_to_join' }, data: { text: HOW_TO_JOIN_TEXT } }).catch(() => undefined);
    for (const t of CHAIN_TEMPLATES.filter((x) => ['chain_02', 'chain_03', 'chain_04', 'chain_05', 'chain_06', 'chain_07', 'chain_08'].includes(x.key))) {
      await prisma.botMessageTemplate.update({ where: { key: t.key }, data: { text: t.text, enabled: true } }).catch(() => undefined);
    }
    await prisma.setting.create({ data: { key: v22, value: { at: new Date().toISOString() } } });
  }
  // Разово (03.11): новая ссылка на видео в приветствии (меняем только ссылку — правки текста в админке сохраняются)
  const v23 = 'maintenance.welcomeVideoV2';
  if (!(await prisma.setting.findUnique({ where: { key: v23 } }))) {
    const w = await prisma.botMessageTemplate.findUnique({ where: { key: 'welcome' } });
    if (w) await prisma.botMessageTemplate.update({ where: { key: 'welcome' }, data: { text: w.text.replaceAll('https://youtu.be/eOpKSb9-jA4', 'https://youtu.be/IqQb4Ld2dlc') } });
    await prisma.setting.create({ data: { key: v23, value: { at: new Date().toISOString() } } });
  }
  // Разово (03.11): после окончания акции — каждые сутки: 08 через 1 день, 12 через 2, 13 через 3, 14 через 4
  const v24 = 'maintenance.afterDailyV1';
  if (!(await prisma.setting.findUnique({ where: { key: v24 } }))) {
    for (const t of CHAIN_TEMPLATES.filter((x) => ['chain_08', 'chain_12', 'chain_13', 'chain_14'].includes(x.key))) {
      await prisma.botMessageTemplate.update({ where: { key: t.key }, data: { delayMinutes: t.delayMinutes, title: t.title } }).catch(() => undefined);
    }
    await prisma.setting.create({ data: { key: v24, value: { at: new Date().toISOString() } } });
  }
  // Разово (07.11): маркетинговые старты в боте — 11.11 и дальше каждые 4 дня: «послезавтра», «завтра + СТАРТ», «сегодня»
  const v25 = 'maintenance.marketingStartsV1';
  if (!(await prisma.setting.findUnique({ where: { key: v25 } }))) {
    for (const t of CHAIN_TEMPLATES.filter((x) => ['chain_10', 'chain_11', 'chain_15'].includes(x.key))) {
      await prisma.botMessageTemplate.update({ where: { key: t.key }, data: { text: t.text, title: t.title, buttons: t.buttons, delayMinutes: t.delayMinutes, enabled: true, approved: true } }).catch(() => undefined);
    }
    await prisma.setting.create({ data: { key: v25, value: { at: new Date().toISOString() } } });
  }
  // Разово (02.11): механика «вернуть скидку» убрана — таймер засекается заново при каждом заходе; сообщение 09 выключено
  const v18 = 'maintenance.noRestoreV1';
  if (!(await prisma.setting.findUnique({ where: { key: v18 } }))) {
    await prisma.botMessageTemplate.updateMany({ where: { key: 'chain_09' }, data: { enabled: false } });
    await prisma.setting.create({ data: { key: v18, value: { at: new Date().toISOString() } } });
  }
  // Разово (02.11): «Ура! Мы нашли тебе бадди!» с ником и кнопкой «Написать бадди»
  const v19 = 'maintenance.buddyMatchedV2';
  if (!(await prisma.setting.findUnique({ where: { key: v19 } }))) {
    const d = DEFAULT_TEMPLATES.find((x) => x.key === 'buddy_matched');
    if (d) await prisma.botMessageTemplate.update({ where: { key: 'buddy_matched' }, data: { text: d.text, buttons: d.buttons as object, approved: true } }).catch(() => undefined);
    await prisma.setting.create({ data: { key: v19, value: { at: new Date().toISOString() } } });
  }
  // Разово (02.11): личные даты старта — без обещаний общего старта; сообщения 10–11 («до старта потока») выключены
  const v20 = 'maintenance.personalStartV1';
  if (!(await prisma.setting.findUnique({ where: { key: v20 } }))) {
    await prisma.botMessageTemplate.update({ where: { key: 'welcome' }, data: { text: WELCOME_TEXT } }).catch(() => undefined);
    for (const k of ['reg_goals', 'flow_start_soon', 'flow_finished']) {
      const d = DEFAULT_TEMPLATES.find((x) => x.key === k);
      if (d) await prisma.botMessageTemplate.update({ where: { key: k }, data: { text: d.text } }).catch(() => undefined);
    }
    // (07.11) 10–11 больше не выключаем: они снова идут к маркетинговым стартам каждые 4 дня
    await prisma.setting.create({ data: { key: v20, value: { at: new Date().toISOString() } } });
  }
  // Разово при переходе на новую цепочку: приветствие владельца, старые предложенные дожимы выключаем
  const marker = 'maintenance.chainV1';
  if (!(await prisma.setting.findUnique({ where: { key: marker } }))) {
    await prisma.botMessageTemplate.update({ where: { key: 'welcome' }, data: { text: WELCOME_TEXT, buttons: WELCOME_BUTTONS, title: 'Цепочка 01. /start — приветствие (один раз)', approved: true } });
    await prisma.botMessageTemplate.updateMany({ where: { key: { in: ['abandoned_purchase', 'nudge_not_reached_tariffs', 'nudge_tariffs_no_select', 'nudge_selected_no_payment', 'offer_ending_60', 'offer_ending_15', 'offer_expired'] } }, data: { enabled: false } });
    await prisma.setting.create({ data: { key: marker, value: { at: new Date().toISOString() } } });
  }
}

const MARKETING_DAILY_CAP = 2;

const escHtml = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** Шаблоны — в HTML-разметке Telegram (<b>, <i>); подставляемые значения экранируются */
function render(text: string, vars: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] === undefined ? '' : escHtml(String(vars[k]))));
}

export function imageUrlOf(url: string | null | undefined) {
  return url ? url.replace('{public_url}', config.PUBLIC_URL.replace(/\/$/, '')) : null;
}

/**
 * Отправка шаблона с защитами: включён ли шаблон, разрешено ли писать, согласие на рекламу,
 * лимит частоты на шаблон и общий лимит рекламы в сутки, дедупликация по ключу.
 * Каждая отправка пишется в журнал; клики по кнопкам отслеживаются через startapp=m_<logId>_<screen>.
 */
export async function sendTemplate(userId: bigint, key: string, vars: Record<string, string | number>, dedupeKey: string): Promise<'sent' | 'skipped' | 'failed'> {
  const tpl = await prisma.botMessageTemplate.findUnique({ where: { key } });
  if (!tpl || !tpl.enabled) return 'skipped';
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt || user.botBlocked || !user.allowsWrite) return 'skipped';
  if (tpl.isMarketing && !user.marketingOptIn) return 'skipped';
  const now = clock.now();
  if (tpl.capHours > 0) {
    const recent = await prisma.botMessageLog.findFirst({ where: { userId, templateKey: key, status: 'sent', sentAt: { gt: new Date(now.getTime() - tpl.capHours * 3600_000) } } });
    if (recent) return 'skipped';
  }
  // Цепочка до оплаты сама ограничивает частоту (расписание владельца) — общий суточный лимит к ней не применяется
  if (tpl.isMarketing && !key.startsWith('chain_')) {
    const marketingKeys = (await prisma.botMessageTemplate.findMany({ where: { isMarketing: true, key: { not: { startsWith: 'chain_' } } }, select: { key: true } })).map((t) => t.key);
    const sentToday = await prisma.botMessageLog.count({ where: { userId, templateKey: { in: marketingKeys }, status: 'sent', sentAt: { gt: new Date(now.getTime() - 24 * 3600_000) } } });
    if (sentToday >= MARKETING_DAILY_CAP) return 'skipped';
  }
  const id = randomUUID();
  try {
    await prisma.botMessageLog.create({ data: { id, userId, templateKey: key, dedupeKey, status: 'pending', sentAt: now } });
  } catch (e) {
    if (isUniqueViolation(e)) return 'skipped';
    throw e;
  }
  const short = id.replace(/-/g, '');
  vars = { ...(await linkVars()), ...vars };
  // Кнопка-ссылка ({ text, url }) — например, личное приглашение в чат; без адреса не показывается
  const buttons = (tpl.buttons as { text: string; screen?: string; url?: string; callback?: string }[])
    .map((b) => {
      if (b.callback) return { text: b.text, callback_data: b.callback };
      if (b.url === undefined) return openAppButton(b.text, `m_${short}_${b.screen}`);
      const url = b.url.replace(/\{(\w+)\}/g, (_m, k: string) => (vars[k] === undefined ? '' : String(vars[k])));
      return /^https?:\/\//.test(url) ? { text: b.text, url } : null;
    })
    .filter(Boolean)
    .map((b) => [b]);
  // Пустая переменная не оставляет лишних пустых строк
  let text = render(tpl.text, vars).replace(/\n{3,}/g, '\n\n').trim();
  try {
    const markup = buttons.length ? { inline_keyboard: buttons } : undefined;
    const image = imageUrlOf(tpl.imageUrl);
    if (image && text.length <= 1024) await tg('sendPhoto', { chat_id: Number(userId), photo: image, caption: text, parse_mode: 'HTML', reply_markup: markup });
    else {
      if (image) await tg('sendPhoto', { chat_id: Number(userId), photo: image });
      await tg('sendMessage', { chat_id: Number(userId), text, parse_mode: 'HTML', reply_markup: markup });
    }
    await prisma.botMessageLog.update({ where: { id }, data: { status: 'sent' } });
    await track({ userId, eventName: 'bot_message_sent', metadata: { template: key, logId: id } });
    return 'sent';
  } catch (e) {
    const err = e as TelegramError;
    await prisma.botMessageLog.update({ where: { id }, data: { status: 'failed', error: err.message?.slice(0, 300) } });
    if (err.code === 403) await prisma.user.update({ where: { id: userId }, data: { botBlocked: true } });
    await track({ userId, eventName: 'bot_message_failed', metadata: { template: key, code: err.code } });
    return 'failed';
  }
}

setNotifier(sendTemplate);

/** Mini App открыт по кнопке из бота: фиксируем клик */
export async function registerBotClick(userId: bigint, startParam: string) {
  const m = /^m_([0-9a-f]{32})_/.exec(startParam);
  if (!m) return;
  const hex = m[1];
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const log = await prisma.botMessageLog.findUnique({ where: { id } });
  if (!log || log.userId !== userId || log.clickedAt) return;
  await prisma.botMessageLog.update({ where: { id }, data: { clickedAt: clock.now() } });
  await track({ userId, eventName: 'bot_message_click', metadata: { template: log.templateKey, logId: id }, dedupeKey: `bot_click:${id}` });
}

/** Конверсия после клика: оплата в течение 72 часов после клика по сообщению */
export async function registerBotConversion(userId: bigint) {
  const since = new Date(clock.now().getTime() - 72 * 3600_000);
  const logs = await prisma.botMessageLog.findMany({ where: { userId, clickedAt: { gt: since }, convertedAt: null } });
  for (const log of logs) {
    await prisma.botMessageLog.update({ where: { id: log.id }, data: { convertedAt: clock.now() } });
    await track({ userId, eventName: 'bot_conversion_after_click', metadata: { template: log.templateKey, logId: log.id }, dedupeKey: `bot_conv:${log.id}` });
  }
}

// ───────────── Входящие обновления ─────────────

interface TgUpdate {
  message?: { message_id: number; chat: { id: number; type: string; title?: string }; from?: { id: number; first_name?: string; username?: string }; text?: string };
  chat_join_request?: { chat: { id: number; title?: string }; from: { id: number; first_name?: string }; invite_link?: { invite_link: string; name?: string; creator?: { id: number; is_bot?: boolean } } };
  my_chat_member?: { chat: { id: number; type: string; title?: string }; new_chat_member: { status: string } };
  chat_member?: { chat: { id: number }; new_chat_member: { user: { id: number }; status: string } };
  callback_query?: { id: string; from: { id: number }; data?: string; message?: { chat: { id: number } } };
}

/** Ссылки для кнопок: поддержка и лендинг (частые вопросы) */
async function linkVars() {
  const { getSetting } = await import('../settings');
  return { support_url: `https://t.me/${await getSetting('support.username')}`, faq_url: await getSetting('landing.url') };
}

/** Правила клуба PDF — отправляется через секунду после приветствия; file_id кэшируем, чтобы не загружать файл каждый раз */
const RULES_PDF = 'pravila-kluba.pdf';
let rulesFileId: string | null = null;
export async function sendRulesPdf(chatId: number) {
  try {
    if (rulesFileId) {
      await tg('sendDocument', { chat_id: chatId, document: rulesFileId });
      return;
    }
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const { config } = await import('../config');
    const dir = config.STATIC_MINIAPP_DIR || path.resolve(process.cwd(), '../miniapp/dist');
    const file = await readFile(path.join(dir, 'docs', RULES_PDF));
    const r = await tg<{ document?: { file_id: string } }>('sendDocument', { chat_id: chatId, document: { file: file, filename: 'Правила клуба 90 дней.pdf', contentType: 'application/pdf' } });
    rulesFileId = r?.document?.file_id ?? null;
  } catch (e) {
    console.error('[bot] rules pdf', (e as Error).message);
  }
}

/** Кнопки шаблона для /start: экран приложения (с реферальным параметром), ссылка или следующее сообщение */
function welcomeMarkup(raw: unknown, vars: Record<string, string>, startParam?: string) {
  const list = (raw as { text: string; screen?: string; url?: string; callback?: string }[] | undefined) ?? WELCOME_BUTTONS;
  const rows = list
    .map((b) => {
      if (b.callback) return { text: b.text, callback_data: b.callback };
      if (b.url === undefined) return openAppButton(b.text, startParam);
      const url = b.url.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');
      return /^https?:\/\//.test(url) ? { text: b.text, url } : null;
    })
    .filter(Boolean)
    .map((b) => [b]);
  return { inline_keyboard: rows };
}

export async function handleUpdate(update: TgUpdate) {
  if (update.callback_query) {
    const q = update.callback_query;
    await tg('answerCallbackQuery', { callback_query_id: q.id }).catch(() => undefined);
    if (q.data === 'cancel_sub' || q.data === 'cancel_keep') {
      await handleCancelChoice(BigInt(q.from.id), q.data === 'cancel_sub', q.message?.chat.id ?? q.from.id);
      return;
    }
    // «Принять / Отклонить» предложение стать бадди
    const bp = /^bp:(a|d):([0-9a-f-]{36})$/.exec(q.data ?? '');
    if (bp) {
      const chatId = q.message?.chat.id ?? q.from.id;
      try {
        const { respondProposal } = await import('./buddy');
        const r = await respondProposal(BigInt(q.from.id), bp[2], bp[1] === 'a');
        if (!r.accepted) await tg('sendMessage', { chat_id: chatId, text: 'Хорошо, предложение отклонено 💜' });
      } catch (e) {
        await tg('sendMessage', { chat_id: chatId, text: (e as Error).message || 'Предложение уже неактуально' }).catch(() => undefined);
      }
      return;
    }
    if (q.data === 'how_to_join') {
      const userId = BigInt(q.from.id);
      await track({ userId, eventName: 'bot_how_to_join_click', dedupeKey: `how_to_join:${userId}` });
      // клик по кнопке приветствия — в статистику сообщений
      const w = await prisma.botMessageLog.findFirst({ where: { userId, templateKey: 'welcome', status: 'sent' }, orderBy: { sentAt: 'desc' } });
      if (w && !w.clickedAt) await prisma.botMessageLog.update({ where: { id: w.id }, data: { clickedAt: clock.now() } });
      await sendTemplate(userId, 'how_to_join', {}, `how_to_join:${userId}:${clock.now().getTime()}`);
    }
    return;
  }
  if (update.chat_join_request) {
    const { onJoinRequest } = await import('./chats');
    return onJoinRequest(update.chat_join_request.chat.id, update.chat_join_request.from.id, update.chat_join_request.invite_link);
  }
  if (update.chat_member) {
    const { onChatMemberUpdate } = await import('./chats');
    return onChatMemberUpdate(update.chat_member.chat.id, update.chat_member.new_chat_member.user.id, update.chat_member.new_chat_member.status);
  }
  if (update.my_chat_member) {
    // Бота добавили в группу или канал — запоминаем, чтобы админ привязал в «Чатах» (бот не создаёт их сам)
    const c = update.my_chat_member.chat;
    if (c.type === 'group' || c.type === 'supergroup' || c.type === 'channel') {
      const active = ['administrator', 'member'].includes(update.my_chat_member.new_chat_member.status);
      await prisma.telegramChat.upsert({
        where: { telegramChatId: BigInt(c.id) },
        create: { kind: 'pending', title: c.title ?? `${c.type === 'channel' ? 'Канал' : 'Группа'} ${c.id}`, telegramChatId: BigInt(c.id), active: false },
        update: { title: c.title ?? undefined, ...(active ? {} : { active: false }) },
      });
    }
    return;
  }
  const msg = update.message;
  if (!msg?.text || !msg.from) return;
  // В группе: /bind (или любое сообщение, которое видит бот-админ) регистрирует группу для привязки в админке
  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    const chatId = BigInt(msg.chat.id);
    const existing = await prisma.telegramChat.findUnique({ where: { telegramChatId: chatId } });
    if (!existing) await prisma.telegramChat.create({ data: { kind: 'pending', title: msg.chat.title ?? `Группа ${msg.chat.id}`, telegramChatId: chatId, active: false } });
    else if (msg.chat.title && existing.title !== msg.chat.title) await prisma.telegramChat.update({ where: { id: existing.id }, data: { title: msg.chat.title } });
    if (msg.text.startsWith('/bind')) {
      await tg('sendMessage', { chat_id: msg.chat.id, text: existing?.active ? 'Группа уже подключена к «30 дням» ✅' : 'Группа найдена ✅ Теперь привяжите её в админке: раздел «Чаты» → «Привязать».' }).catch(() => undefined);
    }
    return;
  }
  if (msg.chat.type !== 'private') return;
  const userId = BigInt(msg.from.id);
  const [cmd, payload] = msg.text.trim().split(/\s+/, 2);
  if (cmd === '/start') {
    // Проверка дожимной цепочки владельцем (CHAIN_TEST): сброс покупки, приветствие, затем 02–11 каждые 3 с
    const { isChainTestUser, resetAsNonBuyer, runChainTest } = await import('./chainTest');
    const testing = await isChainTestUser(userId);
    if (testing && (await prisma.user.findUnique({ where: { id: userId } }))) await resetAsNonBuyer(userId);
    const existed = await prisma.user.findUnique({ where: { id: userId } });
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, firstName: msg.from.first_name ?? 'Участник', username: msg.from.username, allowsWrite: true, marketingOptIn: true, createdAt: clock.now() },
      update: { allowsWrite: true, botBlocked: false },
    });
    // Напоминания включены по умолчанию, пока человек сам не отписался командой /stop
    const unsubscribed = await prisma.consent.findFirst({ where: { userId, kind: 'marketing_messages', revokedAt: { not: null } } });
    if (existed && !existed.marketingOptIn && !unsubscribed) await prisma.user.update({ where: { id: userId }, data: { marketingOptIn: true } });
    const safe = payload && payload !== 'hello' && /^[A-Za-z0-9_-]{1,64}$/.test(payload) ? payload : undefined;
    // Первый вход в воронку через бота (повторные /start не считаются); источник — параметр ссылки t.me/…?start=
    if (!existed) await track({ userId, eventName: 'bot_start', metadata: { source: safe ?? (payload === 'hello' ? 'hello' : null) }, dedupeKey: `bot_start:${userId}` });
    // Ссылка для отмены подписки от поддержки: t.me/<бот>?start=cancel — человек сам отключает автопродление
    if (payload === 'cancel') {
      await cancelStart(userId, msg.chat.id);
      return;
    }
    // Реферальная ссылка на бота (?start=ref_…): визит засчитываем сразу — в приложение человек попадёт позже, из второго сообщения
    if (safe?.startsWith('ref_')) {
      const { handleStartParam } = await import('./entry');
      const u = await prisma.user.findUnique({ where: { id: userId } });
      if (u) await handleStartParam(u, safe);
    }
    const tpl = await prisma.botMessageTemplate.findUnique({ where: { key: 'welcome' } });
    // Сообщение 1 — на каждый /start, как в прежнем боте; запись в журнале — только первая (для аналитики)
    await prisma.botMessageLog.create({ data: { userId, templateKey: 'welcome', dedupeKey: `welcome:${userId}`, status: 'sent', sentAt: clock.now() } }).catch((e) => {
      if (!isUniqueViolation(e)) throw e;
    });
    const image = imageUrlOf(tpl?.imageUrl);
    const markup = welcomeMarkup(tpl?.buttons, await linkVars(), safe);
    const text = tpl?.text ?? WELCOME_TEXT;
    if (image && text.length <= 1024) await tg('sendPhoto', { chat_id: msg.chat.id, photo: image, caption: text, parse_mode: 'HTML', reply_markup: markup });
    else {
      if (image) await tg('sendPhoto', { chat_id: msg.chat.id, photo: image });
      await tg('sendMessage', { chat_id: msg.chat.id, text, parse_mode: 'HTML', reply_markup: markup, link_preview_options: { is_disabled: true } });
    }
    // Правила клуба файлом — через секунду после приветствия
    const chatId = msg.chat.id;
    setTimeout(() => void sendRulesPdf(chatId), 1000);
    if (testing) runChainTest(userId);
    return;
  }
  if (cmd === '/stop') {
    await prisma.user.updateMany({ where: { id: userId }, data: { marketingOptIn: false } });
    await prisma.consent.updateMany({ where: { userId, kind: 'marketing_messages', revokedAt: null }, data: { revokedAt: clock.now() } });
    await tg('sendMessage', { chat_id: msg.chat.id, text: 'Готово: напоминания с предложениями больше не придут. Служебные сообщения (оплата, отчёты, созвоны) останутся.' });
    return;
  }
  if (cmd === '/help' || cmd === '/support') {
    const { getSetting } = await import('../settings');
    await tg('sendMessage', { chat_id: msg.chat.id, text: `Поддержка: @${await getSetting('support.username')}` });
  }
}

export type { BotMessageTemplate };

/** Отмена автопродления по ссылке t.me/<бот>?start=cancel: подписка и кнопка подтверждения */
async function cancelStart(userId: bigint, chatId: number) {
  const { subscriptionSummary } = await import('./billing');
  const { humanDate } = await import('@thirty/domain');
  const s = (await subscriptionSummary(userId)).subscription;
  if (!s || s.status === 'expired') {
    await tg('sendMessage', { chat_id: chatId, text: 'У тебя сейчас нет активной подписки — списаний не будет 💜' });
    return;
  }
  if (!s.autoRenew) {
    await tg('sendMessage', { chat_id: chatId, text: `Автопродление уже отключено ✅\n\nНовых списаний не будет, доступ сохранится до ${humanDate(s.paidUntil, true)}.` });
    return;
  }
  const next = s.nextCharge ? `\nСледующее списание: <b>${humanDate(s.nextCharge.date, true)} · ${s.nextCharge.amount} ₽</b>` : '';
  await tg('sendMessage', {
    chat_id: chatId,
    parse_mode: 'HTML',
    text: `<b>Отмена автопродления</b>\n\nТвой тариф: ${escHtml(s.tariffTitle)}${next}\n\nПосле отмены новых списаний не будет, а доступ к сообществу сохранится до <b>${humanDate(s.paidUntil, true)}</b>.`,
    reply_markup: { inline_keyboard: [[{ text: 'Отменить автопродление', callback_data: 'cancel_sub' }], [{ text: 'Я остаюсь 💜', callback_data: 'cancel_keep' }]] },
  });
}

async function handleCancelChoice(userId: bigint, confirm: boolean, chatId: number) {
  if (!confirm) {
    await tg('sendMessage', { chat_id: chatId, text: 'Ура, остаёмся вместе! 💜' });
    return;
  }
  const { cancelAutoRenew } = await import('./billing');
  const { humanDate } = await import('@thirty/domain');
  try {
    const r = await cancelAutoRenew(userId, 'self: ссылка отмены от поддержки');
    // при отмене бот сам присылает «Автопродление отключено…» (шаблон cancel_confirmed); уже отменённым — отвечаем здесь
    if ('alreadyCanceled' in r) await tg('sendMessage', { chat_id: chatId, text: `Автопродление уже отключено ✅ Доступ сохранится до ${humanDate(r.paidUntil, true)}.` });
    else {
      const u = await prisma.user.findUnique({ where: { id: userId } });
      const { notifyAdmins, escAdmin } = await import('./adminBot');
      await notifyAdmins(`❌ <b>Отмена автопродления по ссылке</b>\n${escAdmin(u ? (await import('./users')).displayName(u) : String(userId))}${u?.username ? ` (@${escAdmin(u.username)})` : ''}\nДоступ до ${humanDate(r.paidUntil, true)}`).catch(() => undefined);
    }
  } catch {
    await tg('sendMessage', { chat_id: chatId, text: 'У тебя сейчас нет активной подписки — списаний не будет 💜' });
  }
}

/** Предложение стать бадди: сообщение с кнопками «Принять» / «Отклонить» прямо в боте */
export async function sendBuddyProposal(targetId: bigint, proposalId: string, from: { name: string; username: string | null }) {
  const u = await prisma.user.findUnique({ where: { id: targetId } });
  if (!u || u.botBlocked || !u.allowsWrite || u.deletedAt) return;
  const who = from.username ? `@${from.username}` : escHtml(from.name);
  await tg('sendMessage', {
    chat_id: Number(targetId),
    parse_mode: 'HTML',
    text: `<b>${who} предлагает тебе стать бадди 💜</b>\n\nБадди — напарник, с которым вы поддерживаете друг друга и вместе идёте к своим целям.`,
    reply_markup: { inline_keyboard: [[{ text: 'Принять', callback_data: `bp:a:${proposalId}` }, { text: 'Отклонить', callback_data: `bp:d:${proposalId}` }]] },
  }).catch((e) => console.warn('[bot] buddy proposal', (e as Error).message));
}

/** Отказ: отправитель узнаёт и может выбрать другого или доверить подбор */
export async function sendBuddyDeclined(toUserId: bigint, byName: string) {
  const u = await prisma.user.findUnique({ where: { id: toUserId } });
  if (!u || u.botBlocked || !u.allowsWrite || u.deletedAt) return;
  await tg('sendMessage', {
    chat_id: Number(toUserId),
    text: `${byName} пока не готова стать парой. Выбери другого участника или доверь подбор нам 💜`,
    reply_markup: { inline_keyboard: [[openAppButton('Найти бадди 💜', 'm_00000000000000000000000000000000_buddy')]] },
  }).catch((e) => console.warn('[bot] buddy declined', (e as Error).message));
}
