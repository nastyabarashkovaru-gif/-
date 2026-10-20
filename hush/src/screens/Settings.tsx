import { useState, type ReactNode } from 'react';
import { BarChart3, ChevronRight, CreditCard, Crown, EyeOff, Gift, HeartCrack, ListChecks, Lock, LockOpen, MessageCircle, User } from 'lucide-react';
import { config } from '@/config';
import { PLAN_SUBTITLE, planById } from '@/data/plans';
import { cn } from '@/lib/cn';
import { formatRub, plural } from '@/lib/plural';
import { haptic, openExternal } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { api } from '@/api';
import { useNewQuestionnaire } from './Upsell';
import { BackArrow, BigIcon, Cta, Modal, Screen, Spacer, useToast } from '@/ui';

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
        {me.isAdmin && (
          <>
            <div className="divider" />
            <SettingRow icon={<BarChart3 size={21} strokeWidth={1.8} />} label="Статистика" onClick={() => nav.push({ name: 'admin' })} />
          </>
        )}
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
  const { entitlement, refresh, pricing } = useAppState();
  const plan = entitlement.plan ? planById(entitlement.plan) : null;

  const [busy, setBusy] = useState(false);
  /** Удерживающие окна перед отменой: предупреждение о стандартной цене → скидка −50% на следующий платёж */
  const [step, setStep] = useState<'none' | 'warning' | 'offer'>('none');
  const amount = entitlement.amount ?? plan?.price ?? 0;
  const discounted = Math.round(amount / 2);
  // Предупреждение честно, только если пользователь платит меньше обычной цены своего тарифа
  const standardPrice = entitlement.plan ? pricing.standard[entitlement.plan] : 0;
  // Окно 1 показываем всегда; строку «вернуться — уже без скидки» — только если это правда (скидка не постоянная)
  const showWarning = !!plan;
  const showPriceWarning = !!plan && !pricing.permanentOffer && !pricing.returning && amount < standardPrice;

  const startCancel = () => {
    if (showWarning) setStep('warning');
    else if (entitlement.retentionOfferAvailable) setStep('offer');
    else void cancelSubscription();
  };
  const afterWarning = () => {
    if (entitlement.retentionOfferAvailable) setStep('offer');
    else void cancelSubscription();
  };

  const acceptDiscount = async () => {
    setBusy(true);
    try {
      const result = await api.retentionDiscount();
      if (result.status === 'ok') {
        await refresh();
        setStep('none');
        haptic.notify('success');
        toast.show(`Готово! Следующий платёж — ${formatRub(discounted)} 💜`);
      } else {
        toast.show('Оплата пока недоступна');
      }
    } catch {
      toast.show('Не удалось применить скидку. Попробуй позже');
    } finally {
      setBusy(false);
    }
  };

  // Отмена — только через CloudPayments; состояние меняется после их ответа
  const cancelSubscription = async () => {
    setStep('none');
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
        <div className="h1 my-[18px]">{plan ? `${formatRub(amount)} / ${plan.periodLabel}` : 'Бесплатный тариф'}</div>
        <div className="muted">
          {!plan
            ? 'Узнавай, кто задал вопрос и кто ответил, и смотри все ответы 😍'
            : entitlement.autoRenew
              ? `Следующее списание: ${nextCharge}${
                  entitlement.nextChargeAmount && entitlement.nextChargeAmount !== amount
                    ? ` · ${formatRub(entitlement.nextChargeAmount)} со скидкой`
                    : ''
                }`
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
                onClick={startCancel}
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

      {/* Окно 1: жалко, что уходишь + предупреждение о стандартной цене */}
      <Modal open={step === 'warning'} onClose={() => setStep('none')} labelledBy="leave-title">
        <div className="card-purple flex flex-col gap-[14px] !px-[18px] !pb-[20px] !pt-[28px] text-center">
          <BigIcon size={64}>
            <HeartCrack size={28} strokeWidth={1.8} />
          </BigIcon>
          <h2 id="leave-title" className="h2">
            Жалко, что ты уходишь 😢
          </h2>
          <p className="muted">После окончания оплаченного периода ты потеряешь:</p>
          <ul className="flex flex-col gap-[8px] text-left text-[15px] leading-[1.35]">
            <li className="flex gap-[8px]"><EyeOff size={18} strokeWidth={1.8} className="mt-[1px] shrink-0 text-purple-text" aria-hidden />Кто тебя спросил и кто ответил — авторы снова скроются</li>
            <li className="flex gap-[8px]"><Lock size={18} strokeWidth={1.8} className="mt-[1px] shrink-0 text-purple-text" aria-hidden />Новые вопросы после 5-го и ответы после 3-го — под замком</li>
          </ul>
          {showPriceWarning && (
            <p className="muted">
              Если отменишь, а потом захочешь вернуться, подписка будет стоить уже{' '}
              <span className="whitespace-nowrap text-white">{plan ? `${formatRub(standardPrice)} / ${plan.periodLabel}` : ''}</span> — без скидки. Сейчас
              ты платишь <span className="whitespace-nowrap text-white">{formatRub(amount)}</span>.
            </p>
          )}
          <Cta onClick={() => setStep('none')} className="mt-[6px]">
            Остаться с Premium 💜
          </Cta>
          <button type="button" onClick={afterWarning} disabled={busy} className="mx-auto -mt-[4px] px-3 py-2 text-[15px] text-[#a1a1aa] active:opacity-60">
            Всё равно отменить
          </button>
        </div>
      </Modal>

      {/* Окно 2: последнее предложение — скидка 50% только на следующий платёж */}
      <Modal open={step === 'offer'} onClose={() => !busy && setStep('none')} labelledBy="offer-title">
        <div className="card-purple flex flex-col gap-[14px] !px-[18px] !pb-[20px] !pt-[28px] text-center">
          <BigIcon size={64}>
            <Gift size={28} strokeWidth={1.8} />
          </BigIcon>
          <h2 id="offer-title" className="h2">
            Мы не хотим тебя терять 💜
          </h2>
          <p className="muted">
            Следующий платёж — <span className="font-semibold text-white">{formatRub(discounted)}</span>{' '}
            <span className="line-through">{formatRub(amount)}</span>
          </p>
          <Cta onClick={acceptDiscount} loading={busy} className="mt-[6px]">
            Остаться со скидкой 😍
          </Cta>
          <button type="button" onClick={() => void cancelSubscription()} disabled={busy} className="mx-auto -mt-[4px] px-3 py-2 text-[15px] text-[#a1a1aa] active:opacity-60">
            Отменить подписку
          </button>
        </div>
      </Modal>
    </Screen>
  );
}

/** Мои анкеты */
export function MyQuestionnairesScreen() {
  const nav = useNav();
  const { questionnaires } = useAppState();
  const newQuestionnaire = useNewQuestionnaire('my_questionnaires');

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
      <Cta onClick={newQuestionnaire.onClick}>Задать новые вопросы 😍</Cta>
      {newQuestionnaire.modal}
    </Screen>
  );
}
