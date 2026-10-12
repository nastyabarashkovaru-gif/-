import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import { SPHERES, type SphereId } from '@rostok/shared';
import { IconShare, IconUsers } from '../art/icons';
import { ApiError, api, track } from '../api/client';
import type { Challenge } from '../api/types';
import { useApp } from '../state/app';
import { Button, Card, Field, Segmented, Sheet, cx, inputCls, useToast } from '../ui/kit';
import { shareLink } from '../lib/telegram';

/** Челленджи 1:1. Демонстрационный пример виден всегда и явно помечен. */
export function Challenges() {
  const { me } = useApp();
  const toast = useToast();
  const [list, setList] = useState<Challenge[] | null>(null);
  const [create, setCreate] = useState(false);
  const load = () => api<{ challenges: Challenge[] }>('GET', '/challenges').then((r) => setList(r.challenges)).catch(() => setList([]));
  useEffect(() => { load(); track('challenge_demo_view'); }, []);

  const invite = async (c: Challenge) => {
    try {
      const r = await api<{ link: string }>('POST', `/challenges/${c.id}/invite`);
      shareLink(r.link, `Присоединяйся к челленджу «${c.title}» в ROSTOK 🌱`);
      try { await navigator.clipboard?.writeText(r.link); toast('Ссылка-приглашение скопирована', 'ok'); } catch { /* */ }
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    }
  };

  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[20px] font-bold">Челленджи</h2>
        <button onClick={() => setCreate(true)} className="text-[14px] font-semibold text-leaf-deep">+ Создать челлендж</button>
      </div>
      <div className="space-y-3">
        {list?.map((c) => (
          <ChallengeCard key={c.id} title={c.title} goal={c.goal} endsOn={c.endsOn} rows={c.participants}
            footer={c.canInvite ? <Button variant="secondary" className="mt-3 w-full" onClick={() => invite(c)}><span className="inline-flex items-center gap-2"><IconShare size={18} />Пригласить друга</span></Button> : null} />
        ))}
        <ChallengeCard demo title="30 тренировок" goal={30} rows={[{ isMe: true, name: 'Ты', progress: 18 }, { isMe: false, name: 'Подруга', progress: 12 }]}
          footer={<Button variant="secondary" className="mt-3 w-full" onClick={() => setCreate(true)}><span className="inline-flex items-center gap-2"><IconUsers size={18} />Создать челлендж и пригласить друга</span></Button>} />
      </div>
      <CreateChallenge open={create} onClose={() => setCreate(false)} onCreated={async (id) => { await load(); const c = (await api<{ challenges: Challenge[] }>('GET', '/challenges')).challenges.find((x) => x.id === id); if (c) invite(c); }} />
      {me.user.isDemo && list && list.length > 0 && <p className="mt-2 text-[12px] text-ink-mute">В демо-режиме друг может открыть ссылку в браузере.</p>}
    </section>
  );
}

export function ChallengeCard({ title, goal, endsOn, rows, footer, demo }: { title: string; goal: number; endsOn?: string | null; rows: { isMe: boolean; name: string; progress: number }[]; footer?: React.ReactNode; demo?: boolean }) {
  return (
    <Card className={cx('p-4', demo && 'bg-cream')}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[17px] font-bold">{title}</div>
        {demo ? <span className="rounded-full bg-blush-soft px-2.5 py-0.5 text-[12px] font-semibold text-blush-ink">Пример</span>
          : endsOn ? <span className="text-[12px] text-ink-mute">до {DateTime.fromISO(endsOn).setLocale('ru').toFormat('d MMMM')}</span> : null}
      </div>
      <div className="mt-3 space-y-2.5">
        {rows.map((r, i) => (
          <div key={i}>
            <div className="mb-1 flex justify-between text-[14px]">
              <span className={cx('font-semibold', r.isMe ? 'text-ink' : 'text-ink-soft')}>{r.name}</span>
              <span className="tabular-nums text-ink-mute">{r.progress}/{goal}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-leaf-soft" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={r.progress} aria-label={`${r.name}: ${r.progress} из ${goal}`}>
              <div className={cx('h-full rounded-full transition-all duration-500', r.isMe ? 'bg-leaf' : 'bg-blush-accent')} style={{ width: `${Math.min(100, (r.progress / goal) * 100)}%` }} />
            </div>
          </div>
        ))}
        {rows.length < 2 && <div className="text-[13px] text-ink-mute">Ждём друга — отправь приглашение.</div>}
      </div>
      {footer}
    </Card>
  );
}

function CreateChallenge({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const { tasks } = useApp();
  const toast = useToast();
  const [title, setTitle] = useState('30 тренировок');
  const [goal, setGoal] = useState(30);
  const [bind, setBind] = useState<'task' | 'sphere'>('task');
  const [taskId, setTaskId] = useState<number | null>(null);
  const [sphere, setSphere] = useState<SphereId>('health');
  const [ends, setEnds] = useState('');
  const [busy, setBusy] = useState(false);
  const active = (tasks ?? []).filter((t) => t.status === 'active');
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api<{ id: number }>('POST', '/challenges', { title, goal, endsOn: ends || null, taskId: bind === 'task' ? taskId : null, sphereId: bind === 'sphere' ? sphere : null });
      onClose();
      onCreated(r.id);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Новый челлендж">
      <Field label="Название" htmlFor="ch-t"><input id="ch-t" className={inputCls} value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Цель — выполнений" htmlFor="ch-g"><input id="ch-g" type="number" min={1} max={1000} className={inputCls} value={goal} onChange={(e) => setGoal(Number(e.target.value))} /></Field>
      <Field label="Что засчитывается" hint="Прогресс считается только по подтверждённым выполнениям после вступления. Бонусных капель за победу нет — только радость.">
        <Segmented label="Привязка" value={bind} onChange={setBind} options={[{ value: 'task', label: 'Моя задача' }, { value: 'sphere', label: 'Вся сфера' }]} />
        <div className="mt-2">
          {bind === 'task' ? (
            <select aria-label="Задача" className={inputCls} value={taskId ?? ''} onChange={(e) => setTaskId(Number(e.target.value) || null)}>
              <option value="">Выбери задачу</option>
              {active.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
          ) : (
            <select aria-label="Сфера" className={inputCls} value={sphere} onChange={(e) => setSphere(e.target.value as SphereId)}>
              {SPHERES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
      </Field>
      <Field label="Срок (необязательно)" htmlFor="ch-e"><input id="ch-e" type="date" className={inputCls} value={ends} onChange={(e) => setEnds(e.target.value)} /></Field>
      <Button className="mb-2 w-full" onClick={submit} loading={busy} disabled={!title.trim() || (bind === 'task' && !taskId)}>Создать и пригласить</Button>
    </Sheet>
  );
}

/** Вступление по ссылке-приглашению: только с явного согласия пользователя. */
export function JoinChallenge({ token, onDone }: { token: string; onDone: () => void }) {
  const { tasks } = useApp();
  const toast = useToast();
  const [info, setInfo] = useState<{ title: string; goal: number; ownerName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bind, setBind] = useState<'task' | 'sphere'>('task');
  const [taskId, setTaskId] = useState<number | null>(null);
  const [sphere, setSphere] = useState<SphereId>('health');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ title: string; goal: number; ownerName: string }>('GET', `/challenges/invite/${encodeURIComponent(token)}`).then(setInfo).catch((e) => setError(e instanceof ApiError ? e.message : 'Приглашение недоступно'));
  }, [token]);
  const join = async () => {
    setBusy(true);
    try {
      await api('POST', '/challenges/join', { token, taskId: bind === 'task' ? taskId : null, sphereId: bind === 'sphere' ? sphere : null });
      toast('Ты в челлендже! 💪', 'ok');
      onDone();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Ошибка', 'error');
    } finally {
      setBusy(false);
    }
  };
  const active = (tasks ?? []).filter((t) => t.status === 'active');
  return (
    <Sheet open onClose={onDone} title="Приглашение в челлендж">
      {error ? <p className="pb-4 text-[15px] text-ink-soft">{error}</p> : !info ? <div className="skeleton h-24 rounded-2xl" /> : (
        <>
          <p className="text-[15px] text-ink-soft"><b className="text-ink">{info.ownerName}</b> зовёт тебя в челлендж <b className="text-ink">«{info.title}»</b> — цель {info.goal} выполнений.</p>
          <div className="mt-4">
            <Segmented label="Привязка" value={bind} onChange={setBind} options={[{ value: 'task', label: 'Моя задача' }, { value: 'sphere', label: 'Вся сфера' }]} />
            <div className="mt-2">
              {bind === 'task' ? (
                <select aria-label="Задача" className={inputCls} value={taskId ?? ''} onChange={(e) => setTaskId(Number(e.target.value) || null)}>
                  <option value="">Выбери задачу</option>
                  {active.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              ) : (
                <select aria-label="Сфера" className={inputCls} value={sphere} onChange={(e) => setSphere(e.target.value as SphereId)}>
                  {SPHERES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>
          </div>
          <Button className="mt-4 w-full" onClick={join} loading={busy} disabled={bind === 'task' && !taskId}>Присоединиться</Button>
          <Button variant="ghost" className="mb-2 mt-1 w-full" onClick={onDone}>Не сейчас</Button>
        </>
      )}
    </Sheet>
  );
}
