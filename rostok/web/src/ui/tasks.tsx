import { motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sphereById } from '@rostok/shared';
import { IconCheck, IconGift, IconLock, SphereIcon } from '../art/icons';
import { ApiError, api } from '../api/client';
import type { HistoryCell, Task } from '../api/types';
import { useApp } from '../state/app';
import { cx, useToast } from './kit';
import { deadlineLeft, frequencyLabel } from '../lib/format';
import { haptic } from '../lib/telegram';

/** Действия с задачами: сервер — единственный источник истины о каплях. */
export function useTaskActions() {
  const { setTasks, refreshGarden } = useApp();
  const toast = useToast();
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const apply = (t: Task) => setTasks((list) => list.map((x) => (x.id === t.id ? t : x)));
  const complete = useCallback(async (t: Task) => {
    if (pending[t.id]) return;
    setPending((p) => ({ ...p, [t.id]: true }));
    haptic.light();
    try {
      const r = await api<{ already: boolean; drops: number; task: Task; unlocked?: { threshold: number }[] }>('POST', `/tasks/${t.id}/complete`);
      apply(r.task);
      if (!r.already) toast(`+${r.drops} 💧 дереву «${sphereById(t.sphere)?.name}»`, 'ok');
      if (r.unlocked?.length) { haptic.success(); toast('🎁 Подарок открыт! Загляни в задачу', 'ok'); }
      refreshGarden().catch(() => {});
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не получилось отметить', 'error');
    } finally {
      setPending((p) => ({ ...p, [t.id]: false }));
    }
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const checkin = useCallback(async (t: Task, answer: 'yes' | 'no') => {
    if (pending[t.id]) return;
    setPending((p) => ({ ...p, [t.id]: true }));
    haptic.light();
    try {
      const r = await api<{ changed: boolean; amount: number; task: Task }>('POST', `/tasks/${t.id}/habit-checkin`, { answer });
      apply(r.task);
      if (r.changed && r.amount > 0) toast(`+${r.amount} 💧 дереву здоровья`, 'ok');
      else if (r.changed && answer === 'yes') toast('Записано. Завтра — новый день 🌱', 'info');
      refreshGarden().catch(() => {});
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не получилось сохранить ответ', 'error');
    } finally {
      setPending((p) => ({ ...p, [t.id]: false }));
    }
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  return { complete, checkin, pending, apply };
}

const CELL_W = 36;

/**
 * Мини-линия дней под задачей: горизонтальная прокрутка, ✓ — выполнено, красная точка — пропуск,
 * кружок — будущее/не подлежит выполнению. Длинная история виртуализируется (рендерятся только видимые ячейки).
 */
export function DayLine({ cells, compact = true }: { cells: HistoryCell[]; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([Math.max(0, cells.length - 20), cells.length]);
  const todayIdx = useMemo(() => {
    const i = cells.findIndex((c) => c.status === 'today' || (c.status !== 'future' && cells[cells.indexOf(c) + 1]?.status === 'future'));
    return i >= 0 ? i : cells.length - 1;
  }, [cells]);
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const w = cells[0]?.key.startsWith('W:') ? 64 : CELL_W;
    const start = Math.max(0, Math.floor(el.scrollLeft / w) - 6);
    const end = Math.min(cells.length, Math.ceil((el.scrollLeft + el.clientWidth) / w) + 6);
    setRange([start, end]);
  }, [cells]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = cells[0]?.key.startsWith('W:') ? 64 : CELL_W;
    el.scrollLeft = Math.max(0, (todayIdx + 1) * w - el.clientWidth + w * 2);
    update();
  }, [cells.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cells.length) return null;
  const weekly = cells[0].key.startsWith('W:');
  const w = weekly ? 64 : CELL_W;
  return (
    <div ref={ref} onScroll={update} className="no-scrollbar -mx-1 overflow-x-auto overscroll-x-contain" style={{ touchAction: 'pan-x' }}
      role="list" aria-label="История выполнений">
      <div className="relative" style={{ width: cells.length * w, height: compact ? 40 : 52 }}>
        {cells.slice(range[0], range[1]).map((c, k) => {
          const i = range[0] + k;
          return (
            <div key={c.key} role="listitem" className="absolute top-0 flex flex-col items-center" style={{ left: i * w, width: w }}
              aria-label={`${c.label} ${c.sub ?? ''}: ${statusText(c)}`}>
              <CellMark c={c} weekly={weekly} />
              <span className={cx('mt-0.5 text-[10px] leading-none tabular-nums', c.status === 'today' ? 'font-bold text-leaf-deep' : 'text-ink-mute')}>
                {weekly ? c.label : c.label}
              </span>
              {!compact && c.sub && <span className="text-[9px] leading-tight text-ink-faint">{c.sub}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const statusText = (c: HistoryCell) =>
  ({ done: 'выполнено', missed: 'пропуск', yes: 'был срыв', unanswered: 'нет ответа', today: 'сегодня', future: 'впереди', grace: 'день создания', partial: `${c.done} из ${c.required}`, expired: 'просрочено', pending: 'ожидается' })[c.status];

function CellMark({ c, weekly }: { c: HistoryCell; weekly: boolean }) {
  const size = weekly ? 'h-6 min-w-[48px] rounded-full px-1.5 text-[11px]' : 'h-6 w-6 rounded-full';
  if (weekly) {
    const cls = c.status === 'done' ? 'bg-leaf text-white' : c.status === 'missed' ? 'bg-[#FBE7E5] text-danger' : c.status === 'partial' ? 'bg-[#FBE7E5] text-danger' : c.status === 'today' ? 'bg-leaf-soft text-leaf-deep ring-1 ring-leaf' : 'bg-cream text-ink-mute ring-1 ring-ink-line';
    return <span className={cx('inline-flex items-center justify-center font-semibold tabular-nums', size, cls)}>{c.status === 'future' ? '·' : `${c.done}/${c.required}`}</span>;
  }
  if (c.status === 'done') return <span className={cx('grid place-items-center bg-leaf text-white', size)}><IconCheck size={14} strokeWidth={3} /></span>;
  if (c.status === 'missed') return <span className={cx('grid place-items-center', size)}><span className="h-2 w-2 rounded-full bg-danger" /></span>;
  if (c.status === 'yes') return <span className={cx('grid place-items-center bg-[#F2E9E1]', size)}><span className="h-2 w-2 rounded-full bg-[#A07D5E]" /></span>;
  if (c.status === 'today') return <span className={cx('border-2 border-dashed border-leaf bg-white', size)} />;
  return <span className={cx('border-[1.5px] border-ink-line bg-white', size)} />;
}

/** Строка задачи: чекбокс (или «Да/Нет» для привычки), название, сфера, капли, частота, 🎁, состояние, линия дней. */
export function TaskRow({ task: t, onOpen, showLine = true }: { task: Task; onOpen?: (t: Task) => void; showLine?: boolean }) {
  const { complete, checkin, pending } = useTaskActions();
  const s = sphereById(t.sphere)!;
  const expired = t.status === 'expired';
  const done = t.kind === 'once' ? t.status === 'completed' : t.today.done;
  const weekFull = t.kind === 'weekly' && t.week && t.week.done >= t.week.required && !t.today.done;
  return (
    <motion.div layout="position" className={cx('rounded-[20px] bg-white p-3.5 shadow-card ring-1 ring-ink-line/70', expired && 'bg-cream')}>
      <div className="flex items-start gap-3">
        {t.kind === 'habit' ? null : (
          <button
            type="button"
            onClick={() => !done && t.today.canComplete && complete(t)}
            disabled={expired || done || !t.today.canComplete || pending[t.id]}
            aria-label={done ? `«${t.title}» выполнено` : `Отметить «${t.title}» выполненной`}
            className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 transition-all duration-200',
              done ? 'border-leaf bg-leaf text-white' : expired ? 'border-ink-line bg-cream' : weekFull ? 'border-leaf/50 bg-leaf-soft text-leaf-deep' : 'border-ink-line bg-white active:scale-90 active:border-leaf')}
          >
            {(done || weekFull) && <IconCheck size={17} strokeWidth={2.8} />}
            {pending[t.id] && <span className="h-4 w-4 animate-spin rounded-full border-2 border-leaf border-t-transparent" />}
          </button>
        )}
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen?.(t)} aria-label={`Открыть задачу «${t.title}»`}>
          <div className="flex items-center gap-1.5">
            <span className={cx('truncate text-[16px] font-semibold leading-snug', expired ? 'text-ink-mute line-through' : 'text-ink')}>{t.title}</span>
            {t.rewards.length > 0 && <IconGift size={15} className="shrink-0 text-blush-accent" aria-label="Есть подарок" />}
            {t.locked && <IconLock size={13} className="shrink-0 text-ink-faint" aria-label="Условия зафиксированы" />}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-ink-mute">
            <span className="inline-flex items-center gap-1" style={{ color: s.ink }}><SphereIcon sphere={t.sphere} size={13} />{s.name}</span>
            <span aria-hidden="true">·</span>
            <span>{t.kind === 'weekly' && t.week ? `${t.week.done} из ${t.week.required} на этой неделе` : frequencyLabel(t)}</span>
            {t.hardcore && <span className="rounded-full bg-[#FBE7E5] px-1.5 text-[11px] font-semibold text-danger">хардкор</span>}
          </div>
          {t.kind === 'once' && t.status === 'active' && t.deadlineAt && (
            <div className={cx('mt-1 text-[12px] font-medium', t.deadlineSoon ? 'text-blush-ink' : 'text-ink-mute')}>⏳ {deadlineLeft(t.deadlineAt)}</div>
          )}
          {expired && <div className="mt-1 text-[12px] text-ink-mute">Дедлайн прошёл — задача сгорела</div>}
        </button>
        <span className={cx('shrink-0 text-[14px] font-bold', expired ? 'text-ink-faint' : 'text-drop-deep')}>+{t.drops} 💧</span>
      </div>
      {t.kind === 'habit' && t.status === 'active' && (
        <div className="mt-3 flex items-center gap-2">
          <span className="flex-1 text-[14px] font-medium text-ink">{t.habitQuestion}</span>
          {(['yes', 'no'] as const).map((a) => (
            <button key={a} type="button" disabled={pending[t.id]} onClick={() => checkin(t, a)} aria-pressed={t.today.answer === a}
              className={cx('h-9 min-w-[56px] rounded-full px-3 text-[14px] font-semibold ring-1 transition-colors',
                t.today.answer === a ? (a === 'no' ? 'bg-leaf text-white ring-leaf' : 'bg-[#A07D5E] text-white ring-[#A07D5E]') : 'bg-white text-ink ring-ink-line')}>
              {a === 'yes' ? 'Да' : 'Нет'}
            </button>
          ))}
        </div>
      )}
      {showLine && t.kind !== 'once' && <div className="mt-2.5"><DayLine cells={t.history} /></div>}
    </motion.div>
  );
}

/** Линия подарков: тонкая полоса, точки-подарки над линией, подписи выполнений под ней; ближайшая цель видна первой. */
export function GiftLine({ task }: { task: Task }) {
  const ref = useRef<HTMLDivElement>(null);
  const rewards = task.rewards;
  const max = Math.max(...rewards.map((r) => r.threshold), task.completionsCount, 1);
  const nextIdx = rewards.findIndex((r) => r.status === 'locked');
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-idx="${nextIdx}"]`);
    if (el && ref.current) ref.current.scrollLeft = Math.max(0, el.offsetLeft - 24);
  }, [nextIdx]);
  if (!rewards.length) return null;
  const width = Math.max(320, rewards.length * 120);
  return (
    <div ref={ref} className="no-scrollbar overflow-x-auto" style={{ touchAction: 'pan-x' }}>
      <div className="relative h-[96px]" style={{ width }}>
        <div className="absolute left-4 right-4 top-[46px] h-[3px] rounded-full bg-leaf-soft" />
        <div className="absolute left-4 top-[46px] h-[3px] rounded-full bg-leaf transition-all duration-500" style={{ width: `calc((100% - 32px) * ${Math.min(1, task.completionsCount / max)})` }} />
        {rewards.map((r, i) => {
          const left = `calc(16px + (100% - 32px) * ${r.threshold / max})`;
          return (
            <div key={r.id} data-idx={i} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left }}>
              <div className={cx('grid h-9 w-9 place-items-center rounded-full shadow-soft',
                r.status === 'claimed' ? 'bg-leaf text-white' : r.status === 'unlocked' ? 'bg-blush-accent text-white' : 'bg-blush-soft text-blush-ink')}>
                <IconGift size={17} />
              </div>
              <div className={cx('mt-[3px] h-3 w-3 rounded-full border-2 border-white shadow', task.completionsCount >= r.threshold ? 'bg-leaf' : 'bg-ink-line')} />
              <div className="mt-1 text-[12px] font-semibold tabular-nums text-ink">{r.threshold}</div>
              <div className="max-w-[100px] truncate text-[11px] text-ink-mute">{r.title}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
