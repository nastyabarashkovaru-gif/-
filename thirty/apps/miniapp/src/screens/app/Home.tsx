import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { HeartHandshake, MessagesSquare, BookOpen, ChevronRight, ChevronDown, ChevronUp, ArrowRight, CircleCheck, TrendingUp, ClipboardCheck, PenLine, Instagram, Copy, Download, Share2 } from 'lucide-react';
import { api } from '../../lib/api';
import { formatMetric } from '../../lib/metric';
import { AppBar, ErrorState, Loading, Screen, Sheet, errorText, humanDate, plural, toast, useLoad } from '../../ui';
import { canShareStory, downloadImage, shareLink, shareStory } from '../../lib/telegram';
import { catTitle } from '../reg/Registration';
import { ReportForm } from './Report';
import { BuddyRoulette } from './Buddy';
import { FeedbackPopup, TrackersPopup } from './Journey';
import { useMe } from '../../state';
import { haptic } from '../../lib/telegram';

interface HomeGoal {
  id: string;
  category: string;
  title: string;
  pointA: string | null;
  pointB: string | null;
  numeric: boolean;
  unit: string;
  current: number | null;
  progress: number | null;
  planPercent: number | null;
  tasks: { id: string; title: string; schedule: string; frequency?: string; n?: number }[];
}

interface HomeData {
  state: 'waiting' | 'active' | 'finished' | 'registration' | 'no_membership';
  membership: { id: string; status: string; finalSubmittedAt: string | null };
  flow: { title: string; startsOn: string; endsOn: string; days: number; today: string; phase: string };
  stats: { percent: number; successfulDays: number; dayNumber: number | null };
  comparison: { firstMonth: boolean; baseline: number; current: number; delta: number };
  goals: HomeGoal[];
  todayReported: boolean;
  buddy: { state: 'paired'; buddy: { id: string; name: string; photoUrl: string | null; percent: number | null; writeUrl: string } } | { state: 'waiting' | 'invited' };
  month?: number;
  serverNow?: string;
  prompts?: { feedback: boolean; feedbackPopup: boolean; feedbackDone: boolean; finale: boolean; finaleDone: boolean; trackers: boolean; trackersClarify?: boolean };
}

/** Плашка «какой по счёту месяц дисциплины» — всегда наверху главной */
function monthPill(n: number) {
  return n <= 1 ? '💜 Твой первый месяц дисциплины — начало пути!' : `🔥 Это уже твой ${n}-й месяц дисциплины. Так держать, продолжай!`;
}

/** Окно показываем один раз в день на участие; закрыть можно — вернуться к форме помогает карточка на главной */
function useOncePerDay(key: string | null, want: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!key || !want) return;
    const k = `thirty.popup.${key}.${new Date().toISOString().slice(0, 10)}`;
    try {
      if (localStorage.getItem(k)) return;
      localStorage.setItem(k, '1');
    } catch {
      /* без хранилища — просто показываем */
    }
    setOpen(true);
  }, [key, want]);
  return [open, () => setOpen(false)] as const;
}

/** Главная: до старта — «Ты уже в команде!», после — «Твой путь к результату» с отчётом за сегодня */
export function Home() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<HomeData>('/api/home'));
  // Переход из уведомления «Пора сдать отчёт!» сразу открывает форму
  const loc = useLocation();
  const [share, setShare] = useState(false);
  const [reportOpen, setReportOpen] = useState(() => new URLSearchParams(loc.search).get('report') === '1');
  const [roulette, setRoulette] = useState(false);
  const [startSheet, setStartSheet] = useState(() => new URLSearchParams(loc.search).get('start') === '1');
  const { me, refresh } = useMe();
  const p = data?.prompts;
  const [feedbackOpen, closeFeedback] = useOncePerDay(data ? `feedback.${data.membership.id}` : null, Boolean(p?.feedbackPopup));
  // Окно трекеров не накладывается на окно обратной связи
  const [trackersOpen, closeTrackers] = useOncePerDay(data ? `trackers.${data.membership.id}` : null, Boolean(p?.trackers && !p.feedbackPopup));

  if (loading && !data) return <Screen id="S19" nav><Loading /></Screen>;
  if (error || !data) return <Screen id="S19" nav><ErrorState error={error} retry={reload} /></Screen>;
  if (data.state === 'registration') return <RegistrationHome />;
  if (data.state === 'no_membership') return <Navigate to="/tariffs" replace />;
  const { flow, stats } = data;
  const before = data.state === 'waiting';
  const day = stats.dayNumber ?? 0;
  const left = Math.max(0, flow.days - day);
  const dayPct = flow.days ? Math.round((day / flow.days) * 100) : 0;

  return (
    <Screen id="S19" nav>
      <AppBar />
      <span className="month-pill">{monthPill(data.month ?? 1)}</span>
      <div>
        <h1 className="h2" style={{ fontSize: 24 }}>{before ? `Твой челлендж начинается ${humanDate(flow.startsOn)}! 💜` : data.state === 'finished' ? 'Челлендж завершён! 🎉' : `Сегодня твой ${day}-й день из ${flow.days} 💜`}</h1>
        <p className="sub" style={{ fontSize: 15 }}>{before ? 'Скоро начнутся твои 30 дней. А пока — бадди, чаты и материалы клуба уже доступны.' : 'Каждый день приближает тебя к результату.'}</p>
      </div>

      <div className="hero-card">
        <div className="row between">
          <span style={{ opacity: 0.9 }}>{before ? 'До старта' : 'Твой челлендж'}</span>
          <span className={`hero-pill${before ? ' green' : ''}`}>{before ? 'Ожидание старта' : p?.finale ? 'Финиш 🏁' : `День ${Math.min(day, flow.days)} из ${flow.days}`}</span>
        </div>
        {before ? (
          <>
            <StartCountdown startsOn={flow.startsOn} serverNow={data.serverNow} />
            <div style={{ opacity: 0.9 }}>Старт {humanDate(flow.startsOn)}. Твоё обещание себе уже зафиксировано ✨</div>
            {me?.membership?.canChangeStart && <button className="btn hero-btn" onClick={() => setStartSheet(true)}>📅 Изменить дату старта</button>}
          </>
        ) : p?.finale ? (
          <>
            {/* Последний день и после: вместо «осталось 0 дней» — итоги и новый челлендж */}
            <div className="hero-title">Ты прошла 30 дней! 🎉</div>
            <div style={{ opacity: 0.9 }}>{p.finaleDone ? 'Итоги подведены — самое время поставить новую цель 💜' : 'Подведи итоги месяца и начни новый челлендж 💜'}</div>
            <button className="btn hero-btn" onClick={() => nav('/finale')}>Начать новый челлендж<ArrowRight size={17} /></button>
          </>
        ) : (
          <>
            <div className="hero-title">{data.state === 'finished' ? 'Ты дошла до финиша!' : `${day}-й день. Продолжаем! 🔥`}</div>
            {data.state !== 'finished' && <div style={{ opacity: 0.9 }}>Не сбавляй темп — до финиша {plural(left, 'остался', 'осталось', 'осталось')} {left} {plural(left, 'день', 'дня', 'дней')}.</div>}
            <div className="hero-bar"><i style={{ width: `${dayPct}%` }} /></div>
            <div className="row between" style={{ fontSize: 14 }}><span>{Math.min(day, flow.days)} / {flow.days} дней</span><span>{dayPct}%</span></div>
          </>
        )}
      </div>

      {!before && data.state === 'active' && !p?.finale && me?.membership?.canChangeStart && (
        <button className="link-accent" style={{ alignSelf: 'center' }} onClick={() => setStartSheet(true)}>🔄 Начать заново или изменить дату старта</button>
      )}
      {p?.feedback && (
        <button className="home-cta-card feedback-cta" onClick={() => nav('/feedback')}>
          <span className="em">🥹</span>
          <span className="grow"><b style={{ display: 'block', fontSize: 16 }}>Как прошли твои 30 дней?</b><span className="muted" style={{ fontSize: 14 }}>Поделись обратной связью — это 2 минуты</span></span>
          <ChevronRight size={20} color="var(--accent)" />
        </button>
      )}
      {p?.trackersClarify && (
        <button className="home-cta-card trackers-cta" onClick={() => nav('/trackers')}>
          <span className="em">🔄</span>
          <span className="grow"><b style={{ display: 'block', fontSize: 16 }}>Загрузи новый скриншот отзыва</b><span className="muted" style={{ fontSize: 14 }}>И мы сразу пришлём трекеры</span></span>
          <ChevronRight size={20} color="var(--accent)" />
        </button>
      )}
      {p?.trackers && !p.feedback && (
        <button className="home-cta-card trackers-cta" onClick={() => nav('/trackers')}>
          <span className="em">🎁</span>
          <span className="grow"><b style={{ display: 'block', fontSize: 16 }}>Получи трекеры за свой отзыв</b><span className="muted" style={{ fontSize: 14 }}>Три трекера в Google Таблицах</span></span>
          <ChevronRight size={20} color="var(--accent)" />
        </button>
      )}
      <FeedbackPopup open={feedbackOpen} onClose={closeFeedback} />
      <TrackersPopup open={trackersOpen} onClose={closeTrackers} />
      {!before && !data.comparison.firstMonth && data.comparison.delta > 0 && (
        <div className="growth-note"><TrendingUp size={15} />На {data.comparison.delta} {plural(data.comparison.delta, 'день', 'дня', 'дней')} больше, чем в предыдущем месяце!</div>
      )}
      {before && <button className="link-accent story-link" onClick={() => setShare(true)}><Instagram size={17} />А пока поделись в сторис, что ты идёшь на наш челлендж! 😍</button>}
      <StorySheet open={share} onClose={() => setShare(false)} />
      {startSheet && me?.membership?.canChangeStart && (
        <ChangeStartSheet today={flow.today} active={!before} onClose={() => setStartSheet(false)}
          onDone={async (refill) => { setStartSheet(false); await refresh(); if (refill) nav('/reg/goals'); else reload(); }} />
      )}
      {data.state === 'active' && (
        <div className="card" style={{ gap: 10 }}>
          <div className="row between">
            <span className="row h3" style={{ gap: 8, fontSize: 17 }}><ClipboardCheck size={19} color="var(--accent)" />Отчёт за сегодня</span>
            <span className="small" style={{ color: data.todayReported ? 'var(--green)' : 'var(--muted-2)' }}>{data.todayReported ? 'Отправлен' : 'Не отправлен'}</span>
          </div>
          {data.todayReported ? (
            <div className="row" style={{ gap: 8, color: 'var(--green)' }}><CircleCheck size={17} />Отчёт за сегодня отправлен. Так держать!</div>
          ) : (
            <>
              <p className="muted" style={{ margin: 0 }}>Отметь действия и обязательно прикрепи фото.</p>
              <button className="btn btn-primary" onClick={() => setReportOpen(!reportOpen)}><PenLine size={18} />Заполнить отчёт</button>
              {reportOpen && <ReportForm onSent={() => { setReportOpen(false); reload(); }} />}
            </>
          )}
          {/* Суть ежедневной отчётности: только за сегодня */}
          <div className="report-rule">⏰ Отчёт можно отправить только за сегодня — прикрепить задним числом за вчера не получится</div>
        </div>
      )}

      <div className="row between" style={{ marginTop: 6 }}>
        <h2 className="h2" style={{ fontSize: 22 }}>Мои цели 🎯</h2>
        <span className="pill green">{data.goals.length} {plural(data.goals.length, 'цель', 'цели', 'целей')}</span>
      </div>
      {data.goals.map((g, i) => <GoalItem key={g.id} goal={g} n={i + 1} />)}

      <div className="grid2" style={{ alignItems: 'stretch' }}>
        <div className="card" style={{ gap: 8 }}>
          <span className="row h3" style={{ gap: 8 }}><HeartHandshake size={20} color="var(--accent)" />Мой бадди</span>
          {data.buddy.state === 'paired' ? (
            <>
              <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{data.buddy.buddy.name}</div>
              <button className="link-accent" style={{ alignSelf: 'flex-start', padding: 0, fontWeight: 500 }} onClick={() => nav(`/u/${(data.buddy as { buddy: { id: string } }).buddy.id}`)}>Посмотреть профиль</button>
              <div className="spacer" />
              <div className="divider" />
              <button className="link-accent" style={{ alignSelf: 'flex-start', padding: 0, fontWeight: 500, color: 'var(--muted)' }} onClick={() => nav('/buddy?replace=1')}>Заменить бадди</button>
            </>
          ) : (
            <>
              {(data.buddy as { mode?: string | null }).mode === 'auto' && <div className="muted small">Ищем тебе бадди 💜</div>}
              <button className="btn btn-primary" style={{ minHeight: 42, fontSize: 14, padding: '0 10px' }} onClick={() => setRoulette(true)}>🎲 Подобрать пару</button>
              <button className="link-accent" style={{ alignSelf: 'flex-start', padding: 0, fontWeight: 500, fontSize: 14 }} onClick={() => nav('/buddy')}>Выбрать самой</button>
              {roulette && <BuddyRoulette onClose={() => { setRoulette(false); reload(); }} />}
            </>
          )}
          <div className="spacer" />

        </div>
        <button className="card card-link" style={{ gap: 8, textAlign: 'left' }} onClick={() => nav('/club')}>
          <span className="row h3" style={{ gap: 8 }}><MessagesSquare size={20} color="var(--accent)" />Моё сообщество</span>
          <span style={{ color: 'var(--ink-2)' }}>Твои чаты</span>
          <span className="muted small">Общение и созвоны</span>
          <span className="spacer" />
          <span className="row" style={{ gap: 4, color: 'var(--accent)', fontWeight: 500 }}>Перейти <ArrowRight size={15} /></span>
        </button>
      </div>
      <button className="card card-link" style={{ flexDirection: 'row', alignItems: 'center', textAlign: 'left' }} onClick={() => nav('/materials')}>
        <BookOpen size={20} color="var(--accent)" />
        <span className="grow"><span className="h3" style={{ display: 'block' }}>Полезные материалы</span><span className="muted small">Гайды, обучение, подкасты</span></span>
        <ChevronRight size={18} color="var(--accent)" />
      </button>
    </Screen>
  );
}

/** Действие плана; у «X раз в неделю» число можно поменять прямо здесь (с текущей недели) */
function TaskRow({ t }: { t: HomeGoal['tasks'][number] }) {
  const [edit, setEdit] = useState(false);
  const [n, setN] = useState(t.n ?? 3);
  const [saved, setSaved] = useState(t.n ?? 3);
  const [busy, setBusy] = useState(false);
  const weekly = t.frequency === 'n_per_week';
  const label = weekly ? `${saved} ${plural(saved, 'раз', 'раза', 'раз')} в неделю` : t.schedule.replace(/^Однократно, до/, 'До');
  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/tasks/${t.id}/per-week`, { body: { n } });
      setSaved(n);
      setEdit(false);
      toast('Готово! Новая норма — с этой недели 💜');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
      <CircleCheck size={16} color="var(--accent)" style={{ marginTop: 3 }} />
      <div className="grow">
        <div>{t.title}</div>
        <div className="muted small">{label}{weekly && !edit && <button className="link-accent" style={{ padding: 0, marginLeft: 8, fontSize: 13, fontWeight: 600 }} onClick={() => setEdit(true)}>Изменить</button>}</div>
        {edit && (
          <div className="col" style={{ gap: 8, marginTop: 8 }}>
            <div className="n-chips" role="radiogroup">
              {[1, 2, 3, 4, 5, 6, 7].map((k) => <button key={k} type="button" role="radio" aria-checked={n === k} className={n === k ? 'on' : ''} onClick={() => setN(k)}>{k}</button>)}
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" style={{ minHeight: 42 }} disabled={busy || n === saved} onClick={save}>{busy ? 'Сохраняю…' : `Сохранить: ${n} ${plural(n, 'раз', 'раза', 'раз')} в неделю`}</button>
              <button className="btn btn-ghost" style={{ minHeight: 42, width: 'auto' }} onClick={() => { setN(saved); setEdit(false); }}>Отмена</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GoalItem({ goal, n }: { goal: HomeGoal; n: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card" style={{ gap: 12 }}>
      <button className="row" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', alignItems: 'flex-start' }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ic sq" style={{ width: 40, height: 40, borderRadius: 12, fontSize: 18, fontWeight: 600 }}>{n}</span>
        <span className="grow">
          <span className="muted small" style={{ display: 'block' }}>Цель {n} · {catTitle(goal.category)}</span>
          <span className="h3" style={{ display: 'block', fontSize: 16, marginTop: 2 }}>{goal.title}</span>
        </span>
        {open ? <ChevronUp size={18} color="var(--accent)" /> : <ChevronDown size={18} color="var(--accent)" />}
      </button>
      {open && (
        <>
          <div className="divider" />
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div className="grow"><div className="label" style={{ color: 'var(--muted)' }}>Точка А</div><div style={{ marginTop: 4 }}>{goal.pointA ?? '—'}</div></div>
            <ArrowRight size={15} color="var(--muted-2)" style={{ marginTop: 14 }} />
            <div className="grow" style={{ textAlign: 'right' }}><div className="label" style={{ color: 'var(--accent)' }}>Точка Б</div><div style={{ marginTop: 4, color: 'var(--accent-ink)', fontWeight: 600 }}>{goal.pointB ?? '—'}</div></div>
          </div>
          <GoalProgress goal={goal} />
          <div className="h3">План действий</div>
          {goal.tasks.map((t) => <TaskRow key={t.id} t={t} />)}
        </>
      )}
    </div>
  );
}

/** Прогресс цели: для числовых — по «Текущему результату» между точками А и Б, для остальных — по выполненным действиям */
function GoalProgress({ goal }: { goal: HomeGoal }) {
  if (goal.numeric) {
    if (goal.current === null || goal.progress === null) return <div className="muted small">Укажи «Текущий результат» в ежедневном отчёте — здесь появится прогресс.</div>;
    return (
      <div className="col" style={{ gap: 8 }}>
        <div className="row between"><span className="muted">Сейчас: {formatMetric(goal.current, goal.unit)}</span><b style={{ color: 'var(--accent)' }}>{goal.progress}% пути</b></div>
        <div className="bar soft"><i style={{ width: `${goal.progress}%` }} /></div>
      </div>
    );
  }
  if (goal.planPercent === null) return null;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row between"><span className="muted">Выполнено действий</span><b style={{ color: 'var(--accent)' }}>{goal.planPercent}%</b></div>
      <div className="bar soft"><i style={{ width: `${goal.planPercent}%` }} /></div>
    </div>
  );
}

/** Обратный отсчёт до старта: дни и часы, обновляется раз в минуту */
function StartCountdown({ startsOn, serverNow }: { startsOn: string; serverNow?: string }) {
  // Разница часов телефона и сервера — отсчёт идёт по времени сервера
  const [skew] = useState(() => (serverNow ? new Date(serverNow).getTime() - Date.now() : 0));
  const [now, setNow] = useState(Date.now() + skew);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + skew), 60_000);
    return () => clearInterval(t);
  }, [skew]);
  const ms = Math.max(0, new Date(`${startsOn}T00:00:00+03:00`).getTime() - now);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return (
    <div className="hero-title">
      {d > 0 && <>{d} {plural(d, 'день', 'дня', 'дней')} </>}{h} {plural(h, 'час', 'часа', 'часов')}{d === 0 && <> {m} мин</>} ✨
    </div>
  );
}

/** Карточка для сторис «Я иду на челлендж»: скопировать ссылку, скачать, поделиться */
const isoPlus = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Смена даты старта в любой момент (05.11): перенос, «начать заново» посреди челленджа или новая анкета */
function ChangeStartSheet({ today, active, onClose, onDone }: { today: string; active: boolean; onClose: () => void; onDone: (refill: boolean) => Promise<void> }) {
  // посреди челленджа сегодняшний отчёт часто уже сдан — по умолчанию завтра
  const [date, setDate] = useState(active ? isoPlus(today, 1) : today);
  const [busy, setBusy] = useState(false);
  const max = isoPlus(today, 90);
  const save = async () => {
    setBusy(true);
    try {
      await api('/api/membership/change-start', { body: { date } });
      haptic('success');
      toast(date === today ? 'Твой челлендж начался! 🔥' : `Готово! Старт ${humanDate(date)} 💜`);
      await onDone(false);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const refill = async () => {
    if (!window.confirm('Заполнить анкету заново? Цели и план можно будет поменять, дату старта выберешь в конце анкеты.')) return;
    setBusy(true);
    try {
      await api('/api/membership/refill', { body: {} });
      await onDone(true);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open onClose={onClose}>
      <div className="col" style={{ gap: 12 }}>
        <h2 className="h2" style={{ fontSize: 22 }}>{active ? 'Начать челлендж заново 🔄' : 'Изменить дату старта 📅'}</h2>
        {active && <div className="panel small" style={{ padding: 12 }}>Выбери новую дату — твои 30 дней начнутся с неё. Прогресс за прошедшие дни обнулится, отчёты останутся в ленте.</div>}
        <label className="field"><span className="row" style={{ gap: 8, fontWeight: 600 }}>📅 Выбери дату старта</span>
          <input className="input" type="date" value={date} min={today} max={max} onChange={(e) => setDate(e.target.value)} />
        </label>
        {date && <div className="panel small" style={{ padding: 12 }}>Твои 30 дней: {humanDate(date)} — {humanDate(isoPlus(date, 29))}{date === today ? ' · начинаешь сегодня 🔥' : ''}</div>}
        <button className="btn btn-primary" disabled={busy || !date || date < today || date > max} onClick={save}>Сохранить</button>
        <button className="link-btn" disabled={busy} onClick={refill}>Хочу заполнить анкету заново</button>
      </div>
    </Sheet>
  );
}

export function StorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [card, setCard] = useState<{ imageUrl: string; account: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    if (!open || card) return;
    void api<{ imageUrl: string; account: string }>('/api/story-card').then(setCard).catch(() => undefined);
    void api<{ url: string }>('/api/referral').then((r) => setLink(r.url)).catch(() => undefined);
  }, [open, card]);
  const text = 'Я иду на челлендж «30 дней» 🚀 Присоединяйся!';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link ? `${text} ${link}` : text);
      toast('Скопировано 💜');
    } catch {
      toast('Не получилось скопировать');
    }
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="h3 center" style={{ fontSize: 18 }}>Поделись, что ты идёшь на челлендж 🚀</div>
      <p className="muted small center" style={{ margin: 0 }}>Впиши свои цели на карточку и выложи в сторис{card?.account ? <> с отметкой <b>@{card.account}</b></> : null}.</p>
      {card ? <img src={card.imageUrl} alt="Карточка для сторис" className="story-preview" /> : <div className="skeleton" style={{ height: 320, width: '55%', alignSelf: 'center' }} />}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-secondary" onClick={copy}><Copy size={17} />Скопировать</button>
        <button className="btn btn-secondary" disabled={!card} onClick={() => card && downloadImage(card.imageUrl, '30-dney-story.png')}><Download size={17} />Скачать</button>
      </div>
      <button className="btn btn-primary" disabled={!card} onClick={() => {
        if (!card) return;
        if (canShareStory()) shareStory(card.imageUrl, link ?? 'https://t.me/Dney30_bot');
        else shareLink(link ?? 'https://t.me/Dney30_bot', text);
      }}><Share2 size={17} />Поделиться</button>
    </Sheet>
  );
}

/** Анкета ещё не заполнена: после оплаты человек сразу в приложении, участие начинается после анкеты (решение владельца 03.11) */
function RegistrationHome() {
  const nav = useNavigate();
  return (
    <Screen id="S19" nav>
      <AppBar />
      <div>
        <h1 className="h2" style={{ fontSize: 24 }}>Добро пожаловать в клуб! 💜</h1>
        <p className="sub" style={{ fontSize: 15 }}>Остался один шаг до старта твоего челленджа.</p>
      </div>
      <div className="hero-card">
        <div className="hero-title">Заполни свою анкету, чтобы начать участие в челлендже ✨</div>
        <div style={{ opacity: 0.92 }}>Поставь цели, распиши ежедневные действия, выбери дату старта и найди бадди — это займёт 5–7 минут.</div>
        <button className="btn hero-btn" onClick={() => nav('/reg/about')}>Заполнить анкету<ArrowRight size={17} /></button>
      </div>
      <button className="card card-link" style={{ flexDirection: 'row', alignItems: 'center', textAlign: 'left' }} onClick={() => nav('/club')}>
        <MessagesSquare size={20} color="var(--accent)" />
        <span className="grow"><span className="h3" style={{ display: 'block' }}>Моё сообщество</span><span className="muted small">Чаты и созвоны клуба</span></span>
        <ChevronRight size={18} color="var(--accent)" />
      </button>
      <button className="card card-link" style={{ flexDirection: 'row', alignItems: 'center', textAlign: 'left' }} onClick={() => nav('/materials')}>
        <BookOpen size={20} color="var(--accent)" />
        <span className="grow"><span className="h3" style={{ display: 'block' }}>Полезные материалы</span><span className="muted small">Гайды, обучение, подкасты</span></span>
        <ChevronRight size={18} color="var(--accent)" />
      </button>
    </Screen>
  );
}
