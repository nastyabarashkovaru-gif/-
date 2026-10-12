import { DateTime } from 'luxon';
import { useEffect, useState } from 'react';
import { SPHERES, TASK_LIMITS, validateTaskInput, completionsLabel, type SphereId, type TaskInput, type TaskKind } from '@rostok/shared';
import { IconGift, IconLock, IconTrash, SphereIcon } from '../art/icons';
import { ApiError, api } from '../api/client';
import type { Task } from '../api/types';
import { useApp } from '../state/app';
import { Button, Field, Segmented, Sheet, Stepper, Toggle, cx, inputCls, useToast } from '../ui/kit';
import { haptic } from '../lib/telegram';

type Freq = 'daily' | 'weekly' | 'once';

/** Единый экран «Новая задача» (и редактирование). Все правила дублируются на сервере. */
export function TaskWizard({ open, onClose, edit, presetSphere, onSaved }: { open: boolean; onClose: () => void; edit?: Task | null; presetSphere?: SphereId | null; onSaved?: (t: Task) => void }) {
  const { me, setTasks, refreshTasks, refreshGarden } = useApp();
  const toast = useToast();
  const tz = me.user.timezone;
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [showDesc, setShowDesc] = useState(false);
  const [sphere, setSphere] = useState<SphereId | null>(null);
  const [freq, setFreq] = useState<Freq>('daily');
  const [habit, setHabit] = useState(false);
  const [habitQ, setHabitQ] = useState('');
  const [times, setTimes] = useState(3);
  const [drops, setDrops] = useState(1);
  const [onceDrops, setOnceDrops] = useState<number>(TASK_LIMITS.onceDrops.default);
  const [hard, setHard] = useState(false);
  const [penalty, setPenalty] = useState<number>(TASK_LIMITS.oncePenalty.default);
  const [missingConsent, setMissingConsent] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('20:00');
  const [gifts, setGifts] = useState<{ threshold: number; title: string }[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setConfirm(false);
    if (edit) {
      setTitle(edit.title); setDesc(edit.description ?? ''); setShowDesc(!!edit.description); setSphere(edit.sphere);
      setHabit(edit.kind === 'habit'); setFreq(edit.kind === 'habit' ? 'daily' : (edit.kind as Freq)); setHabitQ(edit.habitQuestion ?? '');
      setTimes(edit.timesPerWeek ?? 3); setDrops(edit.kind === 'once' ? 1 : edit.drops); setOnceDrops(edit.kind === 'once' ? edit.drops : 5);
      setHard(edit.hardcore); setPenalty(edit.penaltyDrops ?? 3); setMissingConsent(edit.habitMissingPenalty);
      if (edit.deadlineAt) { const d = DateTime.fromISO(edit.deadlineAt).setZone(tz); setDate(d.toISODate()!); setTime(d.toFormat('HH:mm')); }
      setGifts([]);
    } else {
      setTitle(''); setDesc(''); setShowDesc(false); setSphere(presetSphere ?? null); setFreq('daily'); setHabit(false); setHabitQ('');
      setTimes(3); setDrops(1); setOnceDrops(5); setHard(false); setPenalty(3); setMissingConsent(false);
      setDate(DateTime.now().setZone(tz).plus({ days: 1 }).toISODate()!); setTime('20:00'); setGifts([]);
    }
  }, [open, edit, presetSphere, tz]);

  const locked = !!edit?.locked;
  const kind: TaskKind = habit ? 'habit' : freq;
  const deadlineIso = freq === 'once' && date && time ? DateTime.fromISO(`${date}T${time}`, { zone: tz }).toUTC().toISO() : null;

  const input = (): TaskInput => ({
    title, description: desc.trim() || null, sphere: sphere as SphereId, kind,
    timesPerWeek: kind === 'weekly' ? times : null,
    drops: kind === 'once' ? onceDrops : drops,
    hardcore: hard,
    penaltyDrops: kind === 'once' && hard ? penalty : null,
    deadlineAt: deadlineIso,
    habitQuestion: habit ? habitQ.trim() || `${title.trim()} сегодня?` : null,
    habitMissingPenaltyConsent: habit && hard ? missingConsent : false,
    rewards: gifts.filter((g) => g.title.trim()),
  });

  const save = async (confirmed = false) => {
    if (!sphere) return setErr('Выбери сферу');
    const v = validateTaskInput(input(), new Date());
    if (v) return setErr(v);
    if (!edit && input().rewards!.length && !confirmed) return setConfirm(true);
    setBusy(true);
    setErr(null);
    try {
      let t: Task;
      if (edit) {
        const patch: Record<string, unknown> = { title, description: desc.trim() || null, hardcore: hard };
        if (!locked) Object.assign(patch, { sphere, drops: kind === 'once' ? onceDrops : drops, ...(kind === 'weekly' ? { timesPerWeek: times } : {}), ...(kind === 'once' ? { deadlineAt: deadlineIso, penaltyDrops: hard ? penalty : null } : {}) });
        if (habit) Object.assign(patch, { habitQuestion: habitQ, habitMissingPenaltyConsent: hard && missingConsent });
        t = await api<Task>('PATCH', `/tasks/${edit.id}`, patch);
        setTasks((l) => l.map((x) => (x.id === t.id ? t : x)));
        toast(t.pendingSchedule ? 'Сохранено. Новые условия начнут действовать со следующего периода' : 'Сохранено', 'ok');
      } else {
        t = await api<Task>('POST', '/tasks', input());
        await refreshTasks();
        refreshGarden().catch(() => {});
        haptic.success();
        toast('Задача создана 🌱', 'ok');
      }
      onSaved?.(t);
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Не получилось сохранить');
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const dropsMax = kind === 'once' ? TASK_LIMITS.onceDrops.max : TASK_LIMITS.recurringDrops.max;
  return (
    <Sheet open={open} onClose={onClose} title={edit ? 'Задача' : 'Новая задача'} tall>
      {locked && (
        <div className="mb-4 flex gap-2.5 rounded-2xl bg-blush-soft p-3.5 text-[13px] leading-snug text-blush-ink">
          <IconLock size={18} className="mt-0.5 shrink-0" />
          У задачи есть обещанный подарок — условия зафиксированы. Можно исправить опечатку в названии, поменять описание и добавить подарки на будущие пороги.
        </div>
      )}
      <Field label="Название" htmlFor="t-title">
        <input id="t-title" className={inputCls} value={title} maxLength={TASK_LIMITS.titleMax} placeholder={habit ? 'Например, курение' : 'Например, утренняя пробежка'} onChange={(e) => setTitle(e.target.value)} />
      </Field>

      <Field label="Сфера">
        <div className="grid grid-cols-3 gap-2">
          {SPHERES.map((s) => (
            <button key={s.id} type="button" disabled={(locked || edit?.kind === 'habit') && sphere !== s.id} aria-pressed={sphere === s.id}
              onClick={() => { setSphere(s.id); if (s.id !== 'health') setHabit(false); }}
              className={cx('flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-[16px] px-1 text-[13px] font-semibold ring-1 transition-all disabled:opacity-40',
                sphere === s.id ? 'ring-2' : 'bg-white ring-ink-line')}
              style={sphere === s.id ? { background: s.tint, color: s.ink, boxShadow: `inset 0 0 0 2px ${s.ink}` } : { color: s.ink }}>
              <SphereIcon sphere={s.id} size={20} />
              {s.name}
            </button>
          ))}
        </div>
      </Field>

      {!showDesc ? (
        <button type="button" className="mb-4 text-[14px] font-semibold text-leaf-deep" onClick={() => setShowDesc(true)}>+ Добавить описание</button>
      ) : (
        <Field label="Описание (необязательно)" htmlFor="t-desc">
          <textarea id="t-desc" rows={2} className={inputCls} value={desc} maxLength={TASK_LIMITS.descriptionMax} onChange={(e) => setDesc(e.target.value)} />
        </Field>
      )}

      {sphere === 'health' && !edit && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-cream p-3.5 ring-1 ring-ink-line">
          <div>
            <div className="text-[15px] font-semibold">Вредная привычка</div>
            <div className="text-[13px] text-ink-mute">Каждый день вопрос «Да / Нет». «Да» делает дерево здоровья грустным.</div>
          </div>
          <Toggle checked={habit} onChange={setHabit} label="Вредная привычка" />
        </div>
      )}

      {habit ? (
        <Field label="Вопрос на каждый день" htmlFor="t-q" hint="Пример: «Курил сегодня?». За ответ «Нет» — капли, за «Да» — 0. Отсутствие ответа не считается ни «Да», ни «Нет».">
          <input id="t-q" className={inputCls} value={habitQ} maxLength={120} placeholder={`${title || 'Курил'} сегодня?`} onChange={(e) => setHabitQ(e.target.value)} />
        </Field>
      ) : (
        <Field label="Как часто">
          <Segmented<Freq> label="Частота" value={freq} onChange={(v) => !edit && setFreq(v)}
            options={[{ value: 'daily', label: 'Каждый день' }, { value: 'weekly', label: 'Несколько раз в неделю' }, { value: 'once', label: 'Один раз' }]} />
          {edit && <div className="mt-1.5 text-[12px] text-ink-mute">Тип задачи нельзя поменять после создания — создай новую.</div>}
        </Field>
      )}

      {freq === 'weekly' && !habit && (
        <Field label="Сколько раз в неделю" hint="Неделя — с понедельника по воскресенье. Отмечать можно не больше одного раза в день.">
          <Stepper value={times} min={1} max={7} onChange={setTimes} label="Раз в неделю" />
        </Field>
      )}

      {freq === 'once' && !habit && (
        <Field label="Дедлайн" hint="Выполнить и получить капли можно до этого момента включительно. Потом задача сгорит.">
          <div className="flex gap-2">
            <input type="date" aria-label="Дата дедлайна" className={inputCls} value={date} min={DateTime.now().setZone(tz).toISODate()!} disabled={locked} onChange={(e) => setDate(e.target.value)} />
            <input type="time" aria-label="Время дедлайна" className={cx(inputCls, 'max-w-[130px]')} value={time} disabled={locked} onChange={(e) => setTime(e.target.value)} />
          </div>
        </Field>
      )}

      <Field label={habit ? 'Капли за ответ «Нет»' : 'Капли за выполнение'} hint={kind === 'once' ? 'От 1 до 25 — за важное разовое дело' : 'От 1 до 5. Капли получит только дерево этой сферы.'}>
        <Stepper value={kind === 'once' ? onceDrops : drops} min={1} max={dropsMax} onChange={kind === 'once' ? setOnceDrops : setDrops} label="Капли" suffix=" 💧" />
      </Field>

      <div className="mb-4 rounded-2xl bg-cream p-3.5 ring-1 ring-ink-line">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[15px] font-semibold">Хардкор</div>
            <div className="text-[13px] leading-snug text-ink-mute">
              {kind === 'once' ? 'Если не успеешь к дедлайну — штраф из капель этого дерева.'
                : kind === 'habit' ? 'За ответ «Да» — −1 капля один раз в день.'
                : kind === 'weekly' ? '−1 капля за каждое недостающее выполнение в конце недели.'
                : '−1 капля за каждый пропущенный день.'}
              {' '}Уровень не снижается, баланс не уходит в минус.
            </div>
          </div>
          <Toggle checked={hard} onChange={setHard} label="Хардкор" />
        </div>
        {hard && kind === 'once' && (
          <div className="mt-3 flex items-center justify-between"><span className="text-[14px] font-medium">Штраф</span><Stepper value={penalty} min={1} max={TASK_LIMITS.oncePenalty.max} onChange={setPenalty} label="Штраф" suffix=" 💧" /></div>
        )}
        {hard && kind === 'habit' && (
          <label className="mt-3 flex items-start gap-2.5 text-[13px] leading-snug text-ink-soft">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[#276B48]" checked={missingConsent} onChange={(e) => setMissingConsent(e.target.checked)} />
            Считать день без ответа пропуском (−1 капля). Без этой галочки за пропущенный ответ штрафа нет.
          </label>
        )}
      </div>

      {!edit && (
        <div className="mb-4 rounded-2xl bg-blush-soft/70 p-3.5">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-blush-ink"><IconGift size={18} /> Подарок за прогресс</div>
          <p className="mt-1 text-[13px] leading-snug text-ink-soft">
            Награди себя за общее количество выполнений{kind === 'once' ? '' : ' (не подряд — пропуски просто отдаляют подарок)'}. После сохранения условия задачи зафиксируются.
          </p>
          {gifts.map((g, i) => (
            <div key={i} className="mt-2.5 flex items-center gap-2">
              <input type="number" inputMode="numeric" aria-label="Порог выполнений" min={1} className={cx(inputCls, 'w-[84px] bg-white px-3')} value={g.threshold}
                disabled={kind === 'once'} onChange={(e) => setGifts((x) => x.map((y, k) => (k === i ? { ...y, threshold: Number(e.target.value) } : y)))} />
              <input aria-label="Подарок" className={cx(inputCls, 'flex-1 bg-white')} placeholder="SPA, путешествие…" value={g.title} maxLength={80}
                onChange={(e) => setGifts((x) => x.map((y, k) => (k === i ? { ...y, title: e.target.value } : y)))} />
              <button type="button" aria-label="Удалить подарок" className="grid h-10 w-10 place-items-center rounded-full text-ink-mute active:bg-white" onClick={() => setGifts((x) => x.filter((_, k) => k !== i))}><IconTrash size={18} /></button>
            </div>
          ))}
          {gifts.length > 0 && kind !== 'once' && <div className="mt-1.5 text-[12px] text-ink-mute">Число слева — {completionsLabel(gifts[0].threshold || 0).replace(/^\d+ /, '')}.</div>}
          {(kind !== 'once' || gifts.length === 0) && gifts.length < 5 && (
            <button type="button" className="mt-2.5 text-[14px] font-semibold text-blush-ink" onClick={() => setGifts((x) => [...x, { threshold: kind === 'once' ? 1 : [30, 60, 100, 150, 200][x.length], title: '' }])}>
              + Добавить подарок
            </button>
          )}
        </div>
      )}

      {err && <div role="alert" className="mb-3 rounded-2xl bg-[#FFF4F2] px-4 py-3 text-[14px] text-[#9B3B33]">{err}</div>}
      <Button className="mb-2 w-full" onClick={() => save()} loading={busy}>{edit ? 'Сохранить' : 'Создать задачу'}</Button>

      <Sheet open={confirm} onClose={() => setConfirm(false)} title="Зафиксировать обещание?">
        <p className="text-[15px] leading-relaxed text-ink-soft">
          После сохранения нельзя будет изменить сферу, частоту, число капель и уже назначенные подарки. Так обещание себе останется честным. Название можно будет поправить, если в нём опечатка.
        </p>
        <Button className="mt-5 w-full" onClick={() => save(true)} loading={busy}>Да, обещаю себе</Button>
        <Button variant="ghost" className="mt-1 w-full" onClick={() => setConfirm(false)}>Вернуться</Button>
      </Sheet>
    </Sheet>
  );
}
