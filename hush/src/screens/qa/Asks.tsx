/**
 * HUSH 2.0: «Задать свой вопрос» — список своих вопросов, редактор, ответы, форма ответа подписчика.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Archive, ArrowUpRight, Ban, ChevronRight, Copy, Flag, Instagram, Lock, MessageCircleQuestion, MoreHorizontal, Plus, Send, Trash2 } from 'lucide-react';
import { api, ApiError, type AskAnswer, type AskSummary, type PublicAsk, type SentItem } from '@/api';
import { cn } from '@/lib/cn';
import { track } from '@/lib/analytics';
import { plural } from '@/lib/plural';
import { copyText } from '@/lib/share';
import { haptic } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { BackArrow, BigIcon, Cta, LoadingScreen, Logo, MessageScreen, Screen, Spacer, TopBar, useToast } from '@/ui';
import { AnswerStoriesSheet } from './AnswerStories';
import { QuestionsHeader } from './Inbox';
import { ActionSheet, AnonymityChoice, Avatar, Chips, newKey, QaTextarea, AuthorSlot, ShareLinkSheet, TAB_BAR_SPACE, timeAgo, type Anonymity, type SheetAction } from './common';

const answersLabel = (n: number) => `${n} ${plural(n, ['ответ', 'ответа', 'ответов'])}`;

/* ───────── Вкладка «Вопросы» → «Я спросил(а)» ───────── */

export function AsksScreen() {
  const nav = useNav();
  const { questionnaires, refresh } = useAppState();
  const [items, setItems] = useState<AskSummary[] | null>(null);
  const [sent, setSent] = useState<SentItem[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    setError(false);
    Promise.all([api.getAsks(), api.getSent()])
      .then(([a, s]) => {
        setItems(a.items);
        setSent(s.items);
        // Личные ответы отмечены прочитанными — обновляем счётчики
        void refresh();
      })
      .catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(load, [load]);

  return (
    <Screen className="!gap-[16px]">
      <div style={{ paddingBottom: TAB_BAR_SPACE }} className="flex flex-col gap-[16px]">
        <QuestionsHeader active="asks" />

        {error && !items ? (
          <button type="button" onClick={load} className="cta-dark">
            Не удалось загрузить — повторить
          </button>
        ) : !items || !sent ? (
          <div className="flex flex-col gap-[10px]">
            {[0, 1].map((i) => (
              <div key={i} className="h-[84px] animate-pulse rounded-[18px] bg-[#141318]" />
            ))}
          </div>
        ) : (
          <>
            {/* Свои вопросы аудитории */}
            <div className="mt-[2px] flex items-center justify-between">
              <span className="step">Твои вопросы подписчикам</span>
            </div>
            <button type="button" onClick={() => nav.push({ name: 'createAsk' })} className="cta-dark -mt-[4px]">
              <Plus size={18} strokeWidth={2.2} className="text-purple-text" aria-hidden />
              Задать вопрос подписчикам
            </button>
            {items.length === 0 ? (
              <p className="small -mt-[6px] text-center">Например: «Какое было твоё первое впечатление обо мне?» — подписчики ответят анонимно.</p>
            ) : (
              <div className="flex flex-col gap-[10px]">
                {items.map((a, i) => (
                  <motion.button
                    key={a.id}
                    type="button"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 6) * 0.04 }}
                    onClick={() => nav.push({ name: 'askDetail', id: a.id })}
                    className="card flex items-center gap-[12px] !p-[16px] text-left active:scale-[0.99]"
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-[6px]">
                      <span className="text-[16px] font-semibold leading-[1.35]">{a.text}</span>
                      <span className="text-[13px] text-[#8e8b97]">
                        <span className={a.answerCount ? 'font-medium text-purple-text' : ''}>{answersLabel(a.answerCount)}</span> · {timeAgo(a.createdAt)}
                      </span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-[#6f6b78]" aria-hidden />
                  </motion.button>
                ))}
              </div>
            )}

            {/* Вопросы, заданные людям по их ссылкам — появляются после первого ответа, чтобы не путать */}
            {sent.some((x) => x.status !== 'waiting') && (
              <div className="mt-[10px] flex flex-col gap-[10px]">
                <span className="step">Ты спросил(а) других</span>
                <p className="small -mt-[4px]">Вопросы, которые ты анонимно задал(а) людям по их личным ссылкам. Ответы приходят сюда.</p>
                {sent.map((x) => (
                  <article key={x.id} className={cn('card flex flex-col gap-[10px] !p-[16px]', x.unread && '!border-[#6a45a0]')}>
                    <div className="flex items-center gap-[8px] text-[13px]">
                      <Avatar name={x.recipient.firstName} photoUrl={x.recipient.photoUrl} size={24} />
                      {/* Получатель — тот, кому ты задал(а) вопрос (ты анонимен для него, а не он для тебя) */}
                      <span className="text-[#8e8b97]">Кому:</span>
                      <span className="-ml-[4px] font-medium text-[#c9c6d1]">{x.recipient.firstName}</span>
                      <span className="text-[#6f6b78]">·</span>
                      <span className="text-[#8e8b97]">{timeAgo(x.answeredAt ?? x.createdAt)}</span>
                      <span
                        className={cn(
                          'ml-auto rounded-full px-[9px] py-[3px] text-[12px] font-medium',
                          x.status === 'waiting' ? 'bg-[#1f1d26] text-[#a1a1aa]' : 'bg-[#13281b] text-green',
                        )}
                      >
                        {x.status === 'waiting' ? 'Ждём ответ' : x.status === 'story' ? 'Ответ в сторис' : x.unread ? 'Новый ответ' : 'Ответил(а)'}
                      </span>
                    </div>
                    <p className="text-[16px] font-semibold leading-[1.35]">
                      <span className="mr-[6px] text-[13px] font-medium text-[#8e8b97]">Твой вопрос:</span>
                      {x.text}
                    </p>
                    {x.answer && (
                      <p className="whitespace-pre-line border-l-2 border-purple pl-[10px] text-[15px] leading-[1.45] text-[#e6e3ea]">
                        <span className="mr-[6px] text-[13px] font-medium text-purple-text">Ответ:</span>
                        {x.answer}
                      </p>
                    )}
                    {x.status === 'story' && <p className="small">{x.recipient.firstName} ответил(а) в сторис — загляни в профиль 👀</p>}
                  </article>
                ))}
              </div>
            )}
          </>
        )}

        {/* Архив старых анкет HUSH 1.0 */}
        {questionnaires.length > 0 && (
          <div className="flex flex-col gap-[10px]">
            <span className="step mt-[8px] flex items-center gap-[8px]">
              <Archive size={15} strokeWidth={1.8} aria-hidden />
              Анкеты из прошлой версии
            </span>
            {questionnaires.map((q) => (
              <button
                key={q.id}
                type="button"
                onClick={() => nav.push({ name: 'dashboard', qid: q.id })}
                className="card flex items-center gap-[12px] !p-[14px] text-left active:scale-[0.99]"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-[4px]">
                  <span className="truncate text-[15px]">{q.questions.map((x) => x.text).join(' · ')}</span>
                  <span className="text-[13px] text-[#8e8b97]">
                    {q.respondentCount} {plural(q.respondentCount, ['ответ', 'ответа', 'ответов'])} · {timeAgo(q.createdAt)}
                  </span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-[#6f6b78]" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </div>
    </Screen>
  );
}

/* ───────── Редактор своего вопроса ───────── */

const ASK_EXAMPLES = [
  'Какое было твоё первое впечатление обо мне?',
  'За что меня можно уважать?',
  'Какую мою черту ты бы изменил(а)?',
  'Какой совет ты бы мне дал(а)?',
  'Что обо мне говорят за спиной?',
];
const ASK_MAX = 200;

export function CreateAskScreen() {
  const nav = useNav();
  const toast = useToast();
  const { refresh } = useAppState();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    const value = text.trim();
    if (value.length < 3) return;
    setSaving(true);
    try {
      const ask = await api.createAsk(value, 'editor');
      haptic.notify('success');
      void refresh();
      nav.replace({ name: 'askDetail', id: ask.id, fresh: true });
    } catch {
      setSaving(false);
      toast.show('Не удалось создать вопрос. Попробуй ещё раз');
    }
  };

  return (
    <Screen className="!gap-[16px]">
      <TopBar left={<BackArrow onClick={() => (nav.canGoBack ? nav.back() : nav.reset({ name: 'asks' }))} />} right={<Logo />} />
      <h1 className="h1">Что хочешь узнать у подписчиков?</h1>
      <p className="muted -mt-[6px]">Напиши любой вопрос — ответы придут анонимно.</p>
      <QaTextarea value={text} onChange={setText} placeholder="Например: какое было твоё первое впечатление обо мне?" max={ASK_MAX} rows={3} label="Твой вопрос" autoFocus />
      <span className="step -mb-[4px]">Примеры</span>
      <Chips items={ASK_EXAMPLES} onPick={setText} />
      <Spacer min={8} />
      <Cta icon="right" onClick={create} loading={saving} disabled={text.trim().length < 3}>
        Создать вопрос
      </Cta>
    </Screen>
  );
}

/* ───────── Свой вопрос: ссылка и ответы ───────── */

export function AskDetailScreen({ id, fresh }: { id: string; fresh?: boolean }) {
  const nav = useNav();
  const toast = useToast();
  const { refresh, isPremium } = useAppState();
  const [data, setData] = useState<{ ask: AskSummary; answers: AskAnswer[] } | null>(null);
  const [error, setError] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<AskAnswer | null>(null);
  const [storyFor, setStoryFor] = useState<AskAnswer | null>(null);
  const [askMenu, setAskMenu] = useState(false);

  const load = useCallback(() => {
    api
      .getAsk(id)
      .then(setData)
      .catch(() => setError(true));
  }, [id]);
  // После покупки подписки — сразу все ответы и авторы
  useEffect(load, [load, isPremium]);

  const back = () => (nav.canGoBack ? nav.back() : nav.reset({ name: 'asks' }));

  if (error) return <MessageScreen icon={<MessageCircleQuestion size={26} />} title="Вопрос не найден" text="Возможно, он удалён." action="К моим вопросам" onAction={() => nav.reset({ name: 'asks' })} />;
  if (!data) return <LoadingScreen />;
  const { ask, answers } = data;

  const copyLink = async () => {
    if (await copyText(ask.link)) {
      haptic.notify('success');
      track('link_copied', 'ask_detail');
      toast.show('Ссылка скопирована');
    }
  };
  const drop = (aid: string) => setData((d) => (d ? { ...d, answers: d.answers.filter((x) => x.id !== aid) } : d));

  const answerActions = (x: AskAnswer): SheetAction[] => [
    { label: 'Поделиться в сторис', icon: <Instagram size={19} strokeWidth={1.8} className="text-purple-text" />, onClick: () => setStoryFor(x) },
    {
      label: 'Скопировать ответ',
      icon: <Copy size={19} strokeWidth={1.8} className="text-purple-text" />,
      onClick: async () => {
        if (await copyText(`${ask.text}\n\n${x.text}`)) toast.show('Скопировано');
      },
    },
    {
      label: 'Удалить',
      icon: <Trash2 size={19} strokeWidth={1.8} />,
      danger: true,
      onClick: async () => {
        await api.deleteAskAnswer(ask.id, x.id).catch(() => {});
        drop(x.id);
        toast.show('Ответ удалён');
      },
    },
    {
      label: 'Пожаловаться',
      icon: <Flag size={19} strokeWidth={1.8} />,
      danger: true,
      onClick: async () => {
        await api.reportAskAnswer(ask.id, x.id).catch(() => {});
        drop(x.id);
        toast.show('Спасибо! Мы проверим этот ответ');
      },
    },
    {
      label: 'Заблокировать автора',
      icon: <Ban size={19} strokeWidth={1.8} />,
      danger: true,
      onClick: async () => {
        await api.blockAskAnswer(ask.id, x.id).catch(() => {});
        drop(x.id);
        toast.show('Автор заблокирован. Ты всё ещё не знаешь, кто это');
      },
    },
  ];

  return (
    <Screen className="!gap-[16px]">
      <TopBar
        left={<BackArrow onClick={back} />}
        right={
          <button type="button" aria-label="Ещё" onClick={() => setAskMenu(true)} className="-mr-[10px] flex h-11 w-11 items-center justify-center rounded-full text-[#a1a1aa] active:opacity-50">
            <MoreHorizontal size={22} />
          </button>
        }
      />
      {fresh && (
        <motion.div className="flex flex-col items-center gap-[10px] text-center" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <BigIcon size={56}>
            <Send size={24} strokeWidth={1.9} />
          </BigIcon>
          <h1 className="h1">Твой вопрос готов!</h1>
          <p className="muted -mt-[2px]">Поделись ссылкой — подписчики сразу увидят вопрос и ответят анонимно.</p>
        </motion.div>
      )}
      <div className="rounded-[20px] bg-gradient-to-br from-[#7c3aed] to-[#a855f7] p-[18px]">
        <span className="text-[13px] font-medium text-white/80">Твой вопрос</span>
        <p className="mt-[6px] text-[20px] font-bold leading-[1.3] text-white">{ask.text}</p>
      </div>
      <button type="button" onClick={() => setShareOpen(true)} className="cta-purple">
        Поделиться
        <ArrowUpRight size={19} strokeWidth={2} aria-hidden />
      </button>
      <button type="button" onClick={copyLink} className="cta-dark -mt-[8px]">
        <Copy size={17} strokeWidth={1.8} className="text-purple-text" aria-hidden />
        Скопировать ссылку
      </button>

      <div className="mt-[4px] flex items-center justify-between">
        <span className="step">Ответы</span>
        <span className="text-[14px] text-purple-text">{answersLabel(answers.length)}</span>
      </div>
      {answers.length === 0 ? (
        <div className="card !py-[22px] text-center">
          <p className="muted">Пока нет ответов. Поделись ссылкой в сторис или с друзьями — ответы появятся здесь сразу.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {answers.map((x) => (
            <article key={x.id} className="card flex flex-col gap-[8px] !p-[16px]">
              <div className="flex items-center gap-[8px] text-[13px]">
                <span className="font-medium text-[#c9c6d1]">Анонимно</span>
                <span className="text-[#6f6b78]">·</span>
                <span className="text-[#8e8b97]">{timeAgo(x.createdAt)}</span>
                <span className="ml-auto flex gap-[4px]">
                  {!x.locked && (
                    <button type="button" aria-label="Поделиться в сторис" onClick={() => setStoryFor(x)} className="flex h-[34px] w-[38px] items-center justify-center rounded-[10px] text-purple-text active:bg-[#1f1d26]">
                      <Instagram size={17} strokeWidth={1.8} />
                    </button>
                  )}
                  <button type="button" aria-label="Ещё" onClick={() => setMenuFor(x)} className="flex h-[34px] w-[38px] items-center justify-center rounded-[10px] text-[#a1a1aa] active:bg-[#1f1d26]">
                    <MoreHorizontal size={18} />
                  </button>
                </span>
              </div>
              {x.locked ? (
                <button
                  type="button"
                  onClick={() => nav.push({ name: 'premium', source: 'answers_locked' })}
                  className="flex flex-col items-center gap-[8px] rounded-[12px] border border-dashed border-[#4a3b5c] bg-[#101013] px-[14px] py-[16px] text-center active:scale-[0.99]"
                >
                  <span className="select-none text-[16px] leading-[1.45] text-[#c9c6d1] blur-[5px]" aria-hidden>
                    Этот ответ скрыт, открой его с подпиской
                  </span>
                  <span className="flex items-center gap-[6px] text-[15px] font-medium text-purple-text">
                    <Lock size={15} strokeWidth={1.9} aria-hidden />
                    Открыть с Premium
                  </span>
                  <span className="text-[13px] text-[#8e8b97]">Бесплатно открыты первые 3 ответа</span>
                </button>
              ) : (
                <p className="whitespace-pre-line text-[16px] leading-[1.45]">{x.text}</p>
              )}
              {!x.locked && <AuthorSlot author={x.author} kind="ask" />}
            </article>
          ))}
        </div>
      )}

      <ShareLinkSheet open={shareOpen} onClose={() => setShareOpen(false)} link={ask.link} kind="ask" askText={ask.text} source={fresh ? 'ask_created' : 'ask_detail'} />
      <ActionSheet open={!!menuFor} onClose={() => setMenuFor(null)} title="Ответ" actions={menuFor ? answerActions(menuFor) : []} />
      <ActionSheet
        open={askMenu}
        onClose={() => setAskMenu(false)}
        title="Вопрос"
        actions={[
          {
            label: 'Удалить вопрос',
            icon: <Trash2 size={19} strokeWidth={1.8} />,
            danger: true,
            onClick: async () => {
              await api.deleteAsk(ask.id).catch(() => {});
              void refresh();
              toast.show('Вопрос удалён');
              nav.reset({ name: 'asks' });
            },
          },
        ]}
      />
      {storyFor && <AnswerStoriesSheet item={{ text: ask.text, answer: storyFor.text }} onClose={() => setStoryFor(null)} />}
    </Screen>
  );
}

/* ───────── Подписчик отвечает на чужой вопрос ───────── */

export function AskReplyScreen({ id }: { id: string }) {
  const nav = useNav();
  const toast = useToast();
  const { qa, questionnaires } = useAppState();
  const [ask, setAsk] = useState<PublicAsk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [step, setStep] = useState<'write' | 'choice'>('write');
  const [choice, setChoice] = useState<Anonymity>('anonymous');
  const key = useRef(newKey());
  const typed = useRef(false);

  useEffect(() => {
    api.openAsk(id).then(setAsk).catch((e) => setError(e instanceof ApiError ? e.code : 'network'));
  }, [id]);

  const home = () => nav.reset(qa?.askSlug || (qa?.asks ?? 0) > 0 || questionnaires.length ? { name: 'inbox' } : { name: 'start' });

  if (error)
    return (
      <MessageScreen
        icon={<MessageCircleQuestion size={26} strokeWidth={1.8} />}
        title={error === 'not_found' ? 'Вопрос не найден' : 'Не удалось загрузить'}
        text={error === 'not_found' ? 'Возможно, автор удалил этот вопрос.' : 'Проверь соединение и попробуй ещё раз.'}
        action={error === 'not_found' ? 'Открыть hush.' : 'Повторить'}
        onAction={error === 'not_found' ? home : () => window.location.reload()}
      />
    );
  if (!ask) return <LoadingScreen />;
  if (ask.answered && !ask.own)
    return (
      <MessageScreen
        icon={<Send size={26} strokeWidth={1.8} />}
        title="Ты уже ответил(а) 💜"
        text="На этот вопрос можно ответить один раз. Хочешь тоже получать анонимные ответы?"
        action="Создать свою ссылку"
        onAction={() => nav.setStack([{ name: 'sent', kind: 'answer' }])}
      />
    );

  const change = (v: string) => {
    if (!typed.current && v) {
      typed.current = true;
      track('question_typing_started', 'ask_answer');
    }
    setText(v);
  };
  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await api.answerAsk(ask.id, text.trim(), key.current, choice === 'reveal');
      haptic.notify('success');
      nav.setStack([{ name: 'sent', kind: 'answer', revealed: choice === 'reveal' }]);
    } catch (e) {
      setSending(false);
      if (e instanceof ApiError && e.code === 'already_answered') toast.show('Ты уже отвечал(а) на этот вопрос');
      else toast.show(e instanceof ApiError && e.code === 'rate_limited' ? 'Слишком много ответов подряд. Попробуй чуть позже' : 'Не удалось отправить. Попробуй ещё раз');
    }
  };

  if (step === 'choice')
    return (
      <Screen className="!gap-[16px]">
        <TopBar left={<BackArrow onClick={() => setStep('write')} />} right={<Logo />} />
        <h1 className="h1">Остаться анонимным? 👀</h1>
        <p className="muted -mt-[6px]">Выбери, сможет ли {ask.firstName} узнать, кто ответил.</p>
        <AnonymityChoice value={choice} onChange={setChoice} recipient={ask.firstName} />
        <Spacer min={6} />
        <button type="button" onClick={send} disabled={sending} className="cta-purple">
          {sending ? 'Отправляем…' : 'Отправить ответ'}
          {!sending && <Send size={18} strokeWidth={2} aria-hidden />}
        </button>
      </Screen>
    );

  return (
    <Screen className="!gap-[16px]">
      <TopBar left={nav.canGoBack ? <BackArrow onClick={nav.back} /> : undefined} right={nav.canGoBack ? <Logo /> : undefined} />
      {ask.own && <p className="small -mt-[6px] rounded-[12px] bg-[#1b1426] px-[12px] py-[8px] text-center text-purple-text">Так твой вопрос видят подписчики</p>}
      <div className="mt-[4px] flex items-center gap-[12px]">
        <Avatar name={ask.firstName} photoUrl={ask.photoUrl} size={48} />
        <div className="flex flex-col">
          <span className="text-[16px] font-semibold">{ask.firstName}</span>
          <span className="small">спрашивает тебя анонимно</span>
        </div>
      </div>
      <div className="rounded-[20px] bg-gradient-to-br from-[#7c3aed] to-[#a855f7] p-[18px]">
        <p className="text-[21px] font-bold leading-[1.3] text-white">{ask.text}</p>
      </div>
      <QaTextarea value={text} onChange={change} placeholder="Твой анонимный ответ…" max={1000} rows={5} label="Твой ответ" />
      <Spacer min={6} />
      <button type="button" onClick={() => setStep('choice')} disabled={!text.trim()} className="cta-purple">
        Продолжить
        <Send size={18} strokeWidth={2} aria-hidden />
      </button>
      <p className="small -mt-[6px] text-center">Дальше выберешь: остаться анонимным или нет</p>
    </Screen>
  );
}
