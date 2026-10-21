import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, dt, rub } from '../api';
import { Status, View, act, useLoad, withReason } from '../ui';

/** A07: жалобы, апелляции, отклонение отчётов */
export function Moderation() {
  const s = useLoad(() => api('/admin-api/moderation'));
  return (
    <>
      <h1>Модерация</h1>
      <View s={s}>{(data: any) => (
        <>
          <div className="card"><h2>Жалобы ({data.complaints.length})</h2>
            <table><thead><tr><th>Дата</th><th>От</th><th>Тип</th><th>Причина</th><th>Действия</th></tr></thead>
              <tbody>{data.complaints.map((c: any) => (
                <tr key={c.id}><td>{dt(c.createdAt)}</td><td>{c.reporterName}</td><td>{c.kind}{c.targetUserId && <> · <Link to={`/users/${c.targetUserId}`}>пользователь</Link></>}</td><td>{c.reason}</td>
                  <td className="row">
                    {c.reportId && <button className="btn danger" onClick={async () => { if (await withReason('Отклонить отчёт (выполнения будут сняты)', (reason) => api(`/admin-api/reports/${c.reportId}/reject`, { body: { reason } }))) s.reload(); }}>Отклонить отчёт</button>}
                    <button className="btn light" onClick={async () => { if (await withReason('Решено', (resolution) => api(`/admin-api/complaints/${c.id}`, { body: { status: 'resolved', resolution } }))) s.reload(); }}>Решено</button>
                    <button className="btn light" onClick={async () => { if (await withReason('Отклонить жалобу', (resolution) => api(`/admin-api/complaints/${c.id}`, { body: { status: 'dismissed', resolution } }))) s.reload(); }}>Без нарушений</button>
                  </td></tr>
              ))}</tbody></table>
          </div>
          <div className="card"><h2>Апелляции на отклонённые отчёты ({data.appeals.length})</h2>
            <table><tbody>{data.appeals.map((a: any) => (
              <tr key={a.id}><td>{dt(a.createdAt)}</td><td>{a.report.membership.user.firstName}</td><td>{a.report.date.slice(0, 10)}</td><td>{a.reason}</td>
                <td className="row">
                  <button className="btn green" onClick={async () => { if (await withReason('Принять отчёт (будет помечен как принятый по апелляции)', (comment) => api(`/admin-api/appeals/${a.id}`, { body: { decision: 'approved', comment } }))) s.reload(); }}>Принять</button>
                  <button className="btn light" onClick={async () => { if (await withReason('Оставить отклонённым', (comment) => api(`/admin-api/appeals/${a.id}`, { body: { decision: 'rejected', comment } }))) s.reload(); }}>Отказать</button>
                </td></tr>
            ))}</tbody></table>
          </div>
        </>
      )}</View>
    </>
  );
}

/** A08: рейтинг, правила, политика доказательств, формула фонда */
export function Rating({ canEdit }: { canEdit: boolean }) {
  const flows = useLoad(() => api('/admin-api/flows'));
  const [flowId, setFlowId] = useState('');
  const board = useLoad(() => (flowId ? api(`/admin-api/leaderboard/${flowId}`) : Promise.resolve(null)), [flowId]);
  const rules = useLoad(() => api('/admin-api/rules'));
  const [draft, setDraft] = useState<any>(null);
  return (
    <>
      <h1>Рейтинг и правила</h1>
      <div className="card"><label className="f">Поток<select value={flowId} onChange={(e) => setFlowId(e.target.value)}><option value="">—</option>{flows.data?.map((f: any) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></label></div>
      {flowId && <View s={board}>{(b: any) => b && (
        <div className="card">
          <h2>Фонд по формуле: {rub(b.prizePool)} <span className="muted">(подтверждённые поступления за поток: {rub(b.confirmedRevenue)}; оборот ≠ фонд)</span></h2>
          <table><thead><tr><th>#</th><th>Участник</th><th>%</th><th>Выполнено</th><th>Успешных дней</th><th>Пропусков отчёта</th><th>Серия</th><th>Целей</th></tr></thead>
            <tbody>{b.rows.map((r: any) => <tr key={r.userId}><td>{r.rank}</td><td><Link to={`/users/${r.userId}`}>{r.name}</Link> {r.perfectSoFar && '✨'}</td><td>{Math.round(r.ratio * 100)}%</td><td>{r.completed}/{r.scheduled}</td><td>{r.successfulDays}</td><td>{r.missedReports}</td><td>{r.longestStreak}</td><td>{r.goals}</td></tr>)}</tbody></table>
        </div>
      )}</View>}
      <View s={rules}>{(r: any) => {
        const d = draft ?? { rulesText: r.rulesText, formula: r.formula, evidencePolicy: JSON.stringify(r.evidencePolicy, null, 2) };
        return (
          <div className="card">
            <h2>Публичные правила приза (показываются до оплаты)</h2>
            <textarea style={{ minHeight: 140 }} value={d.rulesText} disabled={!canEdit} onChange={(e) => setDraft({ ...d, rulesText: e.target.value })} />
            <h2 style={{ marginTop: 12 }}>Формула фонда</h2>
            <div className="row">
              <label className="f">% от подтверждённых поступлений<input type="number" value={d.formula.percentOfRevenue} disabled={!canEdit} onChange={(e) => setDraft({ ...d, formula: { ...d.formula, percentOfRevenue: Number(e.target.value) } })} /></label>
              <label className="f">Фиксированно, ₽<input type="number" value={d.formula.fixed} disabled={!canEdit} onChange={(e) => setDraft({ ...d, formula: { ...d.formula, fixed: Number(e.target.value) } })} /></label>
              <label className="f">Потолок, ₽ (пусто — нет)<input value={d.formula.cap ?? ''} disabled={!canEdit} onChange={(e) => setDraft({ ...d, formula: { ...d.formula, cap: e.target.value ? Number(e.target.value) : null } })} /></label>
            </div>
            <h2 style={{ marginTop: 12 }}>Политика доказательств по категориям (JSON)</h2>
            <textarea style={{ minHeight: 220, fontFamily: 'monospace', fontSize: 12 }} value={d.evidencePolicy} disabled={!canEdit} onChange={(e) => setDraft({ ...d, evidencePolicy: e.target.value })} />
            {canEdit && <button className="btn" disabled={!draft} onClick={async () => {
              let policy;
              try { policy = JSON.parse(d.evidencePolicy); } catch { return alert('Политика: неверный JSON'); }
              if (await act(() => api('/admin-api/rules', { method: 'PUT', body: { rulesText: d.rulesText, formula: d.formula, evidencePolicy: policy } }))) { setDraft(null); rules.reload(); }
            }}>Сохранить</button>}
          </div>
        );
      }}</View>
    </>
  );
}

/** A09: очередь претендентов */
export function Prizes() {
  const nav = useNavigate();
  const flows = useLoad(() => api('/admin-api/flows'));
  const [flowId, setFlowId] = useState('');
  const [status, setStatus] = useState('awaiting_review');
  const s = useLoad(() => api(`/admin-api/prizes?flowId=${flowId}&status=${status}`), [flowId, status]);
  const [places, setPlaces] = useState<any>(null);
  return (
    <>
      <h1>Претенденты на приз</h1>
      <div className="card">Система автоматически помещает сюда всех с 100% обязательств, без пропусков отчётов и с подтверждением всех целей. Это <b>не</b> присуждение награды: решение — после ручной проверки доказательств, с обязательной причиной.</div>
      <div className="card row">
        <label className="f">Поток<select value={flowId} onChange={(e) => setFlowId(e.target.value)}><option value="">Все</option>{flows.data?.map((f: any) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></label>
        <label className="f">Статус<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Все</option>{['awaiting_review', 'approved', 'rejected', 'appealed'].map((x) => <option key={x}>{x}</option>)}</select></label>
        {flowId && <button className="btn" onClick={async () => setPlaces(await api(`/admin-api/prizes/flow/${flowId}/places`, { body: {} }).catch((e) => alert(e.message)))}>Сформировать итоговые места</button>}
      </div>
      {places && <div className="card"><h2>Итог: {places.outcome === 'none' ? 'победителей нет' : places.winners.map((w: any) => `${w.place} место — ${w.userId}`).join('; ')}</h2>{places.note && <div className="muted">{places.note}</div>}</div>}
      <div className="card"><View s={s}>{(rows: any[]) => (
        <table><thead><tr><th>Участник</th><th>Поток</th><th>Статус</th><th>Место</th><th>Тай-брейк</th><th>Решений</th></tr></thead>
          <tbody>{rows.map((c) => <tr key={c.id} className="click" onClick={() => nav(`/prizes/${c.id}`)}><td>{c.name}</td><td>{c.flow.title}</td><td><Status v={c.status} /></td><td>{c.place ?? '—'}</td><td className="muted">{c.tiebreak.successfulDays} дн · серия {c.tiebreak.longestStreak} · анкета {dt(c.tiebreak.finalSubmittedAt)}</td><td>{c.reviews.length}</td></tr>)}</tbody></table>
      )}</View></div>
    </>
  );
}

/** A09: карточка претендента — календарь, все доказательства, цели и критерии, «ДО» и «ПОСЛЕ», решение с журналом */
export function PrizeDetail() {
  const { id = '' } = useParams();
  const s = useLoad(() => api(`/admin-api/prizes/${id}`), [id]);
  const decide = (decision: string, label: string) => async () => { if (await withReason(label, (reason) => api(`/admin-api/prizes/${id}/decision`, { body: { decision, reason } }))) s.reload(); };
  return (
    <View s={s}>{(p: any) => (
      <>
        <h1>{p.user.name} <Status v={p.candidate.status} /></h1>
        <div className="card row">
          {p.candidate.status === 'awaiting_review' && <><button className="btn green" onClick={decide('approve', 'Подтвердить претендента')}>Подтвердить</button><button className="btn danger" onClick={decide('reject', 'Отклонить претендента')}>Отклонить</button></>}
          {p.candidate.status === 'rejected' && <button className="btn light" onClick={decide('appeal_open', 'Открыть апелляцию')}>Открыть апелляцию</button>}
          {p.candidate.status === 'appealed' && <><button className="btn green" onClick={decide('appeal_approve', 'Апелляция: подтвердить')}>Апелляция: подтвердить</button><button className="btn danger" onClick={decide('appeal_reject', 'Апелляция: отклонить')}>Апелляция: отклонить</button></>}
          <Link to={`/users/${p.user.id}`}>Карточка пользователя</Link>
        </div>
        <div className="grid2">
          <div className="card"><h2>Календарь</h2>
            <div className="days">{p.calendar.map((d: any, i: number) => <div key={d.date} className={`day ${d.state}`} title={d.date}>{i + 1}</div>)}</div>
            <div style={{ marginTop: 8 }}>Выполнено {p.stats.completed} из {p.stats.scheduled} · пропусков отчёта {p.stats.missedReports} · успешных дней {p.stats.successfulDays}</div>
          </div>
          <div className="card"><h2>Журнал решений</h2>{p.candidate.reviews.map((r: any) => <div key={r.id}>{dt(r.createdAt)} — <b>{r.decision}</b>: {r.reason}</div>)}{!p.candidate.reviews.length && <span className="muted">Пока нет</span>}</div>
        </div>
        <div className="card"><h2>Цели и критерии</h2>
          {p.goals.map((g: any) => (
            <div key={g.title} style={{ marginBottom: 10 }}>
              <b>{g.title}</b> ({g.category}) — критерий: {g.criterion}. Итог участника: <span className={`pill ${g.finalAchieved ? 'ok' : 'err'}`}>{g.finalAchieved ? 'достигнута' : 'не достигнута'}</span> {g.finalComment}
              <div className="muted">{g.tasks.map((t: any) => `${t.title} (${t.frequency}${t.frequency !== 'daily' ? ` ${t.n}` : ''}, ${t.evidence}${t.selfReported ? ', самоотчёт' : ''})`).join('; ')}</div>
            </div>
          ))}
        </div>
        <div className="grid2">
          {['before', 'after'].map((k) => (
            <div className="card" key={k}><h2>{k === 'before' ? '«ДО»' : '«ПОСЛЕ»'}</h2>
              {p[k] ? <><div>{p[k].text}</div><pre>{JSON.stringify(p[k].metrics, null, 1)}</pre><div className="thumbs">{p[k].media.map((m: string) => <a key={m} href={m} target="_blank" rel="noreferrer"><img src={m} alt="" /></a>)}</div></> : <span className="muted">Не заполнено</span>}
            </div>
          ))}
        </div>
        <div className="card"><h2>Все отчёты ({p.reports.length})</h2>
          <p className="muted">Подозрительные доказательства помечайте флагом — автоматических выводов по фото система не делает.</p>
          <table><tbody>{p.reports.map((r: any) => (
            <tr key={r.id}><td style={{ whiteSpace: 'nowrap' }}>{r.date}<div className="muted">{dt(r.createdAt)}</div>{r.late && <span className="pill warn">по апелляции</span>}</td><td><Status v={r.status} /></td>
              <td>{r.items.map((i: any) => (
                <div key={i.itemId} style={{ marginBottom: 6 }}>{i.task} <span className="muted">· {i.goal}</span>{i.selfReported && <span className="pill">самоотчёт</span>} {i.flagged && <span className="pill err">флаг</span>}
                  {i.link && <> · <a href={i.link} target="_blank" rel="noreferrer">ссылка</a></>}
                  <div className="thumbs">{i.media.map((m: string) => <a key={m} href={m} target="_blank" rel="noreferrer"><img src={m} alt="" /></a>)}</div>
                  <button className="btn light" style={{ padding: '2px 8px' }} onClick={async () => { if (await withReason(i.flagged ? 'Снять флаг' : 'Пометить как подозрительное', (reason) => api(`/admin-api/report-items/${i.itemId}/flag`, { body: { flagged: !i.flagged, reason } }))) s.reload(); }}>{i.flagged ? 'Снять флаг' : 'Флаг'}</button>
                </div>
              ))}</td><td>{r.text}</td></tr>
          ))}</tbody></table>
        </div>
      </>
    )}</View>
  );
}
