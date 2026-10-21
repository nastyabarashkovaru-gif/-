/* Обёртка над Telegram WebApp API: только документированные методы, с проверкой версии */
type WebApp = {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name: string } };
  version: string;
  platform: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast(v: string): boolean;
  setHeaderColor?(c: string): void;
  setBackgroundColor?(c: string): void;
  setBottomBarColor?(c: string): void;
  disableVerticalSwipes?(): void;
  openLink(url: string, opts?: { try_instant_view?: boolean }): void;
  openTelegramLink(url: string): void;
  shareToStory?(media: string, params?: { text?: string; widget_link?: { url: string; name?: string } }): void;
  downloadFile?(p: { url: string; file_name: string }, cb?: (ok: boolean) => void): void;
  requestWriteAccess?(cb?: (ok: boolean) => void): void;
  HapticFeedback?: { impactOccurred(s: 'light' | 'medium'): void; notificationOccurred(t: 'success' | 'error' | 'warning'): void };
  BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  onEvent?(e: string, cb: () => void): void;
};

export const tg: WebApp | null = (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp ?? null;
export const inTelegram = Boolean(tg?.initData);

export function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  try {
    if (tg.isVersionAtLeast('6.1')) {
      tg.setHeaderColor?.('#FFF9F2');
      tg.setBackgroundColor?.('#FFF9F2');
    }
    if (tg.isVersionAtLeast('7.10')) tg.setBottomBarColor?.('#FFFFFF');
    if (tg.isVersionAtLeast('7.7')) tg.disableVerticalSwipes?.();
  } catch {
    /* старый клиент */
  }
}

/** Параметр запуска: подписанный start_param или ?startapp= из URL кнопки web_app */
export function startParam(): string | null {
  const signed = tg?.initDataUnsafe?.start_param;
  if (signed) return signed;
  const url = new URLSearchParams(location.search).get('startapp') ?? new URLSearchParams(location.search).get('tgWebAppStartParam');
  return url && /^[A-Za-z0-9_-]{1,512}$/.test(url) ? url : null;
}

export function haptic(kind: 'light' | 'success' | 'error' = 'light') {
  try {
    if (kind === 'light') tg?.HapticFeedback?.impactOccurred('light');
    else tg?.HapticFeedback?.notificationOccurred(kind);
  } catch {
    /* noop */
  }
}

export function openExternal(url: string) {
  if (tg) tg.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

export function openTelegram(url: string) {
  if (tg && /^https:\/\/t\.me\//.test(url)) tg.openTelegramLink(url);
  else openExternal(url);
}

export const canShareStory = () => Boolean(tg?.shareToStory && tg.isVersionAtLeast('7.8'));
export const canDownload = () => Boolean(tg?.downloadFile && tg.isVersionAtLeast('8.0'));

export function shareStory(mediaUrl: string, link: string) {
  tg?.shareToStory?.(mediaUrl, { text: '30 дней — клуб дисциплины. Присоединяйся!', widget_link: { url: link, name: 'Присоединиться' } });
}

export function downloadImage(url: string, name: string) {
  if (canDownload()) tg!.downloadFile!({ url, file_name: name });
  else openExternal(url);
}

/** Разрешение боту писать первым (для напоминаний) — только по явному действию пользователя */
export function requestWriteAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!tg?.requestWriteAccess || !tg.isVersionAtLeast('6.9')) return resolve(false);
    tg.requestWriteAccess((ok) => resolve(ok));
  });
}

export function shareLink(url: string, text: string) {
  openTelegram(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
}
