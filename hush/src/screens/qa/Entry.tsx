/**
 * HUSH 2.0: первый экран, «Твоя ссылка готова!», форма вопроса по чужой ссылке, «Отправлено».
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Check, Copy, Eye, Instagram, Link2, Loader2, MessageCircleQuestion, Send } from 'lucide-react';
import { api, ApiError, type PublicRecipient } from '@/api';
import { track } from '@/lib/analytics';
import { copyText } from '@/lib/share';
import { haptic, requestWriteAccess } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { BackArrow, BigIcon, LoadingScreen, Logo, MessageScreen, Screen, Spacer, TopBar, useToast } from '@/ui';
import { AnonymityChoice, Avatar, ChoiceCard, Chips, LinkStoriesSheet, newKey, QaTextarea, ShareLinkSheet, useEnsureLink, type Anonymity } from './common';

/* ───────── Первый экран нового пользователя ───────── */

export function StartScreen() {
  const nav = useNav();
  const toast = useToast();
  const ensureLink = useEnsureLink();
  const [busy, setBusy] = useState(false);

  const getLink = async () => {
    if (busy) return;
    setBusy(true);
    track('start_choice', 'link');
    try {
      await ensureLink('start');
      nav.setStack([{ name: 'inbox' }, { name: 'myLink' }]);
    } catch {
      toast.show('Не получилось создать ссылку. Попробуй ещё раз');
      setBusy(false);
    }
  };

  return (
    <Screen className="!gap-[16px]">
      <TopBar />
      <motion.div className="mt-[18px] flex flex-col gap-[12px]" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <h1 className="text-[32px] font-bold leading-[1.12] tracking-[-0.6px]">
          Узнай, что о тебе думают. <span className="text-purple">И что хотят спросить.</span>
        </h1>
        <p className="muted !text-[16px]">Получай анонимные вопросы от подписчиков и друзей, а также анонимные ответы о себе.</p>
      </motion.div>
      <Spacer min={8} />
      <motion.div className="flex flex-col gap-[12px]" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.1 }}>
        <ChoiceCard
          purple
          icon={<Link2 size={22} strokeWidth={1.9} />}
          title="Пусть меня спрашивают"
          text={busy ? 'Создаём ссылку…' : 'Получи личную ссылку и собирай анонимные вопросы от подписчиков.'}
          onClick={getLink}
        />
        <ChoiceCard
          icon={<MessageCircleQuestion size={22} strokeWidth={1.9} />}
          title="Получить ответ на свой вопрос"
          text="Например: «Какое впечатление я произвожу? Уверенная, застенчивая, холодная и недоступная? Только честно.»"
          onClick={() => {
            track('start_choice', 'ask');
            nav.setStack([{ name: 'asks' }, { name: 'createAsk' }]);
          }}
        />
      </motion.div>
    </Screen>
  );
}

/* ───────── «Твоя ссылка готова!» ───────── */

export function MyLinkScreen() {
  const nav = useNav();
  const toast = useToast();
  const { qa } = useAppState();
  const [shareOpen, setShareOpen] = useState(false);
  const [storiesOpen, setStoriesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = qa?.link ?? '';

  // Через секунду — карточка для сторис (один раз)
  useEffect(() => {
    if (!link) return;
    // Ключ по коду ссылки: новая ссылка — снова покажем карточку
    const key = `hush.linkStory.${qa?.askSlug}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      return;
    }
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(key, '1');
      } catch {
        /* приватный режим */
      }
      track('story_sheet_opened', 'link_auto');
      setStoriesOpen(true);
    }, 1000);
    return () => window.clearTimeout(t);
  }, [link, qa?.askSlug]);

  if (!qa?.askSlug) return <LoadingScreen />;

  const copy = async () => {
    if (!(await copyText(link))) return;
    haptic.notify('success');
    track('link_copied', 'my_link');
    setCopied(true);
    toast.show('Ссылка скопирована');
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Screen fixed>
      <TopBar left={<BackArrow onClick={() => (nav.canGoBack ? nav.back() : nav.reset({ name: 'inbox' }))} />} right={<Logo />} />
      <Spacer />
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 18 }}>
        <BigIcon size={64}>
          <Check size={28} strokeWidth={2} />
        </BigIcon>
      </motion.div>
      <div className="flex flex-col gap-[10px] text-center">
        <h1 className="h1">Твоя ссылка готова!</h1>
        <p className="muted !text-[16px]">Теперь любой сможет задать тебе вопрос анонимно.</p>
      </div>
      <button type="button" onClick={copy} className="card flex shrink-0 items-center gap-[10px] text-left active:opacity-70">
        <Link2 size={18} strokeWidth={1.8} className="shrink-0 text-purple" aria-hidden />
        <span className="min-w-0 flex-1 break-all text-[15px] text-purple-text">{link.replace(/^https?:\/\//, '')}</span>
        {copied ? <Check size={18} className="shrink-0 text-green" /> : <Copy size={18} strokeWidth={1.8} className="shrink-0 text-[#a1a1aa]" />}
      </button>
      <Spacer />
      <button type="button" onClick={() => setShareOpen(true)} className="cta-purple">
        Поделиться ссылкой
        <ArrowUpRight size={19} strokeWidth={2} aria-hidden />
      </button>
      <div className="-mt-[8px] flex shrink-0 gap-[10px]">
        <button type="button" onClick={copy} className="cta-dark flex-1">
          <Copy size={17} strokeWidth={1.8} className="text-purple-text" aria-hidden />
          Скопировать
        </button>
        <button
          type="button"
          onClick={() => {
            track('story_sheet_opened', 'link_button');
            setStoriesOpen(true);
          }}
          className="cta-dark flex-1"
        >
          <Instagram size={17} strokeWidth={1.8} className="text-purple-text" aria-hidden />
          Сторис
        </button>
      </div>
      <button
        type="button"
        onClick={() => nav.push({ name: 'askMe', slug: qa.askSlug! })}
        className="mx-auto -my-1 flex items-center gap-[6px] px-2 py-1 text-[15px] text-[#a1a1aa] active:opacity-60"
      >
        <Eye size={16} strokeWidth={1.8} aria-hidden />
        Посмотреть глазами подписчика
      </button>
      <ShareLinkSheet open={shareOpen} onClose={() => setShareOpen(false)} link={link} kind="personal" source="my_link" />
      <LinkStoriesSheet open={storiesOpen} onClose={() => setStoriesOpen(false)} link={link} kind="personal" />
    </Screen>
  );
}

/* ───────── Форма вопроса по личной ссылке ───────── */

const SUGGESTED = [
  'Что ты никогда не рассказывал(а) подписчикам?',
  'В кого ты сейчас влюблён(а)?',
  'Какой твой самый большой секрет?',
  'О чём ты больше всего жалеешь?',
  'Что тебя бесит в людях?',
];
const QUESTION_MAX = 300;

export function AskMeScreen({ slug }: { slug: string }) {
  const nav = useNav();
  const toast = useToast();
  const { qa, questionnaires } = useAppState();
  const [recipient, setRecipient] = useState<PublicRecipient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  // Шаг 2: остаться анонимным или разрешить узнать, кто спросил
  const [step, setStep] = useState<'write' | 'choice'>('write');
  const [choice, setChoice] = useState<Anonymity>('anonymous');
  const key = useRef(newKey());
  const typed = useRef(false);

  useEffect(() => {
    api.openRecipient(slug).then(setRecipient).catch((e) => setError(e instanceof ApiError ? e.code : 'network'));
  }, [slug]);

  const home = () => nav.reset(qa?.askSlug || (qa?.asks ?? 0) > 0 || questionnaires.length ? { name: 'inbox' } : { name: 'start' });

  if (error)
    return (
      <MessageScreen
        icon={<Link2 size={26} strokeWidth={1.8} />}
        title={error === 'not_found' ? 'Ссылка не найдена' : 'Не удалось загрузить'}
        text={error === 'not_found' ? 'Возможно, в ссылке опечатка. Попроси прислать её ещё раз.' : 'Проверь соединение и попробуй ещё раз.'}
        action={error === 'not_found' ? 'Открыть hush.' : 'Повторить'}
        onAction={error === 'not_found' ? home : () => window.location.reload()}
      />
    );
  if (!recipient) return <LoadingScreen />;

  const change = (v: string) => {
    if (!typed.current && v) {
      typed.current = true;
      track('question_typing_started', 'personal');
    }
    setText(v);
  };

  const send = async () => {
    const value = text.trim();
    if (!value) return;
    setSending(true);
    try {
      await api.sendQuestion(slug, value, key.current, choice === 'reveal');
      haptic.notify('success');
      // Чтобы пришёл пуш, когда ответят
      void requestWriteAccess().then((granted) => {
        if (granted) api.grantWriteAccess().catch(() => {});
      });
      nav.setStack([{ name: 'sent', kind: 'question', slug }]);
    } catch (e) {
      setSending(false);
      toast.show(e instanceof ApiError && e.code === 'rate_limited' ? 'Слишком много вопросов подряд. Попробуй чуть позже' : 'Не удалось отправить. Попробуй ещё раз');
    }
  };

  if (step === 'choice')
    return (
      <Screen className="!gap-[16px]">
        <TopBar left={<BackArrow onClick={() => setStep('write')} />} right={<Logo />} />
        <h1 className="h1">Остаться анонимным? 👀</h1>
        <p className="muted -mt-[6px]">Выбери, сможет ли {recipient.firstName} узнать, кто задал вопрос.</p>
        <div className="rounded-[16px] border border-[#2a2930] bg-[#141318] px-[16px] py-[12px] text-[15px] leading-[1.4] text-[#d6d3dc]">«{text.trim()}»</div>
        <AnonymityChoice value={choice} onChange={setChoice} recipient={recipient.firstName} />
        <Spacer min={6} />
        <button type="button" onClick={send} disabled={sending} className="cta-purple">
          {sending ? 'Отправляем…' : 'Отправить вопрос'}
          {!sending && <Send size={18} strokeWidth={2} aria-hidden />}
        </button>
      </Screen>
    );

  return (
    <Screen className="!gap-[16px]">
      <TopBar left={nav.canGoBack ? <BackArrow onClick={nav.back} /> : undefined} right={nav.canGoBack ? <Logo /> : undefined} />
      <div className="mt-[6px] flex flex-col items-center gap-[12px] text-center">
        <Avatar name={recipient.firstName} photoUrl={recipient.photoUrl} size={72} />
        <span className="text-[15px] font-medium text-[#c9c6d1]">{recipient.firstName}</span>
        <h1 className="h1">Задай мне вопрос анонимно</h1>
        <p className="muted !text-[16px] -mt-[4px]">Спроси то, что давно хотел узнать 🤫</p>
      </div>
      <QaTextarea value={text} onChange={change} placeholder="Напиши свой вопрос…" max={QUESTION_MAX} rows={4} label="Твой вопрос" />
      <Chips items={SUGGESTED} onPick={(t) => change(t)} />
      <Spacer min={6} />
      <button type="button" onClick={() => setStep('choice')} disabled={!text.trim()} className="cta-purple">
        Продолжить
        <Send size={18} strokeWidth={2} aria-hidden />
      </button>
      <p className="small -mt-[6px] text-center">Дальше выберешь: остаться анонимным или нет</p>
    </Screen>
  );
}

/* ───────── Отправлено + вирусный CTA ───────── */

export function SentScreen({ kind, slug }: { kind: 'question' | 'answer'; slug?: string }) {
  const nav = useNav();
  const toast = useToast();
  const { qa } = useAppState();
  const ensureLink = useEnsureLink();
  const [busy, setBusy] = useState(false);
  const hasLink = Boolean(qa?.askSlug);

  const create = async () => {
    if (hasLink) {
      nav.reset({ name: 'inbox' });
      return;
    }
    setBusy(true);
    track('guest_create_link', kind);
    try {
      await ensureLink('guest');
      nav.setStack([{ name: 'inbox' }, { name: 'myLink' }]);
    } catch {
      setBusy(false);
      toast.show('Не получилось создать ссылку. Попробуй ещё раз');
    }
  };

  return (
    <Screen fixed>
      <TopBar />
      <Spacer />
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 18 }}>
        <BigIcon>
          <Check size={28} strokeWidth={2} />
        </BigIcon>
      </motion.div>
      <h1 className="h1 text-center">{kind === 'question' ? 'Твой вопрос отправлен! 💜' : 'Твой ответ отправлен! 💜'}</h1>
      <p className="muted text-center">
        {kind === 'question'
          ? 'Это анонимно. Тебе ответят прямо в приложении.'
          : 'Это было анонимно — никто не узнает, что это ты.'}
      </p>
      <Spacer />
      {/* Одна большая кнопка без лишнего текста — понятный результат: тебе тоже начнут задавать вопросы */}
      <motion.button
        type="button"
        onClick={() => {
          haptic.tap('medium');
          void create();
        }}
        disabled={busy}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.35 }}
        className="cta-purple !min-h-[64px] shrink-0 !text-[18px] !font-semibold active:scale-[0.98]"
      >
        {busy ? <Loader2 size={22} className="animate-spin" aria-label="Загрузка" /> : hasLink ? 'Перейти к своим вопросам' : 'Хочу тоже получать вопросы 🤫'}
      </motion.button>
      {kind === 'question' && slug && (
        <button type="button" onClick={() => nav.setStack([{ name: 'askMe', slug }])} className="mx-auto -my-1 px-2 py-1 text-[15px] text-[#a1a1aa] active:opacity-60">
          Задать ещё вопрос
        </button>
      )}
    </Screen>
  );
}
