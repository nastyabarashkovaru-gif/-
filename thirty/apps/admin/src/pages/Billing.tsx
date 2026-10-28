import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dt, rub, d } from '../api';
import { Sheet, Status, View, act, useLoad, withReason } from '../ui';
import { PaymentRow, STATUS_RU } from './Home';

/** A03: тарифы, обычные/акционные цены, сравнительная цена, ценность S05 */
export function Tariffs() {
  const s = useLoad(() => api('/admin-api/tariffs'));
  const [edit, setEdit] = useState<Record<string, any>>({});
  const save = async (id: string) => {
    const e = edit[id];
    const body: any = {};
    for (const k of ['promoPrice', 'regularPrice', 'comparisonMonthPrice', 'renewalPrice']) if (e[k] !== undefined) body[k] = e[k] === '' ? null : Number(e[k]);
    if (e.goalLimit !== undefined) body.goalLimit = e.goalLimit === '' ? null : Number(e.goalLimit);
    if (e.features !== undefined) body.features = String(e.features).split('\n').map((x: string) => x.trim()).filter(Boolean);
    for (const k of ['highlighted', 'active']) if (e[k] !== undefined) body[k] = e[k];
    if (e.badge !== undefined) body.badge = e.badge || null;
    if (await act(() => api(`/admin-api/tariffs/${id}`, { method: 'PATCH', body }))) { setEdit({ ...edit, [id]: undefined }); s.reload(); }
  };
  return (
    <>
      <h1>Тарифы и ценность</h1>
      <p className="muted">Продление идёт по цене покупки: акционной или обычной. Перечёркнутая цена = месяцы × базовая цена месяца и подписывается как «стоимость отдельных месяцев».</p>
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
                  {[['promoPrice', 'Акционная, ₽'], ['regularPrice', 'После таймера, ₽'], ['comparisonMonthPrice', 'Базовая цена месяца, ₽'], ['goalLimit', 'Лимит целей (пусто — без лимита)'], ['badge', 'Бейдж']].map(([k, l]) => (
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
      <h2>Экран «Что ты получишь внутри клуба?» (онбординг, шаг 3)</h2>
      <p className="muted">Цены в приложении сейчас не показываются — только название и пояснение.</p>
      <table><thead><tr><th>Вкл.</th><th>Эмодзи</th><th>Название</th><th>Пояснение (мелким текстом)</th><th>Подробнее (по нажатию)</th><th>Цена, ₽</th><th>Подпись цены</th><th /></tr></thead>
        <tbody>{list.map((i, k) => (
          <tr key={k}>
            <td><input type="checkbox" checked={i.enabled} onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, enabled: e.target.checked } : x)))} /></td>
            <td><input value={i.emoji ?? ''} style={{ width: 50 }} onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, emoji: e.target.value || undefined } : x)))} /></td>
            <td><input value={i.title} onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, title: e.target.value } : x)))} /></td>
            <td><input value={i.description ?? ''} placeholder="по умолчанию" onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, description: e.target.value || undefined } : x)))} /></td>
            <td><textarea value={i.details ?? ''} placeholder="как пояснение" style={{ minHeight: 60 }} onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, details: e.target.value || undefined } : x)))} /></td>
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
  const [f, setF] = useState({ from: '', to: '', tariff: '', kind: '', status: '', test: '0' });
  const [sel, setSel] = useState<any>(null);
  const [showRec, setShowRec] = useState(false);
  const q = new URLSearchParams(f).toString();
  const list = useLoad(() => api(`/admin-api/payments?${q}`), [q]);
  const rec = useLoad(() => api('/admin-api/payments/reconcile'));
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const KIND: Record<string, string> = { initial: 'Первая покупка', renewal: 'Продление', debt: 'Продление (долг)', upsell: 'Доп. покупка' };
  const rows = (list.data ?? []).map((p: any) => ({ ...p, at: p.paidAt ?? p.createdAt, name: p.userName, userId: p.userId, tariff: p.tariffId ? `${p.tariffId.replace('m', '')} мес` : '—', kindTitle: KIND[p.kind] ?? p.kind }));
  const paidSum = rows.filter((p: any) => p.status === 'paid' && !p.test).reduce((a: number, p: any) => a + p.amount, 0);
  const issues = rec.data ? rec.data.needsRefund.length + rec.data.stuckPending.length + rec.data.webhookErrors.length + rec.data.chargeDateSyncErrors.length + rec.data.disputed.length : 0;
  return (
    <>
      <h1 className="page-title">Все оплаты</h1>
      <div className="filters">
        <label className="f">С<input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></label>
        <label className="f">По<input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></label>
        <label className="f">Тариф<select value={f.tariff} onChange={(e) => set('tariff', e.target.value)}><option value="">Все</option><option value="m1">1 месяц</option><option value="m3">3 месяца</option><option value="m6">6 месяцев</option></select></label>
        <label className="f">Тип<select value={f.kind} onChange={(e) => set('kind', e.target.value)}><option value="">Все</option><option value="initial">Первая покупка</option><option value="renewal">Продление</option><option value="upsell">Доп. покупка</option></select></label>
        <label className="f">Статус<select value={f.status} onChange={(e) => set('status', e.target.value)}><option value="">Все</option>{Object.entries(STATUS_RU).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}</select></label>
        <label className="f">Тестовые<select value={f.test} onChange={(e) => set('test', e.target.value)}><option value="0">Скрыть</option><option value="">Показать</option><option value="1">Только тестовые</option></select></label>
      </div>
      <div className="money-hero small"><span>Оплачено по фильтру</span><b>{rub(paidSum)}</b><em>{rows.length} платежей в списке (до 100 последних)</em></div>
      <View s={list}>{() => (rows.length ? <div className="list">{rows.map((p: any) => <PaymentRow key={p.id} p={p} onClick={() => setSel(p)} />)}</div> : <div className="empty">Платежей нет</div>)}</View>
      {sel && (
        <Sheet open onClose={() => setSel(null)} title={rub(sel.amount)}>
          <div className="detail-list">
            <div><span>Участник</span><b><Link to={`/users/${sel.userId}`}>{sel.name}</Link></b></div>
            <div><span>Создан</span><b>{dt(sel.createdAt)}</b></div>
            <div><span>Оплачен</span><b>{dt(sel.paidAt)}</b></div>
            <div><span>Тариф</span><b>{sel.tariff}</b></div>
            <div><span>Тип</span><b>{sel.kindTitle}</b></div>
            <div><span>Статус</span><b>{(STATUS_RU[sel.status] ?? [sel.status])[0]}{sel.needsRefund ? ' · нужен возврат' : ''}</b></div>
            <div><span>Покрывает</span><b>{d(sel.coversFromFlow)}{sel.months ? ` × ${sel.months} мес` : ''}</b></div>
            {sel.failureReason && <div><span>Причина</span><b>{sel.failureReason}</b></div>}
            <div><span>Тестовая</span><b>{sel.test ? 'да — не входит в выручку' : 'нет'}</b></div>
          </div>
          <div className="col">
            {sel.status === 'paid' && <button className="btn big light" onClick={async () => { if (await withReason('Отметить возврат (деньги возвращаются в кабинете CloudPayments)', (reason) => api(`/admin-api/payments/${sel.id}/refund`, { body: { reason } }))) { setSel(null); list.reload(); } }}>Отметить возврат</button>}
            {(sel.status === 'paid' || sel.status === 'refunded') && <button className="btn big light" onClick={async () => { await api(`/admin-api/payments/${sel.id}/test`, { body: { test: !sel.test } }); setSel(null); list.reload(); }}>{sel.test ? 'Это настоящая оплата' : 'Пометить как тестовую'}</button>}
          </div>
        </Sheet>
      )}
      <button className={`rec-toggle${issues ? ' alert' : ''}`} onClick={() => setShowRec(!showRec)}>Сверка с платёжной системой{issues ? ` · требует внимания: ${issues}` : ' · всё в порядке'}</button>
      {showRec && (
        <View s={rec}>{(r: any) => (
          <div className="mini-grid">
            <div><span>Повторные оплаты — вернуть в кабинете CloudPayments</span><b>{r.needsRefund.length}</b></div>
            <div><span>Зависли в ожидании</span><b>{r.stuckPending.length}</b></div>
            <div><span>Ошибки уведомлений</span><b>{r.webhookErrors.length}</b></div>
            <div><span>Не перенесена дата списания</span><b>{r.chargeDateSyncErrors.length}</b></div>
            <div><span>Расхождение суммы</span><b>{r.disputed.length}</b></div>
          </div>
        )}</View>
      )}
      <a className="btn big light" href="/admin-api/export/payments">Выгрузить платежи в CSV</a>
    </>
  );
}
