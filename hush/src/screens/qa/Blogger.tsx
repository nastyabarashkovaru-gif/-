/**
 * Программа для блогеров (пришёл по ссылке startapp=blogger / bl_<рассыльщик>): интерфейс обычный, но вместо тарифов —
 * подарок. Блогер прикрепляет скриншот выложенной сторис, и Premium на 3 месяца включается сразу (сервер выдаёт без проверки).
 */
import { useRef, useState } from 'react';
import { Gift, ImageUp } from 'lucide-react';
import { api } from '@/api';
import { track } from '@/lib/analytics';
import { haptic } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { BigIcon, CloseButton, Cta, Screen, Spacer, TopBar, useToast } from '@/ui';

/** Скриншот → JPEG до 1280 px по большей стороне (обычно 150–400 КБ) */
async function compress(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Вместо тарифов у блогера, которому ещё не выдан подарочный Premium */
export function BloggerGiftScreen({ source }: { source?: string }) {
  const nav = useNav();
  const toast = useToast();
  const { refresh } = useAppState();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const close = () => (nav.canGoBack ? nav.back() : nav.reset({ name: 'inbox' }));

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      await api.sendBloggerProof(await compress(file));
      track('blogger_proof_sent', source ?? 'direct');
      haptic.notify('success');
      await refresh();
      nav.reset({ name: 'premiumSuccess' });
    } catch {
      setUploading(false);
      toast.show('Не удалось отправить. Попробуй другой скриншот');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <Screen fixed>
      <TopBar right={<CloseButton onClick={close} />} />
      <Spacer />
      <BigIcon size={72}>
        <Gift size={32} strokeWidth={1.8} />
      </BigIcon>
      <h1 className="h1 text-center">Привет, наш дорогой блогер! 💜</h1>
      <p className="muted text-center !text-[16px] leading-[1.45]">
        Помним, мы списывались с тобой! Прикрепи, пожалуйста, скриншот выложенной сторис (мы верим, что ты её выложил, она нужна нашим
        разработчикам для аналитики 💜) — и тебе моментально откроется подарочный доступ к Premium на 3 месяца 🥰
      </p>
      <Spacer />
      <Cta leading={<ImageUp size={20} strokeWidth={1.8} />} onClick={() => fileRef.current?.click()} loading={uploading}>
        Прикрепить скриншот сторис
      </Cta>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
    </Screen>
  );
}
