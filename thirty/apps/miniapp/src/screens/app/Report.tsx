import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, Check, CircleCheck, Circle, Flag, ImagePlus, MessageCircle, Send, ShieldAlert, X } from 'lucide-react';
import { api, uploadImage } from '../../lib/api';
import { formatMetric, parseNumber } from '../../lib/metric';
import { haptic } from '../../lib/telegram';
import { useMe } from '../../state';
import { Avatar, Empty, ErrorState, Header, Loading, Screen, Sheet, errorText, humanDate, toast, useLoad } from '../../ui';

interface Checklist {
  date: string;
  reportId: string | null;
  reportStatus: string | null;
  goals: { id: string; title: string; category: string; numeric: boolean; unit: string; current: number | null; tasks: { id: string; title: string; evidence: string; photoRequired: boolean; policyNote: string | null; dueToday: boolean; remainingInWindow: number; doneToday: boolean }[] }[];
}

/** Форма отчёта за сегодня (внутри главной): отметки действий, пара слов и обязательное фото */
export function ReportForm({ onSent }: { onSent: () => void }) {
  const { data, error, loading, reload } = useLoad(() => api<Checklist>('/api/report/today'));
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  if (loading) return <Loading lines={1} />;
  if (error || !data) return <ErrorState error={error} retry={reload} />;
  if (data.reportStatus === 'rejected') return <div className="banner err">Отчёт за сегодня отклонён модератором. Подать апелляцию можно в истории отчётов.</div>;
  const tasks = data.goals.flatMap((g) => g.tasks).filter((t) => t.doneToday || t.remainingInWindow > 0);
  const numericGoals = data.goals.filter((g) => g.numeric);
  const badValue = Object.values(values).some((v) => v.trim() !== '' && parseNumber(v) === null);

  const submit = async () => {
    setBusy(true);
    try {
      await api('/api/reports', {
        body: {
          items: tasks.filter((t) => done[t.id] && !t.doneToday).map((t) => ({ taskId: t.id, done: true })),
          mediaIds: photos.map((p) => p.id),
          progress: Object.entries(values).map(([goalId, v]) => ({ goalId, value: parseNumber(v) })).filter((p) => p.value !== null),
          text: text.trim() || undefined,
          publicAck: true,
        },
      });
      haptic('success');
      toast('Отчёт отправлен в общий чат 💜');
      onSent();
    } catch (e) {
      haptic('error');
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col" style={{ background: 'var(--bg)', borderRadius: 18, padding: 14, gap: 12 }}>
      <div className="h3">Что ты сделала сегодня?</div>
      <div role="group">
        {tasks.map((t) => {
          const on = t.doneToday || done[t.id];
          return (
            <button key={t.id} type="button" className={`radio check-radio ${on ? 'on' : ''}`} disabled={t.doneToday} onClick={() => { haptic(); setDone({ ...done, [t.id]: !done[t.id] }); }}>
              <i>{on && <Check size={13} strokeWidth={3} />}</i>{t.title}
            </button>
          );
        })}
        {tasks.length === 0 && <div className="muted small">На сегодня нет запланированных действий — расскажи, как прошёл день.</div>}
      </div>
 {numericGoals.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <div className="h3">Текущий результат <span className="muted small" style={{ fontWeight: 400 }}>— по желанию</span></div>
          {numericGoals.map((g) => (
            <label key={g.id} className="field" style={{ gap: 6 }}>
              <span className="muted small" style={{ fontWeight: 400 }}>{g.title}</span>
              <span className="row" style={{ gap: 8 }}>
                <input className="input" inputMode="decimal" placeholder={g.current !== null ? `Было: ${formatMetric(g.current, '')}` : 'Например, 58,5'} value={values[g.id] ?? ''}
                  onChange={(e) => setValues({ ...values, [g.id]: e.target.value.replace(/[^\d.,\s-]/g, '') })} />
                {g.unit && <span className="muted nowrap">{g.unit}</span>}
              </span>
            </label>
          ))}
          {badValue && <span className="small" style={{ color: 'var(--danger)' }}>Введи число, например 58,5</span>}
        </div>
      )}
      <textarea className="textarea" placeholder="Расскажи, как прошёл день..." maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="card" style={{ gap: 8 }}>
        <span className="row h3" style={{ gap: 8 }}><Camera size={18} color="var(--accent)" />Фотоотчёт *</span>
        <span className="muted small">Фото или скриншот выполненного действия. Без вложения отчёт отправить нельзя.</span>
        {photos.length > 0 && (
          <div className="photo-grid">
            {photos.map((p) => (
              <div key={p.id} style={{ position: 'relative' }}>
                <img src={p.url} alt="Фото отчёта" />
                <button className="photo-x" aria-label="Убрать фото" onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}><X size={13} /></button>
              </div>
            ))}
          </div>
        )}
        {photos.length < 6 && (
          <label className="btn btn-secondary" style={{ minHeight: 48 }}>
            <ImagePlus size={18} />{uploading ? 'Загружаем…' : 'Прикрепить фото'}
            <input type="file" accept="image/*" hidden disabled={uploading} onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setUploading(true);
              try { setPhotos([...photos, await uploadImage(f)]); } catch (x) { toast(errorText(x)); } finally { setUploading(false); }
            }} />
          </label>
        )}
      </div>
      <button className="btn btn-primary" disabled={busy || photos.length === 0 || badValue} onClick={submit}>{busy ? 'Отправляем…' : 'Отправить отчёт'}<Send size={17} /></button>
    </div>
  );
}

/** Отчёт за сегодня отдельной страницей (кнопки бота ведут сюда) */
export function ReportScreen() {
  const nav = useNavigate();
  return (
    <Screen id="S21">
      <Header title="Отчёт за сегодня" back="/" />
      <ReportForm onSent={() => nav('/')} />
    </Screen>
  );
}

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
