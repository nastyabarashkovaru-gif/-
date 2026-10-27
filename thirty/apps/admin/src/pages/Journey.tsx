import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dt } from '../api';
import { View, act, useLoad } from '../ui';

type Tab = 'trackers' | 'feedback' | 'results' | 'expectations';
const TABS: [Tab, string][] = [['trackers', 'Отзывы за трекеры'], ['feedback', 'Обратная связь (29-й день)'], ['results', 'Итоги потоков'], ['expectations', 'Ожидания от клуба']];
const TRACKER_STATUS: Record<string, string> = { pending: 'на проверке', needs_info: 'нужно уточнение', granted: 'подарок выдан', replaced: 'заменена новым скриншотом' };

/** Итоги и отзывы: отзывы за трекеры, обратная связь на предпоследний день, итоги потоков, ожидания из анкеты */
export function Journey() {
  const [tab, setTab] = useState<Tab>('trackers');
  return (
    <>
      <h1>Итоги и отзывы</h1>
      <div className="row" style={{ gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map(([k, l]) => <button key={k} className={`btn ${tab === k ? '' : 'light'}`} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'trackers' ? <Trackers /> : <Answers kind={tab} />}
    </>
  );
}

function Trackers() {
  const [status, setStatus] = useState('pending');
  const s = useLoad(() => api(`/admin-api/journey/trackers${status ? `?status=${status}` : ''}`), [status]);
  const decide = async (id: string, decision: 'grant' | 'clarify') => {
    if (await act(() => api(`/admin-api/journey/trackers/${id}`, { body: { decision } }))) s.reload();
  };
  return (
    <>
      <TrackerLinks />
      <div className="card">
        <h2>Заявки</h2>
        <p className="muted">Участник пишет отзыв в поддержку и присылает скриншот. «Выдать трекеры» отправляет ему три ссылки в бот (один раз). Подарок — за честный отзыв, даже критический. Публиковать отзыв можно только с отдельного согласия участника.</p>
        <label className="f">Статус<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">На проверке</option><option value="needs_info">Нужно уточнение</option><option value="granted">Подарок выдан</option><option value="">Все</option></select></label>
        <View s={s}>{(rows: any[]) => rows.length === 0 ? <div className="muted">Заявок нет</div> : (
          <table><thead><tr><th>Когда</th><th>Участник</th><th>Скриншот</th><th>Статус</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td>{dt(r.createdAt)}</td>
                <td><Link to={`/users/${r.userId}`}>{r.name}</Link>{r.username && <div className="muted">@{r.username}</div>}</td>
                <td><a href={r.screenshot} target="_blank" rel="noreferrer"><img src={r.screenshot} alt="Скриншот отзыва" style={{ width: 90, borderRadius: 8 }} /></a></td>
                <td>{TRACKER_STATUS[r.status] ?? r.status}{r.decidedBy && <div className="muted">{r.decidedBy} · {dt(r.decidedAt)}</div>}</td>
                <td>{r.status === 'pending' && (
                  <>
                    <button className="btn" onClick={() => decide(r.id, 'grant')}>🎁 Выдать трекеры</button>
                    <button className="btn light" style={{ marginLeft: 6 }} onClick={() => decide(r.id, 'clarify')}>🔄 Запросить уточнение</button>
                  </>
                )}</td>
              </tr>
            ))}</tbody></table>
        )}</View>
      </div>
    </>
  );
}

function TrackerLinks() {
  const s = useLoad(() => api('/admin-api/settings'));
  const [links, setLinks] = useState({ tasks: '', week: '', finance: '' });
  const [bot, setBot] = useState('');
  useEffect(() => {
    if (s.data) {
      setLinks((s.data as any)['trackers.links']);
      setBot((s.data as any)['stories.botLink']);
    }
  }, [s.data]);
  return (
    <div className="card">
      <h2>Ссылки</h2>
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        {([['tasks', 'Трекер задач'], ['week', 'Трекер недели'], ['finance', 'Трекер финансов']] as const).map(([k, l]) => (
          <label className="f" key={k}>{l} (Google Таблица)<input value={links[k]} placeholder="https://docs.google.com/…" style={{ width: 260 }} onChange={(e) => setLinks({ ...links, [k]: e.target.value })} /></label>
        ))}
        <button className="btn" onClick={() => act(() => api('/admin-api/settings/trackers.links', { method: 'PUT', body: { value: links } }))}>Сохранить трекеры</button>
      </div>
      <div className="row" style={{ alignItems: 'flex-end', marginTop: 10 }}>
        <label className="f">Ссылка в QR-коде карточки результатов (бот с продающей цепочкой)<input value={bot} style={{ width: 360 }} onChange={(e) => setBot(e.target.value)} /></label>
        <button className="btn" onClick={() => act(() => api('/admin-api/settings/stories.botLink', { method: 'PUT', body: { value: bot } }))}>Сохранить ссылку</button>
      </div>
    </div>
  );
}

const COLUMNS: Record<Exclude<Tab, 'trackers'>, [string, string][]> = {
  feedback: [['createdAt', 'Дата'], ['month', 'Как прошёл месяц'], ['helped', 'Что помогало'], ['hindered', 'Что мешало'], ['benefit', 'Польза'], ['change', 'Что изменить'], ['needHelp', 'Нужна помощь']],
  results: [['submittedAt', 'Дата'], ['goals', 'Цели и оценка'], ['result', 'Результат'], ['expectation', 'Ожидания']],
  expectations: [['createdAt', 'Дата'], ['expectation', 'Что хочет получить от клуба']],
};

function Answers({ kind }: { kind: Exclude<Tab, 'trackers'> }) {
  const flows = useLoad(() => api('/admin-api/journey/flows'));
  const [flowId, setFlowId] = useState('');
  const [userId, setUserId] = useState('');
  const qs = new URLSearchParams({ ...(flowId ? { flowId } : {}), ...(userId.trim() ? { userId: userId.trim() } : {}) }).toString();
  const s = useLoad(() => api(`/admin-api/journey/${kind}${qs ? `?${qs}` : ''}`), [kind, qs]);
  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="f">Поток<select value={flowId} onChange={(e) => setFlowId(e.target.value)}><option value="">Все</option>{(flows.data as any[] | null)?.map((f) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></label>
        <label className="f">Участник (Telegram ID)<input value={userId} onChange={(e) => setUserId(e.target.value)} style={{ width: 160 }} /></label>
        <a className="btn light" href={`/admin-api/journey/${kind}?csv=1${qs ? `&${qs}` : ''}`}>Выгрузить CSV</a>
      </div>
      <View s={s}>{(rows: any[]) => rows.length === 0 ? <div className="muted" style={{ marginTop: 10 }}>Ответов пока нет</div> : (
        <table style={{ marginTop: 10 }}><thead><tr><th>Участник</th><th>Поток</th>{COLUMNS[kind].map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td><Link to={`/users/${r.userId}`}>{r.name}</Link>{r.username && <div className="muted">@{r.username}</div>}</td>
              <td>{r.flow}</td>
              {COLUMNS[kind].map(([k]) => <td key={k} style={{ whiteSpace: 'pre-wrap', maxWidth: 320 }}>{/At$/.test(k) ? dt(r[k]) : String(r[k] ?? '')}</td>)}
            </tr>
          ))}</tbody></table>
      )}</View>
    </div>
  );
}
