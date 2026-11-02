import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, HeartHandshake, MessagesSquare, Reply, Send, SlidersHorizontal, Trophy, User, X, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api';
import { openTelegram } from '../../lib/telegram';
import { useMe } from '../../state';
import { AppBar, Avatar, Empty, ErrorState, Header, Loading, Screen, errorText, humanDate, pctColor, toast, useLoad } from '../../ui';
import { catTitle } from '../reg/Registration';
import { GOAL_CATEGORIES } from '../reg/Questionnaire';

type Tab = 'chat' | 'board' | 'people';

/** Лента: общий чат отчётов, лидерборд и все участники */
export function Feed() {
  const q = new URLSearchParams(useLocation().search);
  const focus = q.get('msg');
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>(() => (focus ? 'chat' : q.get('tab') === 'people' ? 'people' : (sessionStorage.getItem('thirty.feedTab') as Tab) || 'chat'));
  const pick = (t: Tab) => { setTab(t); sessionStorage.setItem('thirty.feedTab', t); };
  return (
    <Screen id={tab === 'chat' ? 'S23' : tab === 'board' ? 'S26' : 'S24'} nav>
      <AppBar />
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {/* Пришли из уведомления — стрелка назад к уведомлениям */}
        {focus && <button className="icon-btn" aria-label="Назад" onClick={() => (history.length > 1 ? nav(-1) : nav('/notifications'))}><ArrowLeft size={20} /></button>}
        <div className="grow">
          <h1 className="h2" style={{ fontSize: 26 }}>Лента 💜</h1>
          <p className="sub" style={{ fontSize: 15 }}>Отчёты, общение и результаты участников.</p>
        </div>
      </div>
      <div className="seg seg-plain feed-tabs" role="tablist">
        {([['chat', 'Отчёты'], ['board', 'Лидерборд'], ['people', 'Все участники']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>
        ))}
      </div>
      {tab === 'chat' ? <Chat focus={focus} /> : tab === 'board' ? <Board /> : <People />}
    </Screen>
  );
}

interface Msg {
  id: string;
  createdAt: string;
  mine: boolean;
  user: { id: string; name: string; photoUrl: string | null; username?: string | null };
  text: string | null;
  hidden: boolean;
  report: { id: string; photos: string[]; done: string[] } | null;
  replyTo: { id: string; name: string; text: string } | null;
}
interface ChatPage { flow: { id: string; title: string; startsOn: string }; messages: Msg[]; hasMore: boolean }

const time = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

function Chat({ focus }: { focus: string | null }) {
  const nav = useNavigate();
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
      let list = r.messages;
      let more = r.hasMore;
      // Переход из уведомления: догружаем историю, пока не найдём нужное сообщение
      for (let i = 0; focus && more && !list.some((m) => m.id === focus) && i < 10; i++) {
        const older = await api<ChatPage>(`/api/feed/chat?before=${list[0].id}`);
        list = [...older.messages, ...list];
        more = older.hasMore;
      }
      setFlow(r.flow);
      setMsgs(list);
      setHasMore(more);
      last.current = list.at(-1)?.id ?? null;
      setError(null);
      // Как в Telegram: открываем чат на последних сообщениях (или на сообщении из уведомления)
      requestAnimationFrame(() => {
        const el = focus ? document.getElementById(`m-${focus}`) : null;
        if (el) el.scrollIntoView({ block: 'center' });
        else window.scrollTo({ top: document.body.scrollHeight });
      });
    } catch (e) {
      setError(e);
    }
  }, [focus]);
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
        {msgs.map((m) => {
          // Как в Telegram: аватарка и ник; по нажатию — личный Telegram (или профиль в приложении, если ника нет)
          const openUser = () => (m.user.username ? openTelegram(`https://t.me/${m.user.username}`) : nav(`/u/${m.user.id}`));
          return (
          <div key={m.id} className={`msg-row ${m.mine ? 'mine' : ''}`}>
            {!m.mine && <button className="msg-ava" aria-label={`Написать ${m.user.name}`} onClick={openUser}><Avatar name={m.user.name} url={m.user.photoUrl} /></button>}
          <div id={`m-${m.id}`} className={`bubble ${m.mine ? 'mine' : ''} ${m.id === focus ? 'focus' : ''}`}>
            <div className="row between" style={{ gap: 8 }}>
              <button className="bubble-who" onClick={openUser}><span className="bubble-name">{m.user.name}</span>{m.user.username && <span className="bubble-nick">@{m.user.username}</span>}</button>
              <span className="muted small">{time(m.createdAt)}</span>
            </div>
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
          </div>
          );
        })}
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

interface BoardRow { userId: string; name: string; username: string | null; photoUrl: string | null; percent: number; fullDays: number; done: number; planned: number; days: number; rank: number }
interface WeekBoard { week: { from: string; to: string; current: boolean }; minDays: number; rows: BoardRow[]; me: (Omit<BoardRow, 'rank'> & { rank: number | null; eligible: boolean; daysLeft: number }) | null }

const shiftWeek = (iso: string, days: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const weekTitle = (w: WeekBoard['week']) => `${humanDate(w.from)} — ${humanDate(w.to)}`;

/** Рейтинг недели (ТЗ 02.11): пн–вс, в топе — с 7 дней участия; свой результат виден всегда; 1–3 места с кубками */
function Board() {
  const nav = useNavigate();
  const [week, setWeek] = useState<string | null>(null);
  const { data, error, loading, reload } = useLoad(() => api<WeekBoard>(`/api/leaderboard${week ? `?week=${week}` : ''}`), [week]);
  if (loading && !data) return <Loading lines={3} />;
  if (error || !data) return <ErrorState error={error} retry={reload} />;
  const me = data.me;
  return (
    <>
      <div className="panel" style={{ gap: 4, padding: 14 }}>
        <span className="row" style={{ gap: 8, color: 'var(--accent-ink)', fontWeight: 600, fontSize: 16 }}><Trophy size={18} />Рейтинг недели</span>
        <span className="muted" style={{ fontSize: 14 }}>Процент выполнения запланированных действий за неделю (пн–вс). Каждый понедельник — новый рейтинг.</span>
        <div className="row between" style={{ marginTop: 8 }}>
          <button className="icon-btn" aria-label="Прошлая неделя" onClick={() => setWeek(shiftWeek(data.week.from, -7))}><ArrowLeft size={18} /></button>
          <b>{data.week.current ? 'Эта неделя' : weekTitle(data.week)}</b>
          <button className="icon-btn" aria-label="Следующая неделя" disabled={data.week.current} onClick={() => setWeek(shiftWeek(data.week.from, 7))}><ChevronRight size={18} /></button>
        </div>
        {data.week.current && <span className="muted small center">{weekTitle(data.week)}</span>}
      </div>
      {me && (
        <div className="card me-week" style={{ gap: 6 }}>
          <div className="row between"><b>Твой результат</b>{me.eligible && me.rank && <span className="pill">{me.rank} место</span>}</div>
          <div className="row between" style={{ alignItems: 'flex-end' }}>
            <span className="muted small">Выполнено {me.done} из {me.planned} · дней с выполненным планом: {me.fullDays}</span>
            <b style={{ color: pctColor(me.percent), fontSize: 24 }}>{me.planned ? `${me.percent}%` : '—'}</b>
          </div>
          {!me.eligible && <div className="banner warn small">Ты появишься в рейтинге после {data.minDays} дней участия{me.daysLeft ? ` — осталось ${me.daysLeft} ${me.daysLeft === 1 ? 'день' : me.daysLeft < 5 ? 'дня' : 'дней'}` : ''} 💜</div>}
        </div>
      )}
      {data.rows.length === 0 && <Empty title="Рейтинг недели пока пуст" text={`Здесь появятся участники с ${data.minDays}+ днями в челлендже.`} />}
      {data.rows.map((r) => (
        <button key={r.userId} className={`card card-link board-row ${r.rank <= 3 ? `top top${r.rank}` : ''} ${me && r.userId === me.userId ? 'me' : ''}`} onClick={() => nav(`/u/${r.userId}`)}>
          {r.rank <= 3 ? (
            <span className={`cup cup${r.rank}`} aria-label={`${r.rank} место`}><Trophy size={20} strokeWidth={2.2} /><i>{r.rank}</i></span>
          ) : (
            <span className="board-rank" style={{ color: 'var(--muted-2)' }}>{r.rank}</span>
          )}
          <Avatar name={r.name} url={r.photoUrl} />
          <span className="grow" style={{ textAlign: 'left', minWidth: 0 }}>
            <span className="h3" style={{ display: 'block' }}>{r.name}</span>
            <span className="muted small ellipsis">{r.fullDays} {r.fullDays === 1 ? 'день' : r.fullDays < 5 && r.fullDays > 1 ? 'дня' : 'дней'} с выполненным планом</span>
          </span>
          <span style={{ textAlign: 'right' }}>
            <b style={{ color: pctColor(r.percent), fontSize: 19 }}>{r.percent}%</b>
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
  const [buddy, setBuddy] = useState<'' | 'free' | 'paired'>('');
  const [q, setQ] = useState('');
  const flows = useLoad(() => api<{ flows: { id: string; title: string; startsOn: string }[] }>('/api/flows'));
  const cities = useLoad(() => api<{ cities: string[] }>('/api/participants-cities'));
  const qs = new URLSearchParams({ ...(flowStart ? { flowStart } : {}), ...(city ? { city } : {}), ...(category ? { category } : {}), ...(buddy ? { buddy } : {}), ...(q.trim() ? { q: q.trim() } : {}) }).toString();
  const list = useLoad(() => api<{ items: Person[] }>(`/api/participants?${qs}`), [qs]);
  return (
    <>
      <div className="card" style={{ gap: 10 }}>
        <span className="row h3" style={{ gap: 8 }}><SlidersHorizontal size={18} color="var(--accent)" />Фильтры участников</span>
        <input className="input" type="search" autoCapitalize="none" autoCorrect="off" placeholder="Имя или @ник" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" role="tablist">
          {([['', 'Все участники'], ['free', 'Без пары'], ['paired', 'С бадди']] as const).map(([k, l]) => <button key={k} className={buddy === k ? 'on' : ''} onClick={() => setBuddy(k)}>{l}</button>)}
        </div>
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
  const { data, error, loading, reload } = useLoad(() => api<{ name: string; hidden?: boolean; photoUrl?: string; city?: string; age?: number | null; occupation?: string | null; aspiration?: string | null; sixMonthBadge?: boolean; writeUrl?: string; flow?: { title: string } | null; goals?: { title: string; category: string }[]; stats?: { percent: number; successfulDays: number; currentStreak: number } | null; flowsCount?: number; buddy?: { state: string; proposalId?: string } }>(`/api/participants/${id}`), [id]);
  const [busy, setBusy] = useState(false);
  const propose = async () => {
    setBusy(true);
    try {
      const r = await api<{ matched: boolean }>(`/api/buddy/propose/${id}`, { body: {} });
      toast(r.matched ? 'Теперь вы пара! 💜' : 'Предложение отправлено — ждём ответа 💜');
      reload();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const answer = async (accept: boolean) => {
    if (!data?.buddy?.proposalId) return;
    setBusy(true);
    try {
      await api(`/api/buddy/proposals/${data.buddy.proposalId}`, { body: { accept } });
      toast(accept ? 'Теперь вы пара! 💜' : 'Предложение отклонено');
      reload();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  if (loading) return <Screen id="S25"><Loading /></Screen>;
  if (error || !data) return <Screen id="S25"><ErrorState error={error} retry={reload} /></Screen>;
  return (
    <Screen id="S25">
      <Header title="Участник" back />
      <div className="card center" style={{ alignItems: 'center' }}>
        <Avatar name={data.name} url={data.photoUrl} size="lg" />
        <div className="h2">{data.name} {data.sixMonthBadge && '🏅'}</div>
        {data.hidden ? <div className="muted">Участник скрыл профиль</div> : <div className="muted">{[data.city, data.age ? ageText(data.age) : null, data.flow?.title].filter(Boolean).join(' · ')}</div>}
      </div>
      {!data.hidden && (data.occupation || data.aspiration) && (
        <div className="card" style={{ gap: 10 }}>
          <div className="h3">О себе</div>
          {data.occupation && <div><div className="label" style={{ color: 'var(--muted)' }}>Чем занимается</div><div style={{ marginTop: 2 }}>{data.occupation}</div></div>}
          {data.aspiration && <div><div className="label" style={{ color: 'var(--muted)' }}>К чему хочет прийти</div><div style={{ marginTop: 2 }}>{data.aspiration}</div></div>}
        </div>
      )}
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
          {data.buddy?.state === 'can_propose' && <button className="btn btn-primary" disabled={busy} onClick={propose}><HeartHandshake size={18} />Стать бадди 💜</button>}
          {data.buddy?.state === 'sent' && <div className="banner warn center">Предложение стать парой отправлено — ждём ответа</div>}
          {data.buddy?.state === 'incoming' && (
            <div className="card" style={{ gap: 10, borderColor: 'var(--accent)' }}>
              <div className="h3 center">{data.name} предлагает тебе стать парой 💜</div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-light" disabled={busy} onClick={() => answer(false)}>Отклонить</button>
                <button className="btn btn-primary" disabled={busy} onClick={() => answer(true)}>Подтвердить</button>
              </div>
            </div>
          )}
          {data.buddy?.state === 'paired' && <div className="banner ok center">Вы пара 💜</div>}
          {data.buddy?.state === 'taken' && <div className="muted small center">У этого участника уже есть бадди</div>}
          {data.writeUrl && <button className={`btn ${data.buddy?.state === 'can_propose' ? 'btn-secondary' : 'btn-primary'}`} onClick={() => openTelegram(data.writeUrl!)}><Send size={18} /> Написать в Telegram</button>}
        </>
      )}
    </Screen>
  );
}

/** 21 год, 23 года, 25 лет */
function ageText(n: number) {
  const d = n % 10, h = n % 100;
  return `${n} ${d === 1 && h !== 11 ? 'год' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'года' : 'лет'}`;
}
