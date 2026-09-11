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
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  showAlert?: (message: string) => void;
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

export function initTelegram() {
  const wa = getTelegramWebApp();
  if (!wa) return;
  wa.ready();
  wa.expand();
  wa.setHeaderColor?.('#0a0a0a');
  wa.setBackgroundColor?.('#0a0a0a');
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
