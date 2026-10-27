import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Подпись тестовых (sandbox) уведомлений: ключи рекурсивно отсортированы, все значения — строки, HMAC-SHA256 от JSON.
 */
export function normalize(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(normalize);
  if (data !== null && typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(data as object).sort()) {
      const v = (data as Record<string, unknown>)[key];
      if (v === undefined || v === null) continue;
      out[key] = typeof v === 'object' ? normalize(v) : String(v);
    }
    return out;
  }
  return data === null || data === undefined ? '' : String(data);
}

export function signPayload(data: Record<string, unknown>, secret: string): string {
  const json = JSON.stringify(normalize(data)).replace(/\//g, '\\/');
  return createHmac('sha256', secret).update(json).digest('hex');
}

export function verifyPayload(data: Record<string, unknown>, secret: string, sign: string | undefined): boolean {
  if (!sign || !secret) return false;
  const expected = signPayload(data, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(sign.toLowerCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Сборка query products[0][name]=… как в PHP http_build_query */
export function buildQuery(data: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((item, i) => walk(`${prefix}[${i}]`, item));
    else if (typeof v === 'object') for (const [k, x] of Object.entries(v as object)) walk(`${prefix}[${k}]`, x);
    else parts.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`);
  };
  for (const [k, v] of Object.entries(data)) walk(k, v);
  return parts.join('&');
}
