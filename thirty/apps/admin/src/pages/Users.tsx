import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, d, dt, rub } from '../api';
import { Status, SubNav, View, useLoad, withReason } from '../ui';

/** A06: поиск пользователей */
export function Users() {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('');
  const s = useLoad(() => api(`/admin-api/users?q=${encodeURIComponent(q)}&stage=${stage}`), [q, stage]);
  return (
    <>
      <h1 className="page-title">Участники</h1>
      <SubNav items={[['/moderation', 'Модерация'], ['/rating', 'Рейтинг'], ['/prizes', 'Претенденты'], ['/buddy', 'Бадди']]} />
      <div className="search">
        <input value={q} placeholder="Имя, @username или Telegram ID" onChange={(e) => setQ(e.target.value)} />
        <select value={stage} onChange={(e) => setStage(e.target.value)}>
          <option value="">Все этапы</option>
          {Object.entries(STAGE_RU).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
        </select>
      </div>
      <View s={s}>{(rows: any[]) => (
        rows.length ? (
          <div className="list">
            {rows.map((u) => (
              <button key={u.id} className="user-row" onClick={() => nav(`/users/${u.id}`)}>
                <div className="avatar">{(u.name ?? '?').slice(0, 1)}</div>
                <div className="grow">
                  <b>{u.name}</b>
                  <span>{u.username ? `@${u.username} · ` : ''}{u.city ?? 'город не указан'}</span>
                  <span className="muted">{STAGE_RU[u.stage] ?? u.stage} · с {d(u.createdAt)}</span>
                </div>
                {u.subscription ? <span className={`pill ${['active', 'prestart'].includes(u.subscription.status) ? 'ok' : u.subscription.status === 'past_due' ? 'err' : 'warn'}`}>{u.subscription.tariffId.replace('m', '')} мес · {SUB_RU[u.subscription.status] ?? u.subscription.status}</span> : null}
              </button>
            ))}
          </div>
        ) : <div className="empty">Никого не нашли</div>
      )}</View>
      <a className="btn big light" href="/admin-api/export/users">Выгрузить всех в CSV</a>
    </>
  );
}

const STAGE_RU: Record<string, string> = { new: 'Новый', onboarding: 'Онбординг', tariffs: 'Смотрит тарифы', checkout: 'Оплачивает', paid: 'Оплатил', registered: 'Заполнил анкету' };
const SUB_RU: Record<string, string> = { prestart: 'ждёт старта', active: 'активна', past_due: 'долг', canceled_at_period_end: 'отменена', expired: 'закончилась' };

/** A06: карточка пользователя — воронка, экраны, тарифные клики, оплаты, подписка, потоки, отчёты, согласия, модерация */
export function UserDetail({ canEdit }: { canEdit: boolean }) {
  const { id = '' } = useParams();
  const s = useLoad(() => api(`/admin-api/users/${id}`), [id]);
  return (
    <View s={s}>{(u: any) => (
      <>
        <h1>{u.user.displayName || u.user.firstName} {u.user.lastName ?? ''} <span className="muted">#{u.user.id}</span></h1>
        <div className="grid2">
          <div className="card">
            <h2>Профиль</h2>
            <div>@{u.user.username ?? '—'} · {u.user.city ?? 'город не указан'} · {u.user.timezone}</div>
            <div>Интересы: {u.user.interests.join(', ') || '—'} · видимость: {u.user.visibility}</div>
            <div>Бот: {u.user.allowsWrite ? 'может писать' : 'не может писать'}{u.user.botBlocked ? ' · заблокировал бота' : ''} · реклама: {u.user.marketingOptIn ? 'да' : 'нет'}</div>
            <div>Этап: {u.user.onboardingStage} · последний экран: {u.user.lastScreen ?? '—'}</div>
            {canEdit && <button className="btn light" style={{ marginTop: 8 }} onClick={async () => { if (confirm('Сбросить таймер скидки? При следующем открытии тарифов он начнётся заново (3 часа).')) { await api(`/admin-api/users/${u.user.id}/reset-offer`, { body: {} }); alert('Таймер сброшен'); } }}>Сбросить таймер скидки</button>}
          </div>
          <div className="card">
            <h2>Воронка</h2>
            <table><tbody>{u.funnel.map((f: any) => <tr key={f.event}><td>{f.event}</td><td>{f.first ? dt(f.first) : <span className="muted">—</span>}</td></tr>)}</tbody></table>
            <div className="muted">Клики по тарифам: {u.tariffClicks.map((t: any) => `${t.tariff} (${dt(t.ts)})`).join(', ') || '—'}</div>
          </div>
        </div>
        <div className="card">
          <h2>Акция и промокоды</h2>
          {u.offers.map((o: any) => <div key={o.id}>{o.kind === 'intro' ? 'Таймер 3 часа' : 'Окно промокода'}: {dt(o.startedAt)} — {dt(o.expiresAt)}{o.consumedAt ? ` · куплено ${dt(o.consumedAt)}` : ''}</div>)}
          {u.promos.map((p: any) => <div key={p.id}>Промокод <b>{p.promo.code}</b>: применён {dt(p.appliedAt)}{p.paidAt ? `, оплачен ${dt(p.paidAt)}` : ''}</div>)}
          {u.stories.map((r: any) => <div key={r.id}>Сторис @{r.instagram}: {r.status}</div>)}
          {!u.offers.length && !u.promos.length && <div className="muted">Предложение не показывалось</div>}
          <div>Реклама в боте: {u.user.marketingOptIn ? 'разрешена' : 'отключена (/stop)'}</div>
          <h2>Подписки и оплаты</h2>
          {u.subscriptions.map((s: any) => <div key={s.id}>{s.tariffId} <Status v={s.status} /> · {d(s.paidFromFlow)} — {d(s.paidThroughFlow)} · след. списание {d(s.nextChargeDate)} {s.autoRenew ? '' : '(автопродление выключено)'}
            {s.autoRenew && ['prestart', 'active', 'past_due'].includes(s.status) && (
              <button className="btn light" style={{ padding: '2px 8px', marginLeft: 6 }} onClick={async () => { if (await withReason('Отменить автопродление по обращению', (reason) => api(`/admin-api/users/${u.user.id}/cancel-subscription`, { body: { reason } }))) location.reload(); }}>отменить автопродление</button>
            )}</div>)}
          <table><thead><tr><th>Дата</th><th>Вид</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>{u.payments.map((p: any) => <tr key={p.id}><td>{dt(p.createdAt)}</td><td>{p.kind}</td><td>{rub(p.amount)}</td><td><Status v={p.status} /></td></tr>)}</tbody></table>
        </div>
        {u.memberships.map((m: any) => (
          <div className="card" key={m.id}>
            <h2>Поток «{m.flow.title}» <Status v={m.status} /></h2>
            {m.stats && <div>Выполнено {m.stats.completed}/{m.stats.scheduled} ({Math.round(m.stats.ratio * 100)}%) · успешных дней {m.stats.successfulDays} · пропусков отчёта {m.stats.missedReports}</div>}
            {m.goals.map((g: any) => <div key={g.id}><b>{g.title}</b> ({g.category}) — {g.tasks.map((t: any) => t.title).join(', ')} {g.finalAchieved !== null && <span className={`pill ${g.finalAchieved ? 'ok' : 'err'}`}>{g.finalAchieved ? 'достигнута' : 'не достигнута'}</span>}</div>)}
            <details><summary>Отчёты ({m.reports.length})</summary>
              <table><tbody>{m.reports.map((r: any) => (
                <tr key={r.id}><td>{r.date}</td><td><Status v={r.status} /></td><td>{r.items.map((i: any) => (
                  <div key={i.occurrenceId}>{i.task} {i.link && <a href={i.link} target="_blank" rel="noreferrer">ссылка</a>} {i.media.map((x: string) => <a key={x} href={x} target="_blank" rel="noreferrer">фото </a>)}
                    {canEdit && <button className="btn light" style={{ padding: '2px 8px', marginLeft: 6 }} onClick={async () => { if (await withReason('Снять отметку выполнения', (reason) => api(`/admin-api/occurrences/${i.occurrenceId}`, { body: { status: 'pending', reason } }))) s.reload(); }}>снять</button>}
                  </div>
                ))}</td><td>{r.text}</td></tr>
              ))}</tbody></table>
            </details>
          </div>
        ))}
        <div className="grid2">
          <div className="card"><h2>Согласия</h2><table><tbody>{u.consents.map((c: any) => <tr key={c.id}><td>{c.kind}</td><td>{c.version}</td><td>{dt(c.createdAt)}</td><td>{c.revokedAt ? `отозвано ${dt(c.revokedAt)}` : 'действует'}</td></tr>)}</tbody></table></div>
          <div className="card"><h2>Модерация</h2>
            <div>Жалобы на пользователя: {u.moderation.complaintsAbout.length} · от пользователя: {u.moderation.complaintsBy.length}</div>
            {u.moderation.audit.map((a: any) => <div key={a.id} className="muted">{dt(a.createdAt)} {a.action}: {a.reason}</div>)}
          </div>
        </div>
        <div className="card"><h2>Сообщения бота</h2><table><tbody>{u.botLogs.map((l: any) => <tr key={l.id}><td>{dt(l.sentAt)}</td><td>{l.templateKey}</td><td><Status v={l.status} /></td><td>{l.clickedAt ? 'клик' : ''} {l.convertedAt ? '→ оплата' : ''}</td></tr>)}</tbody></table></div>
        <div className="card"><h2>Последние экраны</h2><div className="muted">{u.screens.slice(0, 60).map((x: any) => `${x.screen}`).join(' ← ')}</div></div>
        <Link to="/users">← К списку</Link>
      </>
    )}</View>
  );
}
