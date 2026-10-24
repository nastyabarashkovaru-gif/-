import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, CreditCard, ClipboardList, History, Headphones, User, ArrowLeft, Lock, Target, CircleCheck, X, HeartHandshake, Flame, Users, MessagesSquare, Trophy, ClipboardCheck, MessageCircleHeart } from 'lucide-react';
import { api, rub } from '../../lib/api';
import { formatMetric } from '../../lib/metric';
import { openTelegram } from '../../lib/telegram';
import { useMe } from '../../state';
import { AppBar, Avatar, BrandBar, Dots, Empty, ErrorState, Header, Loading, Screen, errorText, humanDate, plural, toast, useLoad } from '../../ui';
import { catTitle, useMembership } from '../reg/Registration';

interface SubSummary {
  subscription: { status: string; tariffTitle: string; months: number; goalLimit: number | null; price: number; autoRenew: boolean; paidFrom: string; paidUntil: string; nextCharge: { date: string; amount: number } | null; canResume: boolean } | null;
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
                <button className="btn" style={{ background: '#fff', border: '1px solid #dedbe6', color: 'var(--ink-2)', fontWeight: 500, minHeight: 50 }} onClick={() => nav('/cancel')}>Отменить подписку</button>
              )}
              {s.status === 'expired' && <button className="btn btn-primary" onClick={() => nav('/tariffs')}>Выбрать тариф</button>}
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => nav('/tariffs')}>Выбрать тариф</button>
          )}
        </div>
      )}
    </Screen>
  );
}

/** Моя анкета: только просмотр — после отправки изменить нельзя */
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
              <button className="link-accent" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => nav('/reg/goals')}>Продолжить заполнение →</button>
            </div>
          ) : (
            <div className="panel" style={{ gap: 6, padding: 14 }}>
              <span className="row" style={{ gap: 8, color: 'var(--accent-ink)', fontWeight: 600, fontSize: 16 }}><Lock size={17} />Твоё обещание себе</span>
              <span className="muted small">Анкета зафиксирована и доступна только для просмотра.</span>
            </div>
          )}
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

/** Отмена: три окна удержания, затем переход в поддержку (макет владельца) */
export function CancelFlow() {
  const nav = useNavigate();
  const { me } = useMe();
  const [step, setStep] = useState(1);
  const [reason, setReason] = useState('');
  const home = useLoad(() => api<{ stats?: { percent: number; dayNumber: number | null; successfulDays: number }; goals?: { title: string; numeric: boolean; unit: string; current: number | null; progress: number | null; planPercent: number | null }[] }>('/api/home'));
  useEffect(() => {
    void api('/api/subscription/cancel-step', { body: { step } }).catch(() => undefined);
  }, [step]);
  const stay = () => nav('/');
  const goal = home.data?.goals?.[0];
  const days = home.data?.stats?.dayNumber ?? 0;
  const goalPct = goal ? (goal.numeric && goal.progress !== null ? goal.progress : goal.planPercent ?? home.data?.stats?.percent ?? 0) : 0;

  return (
    <Screen id={`S3${5 + step}`}>
      <BrandBar right={<button className="link-btn" style={{ padding: 4, textDecoration: 'none' }} aria-label="Закрыть" onClick={() => nav('/profile/subscription')}><X size={22} /></button>} />
      <div className="steps" style={{ gridAutoColumns: '1fr' }}>{[1, 2, 3].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>
      <div className="row between small muted"><span>Управление подпиской</span><span>Шаг {step} из 3</span></div>
      <div className="card" style={{ gap: 14, padding: 18 }}>
        {step === 1 && (
          <>
            <span className="ic lg" style={{ alignSelf: 'center' }}><HeartHandshake size={30} strokeWidth={1.8} /></span>
            <h1 className="hero" style={{ fontSize: 23 }}>Ты точно хочешь остановиться?</h1>
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
                {days > 0 && (
                  <>
                    <div className="divider" />
                    <span className="row" style={{ gap: 8 }}><Flame size={17} color="var(--orange)" />{days} {plural(days, 'день', 'дня', 'дней')} работы над собой</span>
                  </>
                )}
              </div>
            )}
            <p className="muted center" style={{ margin: 0 }}>Не обязательно всё бросать, если сейчас стало сложно.</p>
          </>
        )}
        {step === 2 && (
          <>
            <span className="ic lg" style={{ alignSelf: 'center' }}><Users size={30} strokeWidth={1.8} /></span>
            <h1 className="hero" style={{ fontSize: 23 }}>Ты потеряешь больше, чем просто подписку</h1>
            <p className="lead" style={{ fontSize: 15 }}>Вместе с доступом к сообществу ты потеряешь инструменты, которые помогают не сдаваться.</p>
            {([
              [HeartHandshake, 'Поддержка бадди', 'Человек, с которым вы вместе идёте к цели'],
              [MessagesSquare, 'Тематические чаты', 'Общение с людьми, у которых похожие цели'],
              [Trophy, 'Лидерборд и призы', 'Мотивация и возможность участвовать в розыгрышах'],
              [ClipboardCheck, 'Ежедневные отчёты', 'Система, которая помогает держать слово'],
            ] as const).map(([I, t, d]) => (
              <div key={t} className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
                <span className="ic sq" style={{ width: 46, height: 46, borderRadius: 13 }}><I size={20} strokeWidth={1.8} /></span>
                <div><div className="h3">{t}</div><div className="muted small">{d}</div></div>
              </div>
            ))}
            <div className="panel center" style={{ color: 'var(--accent-ink)', fontWeight: 500 }}>Твой прогресс уже существует. Продолжать проще, чем начинать заново.</div>
          </>
        )}
        {step === 3 && (
          <>
            <span className="ic lg" style={{ alignSelf: 'center' }}><MessageCircleHeart size={30} strokeWidth={1.8} /></span>
            <h1 className="hero" style={{ fontSize: 23 }}>Может, мы сможем помочь?</h1>
            <p className="lead" style={{ fontSize: 15 }}>Расскажи, почему хочешь уйти. Возможно, мы сможем найти решение.</p>
            <div className="h3">Что стало причиной?</div>
            <div role="radiogroup">
              {REASONS.map((r) => (
                <button key={r} type="button" className={`radio ${reason === r ? 'on' : ''}`} role="radio" aria-checked={reason === r} onClick={() => setReason(r)}><i />{r}</button>
              ))}
            </div>
            <div style={{ background: 'var(--bg)', borderRadius: 16, padding: 14 }}>
              <span className="row h3" style={{ gap: 8 }}><Headphones size={18} color="var(--accent)" />Наша поддержка на связи</span>
              <div className="muted small" style={{ marginTop: 6 }}>Команда поможет разобраться с подпиской или оформить отмену.</div>
            </div>
          </>
        )}
      </div>
      {step === 1 && <><button className="btn btn-primary" onClick={stay}>Я продолжаю! 💜</button><button className="link-btn" onClick={() => setStep(2)}>Всё равно хочу отменить</button></>}
      {step === 2 && <><button className="btn btn-primary" onClick={stay}>Остаться в сообществе 💜</button><button className="link-btn" onClick={() => setStep(3)}>Продолжить отмену</button></>}
      {step === 3 && (
        <>
          <button className="btn btn-primary" onClick={stay}>Хочу остаться 💜</button>
          <button className="link-btn" onClick={() => {
            void api('/api/subscription/cancel-step', { body: { step: 4, reason: reason || undefined } }).catch(() => undefined);
            openTelegram(me?.support ?? 'https://t.me/barashkova_a');
          }}>Перейти в поддержку для отмены</button>
        </>
      )}
      <Dots count={3} at={step - 1} />
    </Screen>
  );
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
