export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function csrf() {
  return document.cookie.split('; ').find((c) => c.startsWith('thirty_csrf='))?.split('=')[1] ?? '';
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRF-Token': csrf() } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'error', data?.message ?? `Ошибка ${res.status}`);
  return data as T;
}

export const rub = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('ru-RU')} ₽`);
export const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : '—');
export const d = (s: string | null | undefined) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '—');
