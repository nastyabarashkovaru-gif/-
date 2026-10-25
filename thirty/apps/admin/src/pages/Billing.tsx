import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dt, rub, d } from '../api';
import { Status, View, act, useLoad, withReason } from '../ui';

/** A03: тарифы, обычные/акционные цены, сравнительная цена, id подписок Prodamus, ценность S05 */
export function Tariffs() {
  const s = useLoad(() => api('/admin-api/tariffs'));
  const [edit, setEdit] = useState<Record<string, any>>({});
  const save = async (id: string) => {
    const e = edit[id];
    const body: any = {};
    for (const k of ['promoPrice', 'regularPrice', 'comparisonMonthPrice', 'renewalPrice', 'prodamusSubscriptionPromo', 'prodamusSubscriptionRegular']) if (e[k] !== undefined) body[k] = e[k] === '' ? null : Number(e[k]);
    if (e.goalLimit !== undefined) body.goalLimit = e.goalLimit === '' ? null : Number(e.goalLimit);
    if (e.features !== undefined) body.features = String(e.features).split('\n').map((x: string) => x.trim()).filter(Boolean);
    for (const k of ['highlighted', 'active']) if (e[k] !== undefined) body[k] = e[k];
    if (e.badge !== undefined) body.badge = e.badge || null;
    if (await act(() => api(`/admin-api/tariffs/${id}`, { method: 'PATCH', body }))) { setEdit({ ...edit, [id]: undefined }); s.reload(); }
  };
  return (
    <>
      <h1>Тарифы и ценность</h1>
      <p className="muted">Продление идёт по цене покупки: акционной или обычной — поэтому суммы подписок в кабинете Prodamus должны совпадать с этими ценами. Перечёркнутая цена = месяцы × базовая цена месяца и подписывается как «стоимость отдельных месяцев».</p>
      <View s={s}>{(data: any) => (
        <>
          {data.tariffs.map((t: any) => {
            const e = edit[t.id] ?? {};
            const val = (k: string) => (e[k] !== undefined ? e[k] : t[k] ?? '');
            const set = (k: string, v: any) => setEdit({ ...edit, [t.id]: { ...e, [k]: v } });
            return (
              <div className="card" key={t.id}>
                <h2>{t.title} <span className="muted">({t.id}, {t.months} мес.)</span></h2>
                <div className="row">
                  {[['promoPrice', 'Акционная, ₽'], ['regularPrice', 'После таймера, ₽'], ['comparisonMonthPrice', 'Базовая цена месяца, ₽'], ['goalLimit', 'Лимит целей (пусто — без лимита)'], ['prodamusSubscriptionPromo', 'ID подписки Prodamus (акция)'], ['prodamusSubscriptionRegular', 'ID подписки Prodamus (обычная)'], ['badge', 'Бейдж']].map(([k, l]) => (
                    <label className="f" key={k}>{l}<input value={val(k)} onChange={(x) => set(k, x.target.value)} style={{ width: 150 }} /></label>
                  ))}
                  <label className="f">Выделить<input type="checkbox" checked={Boolean(val('highlighted'))} onChange={(x) => set('highlighted', x.target.checked)} /></label>
                  <label className="f">Активен<input type="checkbox" checked={Boolean(val('active'))} onChange={(x) => set('active', x.target.checked)} /></label>
                </div>
                <label className="f" style={{ marginTop: 10 }}>Состав тарифа (по строке)<textarea value={e.features !== undefined ? e.features : (t.features as string[]).join('\n')} onChange={(x) => set('features', x.target.value)} /></label>
                <button className="btn" disabled={!edit[t.id]} onClick={() => save(t.id)}>Сохранить</button>
              </div>
            );
          })}
          <ValueItems items={data.value} reload={s.reload} />
        </>
      )}</View>
    </>
  );
}

function ValueItems({ items, reload }: { items: any[]; reload: () => void }) {
  const [list, setList] = useState(items);
  return (
    <div className="card">
      <h2>Экран «Что входит в клуб» (онбординг, шаг 3)</h2>
      <p className="muted">Цены в приложении сейчас не показываются — только название и пояснение.</p>
      <table><thead><tr><th>Вкл.</th><th>Эмодзи</th><th>Название</th><th>Пояснение (мелким текстом)</th><th>Цена, ₽</th><th>Подпись цены</th><th /></tr></thead>
        <tbody>{list.map((i, k) => (
          <tr key={k}>
            <td><input type="checkbox" checked={i.enabled} onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, enabled: e.target.checked } : x)))} /></td>
            <td><input value={i.emoji ?? ''} style={{ width: 50 }} onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, emoji: e.target.value || undefined } : x)))} /></td>
            <td><input value={i.title} onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, title: e.target.value } : x)))} /></td>
            <td><input value={i.description ?? ''} placeholder="по умолчанию" onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, description: e.target.value || undefined } : x)))} /></td>
            <td><input type="number" value={i.price} onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, price: Number(e.target.value) } : x)))} /></td>
            <td><input value={i.priceLabel ?? ''} onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, priceLabel: e.target.value || undefined } : x)))} /></td>
            <td><button className="btn light" onClick={() => setList(list.filter((_, j) => j !== k))}>Удалить</button></td>
          </tr>
        ))}</tbody></table>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="btn light" onClick={() => setList([...list, { id: `v${Date.now()}`, title: '', price: 0, enabled: false }])}>Добавить</button>
        <button className="btn" onClick={async () => { if (await act(() => api('/admin-api/value-items', { method: 'PUT', body: list }))) reload(); }}>Сохранить</button>
        <span className="muted">Итого включено: {list.filter((x) => x.enabled).reduce((a, x) => a + x.price, 0).toLocaleString('ru-RU')} ₽</span>
      </div>
    </div>
  );
}

/** A04: платежи, возвраты, сверка */
export function Payments() {
  const [status, setStatus] = useState('');
  const list = useLoad(() => api(`/admin-api/payments?status=${status}`), [status]);
  const rec = useLoad(() => api('/admin-api/payments/reconcile'));
  return (
    <>
      <h1>Платежи</h1>
      <div className="card">
        <h2>Сверка</h2>
        <View s={rec}>{(r: any) => (
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="kpi"><b>{r.needsRefund.length}</b><span>Повторные оплаты — оформить возврат в кабинете Prodamus</span></div>
            <div className="kpi"><b>{r.stuckPending.length}</b><span>Зависли в pending</span></div>
            <div className="kpi"><b>{r.webhookErrors.length}</b><span>Ошибки webhook / подписи</span></div>
            <div className="kpi"><b>{r.chargeDateSyncErrors.length}</b><span>Не перенесена дата списания</span></div>
            <div className="kpi"><b>{r.disputed.length}</b><span>Расхождение суммы</span></div>
          </div>
        )}</View>
      </div>
      <div className="card">
        <div className="row"><label className="f">Статус<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Все</option>{['initiated', 'pending', 'paid', 'failed', 'refunded', 'disputed'].map((x) => <option key={x}>{x}</option>)}</select></label>
          <a className="btn light" href="/admin-api/export/payments">CSV</a></div>
        <View s={list}>{(rows: any[]) => (
          <table><thead><tr><th>Дата</th><th>Пользователь</th><th>Вид</th><th>Тариф</th><th>Сумма</th><th>Статус</th><th>Покрывает</th><th /></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id}>
                <td>{dt(p.createdAt)}</td><td><Link to={`/users/${p.userId}`}>{p.userName}</Link></td><td>{p.kind}</td><td>{p.tariffId}</td><td>{rub(p.amount)}</td>
                <td><Status v={p.status} /> {p.needsRefund && <span className="pill err">нужен возврат</span>}</td><td>{d(p.coversFromFlow)} {p.months ? `× ${p.months}` : ''}</td>
                <td>{p.status === 'paid' && <button className="btn light" onClick={async () => { if (await withReason('Отметить возврат (деньги возвращаются в кабинете Prodamus)', (reason) => api(`/admin-api/payments/${p.id}/refund`, { body: { reason } }))) list.reload(); }}>Возврат</button>}</td>
              </tr>
            ))}</tbody></table>
        )}</View>
      </div>
    </>
  );
}
