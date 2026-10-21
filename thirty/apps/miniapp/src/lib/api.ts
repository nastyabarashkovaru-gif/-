import { tg, startParam } from './telegram';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const DEV_USER_KEY = 'thirty.devUser';

function devUser(): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    let id = localStorage.getItem(DEV_USER_KEY);
    if (!id) {
      id = String(100000 + Math.floor(Math.random() * 900000));
      localStorage.setItem(DEV_USER_KEY, id);
    }
    return id;
  } catch {
    return '100001';
  }
}

function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  if (tg?.initData) h.Authorization = `tma ${tg.initData}`;
  else {
    const d = devUser();
    if (d) h['X-Dev-User'] = d;
  }
  const sp = startParam();
  if (sp?.startsWith('m_')) h['X-Start-Param'] = sp;
  return h;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  if (!navigator.onLine) throw new ApiError(0, 'offline', 'Нет подключения к интернету');
  let res: Response;
  try {
    res = await fetch(path, { method: opts.method ?? (opts.body ? 'POST' : 'GET'), headers: headers(opts.body !== undefined), body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError(0, 'network', 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'error', data?.message ?? 'Что-то пошло не так', data?.details);
  return data as T;
}

export async function uploadImage(file: File): Promise<{ id: string; url: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/media', { method: 'POST', headers: headers(false), body: fd });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'error', data?.message ?? 'Не удалось загрузить фото');
  return data;
}

export const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
