import { useState } from 'react';
import { api, d, dt } from '../api';
import { Modal, Status, View, act, useLoad, withReason } from '../ui';

/** A05: потоки */
export function Flows() {
  const s = useLoad(() => api('/admin-api/flows'));
  const [start, setStart] = useState('');
  return (
    <>
      <h1>Потоки</h1>
      <div className="card row">
        <label className="f">Создать поток (1-е число)<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <button className="btn" disabled={!start.endsWith('-01')} onClick={async () => { if (await act(() => api('/admin-api/flows', { body: { startsOn: start } }))) s.reload(); }}>Создать</button>
        <span className="muted">Потоки на 2 месяца вперёд создаются автоматически. Длительность — календарный месяц.</span>
      </div>
      <div className="card"><View s={s}>{(rows: any[]) => (
        <table><thead><tr><th>Поток</th><th>Даты</th><th>Дней</th><th>Статус</th><th>Участников</th><th>Чат</th><th>Финализирован</th></tr></thead>
          <tbody>{rows.map((f) => <tr key={f.id}><td>{f.title}</td><td>{d(f.startsOn)} — {d(f.endsOn)}</td><td>{f.days}</td><td><Status v={f.status} /></td><td>{f.members}</td><td>{f.chat ? f.chat.title : <span className="pill warn">не привязан</span>}</td><td>{dt(f.finalizedAt)}</td></tr>)}</tbody></table>
      )}</View></div>
    </>
  );
}

/** A11: чаты — бот не создаёт группы; админ создаёт группу, добавляет бота админом, привязывает здесь */
export function Chats() {
  const s = useLoad(() => api('/admin-api/chats'));
  const flows = useLoad(() => api('/admin-api/flows'));
  const [bind, setBind] = useState<{ id: string; kind: 'flow' | 'topic' | 'channel'; target: string } | null>(null);
  return (
    <>
      <h1>Чаты</h1>
      <div className="card">
        <b>Как подключить группу:</b> 1) создайте группу в Telegram; 2) добавьте бота администратором с правами «Приглашать участников» и «Блокировать участников»; 3) напишите в группе команду <code>/bind</code> — группа появится ниже; 4) нажмите «Привязать» и выберите поток (например, «Ноябрь 2026») или тему (Деньги, Похудение…). Вступление идёт по заявкам: бот одобряет только оплативших.
      </div>
      <div className="card"><View s={s}>{(data: any) => (
        <table><thead><tr><th>Группа</th><th>Chat ID</th><th>Тип</th><th>Привязка</th><th>Участников</th><th>Активна</th><th /></tr></thead>
          <tbody>{data.chats.map((c: any) => (
            <tr key={c.id}><td>{c.title}</td><td>{c.telegramChatId}</td><td>{c.kind}</td><td>{c.topic ?? flows.data?.find((f: any) => f.id === c.flowId)?.title ?? '—'}</td><td>{c._count.memberships}</td><td>{c.active ? 'да' : 'нет'}</td>
              <td className="row"><button className="btn light" onClick={() => setBind({ id: c.id, kind: 'flow', target: '' })}>Привязать</button>{c.active && <button className="btn light" onClick={async () => { if (await act(() => api(`/admin-api/chats/${c.id}/unbind`, { body: {} }))) s.reload(); }}>Отключить</button>}</td></tr>
          ))}</tbody></table>
      )}</View></div>
      <Modal open={!!bind} onClose={() => setBind(null)} title="Привязать группу">
        {bind && (
          <div style={{ display: 'grid', gap: 10 }}>
            <select value={bind.kind} onChange={(e) => setBind({ ...bind, kind: e.target.value as 'flow' | 'topic' | 'channel', target: e.target.value === 'channel' ? 'channel' : '' })}><option value="flow">Чат потока</option><option value="topic">Тематический чат</option><option value="channel">Информационный канал (для всех оплативших)</option></select>
            {bind.kind === 'channel' ? <div className="muted small">Вступление только по заявке: бот одобряет тех, у кого оплачен доступ, остальным отказывает.</div> : bind.kind === 'flow' ? (
              <select value={bind.target} onChange={(e) => setBind({ ...bind, target: e.target.value })}><option value="">Выберите поток</option>{flows.data?.map((f: any) => <option key={f.id} value={f.id}>{f.title}</option>)}</select>
            ) : (
              <select value={bind.target} onChange={(e) => setBind({ ...bind, target: e.target.value })}><option value="">Выберите тему</option>{s.data?.topics.map((t: any) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
            )}
            <button className="btn" disabled={!bind.target} onClick={async () => {
              const body = bind.kind === 'flow' ? { kind: 'flow', flowId: bind.target } : bind.kind === 'channel' ? { kind: 'channel' } : { kind: 'topic', topic: bind.target };
              if (await act(() => api(`/admin-api/chats/${bind.id}/bind`, { body }))) { setBind(null); s.reload(); }
            }}>Привязать (бот проверит свои права)</button>
          </div>
        )}
      </Modal>
    </>
  );
}

/** A10: бадди */
export function Buddy() {
  const flows = useLoad(() => api('/admin-api/flows'));
  const [flowId, setFlowId] = useState('');
  const s = useLoad(() => api(`/admin-api/buddy${flowId ? `?flowId=${flowId}` : ''}`), [flowId]);
  return (
    <>
      <h1>Бадди</h1>
      <div className="card"><label className="f">Поток<select value={flowId} onChange={(e) => setFlowId(e.target.value)}><option value="">Все</option>{flows.data?.map((f: any) => <option key={f.id} value={f.id}>{f.title}</option>)}</select></label></div>
      <View s={s}>{(data: any) => (
        <>
          {flowId && <div className="card"><h2>Без пары ({data.waiting.length})</h2>{data.waiting.map((w: any) => <span key={w.id} className="pill" style={{ margin: 3 }}>{w.name} · {w.interests.join(', ') || 'без интересов'}</span>)}{!data.waiting.length && <span className="muted">Все распределены</span>}</div>}
          <div className="card"><h2>Запросы на замену</h2>
            <table><tbody>{data.replacements.map((r: any) => <tr key={r.id}><td>{dt(r.createdAt)}</td><td>{r.requesterId}</td><td>{r.reason}</td><td>{r.comment}</td><td>{r.status}</td></tr>)}</tbody></table>
          </div>
          <div className="card"><h2>Пары</h2>
            <table><thead><tr><th>Создана</th><th>Участники</th><th>Источник</th><th>Причина подбора</th><th>Статус</th><th /></tr></thead>
              <tbody>{data.pairs.map((p: any) => <tr key={p.id}><td>{dt(p.createdAt)}</td><td>{p.userA} + {p.userB}</td><td>{p.source}</td><td>{p.matchReason ?? '—'}</td><td><Status v={p.status} /></td>
                <td>{p.status === 'active' && <button className="btn light" onClick={async () => { if (await withReason('Распустить пару', (reason) => api(`/admin-api/buddy/${p.id}/dissolve`, { body: { reason } }))) s.reload(); }}>Распустить</button>}</td></tr>)}</tbody></table>
          </div>
        </>
      )}</View>
    </>
  );
}

const DIRS: Record<string, string> = { money: 'Деньги', english: 'Английский', habits: 'Привычки', blog: 'Блог', weightloss: 'Похудение' };

/** A12: созвоны и эксперты; эксперт видит только свои встречи */
export function Meetings({ expert }: { expert: boolean }) {
  const s = useLoad(() => api('/admin-api/meetings'));
  const [form, setForm] = useState<any>(null);
  const [att, setAtt] = useState<any[] | null>(null);
  const save = async () => {
    const body: any = { direction: form.direction, title: form.title, description: form.description || undefined, startsAt: new Date(form.startsAt).toISOString(), durationMin: Number(form.durationMin || 60), joinUrl: form.joinUrl || undefined };
    if (form.expertId) body.expertId = form.expertId;
    if (form.id) Object.assign(body, { status: form.status, nextStep: form.nextStep || undefined, expertReport: form.expertReport || undefined });
    if (await act(() => (form.id ? api(`/admin-api/meetings/${form.id}`, { method: 'PATCH', body }) : api('/admin-api/meetings', { body })))) { setForm(null); s.reload(); }
  };
  return (
    <>
      <h1>Созвоны{expert ? ' (мои)' : ' и эксперты'}</h1>
      <div className="card row"><button className="btn" onClick={() => setForm({ direction: 'money', durationMin: 60 })}>Новый созвон</button><span className="muted">Один групповой созвон в неделю по каждому экспертному направлению. Похудение — встреча участников без обязательного эксперта.</span></div>
      <View s={s}>{(data: any) => (
        <div className="card">
          <table><thead><tr><th>Когда</th><th>Направление</th><th>Тема</th><th>Эксперт</th><th>Статус</th><th>Переходы</th><th>Отзывы</th><th /></tr></thead>
            <tbody>{data.meetings.map((m: any) => (
              <tr key={m.id}><td>{dt(m.startsAt)}</td><td>{DIRS[m.direction]}</td><td>{m.title}</td><td>{m.expert?.name ?? '—'}</td><td><Status v={m.status} /></td><td>{m._count.attendances}</td><td>{m.feedback ? `${m.feedback._count._all} · ${m.feedback._avg.rating?.toFixed(1) ?? '—'}` : '—'}</td>
                <td className="row"><button className="btn light" onClick={() => setForm({ ...m, startsAt: m.startsAt.slice(0, 16) })}>Изменить / отчёт</button><button className="btn light" onClick={async () => setAtt(await api(`/admin-api/meetings/${m.id}/attendance`))}>Посещаемость</button></td></tr>
            ))}</tbody></table>
        </div>
      )}</View>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Созвон' : 'Новый созвон'}>
        {form && (
          <div style={{ display: 'grid', gap: 8 }}>
            <label className="f">Направление<select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>{Object.entries(DIRS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            {!expert && <label className="f">Эксперт<select value={form.expertId ?? ''} onChange={(e) => setForm({ ...form, expertId: e.target.value || null })}><option value="">—</option>{s.data?.experts.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
            <label className="f">Тема<input value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="f">Описание<textarea value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
            <label className="f">Начало (МСК)<input type="datetime-local" value={form.startsAt ?? ''} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label>
            <label className="f">Длительность, мин<input type="number" value={form.durationMin} onChange={(e) => setForm({ ...form, durationMin: e.target.value })} /></label>
            <label className="f">Ссылка на встречу<input value={form.joinUrl ?? ''} onChange={(e) => setForm({ ...form, joinUrl: e.target.value })} /></label>
            {form.id && (
              <>
                <label className="f">Статус<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="scheduled">запланирован</option><option value="done">проведён</option><option value="canceled">отменён</option></select></label>
                <label className="f">Следующий шаг для участников<textarea value={form.nextStep ?? ''} onChange={(e) => setForm({ ...form, nextStep: e.target.value })} /></label>
                <label className="f">Отчёт эксперта<textarea value={form.expertReport ?? ''} onChange={(e) => setForm({ ...form, expertReport: e.target.value })} /></label>
              </>
            )}
            <button className="btn" disabled={!form.title || !form.startsAt} onClick={save}>Сохранить</button>
          </div>
        )}
      </Modal>
      <Modal open={!!att} onClose={() => setAtt(null)} title="Посещаемость (переходы по ссылке)">
        <table><tbody>{att?.map((a) => <tr key={a.userId}><td>{a.name}</td><td>{dt(a.joinClickedAt)}</td></tr>)}</tbody></table>
      </Modal>
    </>
  );
}
