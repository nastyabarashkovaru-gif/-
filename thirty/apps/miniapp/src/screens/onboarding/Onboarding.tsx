import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  HeartHandshake, MessagesSquare, Video, ChartNoAxesColumnIncreasing, Users, Smile, Heart, Wallet, HeartPulse, Smartphone, Languages, Flame,
  Mic, MessageCircle, PhoneOff, User, CalendarCheck, TrendingUp, Brain, CircleCheck, Target, Pencil, LayoutGrid, Camera, Trophy, Sparkles, Check, ArrowLeft, ArrowRight, ChevronDown, ChevronRight, X,
} from 'lucide-react';
import { api, rub } from '../../lib/api';
import { ctx, track } from '../../lib/analytics';
import { BrandBar, Cta, Dots, ErrorState, Loading, Popup, Screen, useLoad } from '../../ui';

/** Онбординг: 3 экрана + тарифы (4-й). Подробные объяснения механик — по кнопкам «Подробнее» */
const TOTAL = 4;
export const onbPath = (n: number) => (n === 1 ? '/welcome' : n >= TOTAL ? '/tariffs' : `/onboarding/${n}`);
const screenId = (n: number) => `O${String(n).padStart(2, '0')}`;

function useStep(n: number) {
  const nav = useNavigate();
  useEffect(() => {
    if (n === 1 && !sessionStorage.getItem('thirty.onbStarted')) {
      sessionStorage.setItem('thirty.onbStarted', '1');
      track('onboarding_started', { screen: screenId(1) });
    }
    track('onboarding_step_view', { screen: screenId(n), metadata: { step: n } });
    track(`onboarding_screen_${n}_view`, { screen: screenId(n) });
    if (n === 3) track('value_screen_view', { screen: screenId(n) });
    void api('/api/me/screen', { body: { screen: onbPath(n), stage: 'onboarding' } }).catch(() => undefined);
  }, [n]);
  // A/B «onboarding_flow»: вариант short — с первого экрана сразу к тарифам
  return () => nav(n === 1 && ctx.variants.onboarding_flow === 'short' ? '/tariffs' : onbPath(n + 1));
}

/** Экран-объяснение механики («Подробнее»): прежние иллюстрированные экраны */
const AboutCtx = createContext<{ topic: string; i: number; total: number } | null>(null);

function Onb({ children, cta }: { n: number; children: ReactNode; cta?: ReactNode }) {
  const about = useContext(AboutCtx)!;
  const nav = useNavigate();
  const last = about.i === about.total - 1;
  const close = () => nav('/onboarding/2', { replace: true });
  return (
    <Screen id={`OA_${about.topic}_${about.i + 1}`} className="onb">
      <BrandBar right={<button className="link-btn" style={{ padding: 4, textDecoration: 'none' }} aria-label="Закрыть" onClick={close}><X size={22} /></button>} />
      <div className="onb-body">{children}</div>
      {about.total > 1 && <Dots count={about.total} at={about.i} />}
      <Cta onClick={() => (last ? close() : nav(`/about/${about.topic}/${about.i + 1}`, { replace: true }))}>{last ? 'Вернуться' : cta ?? 'Дальше'}</Cta>
      {about.i > 0 && <button className="link-accent" style={{ color: 'var(--muted)', fontWeight: 500 }} onClick={() => nav(`/about/${about.topic}/${about.i - 1}`, { replace: true })}><ArrowLeft size={16} />Назад</button>}
    </Screen>
  );
}

function Title({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
  return (
    <div className="col" style={{ gap: 10 }}>
      <h1 className="hero">{children}</h1>
      {lead && <p className="lead">{lead}</p>}
    </div>
  );
}

const S3 = () => (
  <Onb n={3}>
    <img className="onb-art" src="/img/onb-buddy.png" alt="" style={{ maxWidth: 290 }} />
    <Title
      lead={<>Каждому участнику выдаётся <b>БАДДИ</b> — партнёр по челленджу, с кем вы проходите этот путь вместе: отслеживаете ключевые задачи, подбадриваете и не даёте слиться.</>}
    >
      Сдаться сложнее, когда <em>вас двое!</em>
    </Title>
    <div className="panel" style={{ flexDirection: 'row', alignItems: 'center', padding: '10px 12px' }}>
      <Users size={16} color="var(--accent)" />
      <div className="grow center" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-ink)' }}>Можешь доверить выбор бадди нам или прийти с другом!</div>
    </div>
  </Onb>
);

const CHAT = [
  ['Аня', 'День 7! Сегодня впервые встала в 7 утра 😍', '09:12', 'orange', 0],
  ['Маша', 'Ааа, умница! 💜 Я тоже сегодня не сдалась!', '09:14', 'green', 0],
  ['Катя', 'Мой первый отчёт готов! 3/3 задачи выполнены 🔥', '09:20', 'pink', 12],
] as const;

const S4 = () => (
  <Onb n={4}>
    <div className="mini" style={{ margin: '0 22px' }}>
      <div className="row" style={{ gap: 10, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
        <span className="ic"><Users size={18} /></span>
        <div className="grow"><div className="h3">Наш поток 💜</div><div className="muted" style={{ fontSize: 11 }}>Общий чат участников</div></div>
        <span className="pill green" style={{ fontSize: 11, padding: '3px 8px' }}>Вместе</span>
      </div>
      {CHAT.map(([name, text, time, c, likes]) => (
        <div className="row" key={name} style={{ alignItems: 'flex-start', gap: 8 }}>
          <span className={`ic ${c}`} style={{ width: 26, height: 26 }}><Smile size={14} /></span>
          <div className="grow" style={{ background: '#f2f0fb', borderRadius: 14, padding: '10px 12px' }}>
            <div style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 12 }}>{name}</div>
            <div style={{ fontSize: 14, marginTop: 4 }}>{text}</div>
            <div className="row between" style={{ marginTop: 4, fontSize: 10, color: 'var(--muted-2)' }}>
              <span>{likes ? <span className="row" style={{ gap: 4 }}><Heart size={11} color="var(--pink)" />{likes}</span> : null}</span>
              <span>{time}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
    <Title lead="В общем чате твоего потока можно быть собой, делиться победами, задавать вопросы и каждый день видеть отчёты других участников.">
      Здесь все свои. <em>И все идут вперёд!</em>
    </Title>
  </Onb>
);

export const CHAT_CATEGORIES = [
  { id: 'money', title: 'Деньги', Icon: Wallet, c: 'green' },
  { id: 'weightloss', title: 'Похудение', Icon: HeartPulse, c: 'pink' },
  { id: 'blog', title: 'Блог', Icon: Smartphone, c: '' },
  { id: 'english', title: 'Английский', Icon: Languages, c: 'blue' },
  { id: 'habits', title: 'Привычки', Icon: Flame, c: 'orange' },
] as const;

const S5 = () => (
  <Onb n={5}>
    <Title lead="Общайся с единомышленниками, делись опытом и находи поддержку в тематических чатах сообщества.">
      Найди людей, которые хотят <em>того же, что и ты!</em>
    </Title>
    <div className="panel">
      <div className="row" style={{ justifyContent: 'center', gap: 8, color: 'var(--accent-ink)', fontWeight: 600, fontSize: 14, padding: '2px 0 4px' }}>
        <MessagesSquare size={16} /> Чаты по твоим целям
      </div>
      <div className="grid2">
        {CHAT_CATEGORIES.map(({ id, title, Icon, c }, i) => (
          <div key={id} className="card center" style={{ alignItems: 'center', gap: 8, border: 0, padding: '12px 8px', gridColumn: i === 4 ? '1 / -1' : undefined }}>
            <span className={`ic xl ${c}`}><Icon size={22} strokeWidth={1.8} /></span>
            <div className="h3" style={{ fontSize: 15 }}>{title}</div>
          </div>
        ))}
      </div>
    </div>
  </Onb>
);

const S6 = () => (
  <Onb n={6}>
    <div className="mini" style={{ margin: '0 22px' }}>
      <div className="row" style={{ gap: 10 }}>
        <span className="ic sq" style={{ width: 30, height: 30, borderRadius: 9 }}><Video size={16} /></span>
        <div className="h3 grow">Еженедельный созвон</div>
        <span className="pill green" style={{ fontSize: 11, padding: '3px 8px' }}>В эфире</span>
      </div>
      <img src="/img/onb-call.png" alt="" style={{ borderRadius: 14, width: '100%' }} />
      <div className="row" style={{ gap: 8 }}>
        {(['#e9f6ee:#58a978', '#fbe7ea:#d87c8c', '#e7e9fc:#6c51df'] as const).map((p) => {
          const [bg, fg] = p.split(':');
          return <div key={p} className="grow" style={{ background: bg, borderRadius: 10, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><User size={20} color={fg} /></div>;
        })}
      </div>
      <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
        <span className="ic" style={{ width: 28, height: 28 }}><Mic size={13} /></span>
        <span className="ic" style={{ width: 28, height: 28 }}><MessageCircle size={13} /></span>
        <span className="ic" style={{ width: 28, height: 28, background: '#e05d5d', color: '#fff' }}><PhoneOff size={13} /></span>
      </div>
    </div>
    <div className="panel" style={{ flexDirection: 'row', alignItems: 'center', margin: '0 22px', gap: 10 }}>
      <CalendarCheck size={20} color="var(--accent)" />
      <div className="grow">
        <div style={{ fontWeight: 600, color: 'var(--accent-ink)', fontSize: 14 }}>Разбор недели + план действий</div>
        <div className="muted" style={{ fontSize: 12 }}>Каждую неделю — новый шаг к цели</div>
      </div>
    </div>
    <Title lead="Каждую неделю встречайся с лидером своей темы, разбирай прошедшую неделю и ставь задачи на следующую. Только так можно быстро и постоянно расти!">
      Ты не обязан разбираться <em>во всём самостоятельно!</em>
    </Title>
  </Onb>
);

const LEADERS = [
  [TrendingUp, 'green', 'Деньги · Финансовый коуч', 'Подсветит возможности роста дохода, которые ты пока не замечаешь.'],
  [Languages, 'blue', 'Английский · Репетитор', 'Разговорный клуб, где ты практикуешь английский, а не просто учишь слова.'],
  [Brain, 'orange', 'Привычки · Психолог', 'Поможет понять свои паттерны поведения и заменить вредные привычки полезными.'],
  [Smartphone, '', 'Блог · Лидер по продвижению', 'Разборы роста подписчиков, монетизации и продвижения твоего блога.'],
  [HeartPulse, 'pink', 'Похудение · Лидер по питанию и спорту', 'Поможет выстроить питание и тренировки под твою цель.'],
] as const;

const S7 = () => (
  <Onb n={7}>
    <Title lead="Получай помощь профессионалов на еженедельных встречах по твоей теме.">
      У каждой цели — <em>свой лидер!</em>
    </Title>
    <div className="col">
      {LEADERS.map(([I, c, t, s]) => (
        <div className="card row" key={t} style={{ padding: 12, gap: 12, flexDirection: 'row' }}>
          <span className={`ic sq ${c}`} style={{ width: 48, height: 48, borderRadius: 14 }}><I size={20} strokeWidth={1.8} /></span>
          <div className="grow"><div className="h3" style={{ fontSize: 15 }}>{t}</div><div className="muted small" style={{ marginTop: 3 }}>{s}</div></div>
        </div>
      ))}
      <div className="panel" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <CircleCheck size={18} color="var(--accent)" />
        <div style={{ fontWeight: 600, color: 'var(--accent-ink)', fontSize: 15 }}>Все созвоны уже входят в стоимость клуба!</div>
      </div>
    </div>
  </Onb>
);

const S8 = () => (
  <Onb n={8}>
    <div className="panel" style={{ margin: '0 22px' }}>
      <div className="row between">
        <div className="row" style={{ gap: 8 }}>
          <span className="ic white sq" style={{ width: 30, height: 30, borderRadius: 9 }}><Target size={16} /></span>
          <span style={{ fontWeight: 600, color: 'var(--accent-ink)' }}>Мой челлендж</span>
        </div>
        <span className="pill" style={{ background: '#fff', fontSize: 12 }}>30 дней</span>
      </div>
      <div className="card" style={{ border: 0, gap: 10 }}>
        <div className="row between"><span className="muted small">Моя цель</span><Pencil size={13} color="var(--muted-2)" /></div>
        <div className="row" style={{ gap: 10 }}>
          <span className="ic sq green" style={{ width: 34, height: 34, borderRadius: 10 }}><Heart size={16} /></span>
          <div><div className="h3">30 дней без сладкого</div><div className="muted" style={{ fontSize: 12 }}>Здоровье и привычки</div></div>
        </div>
        <div className="divider" />
        <div style={{ fontWeight: 600, fontSize: 14 }}>Мои ежедневные действия</div>
        {['Не есть добавленный сахар', 'Следить за питанием'].map((t) => (
          <div className="row" key={t} style={{ gap: 8, fontSize: 14, color: 'var(--ink-2)' }}><CircleCheck size={16} color="var(--green-2)" />{t}</div>
        ))}
        <div className="row" style={{ gap: 8, fontSize: 14, color: 'var(--ink-2)' }}><span style={{ width: 16, height: 16, borderRadius: 8, background: '#cbc6d6' }} />Выложить отчёт за день</div>
      </div>
      <div className="card row" style={{ border: 0, flexDirection: 'row', padding: '10px 14px', gap: 8, color: 'var(--accent-ink)', fontWeight: 600, fontSize: 14 }}>
        <Users size={16} color="var(--accent)" /> Ты идёшь к цели не один 💜
      </div>
    </div>
    <Title lead="Выбери свою цель, определи ежедневные действия и начни двигаться к ней вместе с сообществом!">
      Представь, чего ты добьёшься <em>за 30 дней!</em>
    </Title>
  </Onb>
);

const S9 = () => {
  const cells = Array.from({ length: 28 }, (_, i) => i + 1);
  return (
    <Onb n={9}>
      <div className="panel" style={{ margin: '0 22px' }}>
        <div className="row between">
          <span className="row" style={{ gap: 8, fontWeight: 600, color: 'var(--accent-ink)' }}><LayoutGrid size={16} /> Мой прогресс</span>
          <span className="pill" style={{ background: '#fff', fontSize: 12 }}>День 18 / 30</span>
        </div>
        <div className="card" style={{ border: 0, gap: 10 }}>
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div><div className="muted small">Моя цель</div><div className="h3" style={{ marginTop: 2 }}>30 дней без сладкого</div></div>
            <span className="ic sq green" style={{ width: 32, height: 32, borderRadius: 10 }}><Heart size={15} /></span>
          </div>
          <div className="row between"><span className="small" style={{ color: 'var(--ink-2)' }}>Выполнено</span><b style={{ color: 'var(--accent)', fontSize: 17 }}>83%</b></div>
          <div className="bar"><i style={{ width: '83%' }} /></div>
          <div className="days">
            {cells.map((d) => (
              <div key={d} className={`day ${d <= 15 ? 'success' : d <= 18 ? 'today' : ''}`} style={d >= 16 && d <= 18 ? { fontWeight: 400 } : undefined}>
                {d <= 15 ? <Check size={12} /> : d}
              </div>
            ))}
          </div>
        </div>
        <div className="grid2">
          <div className="stat"><span className="row" style={{ gap: 6, fontSize: 13, color: 'var(--muted)' }}><Camera size={14} color="var(--accent)" />Отчёты</span><b>15 / 18</b><span>Дней с отчётами</span></div>
          <div className="stat"><span className="row" style={{ gap: 6, fontSize: 13, color: 'var(--muted)' }}><Trophy size={14} color="var(--gold)" />Рейтинг</span><b>#12</b><span>Среди участников</span></div>
        </div>
        <div className="card row" style={{ border: 0, flexDirection: 'row', padding: '10px 12px', gap: 10 }}>
          <span className="ic sq green" style={{ width: 32, height: 32, borderRadius: 10 }}><Users size={15} /></span>
          <div className="grow"><div style={{ fontWeight: 600, fontSize: 13 }}>Твой бадди тоже в деле!</div><div className="muted" style={{ fontSize: 11 }}>Сегодня уже выполнил задачи</div></div>
          <CircleCheck size={16} color="var(--green-2)" />
        </div>
      </div>
      <Title lead="В удобном приложении отмечай выполненные задачи, делись отчётами и следи за своим прогрессом и рейтингом участников.">
        Каждый день ты становишься <em>ближе к цели!</em>
      </Title>
    </Onb>
  );
};

const PODIUM = [
  { place: 2, h: 76, bg: '#b8b2d2', av: '#ecebf3', ic: '#8c86a8', label: '#77718c' },
  { place: 1, h: 116, bg: '#e7b34e', av: '#fbe3a4', ic: '#c58f2c', label: '#b07f2a' },
  { place: 3, h: 56, bg: '#d7a58c', av: '#f8e1d6', ic: '#c2826a', label: '#77718c' },
];

const S10 = () => (
  <Onb n={10}>
    <div className="panel" style={{ margin: '0 22px', paddingBottom: 14 }}>
      <div className="row" style={{ justifyContent: 'center', gap: 8, fontWeight: 600, color: 'var(--accent-ink)' }}>
        <Sparkles size={15} color="var(--gold)" /> Лидеры челленджа <Sparkles size={15} color="var(--gold)" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, alignItems: 'end', marginTop: 4 }}>
        {PODIUM.map((p) => (
          <div key={p.place} className="col" style={{ alignItems: 'center', gap: 6 }}>
            <span className="ic" style={{ width: p.place === 1 ? 64 : 52, height: p.place === 1 ? 64 : 52, background: p.av, color: p.ic }}><User size={p.place === 1 ? 26 : 20} /></span>
            <span style={{ fontSize: 12, fontWeight: 600, color: p.label }}>{p.place} место</span>
            <div style={{ background: p.bg, height: p.h, width: '100%', borderRadius: '10px 10px 0 0', color: '#fff', fontSize: 26, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{p.place}</div>
          </div>
        ))}
      </div>
      <div className="card row" style={{ border: 0, flexDirection: 'row', padding: 12, gap: 10 }}>
        <span className="ic sq gold" style={{ width: 34, height: 34, borderRadius: 10 }}><Trophy size={17} /></span>
        <div className="grow"><div className="h3" style={{ fontSize: 14 }}>Топ-3 участника</div><div className="muted" style={{ fontSize: 12 }}>Призовые места по итогам челленджа</div></div>
        <Sparkles size={15} color="var(--gold)" />
      </div>
    </div>
    <Title lead="Выполняй свои задачи, не пропускай отчёты и борись за одно из трёх призовых мест!">
      Продержись до конца. <em>Забери награду!</em>
    </Title>
  </Onb>
);

const ABOUT: Record<string, (() => ReactNode)[]> = {
  buddy: [S3],
  chats: [S5, S4],
  calls: [S6, S7],
  reports: [S8, S9, S10],
};

export function AboutScreen() {
  const { topic = '', i = '0' } = useParams();
  const list = ABOUT[topic];
  const idx = Math.max(0, Math.min(Number(i) || 0, (list?.length ?? 1) - 1));
  if (!list) return <Navigate to="/onboarding/2" replace />;
  const S = list[idx];
  return (
    <AboutCtx.Provider value={{ topic, i: idx, total: list.length }}>
      <S key={`${topic}${idx}`} />
    </AboutCtx.Provider>
  );
}

/* ───────────── Шаги 1–3: результаты → система → что входит (ТЗ 28.10) ───────────── */

/** Каркас шагов: логотип и «n / 4», полоски прогресса, контент, закреплённая внизу кнопка и «Назад» */
function Stage({ n, children, cta }: { n: number; children: ReactNode; cta: ReactNode }) {
  const next = useStep(n);
  const nav = useNavigate();
  return (
    <Screen id={screenId(n)} className="onb onb2">
      <BrandBar right={<span className="counter">{n} / {TOTAL}</span>} />
      <div className="steps">{Array.from({ length: TOTAL }, (_, i) => <i key={i} className={i < n ? 'on' : ''} />)}</div>
      <div className="onb2-body">{children}</div>
      <div className="onb2-foot">
        <button className="btn btn-primary btn-shine onb2-cta" onClick={() => { track(`onboarding_screen_${n}_continue`, { screen: screenId(n) }); next(); }}><span>{cta}</span><ArrowRight size={19} /></button>
        {n > 1 && <button className="link-accent onb2-back" onClick={() => nav(onbPath(n - 1))}><ArrowLeft size={16} />Назад</button>}
      </div>
    </Screen>
  );
}

interface ReviewCard { id: string; emoji: string; title: string; text?: string; image: string | null }

/** Карусель результатов: одна карточка и край следующей, свайп, точки; по нажатию — оригинальный отзыв */
function ReviewsCarousel({ reviews }: { reviews: ReviewCard[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState<ReviewCard | null>(null);
  const seen = useRef(new Set<string>());
  const view = (i: number) => {
    const r = reviews[i];
    if (!r || seen.current.has(r.id)) return;
    seen.current.add(r.id);
    track('review_card_view', { screen: 'O01', metadata: { review: r.id, position: i + 1 } });
  };
  useEffect(() => view(0), [reviews.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => {
    const el = ref.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const i = Math.round(el.scrollLeft / (card.offsetWidth + 12));
    if (i !== at) setAt(i);
    view(i);
  };
  return (
    <>
      <div className="rv-track" ref={ref} onScroll={onScroll}>
        {reviews.map((r, i) => (
          <button key={r.id} className={`rv-card t${i % 6}`} onClick={() => { if (!r.image) return; track('review_original_open', { screen: 'O01', metadata: { review: r.id } }); setOpen(r); }}>
            <span className="rv-emoji">{r.emoji}</span>
            <span className="rv-title">{r.title}</span>
            {r.text && <span className="rv-text">{r.text}</span>}
            {r.image && <span className="rv-more">Смотреть отзыв <ChevronRight size={16} /></span>}
          </button>
        ))}
      </div>
      <div className="rv-dots">{reviews.map((r, i) => <i key={r.id} className={i === at ? 'on' : ''} />)}</div>
      <Popup open={!!open} onClose={() => setOpen(null)}>
        {open && (
          <>
            <div className="rv-pop-head"><span>{open.emoji}</span><b>{open.title}</b></div>
            <img className="rv-pop-img" src={open.image!} alt="Оригинальный отзыв участницы" />
            <button className="btn btn-light" onClick={() => setOpen(null)}>Закрыть</button>
          </>
        )}
      </Popup>
    </>
  );
}

const FACES = [['#efe9ff', '#6c51df'], ['#fde9ef', '#d87c9a'], ['#e8f7ee', '#2f9e68'], ['#fff0df', '#d79240']] as const;

export function Welcome() {
  const { data } = useLoad(() => api<{ reviews: ReviewCard[]; count: string }>('/api/public/onboarding'));
  return (
    <Stage n={1} cta="Хочу вступить">
      <div className="col onb2-head">
        <h1 className="hero onb2-title">Вступай в наше сообщество «30 дней» 💜</h1>
        <p className="lead">Новые привычки, новые люди, новая версия тебя.</p>
      </div>
      <div className="onb2-label">Посмотри, чего уже добились наши участники 👇</div>
      {data ? <ReviewsCarousel reviews={data.reviews} /> : <div className="rv-skeleton" />}
      <div className="crowd">
        <span className="crowd-faces">{FACES.map(([bg, fg], i) => <span key={i} style={{ background: bg, color: fg }}><User size={16} /></span>)}</span>
        <span className="crowd-text">👥 Нас уже <b>{data?.count ?? '300+'}</b> человек!</span>
      </div>
    </Stage>
  );
}

const FEATURES = [
  { topic: 'buddy', emoji: '🤝', c: '', title: 'Бадди', result: 'Не даёт сдаться на полпути', text: 'У каждого участника есть напарник, с которым можно поддерживать друг друга и двигаться к целям.' },
  { topic: 'reports', emoji: '📸', c: 'blue', title: 'Ежедневные отчёты', result: 'Помогают не откладывать на завтра', text: 'Каждый день участники отчитываются о выполненных действиях, благодаря чему сохраняют дисциплину.' },
  { topic: 'chats', emoji: '💬', c: 'green', title: 'Окружение', result: 'Вдохновляет двигаться вперёд', text: 'Рядом люди, которые тоже ставят цели, развиваются и делятся результатами.' },
  { topic: 'calls', emoji: '🎥', c: 'orange', title: 'Еженедельные разборы', result: 'Помогают не сбиваться с пути', text: 'Каждую неделю участники отслеживают прогресс, разбирают сложности и составляют план на следующую неделю.' },
];

function Mechanics() {
  const nav = useNavigate();
  const [open, setOpen] = useState<(typeof FEATURES)[number] | null>(null);
  return (
    <Stage n={2} cta="Что ещё входит в клуб?">
      <div className="col onb2-head">
        <h1 className="hero onb2-title">Почему у нас добиваются результатов? 🚀</h1>
        <p className="lead">Потому что здесь ты не остаёшься один на один со своими целями.</p>
      </div>
      <div className="grid2 onb2-grid">
        {FEATURES.map((f) => (
          <button key={f.topic} className="feat" onClick={() => { track('onboarding_feature_open', { screen: 'O02', metadata: { feature: f.topic } }); setOpen(f); }}>
            <span className={`mech-ic ${f.c}`}>{f.emoji}</span>
            <span className="feat-title">{f.title}</span>
            <span className="feat-text">{f.result}</span>
            <span className="feat-more">Подробнее <ChevronDown size={15} /></span>
          </button>
        ))}
      </div>
      <div className="willpower">Тебе больше не придётся полагаться только на силу воли 💜</div>
      <Popup open={!!open} onClose={() => setOpen(null)}>
        {open && (
          <>
            <span className={`mech-ic ${open.c}`} style={{ alignSelf: 'center' }}>{open.emoji}</span>
            <h2 className="h2 center" style={{ margin: 0 }}>{open.title}</h2>
            <div className="center feat-result">{open.result}</div>
            <p className="center" style={{ margin: 0, color: 'var(--ink-2)', lineHeight: 1.45 }}>{open.text}</p>
            <button className="btn btn-light" onClick={() => { setOpen(null); nav(`/about/${open.topic}/0`); }}>Как это выглядит в клубе</button>
          </>
        )}
      </Popup>
    </Stage>
  );
}

interface ValueCard { id: string; title: string; emoji?: string; description?: string; details?: string }

function Value() {
  const { data, error, loading, reload } = useLoad(() => api<{ items: ValueCard[] }>('/api/public/value'));
  const [open, setOpen] = useState<ValueCard | null>(null);
  return (
    <Stage n={3} cta="Узнать стоимость вступления">
      <div className="col onb2-head">
        <h1 className="hero onb2-title">Что ты получишь внутри клуба? 💜</h1>
        <p className="lead">Всё, что нужно, чтобы двигаться к своим целям не в одиночку.</p>
      </div>
      {loading && !data ? <Loading lines={3} /> : error || !data ? <ErrorState error={error} retry={reload} /> : (
        <>
          <div className="grid2 onb2-grid">
            {data.items.map((i, k) => (
              <button key={i.id} className="benefit" style={k === data.items.length - 1 && data.items.length % 2 ? { gridColumn: '1 / -1' } : undefined} onClick={() => { track('onboarding_benefit_open', { screen: 'O03', metadata: { benefit: i.id } }); setOpen(i); }}>
                <span className="benefit-ic">{i.emoji ?? '✨'}</span>
                <span className="feat-title">{i.title}</span>
                {i.description && <span className="feat-text">{i.description}</span>}
              </button>
            ))}
          </div>
          <div className="included">💚 Всё это уже включено в стоимость клуба для наших участников!</div>
        </>
      )}
      <Popup open={!!open} onClose={() => setOpen(null)}>
        {open && (
          <>
            <span className="benefit-ic big" style={{ alignSelf: 'center' }}>{open.emoji ?? '✨'}</span>
            <h2 className="h2 center" style={{ margin: 0 }}>{open.title}</h2>
            <p className="center" style={{ margin: 0, color: 'var(--ink-2)', lineHeight: 1.45 }}>{open.details ?? open.description}</p>
            <button className="btn btn-light" onClick={() => setOpen(null)}>Понятно</button>
          </>
        )}
      </Popup>
    </Stage>
  );
}

export function OnboardingStep() {
  const n = Number(useParams().n);
  if (n === 2) return <Mechanics />;
  if (n === 3) return <Value />;
  if (n >= 4) return <Navigate to="/tariffs" replace />;
  return <Navigate to="/welcome" replace />;
}

export function useTicker(ms: number) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
