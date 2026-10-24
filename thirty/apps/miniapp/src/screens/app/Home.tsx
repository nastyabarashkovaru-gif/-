import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { HeartHandshake, MessagesSquare, BookOpen, ChevronRight, ChevronDown, ChevronUp, ArrowRight, CircleCheck, TrendingUp, ClipboardCheck, PenLine } from 'lucide-react';
import { api } from '../../lib/api';
import { AppBar, ErrorState, Loading, Screen, humanDate, plural, useLoad } from '../../ui';
import { catTitle } from '../reg/Registration';
import { ReportForm } from './Report';

interface HomeGoal {
  id: string;
  category: string;
  title: string;
  pointA: string | null;
  pointB: string | null;
  tasks: { id: string; title: string; schedule: string }[];
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
}

/** Главная: до старта — «Ты уже в команде!», после — «Твой путь к результату» с отчётом за сегодня */
export function Home() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<HomeData>('/api/home'));
  const [reportOpen, setReportOpen] = useState(false);

  if (loading && !data) return <Screen id="S19" nav><Loading /></Screen>;
  if (error || !data) return <Screen id="S19" nav><ErrorState error={error} retry={reload} /></Screen>;
  if (data.state === 'registration') return <Navigate to="/reg/goals" replace />;
  if (data.state === 'no_membership') return <Navigate to="/welcome" replace />;
  const { flow, stats } = data;
  const before = data.state === 'waiting';
  const day = stats.dayNumber ?? 0;
  const left = Math.max(0, flow.days - day);
  const dayPct = flow.days ? Math.round((day / flow.days) * 100) : 0;

  return (
    <Screen id="S19" nav>
      <AppBar />
      <div>
        <h1 className="h2" style={{ fontSize: 24 }}>{before ? 'Ты уже в команде! 💜' : data.state === 'finished' ? 'Челлендж завершён! 🎉' : 'Твой путь к результату 🚀'}</h1>
        <p className="sub" style={{ fontSize: 15 }}>{before ? 'Твои цели сохранены. Совсем скоро начинаем!' : 'Каждый день приближает тебя к результату.'}</p>
      </div>

      <div className="hero-card">
        <div className="row between">
          <span style={{ opacity: 0.9 }}>Твой челлендж</span>
          <span className="hero-pill">{before ? 'Ожидание старта' : `День ${Math.min(day, flow.days)} из ${flow.days}`}</span>
        </div>
        {before ? (
          <>
            <div className="hero-title">Старт {humanDate(flow.startsOn)}! ✨</div>
            <div style={{ opacity: 0.9 }}>Твоё обещание себе уже зафиксировано.</div>
          </>
        ) : (
          <>
            <div className="hero-title">{data.state === 'finished' ? 'Ты дошла до финиша!' : `${day}-й день. Продолжаем! 🔥`}</div>
            {data.state !== 'finished' && <div style={{ opacity: 0.9 }}>Не сбавляй темп — до финиша {plural(left, 'остался', 'осталось', 'осталось')} {left} {plural(left, 'день', 'дня', 'дней')}.</div>}
            <div className="hero-bar"><i style={{ width: `${dayPct}%` }} /></div>
            <div className="row between" style={{ fontSize: 14 }}><span>{Math.min(day, flow.days)} / {flow.days} дней</span><span>{dayPct}%</span></div>
            {!data.comparison.firstMonth && data.comparison.delta > 0 && (
              <div className="row" style={{ gap: 6, fontSize: 14 }}><TrendingUp size={15} />На {data.comparison.delta} {plural(data.comparison.delta, 'день', 'дня', 'дней')} больше, чем в предыдущем месяце</div>
            )}
          </>
        )}
      </div>

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
            </>
          ) : (
            <div className="muted">{before ? `Откроется ${humanDate(flow.startsOn)}` : 'Подбираем бадди'}</div>
          )}
          <div className="spacer" />
          {before && data.buddy.state !== 'paired' && (
            <>
              <div className="divider" />
              <button className="link-accent" style={{ alignSelf: 'flex-start', padding: 0, fontWeight: 500, textDecoration: 'underline', textUnderlineOffset: 3 }} onClick={() => nav('/reg/buddy')}>Выбрать бадди заранее</button>
            </>
          )}
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
          <div className="h3">План действий</div>
          {goal.tasks.map((t) => (
            <div className="row" key={t.id} style={{ alignItems: 'flex-start', gap: 10 }}>
              <CircleCheck size={16} color="var(--accent)" style={{ marginTop: 3 }} />
              <div><div>{t.title}</div><div className="muted small">{t.schedule.replace(/^Однократно, до/, 'До')}</div></div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
