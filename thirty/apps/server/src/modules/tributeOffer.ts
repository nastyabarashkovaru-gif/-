import { config } from '../config';

export const TRIBUTE_CHECKOUT_URL = 'https://t.me/tribute/app?startapp=s1bGq';
const base62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function newCheckout() {
  if (!config.TRIBUTE_NEW_CHECKOUT_URL) return null;
  let url: URL;
  try { url = new URL(config.TRIBUTE_NEW_CHECKOUT_URL); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const code = url.host === 't.me' && url.pathname === '/tribute/app'
    ? url.searchParams.get('startapp')?.match(/^s([0-9A-Za-z]{1,9})$/)?.[1]
    : url.host === 'web.tribute.tg' ? url.pathname.match(/^\/s\/([0-9A-Za-z]{1,9})\/?$/)?.[1] : undefined;
  if (!code) return null;
  const id = [...code].reduce((value, char) => value * 62 + base62.indexOf(char), 0);
  return id > 0 && Number.isSafeInteger(id) ? { id: String(id), url: `https://t.me/tribute/app?startapp=s${code}` } : null;
}

export function currentTributeCheckout() {
  return newCheckout()?.url ?? TRIBUTE_CHECKOUT_URL;
}

export function tributeOfferIds() {
  const retained = config.TRIBUTE_RETAINED_SUBSCRIPTION_IDS.split(',').map((id) => id.trim());
  const ids = [newCheckout()?.id ?? '', config.TRIBUTE_SUBSCRIPTION_ID, ...retained];
  return [...new Set(ids.filter((id) => /^\d+$/.test(id)))];
}
