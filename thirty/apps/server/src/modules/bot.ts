import { randomUUID } from 'node:crypto';
import type { BotMessageTemplate } from '@prisma/client';
import { clock } from '../clock';
import { prisma, isUniqueViolation } from '../db';
import { openAppButton, tg, TelegramError } from '../lib/telegram';
import { CHAIN_TEMPLATES, DEFAULT_TEMPLATES, WELCOME_BUTTON, WELCOME_IMAGE, WELCOME_TEXT } from './templates';
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
  // Разово при переходе на новую цепочку: приветствие владельца, старые предложенные дожимы выключаем
  const marker = 'maintenance.chainV1';
  if (!(await prisma.setting.findUnique({ where: { key: marker } }))) {
    await prisma.botMessageTemplate.update({ where: { key: 'welcome' }, data: { text: WELCOME_TEXT, buttons: [{ text: WELCOME_BUTTON, screen: 'welcome' }], title: 'Цепочка 01. /start — приветствие (один раз)', approved: true } });
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
  // Кнопка-ссылка ({ text, url }) — например, личное приглашение в чат; без адреса не показывается
  const buttons = (tpl.buttons as { text: string; screen?: string; url?: string }[])
    .map((b) => {
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
  chat_join_request?: { chat: { id: number; title?: string }; from: { id: number; first_name?: string }; invite_link?: { invite_link: string; name?: string } };
  my_chat_member?: { chat: { id: number; type: string; title?: string }; new_chat_member: { status: string } };
  chat_member?: { chat: { id: number }; new_chat_member: { user: { id: number }; status: string } };
}

export async function handleUpdate(update: TgUpdate) {
  if (update.chat_join_request) {
    const { onJoinRequest } = await import('./chats');
    return onJoinRequest(update.chat_join_request.chat.id, update.chat_join_request.from.id);
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
    const tpl = await prisma.botMessageTemplate.findUnique({ where: { key: 'welcome' } });
    const button = (tpl?.buttons as { text: string }[] | undefined)?.[0]?.text ?? WELCOME_BUTTON;
    // Сообщение 1 — один раз; при повторном /start только кнопка входа. Ссылка ?start=hello всегда показывает приветствие
    let first = payload === 'hello';
    try {
      await prisma.botMessageLog.create({ data: { userId, templateKey: 'welcome', dedupeKey: `welcome:${userId}`, status: 'sent', sentAt: clock.now() } });
      first = true;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
    const markup = { inline_keyboard: [[openAppButton(button, safe)]] };
    const image = imageUrlOf(tpl?.imageUrl);
    if (first && image) await tg('sendPhoto', { chat_id: msg.chat.id, photo: image, caption: tpl?.text ?? WELCOME_TEXT, parse_mode: 'HTML', reply_markup: markup });
    else await tg('sendMessage', { chat_id: msg.chat.id, text: first ? tpl?.text ?? WELCOME_TEXT : 'Жми кнопку ниже, чтобы открыть приложение 👇', parse_mode: 'HTML', reply_markup: markup });
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
