import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MessagesSquare, Reply, Send, SlidersHorizontal, Trophy, User, X, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { openTelegram } from '../../lib/telegram';
import { useMe } from '../../state';
import { AppBar, Avatar, Empty, ErrorState, Header, Loading, Screen, errorText, humanDate, pctColor, toast, useLoad } from '../../ui';
import { catTitle } from '../reg/Registration';
import { GOAL_CATEGORIES } from '../reg/Questionnaire';

type Tab = 'chat' | 'board' | 'people';

/** Лента: общий чат отчётов, лидерборд и все участники */
export function Feed() {
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('thirty.feedTab') as Tab) || 'chat');
  const pick = (t: Tab) => { setTab(t); sessionStorage.setItem('thirty.feedTab', t); };
  return (
    <Screen id={tab === 'chat' ? 'S23' : tab === 'board' ? 'S26' : 'S24'} nav>
      <AppBar />
      <div>
        <h1 className="h2" style={{ fontSize: 26 }}>Лента 💜</h1>
        <p className="sub" style={{ fontSize: 15 }}>Отчёты, общение и результаты участников.</p>
      </div>
      <div className="seg seg-plain" role="tablist">
        {([['chat', 'Отчёты'], ['board', 'Лидерборд'], ['people', 'Все участники']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>
        ))}
      </div>
      {tab === 'chat' ? <Chat /> : tab === 'board' ? <Board /> : <People />}
    </Screen>
  );
}

interface Msg {
  id: string;
  createdAt: string;
  mine: boolean;
  user: { id: string; name: string; photoUrl: string | null };
  text: string | null;
  hidden: boolean;
  report: { id: string; photos: string[]; done: string[] } | null;
  replyTo: { id: string; name: string; text: string } | null;
}
interface ChatPage { flow: { id: string; title: string; startsOn: string }; messages: Msg[]; hasMore: boolean }

const time = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

function Chat() {
  const [flow, setFlow] = useState<ChatPage['flow'] | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [text, setText] = useState('');
  const [reply, setReply] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const last = useRef<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<ChatPage>('/api/feed/chat');
      setFlow(r.flow);
      setMsgs(r.messages);
      setHasMore(r.hasMore);
      last.current = r.messages.at(-1)?.id ?? null;
      setError(null);
      // Как в Telegram: открываем чат на последних сообщениях
      requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight }));
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Новые сообщения подтягиваем раз в 5 секунд, пока вкладка открыта
  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden || !flow) return;
      try {
        const r = await api<ChatPage>(`/api/feed/chat${last.current ? `?after=${last.current}` : ''}`);
        if (r.messages.length) {
          setMsgs((m) => { const ids = new Set(m.map((x) => x.id)); return [...m, ...r.messages.filter((x) => !ids.has(x.id))]; });
          last.current = r.messages.at(-1)!.id;
        }
      } catch { /* следующая попытка через 5 секунд */ }
    }, 5000);
    return () => clearInterval(t);
  }, [flow]);

  const older = async () => {
    if (!msgs.length) return;
    const r = await api<ChatPage>(`/api/feed/chat?before=${msgs[0].id}`);
    setMsgs([...r.messages, ...msgs]);
    setHasMore(r.hasMore);
  };

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const m = await api<Msg>('/api/feed/chat', { body: { text: text.trim(), replyToId: reply?.id ?? null } });
      setMsgs((x) => [...x, m]);
      last.current = m.id;
      setText('');
      setReply(null);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (error && !flow) return <ErrorState error={error} retry={load} />;
  if (!flow) return <Loading lines={2} />;
  return (
    <>
      <div className="card" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 12, paddingBottom: 12, borderBottom: '1px solid var(--line)' }}>
          <span className="ic sq" style={{ width: 44, height: 44, borderRadius: 12 }}><MessagesSquare size={20} /></span>
          <div><div className="h3" style={{ fontSize: 17 }}>Общий чат отчётов</div><div className="muted small">Поток {humanDate(flow.startsOn, true)}</div></div>
        </div>
        {hasMore && <button className="link-btn" onClick={older}>Показать предыдущие</button>}
        {msgs.length === 0 && <div className="muted center small" style={{ padding: '12px 0' }}>Здесь появятся отчёты и сообщения участников твоего потока.</div>}
        {msgs.map((m) => (
          <div key={m.id} className={`bubble ${m.mine ? 'mine' : ''}`}>
            <div className="row between"><span className="bubble-name">{m.user.name}</span><span className="muted small">{time(m.createdAt)}</span></div>
            {m.replyTo && <div className="bubble-quote"><b>{m.replyTo.name}</b><span>{m.replyTo.text}</span></div>}
            {m.hidden ? <div className="muted small">Сообщение скрыто модератором</div> : (
              <>
                {m.report?.photos.map((p) => <img key={p} src={p} alt="Фотоотчёт" className="bubble-photo" loading="lazy" />)}
                {m.text && <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>}
                {m.report && m.report.done.length > 0 && <div className="muted small">✓ {m.report.done.join(' · ')}</div>}
              </>
            )}
            {!m.hidden && (
              <button className="bubble-reply" onClick={() => { setReply(m); input.current?.focus(); }}><Reply size={14} />Ответить</button>
            )}
          </div>
        ))}
      </div>
      <div className="composer">
        {reply && (
          <div className="composer-reply">
            <div className="grow" style={{ minWidth: 0 }}><b>Ответ для {reply.user.name}</b><span>{reply.text ?? 'Фотоотчёт'}</span></div>
            <button aria-label="Отменить ответ" onClick={() => setReply(null)}><X size={17} /></button>
          </div>
        )}
        <div className="row" style={{ gap: 10 }}>
          <input ref={input} className="input" style={{ borderRadius: 14 }} placeholder="Написать сообщение..." value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send(); }} />
          <button className="send-btn" aria-label="Отправить" disabled={busy || !text.trim()} onClick={send}><Send size={19} /></button>
        </div>
      </div>
    </>
  );
}

interface BoardRow { userId: string; name: string; photoUrl: string | null; city: string | null; category: string | null; rank: number; percent: number }

function Board() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<{ rows: BoardRow[]; me: string }>('/api/leaderboard'));
  if (loading) return <Loading lines={3} />;
  if (error || !data) return <ErrorState error={error} retry={reload} />;
  return (
    <>
      <div className="panel" style={{ gap: 4, padding: 14 }}>
        <span className="row" style={{ gap: 8, color: 'var(--accent-ink)', fontWeight: 600, fontSize: 16 }}><Trophy size={18} />Лидерборд челленджа</span>
        <span className="muted" style={{ fontSize: 14 }}>Места по проценту выполнения запланированных действий.</span>
      </div>
      {data.rows.length === 0 && <Empty title="Рейтинг появится после старта" text="Места считаются по проценту выполнения." />}
      {data.rows.map((r) => (
        <button key={r.userId} className={`card card-link board-row ${r.userId === data.me ? 'me' : ''}`} onClick={() => nav(`/u/${r.userId}`)}>
          <span className="board-rank" style={{ color: r.rank <= 3 ? 'var(--accent)' : 'var(--muted-2)' }}>{r.rank}</span>
          {r.photoUrl ? <Avatar name={r.name} url={r.photoUrl} /> : <span className="ic"><User size={18} /></span>}
          <span className="grow" style={{ textAlign: 'left', minWidth: 0 }}>
            <span className="h3" style={{ display: 'block' }}>{r.name}</span>
            <span className="muted small ellipsis">{[r.city, r.category ? shortCat(r.category) : null].filter(Boolean).join(' · ')}</span>
          </span>
          <span style={{ textAlign: 'right' }}>
            <b style={{ color: 'var(--accent)', fontSize: 19 }}>{r.percent}%</b>
            <span className="muted small" style={{ display: 'block' }}>выполнено</span>
          </span>
        </button>
      ))}
    </>
  );
}

const shortCat = (c: string) => (c === 'habits' ? 'Привычки' : catTitle(c));

interface Person { id: string; name: string; photoUrl: string | null; city: string | null; flowStart: string | null; categories: string[]; goal: string | null; percent: number | null }

function People() {
  const nav = useNavigate();
  const { me } = useMe();
  const [flowStart, setFlowStart] = useState(me?.membership?.flow.startsOn ?? '');
  const [city, setCity] = useState('');
  const [category, setCategory] = useState('');
  const flows = useLoad(() => api<{ flows: { id: string; title: string; startsOn: string }[] }>('/api/flows'));
  const cities = useLoad(() => api<{ cities: string[] }>('/api/participants-cities'));
  const qs = new URLSearchParams({ ...(flowStart ? { flowStart } : {}), ...(city ? { city } : {}), ...(category ? { category } : {}) }).toString();
  const list = useLoad(() => api<{ items: Person[] }>(`/api/participants?${qs}`), [qs]);
  return (
    <>
      <div className="card" style={{ gap: 10 }}>
        <span className="row h3" style={{ gap: 8 }}><SlidersHorizontal size={18} color="var(--accent)" />Фильтры участников</span>
        <label className="field"><span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>Дата старта потока</span>
          <select className="select pill-select" value={flowStart} onChange={(e) => setFlowStart(e.target.value)}>
            <option value="">Все потоки</option>
            {flows.data?.flows.map((f) => <option key={f.id} value={f.startsOn}>{humanDate(f.startsOn, true)}</option>)}
          </select>
        </label>
        <div className="grid2">
          <label className="field"><span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>Город</span>
            <select className="select pill-select" value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">Все города</option>
              {cities.data?.cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field"><span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>Категория</span>
            <select className="select pill-select" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Все категории</option>
              {GOAL_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </label>
        </div>
      </div>
      <div className="row between">
        <h2 className="h2" style={{ fontSize: 21 }}>Все участники</h2>
        {list.data && <span className="muted small">Найдено: {list.data.items.length}</span>}
      </div>
      {list.loading && !list.data ? <Loading lines={2} /> : list.error ? <ErrorState error={list.error} retry={list.reload} /> : list.data!.items.length === 0 ? (
        <Empty title="Никого не нашли" text="Попробуй изменить фильтры." />
      ) : list.data!.items.map((p) => (
        <button key={p.id} className="card card-link" style={{ flexDirection: 'row', alignItems: 'center', textAlign: 'left' }} onClick={() => nav(`/u/${p.id}`)}>
          {p.photoUrl ? <Avatar name={p.name} url={p.photoUrl} /> : <span className="ic"><User size={18} /></span>}
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="h3" style={{ display: 'block', fontSize: 17 }}>{p.name}</span>
            <span className="muted small" style={{ display: 'block' }}>{[p.city, p.categories[0] ? shortCat(p.categories[0]) : null].filter(Boolean).join(' · ')}</span>
            {p.goal && <span className="small ellipsis" style={{ color: 'var(--ink-2)', marginTop: 2 }}>{p.goal}</span>}
          </span>
          <span className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
            {p.percent !== null && <b style={{ color: pctColor(p.percent), fontSize: 19 }}>{p.percent}%</b>}
            <ChevronRight size={16} color="var(--muted-2)" />
          </span>
        </button>
      ))}
    </>
  );
}

export function ParticipantScreen() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useLoad(() => api<{ name: string; hidden?: boolean; photoUrl?: string; city?: string; sixMonthBadge?: boolean; writeUrl?: string; flow?: { title: string } | null; goals?: { title: string; category: string }[]; stats?: { percent: number; successfulDays: number; currentStreak: number } | null; flowsCount?: number }>(`/api/participants/${id}`), [id]);
  if (loading) return <Screen id="S25"><Loading /></Screen>;
  if (error || !data) return <Screen id="S25"><ErrorState error={error} retry={reload} /></Screen>;
  return (
    <Screen id="S25">
      <Header title="Участник" back />
      <div className="card center" style={{ alignItems: 'center' }}>
        <Avatar name={data.name} url={data.photoUrl} size="lg" />
        <div className="h2">{data.name} {data.sixMonthBadge && '🏅'}</div>
        {data.hidden ? <div className="muted">Участник скрыл профиль</div> : <div className="muted">{[data.city, data.flow?.title].filter(Boolean).join(' · ')}</div>}
      </div>
      {!data.hidden && (
        <>
          {data.stats && (
            <div className="stats3">
              <div className="stat"><b>{data.stats.percent}%</b><span>Выполнение</span></div>
              <div className="stat"><b>{data.stats.successfulDays}</b><span>Успешных дней</span></div>
              <div className="stat"><b>{data.stats.currentStreak}</b><span>Серия</span></div>
            </div>
          )}
          {data.goals && data.goals.length > 0 && (
            <div className="card"><div className="h3">Цели</div>{data.goals.map((g) => <div className="list-item" key={g.title}><span className="pill">{catTitle(g.category).split(' ')[0]}</span><div className="grow">{g.title}</div></div>)}</div>
          )}
          {data.writeUrl && <button className="btn btn-primary" onClick={() => openTelegram(data.writeUrl!)}><Send size={18} /> Написать в Telegram</button>}
        </>
      )}
    </Screen>
  );
}
