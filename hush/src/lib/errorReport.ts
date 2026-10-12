/**
 * Отчёты об ошибках приложения: уходят в логи сервера (Railway), чтобы видеть сбои на реальных телефонах.
 */
import { config } from '@/config';
import { getInitData } from '@/lib/telegram';

let sent = 0;

export function reportError(error: unknown, where: string) {
  if (config.demo || sent >= 10) return;
  sent += 1;
  const err = error instanceof Error ? error : new Error(String(error));
  void fetch(`${config.apiUrl}/api/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `tma ${getInitData()}` },
    body: JSON.stringify({ where, message: err.message, stack: err.stack ?? '', ua: navigator.userAgent }),
    keepalive: true,
  }).catch(() => {});
}

export function installErrorReporting() {
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'window'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
}
