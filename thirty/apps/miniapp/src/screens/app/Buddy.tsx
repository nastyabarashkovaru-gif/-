import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Send, Sparkles, User } from 'lucide-react';
import { api } from '../../lib/api';
import { openTelegram } from '../../lib/telegram';
import { BuddyProposals } from '../reg/Registration';
import { ErrorState, Header, Loading, Screen, Sheet, errorText, humanDate, toast, useLoad } from '../../ui';

type BuddyState = { state: 'paired'; pairId: string; source: string; since: string; buddy: { id: string; name: string; photoUrl: string | null; percent: number | null; writeUrl: string } } | { state: 'waiting' | 'invited' | 'none' };

/** S29: бадди — прогресс, написать, замена (по согласию или при отсутствии связи > 5 дней), жалоба */
export function BuddyScreen() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<BuddyState>('/api/buddy'));
  const [params] = useSearchParams();
  const [sheet, setSheet] = useState(params.get('replace') === '1');
  if (loading) return <Screen id="S29"><Loading /></Screen>;
  if (error || !data) return <Screen id="S29"><ErrorState error={error} retry={reload} /></Screen>;
  if (data.state !== 'paired') {
    return (
      <Screen id="S29">
        <Header title="Мой бадди" back="/" />
        <BuddyProposals onChange={reload} />
        <div className="card center" style={{ alignItems: 'center' }}>
          <Sparkles size={40} color="var(--accent)" />
          <div className="h3">{data.state === 'invited' ? 'Ждём ответа друга' : 'Свободных партнёров пока нет'}</div>
          <div className="muted small">Как только появится подходящий участник — подберём и напишем в боте.</div>
        </div>
        <button className="btn btn-primary" onClick={() => nav('/feed?tab=people')}>Выбрать из участников</button>
        <button className="btn btn-secondary" onClick={() => nav('/reg/buddy')}>Пригласить друга</button>
      </Screen>
    );
  }
  const replace = async (reason: 'mutual' | 'no_contact_5d') => {
    try {
      const r = await api<{ state: string }>('/api/buddy/replace', { body: { reason } });
      toast(r.state === 'waiting_partner' ? 'Ждём, когда бадди тоже подтвердит замену' : r.state === 'rematched' ? 'Подобрали нового бадди!' : 'Пара распущена — подберём нового, как только появится свободный участник');
      setSheet(false);
      reload();
    } catch (e) {
      toast(errorText(e));
    }
  };
  return (
    <Screen id="S29">
      <Header title="Мой бадди" back="/" />
      <div className="card center" style={{ alignItems: 'center' }}>
        <div className="ava lg">{data.buddy.photoUrl ? <img src={data.buddy.photoUrl} alt="" /> : <User size={26} />}</div>
        <div className="h2">{data.buddy.name}</div>
        {data.buddy.percent !== null && <div className="badge-pct">{data.buddy.percent}%</div>}
        <div className="muted small">Вместе с {humanDate(data.since.slice(0, 10))} · {data.source === 'invite' ? 'по приглашению' : 'подобран по интересам'}</div>
      </div>
      <button className="btn btn-primary" onClick={() => openTelegram(data.buddy.writeUrl)}><Send size={18} /> Написать</button>
      <button className="btn btn-ghost" onClick={() => nav(`/u/${data.buddy.id}`)}>Профиль бадди</button>
      <div className="spacer" />
      <button className="btn btn-ghost" onClick={() => setSheet(true)}>Заменить бадди</button>
      <Sheet open={sheet} onClose={() => setSheet(false)}>
        <div className="h3">Замена бадди</div>
        <p className="muted small" style={{ margin: 0 }}>Замена возможна по взаимному согласию или если бадди не выходит на связь больше 5 дней. Запросы видит модератор.</p>
        <button className="btn btn-secondary" onClick={() => replace('mutual')}>Мы договорились расстаться</button>
        <button className="btn btn-light" onClick={() => replace('no_contact_5d')}>Нет связи больше 5 дней</button>
        <button className="btn btn-ghost" onClick={async () => {
          const reason = prompt('Опишите проблему');
          if (!reason) return;
          try { await api('/api/complaints', { body: { kind: 'buddy', targetUserId: data.buddy.id, reason } }); toast('Жалоба отправлена модератору'); } catch (e) { toast(errorText(e)); }
        }}>Пожаловаться</button>
      </Sheet>
    </Screen>
  );
}
