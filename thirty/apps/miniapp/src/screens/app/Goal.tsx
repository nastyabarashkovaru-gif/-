import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { GOAL_CATEGORIES, Radio } from '../reg/Questionnaire';
import { api } from '../../lib/api';
import { DayGrid, ErrorState, Header, Loading, Screen, errorText, humanDate, plural, toast, useLoad, type DayState } from '../../ui';
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

interface NewAction { title: string; frequency: '' | 'daily' | 'n_per_week' | 'once'; n: number; dueDate: string }

/** Новая цель после анкеты (16.11): в текущий челлендж, в пределах тарифа; задачи — с сегодняшнего дня */
export function AddGoalScreen() {
  const nav = useNavigate();
  const home = useLoad(() => api<{ flow: { today: string; startsOn: string; endsOn: string }; canAddGoal?: boolean }>('/api/home'));
  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [pointA, setPointA] = useState('');
  const [pointB, setPointB] = useState('');
  const [actions, setActions] = useState<NewAction[]>([{ title: '', frequency: '', n: 3, dueDate: '' }]);
  const [busy, setBusy] = useState(false);
  const set = (k: number, patch: Partial<NewAction>) => setActions(actions.map((x, j) => (j === k ? { ...x, ...patch } : x)));
  if (home.loading) return <Screen id="GOAL_NEW"><Loading /></Screen>;
  if (home.error || !home.data) return <Screen id="GOAL_NEW"><ErrorState error={home.error} retry={home.reload} /></Screen>;
  const f = home.data.flow;
  const from = f.startsOn > f.today ? f.startsOn : f.today;
  const problem = !category ? 'Выбери категорию цели'
    : title.trim().length < 3 ? 'Напиши цель (от 3 символов)'
    : pointA.trim().length < 2 ? 'Заполни, где ты сейчас (точка А)'
    : pointB.trim().length < 2 ? 'Заполни, к чему придёшь (точка Б)'
    : (() => {
      const k = actions.findIndex((x) => x.title.trim().length < 2 || !x.frequency || (x.frequency === 'once' && !x.dueDate));
      if (k < 0) return null;
      const x = actions[k];
      return `Действие ${k + 1}: ${x.title.trim().length < 2 ? 'напиши, что будешь делать' : !x.frequency ? 'выбери, как часто будешь выполнять' : 'выбери дату выполнения'}`;
    })();
  const save = async () => {
    if (problem) return toast(problem);
    setBusy(true);
    try {
      await api('/api/goals/later', { body: { category, title: title.trim(), pointA: pointA.trim(), pointB: pointB.trim(), tasks: actions.map((x) => ({ title: x.title.trim(), frequency: x.frequency, n: x.frequency === 'n_per_week' ? x.n : 1, dueDate: x.frequency === 'once' ? x.dueDate : null })) } });
      toast('Цель добавлена 💜 Задачи по ней — с сегодняшнего дня');
      nav('/', { replace: true });
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen id="GOAL_NEW">
      <Header title="Новая цель" back="/" />
      {!home.data.canAddGoal ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>В твоём тарифе больше целей не добавить. Чтобы ставить больше целей, повысь тариф на главной.</p></div>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>Цель добавится в текущий челлендж. Задачи по ней начнут считаться с сегодняшнего дня — до конца твоих 30 дней.</p>
          <div className="card" style={{ gap: 10 }}>
            <span className="h3" style={{ fontSize: 16 }}>Категория</span>
            <div className="chips">{GOAL_CATEGORIES.map((c) => <button key={c.id} className={`chip ${category === c.id ? 'on' : ''}`} onClick={() => setCategory(c.id)}>{c.emoji} {c.title}</button>)}</div>
            <span className="h3" style={{ fontSize: 16 }}>Цель</span>
            <input className="input" placeholder="Например, набрать 1 000 подписчиков" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            <span className="h3" style={{ fontSize: 16 }}>Точка А — где ты сейчас</span>
            <textarea className="textarea" rows={2} maxLength={300} value={pointA} onChange={(e) => setPointA(e.target.value)} />
            <span className="h3" style={{ fontSize: 16 }}>Точка Б — к чему придёшь</span>
            <textarea className="textarea" rows={2} maxLength={300} value={pointB} onChange={(e) => setPointB(e.target.value)} />
          </div>
          {actions.map((x, k) => (
            <div className="card" key={k} style={{ gap: 10 }}>
              <div className="row between">
                <span className="h3" style={{ fontSize: 16 }}>Действие {k + 1}</span>
                {actions.length > 1 && <button className="link-btn" style={{ padding: 0 }} onClick={() => setActions(actions.filter((_, j) => j !== k))}>Удалить</button>}
              </div>
              <input className="input" placeholder="Что будешь делать" value={x.title} maxLength={160} onChange={(e) => set(k, { title: e.target.value })} />
              <span className="small" style={{ fontWeight: 600, color: 'var(--ink-2)' }}>Как часто будешь выполнять?</span>
              <div role="radiogroup">
                <Radio on={x.frequency === 'daily'} onClick={() => set(k, { frequency: 'daily' })}>Ежедневно</Radio>
                <Radio on={x.frequency === 'n_per_week'} onClick={() => set(k, { frequency: 'n_per_week' })}>X раз в неделю</Radio>
                <Radio on={x.frequency === 'once'} onClick={() => set(k, { frequency: 'once' })}>Одноразовая задача</Radio>
              </div>
              {x.frequency === 'n_per_week' && (
                <div className="n-chips" role="radiogroup">
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => <button key={n} type="button" role="radio" aria-checked={x.n === n} className={x.n === n ? 'on' : ''} onClick={() => set(k, { n })}>{n}</button>)}
                </div>
              )}
              {x.frequency === 'once' && (
                <label className="date-pick">
                  <span className="grow">{x.dueDate ? `До ${humanDate(x.dueDate)}` : 'До какой даты выполнишь?'}</span>
                  <input type="date" min={from} max={f.endsOn} value={x.dueDate} onChange={(e) => set(k, { dueDate: e.target.value })} aria-label="Дата выполнения" />
                </label>
              )}
            </div>
          ))}
          <button className="btn btn-outline" onClick={() => setActions([...actions, { title: '', frequency: '', n: 3, dueDate: '' }])}><Plus size={17} />Добавить действие</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Сохраняю…' : 'Добавить цель'}</button>
        </>
      )}
    </Screen>
  );
}
