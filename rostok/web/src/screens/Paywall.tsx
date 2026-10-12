import { useEffect, useState } from 'react';
import { MiniGarden } from '../art/Scenes';
import { IconCheck } from '../art/icons';
import { ApiError, api, track } from '../api/client';
import type { Plan, PublicConfig, SubscriptionState } from '../api/types';
import { Button, Sheet, cx, useToast } from '../ui/kit';
import { inTelegram, openInvoice } from '../lib/telegram';
import { Legal } from './Legal';

/** Paywall: тарифы и условия приходят с сервера; доступ открывается только после серверного подтверждения оплаты. */
export function Paywall({ config, returning, onPaid }: { config: PublicConfig; returning: boolean; onPaid: () => Promise<void> }) {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [sel, setSel] = useState<string>('month');
  const [busy, setBusy] = useState(false);
  const [mock, setMock] = useState<{ intentId: string; plan: Plan } | null>(null);
  const [legal, setLegal] = useState(false);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    track('paywall_view', { returning });
    api('POST', '/onboarding', { paywallSeen: true }).catch(() => {});
    api<{ plans: Plan[] }>('GET', '/subscription/plans').then((r) => {
      setPlans(r.plans);
      if (!r.plans.some((p) => p.id === 'month') && r.plans[0]) setSel(r.plans[0].id);
    }).catch(() => toast('Не удалось загрузить тарифы', 'error'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = plans?.find((p) => p.id === sel);

  /** Ждём подтверждения от сервера (вебхук Telegram может прийти с задержкой). */
  const waitForAccess = async () => {
    setWaiting(true);
    for (let i = 0; i < 20; i++) {
      const s = await api<SubscriptionState>('GET', '/subscription').catch(() => null);
      if (s?.access) { await onPaid(); return; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    setWaiting(false);
    toast('Оплата ещё обрабатывается. Мы откроем сад, как только Telegram подтвердит платёж.', 'info');
  };

  const buy = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await api<{ kind: string; url?: string; intentId: string }>('POST', '/subscription/checkout', { planId: plan.id });
      if (r.kind === 'mock') { setMock({ intentId: r.intentId, plan }); return; }
      if (!inTelegram()) { toast('Оплата доступна внутри Telegram', 'error'); return; }
      const status = await openInvoice(r.url!);
      if (status === 'paid' || status === 'pending') await waitForAccess();
      else if (status === 'failed') toast('Платёж не прошёл. Попробуй ещё раз.', 'error');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не получилось начать оплату', 'error');
    } finally {
      setBusy(false);
    }
  };

  const confirmMock = async () => {
    if (!mock) return;
    setBusy(true);
    try {
      await api('POST', '/subscription/mock/confirm', { intentId: mock.intentId });
      setMock(null);
      await onPaid();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 overflow-y-auto bg-white pt-safe pb-safe">
      <div className="mx-auto max-w-[520px] px-5">
        <div className="-mx-2 mt-1"><MiniGarden levels={[10, 6, 14, 8, 12, 4]} /></div>
        <h1 className="mt-1 text-center text-[27px] font-bold leading-tight">{returning ? 'Твой сад сохранён и ждёт' : config.paywall.title}</h1>
        <p className="mx-auto mt-2 max-w-[380px] text-center text-[15px] leading-relaxed text-ink-soft">
          {returning ? 'Все деревья, уровни и капли на месте. Продли доступ — и продолжай с того же места.' : config.paywall.subtitle}
        </p>
        <ul className="mt-5 space-y-2.5">
          {config.paywall.bullets.map((b) => (
            <li key={b} className="flex items-start gap-3 text-[15px] text-ink">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-leaf-soft text-leaf-deep"><IconCheck size={15} strokeWidth={2.6} /></span>
              {b}
            </li>
          ))}
        </ul>

        <div className="mt-6 space-y-3" role="radiogroup" aria-label="Тариф">
          {!plans && [0, 1].map((i) => <div key={i} className="skeleton h-[84px] rounded-[20px]" />)}
          {plans?.map((p) => (
            <button key={p.id} role="radio" aria-checked={sel === p.id} onClick={() => setSel(p.id)}
              className={cx('flex w-full items-center gap-4 rounded-[20px] p-4 text-left ring-1 transition-all', sel === p.id ? 'bg-leaf-soft/70 ring-2 ring-leaf-deep' : 'bg-white ring-ink-line')}>
              <span className={cx('grid h-6 w-6 shrink-0 place-items-center rounded-full border-2', sel === p.id ? 'border-leaf-deep bg-leaf-deep' : 'border-ink-line')}>
                {sel === p.id && <span className="h-2.5 w-2.5 rounded-full bg-white" />}
              </span>
              <span className="flex-1">
                <span className="block text-[17px] font-bold text-ink">{p.title}</span>
                <span className="block text-[13px] text-ink-mute">{p.subtitle}</span>
              </span>
              <span className="text-right">
                <span className="block text-[18px] font-bold text-ink">{p.priceStars} ⭐</span>
                {p.displayPriceRub && <span className="block text-[12px] text-ink-mute">≈ {p.displayPriceRub.toLocaleString('ru')} ₽</span>}
              </span>
            </button>
          ))}
        </div>

        {plan && <p className="mt-3 text-[13px] leading-snug text-ink-mute">{plan.terms}</p>}
        <Button className="mt-5 w-full" onClick={buy} loading={busy || waiting} disabled={!plan}>
          {waiting ? 'Ждём подтверждения…' : 'Открыть свой сад'}
        </Button>
        <p className="mt-3 text-center text-[12px] leading-snug text-ink-mute">
          Оплата Telegram Stars. Без подписки доступно только обучение.{' '}
          <button className="font-semibold text-leaf-deep underline" onClick={() => setLegal(true)}>Условия и оферта</button>
        </p>
        <div className="h-6" />
      </div>

      <Sheet open={!!mock} onClose={() => setMock(null)} title="Тестовая оплата">
        <div className="rounded-2xl bg-blush-soft p-4 text-[14px] leading-snug text-blush-ink">
          Это песочница демо-версии: деньги не списываются. В Telegram здесь откроется настоящий счёт Telegram Stars.
        </div>
        {mock && (
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-cream p-4">
            <div><div className="font-semibold">{mock.plan.title}</div><div className="text-[13px] text-ink-mute">{mock.plan.subtitle}</div></div>
            <div className="text-[18px] font-bold">{mock.plan.priceStars} ⭐</div>
          </div>
        )}
        <Button className="mt-4 w-full" onClick={confirmMock} loading={busy}>Оплатить (тест)</Button>
        <Button variant="ghost" className="mt-1 w-full" onClick={() => setMock(null)}>Отмена</Button>
      </Sheet>
      <Legal open={legal} onClose={() => setLegal(false)} plans={plans ?? []} />
    </div>
  );
}
