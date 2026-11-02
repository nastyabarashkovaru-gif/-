import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  Target,    CircleCheck,  Plus,    ListChecks, ClipboardCheck,
  CalendarDays, ChevronDown, ChevronUp, Handshake, HeartHandshake, MapPin, Users, Hourglass, CheckCheck, BookOpen, ArrowRight, Pencil,
} from 'lucide-react';
import { api } from '../../lib/api';
import { track } from '../../lib/analytics';
import { haptic, openTelegram, requestWriteAccess } from '../../lib/telegram';
import { useMe } from '../../state';
import { BrandBar, Cta, Empty, ErrorState, Loading, Screen, errorText, humanDate, toast, useLoad } from '../../ui';
import { useMembership, type MembershipView } from './Registration';

/** Категории целей анкеты (решение владельца 24.10) */
export const GOAL_CATEGORIES = [
  { id: 'money', title: 'Деньги', emoji: '💸' },
  { id: 'weightloss', title: 'Похудение', emoji: '🥑' },
  { id: 'blog', title: 'Блог', emoji: '📱' },
  { id: 'english', title: 'Английский', emoji: '🇬🇧' },
  { id: 'habits', title: 'Привычки и дисциплина', emoji: '🔥' },
  { id: 'other', title: 'Другое', emoji: '✨' },
] as const;

/** Подсказки к полям: для блога — тексты макета, для остальных категорий — в том же духе */
const HINTS: Record<string, { a: string; b: string; action: string; examples: string[] }> = {
  blog: { a: 'Сейчас в моём блоге 250 подписчиков', b: 'Через 30 дней в блоге 1 000 подписчиков', action: 'Например, публиковать Reels', examples: ['Ежедневно — публиковать 1 Reels', '3 раза в неделю — анализировать статистику роликов', 'Одноразово — оформить шапку профиля до 5 ноября'] },
  money: { a: 'Сейчас я зарабатываю 60 000 ₽ в месяц', b: 'Через 30 дней мой доход 80 000 ₽ в месяц', action: 'Например, отправлять 5 откликов', examples: ['Ежедневно — вести учёт доходов и расходов', '3 раза в неделю — откликаться на вакансии или заказы', 'Одноразово — обновить резюме до 5 ноября'] },
  weightloss: { a: 'Сейчас мой вес 72 кг', b: 'Через 30 дней мой вес 68 кг', action: 'Например, проходить 10 000 шагов', examples: ['Ежедневно — проходить 10 000 шагов', '3 раза в неделю — тренировка 40 минут', 'Одноразово — составить меню на неделю до 5 ноября'] },
  english: { a: 'Сейчас я знаю английский на уровне A2', b: 'Через 30 дней я могу 10 минут говорить на английском', action: 'Например, учить 10 новых слов', examples: ['Ежедневно — учить 10 новых слов', '3 раза в неделю — разговорная практика 20 минут', 'Одноразово — пройти тест на уровень до 5 ноября'] },
  habits: { a: 'Сейчас я встаю в 9:00', b: 'Через 30 дней я каждый день встаю в 7:00', action: 'Например, вставать в 7:00', examples: ['Ежедневно — вставать в 7:00', '3 раза в неделю — зарядка 15 минут', 'Одноразово — убрать телефон из спальни до 5 ноября'] },
  other: { a: 'Опиши, где ты сейчас', b: 'Опиши результат через 30 дней', action: 'Например, заниматься 30 минут', examples: ['Ежедневно — маленький шаг к цели', '3 раза в неделю — действие побольше', 'Одноразово — подготовительная задача до 5 ноября'] },
};
const hints = (cat: string) => HINTS[cat] ?? HINTS.other;

type Goal = MembershipView['goals'][number];

function StepBar({ step }: { step: number }) {
  return (
    <>
      <BrandBar right={<span className="counter">Шаг {step} из 3</span>} />
      <div className="steps" aria-hidden>{[1, 2, 3].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
    </>
  );
}

function Head({ icon, children, lead }: { icon: ReactNode; children: ReactNode; lead?: ReactNode }) {
  return (
    <div className="col" style={{ gap: 10, alignItems: 'center', marginTop: 8 }}>
      <span className="ic lg">{icon}</span>
      <h1 className="hero" style={{ marginTop: 6 }}>{children}</h1>
      {lead && <p className="lead" style={{ fontSize: 15 }}>{lead}</p>}
    </div>
  );
}

function Note({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="panel" style={{ gap: 6, padding: 16 }}>
      <div className="row" style={{ gap: 8, color: 'var(--accent-ink)', fontWeight: 600, fontSize: 15 }}>{icon}{title}</div>
      <div className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>{children}</div>
    </div>
  );
}

function Radio({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`radio ${on ? 'on' : ''}`} role="radio" aria-checked={on} onClick={onClick}><i />{children}</button>;
}

/** Общая загрузка анкеты: после отправки анкеты экраны недоступны */
function useQuestionnaire(screen: string) {
  const q = useMembership();
  useEffect(() => {
    void api('/api/me/screen', { body: { screen } }).catch(() => undefined);
  }, [screen]);
  return q;
}

function SupportButton() {
  const { me } = useMe();
  return <button className="btn btn-primary" onClick={() => me && openTelegram(me.support)}>Написать в поддержку</button>;
}

function Gate({ q, id, children }: { q: ReturnType<typeof useMembership>; id: string; children: (m: MembershipView) => ReactNode }) {
  if (q.loading && !q.data) return <Screen id={id}><Loading /></Screen>;
  if (q.error || !q.data) return <Screen id={id}><ErrorState error={q.error ?? new Error('Сначала выбери тариф')} retry={q.reload} /></Screen>;
  if (!q.data.canEdit) {
    // Анкету не заполнили до старта: не отправляем на главную (она вернула бы сюда), а объясняем, что делать
    if (q.data.status === 'reserved') {
      return (
        <Screen id={id}>
          <Empty title="Анкета на этот поток уже закрыта" text="Поток начался, а цели не были заполнены. Напиши в поддержку — поможем присоединиться." action={<SupportButton />} />
        </Screen>
      );
    }
    return <Navigate to="/" replace />;
  }
  return <>{children(q.data)}</>;
}

/* ───────────── Шаг 0: когда начнём (личный старт, ТЗ 02.11) ───────────── */

const isoToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const plusDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export function StartStep() {
  const q = useQuestionnaire('/reg/start');
  return <Gate q={q} id="S11a">{(m) => <StartForm m={m} />}</Gate>;
}

function StartForm({ m }: { m: MembershipView }) {
  const nav = useNavigate();
  const { refresh } = useMe();
  const today = m.flow.today || isoToday();
  const chosen = (m.flow as { chosen?: boolean }).chosen ? m.flow.startsOn : null;
  const [date, setDate] = useState(chosen && chosen >= today ? chosen : today);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api('/api/membership/start', { body: { date } });
      await refresh();
      haptic('success');
      nav('/reg/buddy-mode');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen id="S11a">
      <BrandBar />
      <div className="col" style={{ gap: 8 }}>
        <h1 className="hero" style={{ textAlign: 'left' }}>Когда начнём твой челлендж? 🚀</h1>
        <p className="lead" style={{ textAlign: 'left' }}>Выбери день, с которого начнёшь двигаться к своей цели.</p>
      </div>
      <label className="field start-date"><span className="row" style={{ gap: 8, fontWeight: 600 }}>📅 Выбери дату старта</span>
        <input className="input" type="date" value={date} min={today} max={plusDays(today, 90)} onChange={(e) => setDate(e.target.value)} />
      </label>
      {date && <div className="panel small" style={{ padding: 12 }}>Твои 30 дней: {humanDate(date)} — {humanDate(plusDays(date, 29))}{date === today ? ' · начинаешь сегодня 🔥' : ''}</div>}
      <div className="spacer" />
      <Cta disabled={busy || !date || date < today} onClick={save}>Продолжить</Cta>
    </Screen>
  );
}

/* ───────────── Шаг 0б: как найти бадди ───────────── */

export function BuddyModeStep() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const { data } = useLoad(() => api<{ state: string }>('/api/buddy'));
  useEffect(() => {
    // пара уже есть (например, следующий челлендж с прежним бадди) — шаг пропускаем
    if (data?.state === 'paired') nav('/reg/confirm', { replace: true });
  }, [data?.state]);
  const choose = async (mode: 'auto' | 'self') => {
    setBusy(true);
    try {
      await api('/api/buddy/mode', { body: { mode } });
      haptic('success');
      nav('/reg/confirm');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen id="S11b">
      <BrandBar />
      <div className="col" style={{ gap: 8 }}>
        <h1 className="hero" style={{ textAlign: 'left' }}>Как хочешь найти своего бадди?</h1>
        <p className="lead" style={{ textAlign: 'left' }}>Каждому участнику доступен личный бадди — напарник, с которым вы поддерживаете друг друга и вместе идёте к своим целям. Ты можешь выбрать его самостоятельно или доверить подбор нам.</p>
      </div>
      <button className="card card-link start-choice" disabled={busy} onClick={() => choose('auto')}>
        <span className="start-ic">🤝</span><span className="grow"><b>Подобрать автоматически</b><span>Мы найдём тебе напарника среди участников клуба</span></span>
      </button>
      <button className="card card-link start-choice" disabled={busy} onClick={() => choose('self')}>
        <span className="start-ic">💜</span><span className="grow"><b>Выбрать самостоятельно</b><span>Выбери участника, с которым хочешь проходить челлендж вместе</span></span>
      </button>
    </Screen>
  );
}

/* ───────────── Шаг 1: знакомство ───────────── */

export function AboutStep() {
  const q = useQuestionnaire('/reg/about');
  const { me } = useMe();
  useEffect(() => {
    track('registration_started', { screen: 'S12' });
    // Часовой пояс берём с устройства: от него зависят дедлайны ежедневных отчётов
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && me && me.user.timezone !== tz) void api('/api/me', { method: 'PATCH', body: { timezone: tz } }).catch(() => undefined);
  }, []);
  return <Gate q={q} id="S12">{(m) => <AboutForm m={m} />}</Gate>;
}

function AboutForm({ m }: { m: MembershipView }) {
  const nav = useNavigate();
  const { me, refresh } = useMe();
  const u = me!.user;
  const [name, setName] = useState(u.displayName ?? '');
  const [city, setCity] = useState(u.city ?? '');
  const [age, setAge] = useState(u.age ? String(u.age) : '');
  const [occupation, setOccupation] = useState(u.occupation ?? '');
  const [expectation, setExpectation] = useState(m.expectation ?? '');
  const [busy, setBusy] = useState(false);
  const ageNum = Number(age);
  const valid = name.trim().length >= 1 && city.trim().length >= 2 && Number.isInteger(ageNum) && ageNum >= 14 && ageNum <= 99 && occupation.trim().length >= 2 && expectation.trim().length >= 2;

  const save = async () => {
    setBusy(true);
    try {
      await api('/api/me', { method: 'PATCH', body: { displayName: name.trim(), city: city.trim(), age: ageNum, occupation: occupation.trim() } });
      // Ответ про ожидания — свой для каждого потока (история хранится по участиям)
      await api('/api/membership/expectation', { method: 'PUT', body: { expectation: expectation.trim() } });
      await refresh();
      haptic('success');
      nav('/reg/goals');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // Без подсказок в полях и лишних текстов (решение владельца 02.11)
  return (
    <Screen id="S12">
      <StepBar step={1} />
      <Head icon={<Users size={28} strokeWidth={1.8} />}>Давай <em>знакомиться!</em> 😍</Head>
      <label className="field">
        <span className="h3" style={{ fontSize: 15 }}>Имя</span>
        <input className="input" value={name} maxLength={64} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="h3" style={{ fontSize: 15 }}>Город</span>
        <input className="input" value={city} maxLength={64} autoComplete="address-level2" onChange={(e) => setCity(e.target.value)} />
      </label>
      <label className="field">
        <span className="h3" style={{ fontSize: 15 }}>Возраст</span>
        <input className="input" inputMode="numeric" value={age} maxLength={2} onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))} />
      </label>
      <label className="field">
        <span className="h3" style={{ fontSize: 15 }}>Чем занимаешься?</span>
        <textarea className="textarea" rows={2} value={occupation} maxLength={300} onChange={(e) => setOccupation(e.target.value)} />
      </label>
      <label className="field">
        <span className="h3" style={{ fontSize: 15 }}>Что хочешь получить от сообщества «30 дней»?</span>
        <textarea className="textarea" rows={3} value={expectation} maxLength={1000} onChange={(e) => setExpectation(e.target.value)} />
      </label>
      <Cta disabled={!valid || busy} onClick={save}>Продолжить</Cta>
    </Screen>
  );
}

/* ───────────── Шаг 2: цель, точки А и Б, категория (шаги 2 и 3 объединены, 02.11) ───────────── */

interface GoalDraft { id?: string; title: string; pointA: string; pointB: string; category: string }

export function GoalsStep() {
  const q = useQuestionnaire('/reg/goals');
  return <Gate q={q} id="S13">{(m) => <GoalsForm m={m} />}</Gate>;
}

/** Старый адрес шага «точки А и Б» (ссылки из старых сообщений) — теперь это часть шага целей */
export function PointsStep() {
  return <Navigate to="/reg/goals" replace />;
}

const emptyGoal = (): GoalDraft => ({ title: '', pointA: '', pointB: '', category: '' });

function GoalsForm({ m }: { m: MembershipView }) {
  const nav = useNavigate();
  const [drafts, setDrafts] = useState<GoalDraft[]>(() => (m.goals.length
    ? m.goals.map((g) => ({ id: g.id, title: g.title, pointA: g.pointA ?? '', pointB: g.pointB ?? '', category: g.category }))
    : [emptyGoal()]));
  const [busy, setBusy] = useState(false);
  const limit = m.goalLimit;
  const single = limit === 1;
  const canAdd = limit === null || drafts.length < limit;
  const valid = drafts.every((d) => d.title.trim().length >= 3 && d.pointA.trim().length >= 2 && d.pointB.trim().length >= 2 && d.category);
  const set = (i: number, patch: Partial<GoalDraft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const save = async () => {
    setBusy(true);
    try {
      const keep = new Set(drafts.map((d) => d.id).filter(Boolean));
      for (const g of m.goals) if (!keep.has(g.id)) await api(`/api/goals/${g.id}`, { method: 'DELETE' });
      for (const d of drafts) {
        const body = { title: d.title.trim(), category: d.category, pointA: d.pointA.trim(), pointB: d.pointB.trim(), successCriterion: d.pointB.trim() };
        if (d.id) {
          const prev = m.goals.find((g) => g.id === d.id);
          if (prev && (prev.title !== body.title || prev.category !== body.category || prev.pointA !== body.pointA || prev.pointB !== body.pointB)) await api(`/api/goals/${d.id}`, { method: 'PATCH', body });
        } else await api('/api/goals', { body });
      }
      haptic('success');
      nav('/reg/plan/0');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen id="S13">
      <StepBar step={2} />
      <Head icon={<Target size={28} strokeWidth={1.8} />}>Время поставить <em>{single ? 'свою цель!' : 'свои цели!'}</em> 🎯</Head>
      {!single && <span className="pill" style={{ alignSelf: 'center' }}>{limit === null ? '∞ Безлимит целей' : `Твой тариф: до ${limit} целей`}</span>}
      {drafts.map((d, i) => (
        <div className="card" style={{ gap: 12 }} key={d.id ?? `new${i}`}>
          {!single && (
            <div className="row between">
              <span className="label">Цель {i + 1}</span>
              {i > 0 && <button className="link-btn" style={{ padding: 0 }} onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>Удалить</button>}
            </div>
          )}
          <label className="field">
            <span className="h3" style={{ fontSize: 15 }}>Цель</span>
            <textarea className="textarea" rows={2} value={d.title} maxLength={200} onChange={(e) => set(i, { title: e.target.value })} />
          </label>
          <label className="field">
            <span className="h3" style={{ fontSize: 15 }}>Точка А</span>
            <textarea className="textarea" rows={2} value={d.pointA} maxLength={300} onChange={(e) => set(i, { pointA: e.target.value })} />
          </label>
          <label className="field">
            <span className="h3" style={{ fontSize: 15 }}>Точка Б</span>
            <textarea className="textarea" rows={2} value={d.pointB} maxLength={300} onChange={(e) => set(i, { pointB: e.target.value })} />
          </label>
          <div className="field">
            <span className="h3" style={{ fontSize: 15 }}>Категория</span>
            <div className="grid2">
              {GOAL_CATEGORIES.map(({ id, title, emoji }) => (
                <button key={id} type="button" className={`cat-btn ${d.category === id ? 'on' : ''}`} aria-pressed={d.category === id} onClick={() => set(i, { category: id })}>
                  {emoji} {title}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
      {!single && canAdd && <button className="btn btn-outline" onClick={() => setDrafts([...drafts, emptyGoal()])}><Plus size={17} />Добавить ещё одну цель</button>}
      <button className="link-btn" onClick={() => nav('/materials')}>Не знаешь, какую цель поставить?</button>
      <Cta disabled={!valid || busy} onClick={save}>Продолжить</Cta>
    </Screen>
  );
}

/* ───────────── Шаг 3: план действий ───────────── */

interface ActionDraft { id?: string; title: string; frequency: '' | 'daily' | 'n_per_week' | 'once'; n: number; dueDate: string }

export function PlanStep() {
  const i = Number(useParams().i ?? 0);
  const q = useQuestionnaire(`/reg/plan/${i}`);
  return <Gate q={q} id="S15">{(m) => (m.goals[i] ? <PlanForm key={m.goals[i].id} m={m} i={i} /> : <Navigate to="/reg/goals" replace />)}</Gate>;
}

function PlanForm({ m, i }: { m: MembershipView; i: number }) {
  const nav = useNavigate();
  const goal = m.goals[i];
  const h = hints(goal.category);
  const initial: ActionDraft[] = goal.tasks.length
    ? goal.tasks.map((t) => ({ id: t.id, title: t.title, frequency: t.frequency === 'every_n_days' ? 'daily' : (t.frequency as ActionDraft['frequency']), n: t.n, dueDate: t.dueDate ?? '' }))
    : [{ title: '', frequency: '', n: 3, dueDate: '' }];
  const [actions, setActions] = useState<ActionDraft[]>(initial);
  const [examples, setExamples] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: number, patch: Partial<ActionDraft>) => setActions(actions.map((x, j) => (j === k ? { ...x, ...patch } : x)));
  const valid = actions.length > 0 && actions.every((x) => x.title.trim().length >= 2 && x.frequency && (x.frequency !== 'once' || x.dueDate));
  const { startsOn, endsOn } = m.flow;

  const save = async () => {
    setBusy(true);
    try {
      const keep = new Set(actions.map((x) => x.id).filter(Boolean));
      for (const t of goal.tasks) if (!keep.has(t.id)) await api(`/api/tasks/${t.id}`, { method: 'DELETE' });
      for (const x of actions) {
        const body = { title: x.title.trim(), frequency: x.frequency, n: x.frequency === 'n_per_week' ? x.n : 1, dueDate: x.frequency === 'once' ? x.dueDate : null };
        if (x.id) {
          const prev = goal.tasks.find((t) => t.id === x.id)!;
          if (prev.title !== body.title || prev.frequency !== body.frequency || prev.n !== body.n || (prev.dueDate ?? null) !== body.dueDate) await api(`/api/tasks/${x.id}`, { method: 'PATCH', body });
        } else await api(`/api/goals/${goal.id}/tasks`, { body });
      }
      haptic('success');
      // после плана действий — дата старта, затем бадди и «обещание себе» (решение владельца 03.11)
      nav(i + 1 < m.goals.length ? `/reg/plan/${i + 1}` : '/reg/start');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen id="S15">
      <StepBar step={3} />
      <Head icon={<ListChecks size={28} strokeWidth={1.8} />} lead="Какие ключевые действия ты обязуешься выполнять, чтобы достичь своей цели, и ежедневно отчитываться о них?">
        Большая цель начинается <em>с маленьких действий!</em> 🚀
      </Head>
      <div className="panel" style={{ gap: 4, padding: '12px 14px' }}>
        <span className="row label" style={{ gap: 6, color: 'var(--accent)' }}><Target size={14} />{m.goals.length > 1 ? `Цель ${i + 1} из ${m.goals.length}` : 'Твоя цель'}</span>
        <div className="h3" style={{ fontSize: 15 }}>{goal.title}</div>
      </div>
      {actions.map((x, k) => (
        <div className="card" key={x.id ?? `new${k}`} style={{ gap: 10 }}>
          <div className="row between">
            <span className="h3" style={{ fontSize: 16 }}>Действие {k + 1}</span>
            {actions.length > 1 && <button className="link-btn" style={{ padding: 0 }} onClick={() => setActions(actions.filter((_, j) => j !== k))}>Удалить</button>}
          </div>
          <input className="input" placeholder={h.action} value={x.title} maxLength={160} onChange={(e) => set(k, { title: e.target.value })} />
          <span className="small" style={{ fontWeight: 600, color: 'var(--ink-2)', marginTop: 4 }}>Как часто будешь выполнять?</span>
          <div role="radiogroup">
            <Radio on={x.frequency === 'daily'} onClick={() => set(k, { frequency: 'daily' })}>Ежедневно</Radio>
            <Radio on={x.frequency === 'n_per_week'} onClick={() => set(k, { frequency: 'n_per_week' })}>X раз в неделю</Radio>
            <Radio on={x.frequency === 'once'} onClick={() => set(k, { frequency: 'once' })}>Одноразовая задача</Radio>
          </div>
          {x.frequency === 'n_per_week' && (
            <div className="field" style={{ background: 'var(--bg)', borderRadius: 14, padding: 12 }}>
              <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>Сколько раз в неделю?</span>
              {/* Любое число от 1 до 7 — все варианты видны сразу */}
              <div className="n-chips" role="radiogroup">
                {[1, 2, 3, 4, 5, 6, 7].map((n) => <button key={n} type="button" role="radio" aria-checked={x.n === n} className={x.n === n ? 'on' : ''} onClick={() => set(k, { n })}>{n}</button>)}
              </div>
              <span className="small" style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>{x.n} {x.n === 1 ? 'раз' : x.n < 5 ? 'раза' : 'раз'} в неделю</span>
            </div>
          )}
          {x.frequency === 'once' && (
            <div className="field" style={{ background: 'var(--bg)', borderRadius: 14, padding: 12 }}>
              <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>До какой даты выполнишь?</span>
              <label className="date-pick">
                <CalendarDays size={16} />
                <span className="grow">{x.dueDate ? humanDate(x.dueDate) : 'Выбрать дату'}</span>
                <ChevronDown size={16} color="var(--muted-2)" />
                <input type="date" min={startsOn} max={endsOn} value={x.dueDate} onChange={(e) => set(k, { dueDate: e.target.value })} aria-label="Дата выполнения" />
              </label>
            </div>
          )}
        </div>
      ))}
      <button className="btn btn-outline" onClick={() => setActions([...actions, { title: '', frequency: '', n: 3, dueDate: '' }])}><Plus size={17} />Добавить действие</button>
      <button className="link-btn" onClick={() => setExamples(!examples)}>
        {examples ? 'Скрыть примеры' : 'Посмотреть примеры действий'} {examples ? <ChevronUp size={13} style={{ verticalAlign: -2 }} /> : <ChevronDown size={13} style={{ verticalAlign: -2 }} />}
      </button>
      {examples && (
        <div className="card" style={{ gap: 6 }}>
          <div className="h3" style={{ fontSize: 15 }}>Например, для {EXAMPLE_FOR[goal.category] ?? 'твоей цели'}:</div>
          {h.examples.map((e) => <div key={e} className="muted" style={{ fontSize: 14 }}>• {e}</div>)}
        </div>
      )}
      <Note icon={<ClipboardCheck size={17} />} title="Каждый день — маленький отчёт">
        Каждый день ты будешь отмечать выполнение запланированных действий. Так ты увидишь свой прогресс, а твой бадди сможет тебя поддерживать.
      </Note>
      <Cta disabled={!valid || busy} onClick={save}>{i + 1 < m.goals.length ? 'Следующая цель' : 'Сохранить план действий'}</Cta>
    </Screen>
  );
}

const EXAMPLE_FOR: Record<string, string> = { blog: 'развития блога', money: 'роста дохода', weightloss: 'похудения', english: 'английского', habits: 'новой привычки' };

/* ───────────── Экран 18: обещание себе ───────────── */

export function ConfirmStep() {
  const q = useQuestionnaire('/reg/confirm');
  return <Gate q={q} id="S16">{(m) => <ConfirmForm m={m} />}</Gate>;
}

function ConfirmForm({ m }: { m: MembershipView }) {
  const nav = useNavigate();
  const { refresh } = useMe();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const incomplete = useMemo(() => m.goals.findIndex((g) => !g.pointA || !g.pointB || g.tasks.length === 0), [m.goals]);

  const submit = async () => {
    setBusy(true);
    try {
      await api('/api/membership/fix', { body: {} });
      track('registration_completed', { screen: 'S16', metadata: { goals: m.goals.length } });
      haptic('success');
      await requestWriteAccess();
      await refresh();
      nav('/ready', { replace: true });
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!m.goals.length) return <Navigate to="/reg/goals" replace />;
  return (
    <Screen id="S16">
      <BrandBar right={<span className="counter">Последний шаг</span>} />
      <Head icon={<Handshake size={28} strokeWidth={1.8} />} lead="Проверь свои цели и план действий. Именно к этим результатам ты будешь идти ближайшие 30 дней. После отправки анкету изменить будет нельзя.">
        Это твоё <em>обещание себе!</em> 🤝
      </Head>
      {m.goals.map((g, i) => <PromiseCard key={g.id} goal={g} i={i} total={m.goals.length} />)}
      <label className="card promise-check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>Я подтверждаю, что осознанно выбираю эти цели и обязуюсь выполнять запланированные действия, ежедневно отчитываться и отвечать за свои результаты.</span>
      </label>
      {incomplete >= 0 && <div className="banner warn">Заполни точки А/Б и план действий для цели «{m.goals[incomplete].title}».</div>}
      <Cta disabled={!agree || busy || incomplete >= 0} onClick={submit}>Я беру на себя ответственность 💜</Cta>
    </Screen>
  );
}

function PromiseCard({ goal, i, total }: { goal: Goal; i: number; total: number }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(true);
  const edit = (to: string) => (
    <button className="pencil" aria-label="Изменить" onClick={() => nav(to)}><Pencil size={15} /></button>
  );
  return (
    <div className="card" style={{ gap: 12 }}>
      <span className="row" style={{ gap: 10 }}><span className="ic sq" style={{ width: 34, height: 34, borderRadius: 10 }}><Target size={17} /></span><span className="h3" style={{ fontSize: 17 }}>{total > 1 ? `Цель ${i + 1}` : 'Твоя цель'}</span></span>
      <div className="row" style={{ background: 'var(--bg)', borderRadius: 14, padding: '12px 14px', alignItems: 'flex-start' }}>
        <span className="grow" style={{ fontSize: 17, fontWeight: 600 }}>{goal.title}</span>{edit('/reg/goals')}
      </div>
      <div className="grid2">
        <div className="row" style={{ background: 'var(--bg)', borderRadius: 14, padding: '12px', alignItems: 'flex-start' }}>
          <span className="grow"><span className="label" style={{ color: 'var(--muted)', display: 'block', fontSize: 12 }}>Точка А</span><span style={{ display: 'block', marginTop: 6, fontSize: 15 }}>{goal.pointA || '—'}</span></span>{edit('/reg/goals')}
        </div>
        <div className="row" style={{ background: 'var(--accent-soft)', borderRadius: 14, padding: '12px', alignItems: 'flex-start' }}>
          <span className="grow"><span className="label" style={{ color: 'var(--accent)', display: 'block', fontSize: 12 }}>Точка Б</span><span style={{ display: 'block', marginTop: 6, fontSize: 15, color: 'var(--ink-2)' }}>{goal.pointB || '—'}</span></span>{edit('/reg/goals')}
        </div>
      </div>
      <button className="row between" style={{ border: 0, background: 'none', padding: '4px 0', cursor: 'pointer' }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="row h3" style={{ gap: 10, fontSize: 17 }}><ListChecks size={18} color="var(--accent)" />План действий</span>
        {open ? <ChevronUp size={19} color="var(--accent)" /> : <ChevronDown size={19} color="var(--accent)" />}
      </button>
      {open && goal.tasks.map((t) => (
        <div className="row" key={t.id} style={{ alignItems: 'flex-start', gap: 10, background: 'var(--bg)', borderRadius: 14, padding: '12px 12px' }}>
          <CircleCheck size={18} color="var(--accent)" style={{ marginTop: 2 }} />
          <div className="grow"><div style={{ fontSize: 15 }}>{t.title}</div><div className="muted small" style={{ marginTop: 3 }}>{t.schedule}</div></div>
          {edit(`/reg/plan/${i}`)}
        </div>
      ))}
    </div>
  );
}

/* ───────────── После отправки анкеты ───────────── */

export function ReadyScreen() {
  const nav = useNavigate();
  const { me } = useMe();
  const flow = me?.membership?.flow;
  const started = flow ? flow.phase !== 'upcoming' : false;
  return (
    <Screen id="S17">
      <BrandBar right={<span className="row" style={{ gap: 5, color: 'var(--green)', fontWeight: 600, fontSize: 14 }}><CircleCheck size={15} />Анкета готова</span>} />
      <img src="/img/success.png" alt="" style={{ width: '62%', maxWidth: 240, alignSelf: 'center', marginTop: 12 }} />
      <div className="col" style={{ gap: 10 }}>
        <h1 className="hero">Ты готова <em>к большим переменам!</em> 💜</h1>
        <p className="lead">Ты поставила цели, составила план действий и дала себе обещание. {started ? 'Челлендж уже идёт — начинай действовать вместе с нами!' : 'Осталось дождаться старта и начать действовать вместе с нами!'}</p>
      </div>
      {flow && (
        <div className="card center" style={{ alignItems: 'center', gap: 8 }}>
          <span className="row muted" style={{ gap: 8, fontSize: 15 }}><CalendarDays size={17} color="var(--accent)" />Старт твоего челленджа</span>
          <div style={{ color: 'var(--accent-2)', fontSize: 30, fontWeight: 700 }}>{humanDate(flow.startsOn)}</div>
          <span className="pill" style={{ fontSize: 15, padding: '7px 16px' }}><Hourglass size={15} />{started ? 'Уже начали!' : 'Скоро начинаем!'}</span>
          <span className="muted small">{started ? 'Ежедневные отчёты и отслеживание прогресса уже открыты.' : 'В день старта откроются ежедневные отчёты и отслеживание прогресса.'}</span>
        </div>
      )}
      <div className="panel" style={{ gap: 10, padding: 16 }}>
        <span className="row" style={{ gap: 8, color: 'var(--accent-ink)', fontWeight: 600, fontSize: 17 }}><CheckCheck size={18} />Ты уже сделала главное</span>
        {['Доступ к сообществу оформлен', 'Цели и план действий сохранены', 'Ты готова к первому дню'].map((t) => (
          <span key={t} className="row" style={{ gap: 10, color: 'var(--ink-2)' }}><CircleCheck size={18} color="var(--green-2)" />{t}</span>
        ))}
      </div>
      <Cta onClick={() => nav('/club')}>Перейти в сообщество 💜</Cta>
      <button className="btn" style={{ background: '#fff', border: '1px solid #ddd5fa', color: 'var(--accent)', minHeight: 50 }} onClick={() => nav('/materials')}>
        <BookOpen size={18} />Полезные материалы<ArrowRight size={16} />
      </button>
      <button className="link-btn" onClick={() => nav('/')}>На главную</button>
    </Screen>
  );
}
