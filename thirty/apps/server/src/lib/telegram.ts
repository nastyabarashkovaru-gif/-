import { createHash } from 'node:crypto';
import { config } from '../config';

export class TelegramError extends Error {
  constructor(public method: string, public code: number, public description: string, public retryAfter?: number) {
    super(`${method}: ${code} ${description}`);
  }
}

export type TgCall = <T = unknown>(method: string, body: Record<string, unknown>) => Promise<T>;

async function rawCall<T>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!config.BOT_TOKEN) throw new TelegramError(method, 0, 'BOT_TOKEN not set');
  const res = await fetch(`https://api.telegram.org/bot${config.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json()) as { ok: boolean; result: T; error_code?: number; description?: string; parameters?: { retry_after?: number } };
  if (!data.ok) throw new TelegramError(method, data.error_code ?? res.status, data.description ?? '', data.parameters?.retry_after);
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

export const tg: TgCall = (method, body) => impl(method, body);

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
