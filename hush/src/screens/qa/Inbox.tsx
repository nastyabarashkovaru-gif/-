/**
 * HUSH 2.0: вкладка «Вопросы» → «Мне задали»: список анонимных вопросов,
 * «Ответить лично» (ответ увидит только спросивший) и «Ответить в сторис» (маленькая карточка вопроса).
 */
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Ban, Copy, Download, Flag, Inbox as InboxIcon, Instagram, Loader2, Lock, ShieldCheck, MoreHorizontal, Pencil, Send, Share, Trash2 } from 'lucide-react';
import { api, type InboxGate, type InboxItem } from '@/api';
import { track } from '@/lib/analytics';
import { renderQuestionSticker } from '@/lib/qaCards';
import { copyText } from '@/lib/share';
import { canShareToStory, downloadFile, haptic, requestWriteAccess, shareToStory } from '@/lib/telegram';
import { cn } from '@/lib/cn';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { BackArrow, Cta, Logo, Modal, Screen, TopBar, useToast } from '@/ui';
import { ActionSheet, QaTextarea, RevealButton, ShareLinkSheet, TAB_BAR_SPACE, timeAgo, useEnsureLink, useReveal, type SheetAction } from './common';

/** Последний загруженный список — чтобы экран ответа открывался мгновенно */
let inboxCache: InboxItem[] | null = null;
let gateCache: InboxGate | null = null;
/** Разрешение на пуши спрашиваем не чаще раза за открытие приложения */
let askedWrite = false;

/* ───────── Шапка вкладки «Вопросы» с переключателем ───────── */

export function QuestionsHeader({ active }: { active: 'inbox' | 'asks' }) {
  const nav = useNav();
  const { qa } = useAppState();
  const tabs = [
    { name: 'inbox' as const, label: 'Мне задали', badge: qa?.unanswered ?? 0 },
    { name: 'asks' as const, label: 'Я спросил(а)', badge: qa?.sentUnread ?? 0 },
  ];
  return (
    <>
      <TopBar />
      <h1 className="h1 mt-[4px]">Вопросы</h1>
      <div className="flex shrink-0 gap-[6px] rounded-[14px] bg-[#141318] p-[4px]" role="tablist">
        {tabs.map((t) => {
          const on = t.name === active;
          return (
            <button
              key={t.name}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                if (on) return;
                haptic.select();
                nav.reset({ name: t.name });
              }}
              className={cn(
                'flex flex-1 items-center justify-center gap-[6px] rounded-[11px] py-[10px] text-[15px] font-medium transition-colors',
                on ? 'bg-[#2a1f3d] text-white' : 'text-[#8e8b97]',
              )}
            >
              {t.label}
              {t.badge > 0 && (
                <span className="min-w-[18px] rounded-full bg-purple px-[5px] text-center text-[11px] font-semibold leading-[18px] text-white">{Math.min(t.badge, 99)}</span>
              )}
            </button>
          );
        })}
      </div>
    </>
  );
}

function useInbox() {
  const [items, setItems] = useState<InboxItem[] | null>(inboxCache);
  const [gate, setGate] = useState<InboxGate | null>(gateCache);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setError(false);
    api
      .getInbox()
      .then((r) => {
        inboxCache = r.items;
        gateCache = r.gate ?? null;
        setGate(gateCache);
        setItems(r.items);
      })
      .catch(() => setError(true));
  }, []);
  useEffect(load, [load]);
  const update = (fn: (list: InboxItem[]) => InboxItem[]) =>
    setItems((list) => {
      const next = fn(list ?? []);
      inboxCache = next;
      return next;
    });
  return { items, gate, error, load, update };
}

/** Пока не набралось 5 вопросов: счётчик и объяснение, зачем ждать */
function InboxGateCard({ gate }: { gate: InboxGate }) {
  const toast = useToast();
  const ensureLink = useEnsureLink();
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const left = Math.max(gate.required - gate.collected, 0);
  return (
    <div className="card flex flex-col items-center gap-[14px] !py-[26px] text-center">
      <span className="flex h-[56px] w-[56px] items-center justify-center rounded-full bg-[#2a1f3d] text-purple-text">
        <Lock size={24} strokeWidth={1.9} />
      </span>
      <h2 className="text-[20px] font-semibold leading-[1.25]">Собери {gate.required} вопросов, чтобы прочитать их</h2>
      <div className="flex w-full flex-col gap-[8px]">
        <div className="flex gap-[6px]" aria-hidden>
          {Array.from({ length: gate.required }, (_, i) => (
            <span key={i} className={cn('h-[8px] flex-1 rounded-full', i < gate.collected ? 'bg-purple' : 'bg-[#2a2930]')} />
          ))}
        </div>
        <p className="text-[15px] font-medium">
          {gate.collected} / {gate.required} · {left === 1 ? 'остался 1 вопрос' : `осталось ${left} ${left >= 5 ? 'вопросов' : 'вопроса'}`}
        </p>
      </div>
      <div className="flex items-start gap-[10px] rounded-[14px] bg-[#141318] p-[12px] text-left">
        <ShieldCheck size={20} strokeWidth={1.8} className="mt-[1px] shrink-0 text-green" aria-hidden />
        <p className="text-[14px] leading-[1.45] text-[#c9c6d1]">
          Это нужно для анонимности: когда вопросов несколько, сложнее догадаться, кто и что спросил. Поэтому мы откроем их, когда наберётся {gate.required}.
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          haptic.tap();
          setBusy(true);
          try {
            setLink((await ensureLink('inbox_gate')).link);
          } catch {
            toast.show('Не удалось получить ссылку');
          } finally {
            setBusy(false);
          }
        }}
        className="flex w-full items-center justify-center gap-[8px] rounded-[14px] bg-white py-[14px] text-[16px] font-medium text-[#111014] active:scale-[0.98]"
      >
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Share size={18} strokeWidth={1.9} />}
        Поделиться ссылкой
      </button>
      {link && <ShareLinkSheet open onClose={() => setLink(null)} link={link} kind="personal" source="inbox_gate" />}
    </div>
  );
}

const STATUS_LABEL: Record<InboxItem['status'], string> = { new: 'Новый', answered: 'Отвечен лично', story: 'Отвечен в сторис' };

export function InboxScreen() {
  const toast = useToast();
  const nav = useNav();
  const { me, refresh } = useAppState();
  const { items, gate, error, load, update } = useInbox();
  const [menuFor, setMenuFor] = useState<InboxItem | null>(null);
  const [stickerFor, setStickerFor] = useState<InboxItem | null>(null);
  const reveal = useReveal();

  // Пуш о каждом новом вопросе приходит от бота — просим разрешение, если его ещё нет
  useEffect(() => {
    if (me.allowsWrite || askedWrite) return;
    askedWrite = true;
    void requestWriteAccess().then((granted) => {
      if (granted) api.grantWriteAccess().then(refresh).catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.allowsWrite]);

  // Счётчик на вкладке обновляем после загрузки (мог прийти вопрос дня)
  useEffect(() => {
    if (items) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items?.length]);

  const remove = (id: string) => update((list) => list.filter((i) => i.id !== id));
  const replace = (next: InboxItem) => update((list) => list.map((i) => (i.id === next.id ? next : i)));

  const actions = (item: InboxItem): SheetAction[] => [
    {
      label: 'Удалить',
      icon: <Trash2 size={19} strokeWidth={1.8} />,
      danger: true,
      onClick: async () => {
        await api.deleteInbox(item.id).catch(() => {});
        remove(item.id);
        void refresh();
        toast.show('Вопрос удалён');
      },
    },
    {
      label: 'Пожаловаться',
      icon: <Flag size={19} strokeWidth={1.8} />,
      danger: true,
      onClick: async () => {
        await api.reportInbox(item.id).catch(() => {});
        remove(item.id);
        void refresh();
        toast.show('Спасибо! Мы проверим этот вопрос');
      },
    },
    {
      label: 'Заблокировать отправителя',
      icon: <Ban size={19} strokeWidth={1.8} />,
      danger: true,
      onClick: async () => {
        await api.blockInbox(item.id).catch(() => {});
        load();
        void refresh();
        toast.show('Отправитель заблокирован. Ты всё ещё не знаешь, кто это');
      },
    },
  ];

  return (
    <Screen className="!gap-[16px]">
      <div style={{ paddingBottom: TAB_BAR_SPACE }} className="flex flex-col gap-[16px]">
        <QuestionsHeader active="inbox" />

        {error && !items ? (
          <div className="card flex flex-col items-center gap-[10px] text-center">
            <p className="muted">Не удалось загрузить вопросы</p>
            <button type="button" onClick={load} className="cta-dark">
              Повторить
            </button>
          </div>
        ) : !items ? (
          <div className="flex flex-col gap-[10px]" aria-label="Загрузка">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[110px] animate-pulse rounded-[18px] bg-[#141318]" />
            ))}
          </div>
        ) : gate ? (
          <InboxGateCard gate={gate} />
        ) : items.length === 0 ? (
          <div className="card flex flex-col items-center gap-[12px] !py-[28px] text-center">
            <span className="flex h-[56px] w-[56px] items-center justify-center rounded-full bg-[#2a1f3d] text-purple-text">
              <InboxIcon size={26} strokeWidth={1.8} />
            </span>
            <h2 className="text-[19px] font-semibold">Пока нет вопросов</h2>
            <p className="muted">Нажми «+» внизу, чтобы получить личную ссылку и поделиться ей — тебе начнут задавать анонимные вопросы.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {items.map((item, i) =>
              item.locked ? (
                <motion.button
                  key={item.id}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 6) * 0.04 }}
                  onClick={() => {
                    haptic.tap();
                    nav.push({ name: 'premium', source: 'inbox_locked' });
                  }}
                  className="card flex flex-col gap-[10px] !p-[16px] text-left active:scale-[0.99]"
                >
                  <div className="flex items-center gap-[8px] text-[13px]">
                    <span className="font-medium text-[#c9c6d1]">Анонимно</span>
                    <span className="text-[#6f6b78]">·</span>
                    <span className="text-[#8e8b97]">{timeAgo(item.createdAt)}</span>
                    <Lock size={15} strokeWidth={1.9} className="ml-auto text-purple-text" aria-hidden />
                  </div>
                  <p className="select-none text-[17px] font-semibold leading-[1.35] blur-[6px]" aria-hidden>
                    Этот вопрос скрыт, открой его с подпиской
                  </p>
                  <span className="flex items-center justify-center gap-[6px] rounded-[12px] border border-dashed border-[#4a3b5c] bg-[#101013] px-[12px] py-[11px] text-[15px] font-medium text-purple-text">
                    <Lock size={15} strokeWidth={1.9} aria-hidden />
                    Открыть с Premium
                  </span>
                  <span className="text-center text-[13px] text-[#8e8b97]">Бесплатно открыты первые 3 вопроса</span>
                </motion.button>
              ) : (
              <motion.article
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 6) * 0.04 }}
                className={cn('card flex flex-col gap-[10px] !p-[16px]', item.status === 'new' && '!border-[#4a3570]')}
              >
                <div className="flex items-center gap-[8px] text-[13px]">
                  <span className="font-medium text-[#c9c6d1]">Анонимно</span>
                  <span className="text-[#6f6b78]">·</span>
                  <span className="text-[#8e8b97]">{timeAgo(item.createdAt)}</span>
                  <span
                    className={cn(
                      'ml-auto rounded-full px-[9px] py-[3px] text-[12px] font-medium',
                      item.status === 'new' ? 'bg-[#2a1f3d] text-purple-text' : 'bg-[#13281b] text-green',
                    )}
                  >
                    {STATUS_LABEL[item.status]}
                  </span>
                  <button
                    type="button"
                    aria-label="Ещё"
                    onClick={() => {
                      haptic.tap();
                      setMenuFor(item);
                    }}
                    className="-my-[6px] -mr-[8px] flex h-[34px] w-[34px] items-center justify-center rounded-[10px] text-[#a1a1aa] active:bg-[#1f1d26]"
                  >
                    <MoreHorizontal size={18} />
                  </button>
                </div>
                <p className="text-[17px] font-semibold leading-[1.35]">{item.text}</p>
                {item.answer && <p className="line-clamp-3 border-l-2 border-purple pl-[10px] text-[15px] leading-[1.4] text-[#c9c6d1]">{item.answer}</p>}
                <div className="flex gap-[8px]">
                  <button
                    type="button"
                    onClick={() => nav.push({ name: 'answerInbox', id: item.id })}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-[6px] rounded-[12px] py-[11px] text-[15px] font-medium active:scale-[0.98]',
                      item.answer ? 'border border-[#2a2930] text-white' : 'bg-white text-[#111014]',
                    )}
                  >
                    {item.answer && <Pencil size={15} strokeWidth={1.9} aria-hidden />}
                    {item.answer ? 'Изменить ответ' : 'Ответить лично'}
                  </button>
                  <button
                    type="button"
                    aria-label="Ответить в сторис"
                    onClick={() => {
                      track('story_sheet_opened', 'question_sticker');
                      setStickerFor(item);
                    }}
                    className="flex flex-1 items-center justify-center gap-[6px] rounded-[12px] border border-[#8b5cf6] bg-[#1b1524] py-[11px] text-[15px] font-medium text-white active:scale-[0.98]"
                  >
                    <Instagram size={16} strokeWidth={1.9} className="text-purple-text" aria-hidden />
                    В сторис
                  </button>
                </div>
                <RevealButton busy={reveal.busy === `inbox:${item.id}`} label="Узнать, кто спросил" onClick={() => reveal.run(`inbox:${item.id}`, () => api.revealInbox(item.id))} />
              </motion.article>
              ),
            )}
          </div>
        )}
      </div>

      <ActionSheet open={!!menuFor} onClose={() => setMenuFor(null)} title="Вопрос" actions={menuFor ? actions(menuFor) : []} />
      {reveal.modal}
      <StickerSheet
        item={stickerFor}
        onClose={() => setStickerFor(null)}
        onDone={(next) => {
          replace(next);
          void refresh();
        }}
      />
    </Screen>
  );
}

/* ───────── «Ответить в сторис»: маленькая карточка вопроса ───────── */

function StickerSheet({ item, onClose, onDone }: { item: InboxItem | null; onClose: () => void; onDone: (next: InboxItem) => void }) {
  const toast = useToast();
  const { qa } = useAppState();
  const [img, setImg] = useState<{ url: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    let url = '';
    let cancelled = false;
    void renderQuestionSticker(item.text ?? '').then(
      (canvas) =>
        new Promise<void>((resolve) =>
          canvas.toBlob((blob) => {
            if (blob && !cancelled) {
              url = URL.createObjectURL(blob);
              setImg({ url, blob });
            }
            resolve();
          }, 'image/png'),
        ),
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setImg(null);
    };
  }, [item]);

  const done = async (method: string) => {
    if (!item) return;
    track('story_shared', `sticker_${method}`);
    const next = await api.markStory(item.id).catch(() => null);
    if (next) onDone(next);
  };

  const copy = async () => {
    if (!img) return;
    setBusy('copy');
    try {
      // Картинка в буфере: в Instagram её можно вставить в сторис как стикер
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': img.blob })]);
      haptic.notify('success');
      toast.show('Карточка скопирована — вставь её в сторис 💜');
      await done('copy');
      onClose();
    } catch {
      toast.show('Не получилось скопировать — нажми «Поделиться» или «Сохранить»');
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    if (!img) return;
    setBusy('share');
    try {
      const file = new File([img.blob], 'hush-question.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
        await done('share');
        onClose();
        return;
      }
      await save();
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') toast.show('Не получилось. Попробуй «Сохранить»');
    } finally {
      setBusy(null);
    }
  };

  /** Telegram публикует сторис только во весь экран: ставим карточку по центру тёмного фона 1080×1920 */
  const telegramStory = async () => {
    if (!img) return;
    setBusy('tg');
    try {
      const sticker = await createImageBitmap(img.blob);
      const c = document.createElement('canvas');
      c.width = 1080;
      c.height = 1920;
      const ctx = c.getContext('2d')!;
      const bg = ctx.createRadialGradient(540, 960, 80, 540, 960, 1100);
      bg.addColorStop(0, '#2a1645');
      bg.addColorStop(1, '#000');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, 1080, 1920);
      const w = 1000;
      const h = Math.round((sticker.height / sticker.width) * w);
      ctx.drawImage(sticker, (1080 - w) / 2, Math.round((1920 - h) / 2), w, h);
      const { url } = await api.uploadStory(c.toDataURL('image/png'));
      const link = qa?.link ?? 'https://t.me/Hush_miniapp_bot/app';
      if (shareToStory(url, 'Задай мне вопрос анонимно 🤫', { url: link, name: 'Задать вопрос' })) {
        await done('telegram_story');
        onClose();
      } else toast.show('Обнови Telegram, чтобы публиковать сторис');
    } catch {
      toast.show('Не удалось открыть сторис. Попробуй ещё раз');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!img) return;
    setBusy('save');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(img.blob);
      });
      const { url } = await api.uploadStory(dataUrl);
      if (!downloadFile(url, 'hush-question.png')) {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'hush-question.png';
        a.target = '_blank';
        a.click();
      }
      toast.show('Карточка сохранена — добавь её в сторис 💜');
      await done('save');
      onClose();
    } catch {
      toast.show('Не удалось сохранить. Попробуй ещё раз');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={!!item} onClose={onClose} labelledBy="sticker-title">
      <div className="card-purple flex flex-col gap-[14px] !px-[18px] !py-[22px]">
        <h2 id="sticker-title" className="h2 text-center">
          Ответь в сторис
        </h2>
        <p className="muted -mt-[6px] text-center">Скопируй карточку вопроса и вставь её в сторис поверх своего фото или видео — и ответь там.</p>
        <div className="flex min-h-[120px] items-center justify-center rounded-[16px] bg-[repeating-conic-gradient(#1c1a22_0%_25%,#24212b_0%_50%)] bg-[length:20px_20px] p-[14px]">
          {img ? <img src={img.url} alt={item?.text ?? ''} className="w-full drop-shadow-[0_8px_24px_rgba(0,0,0,0.5)]" /> : <Loader2 className="animate-spin text-purple-text" />}
        </div>
        <button type="button" onClick={copy} disabled={!img || !!busy} className="cta-purple">
          {busy === 'copy' ? <Loader2 size={18} className="animate-spin" /> : <Copy size={18} strokeWidth={1.9} aria-hidden />}
          Скопировать карточку
        </button>
        {canShareToStory() && (
          <button type="button" onClick={telegramStory} disabled={!img || !!busy} className="cta-dark -mt-[4px]">
            {busy === 'tg' ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} strokeWidth={1.8} className="text-purple-text" aria-hidden />}
            Сторис в Telegram
          </button>
        )}
        <div className="-mt-[4px] flex gap-[10px]">
          <button type="button" onClick={share} disabled={!img || !!busy} className="cta-dark flex-1">
            {busy === 'share' ? <Loader2 size={17} className="animate-spin" /> : <Share size={17} strokeWidth={1.8} className="text-purple-text" aria-hidden />}
            Поделиться
          </button>
          <button type="button" onClick={save} disabled={!img || !!busy} className="cta-dark flex-1">
            {busy === 'save' ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} strokeWidth={1.8} className="text-purple-text" aria-hidden />}
            Сохранить
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ───────── «Ответить лично» ───────── */

const ANSWER_MAX = 1000;

export function AnswerInboxScreen({ id }: { id: string }) {
  const nav = useNav();
  const toast = useToast();
  const { refresh } = useAppState();
  const [item, setItem] = useState<InboxItem | null>(() => inboxCache?.find((i) => i.id === id) ?? null);
  const [text, setText] = useState(item?.answer ?? '');
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (item) return;
    api
      .getInbox()
      .then((r) => {
        inboxCache = r.items;
        const found = r.items.find((i) => i.id === id) ?? null;
        setItem(found);
        setText(found?.answer ?? '');
        if (!found) setMissing(true);
      })
      .catch(() => setMissing(true));
  }, [id, item]);

  const back = () => (nav.canGoBack ? nav.back() : nav.reset({ name: 'inbox' }));
  const replaceInCache = (next: InboxItem) => {
    inboxCache = (inboxCache ?? []).map((i) => (i.id === next.id ? next : i));
  };

  const save = async () => {
    if (!item || !text.trim()) return;
    setSaving(true);
    try {
      replaceInCache(await api.answerInbox(item.id, text.trim()));
      haptic.notify('success');
      toast.show('Ответ отправлен 💜');
      void refresh();
      back();
    } catch {
      setSaving(false);
      toast.show('Не удалось отправить. Попробуй ещё раз');
    }
  };

  const removeAnswer = async () => {
    if (!item) return;
    try {
      replaceInCache(await api.deleteInboxAnswer(item.id));
      toast.show('Ответ удалён');
      void refresh();
      back();
    } catch {
      toast.show('Не удалось удалить. Попробуй ещё раз');
    }
  };

  if (missing)
    return (
      <Screen fixed>
        <TopBar left={<BackArrow onClick={back} />} />
        <p className="muted mt-[40px] text-center">Вопрос не найден — возможно, он удалён.</p>
      </Screen>
    );
  if (!item) return <Screen fixed>{null}</Screen>;

  return (
    <Screen className="!gap-[16px]">
      <TopBar left={<BackArrow onClick={back} />} right={<Logo />} />
      <div className="rounded-[20px] bg-gradient-to-br from-[#7c3aed] to-[#a855f7] p-[18px]">
        <span className="text-[13px] font-medium text-white/80">Анонимный вопрос</span>
        <p className="mt-[6px] text-[20px] font-bold leading-[1.3] text-white">{item.text}</p>
      </div>
      <QaTextarea value={text} onChange={setText} placeholder="Твой ответ…" max={ANSWER_MAX} rows={5} label="Твой ответ" autoFocus={!item.answer} />
      <p className="small -mt-[8px]">Пользователь увидит ответ в приложении.</p>
      <Cta onClick={save} loading={saving} disabled={!text.trim() || text.trim() === item.answer}>
        {item.answer ? 'Сохранить изменения' : 'Ответить лично'}
      </Cta>
      {item.answer && (
        <div className="flex gap-[10px]">
          <button
            type="button"
            onClick={async () => {
              if (await copyText(`${item.text}\n\n${item.answer}`)) toast.show('Скопировано');
            }}
            className="cta-dark flex-1"
          >
            <Copy size={17} strokeWidth={1.8} className="text-purple-text" aria-hidden />
            Скопировать
          </button>
          <button type="button" onClick={removeAnswer} className="cta-dark flex-1 !border-[#5a2a35]">
            <Trash2 size={17} strokeWidth={1.8} className="text-[#ff7a8a]" aria-hidden />
            Удалить ответ
          </button>
        </div>
      )}
    </Screen>
  );
}

/** Карточка «вопрос — ответ» на всю сторис (для ответов на свой вопрос аудитории) */
export { AnswerStoriesSheet } from './AnswerStories';
