/**
 * HUSH 2.0: «Входящие» — анонимные вопросы, ответы, карточки для сторис.
 */
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Ban, Copy, Flag, Inbox as InboxIcon, Instagram, MoreHorizontal, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { api, type InboxItem } from '@/api';
import { track } from '@/lib/analytics';
import { renderAnswerCard } from '@/lib/qaCards';
import { copyText } from '@/lib/share';
import { haptic, requestWriteAccess } from '@/lib/telegram';
import { cn } from '@/lib/cn';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { BackArrow, Cta, Logo, Screen, TopBar, useToast } from '@/ui';
import { canvasToUrl, StoryDeckSheet } from '../StoriesSheet';
import { ActionSheet, QaTextarea, ShareLinkSheet, TAB_BAR_SPACE, timeAgo, useEnsureLink, type SheetAction } from './common';

/** Последний загруженный список — чтобы экран ответа открывался мгновенно */
let inboxCache: InboxItem[] | null = null;
/** Разрешение на пуши спрашиваем не чаще раза за открытие приложения */
let askedWrite = false;

function useInbox() {
  const [items, setItems] = useState<InboxItem[] | null>(inboxCache);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setError(false);
    api
      .getInbox()
      .then((r) => {
        inboxCache = r.items;
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
  return { items, error, load, update };
}

export function InboxScreen() {
  const toast = useToast();
  const nav = useNav();
  const { qa, me, refresh } = useAppState();
  const ensureLink = useEnsureLink();
  const { items, error, load, update } = useInbox();
  const [shareOpen, setShareOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<InboxItem | null>(null);
  const [storyFor, setStoryFor] = useState<InboxItem | null>(null);
  const [creating, setCreating] = useState(false);

  // Пуш о каждом новом вопросе приходит от бота — просим разрешение, если его ещё нет (раз за сессию)
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

  const openShare = async () => {
    if (qa?.link) {
      setShareOpen(true);
      return;
    }
    setCreating(true);
    try {
      await ensureLink('inbox');
      load();
      setShareOpen(true);
    } catch {
      toast.show('Не получилось создать ссылку. Попробуй ещё раз');
    } finally {
      setCreating(false);
    }
  };

  const remove = (id: string) => update((list) => list.filter((i) => i.id !== id));
  const actions = (item: InboxItem): SheetAction[] => [
    ...(item.answer
      ? [
          {
            label: 'Поделиться в сторис',
            icon: <Instagram size={19} strokeWidth={1.8} className="text-purple-text" />,
            onClick: () => setStoryFor(item),
          },
          {
            label: 'Скопировать ответ',
            icon: <Copy size={19} strokeWidth={1.8} className="text-purple-text" />,
            onClick: async () => {
              if (await copyText(`${item.text}\n\n${item.answer}`)) toast.show('Скопировано');
            },
          },
        ]
      : []),
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
    ...(item.from === 'anon'
      ? [
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
        ]
      : []),
  ];

  return (
    <Screen className="!gap-[16px]">
      <div style={{ paddingBottom: TAB_BAR_SPACE }} className="flex flex-col gap-[16px]">
        <TopBar />
        <h1 className="h1 mt-[4px]">Твои анонимные вопросы</h1>

        {/* Постоянный блок «Твоя ссылка» */}
        <div className="card-purple flex shrink-0 flex-col gap-[12px] !p-[16px]">
          <span className="step !text-purple-text">Твоя ссылка</span>
          <p className="text-[16px] leading-[1.4]">Поделись ссылкой, чтобы получать больше анонимных вопросов.</p>
          <button type="button" onClick={openShare} disabled={creating} className="cta-purple">
            {creating ? 'Создаём ссылку…' : 'Поделиться ссылкой'}
            {!creating && <ArrowUpRight size={19} strokeWidth={2} aria-hidden />}
          </button>
        </div>

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
        ) : items.length === 0 ? (
          <div className="card flex flex-col items-center gap-[12px] !py-[28px] text-center">
            <span className="flex h-[56px] w-[56px] items-center justify-center rounded-full bg-[#2a1f3d] text-purple-text">
              <InboxIcon size={26} strokeWidth={1.8} />
            </span>
            <h2 className="text-[19px] font-semibold">Пока нет вопросов</h2>
            <p className="muted">Поделись ссылкой в сторис или с друзьями — и тебе начнут задавать анонимные вопросы.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {items.map((item, i) => (
              <motion.article
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 6) * 0.04 }}
                className={cn('card flex flex-col gap-[10px] !p-[16px]', item.status === 'new' && '!border-[#4a3570]')}
              >
                <div className="flex items-center gap-[8px] text-[13px]">
                  {item.from === 'hush' ? (
                    <span className="flex items-center gap-[5px] font-medium text-purple-text">
                      <Sparkles size={14} strokeWidth={1.9} aria-hidden />
                      Вопрос дня от hush.
                    </span>
                  ) : (
                    <span className="font-medium text-[#c9c6d1]">Анонимно</span>
                  )}
                  <span className="text-[#6f6b78]">·</span>
                  <span className="text-[#8e8b97]">{timeAgo(item.createdAt)}</span>
                  <span
                    className={cn(
                      'ml-auto rounded-full px-[9px] py-[3px] text-[12px] font-medium',
                      item.status === 'new' ? 'bg-[#2a1f3d] text-purple-text' : 'bg-[#13281b] text-green',
                    )}
                  >
                    {item.status === 'new' ? 'Новый' : 'Отвечен'}
                  </span>
                </div>
                <p className="text-[17px] font-semibold leading-[1.35]">{item.text}</p>
                {item.answer && <p className="line-clamp-3 border-l-2 border-purple pl-[10px] text-[15px] leading-[1.4] text-[#c9c6d1]">{item.answer}</p>}
                <div className="flex items-center gap-[8px]">
                  <button
                    type="button"
                    onClick={() => nav.push({ name: 'answerInbox', id: item.id })}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-[6px] rounded-[12px] py-[10px] text-[15px] font-medium active:scale-[0.98]',
                      item.answer ? 'border border-[#2a2930] text-white' : 'bg-white text-[#111014]',
                    )}
                  >
                    {item.answer ? <Pencil size={15} strokeWidth={1.9} aria-hidden /> : null}
                    {item.answer ? 'Изменить ответ' : 'Ответить'}
                  </button>
                  {item.answer && (
                    <button
                      type="button"
                      aria-label="Поделиться в сторис"
                      onClick={() => setStoryFor(item)}
                      className="flex h-[42px] w-[46px] items-center justify-center rounded-[12px] border border-[#8b5cf6] bg-[#1b1524] text-purple-text active:scale-[0.97]"
                    >
                      <Instagram size={18} strokeWidth={1.8} />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Ещё"
                    onClick={() => {
                      haptic.tap();
                      setMenuFor(item);
                    }}
                    className="flex h-[42px] w-[46px] items-center justify-center rounded-[12px] border border-[#2a2930] text-[#a1a1aa] active:scale-[0.97]"
                  >
                    <MoreHorizontal size={19} />
                  </button>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </div>

      {qa?.link && <ShareLinkSheet open={shareOpen} onClose={() => setShareOpen(false)} link={qa.link} kind="personal" source="inbox" />}
      <ActionSheet open={!!menuFor} onClose={() => setMenuFor(null)} title="Вопрос" actions={menuFor ? actions(menuFor) : []} />
      {storyFor && <AnswerStoriesSheet item={storyFor} onClose={() => setStoryFor(null)} />}
    </Screen>
  );
}

/** Одна карточка «вопрос — ответ» с QR на личную ссылку */
export function AnswerStoriesSheet({ item, onClose }: { item: { text: string; answer: string | null }; onClose: () => void }) {
  const { qa } = useAppState();
  const link = qa?.link ?? `https://t.me/Hush_miniapp_bot/app`;
  const render = useCallback(async () => {
    const canvas = await renderAnswerCard({ question: item.text, answer: item.answer ?? '', link });
    return [{ src: await canvasToUrl(canvas), alt: item.text }];
  }, [item, link]);
  return (
    <StoryDeckSheet
      open
      onClose={onClose}
      title="Поделись ответом в сторис 💜"
      subtitle="Карточка с вопросом и твоим ответом — подписчики смогут задать тебе свой вопрос по QR"
      render={render}
      link={link}
      shareText="Задай мне вопрос анонимно 🤫"
      widgetName="Задать вопрос"
      kind="answer"
    />
  );
}

/* ───────── Ответ на входящий вопрос ───────── */

const ANSWER_MAX = 1000;

export function AnswerInboxScreen({ id }: { id: string }) {
  const nav = useNav();
  const toast = useToast();
  const { refresh } = useAppState();
  const [item, setItem] = useState<InboxItem | null>(() => inboxCache?.find((i) => i.id === id) ?? null);
  const [text, setText] = useState(item?.answer ?? '');
  const [saving, setSaving] = useState(false);
  const [stories, setStories] = useState(false);
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

  const replaceInCache = (next: InboxItem) => {
    inboxCache = (inboxCache ?? []).map((i) => (i.id === next.id ? next : i));
    setItem(next);
  };

  const save = async () => {
    if (!item || !text.trim()) return;
    setSaving(true);
    try {
      const next = await api.answerInbox(item.id, text.trim());
      replaceInCache(next);
      haptic.notify('success');
      toast.show('Ответ сохранён 💜');
      void refresh();
    } catch {
      toast.show('Не удалось сохранить. Попробуй ещё раз');
    } finally {
      setSaving(false);
    }
  };

  const removeAnswer = async () => {
    if (!item) return;
    try {
      const next = await api.deleteInboxAnswer(item.id);
      replaceInCache(next);
      setText('');
      toast.show('Ответ удалён');
      void refresh();
    } catch {
      toast.show('Не удалось удалить. Попробуй ещё раз');
    }
  };

  const back = () => (nav.canGoBack ? nav.back() : nav.reset({ name: 'inbox' }));

  if (missing)
    return (
      <Screen fixed>
        <TopBar left={<BackArrow onClick={back} />} />
        <p className="muted mt-[40px] text-center">Вопрос не найден — возможно, он удалён.</p>
      </Screen>
    );
  if (!item) return <Screen fixed>{null}</Screen>;

  const saved = Boolean(item.answer) && item.answer === text.trim();

  return (
    <Screen className="!gap-[16px]">
      <TopBar left={<BackArrow onClick={back} />} right={<Logo />} />
      <div className="rounded-[20px] bg-gradient-to-br from-[#7c3aed] to-[#a855f7] p-[18px]">
        <span className="text-[13px] font-medium text-white/80">{item.from === 'hush' ? 'Вопрос дня от hush.' : 'Анонимный вопрос'}</span>
        <p className="mt-[6px] text-[20px] font-bold leading-[1.3] text-white">{item.text}</p>
      </div>
      <QaTextarea value={text} onChange={setText} placeholder="Твой ответ…" max={ANSWER_MAX} rows={5} label="Твой ответ" autoFocus={!item.answer} />
      {!saved ? (
        <Cta onClick={save} loading={saving} disabled={!text.trim()}>
          {item.answer ? 'Сохранить изменения' : 'Сохранить ответ'}
        </Cta>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              track('story_sheet_opened', 'answer');
              setStories(true);
            }}
            className="cta-purple"
          >
            <Instagram size={19} strokeWidth={1.9} aria-hidden />
            Поделиться в сторис
          </button>
          <div className="-mt-[6px] flex gap-[10px]">
            <button
              type="button"
              onClick={async () => {
                if (await copyText(`${item.text}\n\n${item.answer}`)) {
                  track('link_copied', 'answer_text');
                  toast.show('Скопировано');
                }
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
        </>
      )}
      {stories && <AnswerStoriesSheet item={item} onClose={() => setStories(false)} />}
    </Screen>
  );
}
