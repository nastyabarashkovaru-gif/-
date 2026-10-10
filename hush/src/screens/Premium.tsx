import { useState } from 'react';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { api } from '@/api';
import { config } from '@/config';
import { DEFAULT_PLAN, PLANS, planById, type PlanId } from '@/data/plans';
import { cn } from '@/lib/cn';
import { formatRub } from '@/lib/plural';
import { haptic, openExternal } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { CloseButton, Cta, Screen, Spacer, TopBar, useToast } from '@/ui';

const BENEFITS = [
  { title: 'Доступ ко всем ответам', text: 'Открой уже полученные и все новые ответы.' },
  { title: 'Безлимит на новые анкеты', text: 'Задавай друзьям новые вопросы сколько захочешь.' },
  { title: 'Придумывай свои вопросы', text: 'Спрашивай именно то, что давно хотел узнать.' },
  { title: 'Узнай, кто это написал 👀', text: 'Доступно только на годовом тарифе', green: true },
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
    <Screen fixed className="no-scrollbar !gap-[14px] !overflow-y-auto">
      <TopBar right={<CloseButton onClick={close} />} />
      <div className="bigicon !shrink-[1]" style={{ width: 55, height: 55, minHeight: 30 }} aria-hidden>
        <span className="text-[25px] leading-none">🔓</span>
      </div>
      <h2 className="shrink-0 h2 text-center">Узнай всё, что о тебе думают 👀</h2>
      <p className="shrink-0 muted text-center !text-[13px]">Все ответы и новые анкеты без ограничений. На годовом — узнавай авторов 😍</p>

      <ul className="shrink-0 flex flex-col gap-[14px]">
        {BENEFITS.map((b, i) => (
          <motion.li
            key={b.title}
            className="flex items-start gap-[12px]"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 + i * 0.05, duration: 0.25 }}
          >
            <Check size={18} strokeWidth={2.6} className={cn('mt-[1px] shrink-0', b.green ? 'text-green' : 'text-purple')} aria-hidden />
            <div>
              <b className="text-[14px]">{b.title}</b>
              <p className="mt-[5px] text-[12px] leading-[1.4] text-[#9993a4]">{b.text}</p>
            </div>
          </motion.li>
        ))}
      </ul>

      <div className="shrink-0 flex flex-col gap-[10px]" role="radiogroup" aria-label="Тариф">
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
                'flex items-center justify-between rounded-[13px] border px-[15px] py-[13px] text-left transition-[background-color,border-color,box-shadow] duration-200',
                active
                  ? 'border-[#b66dff] bg-[#1b1029] shadow-[inset_0_0_0_1px_#b66dff,0_0_0_1px_#513369]'
                  : 'border-[#37323c] bg-[#101013]',
              )}
            >
              <div>
                <b className="text-[15px]">
                  {p.title}
                  {p.id === 'year' && <span className="ml-[14px] text-[11px] text-green">Выгода {p.savings}%</span>}
                </b>
                <div className={cn('small', p.id === 'quarter' && '!text-green')}>{p.caption}</div>
              </div>
              <div className="text-right">
                <div className="text-[17px] font-extrabold">{formatRub(p.price)}</div>
                {p.perMonth && <div className="small">{p.perMonth} ₽/мес</div>}
              </div>
            </button>
          );
        })}
      </div>

      <Spacer />
      <Cta onClick={checkout} loading={busy}>
        🔓 Открыть всё за {formatRub(planById(plan).price)} 😍
      </Cta>
      <p className="shrink-0 small mx-auto max-w-[290px] text-center">Отменить подписку можно в любой момент в настройках профиля</p>
      <p className="shrink-0 small flex justify-center gap-[10px] text-center">
        <button type="button" onClick={terms} className="active:opacity-60">
          Условия подписки
        </button>
        <span aria-hidden>·</span>
        <button type="button" onClick={restore} className="active:opacity-60">
          Восстановить покупку
        </button>
      </p>
    </Screen>
  );
}
