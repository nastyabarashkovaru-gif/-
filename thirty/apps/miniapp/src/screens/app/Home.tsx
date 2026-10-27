import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { HeartHandshake, MessagesSquare, BookOpen, ChevronRight, ChevronDown, ChevronUp, ArrowRight, CircleCheck, TrendingUp, ClipboardCheck, PenLine, Instagram, Copy, Download, Share2 } from 'lucide-react';
import { api } from '../../lib/api';
import { formatMetric } from '../../lib/metric';
import { AppBar, ErrorState, Loading, Screen, Sheet, humanDate, plural, toast, useLoad } from '../../ui';
import { canShareStory, downloadImage, shareLink, shareStory } from '../../lib/telegram';
import { catTitle } from '../reg/Registration';
import { ReportForm } from './Report';
import { FeedbackPopup, TrackersPopup } from './Journey';

interface HomeGoal {
  id: string;
  category: string;
  title: string;
  pointA: string | null;
  pointB: string | null;
  numeric: boolean;
  unit: string;
  current: number | null;
  progress: number | null;
  planPercent: number | null;
  tasks: { id: string; title: string; schedule: string }[];
}

interface HomeData {
  state: 'waiting' | 'active' | 'finished' | 'registration' | 'no_membership';
  membership: { id: string; status: string; finalSubmittedAt: string | null };
  flow: { title: string; startsOn: string; endsOn: string; days: number; today: string; phase: string };
  stats: { percent: number; successfulDays: number; dayNumber: number | null };
  comparison: { firstMonth: boolean; baseline: number; current: number; delta: number };
  goals: HomeGoal[];
  todayReported: boolean;
  buddy: { state: 'paired'; buddy: { id: string; name: string; photoUrl: string | null; percent: number | null; writeUrl: string } } | { state: 'waiting' | 'invited' };
  prompts?: { feedback: boolean; feedbackPopup: boolean; feedbackDone: boolean; finale: boolean; finaleDone: boolean; trackers: boolean; trackersClarify?: boolean };
}

/** Окно показываем один раз в день на участие; закрыть можно — вернуться к форме помогает карточка на главной */
function useOncePerDay(key: string | null, want: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!key || !want) return;
    const k = `thirty.popup.${key}.${new Date().toISOString().slice(0, 10)}`;
    try {
      if (localStorage.getItem(k)) return;
      localStorage.setItem(k, '1');
    } catch {
      /* без хранилища — просто показываем */
    }
    setOpen(true);
  }, [key, want]);
  return [open, () => setOpen(false)] as const;
}

/** Главная: до старта — «Ты уже в команде!», после — «Твой путь к результату» с отчётом за сегодня */
export function Home() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<HomeData>('/api/home'));
  // Переход из уведомления «Пора сдать отчёт!» сразу открывает форму
  const loc = useLocation();
  const [share, setShare] = useState(false);
  const [reportOpen, setReportOpen] = useState(() => new URLSearchParams(loc.search).get('report') === '1');
  const p = data?.prompts;
  const [feedbackOpen, closeFeedback] = useOncePerDay(data ? `feedback.${data.membership.id}` : null, Boolean(p?.feedbackPopup));
  // Окно трекеров не накладывается на окно обратной связи
  const [trackersOpen, closeTrackers] = useOncePerDay(data ? `trackers.${data.membership.id}` : null, Boolean(p?.trackers && !p.feedbackPopup));

  if (loading && !data) return <Screen id="S19" nav><Loading /></Screen>;
  if (error || !data) return <Screen id="S19" nav><ErrorState error={error} retry={reload} /></Screen>;
  if (data.state === 'registration') return <Navigate to="/reg/about" replace />;
  if (data.state === 'no_membership') return <Navigate to="/welcome" replace />;
  const { flow, stats } = data;
  const before = data.state === 'waiting';
  const day = stats.dayNumber ?? 0;
  const left = Math.max(0, flow.days - day);
  const dayPct = flow.days ? Math.round((day / flow.days) * 100) : 0;

  return (
    <Screen id="S19" nav>
      <AppBar />
      <div>
        <h1 className="h2" style={{ fontSize: 24 }}>{before ? 'Ты уже в команде! 💜' : data.state === 'finished' ? 'Челлендж завершён! 🎉' : 'Твой путь к результату 🚀'}</h1>
        <p className="sub" style={{ fontSize: 15 }}>{before ? 'Твои цели сохранены. Совсем скоро начинаем!' : 'Каждый день приближает тебя к результату.'}</p>
      </div>

      <div className="hero-card">
        <div className="row between">
          <span style={{ opacity: 0.9 }}>{before ? 'До старта' : 'Твой челлендж'}</span>
          <span className={`hero-pill${before ? ' green' : ''}`}>{before ? 'Ожидание старта' : `День ${Math.min(day, flow.days)} из ${flow.days}`}</span>
        </div>
        {before ? (
          <>
            <StartCountdown startsOn={flow.startsOn} />
            <div style={{ opacity: 0.9 }}>Старт {humanDate(flow.startsOn)}. Твоё обещание себе уже зафиксировано ✨</div>
          </>
        ) : (
          <>
            <div className="hero-title">{data.state === 'finished' ? 'Ты дошла до финиша!' : `${day}-й день. Продолжаем! 🔥`}</div>
            {data.state !== 'finished' && <div style={{ opacity: 0.9 }}>Не сбавляй темп — до финиша {plural(left, 'остался', 'осталось', 'осталось')} {left} {plural(left, 'день', 'дня', 'дней')}.</div>}
            <div className="hero-bar"><i style={{ width: `${dayPct}%` }} /></div>
            <div className="row between" style={{ fontSize: 14 }}><span>{Math.min(day, flow.days)} / {flow.days} дней</span><span>{dayPct}%</span></div>
          </>
        )}
      </div>

      {p?.finale && (
        <button className="home-cta-card finale-cta" onClick={() => nav('/finale')}>
          <span className="em">🎉</span>
          <span className="grow"><b style={{ display: 'block', fontSize: 17 }}>{p.finaleDone ? 'Твои результаты за 30 дней' : 'Ты прошёл 30 дней!'}</b><span style={{ opacity: 0.9, fontSize: 14 }}>{p.finaleDone ? 'Карточка для Stories и новая цель' : 'Посмотри свои итоги месяца'}</span></span>
          <ChevronRight size={20} />
        </button>
      )}
      {p?.feedback && (
        <button className="home-cta-card feedback-cta" onClick={() => nav('/feedback')}>
          <span className="em">🥹</span>
          <span className="grow"><b style={{ display: 'block', fontSize: 16 }}>Как прошли твои 30 дней?</b><span className="muted" style={{ fontSize: 14 }}>Поделись обратной связью — это 2 минуты</span></span>
          <ChevronRight size={20} color="var(--accent)" />
        </button>
      )}
      {p?.trackersClarify && (
        <button className="home-cta-card trackers-cta" onClick={() => nav('/trackers')}>
          <span className="em">🔄</span>
          <span className="grow"><b style={{ display: 'block', fontSize: 16 }}>Загрузи новый скриншот отзыва</b><span className="muted" style={{ fontSize: 14 }}>И мы сразу пришлём трекеры</span></span>
          <ChevronRight size={20} color="var(--accent)" />
        </button>
      )}
      {p?.trackers && !p.feedback && (
        <button className="home-cta-card trackers-cta" onClick={() => nav('/trackers')}>
          <span className="em">🎁</span>
          <span className="grow"><b style={{ display: 'block', fontSize: 16 }}>Получи трекеры за свой отзыв</b><span className="muted" style={{ fontSize: 14 }}>Три трекера в Google Таблицах</span></span>
          <ChevronRight size={20} color="var(--accent)" />
        </button>
      )}
      <FeedbackPopup open={feedbackOpen} onClose={closeFeedback} />
      <TrackersPopup open={trackersOpen} onClose={closeTrackers} />
      {!before && !data.comparison.firstMonth && data.comparison.delta > 0 && (
        <div className="growth-note"><TrendingUp size={15} />На {data.comparison.delta} {plural(data.comparison.delta, 'день', 'дня', 'дней')} больше, чем в предыдущем месяце!</div>
      )}
      {before && <button className="link-accent story-link" onClick={() => setShare(true)}><Instagram size={17} />А пока поделись в сторис, что ты идёшь на наш челлендж! 😍</button>}
      <StorySheet open={share} onClose={() => setShare(false)} />
      {data.state === 'active' && (
        <div className="card" style={{ gap: 10 }}>
          <div className="row between">
            <span className="row h3" style={{ gap: 8, fontSize: 17 }}><ClipboardCheck size={19} color="var(--accent)" />Отчёт за сегодня</span>
            <span className="small" style={{ color: data.todayReported ? 'var(--green)' : 'var(--muted-2)' }}>{data.todayReported ? 'Отправлен' : 'Не отправлен'}</span>
          </div>
          {data.todayReported ? (
            <div className="row" style={{ gap: 8, color: 'var(--green)' }}><CircleCheck size={17} />Отчёт за сегодня отправлен. Так держать!</div>
          ) : (
            <>
              <p className="muted" style={{ margin: 0 }}>Отметь действия и обязательно прикрепи фото.</p>
              <button className="btn btn-primary" onClick={() => setReportOpen(!reportOpen)}><PenLine size={18} />Заполнить отчёт</button>
              {reportOpen && <ReportForm onSent={() => { setReportOpen(false); reload(); }} />}
            </>
          )}
        </div>
      )}

      <div className="row between" style={{ marginTop: 6 }}>
        <h2 className="h2" style={{ fontSize: 22 }}>Мои цели 🎯</h2>
        <span className="pill green">{data.goals.length} {plural(data.goals.length, 'цель', 'цели', 'целей')}</span>
      </div>
      {data.goals.map((g, i) => <GoalItem key={g.id} goal={g} n={i + 1} />)}

      <div className="grid2" style={{ alignItems: 'stretch' }}>
        <div className="card" style={{ gap: 8 }}>
          <span className="row h3" style={{ gap: 8 }}><HeartHandshake size={20} color="var(--accent)" />Мой бадди</span>
          {data.buddy.state === 'paired' ? (
            <>
              <div style={{ fontWeight: 600, color: 'var(--ink-2)' }}>{data.buddy.buddy.name}</div>
              <button className="link-accent" style={{ alignSelf: 'flex-start', padding: 0, fontWeight: 500 }} onClick={() => nav(`/u/${(data.buddy as { buddy: { id: string } }).buddy.id}`)}>Посмотреть профиль</button>
            </>
          ) : (
            <div className="muted">{before ? `Откроется ${humanDate(flow.startsOn)}` : 'Подбираем бадди'}</div>
          )}
          <div className="spacer" />
          {before && data.buddy.state !== 'paired' && (
            <>
              <div className="divider" />
              <button className="link-accent" style={{ alignSelf: 'flex-start', padding: 0, fontWeight: 500, textDecoration: 'underline', textUnderlineOffset: 3 }} onClick={() => nav('/reg/buddy')}>Выбрать бадди заранее</button>
            </>
          )}
        </div>
        <button className="card card-link" style={{ gap: 8, textAlign: 'left' }} onClick={() => nav('/club')}>
          <span className="row h3" style={{ gap: 8 }}><MessagesSquare size={20} color="var(--accent)" />Моё сообщество</span>
          <span style={{ color: 'var(--ink-2)' }}>Твои чаты</span>
          <span className="muted small">Общение и созвоны</span>
          <span className="spacer" />
          <span className="row" style={{ gap: 4, color: 'var(--accent)', fontWeight: 500 }}>Перейти <ArrowRight size={15} /></span>
        </button>
      </div>
      <button className="card card-link" style={{ flexDirection: 'row', alignItems: 'center', textAlign: 'left' }} onClick={() => nav('/materials')}>
        <BookOpen size={20} color="var(--accent)" />
        <span className="grow"><span className="h3" style={{ display: 'block' }}>Полезные материалы</span><span className="muted small">Гайды, обучение, подкасты</span></span>
        <ChevronRight size={18} color="var(--accent)" />
      </button>
    </Screen>
  );
}

function GoalItem({ goal, n }: { goal: HomeGoal; n: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card" style={{ gap: 12 }}>
      <button className="row" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', alignItems: 'flex-start' }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ic sq" style={{ width: 40, height: 40, borderRadius: 12, fontSize: 18, fontWeight: 600 }}>{n}</span>
        <span className="grow">
          <span className="muted small" style={{ display: 'block' }}>Цель {n} · {catTitle(goal.category)}</span>
          <span className="h3" style={{ display: 'block', fontSize: 16, marginTop: 2 }}>{goal.title}</span>
        </span>
        {open ? <ChevronUp size={18} color="var(--accent)" /> : <ChevronDown size={18} color="var(--accent)" />}
      </button>
      {open && (
        <>
          <div className="divider" />
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div className="grow"><div className="label" style={{ color: 'var(--muted)' }}>Точка А</div><div style={{ marginTop: 4 }}>{goal.pointA ?? '—'}</div></div>
            <ArrowRight size={15} color="var(--muted-2)" style={{ marginTop: 14 }} />
            <div className="grow" style={{ textAlign: 'right' }}><div className="label" style={{ color: 'var(--accent)' }}>Точка Б</div><div style={{ marginTop: 4, color: 'var(--accent-ink)', fontWeight: 600 }}>{goal.pointB ?? '—'}</div></div>
          </div>
          <GoalProgress goal={goal} />
          <div className="h3">План действий</div>
          {goal.tasks.map((t) => (
            <div className="row" key={t.id} style={{ alignItems: 'flex-start', gap: 10 }}>
              <CircleCheck size={16} color="var(--accent)" style={{ marginTop: 3 }} />
              <div><div>{t.title}</div><div className="muted small">{t.schedule.replace(/^Однократно, до/, 'До')}</div></div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** Прогресс цели: для числовых — по «Текущему результату» между точками А и Б, для остальных — по выполненным действиям */
function GoalProgress({ goal }: { goal: HomeGoal }) {
  if (goal.numeric) {
    if (goal.current === null || goal.progress === null) return <div className="muted small">Укажи «Текущий результат» в ежедневном отчёте — здесь появится прогресс.</div>;
    return (
      <div className="col" style={{ gap: 8 }}>
        <div className="row between"><span className="muted">Сейчас: {formatMetric(goal.current, goal.unit)}</span><b style={{ color: 'var(--accent)' }}>{goal.progress}% пути</b></div>
        <div className="bar soft"><i style={{ width: `${goal.progress}%` }} /></div>
      </div>
    );
  }
  if (goal.planPercent === null) return null;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row between"><span className="muted">Выполнено действий</span><b style={{ color: 'var(--accent)' }}>{goal.planPercent}%</b></div>
      <div className="bar soft"><i style={{ width: `${goal.planPercent}%` }} /></div>
    </div>
  );
}

/** Обратный отсчёт до старта: дни и часы, обновляется раз в минуту */
function StartCountdown({ startsOn }: { startsOn: string }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(`${startsOn}T00:00:00+03:00`).getTime() - now);
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return (
    <div className="hero-title">
      {d > 0 && <>{d} {plural(d, 'день', 'дня', 'дней')} </>}{h} {plural(h, 'час', 'часа', 'часов')}{d === 0 && <> {m} мин</>} ✨
    </div>
  );
}

/** Карточка для сторис «Я иду на челлендж»: скопировать ссылку, скачать, поделиться */
export function StorySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [card, setCard] = useState<{ imageUrl: string; account: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  useEffect(() => {
    if (!open || card) return;
    void api<{ imageUrl: string; account: string }>('/api/story-card').then(setCard).catch(() => undefined);
    void api<{ url: string }>('/api/referral').then((r) => setLink(r.url)).catch(() => undefined);
  }, [open, card]);
  const text = 'Я иду на челлендж «30 дней» 🚀 Присоединяйся!';
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link ? `${text} ${link}` : text);
      toast('Скопировано 💜');
    } catch {
      toast('Не получилось скопировать');
    }
  };
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="h3 center" style={{ fontSize: 18 }}>Поделись, что ты идёшь на челлендж 🚀</div>
      <p className="muted small center" style={{ margin: 0 }}>Впиши свои цели на карточку и выложи в сторис{card?.account ? <> с отметкой <b>@{card.account}</b></> : null}.</p>
      {card ? <img src={card.imageUrl} alt="Карточка для сторис" className="story-preview" /> : <div className="skeleton" style={{ height: 320, width: '55%', alignSelf: 'center' }} />}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-secondary" onClick={copy}><Copy size={17} />Скопировать</button>
        <button className="btn btn-secondary" disabled={!card} onClick={() => card && downloadImage(card.imageUrl, '30-dney-story.png')}><Download size={17} />Скачать</button>
      </div>
      <button className="btn btn-primary" disabled={!card} onClick={() => {
        if (!card) return;
        if (canShareStory()) shareStory(card.imageUrl, link ?? 'https://t.me/Dney30_bot');
        else shareLink(link ?? 'https://t.me/Dney30_bot', text);
      }}><Share2 size={17} />Поделиться</button>
    </Sheet>
  );
}
