import { useNavigate, useParams } from 'react-router-dom';
import { Users, MessagesSquare, Video, ChevronRight, ExternalLink } from 'lucide-react';
import { api } from '../../lib/api';
import { openExternal, openTelegram } from '../../lib/telegram';
import { Empty, ErrorState, Header, Loading, Screen, errorText, humanDate, toast, useLoad } from '../../ui';

interface Meeting { id: string; direction: string; directionTitle: string; title: string; description: string | null; startsAt: string; durationMin: number; status: string; expert: { name: string; photoUrl: string | null; bio: string | null } | null; nextStep?: string | null; joined?: boolean }
interface ClubData { paid: boolean; flowChat: { id: string; title: string } | null; topicChats: { topic: string; title: string; emoji: string; id: string | null; available: boolean }[]; meetings: Meeting[] }

const time = (iso: string) => new Date(iso).toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });

async function joinChat(id: string) {
  try {
    const r = await api<{ url: string | null; joined: boolean }>(`/api/chats/${id}/invite`, { body: {} });
    if (r.joined) toast('Вы уже в этом чате');
    else if (r.url) openTelegram(r.url);
  } catch (e) {
    toast(errorText(e));
  }
}

/** S27: клуб — чат потока, пять тематических чатов, календарь созвонов (как на макете) */
export function Club() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<ClubData>('/api/club'));
  return (
    <Screen id="S27" nav>
      <Header title="Клуб" />
      {loading ? <Loading /> : error ? <ErrorState error={error} retry={reload} /> : (
        <>
          <div className="card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="tile-icon"><Users size={24} /></div>
              <div className="grow col" style={{ gap: 6 }}>
                <div className="h3">Общий чат моего потока</div>
                <div className="muted">Только участники, которые стартовали в одну дату. Знакомства, поддержка, общение и объявления.</div>
                {data!.flowChat ? <button className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => joinChat(data!.flowChat!.id)}>Открыть чат</button> : <span className="muted small">Чат откроется ближе к старту</span>}
              </div>
            </div>
            <div className="divider" />
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="tile-icon"><MessagesSquare size={24} /></div>
              <div className="grow col">
                <div className="h3">Тематические клубы</div>
                <div className="grid2">
                  {data!.topicChats.map((c) => (
                    <button key={c.topic} className="chip" disabled={!c.id} style={{ opacity: c.id ? 1 : 0.5 }} onClick={() => c.id && joinChat(c.id)}>{c.emoji} {c.title}</button>
                  ))}
                </div>
                <div className="muted small">Объединяют участников разных потоков. Можно состоять сразу в нескольких.</div>
              </div>
            </div>
            <div className="divider" />
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="tile-icon"><Video size={24} /></div>
              <div className="grow"><div className="h3">Созвоны с экспертами</div><div className="muted">Ближайшие встречи, тема, кнопка присоединения и отзыв после занятия.</div></div>
            </div>
          </div>
          {data!.meetings.length === 0 ? <Empty title="Расписание созвонов скоро появится" /> : (
            <div className="card">
              {data!.meetings.map((m) => (
                <div className="list-item card-link" key={m.id} onClick={() => nav(`/meeting/${m.id}`)}>
                  <div className="grow"><div style={{ fontWeight: 600 }}>{m.title}</div><div className="muted small">{time(m.startsAt)} МСК · {m.directionTitle}</div></div>
                  <ChevronRight size={20} />
                </div>
              ))}
            </div>
          )}
          {!data!.paid && <div className="banner warn">Чаты и созвоны доступны участникам с оплаченным доступом.</div>}
        </>
      )}
    </Screen>
  );
}

/** S28: созвон */
export function MeetingScreen() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<Meeting>(`/api/meetings/${id}`), [id]);
  if (loading) return <Screen id="S28"><Loading /></Screen>;
  if (error || !data) return <Screen id="S28"><ErrorState error={error} retry={reload} /></Screen>;
  const past = new Date(data.startsAt).getTime() + data.durationMin * 60_000 < Date.now();
  return (
    <Screen id="S28">
      <Header title={data.title} sub={`${time(data.startsAt)} МСК · ${data.durationMin} мин`} back="/club" />
      <div className="card">
        <span className="pill" style={{ alignSelf: 'flex-start' }}>{data.directionTitle}</span>
        {data.expert && <div><div className="h3">{data.expert.name}</div>{data.expert.bio && <div className="muted small">{data.expert.bio}</div>}</div>}
        {data.description && <p style={{ margin: 0 }}>{data.description}</p>}
        {data.nextStep && <div className="banner ok"><b>Следующий шаг:</b> {data.nextStep}</div>}
      </div>
      <div className="spacer" />
      {data.status === 'canceled' ? <div className="banner err">Встреча отменена</div> : past ? (
        <button className="btn btn-secondary" onClick={() => nav(`/review?trigger=meeting&meetingId=${id}`)}>Оставить отзыв о встрече</button>
      ) : (
        <button className="btn btn-primary" onClick={async () => {
          try { const r = await api<{ url: string }>(`/api/meetings/${id}/join`, { body: {} }); openExternal(r.url); } catch (e) { toast(errorText(e)); }
        }}><ExternalLink size={18} /> Присоединиться</button>
      )}
      <p className="muted small center">Напомним в боте за час до начала · {humanDate(data.startsAt.slice(0, 10))}</p>
    </Screen>
  );
}
