import { useState } from 'react';
import { motion } from 'motion/react';
import { CircleCheck, LockOpen } from 'lucide-react';
import { api } from '@/api';
import { config } from '@/config';
import { DEFAULT_PLAN, PLANS, planById, type PlanId } from '@/data/plans';
import { cn } from '@/lib/cn';
import { formatRub } from '@/lib/plural';
import { haptic, openExternal } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { BigIcon, CloseButton, Cta, Screen, Spacer, TopBar, useToast } from '@/ui';

const BENEFITS = [
  { title: 'Доступ ко всем ответам', text: 'Открой уже полученные и все новые ответы.' },
  { title: 'Безлимит на новые анкеты', text: 'Задавай друзьям новые вопросы сколько захочешь.' },
  { title: 'Придумывай свои вопросы', text: 'Спрашивай именно то, что давно хотел узнать.' },
  { title: 'Узнай, кто это написал 👀', text: 'Доступно только на годовом тарифе, если автор разрешил раскрыть профиль.' },
];

/**
 * 06 — Premium.
 * ВАЖНО: кнопки оплаты — визуальные заглушки. Никаких провайдеров, списаний и выдачи доступа.
 */
export function PremiumScreen() {
  const nav = useNav();
  const toast = useToast();
  const { questionnaires } = useAppState();
  const [plan, setPlan] = useState<PlanId>(DEFAULT_PLAN);
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (nav.canGoBack) nav.back();
    else nav.reset(questionnaires[0] ? { name: 'dashboard', qid: questionnaires[0].id } : { name: 'welcome' });
  };

  const unavailable = () => {
    haptic.notify('warning');
    toast.show('Оплата пока недоступна');
  };

  const checkout = async () => {
    setBusy(true);
    await api.startCheckout(plan);
    setBusy(false);
    unavailable();
  };

  const restore = async () => {
    await api.restorePurchases();
    unavailable();
  };

  const terms = () => {
    if (config.termsUrl) openExternal(config.termsUrl);
    else toast.show('Условия подписки появятся перед запуском оплаты');
  };

  return (
    <Screen className="!gap-[18px]">
      <TopBar right={<CloseButton onClick={close} />} />
      <BigIcon size={56}>
        <LockOpen size={26} strokeWidth={1.8} />
      </BigIcon>
      <div className="-mt-[4px] flex flex-col gap-[10px] text-center">
        <h1 className="h1">Узнай всё, что о тебе думают 👀</h1>
        <p className="muted !text-[16px]">Безлимит на все ответы и анкеты. Узнавай, кто что написал 😍</p>
      </div>

      <ul className="flex flex-col gap-[18px]">
        {BENEFITS.map((b, i) => (
          <motion.li
            key={b.title}
            className="flex items-start gap-[14px]"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 + i * 0.05, duration: 0.25 }}
          >
            <CircleCheck size={20} strokeWidth={1.8} className="mt-[1px] shrink-0 text-purple" aria-hidden />
            <div className="flex flex-col gap-[4px]">
              <span className="text-[17px] leading-[1.25]">{b.title}</span>
              <span className="text-[14px] leading-[1.35] text-[#9a97a3]">{b.text}</span>
            </div>
          </motion.li>
        ))}
      </ul>

      <div className="flex flex-col gap-[10px]" role="radiogroup" aria-label="Тариф">
        <div className="mb-[2px] mt-[2px] text-[17px] font-medium">Выбери подписку</div>
        {PLANS.map((p) => {
          const active = p.id === plan;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                haptic.select();
                setPlan(p.id);
              }}
              className={cn(
                'flex flex-col gap-[6px] rounded-[18px] border px-[12px] py-[14px] text-left transition-[background-color,border-color,box-shadow] duration-200',
                active ? 'border-purple bg-[#1d1429] shadow-[inset_0_0_0_1px_#a855f7]' : 'border-[#2a2930] bg-[#141318]',
              )}
            >
              <div className="flex items-center justify-between gap-[10px]">
                <span className="flex items-center gap-[12px] text-[17px] font-medium">
                  <span
                    className={cn(
                      'flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full transition-colors',
                      active ? 'border-2 border-purple-text' : 'bg-[#5d5a66]',
                    )}
                    aria-hidden
                  >
                    {active && <span className="h-[7px] w-[7px] rounded-full bg-purple-text" />}
                  </span>
                  {p.title}
                </span>
                <span className="text-[20px] font-medium">{formatRub(p.price)}</span>
              </div>
              <div className="flex items-center justify-between gap-[10px] text-[14px]">
                <span className="text-[#9a97a3]">{p.perMonth ? `${p.perMonth} ₽/мес` : p.caption}</span>
                {p.savings && <span className="text-green">Выгода {p.savings}%</span>}
              </div>
              {p.unlimitedReveals && (
                <div className="mt-[2px] flex items-center gap-[8px] text-[14px] text-purple-text">
                  <LockOpen size={15} strokeWidth={1.8} aria-hidden />
                  Безлимит на раскрытие авторов
                </div>
              )}
            </button>
          );
        })}
      </div>

      <Spacer />
      <Cta leading={<LockOpen size={20} strokeWidth={1.8} className="text-green" />} onClick={checkout} loading={busy}>
        Открыть всё за {formatRub(planById(plan).price)} 😍
      </Cta>
      <p className="muted !text-[14px] mx-auto max-w-[300px] text-center">Отменить подписку можно в любой момент в настройках профиля</p>
      <p className="small flex justify-center gap-[12px] text-center !text-[14px]">
        <button type="button" onClick={terms} className="underline underline-offset-[3px] active:opacity-60">
          Условия подписки
        </button>
        <span aria-hidden>·</span>
        <button type="button" onClick={restore} className="underline underline-offset-[3px] active:opacity-60">
          Восстановить покупку
        </button>
      </p>
    </Screen>
  );
}
