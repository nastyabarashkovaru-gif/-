import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, CircleCheck, Clock, Gift, HeartHandshake, Lock, Unlock, ArrowLeft, MessageCircle } from 'lucide-react';
import { api, rub } from '../../lib/api';
import { ctx, track } from '../../lib/analytics';
import { haptic, openTelegram } from '../../lib/telegram';
import { useMe } from '../../state';
import { BrandBar, Cta, ErrorState, Loading, Screen, errorText, toast } from '../../ui';
import { useTicker } from './Onboarding';

/** «за месяц», «за 3 месяца», «за 6 месяцев» */
export const periodText = (m: number) => (m === 1 ? 'за месяц' : `за ${m} ${m >= 2 && m <= 4 ? 'месяца' : 'месяцев'}`);
/** Цена в день (месяц — 30 дней, с округлением вниз): 999 ₽ → 33 ₽ */
export const perDay = (t: { price: number; months: number }) => Math.floor(t.price / (t.months * 30));

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
  offer: { started: boolean; active: boolean; expiresAt: string | null; msLeft: number; kind: string | null; promoCode: string | null };
  tariffs: TariffView[];
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

export const SUBTITLE: Record<string, string> = { m1: 'Попробовать и начать', m3: 'Закрепить новые привычки', m6: 'Дойти до больших результатов' };

/** Сравнение тарифов — строки и значения из утверждённого макета */
const MATRIX: [string, (t: TariffView) => boolean][] = [
  ['Бадди и чаты', () => true],
  ['Созвоны с лидерами', () => true],
  ['Лидерборд и призы', () => true],
  ['Расширенная статистика', (t) => t.months >= 3],
  ['Сравнение месяцев', () => true],
  ['История трансформации', (t) => t.months >= 3],
  ['Архив результатов', () => true],
  ['Особый статус', (t) => t.months >= 6],
];

/** S06: тарифы. Таймер хранится на сервере и не сбрасывается при повторном открытии. */
export function Tariffs() {
  const nav = useNavigate();
  const { me } = useMe();
  const [state, setState] = useState<OfferState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string>('m3');
  const [compare, setCompare] = useState(false);
  const clicked = useRef(false);
  useTicker(1000);

  const load = () => {
    setError(null);
    api<OfferState>('/api/offer/start', { body: {} })
      .then((s) => {
        setState(s);
        // A/B «tariff_default»: какой тариф выбран по умолчанию (m1 / m3 / m6), иначе — выделенный
        const ab = ctx.variants.tariff_default;
        const def = s.tariffs.find((t) => t.id === ab) ?? s.tariffs.find((t) => t.highlighted);
        if (def) setSelected(def.id);
      })
      .catch(setError);
  };
  useEffect(() => {
    load();
    track('tariff_view', { screen: 'S06' });
    track('tariffs_screen_view', { screen: 'S06' });
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
      <div className="row between">
        <button className="icon-btn" aria-label="Назад" onClick={() => nav('/onboarding/3')}><ArrowLeft size={20} /></button>
        <span className="secure"><Lock size={12} />Безопасная оплата</span>
      </div>
      <span className="ic lg" style={{ alignSelf: 'center', marginTop: 10 }}><HeartHandshake size={30} strokeWidth={1.8} /></span>
      <div className="col" style={{ gap: 10 }}>
        <h1 className="hero">Твоё новое окружение <em>уже ждёт тебя!</em></h1>
        <p className="lead">Выбери, насколько кардинально ты хочешь изменить свою жизнь.</p>
      </div>
      {promoActive && state.offer.kind === 'promo' && (
        <div className="row" style={{ background: 'var(--green-soft)', color: 'var(--green)', borderRadius: 16, padding: '14px', gap: 10, alignItems: 'flex-start' }}>
          <Gift size={20} style={{ flexShrink: 0 }} />
          <span><b>Промокод {state.offer.promoCode} применён</b><br /><span style={{ fontSize: 14 }}>Акционные цены действуют до {new Date(state.offer.expiresAt!).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</span></span>
        </div>
      )}
      {promoActive && state.offer.kind !== 'promo' && (
        <div className="offer">
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="grow col" style={{ gap: 6 }}>
              <h3>Начни с большой выгоды 😍🎁</h3>
              <p>Мы сделали для тебя эксклюзивную цену, чтобы попробовать наше сообщество.</p>
            </div>
            <div className="timer" aria-live="polite"><Clock size={15} strokeWidth={1.8} />{countdown(msLeft)}</div>
          </div>
          <small>Скидки на тарифы действуют только ближайшие 3 часа, после чего пропадут. При покупке сейчас скидочная цена закрепится за тобой на все последующие месяцы.</small>
        </div>
      )}
      <div className="col" role="radiogroup" style={{ gap: 10 }}>
        {state.tariffs.map((t) => (
          <button
            key={t.id}
            className={`tariff ${selected === t.id ? 'on' : ''}`}
            role="radio"
            aria-checked={selected === t.id}
            onClick={() => {
              haptic();
              setSelected(t.id);
              clicked.current = true;
              track('tariff_select', { screen: 'S06', tariff: t.id, metadata: { price: t.price, variant: t.variant } });
            }}
          >
            <span className="radio-dot" />
            <span className="grow">
              <span className="t-title">{t.title}{t.badge && <span className="pill solid">{t.badge}</span>}</span>
              <span className="t-sub" style={{ display: 'block' }}>{SUBTITLE[t.id] ?? ''}</span>
              <span className="t-deal">{t.comparison > t.price ? 'Только сейчас — всего ' : 'Всего '}{rub(t.price)} {periodText(t.months)}</span>
              <span className="t-day">≈ {perDay(t)} ₽ в день</span>
            </span>
            <span className="r">
              {t.comparison > t.price && <span className="strike">{rub(t.comparison)}</span>}
              <span className="price">{rub(t.price)}</span>
              {t.comparison > t.price && <span className="save">Выгода {t.savingsPercent}%</span>}
            </span>
          </button>
        ))}
      </div>
      <div className="row" style={{ background: 'var(--green-soft)', color: 'var(--green)', borderRadius: 16, padding: '13px 14px', gap: 10, fontWeight: 600, fontSize: 14, alignItems: 'flex-start' }}>
        <Unlock size={18} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Доступ к полезным материалам, чатам и комьюнити откроется сразу после оплаты</span>
      </div>
      {chosen && (
        <div className="card" style={{ gap: 14 }}>
          <div className="h3" style={{ fontSize: 17 }}>В тариф уже включено:</div>
          {chosen.features.map((f, i) => (
            <div className={`feature ${i === 0 ? 'strong' : ''}`} key={f}><CircleCheck size={18} strokeWidth={1.8} />{f}</div>
          ))}
          <div className="divider" />
          <button className="link-accent" onClick={() => setCompare(!compare)}>
            {compare ? 'Скрыть сравнение' : 'Сравнить все тарифы'} {compare ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          {compare && (
            <table className="cmp">
              <thead><tr><th>Возможности</th>{state.tariffs.map((t) => <th key={t.id}>{t.months} мес.</th>)}</tr></thead>
              <tbody>
                <tr><td>Цели в месяц</td>{state.tariffs.map((t) => <td key={t.id}>{t.goalLimit === null ? '∞' : t.goalLimit === 1 ? '1' : `До ${t.goalLimit}`}</td>)}</tr>
                {MATRIX.map(([label, has]) => (
                  <tr key={label}><td>{label}</td>{state.tariffs.map((t) => <td key={t.id} className={has(t) ? 'y' : 'n'}>{has(t) ? '✓' : '—'}</td>)}</tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      <Cta
        disabled={!chosen}
        onClick={() => {
          if (!chosen) return;
          // Клик по тарифу засчитывается один раз: если карточку не трогали, выбор по умолчанию фиксируется кнопкой
          if (!clicked.current) track('tariff_select', { screen: 'S06', tariff: chosen.id, metadata: { price: chosen.price, cta: true } });
          nav(`/checkout/${chosen.id}`);
        }}
      >
        Присоединиться за {chosen ? rub(chosen.price) : ''} 😍
      </Cta>
      <PromoField applied={state.offer.kind === 'promo'} onApplied={load} />
      {me?.support && <button className="btn btn-secondary ask-btn" onClick={() => openTelegram(me.support)}><MessageCircle size={20} />Задать вопрос</button>}
    </Screen>
  );
}

/** Промокод (СТАРТ или персональный): проверяется на сервере, возвращает первоначальные акционные цены */
function PromoField({ applied, onApplied }: { applied: boolean; onApplied: () => void }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (applied) return null;
  if (!open) return <button className="link-accent" style={{ fontWeight: 500 }} onClick={() => setOpen(true)}><Gift size={16} />Есть промокод?</button>;
  const apply = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('/api/promo/apply', { body: { code } });
      haptic('success');
      toast('Промокод применён 🎁');
      onApplied();
    } catch (e) {
      haptic('error');
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 8 }}>
        <input className="input" placeholder="Промокод" value={code} autoCapitalize="characters" maxLength={40} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) void apply(); }} />
        <button className="btn btn-secondary" style={{ width: 'auto', minHeight: 48 }} disabled={busy || !code.trim()} onClick={apply}>Применить</button>
      </div>
      {err && <span className="small" style={{ color: 'var(--danger)' }}>{err}</span>}
    </div>
  );
}
