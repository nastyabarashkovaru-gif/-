import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { haptic, openExternal } from '../../lib/telegram';
import { TRIBUTE_PAY_URL } from '../../lib/tribute';
import { useMe } from '../../state';
import { BrandBar, ErrorState, Loading, Screen, errorText, toast, useLoad } from '../../ui';

const TARIFFS = [
  ['m1', '1 месяц', '1 цель'],
  ['m3', '3 месяца', 'до 3 целей'],
  ['m6', '6 месяцев', 'без лимита целей'],
] as const;

/**
 * Вход по ссылке для оплативших через Tribute (07.11). Кто уже участвует — сразу обычное приложение.
 * Новенькие: проверяем, что человек в чате клуба (туда пускает Tribute), и спрашиваем оплаченный тариф.
 */
export function TributeEntry() {
  const nav = useNavigate();
  const { refresh } = useMe();
  const { data, error, loading, reload } = useLoad(() => api<{ hasAccess: boolean; inChat: boolean | null }>('/api/tribute/status'));
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Screen id="TR"><Loading /></Screen>;
  if (error || !data) return <Screen id="TR"><ErrorState error={error} retry={reload} /></Screen>;
  if (data.hasAccess) return <Navigate to="/" replace />;

  const choose = async (tariffId: string) => {
    setBusy(true);
    try {
      await api('/api/tribute/activate', { body: { tariffId } });
      haptic('success');
      await refresh();
      nav('/', { replace: true });
    } catch (e) {
      toast(errorText(e));
      reload();
    } finally {
      setBusy(false);
    }
  };

  if (data.inChat !== true) {
    return (
      <Screen id="TR">
        <BrandBar />
        <div className="col" style={{ gap: 10, marginTop: 12 }}>
          <h1 className="hero" style={{ textAlign: 'left' }}>Почти готово! 💜</h1>
          <p className="lead" style={{ textAlign: 'left' }}>Мы не нашли тебя в чате клуба. Оплати подписку в Tribute и вступи в чат по ссылке, которую пришлёт Tribute. Потом вернись сюда.</p>
        </div>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => openExternal(TRIBUTE_PAY_URL)}>Оплатить в Tribute</button>
        <button className="btn btn-secondary" onClick={reload}>Я уже в чате — проверить</button>
      </Screen>
    );
  }

  return (
    <Screen id="TR">
      <BrandBar />
      <div className="col" style={{ gap: 10, marginTop: 12 }}>
        <h1 className="hero" style={{ textAlign: 'left' }}>Какой тариф ты оплатила? 😍</h1>
        <p className="lead" style={{ textAlign: 'left' }}>Выбери тариф, который ты оплатила в Tribute — от него зависит, сколько целей можно поставить.</p>
      </div>
      {TARIFFS.map(([id, title, goals]) => (
        <button key={id} className="card card-link start-choice" disabled={busy} onClick={() => choose(id)}>
          <span className="grow" style={{ textAlign: 'left' }}><b style={{ display: 'block', fontSize: 18 }}>{title}</b><span className="muted">{goals}</span></span>
        </button>
      ))}
    </Screen>
  );
}
