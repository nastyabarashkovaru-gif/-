import { Navigate, useNavigate } from 'react-router-dom';
import { CircleCheck, Send, SlidersHorizontal, TrendingUp, User, Clock, Trophy, Sparkles } from 'lucide-react';
import { api } from '../../lib/api';
import { openTelegram } from '../../lib/telegram';
import { useMe } from '../../state';
import { Bar, DayGrid, ErrorState, Loading, Screen, humanDate, plural, useLoad, type DayState } from '../../ui';
import { catTitle } from '../reg/Registration';

interface HomeData {
  state: 'waiting' | 'active' | 'finished' | 'registration' | 'no_membership';
  membership: { id: string; status: string; finalSubmittedAt: string | null };
  flow: { title: string; startsOn: string; endsOn: string; days: number; today: string; phase: string };
  stats: { percent: number; ratio: number; successfulDays: number; completed: number; scheduled: number; missedReports: number; currentStreak: number; dayNumber: number | null; days: { date: string; state: DayState }[] };
  comparison: { firstMonth: boolean; baseline: number; current: number; delta: number };
  goals: { id: string; category: string; title: string; tasks: { id: string; title: string; schedule: string }[] }[];
  todayReported: boolean;
  buddy: { state: 'paired'; buddy: { name: string; photoUrl: string | null; percent: number | null; writeUrl: string } } | { state: 'waiting' | 'invited' };
}

/** S19: главная — только личный прогресс (как на утверждённом макете) */
export function Home() {
  const nav = useNavigate();
  const { me } = useMe();
  const { data, error, loading, reload } = useLoad(() => api<HomeData>('/api/home'));

  if (loading) return <Screen id="S19" nav><Loading /></Screen>;
  if (error || !data) return <Screen id="S19" nav><ErrorState error={error} retry={reload} /></Screen>;
  if (data.state === 'registration') return <Navigate to="/reg/profile" replace />;
  const { flow, stats } = data;
  const upcoming = data.state === 'waiting';
  const daysToStart = Math.max(0, Math.ceil((new Date(`${flow.startsOn}T00:00:00+03:00`).getTime() - Date.now()) / 86400_000));

  return (
    <Screen id="S19" nav>
      <div className="screen-head">
        <div>
          <h1 className="h1">Мои 30 дней</h1>
          <p className="sub">{humanDate(flow.startsOn)} — {humanDate(flow.endsOn)}</p>
        </div>
        <button className="icon-btn" aria-label="Мои цели и задачи" onClick={() => nav('/reg/goals')}><SlidersHorizontal size={20} /></button>
      </div>

      {upcoming && (
        <div className="card peach">
          <div className="row"><Clock size={22} color="var(--orange)" /><div className="grow"><div className="h3">Поток «{flow.title}» стартует {humanDate(flow.startsOn)}</div><div className="muted small">Осталось {daysToStart} {plural(daysToStart, 'день', 'дня', 'дней')}. Цели можно поправить до старта.</div></div></div>
        </div>
      )}

      <div className="card">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="label">Твой прогресс</div>
            <div className="big-num" style={{ whiteSpace: 'nowrap' }}>{stats.successfulDays} из {flow.days} {plural(flow.days, 'дня', 'дней', 'дней')}</div>
          </div>
          <div className="badge-pct">{stats.percent}%</div>
        </div>
        <Bar value={stats.ratio} />
        <DayGrid days={stats.days} />
        <div className="row green small"><TrendingUp size={18} /> {stats.successfulDays} {plural(stats.successfulDays, 'успешный день', 'успешных дня', 'успешных дней')} в этом месяце</div>
      </div>

      {!upcoming && (
        <div className="card">
          <div className="h3">Сравнение с прошлым месяцем</div>
          <div className="row between"><span className="muted">{data.comparison.firstMonth ? 'Стартовая точка' : 'Прошлый месяц'}</span><span>{data.comparison.baseline} успешных дней</span></div>
          <div className="row between"><span className="muted">Этот месяц</span><span className="green">{data.comparison.current} {plural(data.comparison.current, 'успешный день', 'успешных дня', 'успешных дней')}</span></div>
          <div className="delta">{data.comparison.delta >= 0 ? '+' : '−'}{Math.abs(data.comparison.delta)} {plural(Math.abs(data.comparison.delta), 'успешный день', 'успешных дня', 'успешных дней')} {data.comparison.delta >= 0 ? '↑' : '↓'}</div>
          {data.comparison.firstMonth && <p className="muted small" style={{ margin: 0 }}>Первый месяц: считаем от стартовой точки 0 — мы не знаем, что было до вступления.</p>}
        </div>
      )}

      {data.goals.map((g) => (
        <div className="card card-link" key={g.id} onClick={() => nav(`/goal/${g.id}`)}>
          <div className="row between"><div className="h3">Моя цель</div><span className="pill">{catTitle(g.category).split(' ')[0]}</span></div>
          <div className="h2" style={{ fontWeight: 600 }}>{g.title}</div>
          {g.tasks.slice(0, 3).map((t) => (
            <div className="row muted" key={t.id}><CircleCheck size={20} color={data.todayReported ? 'var(--green)' : '#cfccc6'} /> {t.title} <span className="small">· {t.schedule.toLowerCase()}</span></div>
          ))}
        </div>
      ))}

      {data.state === 'active' && (
        data.todayReported
          ? <button className="btn btn-secondary" onClick={() => nav('/report')}><CircleCheck size={20} /> Отчёт сдан — дополнить</button>
          : <button className="btn btn-primary" onClick={() => nav('/report')}>Сдать отчёт за сегодня</button>
      )}
      {data.state === 'finished' && !data.membership.finalSubmittedAt && (
        <button className="btn btn-primary" onClick={() => nav('/final')}><Trophy size={20} /> Подвести итоги месяца</button>
      )}

      <div className="card">
        <div className="h3">Мой бадди</div>
        {data.buddy.state === 'paired' ? (
          <div className="row">
            <div className="ava lg">{data.buddy.buddy.photoUrl ? <img src={data.buddy.buddy.photoUrl} alt="" /> : <User size={24} />}</div>
            <div className="grow card-link" onClick={() => nav('/buddy')}>
              <div className="h3">{data.buddy.buddy.name}</div>
              {data.buddy.buddy.percent !== null && <div className="green">Прогресс: {data.buddy.buddy.percent}%</div>}
            </div>
            <button className="icon-btn peach" aria-label="Написать бадди" onClick={() => openTelegram((data.buddy as { buddy: { writeUrl: string } }).buddy.writeUrl)}><Send size={18} /></button>
          </div>
        ) : (
          <div className="row card-link" onClick={() => nav('/reg/buddy')}>
            <div className="ava lg"><Sparkles size={22} /></div>
            <div className="grow"><div style={{ fontWeight: 600 }}>{data.buddy.state === 'invited' ? 'Ждём ответа друга' : 'Подбираем бадди'}</div><div className="muted small">Подбор завершится до старта потока</div></div>
          </div>
        )}
      </div>
      {me?.user.sixMonthBadge && <div className="pill green" style={{ alignSelf: 'center' }}>🏅 Участник 6 месяцев</div>}
    </Screen>
  );
}
