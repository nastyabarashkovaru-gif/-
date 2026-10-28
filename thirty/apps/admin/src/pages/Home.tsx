import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarDays, ChevronDown, ChevronRight, CreditCard, Repeat, Sparkles, TrendingUp, Users, Wallet } from 'lucide-react';
import { api, dt, rub } from '../api';
import { Bars, Delta, Donut, LineChart, monthLabel, num, pctf, type Series } from '../charts';
import { Sheet, useLoad } from '../ui';

export type Period = { period: 'today' | '7d' | '30d' | 'all' | 'custom'; from?: string; to?: string };
const PERIODS: [Period['period'], string][] = [['today', 'Сегодня'], ['7d', '7 дней'], ['30d', '30 дней'], ['all', 'Всё время']];
const KEY = 'thirty.admin.period';

export const periodQuery = (p: Period) => (p.period === 'custom' ? `period=custom&from=${p.from}&to=${p.to}` : `period=${p.period}`);

export function usePeriod() {
  const [p, setP] = useState<Period>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '') as Period;
    } catch {
      return { period: '30d' };
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* без хранилища — период просто не запоминается */
    }
  }, [p]);
  return [p, setP] as const;
}

/** Переключатель периода: быстрые кнопки + свой период через календарь */
export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(value.from ?? today);
  const [to, setTo] = useState(value.to ?? today);
  return (
    <>
      <div className="chips">
        {PERIODS.map(([k, t]) => <button key={k} className={`chip${value.period === k ? ' on' : ''}`} onClick={() => onChange({ period: k })}>{t}</button>)}
        <button className={`chip icon${value.period === 'custom' ? ' on' : ''}`} onClick={() => setOpen(true)} aria-label="Свой период">
          <CalendarDays size={18} />{value.period === 'custom' && <span>{value.from!.slice(8, 10)}.{value.from!.slice(5, 7)}–{value.to!.slice(8, 10)}.{value.to!.slice(5, 7)}</span>}
        </button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Свой период">
        <div className="form">
          <label className="f">С<input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="f">По<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn big" onClick={() => { onChange({ period: 'custom', from, to }); setOpen(false); }}>Показать</button>
        </div>
      </Sheet>
    </>
  );
}

function Skeleton({ h = 120 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} />;
}

function Block<T>({ s, h, children }: { s: { data: T | null; error: string | null; loading: boolean }; h?: number; children: (d: T) => React.ReactNode }) {
  if (s.error) return <div className="err">{s.error}</div>;
  if (!s.data) return <Skeleton h={h} />;
  return <div className={s.loading ? 'reloading' : ''}>{children(s.data)}</div>;
}

const C = { accent: '#7c4dff', accent2: '#b39dff', green: '#22b573', orange: '#ff8a3d', pink: '#e86bd0', gray: '#c9c3dc' };

/* ───────── 1. Карточки воронки и главный показатель ───────── */

function Hero({ d }: { d: any }) {
  const paid = d.cards.paid.count, bot = d.cards.bot.count;
  return (
    <div className="hero-card">
      <div className="hero-top"><Sparkles size={18} /> Конверсия бот → оплата</div>
      <div className="hero-num">{pctf(d.hero.botToPaid)}</div>
      <div className="hero-sub">{num(paid)} из {num(bot)} пришедших оплатили</div>
      <div className="hero-delta">
        {d.hero.deltaPp === null ? <span>Сравнение появится, когда накопятся данные за прошлый период</span> : (
          <span className={d.hero.deltaPp >= 0 ? 'up' : 'down'}>{d.hero.deltaPp >= 0 ? '↑ +' : '↓ −'}{Math.abs(d.hero.deltaPp).toLocaleString('ru-RU')} п.п. к прошлому периоду ({pctf(d.hero.previous)})</span>
        )}
      </div>
    </div>
  );
}

function Kpi({ title, count, of, ofText, change }: { title: string; count: number; of?: number | null; ofText?: string; change: number | null }) {
  return (
    <div className="kpi-card">
      <div className="kpi-title">{title}</div>
      <div className="kpi-num">{num(count)}</div>
      {of !== undefined && <div className="kpi-of">{pctf(of)} {ofText}</div>}
      <Delta v={change} suffix="" />
    </div>
  );
}

/* ───────── 2. Воронка по экранам ───────── */

function FunnelBlock({ d }: { d: any }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = d.steps[0].count || 1;
  return (
    <section className="block">
      <h2>Воронка онбординга</h2>
      <p className="sub">Уникальные люди, пришедшие за период. Нажми на этап — подробности.</p>
      {d.worst && (
        <div className="warn-card"><AlertTriangle size={20} /><div>Наибольший отток: <b>{d.worst.from} → {d.worst.to}</b>. Теряется {pctf(d.worst.lostPct)} ({num(d.worst.lost)} чел.)</div></div>
      )}
      <div className="funnel">
        {d.steps.map((s: any, i: number) => {
          const worst = d.worst && i > 0 && d.steps[i - 1].short === d.worst.from && s.short === d.worst.to;
          return (
            <button key={s.key} className={`fstep${worst ? ' worst' : ''}${open === s.key ? ' open' : ''}`} onClick={() => setOpen(open === s.key ? null : s.key)}>
              <div className="fstep-head"><span>{s.title}</span><b>{num(s.count)}</b></div>
              <div className="fbar"><i style={{ width: `${Math.max(1.5, (s.count / max) * 100)}%` }} /></div>
              <div className="fstep-meta">
                {i === 0 ? <span>100% — вход в воронку</span> : <><span>{pctf(s.pctPrev)} с прошлого шага</span>{s.lost > 0 && <span className="lost">−{num(s.lost)}</span>}</>}
              </div>
              {open === s.key && i > 0 && (
                <div className="fstep-detail">
                  <div><span>Переход</span><b>{d.steps[i - 1].short} → {s.short}</b></div>
                  <div><span>Перешли</span><b>{num(s.count)} чел.</b></div>
                  <div><span>Конверсия</span><b>{pctf(s.pctPrev)}</b></div>
                  <div><span>Потеряли</span><b>{num(s.lost)} чел.</b></div>
                  <div><span>Отток</span><b>{pctf(s.lostPct)}</b></div>
                  <div><span>От всех пришедших</span><b>{pctf(s.pctStart)}</b></div>
                  {s.medianMinutes !== null && <div><span>Обычно на шаг уходит</span><b>{s.medianMinutes < 60 ? `${s.medianMinutes} мин` : s.medianMinutes < 2880 ? `${Math.round(s.medianMinutes / 60)} ч` : `${Math.round(s.medianMinutes / 1440)} дн`}</b></div>}
                </div>
              )}
            </button>
          );
        })}
      </div>
      <div className="conv-grid">
        <div><span>Бот → приложение</span><b>{pctf(d.conversions.botToApp)}</b></div>
        <div><span>Приложение → тарифы</span><b>{pctf(d.conversions.appToTariffs)}</b></div>
        <div><span>Тарифы → оплата</span><b>{pctf(d.conversions.tariffsToPaid)}</b></div>
        <div className="main"><span>Бот → оплата</span><b>{pctf(d.conversions.botToPaid)}</b></div>
      </div>
      {d.note && <p className="sub small">{d.note}</p>}
    </section>
  );
}

/* ───────── 3. Динамика ───────── */

const METRICS: { key: 'bot' | 'app' | 'tariffs' | 'payments' | 'conv'; name: string; color: string }[] = [
  { key: 'bot', name: 'Открыли бота', color: C.accent },
  { key: 'app', name: 'Открыли приложение', color: C.pink },
  { key: 'tariffs', name: 'Смотрели тарифы', color: C.orange },
  { key: 'payments', name: 'Оплаты', color: C.green },
  { key: 'conv', name: 'Конверсия в оплату', color: '#3b82f6' },
];

function Dynamics({ d }: { d: any }) {
  const [on, setOn] = useState<string[]>(['bot', 'payments']);
  const [compare, setCompare] = useState(false);
  const toggle = (k: string) => setOn((cur) => (cur.includes(k) ? (cur.length > 1 ? cur.filter((x) => x !== k) : cur) : [...cur.slice(-1), k]));
  const isConv = on.includes('conv');
  const shown = isConv ? ['conv'] : on;
  const series: Series[] = [];
  for (const k of shown) {
    const m = METRICS.find((x) => x.key === k)!;
    series.push({ key: k, name: m.name, color: m.color, values: d.daily.current[k] });
    if (compare && d.daily.previous) series.push({ key: `${k}-prev`, name: `${m.name} (прошлый период)`, color: m.color, values: d.daily.previous[k], dashed: true });
  }
  return (
    <section className="block">
      <h2>Динамика конверсий</h2>
      <div className="chips wrap small">
        {METRICS.map((m) => <button key={m.key} className={`chip${shown.includes(m.key) ? ' on' : ''}`} style={shown.includes(m.key) ? { background: m.color, borderColor: m.color } : undefined} onClick={() => (m.key === 'conv' ? setOn(isConv ? ['bot', 'payments'] : ['conv']) : toggle(m.key))}>{m.name}</button>)}
      </div>
      <LineChart labels={d.daily.days} series={series} format={isConv ? (v) => pctf(v) : num} />
      <label className="switch">
        <input type="checkbox" checked={compare} disabled={!d.daily.previous} onChange={(e) => setCompare(e.target.checked)} />
        <span>Сравнить с прошлым периодом{!d.daily.previous && ' (данных пока нет)'}</span>
      </label>
    </section>
  );
}

/* ───────── 4. Деньги ───────── */

export const STATUS_RU: Record<string, [string, string]> = {
  paid: ['Оплачен', 'ok'], refunded: ['Возврат', 'err'], failed: ['Не прошёл', 'err'], disputed: ['Расхождение', 'warn'], pending: ['Ожидает', 'warn'], initiated: ['Создан', 'muted'],
};

const SHORT_KIND: Record<string, string> = { initial: 'Покупка', renewal: 'Продление', debt: 'Продление', upsell: 'Доп. покупка' };
const shortDt = (s: string) => new Date(s).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
export const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};

export function PaymentRow({ p, onClick }: { p: any; onClick: () => void }) {
  const [label, cls] = STATUS_RU[p.status] ?? [p.status, 'muted'];
  return (
    <button className="pay-row" onClick={onClick}>
      <div className={`pay-ico ${p.kind === 'initial' ? '' : 'renew'}`}>{p.kind === 'initial' ? <CreditCard size={18} /> : <Repeat size={18} />}</div>
      <div className="pay-main">
        <b>{p.name}</b>
        <span>{SHORT_KIND[p.kind] ?? p.kindTitle} · {p.tariff.replace(/ месяц(а|ев)?$/, ' мес')}</span>
        <span className="muted">{shortDt(p.at)}</span>
      </div>
      <div className="pay-side">
        <b className={p.status === 'paid' ? '' : 'strike'}>{rub(p.amount)}</b>
        <span className={`pill ${cls}`}>{label}</span>
      </div>
    </button>
  );
}

export function PaymentSheet({ p, onClose }: { p: any | null; onClose: () => void }) {
  const nav = useNavigate();
  if (!p) return null;
  return (
    <Sheet open onClose={onClose} title={rub(p.amount)}>
      <div className="detail-list">
        <div><span>Участник</span><b>{p.name}</b></div>
        <div><span>Дата</span><b>{dt(p.at)}</b></div>
        <div><span>Тариф</span><b>{p.tariff}</b></div>
        <div><span>Тип</span><b>{p.kindTitle}</b></div>
        <div><span>Статус</span><b>{(STATUS_RU[p.status] ?? [p.status])[0]}</b></div>
        {p.test && <div><span>Тестовая оплата</span><b>не входит в выручку</b></div>}
      </div>
      <button className="btn big light" onClick={() => nav(`/users/${p.userId}`)}>Карточка участника</button>
    </Sheet>
  );
}

function Money({ d }: { d: any }) {
  const [mode, setMode] = useState<'revenue' | 'count'>('revenue');
  const [compare, setCompare] = useState(false);
  const [sel, setSel] = useState<any>(null);
  const series: Series[] = [{ key: mode, name: mode === 'revenue' ? 'Выручка' : 'Оплаты', color: C.accent, values: d.daily[mode === 'revenue' ? 'revenue' : 'count'] }];
  const prev = d.daily[mode === 'revenue' ? 'prevRevenue' : 'prevCount'];
  if (compare && prev) series.push({ key: `${mode}-prev`, name: 'Прошлый период', color: C.accent, values: prev, dashed: true });
  return (
    <section className="block">
      <h2>Оплаты и выручка</h2>
      <div className="money-hero">
        <span>Выручка за период</span>
        <b>{rub(d.revenue)}</b>
        <Delta v={d.revenueChange} />
      </div>
      <div className="mini-grid">
        <div><span>Оплат</span><b>{num(d.payments)}</b><em>{num(d.buyers)} {plural(d.buyers, 'покупатель', 'покупателя', 'покупателей')}</em></div>
        <div><span>Средний чек</span><b>{rub(d.avgCheck)}</b></div>
        <div><span>Новые покупки</span><b>{num(d.newPurchases)}</b></div>
        <div><span>Продления</span><b>{num(d.renewals)}</b></div>
      </div>
      {d.refunds.count > 0 && <p className="sub small">Возвраты за период: {num(d.refunds.count)} на {rub(d.refunds.amount)} — в выручку не входят.</p>}
      <div className="seg">
        <button className={mode === 'revenue' ? 'on' : ''} onClick={() => setMode('revenue')}>Выручка</button>
        <button className={mode === 'count' ? 'on' : ''} onClick={() => setMode('count')}>Количество оплат</button>
      </div>
      <LineChart labels={d.daily.days} series={series} format={mode === 'revenue' ? rub : num} />
      <label className="switch">
        <input type="checkbox" checked={compare} disabled={!prev} onChange={(e) => setCompare(e.target.checked)} />
        <span>Сравнить с прошлым периодом{!prev && ' (данных пока нет)'}</span>
      </label>
      <h3>Последние платежи</h3>
      {d.recent.length ? <div className="list">{d.recent.map((p: any) => <PaymentRow key={p.id} p={p} onClick={() => setSel(p)} />)}</div> : <div className="empty">За период платежей нет</div>}
      <Link className="btn big light" to="/payments">Посмотреть все оплаты <ChevronRight size={18} /></Link>
      <PaymentSheet p={sel} onClose={() => setSel(null)} />
    </section>
  );
}

/* ───────── 5. Тарифы ───────── */

const TARIFF_COLORS = [C.accent, C.orange, C.green, C.pink, '#3b82f6'];

function TariffsBlock({ d }: { d: any }) {
  const [sel, setSel] = useState<string | null>(null);
  const items = d.tariffs.map((t: any, i: number) => ({ key: t.id, label: t.title, value: t.count, color: TARIFF_COLORS[i % TARIFF_COLORS.length] }));
  const total = d.tariffs.reduce((a: number, t: any) => a + t.count, 0);
  const s = d.tariffs.find((t: any) => t.id === sel);
  return (
    <section className="block">
      <h2>Какие тарифы покупают?</h2>
      {total === 0 ? <div className="empty">За период первых покупок нет</div> : (
        <>
          {d.topTariff && <div className="top-tariff"><TrendingUp size={18} /> Самый популярный: <b>{d.topTariff.title}</b> — {pctf(d.topTariff.pct)} всех покупок</div>}
          <div className="donut-row">
            <Donut items={items} selected={sel} onSelect={setSel} center={s ? <><b>{pctf(s.pct)}</b><span>{s.title}</span></> : <><b>{num(total)}</b><span>покупок</span></>} />
          </div>
          <div className="legend">
            {d.tariffs.map((t: any, i: number) => (
              <button key={t.id} className={`legend-row${sel === t.id ? ' on' : ''}`} onClick={() => setSel(sel === t.id ? null : t.id)}>
                <i style={{ background: TARIFF_COLORS[i % TARIFF_COLORS.length] }} />
                <span className="grow"><b>{t.title}</b><em>{num(t.count)} {plural(t.count, 'покупка', 'покупки', 'покупок')} · {rub(t.revenue)}</em></span>
                <b>{pctf(t.pct)}</b>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/* ───────── 6. Удержание ───────── */

function Retention({ d }: { d: any }) {
  const [sel, setSel] = useState<string | null>(null);
  const [cohort, setCohort] = useState<string | null>(null);
  return (
    <section className="block">
      <h2>Удержание участников</h2>
      <p className="sub">Считаем только тех, у кого оплаченный период уже закончился (или кто продлил досрочно).</p>
      {d.due === 0 ? <div className="empty">Пока ни у кого не закончился оплаченный период — продления появятся после первого месяца.</div> : (
        <div className="donut-row">
          <Donut size={160} selected={sel} onSelect={setSel} items={[{ key: 'r', label: 'Продлили', value: d.renewed, color: C.accent }, { key: 'n', label: 'Не продлили', value: d.notRenewed, color: C.gray }]}
            center={sel === 'n' ? <><b>{pctf(d.churnPct)}</b><span>не продлили</span></> : <><b>{pctf(d.renewedPct)}</b><span>продлили</span></>} />
          <div className="legend compact">
            <div className="legend-row"><i style={{ background: C.accent }} /><span className="grow"><b>Продлили</b><em>{num(d.renewed)} из {num(d.due)}</em></span></div>
            <div className="legend-row"><i style={{ background: C.gray }} /><span className="grow"><b>Не продлили</b><em>{num(d.notRenewed)} · отток {pctf(d.churnPct)}</em></span></div>
          </div>
        </div>
      )}
      <div className="mini-grid">
        <div><span>Активные подписки</span><b>{num(d.liveSubscriptions)}</b></div>
        <div><span>Отменили автопродление</span><b>{num(d.canceling)}</b><em>доступ до конца периода</em></div>
        <div><span>Долг по списанию</span><b>{num(d.pastDue)}</b></div>
        <div><span>Неуспешных списаний</span><b>{num(d.failedCharges)}</b><em>за всё время</em></div>
      </div>
      {d.trend.length > 0 && (
        <>
          <h3>Продления по месяцам</h3>
          <Bars labels={d.trend.map((t: any) => monthLabel(t.month))} values={d.trend.map((t: any) => t.pct)} hint={(i) => `${d.trend[i].renewed} из ${d.trend[i].due}`} />
        </>
      )}
      {d.cohorts.length > 0 && (
        <>
          <h3>Когорты по месяцу вступления</h3>
          <div className="list">
            {d.cohorts.map((c: any) => (
              <div key={c.month} className="cohort">
                <button className="cohort-head" onClick={() => setCohort(cohort === c.month ? null : c.month)}>
                  <span className="grow"><b>{monthLabel(c.month, true)}</b><em>{num(c.size)} чел.</em></span>
                  <span className="cohort-mini">{c.cells.filter((x: any) => x !== null).slice(1, 4).map((x: number, i: number) => <i key={i} style={{ opacity: 0.25 + (x / 100) * 0.75 }} />)}</span>
                  <ChevronDown size={18} className={cohort === c.month ? 'rot' : ''} />
                </button>
                {cohort === c.month && (
                  <div className="cohort-body">
                    {c.cells.map((x: number | null, k: number) => (
                      <div key={k} className="cohort-cell"><span>{k + 1}-й месяц</span><div className="fbar"><i style={{ width: `${x ?? 0}%`, opacity: x === null ? 0 : 1 }} /></div><b>{x === null ? 'ещё не наступил' : pctf(x)}</b></div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/* ───────── 7. Участники ───────── */

function Members() {
  const [flowId, setFlowId] = useState('');
  const s = useLoad(() => api(`/admin-api/home/members${flowId ? `?flowId=${flowId}` : ''}`), [flowId]);
  return (
    <section className="block">
      <h2>Участники клуба</h2>
      <Block s={s} h={200}>{(d: any) => (
        <>
          <div className="mini-grid">
            <div><span>Всего участников</span><b>{num(d.total)}</b></div>
            <div><span>Сейчас участвуют</span><b>{num(d.activeNow)}</b></div>
            <div><span>Начнут следующий поток</span><b>{num(d.upcoming)}</b></div>
          </div>
          {d.flow && (
            <>
              <label className="f">Поток
                <select value={d.flow.id} onChange={(e) => setFlowId(e.target.value)}>{d.flows.map((f: any) => <option key={f.id} value={f.id}>{f.title}</option>)}</select>
              </label>
              <div className="mini-grid">
                <div><span>В потоке</span><b>{num(d.inFlow)}</b></div>
                <div><span>Завершили челлендж</span><b>{num(d.finished)}</b></div>
                <div><span>С пропусками отчётов</span><b>{num(d.withMisses)}</b></div>
                <div><span>Без пропусков</span><b>{num(d.perfect)}</b><em>{pctf(d.perfectPct)} начавших</em></div>
              </div>
              <div className="goal-card">
                <span>Достигли цели</span>
                <b>{num(d.achieved)}</b>
                <em>{d.assessed ? `${pctf(d.achievedPct)} от ${num(d.assessed)} ${plural(d.assessed, 'участницы', 'участниц', 'участниц')}, подводивших итоги` : 'итоги ещё не подводили'}</em>
              </div>
            </>
          )}
        </>
      )}</Block>
    </section>
  );
}

/** Главная: за несколько секунд — сколько пришло → сколько оплатило → сколько заработали → сколько осталось */
export function Home() {
  const [p, setP] = usePeriod();
  const q = periodQuery(p);
  const funnel = useLoad(() => api(`/admin-api/home/funnel?${q}`), [q]);
  const money = useLoad(() => api(`/admin-api/home/money?${q}`), [q]);
  const ret = useLoad(() => api(`/admin-api/home/retention?${q}`), [q]);
  return (
    <div className="home">
      <h1 className="page-title">Аналитика клуба</h1>
      <PeriodPicker value={p} onChange={setP} />
      <Block s={funnel} h={170}>{(d: any) => <Hero d={d} />}</Block>
      <Block s={funnel} h={260}>{(d: any) => (
        <div className="kpi-grid">
          <Kpi title="Открыли бота" count={d.cards.bot.count} change={d.cards.bot.change} />
          <Kpi title="Открыли приложение" count={d.cards.app.count} of={d.cards.app.ofPrev} ofText="от открывших бота" change={d.cards.app.change} />
          <Kpi title="Дошли до тарифов" count={d.cards.tariffs.count} of={d.cards.tariffs.ofPrev} ofText="от открывших приложение" change={d.cards.tariffs.change} />
          <Kpi title="Оплатили" count={d.cards.paid.count} of={d.cards.paid.ofPrev} ofText="от дошедших до тарифов" change={d.cards.paid.change} />
        </div>
      )}</Block>
      <Block s={funnel} h={420}>{(d: any) => <FunnelBlock d={d} />}</Block>
      <Block s={funnel} h={260}>{(d: any) => <Dynamics d={d} />}</Block>
      <Block s={money} h={420}>{(d: any) => <Money d={d} />}</Block>
      <Block s={money} h={300}>{(d: any) => <TariffsBlock d={d} />}</Block>
      <Block s={ret} h={300}>{(d: any) => <Retention d={d} />}</Block>
      <Members />
      <div className="foot-links">
        <Link to="/more/insights"><Wallet size={16} /> Цели, анкеты, трекеры, рефералы</Link>
        <Link to="/funnel"><Users size={16} /> Экраны и retention приложения</Link>
      </div>
    </div>
  );
}
