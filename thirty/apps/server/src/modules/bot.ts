import { randomUUID } from 'node:crypto';
import type { BotMessageTemplate } from '@prisma/client';
import { clock } from '../clock';
import { prisma, isUniqueViolation } from '../db';
import { openAppButton, tg, TelegramError } from '../lib/telegram';
import { DEFAULT_TEMPLATES } from './templates';
import { setNotifier } from './notify';
import { track } from './analytics';

export async function seedTemplates() {
  for (const t of DEFAULT_TEMPLATES) {
    await prisma.botMessageTemplate.upsert({ where: { key: t.key }, create: { ...t, approved: false }, update: {} });
  }
}

const MARKETING_DAILY_CAP = 2;

function render(text: string, vars: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] === undefined ? '' : String(vars[k])));
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
  if (tpl.isMarketing) {
    const marketingKeys = (await prisma.botMessageTemplate.findMany({ where: { isMarketing: true }, select: { key: true } })).map((t) => t.key);
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
  const buttons = (tpl.buttons as { text: string; screen: string }[]).map((b) => [openAppButton(b.text, `m_${short}_${b.screen}`)]);
  let text = render(tpl.text, vars);
  if (tpl.isMarketing) text += '\n\nОтписаться от напоминаний: /stop';
  try {
    await tg('sendMessage', { chat_id: Number(userId), text, reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined });
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
    // Бота добавили в группу — запоминаем её, чтобы админ привязал в A05/A11 (бот не создаёт группы сам)
    const c = update.my_chat_member.chat;
    if (c.type === 'group' || c.type === 'supergroup') {
      const active = ['administrator', 'member'].includes(update.my_chat_member.new_chat_member.status);
      await prisma.telegramChat.upsert({
        where: { telegramChatId: BigInt(c.id) },
        create: { kind: 'pending', title: c.title ?? `Группа ${c.id}`, telegramChatId: BigInt(c.id), active: false },
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
    await prisma.user.upsert({
      where: { id: userId },
      create: { id: userId, firstName: msg.from.first_name ?? 'Участник', username: msg.from.username, allowsWrite: true },
      update: { allowsWrite: true, botBlocked: false },
    });
    const safe = payload && /^[A-Za-z0-9_-]{1,64}$/.test(payload) ? payload : undefined;
    const tpl = await prisma.botMessageTemplate.findUnique({ where: { key: 'welcome' } });
    await tg('sendMessage', {
      chat_id: msg.chat.id,
      text: tpl?.text ?? 'Привет! Это «30 дней».',
      reply_markup: { inline_keyboard: [[openAppButton((tpl?.buttons as { text: string }[] | undefined)?.[0]?.text ?? 'Открыть приложение', safe)]] },
    });
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
