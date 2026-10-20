/**
 * HUSH 2.0: «Профиль» — личная ссылка, активность, Premium, настройки, поддержка.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Archive, ArrowUpRight, ChevronRight, Copy, CreditCard, Crown, FlaskConical, MessageCircle } from 'lucide-react';
import { api, usingMock, type Activity } from '@/api';
import { config } from '@/config';
import { PLAN_SUBTITLE } from '@/data/plans';
import { track } from '@/lib/analytics';
import { copyText } from '@/lib/share';
import { haptic, openExternal } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { Screen, TopBar, useToast } from '@/ui';
import { Avatar, ShareLinkSheet, TAB_BAR_SPACE, useEnsureLink } from './common';

export function ProfileScreen() {
  const nav = useNav();
  const toast = useToast();
  const { me, qa, entitlement, questionnaires } = useAppState();
  const ensureLink = useEnsureLink();
  const [activity, setActivity] = useState<Activity | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    api.activity().then(setActivity).catch(() => {});
  }, []);

  const name = [me.firstName, me.lastName].filter(Boolean).join(' ') || 'Ты';
  const share = async () => {
    if (!qa?.link) {
      try {
        await ensureLink('profile');
      } catch {
        toast.show('Не получилось создать ссылку. Попробуй ещё раз');
        return;
      }
    }
    setShareOpen(true);
  };
  const copy = async () => {
    if (qa?.link && (await copyText(qa.link))) {
      haptic.notify('success');
      track('link_copied', 'profile');
      toast.show('Ссылка скопирована');
    }
  };
  const support = () => {
    if (config.supportUrl) openExternal(config.supportUrl);
    else toast.show('Поддержка скоро появится');
  };

  return (
    <Screen className="!gap-[16px]">
      <div style={{ paddingBottom: TAB_BAR_SPACE }} className="flex flex-col gap-[16px]">
        <TopBar />
        <div className="mt-[4px] flex items-center gap-[14px]">
          <Avatar name={name} photoUrl={me.photoUrl} size={64} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[21px] font-bold">{name}</span>
            {me.username && <span className="small">@{me.username}</span>}
          </div>
        </div>

        <div className="card-purple flex flex-col gap-[12px] !p-[16px]">
          <span className="step !text-purple-text">Ссылка для друзей и подписчиков</span>
          <p className="-mt-[4px] text-[15px] leading-[1.4]">Отправь её друзьям или выложи в сторис — по ней тебе смогут задавать анонимные вопросы.</p>
          {qa?.link ? (
            <button type="button" onClick={copy} className="flex items-center gap-[8px] text-left active:opacity-70">
              <span className="min-w-0 flex-1 break-all text-[14px] text-purple-text">{qa.link.replace(/^https?:\/\//, '')}</span>
              <Copy size={17} strokeWidth={1.8} className="shrink-0 text-[#a1a1aa]" aria-label="Скопировать" />
            </button>
          ) : (
            <p className="muted">Ссылки пока нет — создай её одним нажатием.</p>
          )}
          <button type="button" onClick={share} className="cta-purple">
            {qa?.link ? 'Поделиться ссылкой' : 'Получить ссылку'}
            <ArrowUpRight size={19} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-[10px]">
          <Stat value={activity?.received} label="вопросов получено" />
          <Stat value={activity?.answered} label="ответов дано" />
          <Stat value={activity?.asks} label="своих вопросов" />
          <Stat value={activity?.askAnswers} label="ответов на них" />
        </div>

        <button
          type="button"
          onClick={() => nav.push(entitlement.plan ? { name: 'subscription' } : { name: 'premium' })}
          className="card flex items-center gap-[12px] !p-[16px] text-left active:scale-[0.99]"
        >
          <span className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-[#2a1f3d] text-purple-text">
            <Crown size={20} strokeWidth={1.8} />
          </span>
          <span className="flex flex-1 flex-col">
            <span className="text-[16px] font-semibold">HUSH Premium</span>
            <span className="small">{entitlement.plan ? `${PLAN_SUBTITLE[entitlement.plan]} · активна` : 'Не активна'}</span>
          </span>
          <ChevronRight size={18} className="text-[#6f6b78]" aria-hidden />
        </button>

        <nav className="card !py-[4px]">
          <Row icon={<CreditCard size={20} strokeWidth={1.8} />} label="Подписка и платежи" onClick={() => nav.push({ name: 'subscription' })} />
          {questionnaires.length > 0 && (
            <>
              <div className="divider" />
              <Row icon={<Archive size={20} strokeWidth={1.8} />} label="Анкеты из прошлой версии" onClick={() => nav.push({ name: 'myQuestionnaires' })} />
            </>
          )}
          <div className="divider" />
          <Row icon={<MessageCircle size={20} strokeWidth={1.8} />} label="Поддержка" onClick={support} />
          {me.demoAccess && !usingMock && (
            <>
              <div className="divider" />
              <Row icon={<FlaskConical size={20} strokeWidth={1.8} />} label="Демо-режим: все экраны" onClick={() => window.location.assign('/demo/')} />
            </>
          )}
        </nav>
        <p className="small text-center">HUSH · Версия 2.0</p>
      </div>
      {qa?.link && <ShareLinkSheet open={shareOpen} onClose={() => setShareOpen(false)} link={qa.link} kind="personal" source="profile" />}
    </Screen>
  );
}

function Stat({ value, label }: { value?: number; label: string }) {
  return (
    <div className="card flex flex-col gap-[2px] !p-[14px]">
      <span className="text-[24px] font-bold tabular-nums">{value ?? '—'}</span>
      <span className="small">{label}</span>
    </div>
  );
}

function Row({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      className="flex w-full items-center gap-[14px] py-[14px] text-left text-[16px] active:opacity-60"
    >
      <span className="text-purple-text">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight size={16} className="text-[#6f6b78]" aria-hidden />
    </button>
  );
}
