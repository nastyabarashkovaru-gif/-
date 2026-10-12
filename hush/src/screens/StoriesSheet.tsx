import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import { Download, Loader2, Send, Share, X } from 'lucide-react';
import { api, type ResultsView } from '@/api';
import { config } from '@/config';
import { track } from '@/lib/analytics';
import { renderStoryCard } from '@/lib/storyCard';
import { canShareToStory, downloadFile, haptic, shareToStory } from '@/lib/telegram';
import { Cta, useToast } from '@/ui';

const MAX_CARDS = 5;
const STORY_TEXT = 'Узнай, что думают о тебе твои друзья 👀';

interface Card {
  question: string;
  answer: string;
}

/** По одной карточке на вопрос: самый развёрнутый открытый ответ */
export function pickStoryCards(results: ResultsView): Card[] {
  const best = new Map<string, Card>();
  for (const r of results.respondents) {
    for (const a of r.answers) {
      if (a.locked || !a.text) continue;
      const prev = best.get(a.questionId);
      if (!prev || a.text.length > prev.answer.length) best.set(a.questionId, { question: a.question, answer: a.text });
    }
  }
  return [...best.values()].slice(0, MAX_CARDS);
}

const storyLink = () => `https://t.me/${config.botUsername}/${config.appShortName}?startapp=ref_story`;

/** Сторис с результатами анкеты */
export function StoriesSheet({ open, onClose, results }: { open: boolean; onClose: () => void; results: ResultsView }) {
  const cards = useMemo(() => pickStoryCards(results), [results]);
  const render = useCallback(async () => {
    const out: StoryImage[] = [];
    for (const c of cards) {
      const canvas = await renderStoryCard({ ...c, link: storyLink(), handle: `@${config.botUsername}` });
      out.push({ src: canvas.toDataURL('image/png'), alt: c.question });
    }
    return out;
  }, [cards]);
  return (
    <StoryDeckSheet
      open={open}
      onClose={onClose}
      title="Поделись результатами в сторис 💜"
      subtitle="Свайпай и выбери карточку с ответом, который нравится больше всего"
      render={render}
      link={storyLink()}
      shareText={STORY_TEXT}
      widgetName="Узнать о себе"
      kind="results"
    />
  );
}

export interface StoryImage {
  src: string;
  alt: string;
}

/** Общее окно сторис: колода карточек, свайп, поделиться / сторис Telegram / сохранить */
export function StoryDeckSheet({
  open,
  onClose,
  title,
  subtitle,
  render,
  link,
  shareText,
  widgetName,
  kind,
}: {
  open: boolean;
  onClose: () => void;
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
    render()
      .then((out) => !cancelled && setCards(out))
      .catch(() => toast.show('Не удалось подготовить карточки'));
    return () => {
      cancelled = true;
    };
  }, [open, cards.length, render, toast]);
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
  const uploadCurrent = async () => (await api.uploadStory(images[index])).url;

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
            <h2 id="stories-title" className="h2 pt-[8px]">
              {title}
            </h2>
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
