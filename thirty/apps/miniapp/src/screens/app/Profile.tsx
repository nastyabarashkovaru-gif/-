import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { BadgePercent, ChevronRight, CreditCard, ClipboardList, History, Headphones, User, ArrowLeft, Lock, Target, CircleCheck, X, HeartHandshake, Flame, Users, MessagesSquare, Trophy, ClipboardCheck, MessageCircleHeart } from 'lucide-react';
import { api, rub } from '../../lib/api';
import { formatMetric } from '../../lib/metric';
import { openTelegram } from '../../lib/telegram';
import { useMe } from '../../state';
import { AppBar, Avatar, Empty, ErrorState, Header, Loading, Popup, Screen, errorText, humanDate, plural, toast, useLoad } from '../../ui';
import { catTitle, useMembership } from '../reg/Registration';

interface SubSummary {
  subscription: { status: string; tariffTitle: string; months: number; goalLimit: number | null; price: number; regularPrice: number; autoRenew: boolean; paidFrom: string; paidUntil: string; nextCharge: { date: string; amount: number } | null; canResume: boolean } | null;
  payments: { id: string; kind: string; amount: number; status: string; paidAt: string | null; createdAt: string }[];
}

const STATUS: Record<string, string> = { prestart: 'Оплачено, ждём старта', active: 'Активна', past_due: 'Не удалось продлить', canceled_at_period_end: 'Автопродление отключено', expired: 'Закончилась' };
const PAY_STATUS: Record<string, string> = { paid: 'Оплачен', refunded: 'Возврат', failed: 'Не прошёл', disputed: 'На проверке' };

/** Профиль: анкета, история участия, подписка, поддержка */
export function Profile() {
  const nav = useNavigate();
  const { me } = useMe();
  if (!me) return null;
  const items: [typeof ClipboardList, string, string, () => void][] = [
    [ClipboardList, 'Моя анкета', 'Цели, точки А и Б, действия', () => nav('/profile/questionnaire')],
    [History, 'История участия', 'Мои потоки и результаты', () => nav('/archive')],
    [CreditCard, 'Моя подписка', 'Тариф, оплата и отмена', () => nav('/profile/subscription')],
    [Headphones, 'Поддержка', 'Помощь и вопросы', () => openTelegram(me.support)],
  ];
  return (
    <Screen id="S30" nav>
      <AppBar />
      <div className="card center" style={{ alignItems: 'center', padding: '22px 16px', gap: 8 }}>
        {me.user.photoUrl ? <Avatar name={me.user.name} url={me.user.photoUrl} size="lg" /> : <span className="ic" style={{ width: 72, height: 72 }}><User size={32} /></span>}
        <div className="h2" style={{ fontSize: 22 }}>Мой профиль {me.user.sixMonthBadge && '🏅'}</div>
        <div className="muted">Участник сообщества «30 дней»</div>
      </div>
      {items.map(([I, title, sub, onClick]) => (
        <button key={title} className="card card-link" style={{ flexDirection: 'row', alignItems: 'center', textAlign: 'left', padding: '14px 16px' }} onClick={onClick}>
          <span className="ic sq" style={{ width: 46, height: 46, borderRadius: 13 }}><I size={20} strokeWidth={1.8} /></span>
          <span className="grow"><span className="h3" style={{ display: 'block', fontSize: 17 }}>{title}</span><span className="muted small">{sub}</span></span>
          <ChevronRight size={18} color="var(--muted-2)" />
        </button>
      ))}
    </Screen>
  );
}

function BackToProfile() {
  const nav = useNavigate();
  return <button className="link-accent" style={{ alignSelf: 'flex-start', padding: '2px 0', fontWeight: 500 }} onClick={() => nav('/profile')}><ArrowLeft size={17} />Мой профиль</button>;
}

const monthsTitle = (n: number) => `${n} ${plural(n, 'месяц', 'месяца', 'месяцев')}`;
const goalsLine = (limit: number | null | undefined) => (limit === null || limit === undefined ? 'Безлимит целей' : limit === 1 ? '1 цель' : `До ${limit} целей`) + ' за 30-дневный цикл';

/** Моя подписка: тариф, следующее списание, отмена (через 3 экрана удержания) */
export function MySubscription() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api<SubSummary>('/api/subscription'));
  const s = data?.subscription;
  const [cancel, setCancel] = useState(() => new URLSearchParams(window.location.search).get('cancel') === '1');
  return (
    <Screen id="S31" nav>
      <AppBar />
      <BackToProfile />
      {loading && !data ? <Loading lines={1} /> : error ? <ErrorState error={error} retry={reload} /> : (
        <div className="card" style={{ gap: 14, padding: 18 }}>
          <h1 className="h2" style={{ fontSize: 24 }}>Моя подписка</h1>
          <p className="muted" style={{ margin: 0, fontSize: 15 }}>Тариф, дата следующего списания и управление подпиской.</p>
          {s ? (
            <>
              <div className="panel" style={{ gap: 6, padding: 16 }}>
                <span style={{ color: 'var(--accent-ink)', fontWeight: 700, fontSize: 19 }}>Тариф на {monthsTitle(s.months)}</span>
                <span style={{ fontWeight: 700, fontSize: 20 }}>{rub(s.price)}</span>
                <span className="muted small">{goalsLine(s.goalLimit)}</span>
              </div>
              {s.nextCharge ? (
                <div className="row between small"><span className="muted">Следующее списание</span><span>{humanDate(s.nextCharge.date, true)} · {rub(s.nextCharge.amount)}</span></div>
              ) : (
                <div className="muted small">{s.status === 'expired' ? 'Подписка закончилась.' : `Автопродление отключено — доступ сохранится до ${humanDate(s.paidUntil, true)}.`}</div>
              )}
              {s.status === 'past_due' && (
                <button className="btn btn-primary" onClick={async () => {
                  try { const r = await api<{ url: string }>('/api/subscription/pay-debt', { body: {} }); openTelegram(r.url); } catch (e) { toast(errorText(e)); }
                }}>Оплатить продление</button>
              )}
              {s.canResume && (
                <button className="btn btn-secondary" onClick={async () => {
                  try { await api('/api/subscription/resume', { body: {} }); toast('Автопродление снова включено'); reload(); } catch (e) { toast(errorText(e)); }
                }}>Включить автопродление</button>
              )}
              {s.autoRenew && ['active', 'prestart', 'past_due'].includes(s.status) && (
                <button className="btn" style={{ background: '#fff', border: '1px solid #dedbe6', color: 'var(--ink-2)', fontWeight: 500, minHeight: 50 }} onClick={() => setCancel(true)}>Отменить подписку</button>
              )}
              {s.status === 'expired' && <button className="btn btn-primary" onClick={() => nav('/tariffs')}>Выбрать тариф</button>}
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => nav('/tariffs')}>Выбрать тариф</button>
          )}
        </div>
      )}
      {s && <CancelPopups open={cancel} onClose={() => setCancel(false)} sub={s} />}
    </Screen>
  );
}

/** Моя анкета: только просмотр — после отправки изменить нельзя */
/** Ответы шага 1 анкеты «Давай знакомиться» */
function AboutMe() {
  const { me } = useMe();
  const u = me?.user;
  if (!u || !(u.occupation || u.aspiration || u.age)) return null;
  const rows: [string, string | null][] = [['Имя', u.displayName], ['Город', u.city], ['Возраст', u.age ? String(u.age) : null], ['Чем я занимаюсь', u.occupation], ['К чему хочу прийти', u.aspiration]];
  return (
    <div className="card flat" style={{ gap: 10 }}>
      <span className="h3">О себе</span>
      {rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><div className="label" style={{ color: 'var(--muted)' }}>{k}</div><div style={{ marginTop: 2 }}>{v}</div></div>)}
    </div>
  );
}

export function MyQuestionnaire() {
  const nav = useNavigate();
  const { data: m, error, loading, reload } = useMembership();
  return (
    <Screen id="S32" nav>
      <AppBar />
      <BackToProfile />
      {loading && !m ? <Loading /> : error ? <ErrorState error={error} retry={reload} /> : !m ? (
        <Empty title="Анкеты пока нет" text="Она появится после выбора тарифа." />
      ) : (
        <div className="card" style={{ gap: 14, padding: 18 }}>
          <h1 className="h2" style={{ fontSize: 24 }}>Моя анкета</h1>
          {m.canEdit ? (
            <div className="panel" style={{ gap: 6, padding: 14 }}>
              <span style={{ color: 'var(--accent-ink)', fontWeight: 600 }}>Анкета ещё не отправлена</span>
              <button className="link-accent" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => nav('/reg/about')}>Продолжить заполнение →</button>
            </div>
          ) : (
            <div className="panel" style={{ gap: 6, padding: 14 }}>
              <span className="row" style={{ gap: 8, color: 'var(--accent-ink)', fontWeight: 600, fontSize: 16 }}><Lock size={17} />Твоё обещание себе</span>
              <span className="muted small">Анкета зафиксирована и доступна только для просмотра.</span>
            </div>
          )}
          <AboutMe />
          {m.goals.map((g, i) => (
            <div key={g.id} className="card flat" style={{ gap: 12 }}>
              <span className="row h3" style={{ gap: 8 }}><Target size={18} color="var(--accent)" />Цель {i + 1}</span>
              <div style={{ fontWeight: 600 }}>{g.title}</div>
              <div className="grid2">
                <div style={{ background: 'var(--bg)', borderRadius: 14, padding: '10px 12px' }}><div className="label" style={{ color: 'var(--muted)' }}>Точка А</div><div style={{ marginTop: 4 }}>{g.pointA ?? '—'}</div></div>
                <div style={{ background: 'var(--accent-soft)', borderRadius: 14, padding: '10px 12px' }}><div className="label" style={{ color: 'var(--accent)' }}>Точка Б</div><div style={{ marginTop: 4, color: 'var(--accent-ink)', fontWeight: 600 }}>{g.pointB ?? '—'}</div></div>
              </div>
              <div className="h3">План действий</div>
              {g.tasks.map((t) => (
                <div className="row" key={t.id} style={{ alignItems: 'flex-start', gap: 10 }}>
                  <CircleCheck size={16} color="var(--accent)" style={{ marginTop: 3 }} />
                  <div><div>{t.title}</div><div className="muted small">{t.schedule.replace(/^Однократно, до/, 'До')}</div></div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}

const REASONS = ['Слишком дорого', 'Не хватает времени', 'Не вижу результата', 'Не подошёл формат', 'Другая причина'];

type HomeLite = { stats?: { percent: number; dayNumber: number | null }; goals?: { title: string; numeric: boolean; unit: string; current: number | null; progress: number | null; planPercent: number | null }[] };

/**
 * Отмена подписки — всплывающие окна без индикатора шагов: человек не знает, сколько их впереди.
 * 1) «Ты точно хочешь остановиться?» 2) «Ты потеряешь больше…» 3) цена повторного вступления без скидки
 * 4) «Может, мы сможем помочь?» → обратная связь → «Хочу остаться» / «Перейти в поддержку для отмены».
 */
export function CancelPopups({ open, onClose, sub }: { open: boolean; onClose: () => void; sub: NonNullable<SubSummary['subscription']> }) {
  const nav = useNavigate();
  const { me } = useMe();
  const [step, setStep] = useState(1);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [home, setHome] = useState<HomeLite | null>(null);
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSent(false);
    void api<HomeLite>('/api/home').then(setHome).catch(() => undefined);
  }, [open]);
  useEffect(() => {
    if (open) void api('/api/subscription/cancel-step', { body: { step: Math.min(step, 4) } }).catch(() => undefined);
  }, [open, step]);
  const stay = () => { onClose(); nav('/'); toast('Мы рады, что ты с нами 💜'); };
  const goal = home?.goals?.[0];
  const days = home?.stats?.dayNumber ?? 0;
  const goalPct = goal ? (goal.numeric && goal.progress !== null ? goal.progress : goal.planPercent ?? home?.stats?.percent ?? 0) : 0;
  const months = `${sub.months} ${plural(sub.months, 'месяц', 'месяца', 'месяцев')}`;

  const sendFeedback = async () => {
    setBusy(true);
    try {
      await api('/api/subscription/cancel-feedback', { body: { reason, comment: comment.trim() || undefined } });
      setSent(true);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popup open={open} onClose={onClose} stepKey={step}>
      {step === 1 && (
        <>
          <span className="ic lg" style={{ alignSelf: 'center' }}><HeartHandshake size={30} strokeWidth={1.8} /></span>
          <h2 className="hero" style={{ fontSize: 22 }}>Ты точно хочешь остановиться?</h2>
          <p className="lead" style={{ fontSize: 15 }}>Ты пришла сюда не просто так. Вспомни, ради чего ты решила изменить свою жизнь.</p>
          {goal && (
            <div style={{ background: 'var(--bg)', borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <span className="row h3" style={{ gap: 8 }}><Target size={18} color="var(--accent)" />Твоё обещание себе</span>
              <div style={{ fontWeight: 500 }}>{goal.title}</div>
              <div className="bar soft"><i style={{ width: `${goalPct}%` }} /></div>
              <div className="row between small">
                <span className="muted">{goal.numeric && goal.current !== null ? `Текущий результат: ${formatMetric(goal.current, goal.unit)}` : 'Выполнено действий'}</span>
                <b style={{ color: 'var(--accent)' }}>{goalPct}%</b>
              </div>
              {days > 0 && <><div className="divider" /><span className="row" style={{ gap: 8 }}><Flame size={17} color="var(--orange)" />{days} {plural(days, 'день', 'дня', 'дней')} работы над собой</span></>}
            </div>
          )}
          <p className="muted center" style={{ margin: 0 }}>Не обязательно всё бросать, если сейчас стало сложно.</p>
          <button className="btn btn-primary" onClick={stay}>Я продолжаю! 💜</button>
          <button className="link-btn" onClick={() => setStep(2)}>Всё равно хочу отменить</button>
        </>
      )}
      {step === 2 && (
        <>
          <span className="ic lg" style={{ alignSelf: 'center' }}><Users size={30} strokeWidth={1.8} /></span>
          <h2 className="hero" style={{ fontSize: 22 }}>Ты потеряешь больше, чем просто подписку</h2>
          <p className="lead" style={{ fontSize: 15 }}>Вместе с доступом к сообществу ты потеряешь инструменты, которые помогают не сдаваться.</p>
          {([
            [HeartHandshake, 'Поддержка бадди', 'Человек, с которым вы вместе идёте к цели'],
            [MessagesSquare, 'Тематические чаты', 'Общение с людьми, у которых похожие цели'],
            [Trophy, 'Лидерборд и призы', 'Мотивация и возможность участвовать в розыгрышах'],
            [ClipboardCheck, 'Ежедневные отчёты', 'Система, которая помогает держать слово'],
          ] as const).map(([I, t, d]) => (
            <div key={t} className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
              <span className="ic sq" style={{ width: 42, height: 42, borderRadius: 12 }}><I size={19} strokeWidth={1.8} /></span>
              <div><div className="h3" style={{ fontSize: 15 }}>{t}</div><div className="muted small">{d}</div></div>
            </div>
          ))}
          <div className="panel center" style={{ color: 'var(--accent-ink)', fontWeight: 500 }}>Твой прогресс уже существует. Продолжать проще, чем начинать заново.</div>
          <button className="btn btn-primary" onClick={stay}>Остаться в сообществе 💜</button>
          <button className="link-btn" onClick={() => setStep(3)}>Продолжить отмену</button>
        </>
      )}
      {step === 3 && (
        <>
          <span className="ic lg gold" style={{ alignSelf: 'center' }}><BadgePercent size={30} strokeWidth={1.8} /></span>
          <h2 className="hero" style={{ fontSize: 22 }}>Следующее вступление для тебя будет стоить <em className="nowrap">{rub(sub.regularPrice)}</em></h2>
          <p className="lead" style={{ fontSize: 15 }}>Сейчас твой тариф на {months} стоит <b>{rub(sub.price)}</b> — эта цена закреплена за тобой, пока подписка активна.</p>
          <div style={{ background: 'var(--bg)', borderRadius: 16, padding: 14 }} className="col">
            <div className="row between"><span className="muted">Твоя цена сейчас</span><b className="nowrap" style={{ color: 'var(--green)' }}>{rub(sub.price)}</b></div>
            <div className="row between"><span className="muted">Цена при повторном вступлении</span><b className="nowrap" style={{ color: 'var(--danger)' }}>{rub(sub.regularPrice)}</b></div>
          </div>
          <p className="muted center small" style={{ margin: 0 }}>Если отменишь подписку, скидка сгорит, и вернуться можно будет только по полной цене.</p>
          <button className="btn btn-primary" onClick={stay}>Сохранить скидку и остаться 💜</button>
          <button className="btn btn-light" onClick={() => setStep(4)}>Потерять скидку</button>
        </>
      )}
      {step === 4 && (
        <>
          <span className="ic lg" style={{ alignSelf: 'center' }}><MessageCircleHeart size={30} strokeWidth={1.8} /></span>
          <h2 className="hero" style={{ fontSize: 22 }}>Может, мы сможем помочь?</h2>
          <p className="lead" style={{ fontSize: 15 }}>Расскажи, почему хочешь уйти. Возможно, мы сможем найти решение.</p>
          {!sent ? (
            <>
              <div className="h3">Что стало причиной?</div>
              <div role="radiogroup">
                {REASONS.map((r) => (
                  <button key={r} type="button" className={`radio ${reason === r ? 'on' : ''}`} role="radio" aria-checked={reason === r} onClick={() => setReason(r)}><i />{r}</button>
                ))}
              </div>
              <textarea className="textarea" placeholder="Что именно не понравилось? Нам важно каждое слово" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
              <button className="btn btn-primary" disabled={!reason || busy} onClick={sendFeedback}>{busy ? 'Отправляем…' : 'Отправить обратную связь'}</button>
            </>
          ) : (
            <>
              <div className="banner ok center">Спасибо! Мы прочитаем каждое слово 💜</div>
              <div style={{ background: 'var(--bg)', borderRadius: 16, padding: 14 }}>
                <span className="row h3" style={{ gap: 8 }}><Headphones size={18} color="var(--accent)" />Наша поддержка на связи</span>
                <div className="muted small" style={{ marginTop: 6 }}>Команда поможет разобраться с подпиской или оформить отмену.</div>
              </div>
              <button className="btn btn-primary" onClick={stay}>Хочу остаться 💜</button>
              <button className="link-btn" onClick={() => { void api('/api/subscription/cancel-step', { body: { step: 4, reason } }).catch(() => undefined); openTelegram(me?.support ?? 'https://t.me/barashkova_a'); }}>Перейти в поддержку для отмены</button>
            </>
          )}
        </>
      )}
    </Popup>
  );
}

/** Старый адрес /cancel ведёт на «Мою подписку» с открытым окном отмены */
export function CancelFlow() {
  return <Navigate to="/profile/subscription?cancel=1" replace />;
}

interface ArchiveData {
  perks: { monthComparison: boolean; transformationHistory: boolean; transformationMap6: boolean };
  months: { flowId: string; title: string; startsOn: string; status: string; percent: number | null; successfulDays: number | null; longestStreak: number | null; goals: { title: string; achieved: boolean | null }[]; transformation: { before: { text: string | null; media: string[] } | null; after: { text: string | null; media: string[] } | null } | null }[];
}

/** S34: архив и сравнение месяцев; трансформация «до/после» — с тарифа 3 месяца, карта 6 месяцев — с тарифа 6 */
export function Archive() {
  const { data, error, loading, reload } = useLoad(() => api<ArchiveData>('/api/archive'));
  return (
    <Screen id="S34">
      <Header title="Архив" sub="Твоя история по месяцам" back="/profile" />
      {loading ? <Loading /> : error ? <ErrorState error={error} retry={reload} /> : data!.months.length === 0 ? <Empty title="Архив появится после первого потока" /> : (
        <>
          {data!.perks.transformationMap6 && (
            <div className="card peach">
              <div className="h3">Карта трансформации</div>
              <div className="row" style={{ alignItems: 'flex-end', gap: 6, height: 120 }}>
                {data!.months.map((m) => (
                  <div key={m.flowId} className="grow col" style={{ alignItems: 'center', gap: 4 }}>
                    <div style={{ width: '100%', height: `${Math.max(6, (m.percent ?? 0) * 0.9)}px`, background: 'var(--green)', borderRadius: 8 }} />
                    <span className="small muted">{m.title.slice(0, 3)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data!.months.map((m) => (
            <div className="card" key={m.flowId}>
              <div className="row between"><div className="h3">{m.title}</div>{m.percent !== null && <span className="pill green">{m.percent}%</span>}</div>
              {m.successfulDays !== null && <div className="muted small">{m.successfulDays} успешных дней · лучшая серия {m.longestStreak}</div>}
              {m.goals.map((g) => <div key={g.title} className="small">{g.achieved === true ? '✅' : g.achieved === false ? '➖' : '•'} {g.title}</div>)}
              {m.transformation && (m.transformation.before || m.transformation.after) && (
                <div className="grid2">
                  <div className="col"><div className="label">До</div>{m.transformation.before?.media[0] ? <img src={m.transformation.before.media[0]} alt="До" style={{ borderRadius: 12 }} /> : <div className="small">{m.transformation.before?.text ?? '—'}</div>}</div>
                  <div className="col"><div className="label">После</div>{m.transformation.after?.media[0] ? <img src={m.transformation.after.media[0]} alt="После" style={{ borderRadius: 12 }} /> : <div className="small">{m.transformation.after?.text ?? '—'}</div>}</div>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </Screen>
  );
}

/** S35: апселлы — только если включены в админке, без обещаний дохода */
export function Upsells() {
  const { data, error, loading, reload } = useLoad(() => api<{ items: { code: string; title: string; price: number; description: string; disclaimer: string | null }[] }>('/api/upsells'));
  return (
    <Screen id="S35">
      <Header title="Дополнительно" back="/profile" />
      {loading ? <Loading /> : error ? <ErrorState error={error} retry={reload} /> : data!.items.length === 0 ? <Empty title="Пока нет дополнительных предложений" /> : data!.items.map((u) => (
        <div className="card" key={u.code}>
          <div className="row between"><div className="h3">{u.title}</div><b>{rub(u.price)}</b></div>
          <p style={{ margin: 0 }}>{u.description}</p>
          {u.disclaimer && <div className="muted small">{u.disclaimer}</div>}
          <button className="btn btn-secondary" onClick={async () => {
            try { await api(`/api/upsells/${u.code}/request`, { body: {} }); toast('Заявка отправлена — с вами свяжутся'); } catch (e) { toast(errorText(e)); }
          }}>Оставить заявку</button>
        </div>
      ))}
    </Screen>
  );
}
