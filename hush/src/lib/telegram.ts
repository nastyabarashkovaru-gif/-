/**
 * Безопасная обёртка над Telegram WebApp SDK.
 * Вне Telegram все вызовы — no-op, поэтому приложение работает в обычном браузере.
 */

type HapticStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type HapticNotice = 'error' | 'success' | 'warning';

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: TelegramUser & { allows_write_to_pm?: boolean }; start_param?: string };
  platform?: string;
  version?: string;
  ready?: () => void;
  expand?: () => void;
  isVersionAtLeast?: (v: string) => boolean;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  openTelegramLink?: (url: string) => void;
  openLink?: (url: string) => void;
  requestWriteAccess?: (cb?: (granted: boolean) => void) => void;
  BackButton?: {
    show: () => void;
    hide: () => void;
    onClick: (cb: () => void) => void;
    offClick: (cb: () => void) => void;
  };
  HapticFeedback?: {
    impactOccurred?: (style: HapticStyle) => void;
    notificationOccurred?: (type: HapticNotice) => void;
    selectionChanged?: () => void;
  };
}

export function webApp(): TelegramWebApp | undefined {
  const app = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  // SDK загружается и вне Telegram, но тогда initData пустой
  return app && app.initData ? app : undefined;
}

export const isTelegram = (): boolean => Boolean(webApp());

function safe(fn: () => void) {
  try {
    fn();
  } catch {
    /* старые клиенты Telegram могут не поддерживать метод */
  }
}

export function initTelegram(): void {
  const app = webApp();
  if (!app) return;
  safe(() => app.ready?.());
  safe(() => app.expand?.());
  safe(() => app.setHeaderColor?.('#000000'));
  safe(() => app.setBackgroundColor?.('#000000'));
  safe(() => app.setBottomBarColor?.('#000000'));
  // Горизонтальные свайпы карточек не должны сворачивать Mini App
  if (app.isVersionAtLeast?.('7.7')) safe(() => app.disableVerticalSwipes?.());
}

/** Сырые initData — передаются на backend для проверки подписи. */
export const getInitData = (): string => webApp()?.initData ?? '';

export const getTelegramUser = (): TelegramUser | undefined => webApp()?.initDataUnsafe?.user;

/** start_param из ссылки t.me/<bot>/<app>?startapp=<id>; в браузере — ?startapp=<id> */
export function getStartParam(): string | undefined {
  const fromTg = webApp()?.initDataUnsafe?.start_param;
  if (fromTg) return fromTg;
  const params = new URLSearchParams(window.location.search);
  return params.get('startapp') ?? params.get('tgWebAppStartParam') ?? undefined;
}

export function openTelegramLink(url: string): boolean {
  const app = webApp();
  if (!app?.openTelegramLink) return false;
  safe(() => app.openTelegramLink!(url));
  return true;
}

export function openExternal(url: string): void {
  const app = webApp();
  if (url.startsWith('https://t.me/') && openTelegramLink(url)) return;
  if (app?.openLink) return safe(() => app.openLink!(url));
  window.open(url, '_blank', 'noopener');
}

export const backButton = {
  show(handler: () => void): () => void {
    const bb = webApp()?.BackButton;
    if (!bb) return () => {};
    safe(() => {
      bb.onClick(handler);
      bb.show();
    });
    return () =>
      safe(() => {
        bb.offClick(handler);
        bb.hide();
      });
  },
};

export const haptic = {
  tap(style: HapticStyle = 'light') {
    safe(() => webApp()?.HapticFeedback?.impactOccurred?.(style));
  },
  select() {
    safe(() => webApp()?.HapticFeedback?.selectionChanged?.());
  },
  notify(type: HapticNotice) {
    safe(() => webApp()?.HapticFeedback?.notificationOccurred?.(type));
  },
};

/** Просим разрешение на сообщения от бота (уведомление «5 друзей ответили») */
export function requestWriteAccess(): Promise<boolean> {
  const app = webApp();
  if (!app?.requestWriteAccess || !app.isVersionAtLeast?.('6.9')) return Promise.resolve(false);
  if (app.initDataUnsafe?.user?.allows_write_to_pm) return Promise.resolve(true);
  return new Promise((resolve) => {
    try {
      app.requestWriteAccess!((granted) => resolve(granted));
    } catch {
      resolve(false);
    }
  });
}
