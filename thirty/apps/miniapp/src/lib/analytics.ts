import { api } from './api';

/* Аналитика внутри Mini App: батч, дедупликация по event_id, ошибки не мешают UX */
const SESSION_KEY = 'thirty.session';
const session = (() => {
  try {
    const s = sessionStorage.getItem(SESSION_KEY) ?? crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, s);
    return s;
  } catch {
    return crypto.randomUUID();
  }
})();

type Ev = { event_id: string; session_id: string; event_name: string; screen_id?: string; tariff_id?: string; flow_id?: string; experiment_variant?: string; timestamp: string; metadata?: Record<string, unknown> };
let queue: Ev[] = [];
let timer: number | null = null;
export const ctx: { variant?: string; flowId?: string; variants: Record<string, string> } = { variants: {} };

const device = /iphone|ipad/i.test(navigator.userAgent) ? 'ios' : /android/i.test(navigator.userAgent) ? 'android' : 'desktop';

export function track(event: string, data: { screen?: string; tariff?: string; metadata?: Record<string, unknown> } = {}) {
  queue.push({
    event_id: crypto.randomUUID(),
    session_id: session,
    event_name: event,
    screen_id: data.screen,
    tariff_id: data.tariff,
    flow_id: ctx.flowId,
    experiment_variant: ctx.variant,
    timestamp: new Date().toISOString(),
    metadata: data.metadata,
  });
  if (timer === null) timer = window.setTimeout(flush, 800);
}

export async function flush() {
  timer = null;
  if (!queue.length) return;
  const batch = queue.slice(0, 100);
  queue = queue.slice(100);
  try {
    await api('/api/events', { body: { events: batch, device } });
  } catch {
    // Повтор с теми же event_id — сервер не задвоит
    queue = [...batch, ...queue].slice(-500);
  }
  if (queue.length) timer = window.setTimeout(flush, 3000);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flush();
});

/** screen_view при показе и screen_exit с длительностью при уходе */
let current: { screen: string; at: number } | null = null;
export function screenView(screen: string) {
  if (current?.screen === screen) return;
  if (current) track('screen_exit', { screen: current.screen, metadata: { durationMs: Date.now() - current.at } });
  current = { screen, at: Date.now() };
  track('screen_view', { screen });
}
