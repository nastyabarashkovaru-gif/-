import { useState } from 'react';
import { api, dt } from '../api';
import { Modal, Status, View, act, useLoad } from '../ui';

/** A13: отзывы и кейсы */
export function Reviews() {
  const [f, setF] = useState({ trigger: '', allowed: '', category: '' });
  const s = useLoad(() => api(`/admin-api/reviews?trigger=${f.trigger}&allowed=${f.allowed}&category=${f.category}`), [f.trigger, f.allowed, f.category]);
  return (
    <>
      <h1>Отзывы и кейсы</h1>
      <div className="card row">
        <label className="f">Повод<select value={f.trigger} onChange={(e) => setF({ ...f, trigger: e.target.value })}><option value="">Все</option><option value="day14">14-й день</option><option value="final">Финал</option><option value="meeting">После созвона</option></select></label>
        <label className="f">Категория цели<select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="">Все</option>{['money', 'weightloss', 'blog', 'english', 'habits', 'selfdev'].map((c) => <option key={c}>{c}</option>)}</select></label>
        <label className="f">Публикация<select value={f.allowed} onChange={(e) => setF({ ...f, allowed: e.target.value })}><option value="">Все</option><option value="1">Только с разрешением</option></select></label>
        <a className="btn light" href="/admin-api/export/reviews">CSV разрешённых</a>
      </div>
      <View s={s}>{(rows: any[]) => rows.map((r) => (
        <div className="card" key={r.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{r.name} · {r.rating ?? '—'}/10 · {r.trigger} · {dt(r.createdAt)}</b>
            <div className="row">
              {r.allowText && !r.consentRevokedAt && <span className="pill ok">текст</span>}{r.allowPhoto && !r.consentRevokedAt && <span className="pill ok">фото</span>}{r.allowName && !r.consentRevokedAt && <span className="pill ok">имя</span>}{r.consentRevokedAt && <span className="pill err">согласие отозвано</span>}
              <button className="btn light" onClick={async () => { if (await act(() => api(`/admin-api/reviews/${r.id}/feature`, { body: { featured: !r.featured } }))) s.reload(); }}>{r.featured ? 'Убрать из кейсов' : 'В кейсы'}</button>
            </div>
          </div>
          <div className="muted">{r.categories.join(', ')} · {r.emotions.join(', ')}</div>
          {r.changes && <p>{r.changes}</p>}{r.result && <p><b>Результат:</b> {r.result}</p>}
          <div className="thumbs">{r.media.map((m: string) => <a key={m} href={m} target="_blank" rel="noreferrer"><img src={m} alt="" /></a>)}</div>
        </div>
      ))}</View>
    </>
  );
}

/** A14: шаблоны бота, выключатели, лимиты, статистика отправок/кликов/конверсий */
export function Bot() {
  const s = useLoad(() => api('/admin-api/bot/templates'));
  const [edit, setEdit] = useState<any>(null);
  return (
    <>
      <h1>Сообщения бота</h1>
      <div className="card muted">Тексты — предложения на согласование. Рекламные цепочки (B02, B04–B09) выключены, пока вы их не утвердите и не включите. Рекламные сообщения уходят только пользователям с согласием и содержат отписку /stop.</div>
      <View s={s}>{(rows: any[]) => (
        <div className="card"><table><thead><tr><th>Шаблон</th><th>Вкл.</th><th>Утв.</th><th>Реклама</th><th>Задержка</th><th>Лимит</th><th>Отправлено</th><th>Ошибки</th><th>Клики</th><th>Конверсии</th><th /></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.key}><td><b>{t.title}</b><div className="muted">{t.key}</div></td><td>{t.enabled ? '✅' : '—'}</td><td>{t.approved ? '✅' : <span className="pill warn">черновик</span>}</td><td>{t.isMarketing ? 'да' : ''}</td><td>{t.delayMinutes} мин</td><td>{t.capHours} ч</td>
              <td>{t.stats.sent}</td><td>{t.stats.failed}</td><td>{t.stats.clicks}</td><td>{t.stats.conversions}</td><td><button className="btn light" onClick={() => setEdit({ ...t, buttonsText: JSON.stringify(t.buttons) })}>Изменить</button></td></tr>
          ))}</tbody></table></div>
      )}</View>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.title ?? ''}>
        {edit && (
          <div style={{ display: 'grid', gap: 8 }}>
            <label className="f">Текст (жирный: {'<b>текст</b>'}; переменные в {'{скобках}'})<textarea style={{ minHeight: 140 }} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} /></label>
            <label className="f">Картинка (URL, необязательно; {'{public_url}'} — адрес приложения)<input value={edit.imageUrl ?? ''} onChange={(e) => setEdit({ ...edit, imageUrl: e.target.value })} /></label>
            <label className="f">Кнопки (JSON: [{'{"text":"…","screen":"tariffs"}'}])<input value={edit.buttonsText} onChange={(e) => setEdit({ ...edit, buttonsText: e.target.value })} /></label>
            <div className="row">
              <label className="f">Задержка, мин<input type="number" value={edit.delayMinutes} onChange={(e) => setEdit({ ...edit, delayMinutes: Number(e.target.value) })} /></label>
              <label className="f">Не чаще раза в, ч<input type="number" value={edit.capHours} onChange={(e) => setEdit({ ...edit, capHours: Number(e.target.value) })} /></label>
              <label className="f">Приоритет<input type="number" value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: Number(e.target.value) })} /></label>
            </div>
            <div className="row">
              <label><input type="checkbox" checked={edit.enabled} onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })} /> Включён</label>
              <label><input type="checkbox" checked={edit.approved} onChange={(e) => setEdit({ ...edit, approved: e.target.checked })} /> Текст утверждён</label>
              <label><input type="checkbox" checked={edit.isMarketing} onChange={(e) => setEdit({ ...edit, isMarketing: e.target.checked })} /> Рекламное (нужно согласие)</label>
            </div>
            <div className="row">
              <button className="btn" onClick={async () => {
                let buttons;
                try { buttons = JSON.parse(edit.buttonsText); } catch { return alert('Кнопки: неверный JSON'); }
                if (await act(() => api(`/admin-api/bot/templates/${edit.key}`, { method: 'PATCH', body: { text: edit.text, buttons, delayMinutes: edit.delayMinutes, capHours: edit.capHours, priority: edit.priority, enabled: edit.enabled, approved: edit.approved, isMarketing: edit.isMarketing, imageUrl: edit.imageUrl?.trim() || null } }))) { setEdit(null); s.reload(); }
              }}>Сохранить</button>
              <button className="btn light" onClick={async () => { const userId = prompt('Telegram ID получателя теста'); if (userId) { const r = await api(`/admin-api/bot/templates/${edit.key}/test`, { body: { userId } }).catch((e) => ({ result: e.message })); alert(`Результат: ${r.result}`); } }}>Тестовая отправка</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/** A15: апселлы — выключены, пока не утверждены объём, сроки и критерии допуска */
export function Upsells() {
  const s = useLoad(() => api('/admin-api/upsells'));
  return (
    <>
      <h1>Апселлы</h1>
      <View s={s}>{(d: any) => (
        <>
          {d.items.map((u: any) => <UpsellEditor key={u.code} u={u} reload={s.reload} />)}
          <div className="card"><h2>Заявки</h2><table><tbody>{d.requests.map((r: any) => <tr key={r.id}><td>{dt(r.createdAt)}</td><td>{r.userId}</td><td>{r.code}</td><td>{r.status}</td></tr>)}</tbody></table></div>
        </>
      )}</View>
    </>
  );
}
function UpsellEditor({ u, reload }: { u: any; reload: () => void }) {
  const [x, setX] = useState(u);
  return (
    <div className="card">
      <div className="row">
        <label className="f">Название<input value={x.title} onChange={(e) => setX({ ...x, title: e.target.value })} /></label>
        <label className="f">Цена, ₽<input type="number" value={x.price} onChange={(e) => setX({ ...x, price: Number(e.target.value) })} /></label>
        <label><input type="checkbox" checked={x.active} onChange={(e) => setX({ ...x, active: e.target.checked })} /> Показывать</label>
      </div>
      <label className="f">Описание<textarea value={x.description} onChange={(e) => setX({ ...x, description: e.target.value })} /></label>
      <label className="f">Дисклеймер<input value={x.disclaimer ?? ''} onChange={(e) => setX({ ...x, disclaimer: e.target.value || null })} /></label>
      <button className="btn" onClick={async () => { if (await act(() => api(`/admin-api/upsells/${u.code}`, { method: 'PATCH', body: { title: x.title, price: x.price, description: x.description, disclaimer: x.disclaimer, active: x.active } }))) reload(); }}>Сохранить</button>
    </div>
  );
}

/** A16: настройки, фичефлаги, роли, журнал */
export function Settings({ isOwner }: { isOwner: boolean }) {
  const s = useLoad(() => api('/admin-api/settings'));
  const admins = useLoad(() => (isOwner ? api('/admin-api/admins') : Promise.resolve([])));
  const audit = useLoad(() => api('/admin-api/audit').catch(() => []));
  const [json, setJson] = useState<Record<string, string>>({});
  const [nu, setNu] = useState({ login: '', password: '', role: 'moderator' });
  return (
    <>
      <h1>Настройки и роли</h1>
      <View s={s}>{(d: any) => (
        <div className="card">
          <h2>Фичефлаги</h2>
          <div className="row">{Object.entries(d.features).map(([k, v]) => (
            <label key={k}><input type="checkbox" checked={Boolean(v)} onChange={async (e) => { if (await act(() => api('/admin-api/settings/features', { method: 'PUT', body: { value: { ...d.features, [k]: e.target.checked } } }))) s.reload(); }} /> {k}</label>
          ))}</div>
          <p className="muted">prize_random_draw — не включать без юридического заключения. offer_referral_restore — после утверждения механики.</p>
          <h2>Параметры</h2>
          {['flow.timezone', 'flow.lateJoinUntilDay', 'offer.durationMinutes', 'payment.pendingWindowMinutes', 'support.username', 'chats.inviteTtlHours', 'minAge', 'cases'].map((k) => (
            <div className="row" key={k} style={{ marginBottom: 6 }}>
              <code style={{ width: 230 }}>{k}</code>
              <input style={{ flex: 1 }} value={json[k] ?? JSON.stringify(d[k])} onChange={(e) => setJson({ ...json, [k]: e.target.value })} />
              <button className="btn light" disabled={json[k] === undefined} onClick={async () => {
                let value; try { value = JSON.parse(json[k]); } catch { return alert('Неверный JSON'); }
                if (await act(() => api(`/admin-api/settings/${k}`, { method: 'PUT', body: { value } }))) { setJson({ ...json, [k]: undefined as never }); s.reload(); }
              }}>Сохранить</button>
            </div>
          ))}
        </div>
      )}</View>
      {isOwner && <View s={admins}>{(rows: any[]) => (
        <div className="card">
          <h2>Администраторы</h2>
          <table><thead><tr><th>Логин</th><th>Роль</th><th>2FA</th><th>Активен</th><th>Вход</th><th /></tr></thead>
            <tbody>{rows.map((a) => (
              <tr key={a.id}><td>{a.login}</td>
                <td><select value={a.role} onChange={async (e) => { if (await act(() => api(`/admin-api/admins/${a.id}`, { method: 'PATCH', body: { role: e.target.value } }))) admins.reload(); }}>{['owner', 'admin', 'moderator', 'expert', 'support', 'analyst'].map((r) => <option key={r}>{r}</option>)}</select></td>
                <td>{a.totpEnabled ? 'да' : 'нет'}</td><td>{a.active ? 'да' : 'нет'}</td><td>{dt(a.lastLoginAt)}</td>
                <td className="row"><button className="btn light" onClick={async () => { if (await act(() => api(`/admin-api/admins/${a.id}`, { method: 'PATCH', body: { active: !a.active } }))) admins.reload(); }}>{a.active ? 'Отключить' : 'Включить'}</button><button className="btn light" onClick={async () => { if (await act(() => api(`/admin-api/admins/${a.id}`, { method: 'PATCH', body: { resetMfa: true } }))) admins.reload(); }}>Сбросить 2FA</button></td></tr>
            ))}</tbody></table>
          <div className="row" style={{ marginTop: 10 }}>
            <input placeholder="логин" value={nu.login} onChange={(e) => setNu({ ...nu, login: e.target.value })} />
            <input placeholder="пароль (от 12 символов)" type="password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} />
            <select value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>{['admin', 'moderator', 'expert', 'support', 'analyst', 'owner'].map((r) => <option key={r}>{r}</option>)}</select>
            <button className="btn" onClick={async () => { if (await act(() => api('/admin-api/admins', { body: nu }))) { setNu({ login: '', password: '', role: 'moderator' }); admins.reload(); } }}>Добавить</button>
          </div>
          <p className="muted">Для роли expert создайте профиль эксперта (A12) и свяжите его с этим администратором — эксперт увидит только свои созвоны.</p>
        </div>
      )}</View>}
      <View s={audit}>{(rows: any[]) => (
        <div className="card"><h2>Журнал действий</h2><table><tbody>{rows.map((a) => <tr key={a.id}><td>{dt(a.createdAt)}</td><td>{a.adminId?.slice(0, 8) ?? 'система'}</td><td>{a.action}</td><td>{a.entity} {a.entityId}</td><td>{a.reason}</td></tr>)}</tbody></table></div>
      )}</View>
    </>
  );
}

/** A17: A/B-тесты онбординга и тарифного экрана */
export function Experiments() {
  const s = useLoad(() => api('/admin-api/experiments'));
  const [x, setX] = useState({ key: '', title: '', variants: '[{"key":"a","weight":50},{"key":"b","weight":50}]', active: false });
  return (
    <>
      <h1>A/B-тесты</h1>
      <div className="card muted">Пользователь стабильно получает один вариант; вариант пишется в каждое событие аналитики (experiment_variant) и доступен как фильтр в воронке (формат «ключ:вариант»).</div>
      <View s={s}>{(rows: any[]) => (
        <div className="card"><table><thead><tr><th>Ключ</th><th>Название</th><th>Варианты</th><th>Активен</th><th>Назначения</th></tr></thead>
          <tbody>{rows.map((e) => <tr key={e.key}><td>{e.key}</td><td>{e.title}</td><td>{e.variants.map((v: any) => `${v.key}:${v.weight}`).join(', ')}</td><td><Status v={e.active ? 'active' : 'off'} /></td><td>{e.assignments.map((a: any) => `${a.variant}: ${a.users}`).join(', ')}</td></tr>)}</tbody></table></div>
      )}</View>
      <div className="card row">
        <input placeholder="ключ (например, tariffs_order)" value={x.key} onChange={(e) => setX({ ...x, key: e.target.value })} />
        <input placeholder="название" value={x.title} onChange={(e) => setX({ ...x, title: e.target.value })} />
        <input style={{ width: 340 }} value={x.variants} onChange={(e) => setX({ ...x, variants: e.target.value })} />
        <label><input type="checkbox" checked={x.active} onChange={(e) => setX({ ...x, active: e.target.checked })} /> активен</label>
        <button className="btn" onClick={async () => { let variants; try { variants = JSON.parse(x.variants); } catch { return alert('Неверный JSON'); } if (await act(() => api(`/admin-api/experiments/${x.key}`, { method: 'PUT', body: { title: x.title, variants, active: x.active } }))) s.reload(); }}>Сохранить</button>
      </div>
    </>
  );
}
