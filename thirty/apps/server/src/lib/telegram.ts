import { createHash } from 'node:crypto';
import { config } from '../config';

export class TelegramError extends Error {
  constructor(public method: string, public code: number, public description: string, public retryAfter?: number, public migrateTo?: number) {
    super(`${method}: ${code} ${description}`);
  }
}

export type TgCall = <T = unknown>(method: string, body: Record<string, unknown>) => Promise<T>;

async function rawCall<T>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!config.BOT_TOKEN) throw new TelegramError(method, 0, 'BOT_TOKEN not set');
  // Поле вида { file: Buffer, filename } — загрузка файла (multipart), остальное — обычный JSON
  const upload = Object.entries(body).find(([, v]) => v && typeof v === 'object' && Buffer.isBuffer((v as { file?: unknown }).file));
  let init: RequestInit;
  if (upload) {
    const form = new FormData();
    for (const [k, v] of Object.entries(body)) {
      if (k === upload[0]) {
        const f = v as { file: Buffer; filename: string; contentType?: string };
        form.append(k, new Blob([f.file], { type: f.contentType ?? 'application/octet-stream' }), f.filename);
      } else if (v !== undefined) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    init = { method: 'POST', body: form, signal: AbortSignal.timeout(60_000) };
  } else {
    init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) };
  }
  const res = await fetch(`https://api.telegram.org/bot${config.BOT_TOKEN}/${method}`, init);
  const data = (await res.json()) as { ok: boolean; result: T; error_code?: number; description?: string; parameters?: { retry_after?: number; migrate_to_chat_id?: number } };
  if (!data.ok) throw new TelegramError(method, data.error_code ?? res.status, data.description ?? '', data.parameters?.retry_after, data.parameters?.migrate_to_chat_id);
  return data.result;
}

/**
 * Очередь отправки: не больше ~25 запросов в секунду всего (лимит Telegram ~30/с),
 * при 429 ждём retry_after и повторяем один раз.
 */
const MIN_GAP_MS = 40;
let last = 0;
let chain: Promise<unknown> = Promise.resolve();

let impl: TgCall = async <T>(method: string, body: Record<string, unknown>): Promise<T> => {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, last + MIN_GAP_MS - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      return await rawCall<T>(method, body);
    } catch (e) {
      if (e instanceof TelegramError && e.code === 429 && e.retryAfter && e.retryAfter <= 30) {
        await new Promise((r) => setTimeout(r, e.retryAfter! * 1000));
        return rawCall<T>(method, body);
      }
      throw e;
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
};

export const tg: TgCall = async <T>(method: string, body: Record<string, unknown>): Promise<T> => {
  try {
    return await impl<T>(method, body);
  } catch (e) {
    // Группу перевели в супергруппу — у неё новый номер: запоминаем его и повторяем запрос (09.11)
    if (e instanceof TelegramError && e.migrateTo && body.chat_id !== undefined) {
      await chatMigrated(Number(body.chat_id), e.migrateTo);
      return impl<T>(method, { ...body, chat_id: e.migrateTo });
    }
    throw e;
  }
};

/** Группа стала супергруппой: в привязанных чатах меняем старый номер на новый */
export async function chatMigrated(oldId: number, newId: number) {
  const { prisma } = await import('../db');
  const r = await prisma.telegramChat.updateMany({ where: { telegramChatId: BigInt(oldId) }, data: { telegramChatId: BigInt(newId) } }).catch((err) => {
    console.warn('[telegram] chat migrate', (err as Error).message);
    return { count: 0 };
  });
  if (r.count) console.log(`[telegram] чат ${oldId} стал супергруппой ${newId} — номер обновлён`);
}

/** При запуске: проверяем привязанные группы со старыми номерами — Telegram сообщит новый номер */
export async function fixMigratedChats() {
  const { prisma } = await import('../db');
  const chats = await prisma.telegramChat.findMany({ where: { active: true, telegramChatId: { not: null } } });
  for (const c of chats) {
    const id = Number(c.telegramChatId);
    if (String(id).startsWith('-100')) continue;
    await tg('getChat', { chat_id: id }).catch((e) => console.warn(`[telegram] getChat ${c.title}: ${(e as Error).message}`));
  }
}

/** Для тестов: подмена транспорта */
export function setTelegramTransport(fn: TgCall) {
  impl = fn;
}

/** Секрет webhook выводится из токена */
export const webhookSecret = createHash('sha256').update(`thirty-webhook:${config.BOT_TOKEN}`).digest('hex').slice(0, 48);

export function appLink(startParam?: string) {
  const base = `https://t.me/${config.BOT_USERNAME || 'bot'}/${config.APP_SHORT_NAME}`;
  return startParam ? `${base}?startapp=${encodeURIComponent(startParam)}` : base;
}

/** Кнопка открытия Mini App: в личке — web_app (с параметром через URL), иначе ссылка t.me */
export function openAppButton(text: string, startParam?: string) {
  if (config.PUBLIC_URL) {
    const url = startParam ? `${config.PUBLIC_URL}/?startapp=${encodeURIComponent(startParam)}` : `${config.PUBLIC_URL}/`;
    return { text, web_app: { url } };
  }
  return { text, url: appLink(startParam) };
}
