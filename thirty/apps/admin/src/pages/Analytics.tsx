import { useState } from 'react';
import { api, rub } from '../api';
import { DateRange, View, defaultRange, useLoad } from '../ui';

const K = ({ v, t }: { v: React.ReactNode; t: string }) => <div className="kpi"><b>{v}</b><span>{t}</span></div>;

/** A01 */
export function Dashboard() {
  const [r, setR] = useState(defaultRange());
  const s = useLoad(() => api(`/admin-api/dashboard?from=${r.from}&to=${r.to}`), [r.from, r.to]);
  return (
    <>
      <h1>Дашборд</h1>
      <DateRange from={r.from} to={r.to} onChange={(from, to) => setR({ from, to })} />
      <br />
      <View s={s}>{(d: any) => (
        <>
          <h2>Аудитория</h2>
          <div className="kpis"><K v={d.dau} t="DAU" /><K v={d.wau} t="WAU" /><K v={d.mau} t="MAU" /><K v={d.activeMembers} t="Активных участников потока" /></div>
          <h2>Деньги</h2>
          <div className="kpis">
            <K v={rub(d.mrr)} t="MRR (нормализованный)" /><K v={rub(d.revenue)} t={`Выручка за период (${d.payments} платежей)`} /><K v={rub(d.refunds.amount)} t={`Возвраты (${d.refunds.count})`} />
            <K v={d.liveSubscriptions} t={`Живые подписки: 1м ${d.subscriptionsByTariff.m1} · 3м ${d.subscriptionsByTariff.m3} · 6м ${d.subscriptionsByTariff.m6}`} />
            <K v={`${d.renewals.success} / ${d.renewals.failed}`} t="Продления: успешные / неуспешные" /><K v={d.pastDue} t="Долг по продлению" /><K v={d.churn} t="Отмены автопродления" /><K v={d.needsRefund} t="Ждут возврата (повторная оплата)" />
          </div>
          <h2>Дисциплина и сообщество</h2>
          <div className="kpis">
            <K v={d.reports} t="Отчётов за период" /><K v={d.reportsPerActive} t="Отчётов на активного" /><K v={d.perfectSoFar} t="Идут без пропусков" /><K v={d.prizeCandidatesAwaiting} t="Претенденты ждут проверки" />
            <K v={d.meetingClicks} t="Переходов на созвоны" /><K v={`${d.reviews} / ${d.casesAllowed}`} t="Отзывы / разрешённые кейсы" /><K v={`${d.cardsGenerated} / ${d.shareClicks}`} t="Карточки / клики «поделиться»" /><K v={d.complaintsOpen} t="Открытые жалобы" />
          </div>
          <p className="muted">Публикации во внешних соцсетях приложение не видит — учитываются только генерации карточек и клики «Поделиться».</p>
        </>
      )}</View>
    </>
  );
}

/** A02: воронка по когорте, экраны, retention */
export function Funnel() {
  const [r, setR] = useState(defaultRange());
  const [f, setF] = useState({ tariff: '', variant: '', device: '' });
  const q = `from=${r.from}&to=${r.to}&tariff=${f.tariff}&variant=${encodeURIComponent(f.variant)}&device=${f.device}`;
  const funnel = useLoad(() => api(`/admin-api/analytics/funnel?${q}`), [q]);
  const screens = useLoad(() => api(`/admin-api/analytics/screens?from=${r.from}&to=${r.to}`), [r.from, r.to]);
  const ret = useLoad(() => api(`/admin-api/analytics/retention?from=${r.from}&to=${r.to}`), [r.from, r.to]);
  return (
    <>
      <h1>Воронка и экраны</h1>
      <div className="card row">
        <DateRange from={r.from} to={r.to} onChange={(from, to) => setR({ from, to })} />
        <label className="f">Тариф<select value={f.tariff} onChange={(e) => setF({ ...f, tariff: e.target.value })}><option value="">Все</option><option value="m1">1 месяц</option><option value="m3">3 месяца</option><option value="m6">6 месяцев</option></select></label>
        <label className="f">Вариант A/B<input value={f.variant} placeholder="exp:variant" onChange={(e) => setF({ ...f, variant: e.target.value })} /></label>
        <label className="f">Устройство<select value={f.device} onChange={(e) => setF({ ...f, device: e.target.value })}><option value="">Все</option><option value="ios">iOS</option><option value="android">Android</option><option value="desktop">Desktop</option></select></label>
        <a className="btn light" href={`/admin-api/export/events?from=${r.from}&to=${r.to}`}>Экспорт событий CSV</a>
      </div>
      <div className="card">
        <h2>Сквозная воронка (когорта: первое открытие в периоде)</h2>
        <View s={funnel}>{(d: any) => (
          <>
            <table>
              <thead><tr><th>Шаг</th><th>Пользователей</th><th>% от пред.</th><th>% от входа</th><th>Отвал</th><th>Медиана до след. шага</th><th style={{ width: 200 }} /></tr></thead>
              <tbody>{d.steps.map((s: any) => (
                <tr key={s.key}><td>{s.title}</td><td><b>{s.count}</b></td><td>{s.pctPrev}%</td><td>{s.pctStart}%</td><td>{s.dropOff}</td><td>{s.medianMinToNext === null ? '—' : `${s.medianMinToNext} мин`}</td><td><div className="bar"><i style={{ width: `${s.pctStart}%` }} /></div></td></tr>
              ))}</tbody>
            </table>
            <p>Клики по тарифам: 1 мес — <b>{d.tariffClicks.m1 ?? 0}</b>, 3 мес — <b>{d.tariffClicks.m3 ?? 0}</b>, 6 мес — <b>{d.tariffClicks.m6 ?? 0}</b></p>
          </>
        )}</View>
      </div>
      <div className="card">
        <h2>Экраны: просмотры, время, уходы, ошибки</h2>
        <View s={screens}>{(rows: any[]) => (
          <table><thead><tr><th>Экран</th><th>Просмотры</th><th>Уникальные</th><th>Среднее время</th><th>Последний экран сессии</th><th>Drop-off</th><th>Ошибки</th></tr></thead>
            <tbody>{rows.map((s) => <tr key={s.screen}><td>{s.screen}</td><td>{s.views}</td><td>{s.users}</td><td>{s.avgSeconds === null ? '—' : `${s.avgSeconds} с`}</td><td>{s.exits}</td><td>{s.dropOffPct}%</td><td>{s.errors}</td></tr>)}</tbody></table>
        )}</View>
      </div>
      <div className="card">
        <h2>Retention по дате первого открытия</h2>
        <View s={ret}>{(rows: any[]) => (
          <table><thead><tr><th>Когорта</th><th>Размер</th><th>D1</th><th>D7</th><th>D14</th><th>D30</th></tr></thead>
            <tbody>{rows.map((x) => <tr key={x.cohort}><td>{x.cohort}</td><td>{x.size}</td><td>{x.d1}%</td><td>{x.d7}%</td><td>{x.d14}%</td><td>{x.d30}%</td></tr>)}</tbody></table>
        )}</View>
      </div>
    </>
  );
}
