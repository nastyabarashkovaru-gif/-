import { useNavigate, useParams } from 'react-router-dom';
import { MessagesSquare, ArrowUpRight, Lock, CalendarDays, ExternalLink } from 'lucide-react';
import { api } from '../../lib/api';
import { openExternal, openTelegram } from '../../lib/telegram';
import { AppBar, ErrorState, Header, Loading, Screen, errorText, humanDate, toast, useLoad } from '../../ui';

interface Meeting { id: string; direction: string; directionTitle: string; title: string; description: string | null; startsAt: string; durationMin: number; status: string; expert: { name: string; photoUrl: string | null; bio: string | null } | null; nextStep?: string | null; joined?: boolean }
interface ClubData { paid: boolean; flowChat: { id: string; title: string } | null; flow: { startsOn: string; title: string } | null; topicChats: { topic: string; title: string; emoji: string; id: string | null; available: boolean }[]; meetings: Meeting[] }

const time = (iso: string) => new Date(iso).toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });

async function joinChat(id: string) {
  try {
    const r = await api<{ url: string | null; joined: boolean; demo?: boolean }>(`/api/chats/${id}/invite`, { body: {} });
    if (r.demo) toast('Демо: в настоящем приложении здесь откроется чат в Telegram');
    else if (r.joined) toast('Ты уже в этом чате — открой его в Telegram');
    else if (r.url) openTelegram(r.url);
  } catch (e) {
    toast(errorText(e));
  }
}

/** Сообщество: общий чат потока и тематические чаты по категориям целей (закрытые — серые с замком) */
export function Club() {
  const { data, error, loading, reload } = useLoad(() => api<ClubData>('/api/club'));
  return (
    <Screen id="S27" nav>
      <AppBar />
      <div>
        <h1 className="h2" style={{ fontSize: 26 }}>Твоё сообщество 💜</h1>
        <p className="sub" style={{ fontSize: 15 }}>Присоединяйся к чатам по категориям твоих целей.</p>
      </div>
      {loading && !data ? <Loading /> : error || !data ? <ErrorState error={error} retry={reload} /> : (
        <>
          <button className="hero-card card-link" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, border: 0, textAlign: 'left', cursor: data.flowChat ? 'pointer' : 'default', opacity: data.flowChat ? 1 : 0.6 }}
            onClick={() => (data.flowChat ? joinChat(data.flowChat.id) : toast(data.paid ? 'Чат скоро откроется — мы пришлём ссылку в бот' : 'Чат открывается сразу после оплаты'))}>
            <MessagesSquare size={28} strokeWidth={1.8} />
            <span className="grow"><span style={{ display: 'block', fontSize: 20, fontWeight: 700 }}>Общий чат потока</span>{data.flow && <span style={{ opacity: 0.9 }}>{humanDate(data.flow.startsOn, true)}</span>}</span>
            {data.flowChat ? <ArrowUpRight size={18} /> : <Lock size={18} />}
          </button>
          <h2 className="h2" style={{ fontSize: 20, marginTop: 6 }}>Тематические чаты</h2>
          {data.topicChats.map((t) => (
            <button key={t.topic} className={`card topic-row ${t.available ? 'card-link' : 'locked'}`} disabled={!t.available} onClick={() => t.id && joinChat(t.id)}>
              <span className="topic-emoji">{t.emoji}</span>
              <span className="grow h3" style={{ textAlign: 'left', fontSize: 17 }}>Чат «{t.title}»</span>
              {t.available ? <ArrowUpRight size={17} color="var(--accent)" /> : <Lock size={17} />}
            </button>
          ))}
          <div className="panel" style={{ gap: 6, padding: 16 }}>
            <span className="row" style={{ gap: 8, color: 'var(--accent-ink)', fontWeight: 600, fontSize: 17 }}><CalendarDays size={19} />Созвоны с лидерами</span>
            <span className="muted">Анонсы и расписание всех созвонов публикуются в тематических чатах.</span>
          </div>
        </>
      )}
    </Screen>
  );
}

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
