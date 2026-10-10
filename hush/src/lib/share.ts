import { openTelegramLink } from './telegram';

/** Текст из макета 03 «Сообщение для друзей». */
export const SHARE_INTRO = 'Привет! Ответь анонимно на 5 вопросов обо мне 👀';
export const SHARE_BODY = 'Можно говорить всё, что думаешь — я не узнаю, кто ответил.';

export function shareMessage(link: string): string {
  return `${SHARE_INTRO}\n\n${SHARE_BODY}\n\n${link}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Фолбэк для WebView без Clipboard API
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export type ShareResult = 'telegram' | 'native' | 'copied' | 'failed';

/** Нативный шаринг Telegram → Web Share API → копирование в буфер. */
export async function shareQuestionnaire(link: string): Promise<ShareResult> {
  const text = `${SHARE_INTRO}\n\n${SHARE_BODY}`;
  const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  if (openTelegramLink(tgUrl)) return 'telegram';
  if (navigator.share) {
    try {
      await navigator.share({ text, url: link });
      return 'native';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'native';
    }
  }
  return (await copyText(shareMessage(link))) ? 'copied' : 'failed';
}
