import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { haptic, openExternal } from '../../lib/telegram';
import { TRIBUTE_PAY_URL } from '../../lib/tribute';
import { useMe } from '../../state';
import { BrandBar, ErrorState, Loading, Screen, Sheet, errorText, toast, useLoad } from '../../ui';

const TARIFFS = [
  ['m1', '1 месяц'],
  ['m3', '3 месяца'],
  ['m6', '6 месяцев'],
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
        <button className="btn btn-secondary" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            const r = await api<{ hasAccess: boolean; inChat: boolean | null }>('/api/tribute/status');
            if (r.inChat === true || r.hasAccess) reload();
            else toast(r.inChat === null ? 'Не получилось проверить — попробуй через минуту' : 'Пока не видим тебя в чате клуба. Если ты уже в чате — напиши в поддержку');
          } catch (e) {
            toast(errorText(e));
          } finally {
            setBusy(false);
          }
        }}>{busy ? 'Проверяем…' : 'Я уже в чате — проверить'}</button>
      </Screen>
    );
  }

  // Выбор тарифа — всплывающим окном, без пояснений (просьба владельца 07.11)
  return (
    <Screen id="TR">
      <BrandBar />
      <Sheet open onClose={() => undefined}>
        <div className="col" style={{ gap: 12 }}>
          <h2 className="h2" style={{ fontSize: 22, textAlign: 'center' }}>Нажми на свой тариф</h2>
          {TARIFFS.map(([id, title]) => (
            <button key={id} className="btn btn-ghost" disabled={busy} onClick={() => choose(id)}>{title}</button>
          ))}
        </div>
      </Sheet>
    </Screen>
  );
}
