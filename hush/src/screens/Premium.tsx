import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CircleCheck, LockOpen, Timer } from 'lucide-react';
import { api, type UpsellSource } from '@/api';
import { config } from '@/config';
import { DEFAULT_PLAN, PLANS, SOLD_PLAN_IDS, type PlanId } from '@/data/plans';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/cn';
import { formatRub } from '@/lib/plural';
import { payWithCloudPayments } from '@/lib/cloudpayments';
import { haptic, openExternal } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { BigIcon, CloseButton, Cta, Screen, Spacer, TopBar, useToast } from '@/ui';

const PERIOD: Record<PlanId, string> = { week: 'неделю', month: 'месяц', quarter: '3 месяца', year: 'год' };

const BENEFITS = [
  { title: 'Узнай, кто задал вопрос 👀', text: 'Безлимит на «Узнать автора» — если автор разрешил показать свой профиль.', green: true },
  { title: 'Узнай, кто ответил на твой вопрос', text: 'Смотри профиль ответивших подписчиков, если они это разрешили.' },
  { title: 'Все вопросы и ответы без замков', text: 'Бесплатно открыты первые 5 вопросов тебе и 3 ответа на каждый твой вопрос. С Premium — все.' },
];

/**
 * 06 — Premium.
 * Оплата — виджет CloudPayments; заказ и сумму формирует сервер, доступ выдаётся
 * только по подписанному уведомлению CloudPayments (server/src/billing.ts).
 * В демо-режиме и без ключей CloudPayments кнопка показывает «Оплата пока недоступна».
 */
export function PremiumScreen({ source }: { source?: UpsellSource }) {
  const nav = useNav();
  const toast = useToast();
  const { refresh, pricing: initialPricing } = useAppState();
  const [plan, setPlan] = useState<PlanId>(DEFAULT_PLAN);
  const [busy, setBusy] = useState(false);
  const [pricing, setPricing] = useState(initialPricing);
  const price = (id: PlanId) => pricing.prices[id];
  const monthPrice = price('month');

  // Открытие тарифов запускает 3-часовое предложение (сервер запоминает время)
  useEffect(() => {
    track('paywall_opened', source ?? 'direct');
    api.startOffer().then(setPricing).catch(() => {});
  }, []);
  const left = useCountdown(pricing.offerEndsAt);
  // Время вышло — берём актуальные цены у сервера
  useEffect(() => {
    if (left === 0) api.startOffer().then(setPricing).catch(() => {});
  }, [left]);
  const months = (id: PlanId) => (id === 'week' ? 12 / 52 : id === 'month' ? 1 : id === 'quarter' ? 3 : 12);
  // Выгода относительно помесячной оплаты по текущей цене месяца
  const savings = (id: PlanId) => Math.round((1 - price(id) / (monthPrice * months(id))) * 100);
  const offerOn = pricing.offerEndsAt !== null && left !== 0 && monthPrice < pricing.standard.month;
  const discount = (id: PlanId) => Math.round((1 - price(id) / pricing.standard[id]) * 100);

  const close = () => {
    if (nav.canGoBack) nav.back();
    else nav.reset({ name: 'inbox' });
  };

  const unavailable = () => {
    haptic.notify('warning');
    toast.show('Оплата пока недоступна');
  };

  const checkout = async () => {
    setBusy(true);
    try {
      const result = await api.startCheckout(plan, source);
      if (result.status !== 'widget') {
        unavailable();
        return;
      }
      const outcome = await payWithCloudPayments(result.params);
      if (outcome.status === 'cancel') return;
      if (outcome.status === 'fail') {
        haptic.notify('error');
        toast.show('Оплата не прошла. Попробуй другую карту');
        return;
      }
      // Подписку включает сервер по уведомлению CloudPayments — экран поздравления сам дождётся подтверждения
      nav.reset({ name: 'premiumSuccess', pending: true });
    } catch {
      toast.show('Не удалось открыть оплату. Попробуй ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    const result = await api.restorePurchases().catch(() => null);
    if (result?.status === 'ok') {
      await refresh();
      toast.show('Подписка восстановлена 💜');
      close();
    } else if (result?.status === 'none') {
      toast.show('Активная подписка не найдена');
    } else {
      unavailable();
    }
  };

  const openDoc = (url: string) => {
    if (url) openExternal(new URL(url, window.location.origin).toString());
    else toast.show('Документ появится перед запуском оплаты');
  };

  return (
    <Screen className="!gap-[18px]">
      <TopBar right={<CloseButton onClick={close} />} />
      <BigIcon size={56}>
        <LockOpen size={26} strokeWidth={1.8} />
      </BigIcon>
      <div className="-mt-[4px] flex flex-col gap-[10px] text-center">
        <h1 className="h1">Узнай всё, что о тебе думают 👀</h1>
        <p className="muted !text-[16px]">Узнай, кто тебя спросил и кто ответил, и открой все вопросы и ответы 😍</p>
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
            <CircleCheck size={20} strokeWidth={1.8} className={cn('mt-[1px] shrink-0', b.green ? 'text-green' : 'text-purple')} aria-hidden />
            <div className="flex flex-col gap-[4px]">
              <span className="text-[17px] leading-[1.25]">{b.title}</span>
              <span className="text-[14px] leading-[1.35] text-[#9a97a3]">{b.text}</span>
            </div>
          </motion.li>
        ))}
      </ul>

      <div className="flex flex-col gap-[10px]" role="radiogroup" aria-label="Тариф">
        <div className="mb-[2px] mt-[2px] text-[17px] font-medium">Выбери тариф</div>
        {offerOn && (
          <div className="flex flex-col gap-[4px] rounded-[16px] border border-[#4a3a1a] bg-[#1f1910] px-[14px] py-[12px]">
            <div className="flex items-center justify-between gap-[10px] text-[15px] font-medium text-[#ffcf7a]">
              <span>Скидка при оплате в ближайшие 3 часа</span>
              <span className="flex shrink-0 items-center gap-[5px] tabular-nums">
                <Timer size={15} strokeWidth={2} aria-hidden />
                {left === null ? '3:00:00' : formatLeft(left)}
              </span>
            </div>
            <p className="text-[13px] leading-[1.35] text-[#c9b48a]">Цена закрепится за тобой: все следующие списания — по этой же цене, пока подписка активна.</p>
          </div>
        )}
        {PLANS.filter((p) => SOLD_PLAN_IDS.includes(p.id)).map((p) => {
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
                <span className="flex items-baseline gap-[8px]">
                  {offerOn && <s className="text-[15px] text-[#77737f]">{formatRub(pricing.standard[p.id])}</s>}
                  <span className="text-[20px] font-medium">{formatRub(price(p.id))}</span>
                </span>
              </div>
              <div className="flex items-center justify-between gap-[10px] text-[14px]">
                <span className="text-[#9a97a3]">{p.id === 'year' ? `≈ ${Math.round(price(p.id) / months(p.id))} ₽ в месяц` : p.caption}</span>
                {offerOn ? (
                  <span className="text-green">Скидка {discount(p.id)}%</span>
                ) : (
                  p.id === 'year' && <span className="text-green">Выгода {savings(p.id)}%</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <Spacer />
      <Cta leading={<LockOpen size={20} strokeWidth={1.8} className="text-green" />} onClick={checkout} loading={busy}>
        Открыть всё за {formatRub(price(plan))} 😍
      </Cta>
      <p className="muted !text-[14px] mx-auto max-w-[320px] text-center">
        Подписка продлевается автоматически: {formatRub(price(plan))} раз в {PERIOD[plan]}. Отменить подписку можно в любой момент в
        настройках профиля
      </p>
      <p className="small !text-[12px] -mt-[8px] text-center">
        Нажимая кнопку, ты принимаешь{' '}
        <button type="button" onClick={() => openDoc(config.termsUrl)} className="underline underline-offset-[2px]">
          оферту
        </button>{' '}
        и{' '}
        <button type="button" onClick={() => openDoc(config.privacyUrl)} className="underline underline-offset-[2px]">
          политику конфиденциальности
        </button>
      </p>
      <p className="small flex justify-center gap-[12px] text-center !text-[14px]">
        <button type="button" onClick={() => openDoc(config.termsUrl)} className="underline underline-offset-[3px] active:opacity-60">
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

/** Секунд до конца предложения: null — таймер не запущен, 0 — время вышло */
function useCountdown(endsAt: string | null): number | null {
  const calc = () => (endsAt ? Math.max(0, Math.floor((new Date(endsAt).getTime() - Date.now()) / 1000)) : null);
  const [left, setLeft] = useState(calc);
  useEffect(() => {
    setLeft(calc());
    if (!endsAt) return;
    const timer = window.setInterval(() => setLeft(calc()), 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);
  return left;
}

function formatLeft(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
