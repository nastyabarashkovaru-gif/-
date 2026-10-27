import { useEffect, useRef, useState } from 'react';
import { api, demoKey, setDevUser } from '../lib/api';
import { Sheet, toast } from '.';

interface DemoState {
  status: 'prepay' | 'paid' | 'waiting' | 'active' | 'done_sub' | 'done_nosub';
  day: number;
  tariff: 'm1' | 'm3' | 'm6';
  reports: 'all' | 'some' | 'many';
  outcome: 'full' | 'partial' | 'none';
  review: 'none' | 'pending' | 'needs_info' | 'granted';
  subscription: 'active' | 'ended' | 'renewed';
  timer: number;
}

const DEFAULT: DemoState = { status: 'active', day: 13, tariff: 'm3', reports: 'some', outcome: 'full', review: 'none', subscription: 'active', timer: 2400 };
const KEY = 'thirty.demoState';

const STATUS: [DemoState['status'], string][] = [
  ['prepay', 'До оплаты'],
  ['paid', 'Оплатил, не заполнил анкету'],
  ['waiting', 'Заполнил анкету, ожидает старта'],
  ['active', 'Активный участник'],
  ['done_sub', 'Завершил челлендж, подписка действует'],
  ['done_nosub', 'Завершил челлендж, подписка закончилась'],
];
const DAYS_HINT: Record<number, string> = { 1: 'первый день', 7: 'первая неделя', 14: 'окно трекеров', 15: 'середина', 29: 'обратная связь', 30: 'финал' };

/** Быстрые переходы к экранам — чтобы не искать их в меню */
const SCREENS: [string, string][] = [
  ['/', 'Главная'], ['/report', 'Отчёт'], ['/feed', 'Лента'], ['/feed?tab=people', 'Участники'], ['/club', 'Сообщество'], ['/buddy', 'Бадди'],
  ['/materials', 'Материалы'], ['/profile', 'Профиль'], ['/profile/subscription', 'Подписка'], ['/feedback', 'Обратная связь'], ['/finale', 'Итоги'],
  ['/finale/card', 'Карточка Stories'], ['/comeback', 'Продление 40 мин'], ['/trackers', 'Трекеры за отзыв'], ['/welcome', 'Онбординг'], ['/tariffs', 'Тарифы'], ['/reg/about', 'Анкета'],
];

function load(): DemoState {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DemoState>) };
  } catch {
    return DEFAULT;
  }
}

function Select<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className="demo-field">
      <span>{label}</span>
      <select className="select" value={String(value)} onChange={(e) => onChange(options.find(([v]) => String(v) === e.target.value)![0])}>
        {options.map(([v, l]) => <option key={String(v)} value={String(v)}>{l}</option>)}
      </select>
    </label>
  );
}

/** Панель демо-версии (только на демо-сервере и только по ссылке владельца) */
export function DemoPanel() {
  const [info, setInfo] = useState<{ demo: boolean; now: string; admin: { url: string; login: string; password: string } | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<DemoState>(load);
  const timer = useRef<number>();
  useEffect(() => {
    if (!demoKey()) return;
    api<NonNullable<typeof info>>('/api/demo/info').then(setInfo).catch(() => undefined);
  }, [open]);

  const apply = async (s: DemoState) => {
    setBusy(true);
    try {
      const r = await api<{ userId: string; go: string }>('/api/demo/state', { body: s });
      setDevUser(r.userId);
      location.href = r.go;
    } catch {
      toast('Не получилось применить состояние');
      setBusy(false);
    }
  };
  // Переключатели применяются сразу (с небольшой паузой, чтобы успеть поменять несколько)
  const change = (next: DemoState) => {
    setState(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* без хранилища — просто применяем */
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void apply(next), 900);
  };

  if (!info?.demo) return null;
  const set = <K extends keyof DemoState>(k: K, v: DemoState[K]) => change({ ...state, [k]: v });
  const done = state.status === 'done_sub' || state.status === 'done_nosub';
  const advance = async () => {
    setBusy(true);
    try {
      await api('/api/demo/advance', { body: {} });
      location.reload();
    } catch {
      toast('Не получилось перемотать время');
      setBusy(false);
    }
  };
  const now = new Date(info.now).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <button className="demo-fab" onClick={() => setOpen(true)}>{busy ? 'Готовлю…' : 'Демо'}</button>
      <Sheet open={open} onClose={() => setOpen(false)}>
        <div className="col" style={{ gap: 10 }}>
          <div className="row between"><div className="h3">Панель демо-версии</div><span className="muted small">{now} МСК</span></div>
          <div className="muted small">Данные ненастоящие, оплата тестовая, сообщения в Telegram не отправляются. Переключатели применяются сразу.</div>
          <Select label="Статус пользователя" value={state.status} options={STATUS} onChange={(v) => set('status', v)} />
          {state.status === 'active' && (
            <Select label="День челленджа" value={state.day} options={Array.from({ length: 30 }, (_, i) => [i + 1, `День ${i + 1}${DAYS_HINT[i + 1] ? ` — ${DAYS_HINT[i + 1]}` : ''}`] as [number, string])} onChange={(v) => set('day', v)} />
          )}
          {state.status !== 'prepay' && <Select label="Тариф" value={state.tariff} options={[['m1', '1 месяц (1 цель)'], ['m3', '3 месяца (до 3 целей)'], ['m6', '6 месяцев (без лимита)']]} onChange={(v) => set('tariff', v)} />}
          {(state.status === 'active' || done) && (
            <>
              <Select label="Отчёты" value={state.reports} options={[['all', 'Все отчёты отправлены'], ['some', 'Есть пропуски'], ['many', 'Много пропусков']]} onChange={(v) => set('reports', v)} />
              <Select label="Достижение цели" value={state.outcome} options={[['full', 'Достигнута'], ['partial', 'Частично достигнута'], ['none', 'Не достигнута']]} onChange={(v) => set('outcome', v)} />
              <Select label="Отзыв за трекеры" value={state.review} options={[['none', 'Не отправлен'], ['pending', 'На проверке'], ['needs_info', 'Нужно уточнение'], ['granted', 'Подарок выдан']]} onChange={(v) => set('review', v)} />
            </>
          )}
          {done && (
            <Select
              label="Подписка"
              value={state.status === 'done_sub' ? 'active' : state.subscription === 'active' ? 'ended' : state.subscription}
              options={[['active', 'Активна'], ['ended', 'Закончилась'], ['renewed', 'Продлена (вернулась по прежней цене)']]}
              onChange={(v) => change({ ...state, subscription: v, status: v === 'active' ? 'done_sub' : 'done_nosub' })}
            />
          )}
          {state.status === 'done_nosub' && state.subscription !== 'renewed' && (
            <Select label="Таймер продления" value={state.timer} options={[[2400, '40:00'], [600, '10:00'], [30, '00:30'], [0, '00:00 — время вышло']]} onChange={(v) => set('timer', v)} />
          )}
          <div className="row" style={{ gap: 8 }}>
            {state.status === 'active' && <button className="btn btn-secondary grow" disabled={busy} onClick={advance}>+1 день ⏩</button>}
            <button className="btn btn-light grow" disabled={busy} onClick={() => { window.clearTimeout(timer.current); setState(DEFAULT); try { localStorage.setItem(KEY, JSON.stringify(DEFAULT)); } catch { /* */ } void apply(DEFAULT); }}>Сбросить демоданные</button>
          </div>
          <div className="h3" style={{ fontSize: 15, marginTop: 4 }}>Экраны</div>
          <div className="demo-links">
            {SCREENS.map(([to, l]) => <button key={to} onClick={() => { location.href = to; }}>{l}</button>)}
          </div>
          {info.admin && (
            <div className="panel" style={{ gap: 4, padding: 12 }}>
              <b>Админка демо-версии</b>
              <span className="small">Логин: <code>{info.admin.login}</code> · пароль: <code>{info.admin.password}</code></span>
              <a className="link-accent" href={info.admin.url} target="_blank" rel="noreferrer">Открыть админку →</a>
            </div>
          )}
          {busy && <div className="muted small" style={{ textAlign: 'center' }}>Готовлю данные… (до 10 секунд)</div>}
        </div>
      </Sheet>
    </>
  );
}
