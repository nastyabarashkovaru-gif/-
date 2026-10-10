import { Eye, Info, MessageSquarePlus, ShieldCheck, Unlock } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader, BottomBar, BottomSheet, PricingCard, PrimaryButton, Screen, SecondaryButton } from '@/components/ui';
import { planById, PLANS, RECOMMENDED_LABEL, RECOMMENDED_PLAN, REVEAL_PRICE, type PlanId } from '@/data/pricing';
import { formatPrice } from '@/lib/format';
import { useBack } from '@/lib/useBack';
import { useAppState } from '@/state/AppState';

const FEATURES = [
  { icon: Unlock, text: 'Все скрытые ответы — сразу' },
  { icon: Eye, text: 'Новые ответы открываются автоматически' },
  { icon: MessageSquarePlus, text: 'Новые анкеты со своими вопросами' },
];

/** Имитация оплаты: в прототипе никаких реальных списаний. */
const DEMO_PAYMENT_MS = 1400;

export function PaywallScreen() {
  const navigate = useNavigate();
  const back = useBack('/home');
  const { purchase } = useAppState();
  const [selected, setSelected] = useState<PlanId>(RECOMMENDED_PLAN);
  const [paying, setPaying] = useState(false);
  const [revealInfoOpen, setRevealInfoOpen] = useState(false);
  const plan = planById(selected);

  const onPay = () => {
    setPaying(true);
    window.setTimeout(() => {
      purchase(selected);
      navigate('/home', { replace: true, state: { justPurchased: true } });
    }, DEMO_PAYMENT_MS);
  };

  return (
    <Screen>
      <AppHeader onBack={paying ? undefined : back} showLogo={false} />

      <div className="px-gutter pt-1">
        <h1 className="font-display text-[26px] font-bold leading-[32px] tracking-[-0.02em]">
          Открой всё, что о тебе написали
        </h1>
        <p className="mt-2 text-[15px] leading-[22px] text-muted">Неограниченный доступ ко всем ответам — включая новые.</p>

        <ul className="mt-5 space-y-2.5">
          {FEATURES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-[15px]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-surface2">
                <Icon size={16} className="text-accentSoft" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>

      <div role="radiogroup" aria-label="Тариф" className="space-y-2.5 px-gutter pt-6">
        {PLANS.map((p) => (
          <PricingCard
            key={p.id}
            title={p.title}
            description={p.description}
            price={formatPrice(p.price)}
            perMonth={p.months > 1 ? `≈ ${formatPrice(Math.round(p.price / p.months))} в месяц` : undefined}
            badge={p.id === RECOMMENDED_PLAN ? RECOMMENDED_LABEL : undefined}
            selected={selected === p.id}
            onSelect={() => !paying && setSelected(p.id)}
            footer={
              p.includesReveal ? (
                <button
                  type="button"
                  onClick={() => setRevealInfoOpen(true)}
                  className="-my-2 flex min-h-touch items-center gap-1.5 text-left text-[13px] leading-[18px] text-accentSoft"
                >
                  <Info size={14} className="shrink-0" />
                  Автор раскрывается, только если сам разрешил
                </button>
              ) : undefined
            }
          />
        ))}
      </div>

      <p className="px-gutter pt-4 text-[12px] leading-[17px] text-[#71717A]">
        Подписка продлевается автоматически в конце периода по той же цене. Отключить автопродление можно в любой момент в
        настройках — доступ сохранится до конца оплаченного срока.
      </p>

      <BottomBar>
        <PrimaryButton loading={paying} loadingLabel="Ждём подтверждения" onClick={onPay}>
          Продолжить — {formatPrice(plan.price)}
        </PrimaryButton>
      </BottomBar>

      <BottomSheet
        open={revealInfoOpen}
        onClose={() => setRevealInfoOpen(false)}
        title="Как работает «Узнать, кто это написал»"
        footer={<SecondaryButton onClick={() => setRevealInfoOpen(false)}>Понятно</SecondaryButton>}
      >
        <div className="space-y-4 pt-2 text-[15px] leading-[22px] text-[#D4D4D8]">
          <p>
            Перед отправкой ответов каждый друг сам выбирает: остаться анонимным или разрешить показать свой Telegram-профиль.
          </p>
          <div className="flex gap-3 rounded-card border border-border bg-surface2 p-4">
            <ShieldCheck size={20} className="mt-0.5 shrink-0 text-accentSoft" />
            <p className="text-[14px] leading-5 text-muted">
              Узнать автора можно только у тех ответов, где он дал согласие. Анонимные ответы останутся анонимными — даже с
              годовой подпиской.
            </p>
          </div>
          <p className="text-[14px] leading-5 text-muted">
            С годовым тарифом раскрытие таких авторов не ограничено. С тарифами на 1 и 3 месяца — {formatPrice(REVEAL_PRICE)} за
            каждого автора.
          </p>
        </div>
      </BottomSheet>
    </Screen>
  );
}
