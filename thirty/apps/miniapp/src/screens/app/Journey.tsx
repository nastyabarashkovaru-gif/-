import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, CircleCheck, Clock, Download, Flame, Gift, ImagePlus, MessageCircle, RefreshCw, Share2, Sparkles, Target, Trophy, X } from 'lucide-react';
import { api, uploadImage } from '../../lib/api';
import { canShareStory, downloadImage, haptic, openExternal, openTelegram, shareStory } from '../../lib/telegram';
import { formatMetric } from '../../lib/metric';
import { Cta, ErrorState, Header, Loading, Popup, Screen, errorText, plural, toast, useLoad } from '../../ui';

/* ───────────── Обратная связь на предпоследний день ───────────── */

const HELPED = ['Поддержка напарника', 'Общение в клубе', 'Мотивация и собственное желание'];
const HINDERED = ['Отсутствие напарника', 'Общение в клубе', 'Нехватка времени', 'Не рассчитала силы и время', 'Сложно было вернуться после пропуска'];

/** Всплывающее окно «Уже завтра заканчиваются наши 30 дней» */
export function FeedbackPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  return (
    <Popup open={open} onClose={onClose}>
      <div className="popup-emoji">🥹</div>
      <h2 className="h2 center" style={{ fontSize: 22 }}>Уже завтра заканчиваются наши 30 дней 🥹💜</h2>
      <p className="muted center" style={{ margin: 0, lineHeight: 1.45 }}>Мне даже немного грустно, что наш челлендж подходит к концу!</p>
      <p className="muted center" style={{ margin: 0, lineHeight: 1.45 }}>Чтобы следующий месяц стал ещё лучше, расскажи, пожалуйста, как прошли твои 30 дней.</p>
      <p className="muted center" style={{ margin: 0, lineHeight: 1.45 }}>Твои ответы помогут нам сделать клуб полезнее 💜</p>
      <Cta onClick={() => { onClose(); nav('/feedback'); }}>Поделиться обратной связью</Cta>
    </Popup>
  );
}

function Choice({ options, value, onChange, other, onOther }: { options: string[]; value: string[]; onChange: (v: string[]) => void; other: string; onOther: (v: string) => void }) {
  const [otherOn, setOtherOn] = useState(Boolean(other));
  return (
    <div className="col" style={{ gap: 8 }}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} type="button" className={`check-row ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>
            <i>{on && <CircleCheck size={16} />}</i>{o}
          </button>
        );
      })}
      <button type="button" className={`check-row ${otherOn ? 'on' : ''}`} aria-pressed={otherOn} onClick={() => { setOtherOn(!otherOn); if (otherOn) onOther(''); }}>
        <i>{otherOn && <CircleCheck size={16} />}</i>Другое
      </button>
      {otherOn && <input className="input" placeholder="Напиши свой вариант" value={other} maxLength={500} onChange={(e) => onOther(e.target.value)} />}
    </div>
  );
}

function Q({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="card" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <span className="num-sq" style={{ width: 32, height: 32, fontSize: 15, borderRadius: 10 }}>{n}</span>
        <span className="h3" style={{ fontSize: 16, paddingTop: 5 }}>{title}</span>
      </div>
      {hint && <span className="muted small" style={{ marginTop: -4 }}>{hint}</span>}
      {children}
    </div>
  );
}

/** Форма обратной связи: шесть вопросов; после отправки — спасибо */
export function FeedbackScreen() {
  const nav = useNavigate();
  const [month, setMonth] = useState('');
  const [helped, setHelped] = useState<string[]>([]);
  const [helpedOther, setHelpedOther] = useState('');
  const [hindered, setHindered] = useState<string[]>([]);
  const [hinderedOther, setHinderedOther] = useState('');
  const [benefit, setBenefit] = useState('');
  const [change, setChange] = useState('');
  const [needHelp, setNeedHelp] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const filled = (s: string) => s.trim().length > 0;
  const valid = filled(month) && (helped.length > 0 || filled(helpedOther)) && (hindered.length > 0 || filled(hinderedOther)) && filled(benefit) && filled(change) && filled(needHelp);

  const submit = async () => {
    setBusy(true);
    try {
      await api('/api/feedback', { body: { month, helped, helpedOther, hindered, hinderedOther, benefit, change, needHelp } });
      haptic('success');
      setDone(true);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen id="FEEDBACK_DONE">
        <div className="col center" style={{ gap: 14, marginTop: '18vh', alignItems: 'center' }}>
          <span className="ic lg"><CircleCheck size={30} /></span>
          <h1 className="hero" style={{ fontSize: 26 }}>Спасибо! Твоя обратная связь поможет нам стать лучше 💜</h1>
        </div>
        <div className="spacer" />
        <Cta onClick={() => nav('/')}>На главную</Cta>
      </Screen>
    );
  }
  const area = (v: string, set: (s: string) => void, ph = 'Твой ответ') => <textarea className="textarea" rows={3} placeholder={ph} value={v} maxLength={3000} onChange={(e) => set(e.target.value)} />;
  return (
    <Screen id="FEEDBACK">
      <Header title="Как прошли твои 30 дней?" sub="Шесть вопросов — это займёт пару минут" back="/" />
      <Q n={1} title="Как прошёл ваш месяц в клубе?" hint="Расскажите, как продвигалась Ваша привычка, что получилось и что не получилось.">{area(month, setMonth)}</Q>
      <Q n={2} title="Что больше всего помогало Вам двигаться к цели?"><Choice options={HELPED} value={helped} onChange={setHelped} other={helpedOther} onOther={setHelpedOther} /></Q>
      <Q n={3} title="Что больше всего мешало Вам двигаться к цели?"><Choice options={HINDERED} value={hindered} onChange={setHindered} other={hinderedOther} onOther={setHinderedOther} /></Q>
      <Q n={4} title="Какую пользу Вы получили от клуба в этот период?" hint="Что оказалось полезным, а чего Вам не хватило?">{area(benefit, setBenefit)}</Q>
      <Q n={5} title="Что бы Вы изменили в клубе, чтобы он помогал Вам лучше достигать поставленные цели?">{area(change, setChange)}</Q>
      <Q n={6} title="Нужна ли Вам какая-то помощь или поддержка от клуба сейчас?" hint="Если да, расскажите, какая именно. Если нет, можете так и написать.">{area(needHelp, setNeedHelp)}</Q>
      <Cta disabled={!valid || busy} onClick={submit}>{busy ? 'Отправляем…' : 'Отправить'}</Cta>
    </Screen>
  );
}

/* ───────────── Итоги потока ───────────── */

interface FinaleGoal { id: string; title: string; category: string; pointA: string | null; pointB: string | null; numeric: boolean; unit: string; current: number | null; progress: number | null; planPercent: number; outcome: 'full' | 'partial' | 'none' | null }
interface Finale {
  flow: { title: string; days: number };
  stats: { reportDays: number; successfulDays: number; percent: number | null; longestStreak: number; goalsTotal: number; goalsAchieved: number | null; rank: { place: number; of: number } | null };
  goals: FinaleGoal[];
  result: string | null;
  submitted: boolean;
  next: { kind: 'goals' | 'debt' | 'comeback' };
}

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 1.6,
    dur: 2.6 + Math.random() * 2.2,
    color: ['#7150E7', '#F28C38', '#2F9E68', '#F2B8D0', '#E2A33B', '#A78BFA'][i % 6],
    rot: Math.random() * 360,
    w: 6 + Math.random() * 6,
  })), []);
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => <i key={i} style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, background: p.color, transform: `rotate(${p.rot}deg)`, width: p.w, height: p.w * 1.6 }} />)}
    </div>
  );
}

function Stat({ icon, value, label }: { icon: ReactNode; value: ReactNode; label: string }) {
  return (
    <div className="fin-stat">
      <span className="fin-ic">{icon}</span>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

const OUTCOMES = [['full', 'Да, полностью'], ['partial', 'Частично'], ['none', 'Пока нет']] as const;

/** Финал: экран 1 — «Ты прошла 30 дней!» с конфетти и статистикой; экран 2 — результаты по целям */
export function FinaleScreen() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<Finale>('/api/finale'));
  const [step, setStep] = useState<1 | 2>(1);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!data) return;
    setOutcomes(Object.fromEntries(data.goals.filter((g) => g.outcome).map((g) => [g.id, g.outcome!])));
    setResult(data.result ?? '');
    if (data.submitted) setStep(2);
  }, [data]);

  if (loading && !data) return <Screen id="FINALE"><Loading /></Screen>;
  if (error || !data) return <Screen id="FINALE"><Header title="Итоги" back="/" /><ErrorState error={error} retry={reload} /></Screen>;
  const s = data.stats;

  if (step === 1) {
    return (
      <Screen id="FINALE_1" className="finale">
        <Confetti />
        <div className="col center" style={{ gap: 8, alignItems: 'center', marginTop: 18 }}>
          <span className="finale-badge">🎉</span>
          <h1 className="hero" style={{ fontSize: 30 }}>Ты прошла 30 дней! 🎉</h1>
          <p className="lead" style={{ fontSize: 16 }}>Посмотри, сколько всего тебе удалось сделать за этот месяц!</p>
        </div>
        <div className="fin-grid">
          <Stat icon={<CalendarCheck size={20} />} value={s.reportDays} label={`${plural(s.reportDays, 'день', 'дня', 'дней')} с отчётами`} />
          {s.goalsAchieved !== null && <Stat icon={<Target size={20} />} value={`${s.goalsAchieved} из ${s.goalsTotal}`} label={plural(s.goalsTotal, 'цель достигнута', 'целей достигнуто', 'целей достигнуто')} />}
          {s.percent !== null && <Stat icon={<Sparkles size={20} />} value={`${s.percent}%`} label="действий выполнено" />}
          {s.rank && <Stat icon={<Trophy size={20} />} value={`${s.rank.place} место`} label={`из ${s.rank.of} в рейтинге`} />}
          <Stat icon={<Flame size={20} />} value={s.longestStreak} label={`${plural(s.longestStreak, 'день', 'дня', 'дней')} — лучшая серия`} />
          <Stat icon={<CircleCheck size={20} />} value={s.successfulDays} label={`${plural(s.successfulDays, 'успешный день', 'успешных дня', 'успешных дней')}`} />
        </div>
        <div className="spacer" />
        <Cta onClick={() => { haptic(); setStep(2); }}>Посмотреть мои результаты</Cta>
      </Screen>
    );
  }

  const valid = data.goals.every((g) => outcomes[g.id]) && result.trim().length >= 2;
  const save = async () => {
    await api('/api/finale', { body: { outcomes: data.goals.map((g) => ({ goalId: g.id, outcome: outcomes[g.id] })), result: result.trim() } });
  };
  const run = async (after: (next: Finale['next']) => void) => {
    setBusy(true);
    try {
      await save();
      haptic('success');
      after(data.next);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const newGoal = (next: Finale['next']) => nav(next.kind === 'goals' ? '/reg/about' : next.kind === 'debt' ? '/profile/subscription' : '/comeback');

  return (
    <Screen id="FINALE_2">
      <Header title="Твои результаты за 30 дней 💜" back="/" />
      {data.goals.map((g, i) => (
        <div key={g.id} className="card" style={{ gap: 12 }}>
          <span className="label" style={{ color: 'var(--accent)' }}>Цель {i + 1}</span>
          <div className="h3" style={{ fontSize: 17 }}>{g.title}</div>
          {(g.pointA || g.pointB) && (
            <div className="grid2">
              <div className="ab a"><span>Старт</span><b>{g.pointA ?? '—'}</b></div>
              <div className="ab b"><span>Цель</span><b>{g.pointB ?? '—'}</b></div>
            </div>
          )}
          <div className="col" style={{ gap: 6 }}>
            <div className="row between small"><span className="muted">{g.numeric && g.current !== null ? `Сейчас: ${formatMetric(g.current, g.unit)}` : 'Выполнено действий'}</span><b style={{ color: 'var(--accent)' }}>{g.numeric && g.progress !== null ? g.progress : g.planPercent}%</b></div>
            <div className="bar"><i style={{ width: `${g.numeric && g.progress !== null ? g.progress : g.planPercent}%` }} /></div>
          </div>
          <div className="h3" style={{ fontSize: 15 }}>Удалось достичь поставленной цели?</div>
          <div className="outcomes" role="radiogroup">
            {OUTCOMES.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={outcomes[g.id] === k} className={outcomes[g.id] === k ? `on ${k}` : ''} onClick={() => { haptic(); setOutcomes({ ...outcomes, [g.id]: k }); }}>{l}</button>)}
          </div>
        </div>
      ))}
      <div className="card" style={{ gap: 8 }}>
        <div className="h3" style={{ fontSize: 16 }}>Какого результата тебе удалось добиться?</div>
        <textarea className="textarea" rows={3} placeholder="Например: «Похудела на 3 кг», «Заработала 150 000 ₽», «Начала заниматься английским четыре раза в неделю»" value={result} maxLength={1000} onChange={(e) => setResult(e.target.value)} />
      </div>
      <button className="btn btn-secondary" disabled={!valid || busy} onClick={() => run(() => nav('/finale/card'))}><Share2 size={18} />Поделиться результатом в Stories</button>
      <Cta disabled={!valid || busy} onClick={() => run(newGoal)}>Поставить новую цель</Cta>
      {!valid && <p className="muted small center" style={{ margin: 0 }}>Оцени каждую цель и напиши свой результат</p>}
    </Screen>
  );
}

/* ───────────── Карточка результатов для сторис ───────────── */

interface CardResp { card: { name?: string; result?: string; days?: number; goal?: string; percent?: number; rank?: string }; imageUrl: string }

export function ResultCardScreen() {
  const { data: f } = useLoad(() => api<Finale>('/api/finale'));
  const [name, setName] = useState('');
  const [showName, setShowName] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [opts, setOpts] = useState({ showDays: true, showGoal: true, showPercent: false, showRank: false });
  const [card, setCard] = useState<CardResp | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number>();
  useEffect(() => {
    if (f && result === null) setResult((f.result ?? '').slice(0, 60));
  }, [f, result]);
  useEffect(() => {
    if (result === null) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setBusy(true);
      api<CardResp>('/api/finale/card', { body: { ...opts, result, name: showName ? name : '' } })
        .then(setCard)
        .catch((e) => toast(errorText(e)))
        .finally(() => setBusy(false));
    }, 450);
  }, [result, name, showName, opts]);

  const toggle = (k: keyof typeof opts, label: string, can = true) =>
    can && (
      <label className="check" key={k}>
        <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
        <span>{label}</span>
      </label>
    );
  return (
    <Screen id="RESULT_CARD">
      <Header title="Карточка для Stories" back="/finale" />
      <div className="story-frame">
        {card ? <img src={card.imageUrl} alt="Карточка результатов" style={{ opacity: busy ? 0.6 : 1 }} /> : <Loading lines={2} />}
      </div>
      <div className="card" style={{ gap: 10 }}>
        <span className="h3" style={{ fontSize: 16 }}>Мой результат</span>
        <input className="input" value={result ?? ''} maxLength={60} placeholder="Например, −3 кг за 30 дней" onChange={(e) => setResult(e.target.value)} />
        <span className="muted small">Текст меняется только на карточке — твои результаты в приложении остаются прежними.</span>
        {toggle('showDays', 'Дни с отчётами')}
        {toggle('showGoal', 'Достижение цели')}
        {toggle('showPercent', 'Процент дисциплины', f?.stats.percent !== null)}
        {toggle('showRank', 'Место в рейтинге', Boolean(f?.stats.rank))}
        <label className="check">
          <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} />
          <span>Показать имя</span>
        </label>
        {showName && <input className="input" value={name} maxLength={40} placeholder="Имя на карточке" onChange={(e) => setName(e.target.value)} />}
      </div>
      {card && canShareStory() && <button className="btn btn-primary" onClick={() => shareStory(card.imageUrl, '')}><Share2 size={18} />Поделиться в Stories</button>}
      {card && <button className={`btn ${canShareStory() ? 'btn-secondary' : 'btn-primary'}`} onClick={() => downloadImage(card.imageUrl, '30-dney-result.png')}><Download size={18} />Сохранить карточку</button>}
      {card && !canShareStory() && <p className="muted small center" style={{ margin: 0 }}>Сохрани карточку и выложи её в Stories из галереи 💜</p>}
    </Screen>
  );
}

/* ───────────── Подписка закончилась: 40 минут по прежней цене ───────────── */

interface Comeback { available: boolean; active?: boolean; msLeft?: number; tariff?: { id: string; title: string; months: number }; price?: number }

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function ComebackScreen() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<Comeback>('/api/comeback?start=1'));
  const [left, setLeft] = useState(0);
  const started = useRef(0);
  useEffect(() => {
    if (!data?.active) return;
    started.current = Date.now();
    setLeft(data.msLeft ?? 0);
    const t = setInterval(() => setLeft(Math.max(0, (data.msLeft ?? 0) - (Date.now() - started.current))), 500);
    return () => clearInterval(t);
  }, [data]);

  if (loading && !data) return <Screen id="COMEBACK"><Loading /></Screen>;
  if (error || !data) return <Screen id="COMEBACK"><ErrorState error={error} retry={reload} /></Screen>;
  const active = Boolean(data.active) && left > 0;
  return (
    <Screen id="COMEBACK">
      <Header title="" back="/" />
      <div className="col center" style={{ gap: 12, alignItems: 'center' }}>
        <span className="finale-badge" style={{ background: '#fdecef' }}>💔</span>
        <h1 className="hero" style={{ fontSize: 27 }}>К сожалению, твоя подписка закончилась 💔</h1>
        {data.available && active ? (
          <p className="lead" style={{ fontSize: 16 }}>Но у тебя есть 40 минут, чтобы вернуться в клуб по той же цене, что и раньше!</p>
        ) : (
          <p className="lead" style={{ fontSize: 16 }}>{data.available ? 'Время предложения по прежней цене закончилось. Но вернуться можно по актуальным тарифам клуба 💜' : 'Вернуться в клуб можно по актуальным тарифам 💜'}</p>
        )}
      </div>
      {data.available && active && (
        <>
          <div className={`comeback-timer ${left < 60_000 ? 'hot' : ''}`}><Clock size={22} />{mmss(left)}</div>
          <div className="card center" style={{ gap: 4, alignItems: 'center' }}>
            <span className="muted">{data.tariff!.title}</span>
            <span className="big-num" style={{ fontSize: 36 }}>{data.price!.toLocaleString('ru-RU')} ₽</span>
            <span className="muted small">прежняя цена — как в твоей подписке</span>
          </div>
          <Cta onClick={() => nav(`/checkout/${data.tariff!.id}?comeback=1`)}>Продлить участие по прежней цене</Cta>
        </>
      )}
      {!(data.available && active) && <Cta onClick={() => nav('/tariffs')}>Посмотреть тарифы</Cta>}
      <button className="link-btn" onClick={() => nav('/archive')}>Мои результаты и история</button>
    </Screen>
  );
}

/* ───────────── Отзыв за трекеры ───────────── */

const TRACKERS = [
  { kind: 'tasks' as const, title: 'Трекер задач', text: 'Чек-листы и прогресс по задачам', cls: 'violet' },
  { kind: 'week' as const, title: 'Трекер недели', text: 'Планер дел по дням недели', cls: 'pink' },
  { kind: 'finance' as const, title: 'Трекер финансов', text: 'Доходы, расходы и баланс', cls: 'green' },
];

export function TrackerCarousel() {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="tr-carousel" ref={ref} onScroll={(e) => setAt(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth * 0.8)))}>
        {TRACKERS.map((t) => (
          <div key={t.kind} className={`tr-card ${t.cls}`}>
            <img className="tr-art" src={`/img/tracker-${t.kind}.jpg`} alt={t.title} loading="lazy" />
            <b>{t.title}</b>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      <div className="dots" style={{ justifyContent: 'center' }} aria-hidden>{TRACKERS.map((t, i) => <i key={t.kind} className={i === Math.min(at, 2) ? 'on' : ''} />)}</div>
    </div>
  );
}

/** Окно «Получи трекеры за свой отзыв» (раз в 14 дней, пока не выдан подарок) */
export function TrackersPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  useEffect(() => {
    if (open) void api('/api/trackers/prompted', { body: {} }).catch(() => undefined);
  }, [open]);
  return (
    <Popup open={open} onClose={onClose}>
      <h2 className="h2 center" style={{ fontSize: 22, marginTop: 6 }}>Получи трекеры за свой отзыв 🎁</h2>
      <p className="muted center" style={{ margin: 0, lineHeight: 1.45 }}>Расскажи честно, как проходит твой челлендж, и получи сразу три моих любимых трекера в Google Таблицах!</p>
      <TrackerCarousel />
      <Cta onClick={() => { onClose(); nav('/trackers'); }}>Оставить отзыв и забрать трекеры</Cta>
    </Popup>
  );
}

interface TrackerState { status: 'none' | 'pending' | 'needs_info' | 'granted'; screenshot: string | null; supportUrl: string; links: { tasks: string; week: string; finance: string } | null }

const STATUS: Record<TrackerState['status'], [string, string]> = {
  none: ['Не отправлен', 'muted'],
  pending: ['На проверке', 'warn'],
  needs_info: ['Нужно уточнение', 'err'],
  granted: ['Подарок выдан', 'ok'],
};

export function TrackersScreen() {
  const { data, error, loading, reload } = useLoad(() => api<TrackerState>('/api/trackers'));
  const [shot, setShot] = useState<{ id: string; url: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  if (loading && !data) return <Screen id="TRACKERS"><Loading /></Screen>;
  if (error || !data) return <Screen id="TRACKERS"><ErrorState error={error} retry={reload} /></Screen>;
  const [label, tone] = STATUS[data.status];
  const canSend = data.status === 'none' || data.status === 'needs_info';

  const submit = async () => {
    setBusy(true);
    try {
      await api('/api/trackers', { body: { mediaId: shot!.id } });
      haptic('success');
      setShot(null);
      reload();
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const pick = async (f: File) => {
    setUploading(true);
    try {
      setShot(await uploadImage(f));
    } catch (x) {
      toast(errorText(x));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Screen id="TRACKERS">
      <Header title="Трекеры за отзыв 🎁" back="/" right={<span className={`status-pill ${tone}`}>{label}</span>} />
      <TrackerCarousel />
      {data.status === 'granted' && data.links ? (
        <div className="card" style={{ gap: 10 }}>
          <div className="h3">Спасибо за твой честный отзыв! 💜</div>
          <div className="muted">Обещанные подарки уже здесь:</div>
          {([['tasks', 'Трекер задач'], ['week', 'Трекер недели'], ['finance', 'Трекер финансов']] as const).map(([k, l]) => (
            <button key={k} className="btn btn-secondary" disabled={!data.links![k]} onClick={() => openExternal(data.links![k])}><Gift size={18} />{l}</button>
          ))}
          <div className="muted small">Пользуйся с удовольствием! Ссылки мы также отправили в бот.</div>
        </div>
      ) : data.status === 'pending' ? (
        <div className="panel center" style={{ gap: 6, padding: 18, alignItems: 'center' }}>
          <Clock size={24} color="var(--accent)" />
          <div style={{ color: 'var(--accent-ink)', fontWeight: 600, fontSize: 17 }}>Отзыв на проверке</div>
          <div className="muted small">Как только проверим, пришлём три трекера в бот 💜</div>
          {data.screenshot && <img src={data.screenshot} alt="Скриншот отзыва" className="shot-thumb" />}
        </div>
      ) : (
        <>
          {data.status === 'needs_info' && <div className="banner err"><RefreshCw size={15} style={{ verticalAlign: -3 }} /> Мы не смогли разглядеть отзыв. Загрузи, пожалуйста, новый скриншот.</div>}
          <div className="card" style={{ gap: 12 }}>
            {[
              'Напиши честный отзыв о своём участии в поддержку — хороший или нет, неважно.',
              'Сделай скриншот отправленного сообщения.',
              'Вернись сюда и прикрепи скриншот.',
            ].map((t, i) => (
              <div key={t} className="row" style={{ gap: 12, alignItems: 'flex-start' }}><span className={`num-sq ${['', 'green', 'peach'][i]}`} style={{ width: 34, height: 34, fontSize: 15 }}>{i + 1}</span><span style={{ paddingTop: 6 }}>{t}</span></div>
            ))}
            <button className="btn btn-secondary" onClick={() => openTelegram(data.supportUrl)}><MessageCircle size={18} />Написать отзыв в поддержку</button>
          </div>
          {canSend && (
            <div className="card" style={{ gap: 10 }}>
              <span className="h3" style={{ fontSize: 16 }}>Скриншот отзыва</span>
              {shot ? (
                <div className="shot-preview">
                  <img src={shot.url} alt="Скриншот отзыва" />
                  <div className="row" style={{ gap: 8 }}>
                    <label className="btn btn-light grow" style={{ minHeight: 42 }}><ImagePlus size={16} />Заменить
                      <input type="file" accept="image/*" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f); }} />
                    </label>
                    <button className="btn btn-light" style={{ minHeight: 42 }} aria-label="Убрать" onClick={() => setShot(null)}><X size={16} /></button>
                  </div>
                </div>
              ) : (
                <label className="btn btn-secondary" style={{ minHeight: 48 }}>
                  <ImagePlus size={18} />{uploading ? 'Загружаем…' : 'Прикрепить скриншот'}
                  <input type="file" accept="image/*" hidden disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f); }} />
                </label>
              )}
              <Cta disabled={!shot || busy} onClick={submit}>{busy ? 'Отправляем…' : 'Отправить на проверку'}</Cta>
            </div>
          )}
          <p className="muted small center" style={{ margin: 0 }}>Подарок — за честный содержательный отзыв, даже если он критический. Публиковать отзыв мы будем только с твоего отдельного согласия.</p>
        </>
      )}
    </Screen>
  );
}
