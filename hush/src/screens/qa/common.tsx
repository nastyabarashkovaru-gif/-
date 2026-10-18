/**
 * Общие элементы HUSH 2.0: нижняя панель, окно «Создать», шаринг ссылки, поле ввода, аватар.
 */
import { useCallback, useState, type ReactNode } from 'react';
import { Copy, Eye, EyeOff, Inbox, Instagram, Link2, Loader2, MessageCircleQuestion, Plus, Send, User } from 'lucide-react';
import { api, type RevealedIdentity, type RevealResult } from '@/api';
import { track } from '@/lib/analytics';
import { renderLinkCard } from '@/lib/qaCards';
import { copyText } from '@/lib/share';
import { haptic, openTelegramLink, requestWriteAccess, shareToStory } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import type { Route } from '@/nav/routes';
import { useAppState } from '@/state/AppState';
import { Modal, useToast } from '@/ui';
import { canvasToUrl, StoryDeckSheet, type StoryImage } from '../StoriesSheet';
import { cn } from '@/lib/cn';

/* ───────── Время ───────── */

export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 2 * 86400) return 'вчера';
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

export const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/* ───────── Аватар ───────── */

export function Avatar({ name, photoUrl, size = 64 }: { name: string; photoUrl?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  return photoUrl && !failed ? (
    <img src={photoUrl} alt="" onError={() => setFailed(true)} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-[#2a1f3d] font-semibold text-purple-text"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      aria-hidden
    >
      {(name || '?').trim().charAt(0).toUpperCase()}
    </span>
  );
}

/* ───────── Поле ввода с счётчиком ───────── */

export function QaTextarea({
  value,
  onChange,
  placeholder,
  max,
  rows = 4,
  autoFocus,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  max: number;
  rows?: number;
  autoFocus?: boolean;
  label: string;
}) {
  return (
    <div className="relative shrink-0">
      <textarea
        aria-label={label}
        value={value}
        autoFocus={autoFocus}
        maxLength={max}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full resize-none rounded-[16px] border border-[#3a2d4d] bg-[#141318] px-[16px] pb-[30px] pt-[14px] text-[17px] leading-[1.4] text-white placeholder:text-[#6f6b78] focus:border-purple focus:outline-none"
      />
      <span className="pointer-events-none absolute bottom-[10px] right-[14px] text-[12px] tabular-nums text-[#6f6b78]">
        {value.length}/{max}
      </span>
    </div>
  );
}

/** Готовые варианты: нажатие подставляет текст */
export function Chips({ items, onPick }: { items: string[]; onPick: (text: string) => void }) {
  return (
    <div className="flex shrink-0 flex-wrap gap-[8px]">
      {items.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => {
            haptic.select();
            onPick(t);
          }}
          className="rounded-[12px] border border-[#2a2930] bg-[#141318] px-[12px] py-[9px] text-left text-[14px] leading-[1.3] text-[#d6d3dc] active:scale-[0.98] active:border-purple"
        >
          {t}
        </button>
      ))}
    </div>
  );
}

/* ───────── Личная ссылка ───────── */

/** Создаёт постоянную ссылку (один раз), просит разрешение на уведомления, обновляет состояние */
export function useEnsureLink() {
  const { qa, refresh } = useAppState();
  return useCallback(
    async (source: string) => {
      if (qa?.link && qa.askSlug) return { slug: qa.askSlug, link: qa.link };
      const result = await api.createLink(source);
      // Разрешение нужно, чтобы бот присылал новые вопросы
      void requestWriteAccess().then((granted) => {
        if (granted) api.grantWriteAccess().catch(() => {});
      });
      await refresh();
      return result;
    },
    [qa, refresh],
  );
}

const SHARE_TEXT = {
  personal: 'Задай мне вопрос анонимно 🤫 Я не узнаю, кто спросил',
  ask: 'Ответь анонимно на мой вопрос 👀',
};

/**
 * Окно «Поделиться ссылкой»: сторис Instagram (карточка), сторис Telegram, копирование.
 * kind = personal — личная ссылка, ask — ссылка на свой вопрос (askText обязателен).
 */
export function ShareLinkSheet({
  open,
  onClose,
  link,
  kind,
  askText,
  source,
}: {
  open: boolean;
  onClose: () => void;
  link: string;
  kind: 'personal' | 'ask';
  askText?: string;
  source: string;
}) {
  const toast = useToast();
  const [stories, setStories] = useState(false);

  const [tgBusy, setTgBusy] = useState(false);
  const headline = kind === 'personal' ? 'Задай мне анонимный вопрос' : askText ?? '';

  /** Сторис в Telegram: та же карточка, сразу в редактор сторис */
  const telegramStory = async () => {
    haptic.tap();
    setTgBusy(true);
    try {
      const canvas = await renderLinkCard({ headline, link });
      const { url } = await api.uploadStory(canvas.toDataURL('image/png'));
      if (shareToStory(url, SHARE_TEXT[kind], { url: link, name: kind === 'personal' ? 'Задать вопрос' : 'Ответить анонимно' })) {
        track('story_shared', `${kind === 'personal' ? 'link' : 'ask'}_telegram_story`);
        onClose();
      } else toast.show('Обнови Telegram, чтобы публиковать сторис');
    } catch {
      toast.show('Не удалось открыть сторис. Попробуй ещё раз');
    } finally {
      setTgBusy(false);
    }
  };
  const copy = async () => {
    if (await copyText(link)) {
      haptic.notify('success');
      track('link_copied', `${kind}_${source}`);
      toast.show('Ссылка скопирована');
    }
    onClose();
  };

  return (
    <>
      <Modal open={open} onClose={onClose} labelledBy="share-title">
        <div className="card-purple flex flex-col gap-[12px] !px-[18px] !py-[22px]">
          <h2 id="share-title" className="h2 text-center">
            Поделиться ссылкой
          </h2>
          <p className="muted -mt-[4px] text-center">
            {kind === 'personal' ? 'Выложи ссылку в сторис — подписчики смогут задать тебе вопрос анонимно' : 'Выложи вопрос в сторис — подписчики ответят анонимно'}
          </p>
          <button
            type="button"
            onClick={() => {
              track('story_sheet_opened', `${kind}_${source}`);
              onClose();
              setStories(true);
            }}
            className="cta-purple mt-[4px]"
          >
            <Instagram size={19} strokeWidth={1.9} aria-hidden />
            Сторис в Instagram
          </button>
          <button type="button" onClick={telegramStory} disabled={tgBusy} className="cta-dark">
            {tgBusy ? <Loader2 size={18} className="animate-spin text-purple-text" aria-hidden /> : <Send size={18} strokeWidth={1.8} className="text-purple-text" aria-hidden />}
            Сторис в Telegram
          </button>
          <button type="button" onClick={copy} className="cta-dark">
            <Copy size={18} strokeWidth={1.8} className="text-purple-text" aria-hidden />
            Скопировать ссылку
          </button>
        </div>
      </Modal>
      <LinkStoriesSheet open={stories} onClose={() => setStories(false)} link={link} kind={kind} askText={askText} />
    </>
  );
}

/** Карточки «Задай мне вопрос анонимно» / «Ответь анонимно на мой вопрос» с QR */
export function LinkStoriesSheet({
  open,
  onClose,
  link,
  kind,
  askText,
}: {
  open: boolean;
  onClose: () => void;
  link: string;
  kind: 'personal' | 'ask';
  askText?: string;
}) {
  const render = useCallback(async () => {
    // Одна минималистичная карточка
    const headline = kind === 'personal' ? 'Задай мне анонимный вопрос' : askText ?? '';
    const out: StoryImage[] = [{ src: await canvasToUrl(await renderLinkCard({ headline, link })), alt: headline }];
    return out;
  }, [kind, link, askText]);
  return (
    <StoryDeckSheet
      key={`${kind}:${link}`}
      open={open}
      onClose={onClose}
      title={kind === 'personal' ? 'Карточка для сторис 🤫' : 'Позови ответить в сторис 💜'}
      subtitle={kind === 'personal' ? 'Поделись ссылкой в сторис, чтобы собрать вопросы' : 'Поделись вопросом в сторис, чтобы собрать ответы'}
      render={render}
      link={link}
      shareText={SHARE_TEXT[kind]}
      widgetName={kind === 'personal' ? 'Задать вопрос' : 'Ответить анонимно'}
      kind={kind === 'personal' ? 'link' : 'ask'}
    />
  );
}

/* ───────── Действия над вопросом / ответом ───────── */

export interface SheetAction {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick: () => void | Promise<void>;
}

export function ActionSheet({ open, onClose, title, actions }: { open: boolean; onClose: () => void; title: string; actions: SheetAction[] }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="actions-title">
      <div className="card flex flex-col gap-[4px] !p-[8px]">
        <p id="actions-title" className="small px-[12px] pb-[6px] pt-[8px] text-center">
          {title}
        </p>
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={async () => {
              onClose();
              await a.onClick();
            }}
            className={cn(
              'flex items-center gap-[12px] rounded-[12px] px-[14px] py-[14px] text-left text-[16px] active:bg-[#1f1d26]',
              a.danger ? 'text-[#ff7a8a]' : 'text-white',
            )}
          >
            {a.icon}
            {a.label}
          </button>
        ))}
        <button type="button" onClick={onClose} className="mt-[4px] rounded-[12px] px-[14px] py-[13px] text-[16px] text-[#a1a1aa] active:bg-[#1f1d26]">
          Отмена
        </button>
      </div>
    </Modal>
  );
}

/* ───────── Нижняя панель ───────── */

/** Три раздела: «Вопросы» (Мне задали / Я спросил(а)), большой «+» и «Профиль» */
const TABS: Array<{ name: 'inbox' | 'profile' | 'create'; label: string; icon: typeof Inbox }> = [
  { name: 'inbox', label: 'Вопросы', icon: MessageCircleQuestion },
  { name: 'create', label: 'Создать', icon: Plus },
  { name: 'profile', label: 'Профиль', icon: User },
];

/** Высота панели — экраны-вкладки добавляют такой отступ снизу */
export const TAB_BAR_SPACE = 'calc(84px + var(--safe-bottom))';

export function TabBar({ active }: { active: string }) {
  const nav = useNav();
  const { qa } = useAppState();
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-app items-end justify-around border-t border-[#1f1d26] bg-[rgba(0,0,0,0.92)] px-[8px] pt-[8px] backdrop-blur"
        style={{ paddingBottom: 'calc(8px + var(--safe-bottom))' }}
        aria-label="Разделы"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          if (t.name === 'create') {
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => {
                  haptic.tap('medium');
                  setCreateOpen(true);
                }}
                className="-mt-[14px] flex w-[96px] flex-col items-center gap-[4px] text-[11px] text-[#a1a1aa]"
                aria-label="Создать"
              >
                <span className="flex h-[56px] w-[56px] items-center justify-center rounded-full bg-gradient-to-br from-[#7c3aed] to-[#a855f7] text-white shadow-[0_6px_18px_rgba(124,58,237,0.45)]">
                  <Plus size={28} strokeWidth={2.2} />
                </span>
                {t.label}
              </button>
            );
          }
          // «Вопросы» подсвечены на обоих переключателях: «Мне задали» и «Я спросил(а)»
          const on = t.name === 'inbox' ? active === 'inbox' || active === 'asks' : active === t.name;
          const badge = t.name === 'inbox' ? (qa?.unanswered ?? 0) + (qa?.sentUnread ?? 0) : 0;
          return (
            <button
              key={t.name}
              type="button"
              aria-current={on ? 'page' : undefined}
              onClick={() => {
                if (on) return;
                haptic.select();
                nav.reset({ name: t.name } as Route);
              }}
              className={cn('relative flex w-[96px] flex-col items-center gap-[5px] pb-[2px] pt-[6px] text-[11px]', on ? 'text-purple-text' : 'text-[#8e8b97]')}
            >
              <Icon size={23} strokeWidth={on ? 2.1 : 1.8} />
              {t.label}
              {badge > 0 && (
                <span className="absolute right-[14px] top-[2px] min-w-[18px] rounded-full bg-purple px-[5px] text-center text-[11px] font-semibold leading-[18px] text-white">
                  {Math.min(badge, 99)}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

/** «Создать»: личная ссылка или свой вопрос */
export function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNav();
  const toast = useToast();
  const ensureLink = useEnsureLink();
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onClose={onClose} labelledBy="create-title">
      <div className="flex flex-col gap-[12px]">
        <h2 id="create-title" className="h2 px-[4px] text-center">
          Что хочешь сделать?
        </h2>
        <ChoiceCard
          purple
          icon={<Link2 size={22} strokeWidth={1.9} />}
          title="Пусть меня спрашивают"
          text="Получи личную ссылку и поделись ей с подписчиками"
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            track('start_choice', 'create_link');
            try {
              await ensureLink('create');
              onClose();
              nav.setStack([{ name: 'inbox' }, { name: 'myLink' }]);
            } catch {
              toast.show('Не получилось. Попробуй ещё раз');
            } finally {
              setBusy(false);
            }
          }}
        />
        <ChoiceCard
          icon={<MessageCircleQuestion size={22} strokeWidth={1.9} />}
          title="Задать свой вопрос"
          text="Задай подписчикам любой вопрос и получи анонимные ответы"
          onClick={() => {
            track('start_choice', 'create_ask');
            onClose();
            nav.setStack([{ name: 'asks' }, { name: 'createAsk' }]);
          }}
        />
      </div>
    </Modal>
  );
}

/** Большая полностью кликабельная карточка выбора сценария */
export function ChoiceCard({
  purple,
  icon,
  title,
  text,
  onClick,
}: {
  purple?: boolean;
  icon: ReactNode;
  title: string;
  text: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap('medium');
        onClick();
      }}
      className={cn(
        'flex w-full shrink-0 flex-col gap-[10px] rounded-[22px] p-[20px] text-left transition-transform duration-150 active:scale-[0.985]',
        purple
          ? 'bg-gradient-to-br from-[#7c3aed] to-[#a855f7] text-white shadow-[0_12px_32px_rgba(124,58,237,0.35)]'
          : 'border border-[#2a2930] bg-[#141318] text-white',
      )}
    >
      <span className={cn('flex h-[42px] w-[42px] items-center justify-center rounded-full', purple ? 'bg-white/20' : 'bg-[#2a1f3d] text-purple-text')}>
        {icon}
      </span>
      <span className="text-[21px] font-bold leading-[1.2]">{title}</span>
      <span className={cn('text-[15px] leading-[1.4]', purple ? 'text-white/85' : 'text-[#a1a1aa]')}>{text}</span>
    </button>
  );
}

/* ───────── Выбор анонимности отправителя ───────── */

export type Anonymity = 'anonymous' | 'reveal';

/** Как в анкетах: остаться анонимным или разрешить узнать, кто я */
export function AnonymityChoice({ value, onChange, recipient }: { value: Anonymity; onChange: (v: Anonymity) => void; recipient: string }) {
  const options: Array<{ id: Anonymity; title: string; text: string }> = [
    { id: 'anonymous', title: 'Да, остаться анонимным', text: 'Твой Telegram-профиль не будет раскрыт.' },
    { id: 'reveal', title: 'Разрешить узнать, кто я', text: `${recipient} сможет увидеть твой Telegram-профиль в рамках подписки.` },
  ];
  return (
    <div role="radiogroup" aria-label="Анонимность" className="flex shrink-0 flex-col gap-[12px]">
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              haptic.select();
              onChange(o.id);
            }}
            className={cn('text-left transition-colors duration-200', on ? 'card-purple' : 'card')}
          >
            <div className="flex items-center gap-[12px] text-[17px] font-medium">
              <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 border-white" aria-hidden>
                {on && <span className="h-[8px] w-[8px] rounded-full bg-white" />}
              </span>
              {o.title}
            </div>
            <div className="small !text-[14px] ml-[30px] mt-[8px]">{o.text}</div>
          </button>
        );
      })}
    </div>
  );
}

/* ───────── «Узнать автора» ───────── */

/**
 * Раскрытие автора: без согласия — «остался анонимным», без подписки — на тарифы,
 * с подпиской — профиль (безлимит).
 */
export function useReveal() {
  const nav = useNav();
  const toast = useToast();
  const [state, setState] = useState<null | { kind: 'anonymous' } | { kind: 'revealed'; identity: RevealedIdentity }>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, call: () => Promise<RevealResult>) => {
    if (busy) return;
    setBusy(key);
    track('reveal_clicked', key.split(':')[0]);
    try {
      const r = await call();
      if (r.status === 'anonymous') setState({ kind: 'anonymous' });
      else if (r.status === 'revealed') {
        haptic.notify('success');
        setState({ kind: 'revealed', identity: r.identity });
      } else nav.push({ name: 'premium', source: 'reveal' });
    } catch {
      toast.show('Не получилось. Попробуй ещё раз');
    } finally {
      setBusy(null);
    }
  };

  const modal = (
    <Modal open={state !== null} onClose={() => setState(null)} labelledBy="reveal-title">
      <div className="card-purple flex flex-col items-center gap-[14px] !px-[18px] !py-[26px] text-center">
        {state?.kind === 'revealed' ? (
          <>
            <Avatar name={state.identity.firstName} photoUrl={state.identity.photoUrl} size={84} />
            <h2 id="reveal-title" className="h2">
              {[state.identity.firstName, state.identity.lastName].filter(Boolean).join(' ')}
            </h2>
            {state.identity.username && <p className="muted -mt-[8px]">@{state.identity.username}</p>}
            <p className="small">Этот человек разрешил показать свой профиль 👀</p>
            {state.identity.username && (
              <button type="button" onClick={() => openTelegramLink(`https://t.me/${state.identity.username}`)} className="cta-purple mt-[4px]">
                Открыть профиль
              </button>
            )}
          </>
        ) : (
          <>
            <span className="flex h-[64px] w-[64px] items-center justify-center rounded-full bg-[#2a1f3d] text-purple-text">
              <EyeOff size={28} strokeWidth={1.8} />
            </span>
            <h2 id="reveal-title" className="h2">
              Автор остался анонимным
            </h2>
            <p className="muted">К сожалению, этот автор пожелал остаться анонимным. Попробуй узнать, кто написал другие 👀</p>
          </>
        )}
        <button type="button" onClick={() => setState(null)} className="mt-[2px] px-3 py-2 text-[15px] text-[#a1a1aa] active:opacity-60">
          Закрыть
        </button>
      </div>
    </Modal>
  );

  return { run, busy, modal };
}

/** Небольшая кнопка «Узнать автора 👀» */
export function RevealButton({ onClick, busy, label = 'Узнать автора' }: { onClick: () => void; busy?: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="cta-shine relative flex w-full items-center justify-center gap-[6px] overflow-hidden rounded-[12px] border border-[#3a2d4d] bg-[#141018] py-[10px] text-[14px] font-medium text-[#d6b3ff] active:scale-[0.98] disabled:opacity-60"
    >
      <Eye size={16} strokeWidth={1.9} aria-hidden />
      {busy ? 'Проверяем…' : `${label} 👀`}
    </button>
  );
}
