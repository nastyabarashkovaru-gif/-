import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, CalendarHeart, CircleCheck, CircleX, Clock, RefreshCw } from 'lucide-react';
import { api, rub } from '../../lib/api';
import { haptic, openExternal } from '../../lib/telegram';
import { useMe } from '../../state';
import { BrandBar, Cta, ErrorState, Header, Loading, Screen, errorText, humanDate, toast, useLoad } from '../../ui';
import { countdown, type TariffView } from './Tariffs';

interface Preview {
  tariff: TariffView;
  offer: { active: boolean; msLeft: number };
  flows: { startsOn: string; title: string }[];
  startsOn: string;
  paidUntil: string;
  nextCharge: { date: string; amount: number; covers: string[] };
  text: { today: string; renewal: string };
}

const CONSENTS: { kind: string; label: ReactNode }[] = [
  { kind: 'offer', label: <>Принимаю условия <a href="/docs/offer" onClick={docLink('/docs/offer')}>публичной оферты</a>, включая автопродление</> },
  { kind: 'personal_data', label: <>Даю согласие на обработку <a href="/docs/privacy" onClick={docLink('/docs/privacy')}>персональных данных</a></> },
];

/** Ссылка на документ внутри приложения (без перезагрузки и без внешнего браузера) */
let docNav: ((to: string) => void) | null = null;
function docLink(to: string) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    docNav?.(to);
  };
}

/** S07: детали платежа — что спишем сегодня, когда и сколько спишем в следующий раз, согласия */
export function Checkout() {
  const { tariff = '' } = useParams();
  const nav = useNavigate();
  const { me } = useMe();
  const { data, error, loading, reload } = useLoad(() => api<Preview>(`/api/checkout/preview?tariff=${tariff}`), [tariff]);
  const [checked, setChecked] = useState<Set<string>>(new Set(me?.consents ?? []));
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const all = CONSENTS.every((c) => checked.has(c.kind));
  docNav = nav;

  useEffect(() => {
    void api('/api/me/screen', { body: { screen: `/checkout/${tariff}`, stage: 'checkout' } }).catch(() => undefined);
  }, [tariff]);

  const pay = async () => {
    setBusy(true);
    try {
      await api('/api/consents', { body: { kinds: CONSENTS.map((c) => c.kind) } });
      const r = await api<{ paymentId: string; url: string }>('/api/checkout', { body: { tariffId: tariff, idempotencyKey: key } });
      haptic('success');
      openExternal(r.url);
      nav(`/checkout/wait/${r.paymentId}`);
    } catch (e) {
      haptic('error');
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen id="S07">
      <Header title="Детали оплаты" back="/tariffs" />
      {loading ? <Loading lines={2} /> : error ? <ErrorState error={error} retry={reload} /> : (
        <>
          <div className="card">
            <div className="label">{data!.tariff.title}</div>
            <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
              <span className="big-num">{rub(data!.tariff.price)}</span>
              {data!.tariff.comparison > data!.tariff.price && <span className="muted" style={{ textDecoration: 'line-through' }}>{rub(data!.tariff.comparison)}</span>}
            </div>
            {data!.offer.active && <div className="pill" style={{ alignSelf: 'flex-start' }}><Clock size={16} /> Цена действует ещё {countdown(data!.offer.msLeft)}</div>}
            <div className="divider" />
            <div className="row" style={{ alignItems: 'flex-start' }}><CalendarDays size={20} color="var(--orange)" /><div className="grow">
              <div style={{ fontWeight: 600 }}>Старт — {humanDate(data!.startsOn, true)}</div>
              <div className="muted small">Оплаченные потоки: {data!.flows.map((f) => f.title).join(', ')}. Доступ к подготовке — сразу после оплаты.</div>
            </div></div>
            <div className="row" style={{ alignItems: 'flex-start' }}><RefreshCw size={20} color="var(--orange)" /><div className="grow">
              <div style={{ fontWeight: 600 }}>Следующее списание — {humanDate(data!.nextCharge.date, true)}, {rub(data!.nextCharge.amount)}</div>
              <div className="muted small">{data!.text.renewal}</div>
            </div></div>
          </div>
          <div className="card">
            {CONSENTS.map((c) => (
              <label className="check" key={c.kind}>
                <input type="checkbox" checked={checked.has(c.kind)} onChange={(e) => {
                  const n = new Set(checked);
                  if (e.target.checked) n.add(c.kind); else n.delete(c.kind);
                  setChecked(n);
                }} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
          <p className="muted small" style={{ margin: '0 4px' }}>{data!.text.today} Оплата проходит на защищённой странице Prodamus. Доступ откроется после подтверждения платежа.</p>
          <button className="btn btn-primary" disabled={!all || busy} onClick={pay}>{busy ? 'Готовим оплату…' : `Оплатить ${rub(data!.tariff.price)}`}</button>
        </>
      )}
    </Screen>
  );
}

/** S09 / S10: ждём подтверждение webhook (не доверяем redirect), показываем успех, ошибку или ожидание */
export function PaymentWait() {
  const { paymentId = '' } = useParams();
  const nav = useNavigate();
  const { me, refresh } = useMe();
  const [st, setSt] = useState<{ status: string; waitingTooLong: boolean; needsRefund: boolean } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const s = await api<{ status: string; waitingTooLong: boolean; needsRefund: boolean }>(`/api/payments/${paymentId}`);
        if (stop) return;
        setSt(s);
        if (s.status === 'paid') {
          await refresh();
          return;
        }
        if (s.status === 'failed') return;
      } catch (e) {
        if (!stop) setError(e);
      }
      if (!stop) setTimeout(poll, 3000);
    };
    void poll();
    return () => { stop = true; };
  }, [paymentId, refresh]);

  if (error) return <Screen id="S10"><ErrorState error={error} retry={() => location.reload()} /></Screen>;
  if (!st) return <Screen id="S09"><Loading lines={1} /></Screen>;
  if (st.status === 'paid') {
    const flow = me?.membership?.flow;
    return (
      <Screen id="S09">
        <BrandBar right={<span className="badge-ok"><CircleCheck size={13} />Ты в клубе!</span>} />
        <img src="/img/success.png" alt="" style={{ width: '62%', maxWidth: 240, alignSelf: 'center', marginTop: 16 }} />
        <div className="col" style={{ gap: 10 }}>
          <h1 className="hero">Ура! Теперь ты <em>часть нашей команды!</em> 🎉</h1>
          <p className="lead">Ты сделал первый шаг к большим изменениям. Впереди — новые люди, поддержка и 30 дней движения к своей цели!</p>
        </div>
        {st.needsRefund && <div className="banner warn">У тебя уже была действующая подписка — повторный платёж вернём, двойного списания не будет.</div>}
        {flow && (
          <div className="card center" style={{ alignItems: 'center', gap: 6 }}>
            <span className="row muted" style={{ gap: 8, fontSize: 14 }}><CalendarHeart size={16} color="var(--accent)" />{flow.phase === 'upcoming' ? 'Твой челлендж начинается' : 'Твой челлендж уже идёт'}</span>
            <div style={{ color: 'var(--accent-2)', fontSize: 28, fontWeight: 700 }}>{flow.phase === 'upcoming' ? humanDate(flow.startsOn) : `с ${humanDate(flow.startsOn)}`}</div>
            <span className="muted" style={{ fontSize: 12 }}>А пока давай познакомимся и подготовим твою цель!</span>
          </div>
        )}
        <div className="spacer" />
        <Cta onClick={() => nav('/reg/goals')}>Приступить к заполнению целей</Cta>
      </Screen>
    );
  }
  if (st.status === 'failed') {
    return (
      <Screen id="S10">
        <div className="spacer" />
        <div className="state" style={{ color: 'var(--ink)' }}>
          <CircleX size={64} color="var(--danger)" />
          <h1 className="h1">Оплата не прошла</h1>
          <p className="muted">Деньги не списаны. Попробуйте ещё раз или выберите другую карту.</p>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => nav('/tariffs')}>Попробовать ещё раз</button>
      </Screen>
    );
  }
  return (
    <Screen id="S10">
      <div className="spacer" />
      <div className="state" style={{ color: 'var(--ink)' }}>
        <Clock size={56} color="var(--orange)" />
        <h1 className="h2">Ждём подтверждение оплаты</h1>
        <p className="muted">{st.waitingTooLong ? 'Платёж обрабатывается дольше обычного. Если деньги списались — доступ откроется автоматически, напишем в боте.' : 'Обычно это занимает до минуты. Можно не закрывать экран.'}</p>
      </div>
      <div className="spacer" />
      <button className="btn btn-secondary" onClick={() => nav('/tariffs')}>Вернуться к тарифам</button>
    </Screen>
  );
}
