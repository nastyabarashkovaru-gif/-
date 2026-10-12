import { useEffect, useState } from 'react';
import { ApiError, api, resetDemoDevice } from '../api/client';
import type { Me, SubscriptionState } from '../api/types';
import { useApp } from '../state/app';
import { Button, Segmented, Sheet, Toggle, inputCls, useToast } from '../ui/kit';
import { fmtDate } from '../lib/format';
import { openTelegramLink } from '../lib/telegram';

/** Настройки: напоминания (частота, тихие часы, упоминание привычек), движение, подписка. */
export function Settings({ open, onClose }: { open: false | 'main' | 'subscription'; onClose: () => void }) {
  const { me, refreshMe, config } = useApp();
  const toast = useToast();
  const [s, setS] = useState<Me['settings']>(me.settings);
  const [sub, setSub] = useState(false);
  useEffect(() => { if (open) { setS(me.settings); setSub(open === 'subscription'); } }, [open, me.settings]);
  const save = async (patch: Partial<Me['settings']>) => {
    const next = { ...s, ...patch };
    setS(next);
    try {
      await api('PATCH', '/settings', patch);
      await refreshMe();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не сохранилось', 'error');
    }
  };
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <>
      <Sheet open={!!open && !sub} onClose={onClose} title="Настройки">
        <h3 className="mb-2 text-[15px] font-bold text-ink-soft">Напоминания в Telegram</h3>
        <div className="rounded-2xl bg-cream p-4 ring-1 ring-ink-line">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[15px] font-semibold">Мягкие напоминания</div>
              <div className="text-[13px] text-ink-mute">«Твоё дерево заскучало», «Сегодня дедлайн»…</div>
            </div>
            <Toggle checked={s.notificationsEnabled} onChange={(v) => save({ notificationsEnabled: v })} label="Напоминания" />
          </div>
          {s.notificationsEnabled && !me.user.botStarted && (
            <div className="mt-3 rounded-xl bg-white p-3 text-[13px] leading-snug text-ink-soft">
              Чтобы бот мог писать, открой его и нажми «Старт».{' '}
              {config.botUsername && <button className="font-semibold text-leaf-deep underline" onClick={() => openTelegramLink(`https://t.me/${config.botUsername}?start=reminders`)}>Открыть бота</button>}
            </div>
          )}
          {s.notificationsEnabled && (
            <div className="mt-4 space-y-4">
              <div>
                <div className="mb-1.5 text-[14px] font-medium">Не больше в день</div>
                <Segmented<string> label="Частота" value={String(s.notifyMaxPerDay)} onChange={(v) => save({ notifyMaxPerDay: Number(v) })} options={[{ value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' }]} />
              </div>
              <div className="flex items-center gap-2 text-[14px]">
                <span className="font-medium">Тихие часы</span>
                <select aria-label="Начало тихих часов" className={`${inputCls} w-auto py-2`} value={s.quietStart} onChange={(e) => save({ quietStart: Number(e.target.value) })}>
                  {hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
                <span>—</span>
                <select aria-label="Конец тихих часов" className={`${inputCls} w-auto py-2`} value={s.quietEnd} onChange={(e) => save({ quietEnd: Number(e.target.value) })}>
                  {hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-[14px] leading-snug"><div className="font-medium">Упоминать вредные привычки</div><div className="text-[12px] text-ink-mute">По умолчанию бот о них не пишет</div></div>
                <Toggle checked={s.habitMentions} onChange={(v) => save({ habitMentions: v })} label="Упоминать привычки" />
              </div>
            </div>
          )}
        </div>

        <h3 className="mb-2 mt-5 text-[15px] font-bold text-ink-soft">Приложение</h3>
        <div className="rounded-2xl bg-cream p-4 ring-1 ring-ink-line">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[15px] font-semibold">Меньше анимации</div>
            <Toggle checked={s.reducedMotion} onChange={(v) => save({ reducedMotion: v })} label="Меньше анимации" />
          </div>
          <div className="mt-3 text-[13px] text-ink-mute">Часовой пояс: {me.user.timezone}. Дни считаются по нему.</div>
        </div>

        <Button variant="secondary" className="mt-5 w-full" onClick={() => setSub(true)}>Управление подпиской</Button>
        {me.user.isDemo && (
          <Button variant="ghost" className="mt-1 w-full" onClick={() => { resetDemoDevice(); location.reload(); }}>Начать демо заново</Button>
        )}
        <div className="h-3" />
      </Sheet>
      <SubscriptionSheet open={!!open && sub} onClose={() => (open === 'subscription' ? onClose() : setSub(false))} />
    </>
  );
}

type CancelInfo = { cancellable: boolean; accessUntil?: string; rejoinPrice?: any; currentPlan?: any; retentionOffer?: { plan: any; thenPlan: any; chargeAt: string } | null };

/** Управление подпиской и честная двухшаговая отмена. */
function SubscriptionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me, refreshMe } = useApp();
  const toast = useToast();
  const [state, setState] = useState<SubscriptionState>(me.subscription);
  const [step, setStep] = useState<'view' | 'warn' | 'offer' | 'done'>('view');
  const [info, setInfo] = useState<CancelInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneText, setDoneText] = useState('');
  useEffect(() => {
    if (!open) return;
    setStep('view');
    api<SubscriptionState>('GET', '/subscription').then(setState).catch(() => {});
  }, [open]);

  const startCancel = async () => {
    setBusy(true);
    try {
      setInfo(await api<CancelInfo>('GET', '/subscription/cancel-info'));
      setStep('warn');
    } finally {
      setBusy(false);
    }
  };
  const doCancel = async () => {
    setBusy(true);
    try {
      const r = await api<{ accessUntil: string }>('POST', '/subscription/cancel');
      setDoneText(`Автопродление отключено. Доступ к саду сохранится до ${fmtDate(r.accessUntil, true)}. Сад и прогресс никуда не денутся.`);
      setStep('done');
      await refreshMe();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    } finally {
      setBusy(false);
    }
  };
  const acceptOffer = async () => {
    setBusy(true);
    try {
      const r = await api<{ nextChargeAt: string; nextChargePlan: any; thenPlan: any }>('POST', '/subscription/accept-retention-offer');
      setDoneText(`Готово! ${fmtDate(r.nextChargeAt)} спишется ${r.nextChargePlan.priceStars} ⭐ (≈ ${r.nextChargePlan.displayPriceRub} ₽), дальше — ${r.thenPlan.priceStars} ⭐ (≈ ${r.thenPlan.displayPriceRub} ₽) в месяц.`);
      setStep('done');
      await refreshMe();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    } finally {
      setBusy(false);
    }
  };

  const title = step === 'warn' ? 'Жалко, что ты уходишь' : step === 'offer' ? 'Может, останешься?' : step === 'done' ? 'Готово' : 'Подписка';
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {step === 'view' && (
        <div className="pb-2">
          <div className="rounded-2xl bg-cream p-4 text-[15px] ring-1 ring-ink-line">
            <div className="font-semibold">{state.plan?.title ?? 'Нет тарифа'}{state.isSandbox && ' · песочница'}</div>
            <div className="mt-1 text-ink-soft">
              {state.access ? (state.status === 'cancel_at_period_end' ? `Отменена. Доступ до ${fmtDate(state.accessUntil, true)}` : state.autoRenew ? `Следующее продление ${fmtDate(state.accessUntil)}${state.nextCharge?.plan ? ` · ${state.nextCharge.plan.priceStars} ⭐` : ''}` : `Оплачено до ${fmtDate(state.accessUntil)}`) : 'Подписка не активна'}
            </div>
          </div>
          {state.access && state.autoRenew && state.status === 'active' && (
            <Button variant="danger-outline" className="mt-4 w-full" onClick={startCancel} loading={busy}>Отменить подписку</Button>
          )}
          {!state.isSandbox && <p className="mt-3 text-[12px] text-ink-mute">Подписки Telegram Stars также видны в Telegram: Настройки → Мои звёзды.</p>}
        </div>
      )}
      {step === 'warn' && info && (
        <div className="pb-2">
          <p className="text-[15px] leading-relaxed text-ink-soft">
            Автопродление отключится, но доступ сохранится до <b className="text-ink">{fmtDate(info.accessUntil, true)}</b>. Все деревья, уровни и история останутся — ты сможешь вернуться к ним.
          </p>
          {info.rejoinPrice && (
            <p className="mt-3 rounded-2xl bg-blush-soft p-3 text-[14px] text-blush-ink">
              Текущие условия не сохранятся: повторное подключение будет стоить {info.rejoinPrice.priceStars} ⭐ (≈ {info.rejoinPrice.displayPriceRub} ₽) за первый месяц.
            </p>
          )}
          <Button className="mt-5 w-full" onClick={onClose}>Остаться</Button>
          <Button variant="danger-outline" className="mt-2 w-full" onClick={() => (info.retentionOffer ? setStep('offer') : doCancel())} loading={busy}>Всё равно отменить</Button>
        </div>
      )}
      {step === 'offer' && info?.retentionOffer && (
        <div className="pb-2">
          <div className="rounded-2xl bg-leaf-soft p-4">
            <div className="text-[18px] font-bold text-leaf-ink">Следующий месяц за {info.retentionOffer.plan.priceStars} ⭐ (≈ {info.retentionOffer.plan.displayPriceRub} ₽)</div>
            <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">
              Спишется {fmtDate(info.retentionOffer.chargeAt)}. Дальше — стандартная цена {info.retentionOffer.thenPlan.priceStars} ⭐ (≈ {info.retentionOffer.thenPlan.displayPriceRub} ₽) в месяц. Отменить можно в любой момент. Предложение разовое.
            </p>
          </div>
          <Button className="mt-5 w-full" onClick={acceptOffer} loading={busy}>Принять предложение</Button>
          <Button variant="danger-outline" className="mt-2 w-full" onClick={doCancel} loading={busy}>Отменить подписку</Button>
        </div>
      )}
      {step === 'done' && (
        <div className="pb-2">
          <p className="text-[15px] leading-relaxed text-ink-soft">{doneText}</p>
          <Button className="mt-5 w-full" onClick={onClose}>Хорошо</Button>
        </div>
      )}
    </Sheet>
  );
}
