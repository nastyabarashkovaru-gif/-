import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import { ArrowLeft, Check, Download, Loader2, Lock, Send, Share, X } from 'lucide-react';
import { api, type RespondentView } from '@/api';
import { cn } from '@/lib/cn';
import { config } from '@/config';
import { track } from '@/lib/analytics';
import { reportError } from '@/lib/errorReport';
import { renderStoryCard } from '@/lib/storyCard';
import { canShareToStory, downloadFile, haptic, shareToStory } from '@/lib/telegram';
import { Cta, useToast } from '@/ui';
import { ErrorBoundary } from '@/ui/ErrorBoundary';

const STORY_TEXT = 'Узнай, что думают о тебе твои друзья 👀';

const storyLink = () => `https://t.me/${config.botUsername}/${config.appShortName}?startapp=ref_story`;

/**
 * Сторис с ответами конкретного анонима: сначала выбираешь, какими ответами поделиться,
 * потом для каждого выбранного ответа — своя карточка.
 */
export function StoriesSheet({ open, onClose, respondent }: { open: boolean; onClose: () => void; respondent: RespondentView }) {
  const [chosen, setChosen] = useState<string[] | null>(null);
  // Последний выбор — чтобы «назад» к выбору не сбрасывал отметки
  const [lastPicked, setLastPicked] = useState<string[]>([]);
  // Новый аноним или повторное открытие — снова к выбору с чистого листа
  useEffect(() => {
    if (!open) {
      setChosen(null);
      setLastPicked([]);
    }
  }, [open]);
  useEffect(() => {
    setChosen(null);
    setLastPicked([]);
  }, [respondent.id]);

  const cards = useMemo(
    () => (chosen ?? []).flatMap((id) => respondent.answers.filter((a) => a.questionId === id && a.text).map((a) => ({ question: a.question, answer: a.text! }))),
    [chosen, respondent],
  );
  const render = useCallback(async () => {
    const out: StoryImage[] = [];
    for (const c of cards) {
      const canvas = await renderStoryCard({ ...c, link: storyLink(), handle: `@${config.botUsername}` });
      out.push({ src: await canvasToUrl(canvas), alt: c.question });
    }
    return out;
  }, [cards]);

  return (
    <>
      <AnswerPicker
        open={open && chosen === null}
        onClose={onClose}
        respondent={respondent}
        initial={lastPicked}
        onDone={(ids) => {
          setLastPicked(ids);
          setChosen(ids);
        }}
      />
      <StoryDeckSheet
        key={(chosen ?? []).join('|')}
        open={open && chosen !== null}
        onClose={onClose}
        onBack={() => setChosen(null)}
        title={cards.length > 1 ? 'Твои карточки для сторис 💜' : 'Твоя карточка для сторис 💜'}
        subtitle={cards.length > 1 ? 'Свайпай — по карточке на каждый выбранный ответ' : 'Поделись ей или сохрани, чтобы выложить в сторис'}
        render={render}
        link={storyLink()}
        shareText={STORY_TEXT}
        widgetName="Узнать о себе"
        kind="results"
      />
    </>
  );
}

/** Шаг 1: выбор ответов анонима — как выбор вопросов при создании анкеты */
function AnswerPicker({
  open,
  onClose,
  respondent,
  initial,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  respondent: RespondentView;
  initial: string[];
  onDone: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => {
    if (open) setSelected(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, respondent.id]);
  const toggle = (id: string) => {
    haptic.select();
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };
  const lockedCount = respondent.answers.filter((a) => a.locked || !a.text).length;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 mx-auto flex max-w-app flex-col bg-black px-[23px]"
          style={{ paddingTop: 'calc(16px + var(--safe-top))', paddingBottom: 'calc(20px + var(--safe-bottom))' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pick-title"
        >
          <div className="flex shrink-0 items-start justify-between gap-[12px]">
            <h2 id="pick-title" className="h2 pt-[8px]">
              Поделись ответами в сторис 💜
            </h2>
            <button type="button" aria-label="Закрыть" onClick={onClose} className="-mr-[10px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:opacity-50">
              <X size={22} strokeWidth={1.8} color="#a1a1aa" />
            </button>
          </div>
          <p className="muted mt-[6px] shrink-0">
            Выбери ответы Анонима №{respondent.number}, которыми хочешь поделиться — для каждого будет своя карточка
          </p>

          <div className="-mx-[4px] my-[16px] flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-[4px]">
            {respondent.answers.map((a) => {
              const locked = a.locked || !a.text;
              const isOn = selected.includes(a.questionId);
              return (
                <button
                  key={a.questionId}
                  type="button"
                  aria-pressed={locked ? undefined : isOn}
                  disabled={locked}
                  onClick={() => toggle(a.questionId)}
                  className={cn(
                    'flex w-full shrink-0 items-start gap-[12px] rounded-[12px] border px-[13px] py-[14px] text-left transition-colors duration-200 active:scale-[0.99]',
                    isOn ? 'border-purple bg-[#1a1223]' : 'border-line bg-[#101013]',
                    locked && 'opacity-60',
                  )}
                >
                  <span
                    className={cn(
                      'mt-[2px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border transition-colors',
                      isOn ? 'border-purple bg-purple text-white' : 'border-[#4a4752]',
                    )}
                    aria-hidden
                  >
                    {locked ? <Lock size={12} strokeWidth={2} className="text-[#8e8b97]" /> : isOn && <Check size={14} strokeWidth={2.5} />}
                  </span>
                  <span className="flex min-w-0 flex-col gap-[4px]">
                    <span className="text-[13px] leading-[1.3] text-[#9a97a3]">{a.question}</span>
                    <span className="text-[15px] leading-[1.35] text-[#f5f3f7]">{locked ? 'Ответ откроется с Premium' : a.text}</span>
                  </span>
                </button>
              );
            })}
            {lockedCount > 0 && <p className="small text-center">Скрытыми ответами поделиться нельзя</p>}
          </div>

          <Cta disabled={!selected.length} onClick={() => onDone(respondent.answers.map((a) => a.questionId).filter((id) => selected.includes(id)))}>
            {selected.length ? `Создать ${selected.length === 1 ? 'карточку' : `карточки (${selected.length})`}` : 'Выбери хотя бы один ответ'}
          </Cta>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export interface StoryImage {
  /** blob:-ссылка на PNG */
  src: string;
  alt: string;
}

/**
 * PNG из canvas → blob:-ссылка. Большие data:-строки и неосвобождённые canvas
 * съедают память WebView на iPhone, поэтому canvas сразу обнуляем.
 */
export async function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  );
  canvas.width = 0;
  canvas.height = 0;
  return URL.createObjectURL(blob);
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

type DeckProps = Parameters<typeof StoryDeck>[0];

/** Общее окно сторис: колода карточек, свайп, поделиться / сторис Telegram / сохранить */
export function StoryDeckSheet(props: DeckProps) {
  const toast = useToast();
  // Сбой внутри окна закрывает только окно, приложение продолжает работать
  return (
    <ErrorBoundary
      resetKey={props.open}
      where={`story_${props.kind}`}
      fallback={null}
      onError={() => {
        props.onClose();
        toast.show('Не удалось подготовить карточки');
      }}
    >
      <StoryDeck {...props} />
    </ErrorBoundary>
  );
}

function StoryDeck({
  open,
  onClose,
  title,
  subtitle,
  render,
  link,
  shareText,
  widgetName,
  kind,
  onBack,
}: {
  open: boolean;
  onClose: () => void;
  /** Стрелка «назад» у заголовка (например, к выбору ответов) */
  onBack?: () => void;
  title: string;
  subtitle: string;
  render: () => Promise<StoryImage[]>;
  /** Ссылка в подписи и в виджете сторис Telegram */
  link: string;
  shareText: string;
  widgetName: string;
  /** Для аналитики: results | invite */
  kind: string;
}) {
  const toast = useToast();
  const [cards, setCards] = useState<StoryImage[]>([]);
  const images = useMemo(() => cards.map((c) => c.src), [cards]);
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [busy, setBusy] = useState<'share' | 'tg' | 'save' | null>(null);

  // Рисуем карточки при открытии
  useEffect(() => {
    if (!open || cards.length) return;
    let cancelled = false;
    // Рисуем после анимации появления окна, чтобы не тормозить её
    const timer = window.setTimeout(() => {
      render()
        .then((out) => {
          if (cancelled) out.forEach((c) => URL.revokeObjectURL(c.src));
          else setCards(out);
        })
        .catch((e) => {
          reportError(e, 'story_render');
          toast.show('Не удалось подготовить карточки');
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, cards.length, render, toast]);

  // Освобождаем картинки при закрытии экрана
  useEffect(() => () => cards.forEach((c) => URL.revokeObjectURL(c.src)), [cards]);
  const source = (method: string) => (kind === 'results' ? method : `${kind}_${method}`);

  const total = images.length;
  const go = (delta: number) => {
    if (total < 2) return;
    haptic.select();
    setDir(delta);
    setIndex((i) => (i + delta + total) % total);
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const swipe = info.offset.x + info.velocity.x * 0.2;
    if (swipe < -60) go(1);
    else if (swipe > 60) go(-1);
  };

  const currentFile = async () => {
    const blob = await (await fetch(images[index])).blob();
    return new File([blob], 'hush-story.png', { type: 'image/png' });
  };

  /** Временная публичная ссылка на картинку — нужна Telegram */
  const uploadCurrent = async () => (await api.uploadStory(await blobToDataUrl((await currentFile())))).url;

  const save = async () => {
    setBusy('save');
    try {
      const url = await uploadCurrent();
      if (!downloadFile(url, 'hush-story.png')) {
        // Обычный браузер
        const a = document.createElement('a');
        a.href = url;
        a.download = 'hush-story.png';
        a.target = '_blank';
        a.click();
      }
      track('story_shared', source('save'));
      toast.show('Картинка сохранена — добавь её в сторис 💜');
    } catch {
      toast.show('Не удалось сохранить. Попробуй ещё раз');
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    setBusy('share');
    try {
      const file = await currentFile();
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: `${shareText} ${link}` });
        track('story_shared', source('native'));
        return;
      }
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return;
    } finally {
      setBusy(null);
    }
    // Системное меню недоступно (часть WebView) — сохраняем картинку
    await save();
  };

  const telegramStory = async () => {
    setBusy('tg');
    try {
      const url = await uploadCurrent();
      if (shareToStory(url, shareText, { url: link, name: widgetName })) track('story_shared', source('telegram_story'));
      else toast.show('Обнови Telegram, чтобы публиковать сторис');
    } catch {
      toast.show('Не удалось открыть сторис. Попробуй ещё раз');
    } finally {
      setBusy(null);
    }
  };

  // Колода: текущая карточка сверху, две следующие выглядывают снизу
  const deck = total ? [0, 1, 2].slice(0, Math.min(3, total)).map((o) => (index + o) % total) : [];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 mx-auto flex max-w-app flex-col bg-black px-[23px]"
          style={{ paddingTop: 'calc(16px + var(--safe-top))', paddingBottom: 'calc(20px + var(--safe-bottom))' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="stories-title"
        >
          <div className="flex shrink-0 items-start justify-between gap-[12px]">
            <div className="flex items-start gap-[6px]">
              {onBack && (
                <button type="button" aria-label="Выбрать другие ответы" onClick={onBack} className="-ml-[10px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:opacity-50">
                  <ArrowLeft size={22} strokeWidth={1.8} color="#a1a1aa" />
                </button>
              )}
              <h2 id="stories-title" className="h2 pt-[8px]">
                {title}
              </h2>
            </div>
            <button type="button" aria-label="Закрыть" onClick={onClose} className="-mr-[10px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:opacity-50">
              <X size={22} strokeWidth={1.8} color="#a1a1aa" />
            </button>
          </div>
          <p className="muted mt-[6px] shrink-0">{subtitle}</p>

          {/* Колода карточек */}
          <div className="relative my-[16px] flex min-h-0 flex-1 items-center justify-center">
            {!total ? (
              <Loader2 className="animate-spin text-purple-text" size={28} aria-label="Готовим карточки" />
            ) : (
              <div className="relative h-full max-h-[56vh] w-auto" style={{ aspectRatio: '9 / 16' }}>
                {deck
                  .slice()
                  .reverse()
                  .map((cardIndex) => {
                    const depth = (cardIndex - index + total) % total;
                    const top = depth === 0;
                    return (
                      <motion.img
                        key={`${cardIndex}-${top ? 'top' : 'under'}`}
                        src={images[cardIndex]}
                        alt={top ? `Карточка ${index + 1}: ${cards[cardIndex]?.alt}` : ''}
                        draggable={false}
                        className="absolute inset-0 h-full w-full select-none rounded-[22px] border border-[#3a2d4d] object-cover shadow-[0_20px_50px_rgba(0,0,0,0.7)]"
                        style={{ zIndex: 10 - depth, touchAction: 'pan-y' }}
                        initial={top ? { x: dir * 80, opacity: 0, rotate: dir * 4 } : false}
                        animate={{
                          x: depth * 14,
                          y: depth * 10,
                          scale: 1 - depth * 0.05,
                          rotate: depth === 0 ? 0 : depth % 2 ? 4 : -3,
                          opacity: 1 - depth * 0.25,
                        }}
                        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                        drag={top && total > 1 ? 'x' : false}
                        dragElastic={0.7}
                        dragConstraints={{ left: 0, right: 0 }}
                        onDragEnd={top ? onDragEnd : undefined}
                        whileDrag={{ rotate: 0, scale: 1.02 }}
                      />
                    );
                  })}
              </div>
            )}
          </div>

          {total > 1 && (
            <div className="mb-[16px] flex shrink-0 justify-center gap-[7px]" aria-label={`Карточка ${index + 1} из ${total}`}>
              {images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Карточка ${i + 1}`}
                  onClick={() => {
                    setDir(i > index ? 1 : -1);
                    setIndex(i);
                  }}
                  className={`h-[7px] rounded-full transition-all duration-300 ${i === index ? 'w-[22px] bg-purple' : 'w-[7px] bg-[#4a4752]'}`}
                />
              ))}
            </div>
          )}

          <Cta leading={<Share size={20} strokeWidth={1.8} />} onClick={share} loading={busy === 'share'} disabled={!total || busy !== null}>
            Поделиться
          </Cta>
          <div className="mt-[10px] flex shrink-0 gap-[10px]">
            {canShareToStory() && (
              <button type="button" onClick={telegramStory} disabled={!total || busy !== null} className="cta-dark flex-1 disabled:opacity-40">
                {busy === 'tg' ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} strokeWidth={1.8} className="text-purple-text" />}
                Сторис в Telegram
              </button>
            )}
            <button type="button" onClick={save} disabled={!total || busy !== null} className="cta-dark flex-1 disabled:opacity-40">
              {busy === 'save' ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} strokeWidth={1.8} className="text-purple-text" />}
              Сохранить
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
