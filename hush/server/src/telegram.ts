import { createHash } from 'node:crypto';
import { config } from './config';
import { pool } from './db';

const API = `https://api.telegram.org/bot${config.botToken}`;

/** Секрет webhook выводится из токена — отдельную переменную задавать не нужно */
export const webhookSecret = createHash('sha256').update(`hush-webhook:${config.botToken}`).digest('hex').slice(0, 48);

async function call<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!data.ok) throw new Error(`${method}: ${data.description ?? res.status}`);
  return data.result;
}

export const bot = {
  username: config.botUsername,
};

export function appLink(startParam?: string): string {
  const base = `https://t.me/${bot.username}/${config.appShortName}`;
  return startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : base;
}

function openAppButton(text: string, startParam?: string) {
  // web_app-кнопка открывает Mini App прямо в чате; без публичного URL — обычная ссылка.
  // startParam (например, tab_asks) — сразу нужный раздел
  const url = config.publicUrl && startParam ? `${config.publicUrl}?startapp=${encodeURIComponent(startParam)}` : config.publicUrl;
  return config.publicUrl
    ? { inline_keyboard: [[{ text, web_app: { url } }]] }
    : { inline_keyboard: [[{ text, url: appLink(startParam) }]] };
}

/** Однократная настройка бота при старте сервера */
export async function setupBot(): Promise<void> {
  try {
    const me = await call<{ username: string }>('getMe', {});
    if (!bot.username) bot.username = me.username;
    console.log(`[bot] @${me.username}`);
  } catch (e) {
    console.error('[bot] getMe не удался — проверьте BOT_TOKEN:', (e as Error).message);
    return;
  }
  if (!config.publicUrl) {
    console.warn('[bot] PUBLIC_URL не задан — webhook и кнопка меню не настроены');
    return;
  }
  try {
    await call('setWebhook', {
      url: `${config.publicUrl}/api/telegram/webhook`,
      secret_token: webhookSecret,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    });
    await call('setChatMenuButton', {
      menu_button: { type: 'web_app', text: 'Открыть hush.', web_app: { url: config.publicUrl } },
    });
    console.log(`[bot] webhook и кнопка меню → ${config.publicUrl}`);
  } catch (e) {
    console.error('[bot] не удалось настроить webhook/меню:', (e as Error).message);
  }
}

interface TgUpdate {
  message?: { chat: { id: number; type: string }; from?: { id: number }; text?: string };
}

/** Входящие сообщения боту: на /start отвечаем кнопкой открытия приложения */
export async function handleUpdate(update: TgUpdate): Promise<void> {
  const msg = update.message;
  if (!msg || msg.chat.type !== 'private' || !msg.text?.startsWith('/start')) return;
  // Пользователь сам написал боту — ему можно присылать уведомления
  if (msg.from) await pool.query('UPDATE users SET allows_write = TRUE WHERE id = $1', [msg.from.id]);
  await call('sendMessage', {
    chat_id: msg.chat.id,
    text: 'Узнай, что о тебе думают. И что хотят спросить 🤫\n\nПолучи личную ссылку, собирай анонимные вопросы от подписчиков и отвечай на них в соцсетях.',
    reply_markup: openAppButton('Открыть hush.'),
  });
}

/** Уведомление владельцу: анкету заполнили 5 человек */
export async function notifyThresholdReached(ownerId: number): Promise<void> {
  try {
    await call('sendMessage', {
      chat_id: ownerId,
      text: 'Твои ответы готовы! 💜\n\n5 друзей уже ответили на твою анкету. Открывай и смотри, что о тебе думают 👀',
      reply_markup: openAppButton('Смотреть ответы'),
    });
  } catch (e) {
    // 403 — пользователь не разрешил боту писать; результаты всё равно откроются в приложении
    console.warn(`[bot] уведомление ${ownerId} не отправлено:`, (e as Error).message);
  }
}

/**
 * Пуш в бота на каждый новый вопрос / ответ. Защита от флуда: не больше 30 уведомлений в час одному человеку
 * (отправку вопросов дополнительно ограничивают лимиты в qa.ts).
 */
const recentNotices = new Map<number, number[]>();
export async function notifyUser(userId: number, text: string, button: string, startParam?: string): Promise<void> {
  const now = Date.now();
  const recent = (recentNotices.get(userId) ?? []).filter((t) => now - t < 60 * 60_000);
  if (recent.length >= 30) return;
  recent.push(now);
  recentNotices.set(userId, recent);
  if (recentNotices.size > 50_000) recentNotices.clear();
  try {
    await call('sendMessage', { chat_id: userId, text, reply_markup: openAppButton(button, startParam) });
  } catch (e) {
    console.warn(`[bot] уведомление ${userId} не отправлено:`, (e as Error).message);
  }
}
