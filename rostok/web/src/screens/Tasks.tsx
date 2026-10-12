import { useMemo, useState } from 'react';
import { SPHERES, type SphereId } from '@rostok/shared';
import { IconPlus, SphereIcon } from '../art/icons';
import type { Task } from '../api/types';
import { useApp } from '../state/app';
import { Chip, Segmented } from '../ui/kit';
import { TaskRow } from '../ui/tasks';
import { TaskWizard } from './TaskWizard';
import { TaskDetail } from './TaskDetail';
import { Challenges } from './Challenges';

type View = 'time' | 'spheres';

/** Вкладка «Задачи»: фильтры по сферам, «Сегодня» / «На этой неделе», выполненные и просроченные — отдельно; челленджи ниже. */
export function TasksScreen() {
  const { tasks } = useApp();
  const [filter, setFilter] = useState<SphereId | 'all'>('all');
  const [view, setView] = useState<View>('time');
  const [create, setCreate] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const list = useMemo(() => (tasks ?? []).filter((t) => filter === 'all' || t.sphere === filter), [tasks, filter]);
  const groups = useMemo(() => {
    const today: Task[] = [];
    const week: Task[] = [];
    const done: Task[] = [];
    const history: Task[] = [];
    for (const t of list) {
      if (t.status === 'expired') history.push(t);
      else if (t.status === 'completed') done.push(t);
      else if (t.kind === 'daily' || t.kind === 'habit') today.push(t);
      else if (t.kind === 'once' && t.deadlineSoon) today.push(t);
      else week.push(t);
    }
    return { today, week, done, history };
  }, [list]);

  return (
    <div className="mx-auto max-w-[560px] px-4 pt-safe pb-nav">
      <header className="flex items-center justify-between">
        <h1 className="text-[26px] font-bold tracking-tight">Задачи</h1>
        <button onClick={() => setCreate(true)} aria-label="Новая задача" className="grid h-11 w-11 place-items-center rounded-full bg-leaf-deep text-white shadow-lift active:scale-95">
          <IconPlus size={22} strokeWidth={2.4} />
        </button>
      </header>
      <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1">
        <Chip active={filter === 'all'} onClick={() => setFilter('all')}>Все</Chip>
        {SPHERES.map((s) => (
          <Chip key={s.id} active={filter === s.id} onClick={() => setFilter(s.id)}>
            <SphereIcon sphere={s.id} size={15} />{s.name}
          </Chip>
        ))}
      </div>
      {filter === 'all' && (
        <div className="mt-2">
          <Segmented<View> label="Группировка" value={view} onChange={setView} options={[{ value: 'time', label: 'По времени' }, { value: 'spheres', label: 'По сферам' }]} />
        </div>
      )}

      {tasks === null ? (
        <div className="mt-4 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-[104px] rounded-[20px]" />)}</div>
      ) : list.length === 0 ? (
        <EmptyTasks onCreate={() => setCreate(true)} />
      ) : view === 'spheres' && filter === 'all' ? (
        SPHERES.map((s) => {
          const ts = list.filter((t) => t.sphere === s.id && t.status === 'active');
          return ts.length ? <Section key={s.id} title={s.name} tasks={ts} onOpen={setOpen} /> : null;
        })
      ) : (
        <>
          <Section title="Сегодня" tasks={groups.today} onOpen={setOpen} />
          <Section title="На этой неделе" tasks={groups.week} onOpen={setOpen} />
          <Section title="Выполненные разовые" tasks={groups.done} onOpen={setOpen} collapsible />
          <Section title="История · сгоревшие" tasks={groups.history} onOpen={setOpen} collapsible />
        </>
      )}

      <Challenges />
      <TaskWizard open={create} onClose={() => setCreate(false)} presetSphere={filter === 'all' ? null : filter} />
      <TaskDetail taskId={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Section({ title, tasks, onOpen, collapsible }: { title: string; tasks: Task[]; onOpen: (id: number) => void; collapsible?: boolean }) {
  const [shown, setShown] = useState(!collapsible);
  if (!tasks.length) return null;
  return (
    <section className="mt-5">
      <h2 className="mb-2 flex items-center justify-between text-[15px] font-bold text-ink-soft">
        <span>{title} <span className="font-medium text-ink-mute">· {tasks.length}</span></span>
        {collapsible && <button className="text-[13px] font-semibold text-leaf-deep" onClick={() => setShown(!shown)}>{shown ? 'Скрыть' : 'Показать'}</button>}
      </h2>
      {shown && <div className="space-y-2.5">{tasks.map((t) => <TaskRow key={t.id} task={t} onOpen={(x) => onOpen(x.id)} />)}</div>}
    </section>
  );
}

function EmptyTasks({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-6 rounded-card bg-cream p-6 text-center ring-1 ring-ink-line">
      <div className="text-[17px] font-semibold">Здесь появятся твои задачи</div>
      <p className="mt-1 text-[14px] text-ink-mute">Каждая выполненная задача приносит капли дереву своей сферы.</p>
      <button onClick={onCreate} className="mt-4 rounded-btn bg-leaf-deep px-5 py-3 font-semibold text-white">Создать задачу</button>
    </div>
  );
}
