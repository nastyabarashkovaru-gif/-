import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dt } from '../api';
import { Status, View, act, useLoad, withReason } from '../ui';

/** Промокоды: СТАРТ (окно вокруг старта потока) и персональные за сторис; заявки на проверку сторис */
export function Promos() {
  const s = useLoad(() => api('/admin-api/promos'));
  const [form, setForm] = useState({ code: '', window: 'dates', validFrom: '', validTo: '', daysBefore: 1, daysAfter: 0, maxUses: '', note: '' });
  const iso = (v: string) => (v ? new Date(v).toISOString() : null);
  return (
    <>
      <h1>Промокоды</h1>
      <p className="muted">Промокод возвращает первоначальные акционные цены (999 / 2 490 / 3 990 ₽), без дополнительной скидки и не суммируется. «Окно потока» — с 00:00 за N дней до старта ближайшего потока до конца дня старта (+N дней), по московскому времени.</p>
      <View s={s}>{(rows: any[]) => (
        <div className="card">
          <table><thead><tr><th>Код</th><th>Тип</th><th>Срок</th><th>Применили</th><th>Оплатили</th><th>Статус</th><th /></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id}>
                <td><b>{p.code}</b>{p.note && <div className="muted">{p.note}</div>}</td>
                <td>{p.kind === 'personal' ? <>персональный · <Link to={`/users/${p.userId}`}>{p.userId}</Link></> : 'общий'}</td>
                <td>{p.window === 'flow_start' ? `за ${p.daysBefore} дн. до старта потока — до конца дня старта${p.daysAfter ? ` +${p.daysAfter} дн.` : ''}` : `${p.validFrom ? dt(p.validFrom) : '…'} — ${p.validTo ? dt(p.validTo) : 'без срока'}`}</td>
                <td>{p.applied}</td>
                <td>{p.uses}{p.maxUses ? ` / ${p.maxUses}` : ''}</td>
                <td><Status v={p.active ? 'active' : 'disabled'} /></td>
                <td>
                  <button className="btn light" onClick={async () => { if (await act(() => api(`/admin-api/promos/${p.id}`, { method: 'PATCH', body: { active: !p.active } }))) s.reload(); }}>{p.active ? 'Выключить' : 'Включить'}</button>
                  {p.window === 'flow_start' && <button className="btn light" style={{ marginLeft: 6 }} onClick={async () => {
                    const before = prompt('За сколько дней до старта начинает действовать?', String(p.daysBefore));
                    const after = before === null ? null : prompt('Сколько дней после дня старта ещё действует?', String(p.daysAfter));
                    if (before !== null && after !== null && (await act(() => api(`/admin-api/promos/${p.id}`, { method: 'PATCH', body: { daysBefore: Number(before), daysAfter: Number(after) } })))) s.reload();
                  }}>Срок</button>}
                  {p.window === 'dates' && p.kind === 'public' && <button className="btn light" style={{ marginLeft: 6 }} onClick={async () => {
                    const to = prompt('Действует до (ГГГГ-ММ-ДД ЧЧ:ММ, МСК)', p.validTo ? new Date(p.validTo).toLocaleString('sv-SE', { timeZone: 'Europe/Moscow' }).slice(0, 16) : '');
                    if (to && (await act(() => api(`/admin-api/promos/${p.id}`, { method: 'PATCH', body: { validTo: new Date(`${to.replace(' ', 'T')}:00+03:00`).toISOString() } })))) s.reload();
                  }}>Срок</button>}
                </td>
              </tr>
            ))}</tbody></table>
        </div>
      )}</View>
      <div className="card">
        <h2>Новый промокод</h2>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="f">Код<input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} /></label>
          <label className="f">Срок<select value={form.window} onChange={(e) => setForm({ ...form, window: e.target.value })}><option value="dates">По датам</option><option value="flow_start">Окно вокруг старта потока</option></select></label>
          {form.window === 'dates' ? (
            <>
              <label className="f">С<input type="datetime-local" value={form.validFrom} onChange={(e) => setForm({ ...form, validFrom: e.target.value })} /></label>
              <label className="f">До<input type="datetime-local" value={form.validTo} onChange={(e) => setForm({ ...form, validTo: e.target.value })} /></label>
            </>
          ) : (
            <>
              <label className="f">Дней до старта<input type="number" value={form.daysBefore} onChange={(e) => setForm({ ...form, daysBefore: Number(e.target.value) })} /></label>
              <label className="f">Дней после старта<input type="number" value={form.daysAfter} onChange={(e) => setForm({ ...form, daysAfter: Number(e.target.value) })} /></label>
            </>
          )}
          <label className="f">Лимит оплат<input value={form.maxUses} placeholder="без лимита" onChange={(e) => setForm({ ...form, maxUses: e.target.value })} /></label>
          <label className="f">Заметка<input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
        </div>
        <button className="btn" style={{ marginTop: 10 }} disabled={!form.code.trim()} onClick={async () => {
          if (await act(() => api('/admin-api/promos', { body: { code: form.code, window: form.window, validFrom: iso(form.validFrom), validTo: iso(form.validTo), daysBefore: form.daysBefore, daysAfter: form.daysAfter, maxUses: form.maxUses ? Number(form.maxUses) : null, active: true, note: form.note || null } }))) s.reload();
        }}>Создать</button>
      </div>
      <Stories />
    </>
  );
}

function Stories() {
  const [status, setStatus] = useState('pending');
  const s = useLoad(() => api(`/admin-api/story-requests?status=${status}`), [status]);
  return (
    <div className="card">
      <h2>Заявки «Вернуть скидку» (сторис)</h2>
      <p className="muted">Проверьте в Instagram, что человек выложил карточку и отметил аккаунт. «Засчитать» создаёт персональный одноразовый промокод и отправляет его в бот.</p>
      <div className="row"><label className="f">Статус<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">На проверке</option><option value="approved">Засчитаны</option><option value="rejected">Отклонены</option></select></label></div>
      <View s={s}>{(rows: any[]) => rows.length === 0 ? <div className="muted">Заявок нет</div> : (
        <table><thead><tr><th>Когда</th><th>Пользователь</th><th>Instagram</th><th>Решение</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td>{dt(r.createdAt)}</td>
              <td><Link to={`/users/${r.userId}`}>{r.name}</Link></td>
              <td><a href={`https://instagram.com/${r.instagram}`} target="_blank" rel="noreferrer">@{r.instagram}</a></td>
              <td>{r.status === 'pending' ? (
                <>
                  <button className="btn" onClick={async () => { if (await act(() => api(`/admin-api/story-requests/${r.id}`, { body: { decision: 'approve' } }))) s.reload(); }}>Засчитать</button>
                  <button className="btn light" style={{ marginLeft: 6 }} onClick={async () => { if (await withReason('Причина отказа (её увидит человек)', (reason) => api(`/admin-api/story-requests/${r.id}`, { body: { decision: 'reject', reason } }))) s.reload(); }}>Отклонить</button>
                </>
              ) : <>{r.status === 'approved' ? 'засчитана' : `отклонена: ${r.reason ?? ''}`} · {r.decidedBy}</>}</td>
            </tr>
          ))}</tbody></table>
      )}</View>
    </div>
  );
}
