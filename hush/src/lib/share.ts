export type CopyResult = 'copied' | 'failed';
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function copyText(text: string): Promise<CopyResult> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch {
    /* fallback ниже */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Системное «Поделиться», если доступно; иначе — копирование ссылки. */
export async function shareLink(url: string, text: string): Promise<ShareResult> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'hush.', text, url });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    }
  }
  const copied = await copyText(`${text} ${url}`);
  return copied === 'copied' ? 'copied' : 'failed';
}
