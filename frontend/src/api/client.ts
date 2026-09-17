import { getInitData } from '../telegram/webapp';

// В проде задаётся переменной окружения VITE_API_BASE (полный адрес backend, например
// https://your-backend.up.railway.app/api). Локально при разработке остаётся относительный
// /api — Vite сам проксирует его на localhost:4000 (см. vite.config.ts).
const API_BASE = import.meta.env.VITE_API_BASE || '/api';

// Для локальной разработки в обычном браузере (вне Telegram) используем dev-заголовки,
// чтобы backend в DEV_MODE=true мог сымитировать вход под тестовым пользователем.
function getDevUserId(): string | null {
  return localStorage.getItem('dev_user_id');
}

export function setDevUserId(id: string) {
  localStorage.setItem('dev_user_id', id);
}

function authHeaders(): Record<string, string> {
  const initData = getInitData();
  if (initData) return { 'X-Telegram-Init-Data': initData };

  const devId = getDevUserId();
  if (devId) return { 'X-Dev-User-Id': devId, 'X-Dev-Username': `tester${devId}`, 'X-Dev-First-Name': `Тестер ${devId}` };

  return {};
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  if (!isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errBody.error || 'request_failed', errBody.message);
  }
  return res.json() as Promise<T>;
}

// Загруженные файлы backend отдаёт по относительному пути (/uploads/xxx.jpg). Если
// frontend и backend развёрнуты на разных доменах, такой путь нужно дополнить доменом backend.
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//.test(url) || /^data:/.test(url)) return url;
  const base = import.meta.env.VITE_API_BASE as string | undefined;
  if (!base) return url;
  try {
    return `${new URL(base).origin}${url}`;
  } catch {
    return url;
  }
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  upload: <T>(path: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<T>('POST', path, form, true);
  },
};

export function adminAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem('admin_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function adminRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...adminAuthHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errBody.error || 'request_failed', errBody.message);
  }
  return res.json() as Promise<T>;
}

export const adminApi = {
  get: <T>(path: string) => adminRequest<T>('GET', path),
  post: <T>(path: string, body?: unknown) => adminRequest<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => adminRequest<T>('PUT', path, body),
};
