import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, CircleCheck, Circle, Flag, MessageCircle, ShieldAlert, X } from 'lucide-react';
import { api, uploadImage } from '../../lib/api';
import { haptic } from '../../lib/telegram';
import { useMe } from '../../state';
import { Avatar, Empty, ErrorState, Header, Loading, Screen, Sheet, errorText, humanDate, toast, useLoad } from '../../ui';

interface Checklist {
  date: string;
  reportId: string | null;
  reportStatus: string | null;
  goals: { id: string; title: string; category: string; tasks: { id: string; title: string; evidence: string; photoRequired: boolean; policyNote: string | null; dueToday: boolean; remainingInWindow: number; doneToday: boolean }[] }[];
}

/** S21: отчёт за сегодня. Доказательство — по политике задачи; отчёт публичный, предупреждаем до отправки. */
export function ReportScreen() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<Checklist>('/api/report/today'));
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [media, setMedia] = useState<Record<string, { id: string; url: string }[]>>({});
  const [links, setLinks] = useState<Record<string, string>>({});
  const [text, setText] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading) return <Screen id="S21"><Loading /></Screen>;
  if (error || !data) return <Screen id="S21"><ErrorState error={error} retry={reload} /></Screen>;
  if (data.reportStatus === 'rejected') {
    return (
      <Screen id="S21">
        <Header title="Отчёт за сегодня" back="/" />
        <div className="banner err">Отчёт за сегодня отклонён модератором. Подать апелляцию можно в истории отчётов.</div>
        <button className="btn btn-secondary" onClick={() => nav('/reports')}>История отчётов</button>
      </Screen>
    );
  }
  const tasks = data.goals.flatMap((g) => g.tasks.map((t) => ({ ...t, goal: g.title })));
  const open = tasks.filter((t) => !t.doneToday && t.remainingInWindow > 0);
  const chosen = open.filter((t) => done[t.id]);
  const missingEvidence = chosen.filter((t) => (t.photoRequired && !(media[t.id]?.length)) || (t.evidence === 'link' && !links[t.id] && !(media[t.id]?.length)));

  const submit = async () => {
    setBusy(true);
    try {
      await api('/api/reports', {
        body: {
          items: chosen.map((t) => ({ taskId: t.id, done: true, mediaIds: (media[t.id] ?? []).map((m) => m.id), link: links[t.id] || undefined })),
          text: text.trim() || undefined,
          publicAck: true,
        },
      });
      haptic('success');
      toast('Отчёт опубликован 💪');
      nav('/');
    } catch (e) {
      haptic('error');
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen id="S21">
      <Header title="Отчёт за сегодня" sub={humanDate(data.date)} back="/" />
      {open.length === 0 ? (
        <Empty icon={<CircleCheck size={48} color="var(--green)" />} title="На сегодня всё отмечено" text="Отличная работа! Возвращайся завтра." action={<button className="btn btn-secondary btn-sm" onClick={() => nav('/')}>На главную</button>} />
      ) : (
        <>
          {data.goals.map((g) => (
            <div className="card" key={g.id}>
              <div className="label">{g.title}</div>
              {g.tasks.map((t) => {
                const isDone = t.doneToday;
                const unavailable = !isDone && t.remainingInWindow === 0;
                const on = isDone || done[t.id];
                return (
                  <div key={t.id} className="col" style={{ gap: 10, opacity: unavailable ? 0.5 : 1 }}>
                    <button className="row" style={{ border: 0, background: 'none', padding: 0, cursor: isDone || unavailable ? 'default' : 'pointer', textAlign: 'left', minHeight: 44 }}
                      disabled={isDone || unavailable} onClick={() => { haptic(); setDone({ ...done, [t.id]: !done[t.id] }); }}>
                      {on ? <CircleCheck size={28} color="var(--green)" /> : <Circle size={28} color="#cfccc6" />}
                      <div className="grow">
                        <div style={{ fontWeight: 600 }}>{t.title}</div>
                        <div className="muted small">{isDone ? 'Уже отмечено сегодня' : unavailable ? 'План на эту неделю выполнен' : t.dueToday ? 'Нужно сегодня' : 'Можно отметить сегодня'}</div>
                      </div>
                    </button>
                    {done[t.id] && !isDone && (t.photoRequired || t.evidence === 'checkbox_photo' || t.evidence === 'screenshot' || t.evidence === 'photo') && (
                      <div className="col" style={{ paddingLeft: 40 }}>
                        {t.policyNote && <div className="muted small">{t.policyNote}</div>}
                        <div className="photo-grid">{(media[t.id] ?? []).map((m) => <img key={m.id} src={m.url} alt="Доказательство" />)}</div>
                        <label className="btn btn-light btn-sm" style={{ alignSelf: 'flex-start' }}>
                          <Camera size={18} /> {t.photoRequired ? 'Добавить фото (обязательно)' : 'Добавить фото'}
                          <input type="file" accept="image/*" hidden onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            try { const up = await uploadImage(f); setMedia({ ...media, [t.id]: [...(media[t.id] ?? []), up] }); } catch (x) { toast(errorText(x)); }
                          }} />
                        </label>
                      </div>
                    )}
                    {done[t.id] && !isDone && t.evidence === 'link' && (
                      <input className="input" style={{ marginLeft: 40, width: 'calc(100% - 40px)' }} placeholder="Ссылка на публикацию" value={links[t.id] ?? ''} onChange={(e) => setLinks({ ...links, [t.id]: e.target.value })} />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="card">
            <label className="field"><span>Пара слов о дне (необязательно)</span><textarea className="textarea" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} /></label>
          </div>
          <div className="banner warn">
            <ShieldAlert size={16} style={{ verticalAlign: '-3px' }} /> Отчёт увидят участники клуба. Не публикуйте номера карт, суммы на счетах, документы, адреса и интимные фото.
          </div>
          <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>Понимаю, что отчёт публичный</span></label>
          {missingEvidence.length > 0 && <div className="banner err">Добавьте доказательство: {missingEvidence.map((t) => t.title).join(', ')}</div>}
          <button className="btn btn-primary" disabled={busy || !ack || chosen.length === 0 || missingEvidence.length > 0} onClick={submit}>{busy ? 'Публикуем…' : 'Опубликовать отчёт'}</button>
        </>
      )}
    </Screen>
  );
}

/** S22: история своих отчётов */
export function ReportHistory() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<{ reports: { id: string; date: string; status: string; items: number; comments: number }[] }>('/api/reports/mine'));
  return (
    <Screen id="S22">
      <Header title="Мои отчёты" back="/profile" />
      {loading ? <Loading /> : error ? <ErrorState error={error} retry={reload} /> : data!.reports.length === 0 ? <Empty title="Отчётов пока нет" /> : (
        <div className="card">
          {data!.reports.map((r) => (
            <div className="list-item card-link" key={r.id} onClick={() => nav(`/report/${r.id}`)}>
              <div className="grow"><div style={{ fontWeight: 600 }}>{humanDate(r.date)}</div><div className="muted small">{r.items} отметок · {r.comments} комментариев</div></div>
              {r.status === 'rejected' ? <span className="pill">Отклонён</span> : <span className="pill green">Принят</span>}
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}

export interface ReportCardData {
  id: string;
  date: string;
  text: string | null;
  status: string;
  user: { id: string; name: string; photoUrl: string | null; city: string | null };
  flow: { title: string };
  items: { task: string; goal: string; category: string; link: string | null; media: string[] }[];
  reactions: { emoji: string; count: number }[];
  commentsCount: number;
}

const EMOJI = ['🔥', '💪', '👏', '❤️'];

export function ReportCard({ r, onOpen, onReact }: { r: ReportCardData; onOpen?: () => void; onReact?: (emoji: string) => void }) {
  const nav = useNavigate();
  return (
    <div className="card">
      <div className="row card-link" onClick={() => nav(`/u/${r.user.id}`)}>
        <Avatar name={r.user.name} url={r.user.photoUrl} />
        <div className="grow"><div style={{ fontWeight: 600 }}>{r.user.name}</div><div className="muted small">{humanDate(r.date)} · {r.flow.title}</div></div>
      </div>
      {r.text && <p style={{ margin: 0 }}>{r.text}</p>}
      {r.items.map((i, k) => (
        <div key={k} className="col" style={{ gap: 6 }}>
          <div className="row small"><CircleCheck size={18} color="var(--green)" /><span><b>{i.task}</b> <span className="muted">· {i.goal}</span></span></div>
          {i.link && <a href={i.link} target="_blank" rel="noopener noreferrer nofollow" className="small" style={{ paddingLeft: 30, wordBreak: 'break-all' }}>{i.link}</a>}
          {i.media.length > 0 && <div className="photo-grid">{i.media.map((u) => <img key={u} src={u} alt="Доказательство" loading="lazy" />)}</div>}
        </div>
      ))}
      <div className="row between">
        <div className="react-row">
          {EMOJI.map((e) => {
            const c = r.reactions.find((x) => x.emoji === e)?.count ?? 0;
            return <button key={e} className="react" onClick={() => onReact?.(e)} aria-label={`Реакция ${e}`}>{e}{c > 0 && ` ${c}`}</button>;
          })}
        </div>
        {onOpen && <button className="react" onClick={onOpen}><MessageCircle size={16} style={{ verticalAlign: '-3px' }} /> {r.commentsCount}</button>}
      </div>
    </div>
  );
}

/** S22: детали отчёта, комментарии, реакции, жалоба, апелляция */
export function ReportView() {
  const { id = '' } = useParams();
  const { me } = useMe();
  const { data, error, loading, reload } = useLoad(() => api<{ report: ReportCardData; comments: { id: string; text: string; user: { name: string; photoUrl: string | null } }[] }>(`/api/reports/${id}`), [id]);
  const [comment, setComment] = useState('');
  const [complainOpen, setComplainOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [appeal, setAppeal] = useState('');
  const mine = useLoad(() => api<{ reports: { id: string; status: string }[] }>('/api/reports/mine'));
  const myRejected = mine.data?.reports.find((r) => r.id === id && r.status === 'rejected');

  if (myRejected) {
    return (
      <Screen id="S22">
        <Header title="Отчёт отклонён" back="/reports" />
        <div className="card">
          <p style={{ margin: 0 }}>Если считаете решение ошибочным, опишите ситуацию — модератор пересмотрит отчёт.</p>
          <textarea className="textarea" value={appeal} maxLength={1000} onChange={(e) => setAppeal(e.target.value)} />
          <button className="btn btn-primary" disabled={appeal.trim().length < 5} onClick={async () => {
            try { await api(`/api/reports/${id}/appeal`, { body: { reason: appeal } }); toast('Апелляция отправлена'); } catch (e) { toast(errorText(e)); }
          }}>Подать апелляцию</button>
        </div>
      </Screen>
    );
  }
  if (loading) return <Screen id="S22"><Loading /></Screen>;
  if (error || !data) return <Screen id="S22"><ErrorState error={error} retry={reload} /></Screen>;
  const own = data.report.user.id === me?.user.id;

  return (
    <Screen id="S22">
      <Header title="Отчёт" back right={!own && <button className="icon-btn" aria-label="Пожаловаться" onClick={() => setComplainOpen(true)}><Flag size={18} /></button>} />
      <ReportCard r={data.report} onReact={async (e) => { await api(`/api/reports/${id}/react`, { body: { emoji: e } }).catch((x) => toast(errorText(x))); reload(); }} />
      <div className="card">
        <div className="h3">Комментарии</div>
        {data.comments.length === 0 && <div className="muted small">Поддержите участника первым</div>}
        {data.comments.map((c) => (
          <div className="row" key={c.id} style={{ alignItems: 'flex-start' }}><Avatar name={c.user.name} url={c.user.photoUrl} /><div className="grow"><div style={{ fontWeight: 600 }} className="small">{c.user.name}</div><div>{c.text}</div></div></div>
        ))}
        <div className="row">
          <input className="input" placeholder="Написать комментарий" value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
          <button className="btn btn-primary btn-sm" disabled={!comment.trim()} onClick={async () => {
            try { await api(`/api/reports/${id}/comments`, { body: { text: comment } }); setComment(''); reload(); } catch (e) { toast(errorText(e)); }
          }}>OK</button>
        </div>
      </div>
      <Sheet open={complainOpen} onClose={() => setComplainOpen(false)}>
        <div className="row between"><div className="h3">Пожаловаться на отчёт</div><button className="icon-btn" onClick={() => setComplainOpen(false)}><X size={18} /></button></div>
        <textarea className="textarea" placeholder="Что не так? Например, недостоверное доказательство или неприемлемое фото" value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
        <button className="btn btn-primary" disabled={reason.trim().length < 3} onClick={async () => {
          try { await api('/api/complaints', { body: { kind: 'report', reportId: id, reason } }); toast('Жалоба отправлена модератору'); setComplainOpen(false); } catch (e) { toast(errorText(e)); }
        }}>Отправить</button>
      </Sheet>
    </Screen>
  );
}
