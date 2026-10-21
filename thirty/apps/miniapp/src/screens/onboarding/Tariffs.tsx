import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { api, rub } from '../../lib/api';
import { track } from '../../lib/analytics';
import { haptic } from '../../lib/telegram';
import { ErrorState, Header, Loading, Screen, plural } from '../../ui';
import { useTicker } from './Onboarding';

export interface TariffView {
  id: string;
  title: string;
  months: number;
  goalLimit: number | null;
  features: string[];
  highlighted: boolean;
  badge: string | null;
  price: number;
  variant: 'promo' | 'regular';
  promoPrice: number;
  regularPrice: number;
  comparison: number;
  comparisonLabel: string;
  savingsPercent: number;
  perMonth: number;
  renewalPrice: number;
}
interface OfferState {
  offer: { started: boolean; active: boolean; expiresAt: string | null; msLeft: number };
  tariffs: TariffView[];
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** S06: тарифы. Таймер хранится на сервере и не сбрасывается при повторном открытии. */
export function Tariffs() {
  const nav = useNavigate();
  const [state, setState] = useState<OfferState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string>('m3');
  const clicked = useRef(false);
  useTicker(1000);

  const load = () => {
    setError(null);
    api<OfferState>('/api/offer/start', { body: {} })
      .then((s) => {
        setState(s);
        const hl = s.tariffs.find((t) => t.highlighted);
        if (hl) setSelected(hl.id);
      })
      .catch(setError);
  };
  useEffect(() => {
    load();
    track('tariff_view', { screen: 'S06' });
    void api('/api/me/screen', { body: { screen: '/tariffs', stage: 'tariffs' } }).catch(() => undefined);
  }, []);

  const msLeft = state?.offer.expiresAt ? new Date(state.offer.expiresAt).getTime() - Date.now() : 0;
  const promoActive = Boolean(state?.offer.active && msLeft > 0);
  // Таймер истёк, пока экран открыт — перезапрашиваем реальные цены у сервера
  useEffect(() => {
    if (state?.offer.active && msLeft <= 0) load();
  }, [state?.offer.active, msLeft <= 0]);

  const chosen = useMemo(() => state?.tariffs.find((t) => t.id === selected), [state, selected]);

  if (error) return <Screen id="S06"><ErrorState error={error} retry={load} /></Screen>;
  if (!state) return <Screen id="S06"><Loading /></Screen>;

  return (
    <Screen id="S06">
      <Header title="Выбери свой период" sub="Каждый месяц — новый поток с 1-го числа" />
      {promoActive ? (
        <div className="card peach">
          <div className="row between">
            <div className="h3" style={{ fontSize: 17 }}>Твоё предложение действует ещё</div>
            <div className="timer" aria-live="polite">{countdown(msLeft)}</div>
          </div>
        </div>
      ) : (
        <div className="banner warn">Специальная цена закончилась. Сейчас действуют обычные цены.</div>
      )}
      {state.tariffs.map((t) => (
        <div
          key={t.id}
          className={`card tariff card-link ${selected === t.id ? 'on' : ''}`}
          role="radio"
          aria-checked={selected === t.id}
          tabIndex={0}
          onClick={() => {
            haptic();
            setSelected(t.id);
            clicked.current = true;
            track('tariff_select', { screen: 'S06', tariff: t.id, metadata: { price: t.price, variant: t.variant } });
          }}
        >
          {t.badge && <span className="hit">{t.badge}</span>}
          <div className="label">
            {t.title} · {t.months} {plural(t.months, 'месячный поток', 'месячных потока', 'месячных потоков')}
          </div>
          <div className="row" style={{ alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span className="price">{rub(t.price)}</span>
            {t.comparison > t.price && <span className="strike">{rub(t.comparison)}</span>}
          </div>
          {t.comparison > t.price && (
            <div className="small">
              <span className="green" style={{ fontWeight: 600 }}>Экономия {t.savingsPercent}%</span>
              <span className="muted"> — {t.comparisonLabel}</span>
            </div>
          )}
          {selected === t.id && (
            <div className="col" style={{ gap: 8, marginTop: 4 }}>
              {t.features.map((f) => (
                <div className="feature" key={f}><Check size={18} />{f}</div>
              ))}
            </div>
          )}
        </div>
      ))}
      {chosen && (
        <p className="muted small" style={{ margin: '0 4px' }}>
          Автопродление: {rub(chosen.renewalPrice)} за следующие {chosen.months === 1 ? 'месяц' : `${chosen.months} ${plural(chosen.months, 'месяц', 'месяца', 'месяцев')}`}. Точную дату списания покажем на следующем шаге. Отключить можно в любой момент в профиле.
        </p>
      )}
      <button
        className="btn btn-primary"
        disabled={!chosen}
        onClick={() => {
          if (!chosen) return;
          // Клик по тарифу засчитывается один раз: если карточку не трогали, выбор по умолчанию фиксируется кнопкой
          if (!clicked.current) track('tariff_select', { screen: 'S06', tariff: chosen.id, metadata: { price: chosen.price, cta: true } });
          nav(`/checkout/${chosen.id}`);
        }}
      >
        Начать свои 30 дней
      </button>
    </Screen>
  );
}
