import { createHash } from 'node:crypto';
import { config } from '../config';
import { prisma } from '../db';
import { decideStoryRequest } from './stories';
import { displayName } from './users';

/**
 * Служебный бот владельца (отдельный токен ADMIN_BOT_TOKEN): присылает заявки «Вернуть скидку»
 * с кнопками «Выслать промокод» / «Отклонить». Подписаться может только тот, у кого есть секретная ссылка.
 */

type Call = <T = unknown>(method: string, body: Record<string, unknown>) => Promise<T>;

let call: Call = async <T>(method: string, body: Record<string, unknown>): Promise<T> => {
  if (!config.ADMIN_BOT_TOKEN) throw new Error('ADMIN_BOT_TOKEN not set');
  const res = await fetch(`https://api.telegram.org/bot${config.ADMIN_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
};

export function setAdminBotTransport(fn: Call) {
  call = fn;
}

const derive = (salt: string) => createHash('sha256').update(`${salt}:${config.ADMIN_BOT_TOKEN}`).digest('hex');
export const adminBotSecret = () => derive('webhook').slice(0, 48);
/** Код в ссылке подписки: https://t.me/<бот>?start=<код> */
export const adminBotLinkCode = () => derive('link').slice(0, 20);

const KEY = 'adminBot.chats';

async function subscribers(): Promise<number[]> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return (row?.value as number[] | undefined) ?? [];
}

async function addSubscriber(chatId: number) {
  const list = await subscribers();
  if (list.includes(chatId)) return;
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: [...list, chatId] }, update: { value: [...list, chatId] } });
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** Новая заявка на проверку сторис → сообщение владельцу с кнопками */
export async function notifyStoryRequest(requestId: string) {
  if (!config.ADMIN_BOT_TOKEN) return;
  const r = await prisma.storyRequest.findUnique({ where: { id: requestId } });
  if (!r) return;
  const u = await prisma.user.findUnique({ where: { id: r.userId } });
  const text = [
    '📸 <b>Новая сторис на проверку</b>',
    '',
    `Участник: ${esc(u ? displayName(u) : String(r.userId))}${u?.username ? ` (@${esc(u.username)})` : ''}`,
    `Instagram: <a href="https://instagram.com/${esc(r.instagram)}">@${esc(r.instagram)}</a>`,
    '',
    'Проверь, что сторис с карточкой опубликована и твой аккаунт отмечен.',
  ].join('\n');
  for (const chatId of await subscribers()) {
    await call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: '✅ Выслать промокод', callback_data: `sa:${r.id}` }], [{ text: '❌ Отклонить', callback_data: `sr:${r.id}` }]] },
    }).catch((e) => console.error('[admin-bot]', (e as Error).message));
  }
}

interface Update {
  message?: { chat: { id: number; type: string }; text?: string };
  callback_query?: { id: string; from: { id: number; username?: string }; data?: string; message?: { chat: { id: number }; message_id: number; text?: string } };
}

export async function handleAdminUpdate(u: Update) {
  if (u.message?.text && u.message.chat.type === 'private') {
    const [cmd, code] = u.message.text.trim().split(/\s+/, 2);
    if (cmd === '/start' && code === adminBotLinkCode()) {
      await addSubscriber(u.message.chat.id);
      await call('sendMessage', { chat_id: u.message.chat.id, text: 'Готово ✅ Сюда будут приходить заявки на проверку сторис. Нажимай «Выслать промокод» — человек сразу получит его в боте «30 дней».' });
    } else if (cmd === '/start') {
      await call('sendMessage', { chat_id: u.message.chat.id, text: 'Это служебный бот «30 дней».' });
    }
    return;
  }
  const q = u.callback_query;
  if (!q?.data || !q.message) return;
  if (!(await subscribers()).includes(q.message.chat.id)) {
    await call('answerCallbackQuery', { callback_query_id: q.id, text: 'Нет доступа' });
    return;
  }
  const m = /^(sa|sr):([0-9a-f-]{36})$/.exec(q.data);
  if (!m) return;
  const who = q.from.username ? `tg:@${q.from.username}` : `tg:${q.from.id}`;
  let result: string;
  try {
    if (m[1] === 'sa') {
      const r = await decideStoryRequest(m[2], 'approve', who);
      result = `✅ Промокод ${r.code} отправлен участнику`;
    } else {
      await decideStoryRequest(m[2], 'reject', who, 'мы не нашли сторис с карточкой и отметкой аккаунта');
      result = '❌ Заявка отклонена, участник получил сообщение';
    }
  } catch (e) {
    result = `Уже обработано: ${(e as Error).message}`;
  }
  await call('answerCallbackQuery', { callback_query_id: q.id, text: result.slice(0, 190) });
  await call('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: `${q.message.text ?? ''}\n\n${result}`, disable_web_page_preview: true }).catch(() => undefined);
}

export async function setupAdminBot() {
  if (!config.ADMIN_BOT_TOKEN || !config.PUBLIC_URL) return;
  try {
    const me = await call<{ username: string }>('getMe', {});
    await call('setWebhook', { url: `${config.PUBLIC_URL}/api/telegram/admin-webhook`, secret_token: adminBotSecret(), allowed_updates: ['message', 'callback_query'] });
    console.log(`[admin-bot] @${me.username} готов. Ссылка подписки: https://t.me/${me.username}?start=${adminBotLinkCode()}`);
  } catch (e) {
    console.error('[admin-bot] настройка не удалась:', (e as Error).message);
  }
}
