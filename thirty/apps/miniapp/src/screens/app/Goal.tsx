import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { DayGrid, ErrorState, Header, Loading, Screen, plural, useLoad, type DayState } from '../../ui';
import { catTitle } from '../reg/Registration';

interface GoalStats {
  goal: { title: string; category: string; successCriterion: string; tasks: { id: string; title: string; selfReported: boolean }[] };
  stats: { percent: number; successfulDays: number; currentStreak: number; longestStreak: number; completed: number; scheduled: number; days: { date: string; state: DayState }[] };
  comparison: { firstMonth: boolean; baseline: number; current: number; delta: number };
  extended: { missedOccurrences: number; missedReports: number; previous: { title: string; successfulDays: number } | null } | null;
}

/** S20: карточка цели (как на макете «ЦЕЛЬ · ПРИВЫЧКИ»); расширенная статистика — с тарифа 3 месяца */
export function GoalScreen() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useLoad(() => api<GoalStats>(`/api/goals/${id}/stats`), [id]);
  if (loading) return <Screen id="S20"><Loading /></Screen>;
  if (error || !data) return <Screen id="S20"><ErrorState error={error} retry={reload} /></Screen>;
  const { goal, stats, comparison } = data;
  return (
    <Screen id="S20">
      <Header title="Цель" back="/" />
      <div className="card">
        <div className="label">Цель · {catTitle(goal.category)}</div>
        <div className="h2">{goal.title}</div>
        <div className="stats3">
          <div className="stat"><b>{stats.successfulDays}</b><span>Успешных дней</span></div>
          <div className="stat"><b>{stats.percent}%</b><span>Выполнение</span></div>
          <div className="stat"><b>{stats.currentStreak}</b><span>Текущая серия</span></div>
        </div>
        <div className="divider" />
        <div className="h3">Сравнение с прошлым месяцем</div>
        <div className="row between"><span className="muted">{comparison.firstMonth ? 'Стартовая точка' : 'Прошлый месяц'}</span><span>{comparison.baseline} успешных дней</span></div>
        <div className="row between"><span className="muted">Этот месяц</span><span className="green">{comparison.current} {plural(comparison.current, 'успешный день', 'успешных дня', 'успешных дней')}</span></div>
        <div className="delta">{comparison.delta >= 0 ? '+' : '−'}{Math.abs(comparison.delta)} {plural(Math.abs(comparison.delta), 'успешный день', 'успешных дня', 'успешных дней')} {comparison.delta >= 0 ? '↑' : '↓'}</div>
        {comparison.firstMonth && <p className="muted small" style={{ margin: 0 }}>Стартовая точка: 0. Это корректное сравнение, даже если мы не знаем, что было до вступления.</p>}
      </div>
      <div className="card">
        <div className="h3">История по дням</div>
        <DayGrid days={stats.days} />
        <div className="muted small">Цель достигнута, если: {goal.successCriterion}</div>
      </div>
      {data.extended && (
        <div className="card">
          <div className="h3">Расширенная статистика</div>
          <div className="row between"><span className="muted">Выполнено обязательств</span><span>{stats.completed} из {stats.scheduled}</span></div>
          <div className="row between"><span className="muted">Пропущено выполнений</span><span>{data.extended.missedOccurrences}</span></div>
          <div className="row between"><span className="muted">Дней без отчёта</span><span>{data.extended.missedReports}</span></div>
          <div className="row between"><span className="muted">Лучшая серия</span><span>{stats.longestStreak} {plural(stats.longestStreak, 'день', 'дня', 'дней')}</span></div>
          {data.extended.previous && <div className="row between"><span className="muted">{data.extended.previous.title}</span><span>{data.extended.previous.successfulDays} успешных дней</span></div>}
        </div>
      )}
      <div className="card">
        <div className="h3">Задачи</div>
        {goal.tasks.map((t) => <div className="list-item" key={t.id}><div className="grow">{t.title}</div>{t.selfReported && <span className="pill grey">самоотчёт</span>}</div>)}
      </div>
    </Screen>
  );
}
