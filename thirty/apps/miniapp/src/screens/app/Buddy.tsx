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
  const [reason, setReason] = useState<'no_contact' | 'mismatch' | 'other' | null>(null);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
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
  const replace = async () => {
    if (!reason || busy) return;
    setBusy(true);
    try {
      const r = await api<{ state: string; newBuddy: string | null }>('/api/buddy/replace', { body: { reason, comment: comment.trim() || undefined } });
      toast(r.newBuddy ? `Готово! Твой новый бадди — ${r.newBuddy} 💜` : 'Пара распущена. Подберём нового бадди, как только появится свободная участница, и напишем в боте');
      setSheet(false);
      reload();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
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
        <div className="h3">Заменить бадди</div>
        <p className="muted small" style={{ margin: 0 }}>Подберём тебе нового бадди из свободных участниц — бывшего с тобой снова не поставим. Что случилось?</p>
        {([['no_contact', 'Не выходит на связь'], ['mismatch', 'Не сошлись'], ['other', 'Другое']] as const).map(([k, t]) => (
          <button key={k} className={`btn ${reason === k ? 'btn-secondary' : 'btn-light'}`} onClick={() => setReason(k)}>{t}</button>
        ))}
        <textarea className="input" rows={2} maxLength={500} placeholder="Комментарий (по желанию)" value={comment} onChange={(e) => setComment(e.target.value)} />
        <button className="btn btn-primary" disabled={!reason || busy} onClick={replace}>{busy ? 'Подбираем…' : 'Заменить бадди'}</button>
        <button className="btn btn-ghost" onClick={async () => {
          const reason = prompt('Опишите проблему');
          if (!reason) return;
          try { await api('/api/complaints', { body: { kind: 'buddy', targetUserId: data.buddy.id, reason } }); toast('Жалоба отправлена модератору'); } catch (e) { toast(errorText(e)); }
        }}>Пожаловаться</button>
      </Sheet>
    </Screen>
  );
}
