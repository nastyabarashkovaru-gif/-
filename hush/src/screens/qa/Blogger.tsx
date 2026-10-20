/**
 * Программа для блогеров (пришёл по ссылке startapp=blogger): задание «ссылка → сторис → скриншот»,
 * за которое владелец вручную выдаёт Premium. Карточка — в профиле, экран — стартовый для блогерской ссылки.
 */
import { useRef, useState } from 'react';
import { Camera, CircleCheck, Clock, Gift, ImageUp, Instagram, Link2, Loader2, RotateCcw } from 'lucide-react';
import { api } from '@/api';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { Cta, Screen, TopBar, useToast } from '@/ui';
import { ShareLinkSheet, useEnsureLink } from './common';

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

/** Задание блогера: шаги и статус. compact — карточка в профиле */
export function BloggerTask({ compact }: { compact?: boolean }) {
  const toast = useToast();
  const { blogger, qa, refresh } = useAppState();
  const ensureLink = useEnsureLink();
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!blogger) return null;

  const status = blogger.status;
  const hasLink = Boolean(qa?.link);

  const share = async () => {
    haptic.tap();
    try {
      const { link } = await ensureLink('blogger');
      setShareLink(link);
      setShareOpen(true);
    } catch {
      toast.show('Не получилось создать ссылку. Попробуй ещё раз');
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const image = await compress(file);
      await api.sendBloggerProof(image);
      track('blogger_proof_sent', compact ? 'profile' : 'screen');
      haptic.notify('success');
      await refresh();
      toast.show('Скриншот отправлен — мы проверим и выдадим Premium 💜');
    } catch {
      toast.show('Не удалось отправить. Попробуй другой скриншот');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  if (status === 'approved')
    return (
      <div className="card-purple flex items-center gap-[12px] !p-[16px]">
        <CircleCheck size={24} strokeWidth={1.8} className="shrink-0 text-green" aria-hidden />
        <p className="text-[15px] leading-[1.4]">Спасибо за сторис! Premium на {blogger.premiumDays} дней уже у тебя 💜</p>
      </div>
    );

  const steps = [
    { icon: Link2, title: 'Получи личную ссылку', done: hasLink },
    { icon: Instagram, title: 'Выложи её в сторис', done: status !== 'none' && status !== 'rejected' },
    { icon: Camera, title: 'Пришли сюда скриншот сторис', done: status === 'pending' },
  ];

  return (
    <div className="card-purple flex flex-col gap-[14px] !p-[16px]">
      <div className="flex items-start gap-[10px]">
        <Gift size={22} strokeWidth={1.8} className="mt-[1px] shrink-0 text-purple-text" aria-hidden />
        <div className="flex flex-col gap-[4px]">
          <span className="text-[17px] font-semibold leading-[1.3]">Premium на {blogger.premiumDays} дней за сторис</span>
          <span className="text-[14px] leading-[1.4] text-[#c9c6d1]">Выложи свою ссылку hush. в сторис и пришли скриншот — мы проверим и выдадим Premium.</span>
        </div>
      </div>
      <ol className="flex flex-col gap-[8px]">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-center gap-[10px] text-[15px]">
            <span
              className={cn(
                'flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[13px] font-semibold',
                s.done ? 'bg-green text-[#06210f]' : 'bg-[#2a1f3d] text-purple-text',
              )}
            >
              {s.done ? '✓' : i + 1}
            </span>
            <span className={s.done ? 'text-[#8e8b97] line-through' : ''}>{s.title}</span>
          </li>
        ))}
      </ol>

      {status === 'pending' ? (
        <p className="flex items-center gap-[8px] rounded-[12px] bg-[#141318] px-[12px] py-[10px] text-[14px] text-[#c9c6d1]">
          <Clock size={17} strokeWidth={1.8} className="shrink-0 text-purple-text" aria-hidden />
          Скриншот на проверке. Как только проверим — пришлём уведомление.
        </p>
      ) : (
        <>
          {status === 'rejected' && (
            <p className="flex items-center gap-[8px] rounded-[12px] bg-[#2a1515] px-[12px] py-[10px] text-[14px] text-[#f3c4c4]">
              <RotateCcw size={17} strokeWidth={1.8} className="shrink-0" aria-hidden />
              Скриншот не подошёл — выложи сторис со своей ссылкой и пришли ещё раз.
            </p>
          )}
          <button type="button" onClick={share} className="cta-purple">
            <Instagram size={19} strokeWidth={1.9} aria-hidden />
            Выложить ссылку в сторис
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="cta-dark">
            {uploading ? <Loader2 size={18} className="animate-spin text-purple-text" aria-hidden /> : <ImageUp size={18} strokeWidth={1.8} className="text-purple-text" aria-hidden />}
            Отправить скриншот сторис
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
        </>
      )}
      {shareLink && <ShareLinkSheet open={shareOpen} onClose={() => setShareOpen(false)} link={shareLink} kind="personal" source="blogger" />}
    </div>
  );
}

/** Стартовый экран по блогерской ссылке */
export function BloggerScreen() {
  const nav = useNav();
  return (
    <Screen className="!gap-[16px]">
      <TopBar />
      <h1 className="h1 mt-[4px]">Привет! 👋</h1>
      <p className="muted -mt-[6px] !text-[16px]">hush. — анонимные вопросы от подписчиков. Расскажи о нас в сторис — и получи Premium бесплатно.</p>
      <BloggerTask />
      <div className="flex-1" />
      <Cta onClick={() => nav.reset({ name: 'inbox' })}>Перейти в приложение</Cta>
    </Screen>
  );
}
