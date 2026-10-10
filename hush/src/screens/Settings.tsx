import { useState, type ReactNode } from 'react';
import { ChevronRight, CreditCard, Crown, ListChecks, LockOpen, MessageCircle, User } from 'lucide-react';
import { config } from '@/config';
import { PLAN_SUBTITLE, planById } from '@/data/plans';
import { cn } from '@/lib/cn';
import { formatRub, plural } from '@/lib/plural';
import { haptic, openExternal } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { api } from '@/api';
import { BackArrow, BigIcon, Cta, Screen, Spacer, useToast } from '@/ui';

function PageHeader({ title }: { title: string }) {
  const nav = useNav();
  return (
    <header className="top !justify-start">
      <BackArrow onClick={() => nav.back()} />
      <h1 className="ml-[16px] text-[22px] font-bold">{title}</h1>
    </header>
  );
}

const Status = ({ active }: { active: boolean }) => (
  <span className={cn('text-[14px]', active ? 'text-green' : 'text-small')}>{active ? 'Активна' : 'Не активна'}</span>
);

/** Метка демо-состояния подписки — не от платёжного провайдера */
const DemoNote = () => <p className="small -mt-[4px]">Демо-режим: оплата не подключена</p>;

/** 10 — настройки */
export function SettingsScreen() {
  const nav = useNav();
  const { me, entitlement } = useAppState();
  const plan = entitlement.plan;
  const name = [me.firstName, me.lastName].filter(Boolean).join(' ');

  const support = () => openExternal(config.supportUrl || `https://t.me/${config.botUsername}`);

  return (
    <Screen>
      <PageHeader title="Настройки" />
      <div className="flex items-center gap-[15px]">
        <BigIcon size={54} className="!mx-0 overflow-hidden">
          {me.photoUrl ? <img src={me.photoUrl} alt="" className="h-full w-full object-cover" /> : <User size={22} strokeWidth={1.6} />}
        </BigIcon>
        <div className="min-w-0">
          <b className="block truncate">{name || 'Мой профиль'}</b>
          <div className="small mt-[5px] truncate">{me.username ? `@${me.username} · Telegram-аккаунт` : 'Telegram-аккаунт'}</div>
        </div>
      </div>

      <div className="card flex flex-col gap-[11px]">
        <div className="flex items-start justify-between">
          <b className="flex items-center gap-[7px]">
            <Crown size={19} strokeWidth={1.8} className="text-purple" aria-hidden /> HUSH Premium
          </b>
          <Status active={!!plan} />
        </div>
        <div className="muted">{plan ? PLAN_SUBTITLE[plan] : 'Бесплатный тариф'}</div>
        {entitlement.demo && <DemoNote />}
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            nav.push(plan ? { name: 'subscription' } : { name: 'premium' });
          }}
          className="flex items-center justify-center gap-[12px] rounded-[14px] bg-[#1f1d26] p-[14px] text-center text-[16px] active:opacity-70"
        >
          {plan ? 'Управлять подпиской' : 'Оформить подписку'}
          <ChevronRight size={14} strokeWidth={2} aria-hidden />
        </button>
      </div>

      <nav className="card">
        <SettingRow icon={<ListChecks size={21} strokeWidth={1.8} />} label="Мои анкеты" onClick={() => nav.push({ name: 'myQuestionnaires' })} />
        <div className="divider" />
        <SettingRow icon={<CreditCard size={21} strokeWidth={1.8} />} label="Подписка и платежи" onClick={() => nav.push({ name: 'subscription' })} />
        <div className="divider" />
        <SettingRow icon={<MessageCircle size={21} strokeWidth={1.8} />} label="Поддержка" onClick={support} />
      </nav>

      <Spacer />
      <p className="small text-center">HUSH · Версия {config.version}</p>
    </Screen>
  );
}

function SettingRow({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      className="flex min-h-[52px] w-full items-center gap-[14px] py-[13px] text-left text-[17px] active:opacity-60"
    >
      <span className="text-purple-menu" aria-hidden>
        {icon}
      </span>
      {label}
      <ChevronRight size={18} strokeWidth={1.8} className="ml-auto text-[#77737f]" aria-hidden />
    </button>
  );
}

/** 10b — моя подписка */
export function SubscriptionScreen() {
  const nav = useNav();
  const toast = useToast();
  const { entitlement, refresh } = useAppState();
  const plan = entitlement.plan ? planById(entitlement.plan) : null;

  const [busy, setBusy] = useState(false);

  // Отмена — только через CloudPayments; состояние меняется после их ответа
  const cancelSubscription = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.setAutoRenew(false);
      if (result.status === 'ok') {
        await refresh();
        haptic.notify('success');
        toast.show('Подписка отменена. Premium работает до конца оплаченного периода');
      } else {
        haptic.notify('warning');
        toast.show('Оплата пока недоступна');
      }
    } catch {
      toast.show('Не удалось отменить подписку. Попробуй позже');
    } finally {
      setBusy(false);
    }
  };

  const nextCharge = entitlement.renewsAt
    ? new Date(entitlement.renewsAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'дата из платёжной системы';

  return (
    <Screen>
      <PageHeader title="Моя подписка" />
      <div className="card-purple">
        <div className="flex items-start justify-between">
          <b>{plan ? plan.settingsTitle : 'HUSH Premium'}</b>
          <Status active={!!plan} />
        </div>
        <div className="h1 my-[18px]">{plan ? `${formatRub(plan.price)} / ${plan.periodLabel}` : 'Бесплатный тариф'}</div>
        <div className="muted">
          {!plan
            ? 'Все ответы и новые анкеты без ограничений. На годовом — узнавай авторов 😍'
            : entitlement.autoRenew
              ? `Следующее списание: ${nextCharge}`
              : entitlement.renewsAt
                ? `Действует до ${nextCharge}`
                : 'Без автопродления'}
        </div>
        {entitlement.demo && plan && <p className="small mt-[8px]">Демо-режим: оплата не подключена</p>}
      </div>

      {plan ? (
        <>
          {entitlement.autoRenew ? (
            <>
              <p className="muted">Отменить подписку можно в любой момент в настройках профиля.</p>
              <button
                type="button"
                onClick={cancelSubscription}
                disabled={busy}
                className="small -mt-[8px] self-start underline underline-offset-[3px] active:opacity-60 disabled:opacity-40"
              >
                Отменить подписку
              </button>
            </>
          ) : (
            <p className="muted">
              Автопродление выключено — новых списаний не будет.
              {entitlement.renewsAt ? ` Premium действует до ${nextCharge}.` : ''}
            </p>
          )}
        </>
      ) : (
        <Cta leading={<LockOpen size={20} strokeWidth={1.8} className="text-green" />} onClick={() => nav.push({ name: 'premium' })}>
          Открыть всё 😍
        </Cta>
      )}

      <Spacer />
      <button type="button" onClick={() => nav.back()} className="cta-dark">
        Назад к настройкам
      </button>
    </Screen>
  );
}

/** Мои анкеты */
export function MyQuestionnairesScreen() {
  const nav = useNav();
  const { questionnaires, isPremium } = useAppState();

  return (
    <Screen>
      <PageHeader title="Мои анкеты" />
      {questionnaires.length === 0 ? (
        <p className="muted">У тебя пока нет анкет.</p>
      ) : (
        <div className="flex flex-col gap-[10px]">
          {questionnaires.map((q) => {
            const date = new Date(q.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
            const n = q.respondentCount;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => nav.push({ name: 'dashboard', qid: q.id })}
                className="card flex items-center gap-[13px] text-left active:opacity-70"
              >
                <div className="min-w-0 flex-1">
                  <b className="block text-[14px]">Анкета от {date}</b>
                  <div className="small mt-[3px] truncate">{q.questions[0]?.text}</div>
                  <div className={cn('mt-[8px] text-[14px] font-medium', n >= 5 ? 'text-green' : 'text-purple-text')}>
                    {n >= 5 ? `Ответы открыты · ${n} ${plural(n, ['ответ', 'ответа', 'ответов'])}` : `${n} из 5 ответов`}
                  </div>
                </div>
                <ChevronRight size={14} strokeWidth={2} className="shrink-0 text-[#777]" aria-hidden />
              </button>
            );
          })}
        </div>
      )}
      <Spacer />
      <Cta onClick={() => nav.push(isPremium || questionnaires.length === 0 ? { name: 'questions' } : { name: 'premium' })}>
        Задать новые вопросы 😍
      </Cta>
    </Screen>
  );
}
