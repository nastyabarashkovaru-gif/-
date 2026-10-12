import { config } from './config.js';

/** Минимальный клиент Bot API. Токен никогда не логируется. */
export async function tg<T = any>(method: string, body: Record<string, unknown>): Promise<T> {
  if (!config.botToken) throw new Error('BOT_TOKEN не задан');
  const r = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json().catch(() => ({}))) as any;
  if (!j.ok) {
    const e = new Error(`Telegram ${method}: ${j.description || r.status}`) as Error & { code?: number };
    e.code = j.error_code;
    throw e;
  }
  return j.result as T;
}
