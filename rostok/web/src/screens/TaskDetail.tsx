import { useEffect, useState } from 'react';
import { sphereById, completionsLabel, dropsLabel } from '@rostok/shared';
import { IconEdit, IconGift, IconTrash, SphereIcon } from '../art/icons';
import { ApiError, api } from '../api/client';
import type { Task } from '../api/types';
import { useApp } from '../state/app';
import { Button, Sheet, cx, inputCls, useToast } from '../ui/kit';
import { DayLine, GiftLine } from '../ui/tasks';
import { fmtDate, frequencyLabel } from '../lib/format';
import { haptic } from '../lib/telegram';
import { TaskWizard } from './TaskWizard';

/** Подробная карточка задачи: полная история (виртуализированная линия), линия подарков, редактирование. */
export function TaskDetail({ taskId, onClose }: { taskId: number | null; onClose: () => void }) {
  const { setTasks, refreshTasks } = useApp();
  const toast = useToast();
  const [task, setTask] = useState<Task | null>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [edit, setEdit] = useState(false);
  const [addGift, setAddGift] = useState(false);
  const [gift, setGift] = useState({ threshold: 0, title: '' });
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async (id: number) => {
    const r = await api<{ task: Task; ledger: any[] }>('GET', `/tasks/${id}/history`);
    setTask(r.task);
    setLedger(r.ledger);
  };
  useEffect(() => {
    setTask(null);
    if (taskId) load(taskId).catch(() => toast('Не удалось загрузить задачу', 'error'));
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const claim = async (rid: number) => {
    try {
      await api('POST', `/rewards/${rid}/claim`);
      haptic.success();
      toast('Ты заслужила этот подарок 🎁', 'ok');
      await load(task!.id);
      refreshTasks().catch(() => {});
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    }
  };
  const submitGift = async () => {
    setBusy(true);
    try {
      const t = await api<Task>('POST', `/tasks/${task!.id}/rewards`, { threshold: gift.threshold, title: gift.title, confirm: true });
      setTasks((l) => l.map((x) => (x.id === t.id ? t : x)));
      await load(task!.id);
      setAddGift(false);
      toast('Подарок добавлен', 'ok');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    setBusy(true);
    try {
      await api('DELETE', `/tasks/${task!.id}`);
      setTasks((l) => l.filter((x) => x.id !== task!.id));
      toast('Задача удалена. Уже полученные капли остаются у дерева.', 'info');
      setConfirmDel(false);
      onClose();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    } finally {
      setBusy(false);
    }
  };

  const s = task ? sphereById(task.sphere)! : null;
  return (
    <Sheet open={!!taskId} onClose={onClose} tall>
      {!task ? (
        <div className="space-y-3 py-4"><div className="skeleton h-7 w-2/3 rounded-xl" /><div className="skeleton h-24 rounded-2xl" /></div>
      ) : (
        <div className="pb-2">
          <div className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: s!.ink }}><SphereIcon sphere={task.sphere} size={15} />{s!.name}</div>
          <h2 className={cx('mt-1 pr-8 text-[22px] font-bold leading-tight', task.status === 'expired' && 'text-ink-mute line-through')}>{task.title}</h2>
          {task.description && <p className="mt-1.5 text-[15px] text-ink-soft">{task.description}</p>}
          <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
            <span className="rounded-full bg-cream px-3 py-1 ring-1 ring-ink-line">{frequencyLabel(task)}</span>
            <span className="rounded-full bg-drop-soft px-3 py-1 font-semibold text-[#1F6F96]">+{dropsLabel(task.drops)}</span>
            {task.hardcore && <span className="rounded-full bg-[#FBE7E5] px-3 py-1 font-semibold text-danger">Хардкор{task.penaltyDrops ? ` · −${task.penaltyDrops}` : ''}</span>}
            <span className="rounded-full bg-leaf-soft px-3 py-1 font-semibold text-leaf-deep">Всего: {completionsLabel(task.completionsCount)}</span>
          </div>
          {task.pendingSchedule && (
            <p className="mt-3 rounded-2xl bg-cream px-4 py-2.5 text-[13px] text-ink-soft">
              С {fmtDate(task.pendingSchedule.effectiveFrom)}: {dropsLabel(task.pendingSchedule.drops)}{task.pendingSchedule.timesPerWeek ? `, ${task.pendingSchedule.timesPerWeek} раз в неделю` : ''}{task.pendingSchedule.hardcore ? ', хардкор' : ''}. История не меняется.
            </p>
          )}
          {task.kind === 'once' ? (
            <div className="mt-4 rounded-2xl bg-cream p-4 text-[14px]">
              <div className="font-semibold">Дедлайн: {fmtDate(task.deadlineAt, true)}</div>
              <div className="mt-0.5 text-ink-mute">{task.status === 'completed' ? 'Выполнено вовремя ✓' : task.status === 'expired' ? 'Сгорела — капли не начислены' : 'Ещё можно успеть'}</div>
            </div>
          ) : (
            <>
              <h3 className="mt-5 text-[16px] font-bold">История</h3>
              <div className="mt-2"><DayLine cells={task.history} compact={false} /></div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-mute">
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-leaf" />выполнено</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-danger" />пропуск</span>
                {task.kind === 'habit' && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#A07D5E]" />«Да»</span>}
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full border border-ink-line" />впереди</span>
              </div>
            </>
          )}

          <div className="mt-5 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-[16px] font-bold"><IconGift size={18} className="text-blush-accent" />Подарки</h3>
            {task.status === 'active' && !addGift && (
              <button className="text-[14px] font-semibold text-blush-ink" onClick={() => { setGift({ threshold: Math.max(task.completionsCount + 1, task.kind === 'once' ? 1 : 30), title: '' }); setAddGift(true); }}>+ Добавить</button>
            )}
          </div>
          {task.rewards.length > 0 ? <div className="mt-1"><GiftLine task={task} /></div> : !addGift && <p className="mt-1 text-[14px] text-ink-mute">Подари себе что-нибудь за прогресс — например, за 30, 60 и 100 выполнений.</p>}
          {task.rewards.filter((r) => r.status === 'unlocked').map((r) => (
            <div key={r.id} className="mt-2 flex items-center gap-3 rounded-2xl bg-blush-soft p-3">
              <span className="flex-1 text-[14px]"><b>{r.title}</b> — открыт за {completionsLabel(r.threshold)}!</span>
              <Button variant="pink" className="min-h-[40px] px-3 text-[14px]" onClick={() => claim(r.id)}>Подарок получен</Button>
            </div>
          ))}
          {task.rewards.filter((r) => r.status === 'claimed').length > 0 && (
            <p className="mt-2 text-[13px] text-ink-mute">Получено: {task.rewards.filter((r) => r.status === 'claimed').map((r) => r.title).join(', ')}</p>
          )}
          {addGift && (
            <div className="mt-2 rounded-2xl bg-blush-soft/70 p-3.5">
              <div className="flex gap-2">
                <input type="number" min={task.completionsCount + 1} aria-label="Порог" className={cx(inputCls, 'w-[90px] bg-white')} value={gift.threshold} disabled={task.kind === 'once'} onChange={(e) => setGift({ ...gift, threshold: Number(e.target.value) })} />
                <input aria-label="Подарок" className={cx(inputCls, 'flex-1 bg-white')} placeholder="Подарок" maxLength={80} value={gift.title} onChange={(e) => setGift({ ...gift, title: e.target.value })} />
              </div>
              <p className="mt-2 text-[12px] leading-snug text-ink-soft">Только на будущий порог (больше {task.completionsCount}). После добавления условия задачи зафиксируются.</p>
              <div className="mt-2 flex gap-2">
                <Button variant="pink" className="flex-1" onClick={submitGift} loading={busy} disabled={!gift.title.trim()}>Обещаю себе</Button>
                <Button variant="ghost" onClick={() => setAddGift(false)}>Отмена</Button>
              </div>
            </div>
          )}

          {ledger.length > 0 && (
            <>
              <h3 className="mt-5 text-[16px] font-bold">Капли</h3>
              <ul className="mt-1 divide-y divide-ink-line text-[14px]">
                {ledger.slice(0, 8).map((l, i) => (
                  <li key={i} className="flex justify-between py-2">
                    <span className="text-ink-soft">{l.type === 'penalty' ? (l.amount === 0 ? 'Штраф (баланс был 0)' : 'Штраф') : l.type === 'habit_correction' ? 'Исправление ответа' : 'Выполнение'} · {fmtDate(l.created_at)}</span>
                    <span className={cx('font-semibold tabular-nums', l.amount < 0 ? 'text-danger' : 'text-drop-deep')}>{l.amount > 0 ? '+' : ''}{l.amount} 💧</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {task.status === 'active' && (
            <div className="mt-6 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setEdit(true)}><span className="inline-flex items-center gap-2"><IconEdit size={18} />Изменить</span></Button>
              {!task.locked && <Button variant="danger-outline" aria-label="Удалить задачу" onClick={() => setConfirmDel(true)}><IconTrash size={18} /></Button>}
            </div>
          )}
        </div>
      )}
      <TaskWizard open={edit} onClose={() => setEdit(false)} edit={task} onSaved={() => task && load(task.id)} />
      <Sheet open={confirmDel} onClose={() => setConfirmDel(false)} title="Удалить задачу?">
        <p className="text-[15px] text-ink-soft">Полученные капли и уровни останутся у дерева. История задачи исчезнет из списка.</p>
        <Button variant="danger-outline" className="mt-5 w-full" onClick={del} loading={busy}>Удалить</Button>
        <Button variant="ghost" className="mt-1 w-full" onClick={() => setConfirmDel(false)}>Оставить</Button>
      </Sheet>
    </Sheet>
  );
}
