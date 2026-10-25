import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2, ChevronRight, Camera, Send, UserPlus, Sparkles, MessagesSquare, Lock, CalendarDays, Users, HeartHandshake } from 'lucide-react';
import { api, uploadImage } from '../../lib/api';
import { track } from '../../lib/analytics';
import { haptic, openTelegram, requestWriteAccess, shareLink } from '../../lib/telegram';
import { useMe } from '../../state';
import { Empty, ErrorState, Header, Loading, Screen, errorText, humanDate, plural, toast, useLoad } from '../../ui';

export const CATEGORIES = [
  { id: 'money', title: 'Деньги', emoji: '💸' },
  { id: 'weightloss', title: 'Похудение', emoji: '🥑' },
  { id: 'blog', title: 'Блог', emoji: '📱' },
  { id: 'english', title: 'Английский', emoji: '🇬🇧' },
  { id: 'habits', title: 'Привычки и дисциплина', emoji: '🔥' },
  { id: 'other', title: 'Другое', emoji: '✨' },
  { id: 'selfdev', title: 'Саморазвитие', emoji: '📚' },
];
export const catTitle = (id: string) => CATEGORIES.find((c) => c.id === id)?.title ?? id;

const TIMEZONES = [
  ['Europe/Kaliningrad', 'Калининград (UTC+2)'], ['Europe/Moscow', 'Москва (UTC+3)'], ['Europe/Samara', 'Самара (UTC+4)'], ['Asia/Yekaterinburg', 'Екатеринбург (UTC+5)'],
  ['Asia/Omsk', 'Омск (UTC+6)'], ['Asia/Novosibirsk', 'Новосибирск (UTC+7)'], ['Asia/Irkutsk', 'Иркутск (UTC+8)'], ['Asia/Yakutsk', 'Якутск (UTC+9)'],
  ['Asia/Vladivostok', 'Владивосток (UTC+10)'], ['Asia/Magadan', 'Магадан (UTC+11)'], ['Asia/Kamchatka', 'Камчатка (UTC+12)'],
];

const REG_STEPS = ['/reg/profile', '/reg/flow', '/reg/goals', '/reg/before', '/reg/buddy', '/reg/chats'];
function Steps({ at }: { at: string }) {
  const idx = REG_STEPS.indexOf(at);
  return <div className="dots">{REG_STEPS.map((s, i) => <i key={s} className={i <= idx ? 'on' : ''} style={i < idx ? { width: 6 } : undefined} />)}</div>;
}

export interface MembershipView {
  id: string;
  status: string;
  tariffId: string;
  goalLimit: number | null;
  canEdit: boolean;
  flow: { id: string; title: string; startsOn: string; endsOn: string; days: number; phase: string; today: string };
  goals: {
    id: string; category: string; title: string; successCriterion: string; isPublic: boolean;
    pointA: string | null; pointB: string | null; confirmMethod: string | null; confirmNote: string | null;
    tasks: { id: string; title: string; frequency: string; n: number; dueDate: string | null; evidence: string; criteria: string | null; schedule: string }[];
  }[];
  before: { text: string | null; metrics: Record<string, string>; media: { id: string; url: string }[] } | null;
}

export function useMembership() {
  return useLoad(() => api<{ membership: MembershipView | null }>('/api/membership').then((r) => r.membership));
}

/** S11: профиль */
export function RegProfile() {
  const nav = useNavigate();
  const { me, refresh } = useMe();
  const u = me!.user;
  const [name, setName] = useState(u.displayName ?? u.firstName);
  const [city, setCity] = useState(u.city ?? '');
  const [tz, setTz] = useState(u.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow');
  const [interests, setInterests] = useState<string[]>(u.interests);
  const [visibility, setVisibility] = useState(u.visibility);
  const [marketing, setMarketing] = useState(u.marketingOptIn);
  const [busy, setBusy] = useState(false);
  useEffect(() => track('registration_started', { screen: 'S11' }), []);

  const save = async () => {
    setBusy(true);
    try {
      await api('/api/me', { method: 'PATCH', body: { displayName: name.trim(), city: city.trim() || null, timezone: tz, interests, visibility } });
      if (marketing !== u.marketingOptIn) await api('/api/consents', { body: { kinds: ['marketing_messages'], granted: marketing } });
      if (!u.allowsWrite) await requestWriteAccess();
      await refresh();
      nav('/reg/flow');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen id="S11">
      <Steps at="/reg/profile" />
      <Header title="Расскажи о себе" sub="Это поможет подобрать бадди и окружение" />
      <div className="card">
        <label className="field"><span>Имя в клубе</span><input className="input" value={name} maxLength={64} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Город (необязательно)</span><input className="input" value={city} maxLength={64} placeholder="Например, Казань" onChange={(e) => setCity(e.target.value)} /></label>
        <label className="field"><span>Часовой пояс</span>
          <select className="select" value={tz} onChange={(e) => setTz(e.target.value)}>
            {!TIMEZONES.some(([v]) => v === tz) && <option value={tz}>{tz}</option>}
            {TIMEZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>
      <div className="card">
        <div className="h3">Что тебе интересно</div>
        <div className="chips">
          {CATEGORIES.map((c) => (
            <button key={c.id} className={`chip ${interests.includes(c.id) ? 'on' : ''}`} onClick={() => setInterests(interests.includes(c.id) ? interests.filter((x) => x !== c.id) : [...interests, c.id])}>
              {c.emoji} {c.title}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="h3">Кто видит мой профиль</div>
        <div className="seg">
          {[['public', 'Все'], ['members', 'Мой поток'], ['hidden', 'Скрыть']].map(([v, l]) => <button key={v} className={visibility === v ? 'on' : ''} onClick={() => setVisibility(v)}>{l}</button>)}
        </div>
        <p className="muted small" style={{ margin: 0 }}>Профиль и статистика в поиске участников. Ежедневные отчёты в ленте публичны в любом случае.</p>
        <label className="check"><input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} /><span>Присылать в бот полезные напоминания и предложения клуба (можно отключить командой /stop)</span></label>
      </div>
      <button className="btn btn-primary" disabled={busy || name.trim().length < 1} onClick={save}>Дальше</button>
    </Screen>
  );
}

function useCountdown(target: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const ms = new Date(`${target}T00:00:00+03:00`).getTime() - now;
  const d = Math.max(0, Math.floor(ms / 86400_000));
  const h = Math.max(0, Math.floor((ms % 86400_000) / 3600_000));
  return { d, h, started: ms <= 0 };
}

/** S12: ближайший поток */
export function RegFlow() {
  const nav = useNavigate();
  const { me } = useMe();
  const flow = me!.membership!.flow;
  const c = useCountdown(flow.startsOn);
  return (
    <Screen id="S12">
      <Steps at="/reg/flow" />
      <Header title="Твой поток" sub="Новый поток стартует 1-го числа каждого месяца" />
      <div className="card">
        <div className="row"><div className="tile-icon"><CalendarDays size={24} color="var(--orange)" /></div><div className="grow"><div className="h2">{flow.title}</div><div className="muted">{humanDate(flow.startsOn)} — {humanDate(flow.endsOn)}</div></div></div>
        {!c.started ? <div className="pill" style={{ alignSelf: 'flex-start' }}>До старта {c.d} {plural(c.d, 'день', 'дня', 'дней')} {c.h} ч</div> : <div className="pill green" style={{ alignSelf: 'flex-start' }}>Поток уже идёт</div>}
        <p style={{ margin: 0 }}>В этом месяце <b>{flow.days} {plural(flow.days, 'день', 'дня', 'дней')}</b> — каждый из них обязательный. Бренд «30 дней», а календарь честный: столько дней, сколько в месяце.</p>
      </div>
      <div className="spacer" />
      <button className="btn btn-primary" onClick={() => nav('/reg/goals')}>Выбрать цели</button>
    </Screen>
  );
}

/** S13: цели (лимит по тарифу) */
export function RegGoals() {
  const nav = useNavigate();
  const { refresh } = useMe();
  const { data: m, error, loading, reload } = useMembership();
  const [adding, setAdding] = useState(false);
  const [cat, setCat] = useState('habits');
  const [title, setTitle] = useState('');
  const [criterion, setCriterion] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Screen id="S13"><Loading /></Screen>;
  if (error || !m) return <Screen id="S13"><ErrorState error={error ?? new Error('Нет участия')} retry={reload} /></Screen>;
  const limitReached = m.goalLimit !== null && m.goals.length >= m.goalLimit;
  const ready = m.goals.length > 0 && m.goals.every((g) => g.tasks.length > 0);

  const add = async () => {
    setBusy(true);
    try {
      await api('/api/goals', { body: { category: cat, title, successCriterion: criterion } });
      setTitle('');
      setCriterion('');
      setAdding(false);
      reload();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const fix = async () => {
    setBusy(true);
    try {
      await api('/api/membership/fix', { body: {} });
      haptic('success');
      await refresh();
      nav('/reg/before');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen id="S13">
      <Steps at="/reg/goals" />
      <Header title="Твои цели на месяц" sub={m.goalLimit === null ? 'Без ограничения числа целей' : `В твоём тарифе — ${m.goalLimit === 1 ? 'одна цель' : `до ${m.goalLimit} целей`}`} />
      {!m.canEdit && <div className="banner warn"><Lock size={14} /> Поток начался — цели и задачи зафиксированы.</div>}
      {m.goals.map((g) => (
        <div className="card card-link" key={g.id} onClick={() => m.canEdit && nav(`/reg/tasks/${g.id}`)}>
          <div className="row between"><span className="pill">{catTitle(g.category)}</span>
            {m.canEdit && <button className="icon-btn" aria-label="Удалить цель" onClick={async (e) => { e.stopPropagation(); if (confirm('Удалить цель?')) { await api(`/api/goals/${g.id}`, { method: 'DELETE' }).catch((x) => toast(errorText(x))); reload(); } }}><Trash2 size={18} /></button>}
          </div>
          <div className="h3">{g.title}</div>
          <div className="muted small">Цель достигнута, если: {g.successCriterion}</div>
          <div className="row between">
            <span className={g.tasks.length ? 'green small' : 'orange small'}>{g.tasks.length ? `${g.tasks.length} ${plural(g.tasks.length, 'задача', 'задачи', 'задач')}` : 'Добавьте задачи'}</span>
            {m.canEdit && <ChevronRight size={20} />}
          </div>
        </div>
      ))}
      {m.canEdit && !limitReached && (adding ? (
        <div className="card">
          <div className="h3">Новая цель</div>
          <div className="chips">{CATEGORIES.map((c) => <button key={c.id} className={`chip ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(c.id)}>{c.emoji} {c.title}</button>)}</div>
          <label className="field"><span>Цель</span><input className="input" value={title} maxLength={120} placeholder="Например, 30 дней без сигарет" onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="field"><span>Цель достигнута, если…</span><input className="input" value={criterion} maxLength={300} placeholder="Например, ни одной сигареты за месяц" onChange={(e) => setCriterion(e.target.value)} /></label>
          <div className="row"><button className="btn btn-light" onClick={() => setAdding(false)}>Отмена</button><button className="btn btn-primary" disabled={busy || title.trim().length < 3 || criterion.trim().length < 3} onClick={add}>Добавить</button></div>
        </div>
      ) : (
        <button className="btn btn-secondary" onClick={() => setAdding(true)}><Plus size={20} /> Добавить цель</button>
      ))}
      {m.goals.length === 0 && !adding && <Empty title="Пока нет целей" text="Выбери направление и сформулируй, что будет считаться успехом" />}
      <div className="spacer" />
      {m.canEdit ? (
        <>
          <p className="muted small" style={{ margin: '0 4px' }}>До старта потока цели и задачи можно менять. После старта — нельзя: так рейтинг остаётся честным.</p>
          <button className="btn btn-primary" disabled={!ready || busy} onClick={fix}>Зафиксировать цели</button>
        </>
      ) : <button className="btn btn-primary" onClick={() => nav('/')}>На главную</button>}
    </Screen>
  );
}

const EVIDENCE = [
  ['checkbox', 'Галочка'], ['photo', 'Фото'], ['screenshot', 'Скриншот'], ['checkbox_photo', 'Галочка + фото'], ['link', 'Ссылка'],
];

/** S14: задачи цели */
export function RegTasks() {
  const { goalId = '' } = useParams();
  const nav = useNavigate();
  const { data: m, error, loading, reload } = useMembership();
  const goal = useMemo(() => m?.goals.find((g) => g.id === goalId), [m, goalId]);
  const [title, setTitle] = useState('');
  const [freq, setFreq] = useState('daily');
  const [n, setN] = useState(3);
  const [evidence, setEvidence] = useState('checkbox');
  const [criteria, setCriteria] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Screen id="S14"><Loading /></Screen>;
  if (error || !goal) return <Screen id="S14"><ErrorState error={error ?? new Error('Цель не найдена')} retry={reload} /></Screen>;

  const add = async () => {
    setBusy(true);
    try {
      const t = await api<{ evidence: string }>(`/api/goals/${goalId}/tasks`, { body: { title, frequency: freq, n: freq === 'daily' ? 1 : n, evidence, criteria: criteria || undefined } });
      if (t.evidence !== evidence) toast('По правилам категории для этой задачи нужно фото — мы поменяли тип доказательства');
      setTitle('');
      setCriteria('');
      reload();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen id="S14">
      <Header title="Задачи" sub={goal.title} back="/reg/goals" />
      {goal.tasks.map((t) => (
        <div className="card tight" key={t.id}>
          <div className="row between">
            <div className="grow"><div style={{ fontWeight: 600 }}>{t.title}</div><div className="muted small">{t.schedule} · {EVIDENCE.find(([v]) => v === t.evidence)?.[1]}</div></div>
            {m!.canEdit && <button className="icon-btn" aria-label="Удалить задачу" onClick={async () => { await api(`/api/tasks/${t.id}`, { method: 'DELETE' }).catch((x) => toast(errorText(x))); reload(); }}><Trash2 size={18} /></button>}
          </div>
        </div>
      ))}
      {m!.canEdit && (
        <div className="card">
          <div className="h3">Новая задача</div>
          <label className="field"><span>Что делаешь</span><input className="input" value={title} maxLength={120} placeholder="Например, 20 минут английского" onChange={(e) => setTitle(e.target.value)} /></label>
          <div className="field"><span>Как часто</span>
            <div className="seg">{[['daily', 'Каждый день'], ['every_n_days', 'Раз в N дней'], ['n_per_week', 'N раз в неделю']].map(([v, l]) => <button key={v} className={freq === v ? 'on' : ''} onClick={() => setFreq(v)}>{l}</button>)}</div>
          </div>
          {freq !== 'daily' && (
            <div className="row between"><span>{freq === 'every_n_days' ? 'Раз в' : 'Раз в неделю'}</span>
              <div className="row"><button className="icon-btn" onClick={() => setN(Math.max(freq === 'every_n_days' ? 2 : 1, n - 1))}>−</button><b style={{ minWidth: 24, textAlign: 'center' }}>{n}</b><button className="icon-btn" onClick={() => setN(Math.min(freq === 'n_per_week' ? 7 : 14, n + 1))}>+</button>{freq === 'every_n_days' && <span>{plural(n, 'день', 'дня', 'дней')}</span>}</div>
            </div>
          )}
          <div className="field"><span>Доказательство</span>
            <div className="chips">{EVIDENCE.map(([v, l]) => <button key={v} className={`chip ${evidence === v ? 'on' : ''}`} onClick={() => setEvidence(v)}>{l}</button>)}</div>
            {evidence === 'checkbox' && <span className="small muted">Отметка без доказательства будет помечена как «самоотчёт».</span>}
          </div>
          <label className="field"><span>Критерий выполнения (необязательно)</span><input className="input" value={criteria} maxLength={300} placeholder="Например, не меньше 20 минут" onChange={(e) => setCriteria(e.target.value)} /></label>
          <button className="btn btn-secondary" disabled={busy || title.trim().length < 2} onClick={add}><Plus size={20} /> Добавить задачу</button>
        </div>
      )}
      <div className="spacer" />
      <button className="btn btn-primary" onClick={() => nav('/reg/goals')}>Готово</button>
    </Screen>
  );
}

/** S15: точка «ДО» — фото только с отдельным согласием */
export function RegBefore() {
  const nav = useNavigate();
  const { me } = useMe();
  const { data: m, loading } = useMembership();
  const [text, setText] = useState('');
  const [metrics, setMetrics] = useState<[string, string][]>([['', '']]);
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [consent, setConsent] = useState(me!.consents.includes('sensitive_photos'));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (m?.before) {
      setText(m.before.text ?? '');
      const entries = Object.entries(m.before.metrics ?? {});
      if (entries.length) setMetrics(entries);
      setPhotos(m.before.media);
    }
  }, [m]);
  if (loading) return <Screen id="S15"><Loading /></Screen>;

  const save = async () => {
    setBusy(true);
    try {
      if (photos.length && consent && !me!.consents.includes('sensitive_photos')) await api('/api/consents', { body: { kinds: ['sensitive_photos'] } });
      await api('/api/membership/before', { method: 'PUT', body: { text: text || undefined, metrics: Object.fromEntries(metrics.filter(([k, v]) => k.trim() && v.trim())), mediaIds: consent ? photos.map((p) => p.id) : [] } });
      nav('/reg/buddy');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen id="S15">
      <Steps at="/reg/before" />
      <Header title="Точка «ДО»" sub="Чтобы в конце месяца увидеть разницу" />
      {m && !m.canEdit && <div className="banner warn">Точку «ДО» фиксируют до старта потока.</div>}
      <div className="card">
        <label className="field"><span>Где ты сейчас</span><textarea className="textarea" value={text} maxLength={2000} placeholder="Например, курю пачку в день, хочу бросить к концу месяца" onChange={(e) => setText(e.target.value)} /></label>
        <div className="field"><span>Исходные показатели</span>
          {metrics.map(([k, v], i) => (
            <div className="row" key={i}>
              <input className="input" placeholder="Показатель" value={k} maxLength={40} onChange={(e) => setMetrics(metrics.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))} />
              <input className="input" placeholder="Значение" value={v} maxLength={60} onChange={(e) => setMetrics(metrics.map((x, j) => (j === i ? [x[0], e.target.value] : x)))} />
            </div>
          ))}
          {metrics.length < 5 && <button className="btn btn-ghost btn-sm" onClick={() => setMetrics([...metrics, ['', '']])}><Plus size={16} /> Ещё показатель</button>}
        </div>
      </div>
      <div className="card">
        <div className="h3">Фото «ДО» (необязательно)</div>
        <p className="muted small" style={{ margin: 0 }}>Видны только тебе и проверке призов. В рекламе — только с отдельным согласием в отзыве.</p>
        <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>Согласен(на) на хранение моих фото «ДО/ПОСЛЕ» для проверки результата</span></label>
        <div className="photo-grid">{photos.map((p) => <img key={p.id} src={p.url} alt="Фото до" />)}</div>
        <label className={`btn btn-light ${consent ? '' : 'disabled'}`} style={{ opacity: consent ? 1 : 0.45 }}>
          <Camera size={20} /> Добавить фото
          <input type="file" accept="image/*" hidden disabled={!consent} onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try { setPhotos([...photos, await uploadImage(f)]); } catch (x) { toast(errorText(x)); }
          }} />
        </label>
      </div>
      <button className="btn btn-primary" disabled={busy} onClick={save}>Сохранить и дальше</button>
      <button className="btn btn-ghost" onClick={() => nav('/reg/buddy')}>Пропустить</button>
    </Screen>
  );
}

/** S16: бадди — пригласить друга или довериться подбору */
export function RegBuddy() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const { data, reload } = useLoad(() => api<{ state: string; buddy?: { name: string } }>('/api/buddy'));
  useEffect(() => {
    const token = sessionStorage.getItem('thirty.buddyToken');
    if (!token) return;
    sessionStorage.removeItem('thirty.buddyToken');
    api('/api/buddy/accept', { body: { token } }).then(() => { toast('Вы теперь бадди!'); reload(); }).catch((e) => toast(errorText(e)));
  }, [reload]);

  const invite = async () => {
    setBusy(true);
    try {
      const r = await api<{ url: string }>('/api/buddy/invite', { body: {} });
      shareLink(r.url, 'Пойдём вместе в «30 дней»? Будем бадди — поддерживать друг друга весь месяц');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen id="S16">
      <Header title="Твой бадди" sub="Партнёр на весь месяц: поддержка и честный взгляд со стороны" back="/" />
      {data?.state === 'paired' ? (
        <div className="banner ok">Твой бадди — {data.buddy?.name}. Познакомьтесь в Telegram!</div>
      ) : (
        <>
          <BuddyProposals onChange={reload} />
          <button className="card card-link" style={{ textAlign: 'left' }} onClick={invite} disabled={busy}>
            <div className="row"><div className="tile-icon"><UserPlus size={24} /></div><div className="grow"><div className="h3">Пригласить друга</div><div className="muted small">Друг тоже должен оплатить этот поток — пара подтверждается взаимно</div></div><ChevronRight color="var(--muted-2)" /></div>
          </button>
          <button className="card card-link" style={{ textAlign: 'left' }} onClick={() => nav('/feed?tab=people')}>
            <div className="row"><div className="tile-icon"><Users size={24} /></div><div className="grow"><div className="h3">Выбрать из участников</div><div className="muted small">Найди человека по городу и целям и предложи стать парой</div></div><ChevronRight color="var(--muted-2)" /></div>
          </button>
          {data?.state === 'invited' && <div className="banner warn">Приглашение отправлено — ждём, когда друг примет его.</div>}
          <p className="hint center">Если не выберешь бадди до старта, мы подберём его сами — по общим целям и совместимости.</p>
        </>
      )}
      <div className="spacer" />
      <button className="btn btn-primary" onClick={() => nav('/')}>Готово</button>
    </Screen>
  );
}

/** Входящие предложения стать парой: подтвердить или отклонить; исходящие — «ждём ответа» */
export function BuddyProposals({ onChange }: { onChange?: () => void }) {
  const nav = useNavigate();
  const { data, reload } = useLoad(() => api<{ incoming: { id: string; user: { id: string; name: string; city: string | null } }[]; outgoing: { id: string; user: { id: string; name: string } }[] }>('/api/buddy/proposals'));
  const [busy, setBusy] = useState<string | null>(null);
  if (!data || (!data.incoming.length && !data.outgoing.length)) return null;
  const answer = async (id: string, accept: boolean) => {
    setBusy(id);
    try {
      await api(`/api/buddy/proposals/${id}`, { body: { accept } });
      haptic(accept ? 'success' : 'light');
      toast(accept ? 'Теперь вы пара! 💜' : 'Предложение отклонено');
      reload();
      onChange?.();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {data.incoming.map((p) => (
        <div key={p.id} className="card" style={{ gap: 10, borderColor: 'var(--accent)' }}>
          <span className="row" style={{ gap: 10 }}>
            <span className="ic"><HeartHandshake size={20} /></span>
            <span className="grow"><b>{p.user.name}</b>{p.user.city ? ` · ${p.user.city}` : ''}<br /><span className="muted small">предлагает тебе стать парой 💜</span></span>
          </span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-light" style={{ minHeight: 46 }} disabled={busy === p.id} onClick={() => answer(p.id, false)}>Отклонить</button>
            <button className="btn btn-primary" style={{ minHeight: 46 }} disabled={busy === p.id} onClick={() => answer(p.id, true)}>Подтвердить</button>
          </div>
          <button className="link-btn" onClick={() => nav(`/u/${p.user.id}`)}>Посмотреть профиль</button>
        </div>
      ))}
      {data.outgoing.map((p) => (
        <div key={p.id} className="banner warn">Ты предложила стать парой: {p.user.name}. Ждём ответа.</div>
      ))}
    </>
  );
}

export function RegChats() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<{ flowChat: { id: string; title: string } | null; topicChats: { topic: string; title: string; emoji: string; id: string | null; available: boolean }[] }>('/api/club'));
  const join = async (id: string) => {
    try {
      const r = await api<{ url: string | null; joined: boolean }>(`/api/chats/${id}/invite`, { body: {} });
      if (r.joined) toast('Вы уже в этом чате');
      else if (r.url) openTelegram(r.url);
    } catch (e) {
      toast(errorText(e));
    }
  };
  return (
    <Screen id="S18">
      <Steps at="/reg/chats" />
      <Header title="Твоё окружение" sub="Вступай в чаты — бот проверит доступ и одобрит заявку" />
      {loading ? <Loading lines={2} /> : error ? <ErrorState error={error} retry={reload} /> : (
        <div className="card">
          <div className="list-item">
            <MessagesSquare size={22} color="var(--orange)" />
            <div className="grow"><div style={{ fontWeight: 600 }}>Чат моего потока</div><div className="muted small">{data!.flowChat ? data!.flowChat.title : 'Откроем ближе к старту'}</div></div>
            {data!.flowChat && <button className="btn btn-secondary btn-sm" onClick={() => join(data!.flowChat!.id)}>Вступить</button>}
          </div>
          {data!.topicChats.map((c) => (
            <div className="list-item" key={c.topic}>
              <span style={{ fontSize: 22 }}>{c.emoji}</span>
              <div className="grow">{c.title}</div>
              {c.id ? <button className="btn btn-secondary btn-sm" onClick={() => join(c.id!)}>Вступить</button> : <Lock size={17} color="var(--cell-ink)" aria-label="Закрыто" />}
            </div>
          ))}
        </div>
      )}
      <div className="spacer" />
      <button className="btn btn-primary" onClick={() => nav('/')}>Готово</button>
    </Screen>
  );
}

/** S17: ожидание старта и правила */
export function RegWaiting() {
  const nav = useNavigate();
  const { me } = useMe();
  const flow = me!.membership!.flow;
  const c = useCountdown(flow.startsOn);
  useEffect(() => {
    if (!sessionStorage.getItem('thirty.regDone')) {
      sessionStorage.setItem('thirty.regDone', '1');
      track('registration_completed', { screen: 'S17' });
    }
  }, []);
  if (c.started) return <Navigate to="/" replace />;
  return (
    <Screen id="S17">
      <Header title="Всё готово!" sub={`Старт — ${humanDate(flow.startsOn)}`} />
      <div className="card peach center">
        <div className="label">До старта</div>
        <div className="big-num">{c.d} {plural(c.d, 'день', 'дня', 'дней')} {c.h} ч</div>
      </div>
      <div className="card">
        <div className="h3">Правила потока</div>
        {[
          'Каждый день — отчёт по всем задачам до полуночи по времени потока',
          'Отчёты публичные: их видят участники клуба',
          'Пропуск снижает процент, но не исключает из клуба',
          'Задним числом отчёт сдать нельзя — только через апелляцию',
          'В конце — итоговая анкета: достигнута ли каждая цель',
        ].map((r) => <div className="feature" key={r}><Send size={16} />{r}</div>)}
      </div>
      <div className="spacer" />
      <button className="btn btn-primary" onClick={() => nav('/')}>На главную</button>
    </Screen>
  );
}
