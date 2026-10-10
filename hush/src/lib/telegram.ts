/**
 * Тонкая безопасная обёртка над Telegram WebApp.
 * В прототипе SDK не подключается: все вызовы — no-op в обычном браузере.
 */

type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type HapticNotice = 'error' | 'success' | 'warning';

interface TelegramWebApp {
  ready?: () => void;
  expand?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  HapticFeedback?: {
    impactOccurred?: (style: HapticStyle) => void;
    notificationOccurred?: (type: HapticNotice) => void;
    selectionChanged?: () => void;
  };
}

function webApp(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

export function initTelegram(): void {
  const app = webApp();
  if (!app) return;
  try {
    app.ready?.();
    app.expand?.();
    app.setHeaderColor?.('#0B0C10');
    app.setBackgroundColor?.('#0B0C10');
  } catch {
    /* вне Telegram — игнорируем */
  }
}

export const haptic = {
  tap(style: HapticStyle = 'light') {
    try {
      webApp()?.HapticFeedback?.impactOccurred?.(style);
    } catch {
      /* noop */
    }
  },
  select() {
    try {
      webApp()?.HapticFeedback?.selectionChanged?.();
    } catch {
      /* noop */
    }
  },
  notify(type: HapticNotice) {
    try {
      webApp()?.HapticFeedback?.notificationOccurred?.(type);
    } catch {
      /* noop */
    }
  },
};
