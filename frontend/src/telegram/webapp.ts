export interface TelegramWebAppUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  photo_url?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { user?: TelegramWebAppUser };
  viewportHeight: number;
  viewportStableHeight: number;
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  showAlert?: (message: string) => void;
  disableVerticalSwipes?: () => void;
  onEvent: (event: string, handler: () => void) => void;
  offEvent: (event: string, handler: () => void) => void;
  HapticFeedback?: { notificationOccurred: (type: 'success' | 'error' | 'warning') => void };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp || null;
}

function syncViewportHeight() {
  const wa = getTelegramWebApp();
  const height = wa?.viewportStableHeight || wa?.viewportHeight || window.innerHeight;
  document.documentElement.style.setProperty('--tg-viewport-height', `${height}px`);
}

export function initTelegram() {
  const wa = getTelegramWebApp();
  if (!wa) return;
  wa.ready();
  wa.expand();
  wa.setHeaderColor?.('#0a0a0a');
  wa.setBackgroundColor?.('#0a0a0a');
  wa.disableVerticalSwipes?.();

  // Telegram репортит финальную высоту вьюпорта не сразу при открытии, а после
  // события viewportChanged — без этого верхушка экрана обрезается/скачет при первом входе.
  syncViewportHeight();
  wa.onEvent('viewportChanged', syncViewportHeight);
  window.addEventListener('resize', syncViewportHeight);
}

export function getInitData(): string {
  return getTelegramWebApp()?.initData || '';
}

export function getTelegramUser(): TelegramWebAppUser | null {
  return getTelegramWebApp()?.initDataUnsafe?.user || null;
}

export function hapticSuccess() {
  getTelegramWebApp()?.HapticFeedback?.notificationOccurred('success');
}

export function hapticError() {
  getTelegramWebApp()?.HapticFeedback?.notificationOccurred('error');
}
