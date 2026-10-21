import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search, Send, Users } from 'lucide-react';
import { api } from '../../lib/api';
import { openTelegram } from '../../lib/telegram';
import { Avatar, Empty, ErrorState, Header, Loading, Screen, errorText, humanDate, toast, useLoad } from '../../ui';
import { CATEGORIES, catTitle } from '../reg/Registration';
import { ReportCard, type ReportCardData } from './Report';

/** S23/S24: лента — вкладки «Отчёты» и «Участники» */
export function Feed() {
  const [tab, setTab] = useState<'reports' | 'people'>('reports');
  return (
    <Screen id={tab === 'reports' ? 'S23' : 'S24'} nav>
      <Header title="Лента" />
      <div className="tabs" role="tablist">
        <button role="tab" className={tab === 'reports' ? 'on' : ''} onClick={() => setTab('reports')}>Отчёты</button>
        <button role="tab" className={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}>Участники</button>
      </div>
      {tab === 'reports' ? <Reports /> : <People />}
    </Screen>
  );
}

function Reports() {
  const nav = useNavigate();
  const [sort, setSort] = useState<'new' | 'popular'>('new');
  const [items, setItems] = useState<ReportCardData[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  const load = async (reset: boolean) => {
    try {
      const r = await api<{ items: ReportCardData[]; nextCursor: string | null }>(`/api/feed?sort=${sort}${!reset && cursor ? `&cursor=${cursor}` : ''}`);
      setItems(reset ? r.items : [...items, ...r.items]);
      setCursor(r.nextCursor);
      setState('ready');
    } catch (e) {
      setError(e);
      setState('error');
    }
  };
  useEffect(() => {
    setState('loading');
    void load(true);
  }, [sort]);
  const react = async (id: string, emoji: string) => {
    try {
      await api(`/api/reports/${id}/react`, { body: { emoji } });
      const d = await api<{ report: ReportCardData }>(`/api/reports/${id}`);
      setItems(items.map((x) => (x.id === id ? d.report : x)));
    } catch (e) {
      toast(errorText(e));
    }
  };
  return (
    <>
      <div className="seg">
        <button className={sort === 'new' ? 'on' : ''} onClick={() => setSort('new')}>Новые</button>
        <button className={sort === 'popular' ? 'on' : ''} onClick={() => setSort('popular')}>Популярные</button>
      </div>
      {state === 'loading' ? <Loading /> : state === 'error' ? <ErrorState error={error} retry={() => load(true)} /> : items.length === 0 ? (
        <Empty icon={<Users size={40} />} title="Отчётов пока нет" text="Лента оживёт с началом потока" />
      ) : (
        <>
          {items.map((r) => <ReportCard key={r.id} r={r} onOpen={() => nav(`/report/${r.id}`)} onReact={(e) => react(r.id, e)} />)}
          {cursor && <button className="btn btn-light" onClick={() => load(false)}>Показать ещё</button>}
        </>
      )}
    </>
  );
}

function People() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [category, setCategory] = useState('');
  const [flowStart, setFlowStart] = useState('');
  const flows = useLoad(() => api<{ flows: { title: string; startsOn: string }[] }>('/api/flows'));
  const params = new URLSearchParams({ ...(q ? { q } : {}), ...(city ? { city } : {}), ...(category ? { category } : {}), ...(flowStart ? { flowStart } : {}) }).toString();
  const { data, error, loading, reload } = useLoad(() => api<{ items: { id: string; name: string; photoUrl: string | null; city: string | null; flowTitle: string | null; categories: string[]; sixMonthBadge: boolean }[] }>(`/api/participants?${params}`), [params]);
  return (
    <>
      <div className="card tight">
        <div className="row"><Search size={20} color="var(--muted)" /><input className="input" style={{ border: 0, padding: 8 }} placeholder="Поиск по имени" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="grid2">
          <select className="select" value={flowStart} onChange={(e) => setFlowStart(e.target.value)} aria-label="Дата старта потока">
            <option value="">Все потоки</option>
            {flows.data?.flows.map((f) => <option key={f.startsOn} value={f.startsOn}>Старт {humanDate(f.startsOn, true)}</option>)}
          </select>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Категория цели">
            <option value="">Все категории</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>
        <input className="input" placeholder="Город" value={city} onChange={(e) => setCity(e.target.value)} />
      </div>
      {loading ? <Loading lines={2} /> : error ? <ErrorState error={error} retry={reload} /> : data!.items.length === 0 ? <Empty title="Никого не нашли" text="Попробуйте изменить фильтры" /> : (
        <div className="card">
          {data!.items.map((p) => (
            <div className="list-item card-link" key={p.id} onClick={() => nav(`/u/${p.id}`)}>
              <Avatar name={p.name} url={p.photoUrl} />
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{p.name} {p.sixMonthBadge && '🏅'}</div>
                <div className="muted small">{[p.city, p.flowTitle, p.categories.map(catTitle).join(', ')].filter(Boolean).join(' · ')}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** S25: профиль участника — только разрешённые данные */
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
