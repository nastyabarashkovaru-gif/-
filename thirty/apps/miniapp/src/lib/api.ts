import { tg, startParam } from './telegram';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

const DEV_USER_KEY = 'thirty.devUser';
const DEMO_KEY = 'thirty.demoKey';

/** Ключ демо-версии: приходит один раз в ссылке ?demo=…, дальше хранится в браузере */
export function demoKey(): string | null {
  try {
    const fromUrl = new URLSearchParams(location.search).get('demo');
    if (fromUrl) localStorage.setItem(DEMO_KEY, fromUrl);
    return localStorage.getItem(DEMO_KEY);
  } catch {
    return null;
  }
}

/** Демо: войти от имени другого пользователя (новый человек / владелец) */
export function setDevUser(id: string) {
  try {
    localStorage.setItem(DEV_USER_KEY, id);
  } catch {
    /* без хранилища демо не переключить */
  }
}

function devUser(): string | null {
  if (!import.meta.env.DEV && !demoKey()) return null;
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
    const k = demoKey();
    if (k) h['X-Demo-Key'] = k;
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

/**
 * Фото перед отправкой уменьшаем (19.11): снимок с телефона весит 3–10 МБ и на мобильном интернете
 * загрузка обрывается («Load failed»). До 1600 px по длинной стороне, JPEG — обычно 0,3–0,5 МБ.
 * Не получилось уменьшить — отправляем как есть.
 */
async function shrinkImage(file: File): Promise<Blob> {
  if (file.size < 700 * 1024 || !file.type.startsWith('image/') || file.type === 'image/gif') return file;
  try {
    const MAX = 1600;
    const draw = (src: CanvasImageSource, w: number, h: number) => {
      const k = Math.min(1, MAX / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.round(w * k);
      c.height = Math.round(h * k);
      c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
      return new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.82));
    };
    let blob: Blob | null = null;
    if ('createImageBitmap' in window) {
      const bmp = await createImageBitmap(file);
      blob = await draw(bmp, bmp.width, bmp.height);
      bmp.close();
    } else {
      const url = URL.createObjectURL(file);
      const img = await new Promise<HTMLImageElement>((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = url; });
      blob = await draw(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
    }
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export async function uploadImage(file: File): Promise<{ id: string; url: string }> {
  if (!navigator.onLine) throw new ApiError(0, 'offline', 'Нет подключения к интернету');
  const body = await shrinkImage(file);
  const send = async () => {
    const fd = new FormData();
    fd.append('file', body, body === file ? file.name : file.name.replace(/\.[^.]+$/, '') + '.jpg');
    return fetch('/api/media', { method: 'POST', headers: headers(false), body: fd });
  };
  let res: Response;
  try {
    res = await send();
  } catch {
    // связь оборвалась на середине — одна повторная попытка
    try {
      res = await send();
    } catch {
      throw new ApiError(0, 'network', 'Не получилось загрузить фото — связь оборвалась. Проверь интернет и попробуй ещё раз.');
    }
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.code ?? 'error', data?.message ?? 'Не удалось загрузить фото');
  return data;
}

export const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
