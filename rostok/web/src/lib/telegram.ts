/** Обёртка над Telegram WebApp SDK (telegram-web-app.js). Вне Telegram — безопасные заглушки. */
type TgWebApp = any;
export const tg: TgWebApp | null = (window as any).Telegram?.WebApp ?? null;
export const inTelegram = () => !!tg && typeof tg.initData === 'string' && tg.initData.length > 0;

export function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#FFFFFF');
    tg.setBackgroundColor?.('#FFFFFF');
    tg.setBottomBarColor?.('#FFFFFF');
    tg.disableVerticalSwipes?.();
  } catch {
    /* старые клиенты */
  }
}

export function startParam(): string | null {
  const fromTg = tg?.initDataUnsafe?.start_param;
  if (fromTg) return fromTg;
  return new URLSearchParams(location.search).get('startapp') || new URLSearchParams(location.search).get('tgWebAppStartParam');
}

export const haptic = {
  light: () => tg?.HapticFeedback?.impactOccurred?.('light'),
  medium: () => tg?.HapticFeedback?.impactOccurred?.('medium'),
  success: () => tg?.HapticFeedback?.notificationOccurred?.('success'),
  warning: () => tg?.HapticFeedback?.notificationOccurred?.('warning'),
  select: () => tg?.HapticFeedback?.selectionChanged?.(),
};

export function openInvoice(url: string): Promise<'paid' | 'cancelled' | 'failed' | 'pending'> {
  return new Promise((resolve) => {
    if (!tg?.openInvoice) return resolve('failed');
    tg.openInvoice(url, (status: string) => resolve(status as any));
  });
}

export function openTelegramLink(url: string) {
  if (tg?.openTelegramLink && url.startsWith('https://t.me/')) tg.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener');
}

export function shareLink(url: string, text: string) {
  const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  if (tg?.openTelegramLink) tg.openTelegramLink(share);
  else if (navigator.share) navigator.share({ url, text }).catch(() => {});
  else window.open(share, '_blank', 'noopener');
}

export const tgUserPhoto = (): string | null => tg?.initDataUnsafe?.user?.photo_url ?? null;
