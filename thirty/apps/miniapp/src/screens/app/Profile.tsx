import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, CreditCard, Archive as ArchiveIcon, Bell, LifeBuoy, FileText, Image, Star, Pencil } from 'lucide-react';
import { api, rub } from '../../lib/api';
import { openTelegram, requestWriteAccess } from '../../lib/telegram';
import { useMe } from '../../state';
import { Avatar, Empty, ErrorState, Header, Loading, Screen, errorText, humanDate, plural, toast, useLoad } from '../../ui';
import { catTitle } from '../reg/Registration';

interface SubSummary {
  subscription: { status: string; tariffTitle: string; months: number; autoRenew: boolean; paidFrom: string; paidUntil: string; nextCharge: { date: string; amount: number } | null; canResume: boolean } | null;
  payments: { id: string; kind: string; amount: number; status: string; paidAt: string | null; createdAt: string }[];
}

const STATUS: Record<string, string> = { prestart: 'Оплачено, ждём старта', active: 'Активна', past_due: 'Не удалось продлить', canceled_at_period_end: 'Автопродление отключено', expired: 'Закончилась' };
const PAY_STATUS: Record<string, string> = { paid: 'Оплачен', refunded: 'Возврат', failed: 'Не прошёл', disputed: 'На проверке' };

/** S30: профиль — тариф, оплаты, следующий платёж, подписка, архив, уведомления, поддержка */
export function Profile() {
  const nav = useNavigate();
  const { me, refresh } = useMe();
  const { data, error, loading, reload } = useLoad(() => api<SubSummary>('/api/subscription'));
  const support = () => openTelegram('https://t.me/thirty_days_support');
  if (!me) return null;
  const s = data?.subscription;
  return (
    <Screen id="S30" nav>
      <div className="card" style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Avatar name={me.user.name} url={me.user.photoUrl} size="lg" />
        <div className="grow"><div className="h2">{me.user.name} {me.user.sixMonthBadge && '🏅'}</div><div className="muted small">{[me.user.city, me.user.interests.map(catTitle).join(', ')].filter(Boolean).join(' · ') || 'Профиль участника'}</div></div>
        <button className="icon-btn" aria-label="Редактировать профиль" onClick={() => nav('/reg/profile')}><Pencil size={18} /></button>
      </div>
      {loading ? <Loading lines={1} /> : error ? <ErrorState error={error} retry={reload} /> : s ? (
        <div className="card">
          <div className="row between"><div className="h3">Тариф «{s.tariffTitle}»</div><span className={`pill ${s.status === 'active' || s.status === 'prestart' ? 'green' : ''}`}>{STATUS[s.status]}</span></div>
          <div className="row between"><span className="muted">Оплачено до</span><span>{humanDate(s.paidUntil, true)}</span></div>
          {s.nextCharge ? (
            <div className="row between"><span className="muted">Следующий платёж</span><span>{humanDate(s.nextCharge.date, true)} · {rub(s.nextCharge.amount)}</span></div>
          ) : <div className="muted small">Автопродление выключено — доступ сохранится до конца оплаченного периода.</div>}
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
          {s.autoRenew && ['active', 'prestart', 'past_due'].includes(s.status) && <button className="btn btn-ghost" onClick={() => nav('/cancel')}>Управление подпиской</button>}
        </div>
      ) : (
        <div className="card"><div className="muted">Подписки пока нет</div><button className="btn btn-primary" onClick={() => nav('/tariffs')}>Выбрать тариф</button></div>
      )}
      <div className="card">
        {[
          [FileText, 'Мои отчёты', () => nav('/reports')],
          [Image, 'Карточки прогресса', () => nav('/cards')],
          [ArchiveIcon, 'Архив и сравнение месяцев', () => nav('/archive')],
          [Star, 'Оставить отзыв', () => nav('/review?trigger=day14')],
          [Bell, me.user.allowsWrite ? 'Уведомления в боте включены' : 'Включить уведомления в боте', async () => { if (await requestWriteAccess()) { toast('Уведомления включены'); await refresh(); } }],
          [LifeBuoy, 'Поддержка', support],
        ].map(([Icon, label, onClick]) => {
          const I = Icon as typeof FileText;
          return (
            <div className="list-item card-link" key={label as string} onClick={onClick as () => void}>
              <I size={22} color="var(--orange)" /><div className="grow">{label as string}</div><ChevronRight size={20} color="var(--muted)" />
            </div>
          );
        })}
      </div>
      {data && data.payments.length > 0 && (
        <div className="card">
          <div className="h3">История оплат</div>
          {data.payments.map((p) => (
            <div className="list-item" key={p.id}><CreditCard size={20} color="var(--muted)" /><div className="grow"><div>{rub(p.amount)}</div><div className="muted small">{humanDate((p.paidAt ?? p.createdAt).slice(0, 10), true)} · {p.kind === 'initial' ? 'покупка' : p.kind === 'renewal' ? 'продление' : p.kind === 'debt' ? 'оплата продления' : 'доп. услуга'}</div></div><span className="small">{PAY_STATUS[p.status] ?? p.status}</span></div>
          ))}
        </div>
      )}
    </Screen>
  );
}

/** S36–S38: три экрана удержания, но отменить можно с любого шага, без обязательного обращения в поддержку */
export function CancelFlow() {
  const nav = useNavigate();
  const [step, setStep] = useState(1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const home = useLoad(() => api<{ stats?: { successfulDays: number; percent: number; currentStreak: number }; flow?: { title: string } }>('/api/home'));
  const sub = useLoad(() => api<SubSummary>('/api/subscription'));
  useEffect(() => {
    void api('/api/subscription/cancel-step', { body: { step } }).catch(() => undefined);
  }, [step]);
  const paidUntil = sub.data?.subscription?.paidUntil;

  const cancel = async () => {
    setBusy(true);
    try {
      const r = await api<{ paidUntil: string }>('/api/subscription/cancel', { body: { reason: reason || undefined } });
      toast(`Автопродление отключено. Доступ сохранится до ${humanDate(r.paidUntil, true)}`);
      nav('/profile');
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const skip = <button className="btn btn-ghost" onClick={() => setStep(3)}>Перейти к отмене</button>;

  return (
    <Screen id={`S3${5 + step}`}>
      <Header title="Подписка" back="/profile" />
      {step === 1 && (
        <>
          <div className="card peach center">
            <div className="label">Твой результат</div>
            <div className="big-num">{home.data?.stats?.successfulDays ?? 0} {plural(home.data?.stats?.successfulDays ?? 0, 'успешный день', 'успешных дня', 'успешных дней')}</div>
            <div className="muted">{home.data?.stats ? `${home.data.stats.percent}% обязательств · серия ${home.data.stats.currentStreak}` : 'Каждый день в клубе — шаг к цели'}</div>
          </div>
          <p style={{ margin: 0 }}>Ты уже вложил силы в эту привычку. Перерыв часто обнуляет прогресс — но решать тебе.</p>
          <div className="spacer" />
          <button className="btn btn-primary" onClick={() => nav('/')}>Остаться в клубе</button>
          <button className="btn btn-light" onClick={() => setStep(2)}>Продолжить</button>
        </>
      )}
      {step === 2 && (
        <>
          <div className="card">
            <div className="h3">Может, поможет что-то из этого?</div>
            <div className="list-item card-link" onClick={() => nav('/buddy')}><div className="grow">Сменить бадди</div><ChevronRight size={18} /></div>
            <div className="list-item card-link" onClick={() => nav('/club')}><div className="grow">Прийти на созвон с экспертом</div><ChevronRight size={18} /></div>
            <div className="list-item card-link" onClick={() => openTelegram('https://t.me/thirty_days_support')}><div className="grow">Обсудить с поддержкой</div><ChevronRight size={18} /></div>
            <div className="muted small">В следующем месяце можно выбрать другие цели — анкета заполняется заново.</div>
          </div>
          <div className="spacer" />
          <button className="btn btn-primary" onClick={() => nav('/')}>Остаться</button>
          <button className="btn btn-light" onClick={() => setStep(3)}>Всё равно отменить</button>
        </>
      )}
      {step === 3 && (
        <>
          <div className="card">
            <div className="h3">Отмена автопродления</div>
            <p style={{ margin: 0 }}>Следующих списаний не будет. Доступ к клубу сохранится{paidUntil ? ` до ${humanDate(paidUntil, true)}` : ' до конца оплаченного периода'}. Подтверждение придёт в бот.</p>
            <label className="field"><span>Почему уходишь? (необязательно)</span><textarea className="textarea" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
          </div>
          <div className="spacer" />
          <button className="btn btn-primary" disabled={busy} onClick={cancel}>Отменить автопродление</button>
          <button className="btn btn-ghost" onClick={() => nav('/profile')}>Не отменять</button>
        </>
      )}
      {step < 3 && skip}
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
