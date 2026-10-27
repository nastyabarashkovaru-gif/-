import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  Target, Sparkles, Lightbulb, CircleX, CircleCheck, Trophy, Plus, Route, ArrowDown, ShieldCheck, ListChecks, ClipboardCheck,
  CalendarDays, ChevronDown, ChevronUp, Handshake, HeartHandshake, MapPin, Users, Hourglass, CheckCheck, BookOpen, ArrowRight, Pencil,
} from 'lucide-react';
import { api } from '../../lib/api';
import { track } from '../../lib/analytics';
import { haptic, openTelegram, requestWriteAccess } from '../../lib/telegram';
import { useMe } from '../../state';
import { BrandBar, Cta, Empty, ErrorState, Loading, Screen, errorText, humanDate, toast } from '../../ui';
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

const CONFIRM = [
  ['screenshot', 'Скриншот статистики или приложения'],
  ['photo_video', 'Фото или видео'],
  ['document', 'Документ или другой показатель'],
  ['daily_reports', 'Ежедневные отчёты'],
  ['other', 'Другой способ'],
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
      <BrandBar right={<span className="counter">Шаг {step} из 4</span>} />
      <div className="steps" aria-hidden>{[1, 2, 3, 4].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
    </>
  );
}

function Head({ icon, children, lead }: { icon: ReactNode; children: ReactNode; lead: ReactNode }) {
  return (
    <div className="col" style={{ gap: 10, alignItems: 'center', marginTop: 8 }}>
      <span className="ic lg">{icon}</span>
      <h1 className="hero" style={{ marginTop: 6 }}>{children}</h1>
      <p className="lead" style={{ fontSize: 15 }}>{lead}</p>
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

  return (
    <Screen id="S12">
      <StepBar step={1} />
      <Head icon={<Users size={28} strokeWidth={1.8} />} lead="Расскажи немного о себе, чтобы твой бадди и другие участники узнали, кто идёт с ними к цели.">
        Давай <em>знакомиться!</em> 😍
      </Head>
      <label className="field">
        <span className="h3" style={{ fontSize: 15 }}>Как тебя зовут?</span>
        <input className="input" placeholder="Например, Настя" value={name} maxLength={64} autoComplete="given-name" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span className="h3" style={{ fontSize: 15 }}>Из какого ты города?</span>
        <input className="input" placeholder="Например, Москва" value={city} maxLength={64} autoComplete="address-level2" onChange={(e) => setCity(e.target.value)} />
      </label>
      <label className="field">
        <span className="h3" style={{ fontSize: 15 }}>Сколько тебе лет?</span>
        <input className="input" placeholder="Например, 25" inputMode="numeric" value={age} maxLength={2} onChange={(e) => setAge(e.target.value.replace(/\D/g, ''))} />
      </label>
      <label className="field">
        <span className="h3" style={{ fontSize: 15 }}>Чем ты занимаешься?</span>
        <textarea className="textarea" rows={2} placeholder="Учусь, работаю, развиваю блог, создаю бизнес..." value={occupation} maxLength={300} onChange={(e) => setOccupation(e.target.value)} />
      </label>
      <Note icon={<HeartHandshake size={17} />} title="Это увидит твой бадди">
        Твои ответы помогут начать общение без неловкого «Привет, расскажи о себе».
      </Note>
      <label className="field">
        <span className="h3" style={{ fontSize: 15 }}>Что ты хочешь получить от клуба «30 дней»?</span>
        <textarea className="textarea" rows={3} placeholder="Например, поддержку, новые привычки, дисциплину, окружение…" value={expectation} maxLength={1000} onChange={(e) => setExpectation(e.target.value)} />
        <p className="hint">Этот ответ видит только команда клуба — он помогает нам сделать «30 дней» полезнее.</p>
      </label>
      <Cta disabled={!valid || busy} onClick={save}>Продолжить</Cta>
    </Screen>
  );
}

/* ───────────── Шаг 2: цели ───────────── */

interface GoalDraft { id?: string; title: string; category: string }

export function GoalsStep() {
  const q = useQuestionnaire('/reg/goals');
  return <Gate q={q} id="S13">{(m) => <GoalsForm m={m} />}</Gate>;
}

function GoalsForm({ m }: { m: MembershipView }) {
  const nav = useNavigate();
  const [drafts, setDrafts] = useState<GoalDraft[]>(() => (m.goals.length ? m.goals.map((g) => ({ id: g.id, title: g.title, category: g.category })) : [{ title: '', category: '' }]));
  const [busy, setBusy] = useState(false);
  const limit = m.goalLimit;
  const single = limit === 1;
  const unlimited = limit === null;
  const canAdd = limit === null || drafts.length < limit;
  const valid = drafts.every((d) => d.title.trim().length >= 3 && d.category);
  const set = (i: number, patch: Partial<GoalDraft>) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const save = async () => {
    setBusy(true);
    try {
      const keep = new Set(drafts.map((d) => d.id).filter(Boolean));
      for (const g of m.goals) if (!keep.has(g.id)) await api(`/api/goals/${g.id}`, { method: 'DELETE' });
      for (const d of drafts) {
        const body = { title: d.title.trim(), category: d.category };
        if (d.id) {
          const prev = m.goals.find((g) => g.id === d.id);
          if (prev && (prev.title !== body.title || prev.category !== body.category)) await api(`/api/goals/${d.id}`, { method: 'PATCH', body });
        } else await api('/api/goals', { body });
      }
      haptic('success');
      nav('/reg/points/0');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen id="S13">
      <StepBar step={2} />
      <Head
        icon={unlimited ? <Sparkles size={28} strokeWidth={1.8} /> : <Target size={28} strokeWidth={1.8} />}
        lead={single ? 'Укажи одну измеримую цель, которую ты обязуешься достичь за ближайшие 30 дней.' : unlimited ? 'Укажи измеримые цели, которые ты обязуешься достичь за ближайшие 30 дней.' : `Укажи до ${limit} измеримых целей, которые ты обязуешься достичь за ближайшие 30 дней.`}
      >
        Время поставить <em>{single ? 'свою цель!' : 'свои цели!'}</em> 🎯
      </Head>
      {!single && <span className="pill" style={{ alignSelf: 'center' }}>{unlimited ? '∞ Безлимит целей' : `Твой тариф: до ${limit} целей`}</span>}
      <div className="card" style={{ gap: 8 }}>
        <div className="row h3" style={{ gap: 8 }}><Lightbulb size={18} color="var(--accent)" />Как правильно поставить цель?</div>
        {[
          ['Хочу развивать блог', 'Непонятно, какой результат считать успехом', 'Набрать 1 000 подписчиков за 30 дней', 'Измеримый результат'],
          ['Хочу раньше вставать', 'Непонятно, во сколько и как часто', 'Каждый день вставать в 7:00 без пропусков', 'Измеримая привычка — 30 из 30 дней'],
        ].map(([bad, why, good, ok], i) => (
          <div key={bad} className="col" style={{ gap: 4, paddingTop: i ? 12 : 4, borderTop: i ? '1px solid var(--line)' : 0 }}>
            <div className="row" style={{ gap: 8, color: 'var(--muted-2)', textDecoration: 'line-through' }}><CircleX size={16} color="#d27b7b" />{bad}</div>
            <div className="muted small" style={{ paddingLeft: 24 }}>{why}</div>
            <div className="row" style={{ gap: 8, fontWeight: 500, marginTop: 4 }}><CircleCheck size={16} color="var(--green-2)" />{good}</div>
            <div className="small" style={{ paddingLeft: 24, color: 'var(--green)' }}>{ok}</div>
          </div>
        ))}
      </div>
      {drafts.map((d, i) => (
        <div className="field" key={d.id ?? `new${i}`}>
          <div className="row between">
            <span className="h3" style={{ fontSize: 15 }}>{single ? 'Твоя цель на 30 дней' : `Цель ${i + 1}`}</span>
            {single ? <span className="counter">1 из 1</span> : i === 0 ? <span className="counter">Обязательная</span> : (
              <button className="link-btn" style={{ padding: 0 }} onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>Удалить</button>
            )}
          </div>
          <textarea className="textarea" placeholder="Я обязуюсь..." value={d.title} maxLength={200} onChange={(e) => set(i, { title: e.target.value })} />
          <div className="card" style={{ gap: 10, marginTop: 4 }}>
            <span className="row h3" style={{ gap: 8, alignItems: 'flex-start' }}><Target size={18} color="var(--accent)" style={{ marginTop: 2 }} />К какой категории относится твоя цель?</span>
            <span className="muted small" style={{ marginTop: -4 }}>Так другие участники смогут найти тебя по интересам.</span>
            <div className="grid2">
              {GOAL_CATEGORIES.map(({ id, title, emoji }) => (
                <button key={id} type="button" className={`cat-btn ${d.category === id ? 'on' : ''}`} aria-pressed={d.category === id} onClick={() => set(i, { category: id })}>
                  {emoji} {title}
                </button>
              ))}
            </div>
            {d.category && <span className="row small" style={{ gap: 6, color: 'var(--accent)' }}><CircleCheck size={15} />Выбрано: {GOAL_CATEGORIES.find((c) => c.id === d.category)?.title}</span>}
          </div>
        </div>
      ))}
      {single ? (
        <p className="hint">Сформулируй цель так, чтобы через 30 дней можно было однозначно определить: выполнена она или нет.</p>
      ) : (
        <>
          {canAdd && <button className="btn btn-outline" onClick={() => setDrafts([...drafts, { title: '', category: '' }])}><Plus size={17} />Добавить ещё одну цель</button>}
          <p className="hint">{unlimited ? 'Добавляй столько целей, сколько готов выполнить и подтвердить за 30 дней.' : 'Каждая цель должна иметь результат, который можно объективно проверить через 30 дней.'}</p>
        </>
      )}
      <button className="link-btn" onClick={() => nav('/materials')}>Не знаешь, какую цель поставить?</button>
      <Note icon={<Trophy size={17} />} title={single ? 'Твоя цель — твоё обещание' : 'Твои цели — твоё обещание'}>
        {single
          ? 'Чтобы участвовать в розыгрыше призов, нужно выполнить свою цель и подтвердить результат. Для ежедневной привычки это означает выполнение все 30 дней без пропусков.'
          : 'Чтобы участвовать в розыгрыше призов, нужно выполнить все поставленные цели и подтвердить результаты. Для ежедневной привычки — ни одного пропуска за 30 дней.'}
      </Note>
      <Cta disabled={!valid || busy} onClick={save}>Продолжить</Cta>
    </Screen>
  );
}

function GoalCard({ goal, index, total }: { goal: Goal; index: number; total: number }) {
  return (
    <div className="card" style={{ gap: 4, padding: '12px 14px' }}>
      <div className="row between">
        <span className="label">{total > 1 ? `Цель ${index + 1} из ${total}` : 'Твоя цель'}</span>
        <Target size={15} color="var(--accent)" />
      </div>
      <div className="h3" style={{ fontSize: 16 }}>{goal.title}</div>
    </div>
  );
}

/* ───────────── Шаг 3: точки А и Б ───────────── */

export function PointsStep() {
  const i = Number(useParams().i ?? 0);
  const q = useQuestionnaire(`/reg/points/${i}`);
  return <Gate q={q} id="S14">{(m) => (m.goals[i] ? <PointsForm key={m.goals[i].id} m={m} i={i} /> : <Navigate to="/reg/goals" replace />)}</Gate>;
}

function PointsForm({ m, i }: { m: MembershipView; i: number }) {
  const nav = useNavigate();
  const goal = m.goals[i];
  const h = hints(goal.category);
  const [a, setA] = useState(goal.pointA ?? '');
  const [b, setB] = useState(goal.pointB ?? '');
  const [method, setMethod] = useState(goal.confirmMethod ?? '');
  const [note, setNote] = useState(goal.confirmNote ?? '');
  const [busy, setBusy] = useState(false);
  const valid = a.trim().length >= 2 && b.trim().length >= 2 && method && (method !== 'other' || note.trim().length >= 3);

  const save = async () => {
    setBusy(true);
    try {
      await api(`/api/goals/${goal.id}`, { method: 'PATCH', body: { pointA: a.trim(), pointB: b.trim(), successCriterion: b.trim(), confirmMethod: method, confirmNote: method === 'other' ? note.trim() : null } });
      nav(i + 1 < m.goals.length ? `/reg/points/${i + 1}` : '/reg/plan/0');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen id="S14">
      <StepBar step={3} />
      <Head icon={<Route size={28} strokeWidth={1.8} />} lead="Давай зафиксируем, где ты сейчас и какой результат должен быть через 30 дней.">
        От точки А <em>до точки Б!</em> 🚀
      </Head>
      <GoalCard goal={goal} index={i} total={m.goals.length} />
      <div className="field">
        <div className="row" style={{ gap: 10 }}>
          <span className="ic sq" style={{ width: 34, height: 34, borderRadius: 10, fontWeight: 600 }}>А</span>
          <span className="h3" style={{ fontSize: 16 }}>Опиши свою стартовую точку</span>
        </div>
        <textarea className="textarea" placeholder={h.a} value={a} maxLength={300} onChange={(e) => setA(e.target.value)} />
        <p className="hint">Это точка А. С неё ты сможешь оценить свой прогресс.</p>
      </div>
      <div className="row" style={{ gap: 10 }}><div className="divider grow" /><ArrowDown size={14} color="var(--accent)" /><div className="divider grow" /></div>
      <div className="field">
        <div className="row" style={{ gap: 10 }}>
          <span className="ic sq" style={{ width: 34, height: 34, borderRadius: 10, fontWeight: 600, background: 'var(--accent)', color: '#fff' }}>Б</span>
          <span className="h3" style={{ fontSize: 16 }}>Какой результат должен быть через 30 дней?</span>
        </div>
        <textarea className="textarea" placeholder={h.b} value={b} maxLength={300} onChange={(e) => setB(e.target.value)} />
        <p className="hint">Это точка Б. Так мы сможем проверить, была ли выполнена цель.</p>
      </div>
      <div className="card" style={{ gap: 4 }}>
        <div className="row h3" style={{ gap: 8, fontSize: 15 }}><ShieldCheck size={17} color="var(--accent)" />Как подтвердим результат?</div>
        <p className="muted small" style={{ margin: '2px 0 6px' }}>Выбери способ, которым сможешь доказать выполнение цели в конце челленджа.</p>
        <div role="radiogroup">
          {CONFIRM.map(([id, label]) => <Radio key={id} on={method === id} onClick={() => setMethod(id)}>{label}</Radio>)}
        </div>
        {method === 'other' && <input className="input" placeholder="Опиши, как подтвердишь результат" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />}
      </div>
      <Note icon={<Trophy size={17} />} title="Важное условие розыгрыша">
        Для участия в розыгрыше нужно достичь всех поставленных целей и подтвердить их выполнение. Поэтому точка Б должна быть конкретной и проверяемой.
      </Note>
      <Cta disabled={!valid || busy} onClick={save}>{i + 1 < m.goals.length ? 'Следующая цель' : 'Перейти к плану действий'}</Cta>
    </Screen>
  );
}

/* ───────────── Шаг 4: план действий ───────────── */

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
      nav(i + 1 < m.goals.length ? `/reg/plan/${i + 1}` : '/reg/confirm');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen id="S15">
      <StepBar step={4} />
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
              <select className="select pill-select" value={x.n} onChange={(e) => set(k, { n: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} {n === 1 ? 'раз' : n < 5 ? 'раза' : 'раз'}</option>)}
              </select>
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
  const incomplete = useMemo(() => m.goals.findIndex((g) => !g.pointA || !g.pointB || !g.confirmMethod || g.tasks.length === 0), [m.goals]);

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
          <span className="grow"><span className="label" style={{ color: 'var(--muted)', display: 'block', fontSize: 12 }}>Точка А</span><span style={{ display: 'block', marginTop: 6, fontSize: 15 }}>{goal.pointA || '—'}</span></span>{edit(`/reg/points/${i}`)}
        </div>
        <div className="row" style={{ background: 'var(--accent-soft)', borderRadius: 14, padding: '12px', alignItems: 'flex-start' }}>
          <span className="grow"><span className="label" style={{ color: 'var(--accent)', display: 'block', fontSize: 12 }}>Точка Б</span><span style={{ display: 'block', marginTop: 6, fontSize: 15, color: 'var(--ink-2)' }}>{goal.pointB || '—'}</span></span>{edit(`/reg/points/${i}`)}
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
