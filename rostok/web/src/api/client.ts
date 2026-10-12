import { inTelegram, tg } from '../lib/telegram';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: any = {}) {
    super(message);
  }
}

const TOKEN_KEY = 'rostok.token';
const DEVICE_KEY = 'rostok.device';
let token: string | null = null;
try { token = sessionStorage.getItem(TOKEN_KEY); } catch { /* приватный режим */ }

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'ephemeral' + Math.random().toString(36).slice(2).padEnd(20, '0');
  }
}
export function resetDemoDevice() {
  try { localStorage.removeItem(DEVICE_KEY); sessionStorage.removeItem(TOKEN_KEY); } catch { /* */ }
}

async function raw<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json().catch(() => ({})) : await r.text();
  if (!r.ok) throw new ApiError(r.status, data?.error ?? 'error', data?.message ?? 'Ошибка сети', data);
  return data as T;
}

export async function login(demoAllowed: boolean): Promise<'telegram' | 'demo'> {
  if (inTelegram()) {
    const r = await raw<{ token: string }>('POST', '/auth/telegram', { initData: tg.initData, timezone: tz() });
    setToken(r.token);
    return 'telegram';
  }
  if (!demoAllowed) throw new ApiError(401, 'open_in_telegram', 'Открой приложение в Telegram');
  const r = await raw<{ token: string }>('POST', '/auth/demo', { deviceId: deviceId(), timezone: tz() });
  setToken(r.token);
  return 'demo';
}
function setToken(t: string) {
  token = t;
  try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* */ }
}
export const hasToken = () => !!token;

let reauth: Promise<unknown> | null = null;
let demoAllowedFlag = false;
export const setDemoAllowed = (v: boolean) => { demoAllowedFlag = v; };

export async function api<T = any>(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  try {
    return await raw<T>(method, path, body, headers);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && e.code === 'unauthorized') {
      reauth ??= login(demoAllowedFlag).finally(() => { reauth = null; });
      await reauth;
      return raw<T>(method, path, body, headers);
    }
    throw e;
  }
}

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
  const r = (Math.random() * 16) | 0;
  return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
}));

/** Клиентская аналитика: пачками, с uuid для дедупликации. */
let queue: { id: string; name: string; props?: Record<string, unknown> }[] = [];
let timer: number | null = null;
export function track(name: string, props?: Record<string, unknown>) {
  queue.push({ id: uuid(), name, props });
  if (timer) return;
  timer = window.setTimeout(flush, 800);
}
async function flush() {
  timer = null;
  const batch = queue.splice(0, 20);
  if (!batch.length || !token) return;
  await raw('POST', '/events', { events: batch }).catch(() => {});
  if (queue.length) flush();
}
