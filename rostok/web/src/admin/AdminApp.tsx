import { useEffect, useState } from 'react';

/** Защищённая админ-панель: RBAC на сервере, все действия пишутся в audit log. */
let token: string | null = null;
try { token = sessionStorage.getItem('rostok.admin'); } catch { /* */ }

async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/admin${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data as any)?.message || 'Ошибка');
  return data as T;
}

const TABS = [
  ['summary', 'Сводка', 'metrics'], ['funnel', 'Воронка', 'metrics'], ['retention', 'Retention', 'metrics'], ['product', 'Продукт', 'metrics'],
  ['config', 'Конфиги', 'config_read'], ['support', 'Поддержка', 'support'], ['payments', 'Платежи', 'payments'], ['errors', 'Ошибки', 'errors'],
  ['audit', 'Аудит', 'audit'], ['export', 'Экспорт', 'export'],
] as const;

export default function AdminApp() {
  const [me, setMe] = useState<{ login: string; role: string; perms: string[] } | null>(null);
  const [tab, setTab] = useState<string>('summary');
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    document.title = 'ROSTOK · админка';
    call('GET', '/whoami').then(setMe).catch(() => {}).finally(() => setChecked(true));
  }, []);
  if (!checked) return null;
  if (!me) return <Login onOk={(m) => setMe(m)} />;
  const tabs = TABS.filter(([, , p]) => me.perms.includes(p));
  return (
    <div className="min-h-screen bg-cream text-ink">
      <header className="sticky top-0 z-10 border-b border-ink-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <b className="text-leaf-deep">ROSTOK · admin</b>
          <nav className="no-scrollbar flex flex-1 gap-1 overflow-x-auto">
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${tab === id ? 'bg-leaf-deep text-white' : 'text-ink-soft hover:bg-cream'}`}>{label}</button>
            ))}
          </nav>
          <span className="text-sm text-ink-mute">{me.login} · {me.role}</span>
          <button className="text-sm text-leaf-deep" onClick={() => { try { sessionStorage.removeItem('rostok.admin'); } catch { /* */ } location.reload(); }}>Выйти</button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        {tab === 'summary' && <Summary />}
        {tab === 'funnel' && <Funnel />}
        {tab === 'retention' && <Retention />}
        {tab === 'product' && <Product />}
        {tab === 'config' && <ConfigEditor canWrite={me.perms.includes('config_write')} />}
        {tab === 'support' && <Support />}
        {tab === 'payments' && <Payments canRefund={me.perms.includes('refund')} />}
        {tab === 'errors' && <Errors />}
        {tab === 'audit' && <Audit />}
        {tab === 'export' && <Export />}
      </main>
    </div>
  );
}

function Login({ onOk }: { onOk: (m: any) => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await call<{ token: string }>('POST', '/login', { login, password });
      token = r.token;
      try { sessionStorage.setItem('rostok.admin', r.token); } catch { /* */ }
      onOk(await call('GET', '/whoami'));
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <div className="grid min-h-screen place-items-center bg-cream p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-card bg-white p-6 shadow-card">
        <h1 className="text-xl font-bold">Вход в админку</h1>
        <input className="mt-4 w-full rounded-xl bg-cream px-4 py-3 ring-1 ring-ink-line" placeholder="Логин" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" />
        <input className="mt-2 w-full rounded-xl bg-cream px-4 py-3 ring-1 ring-ink-line" placeholder="Пароль" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {err && <div className="mt-2 text-sm text-danger">{err}</div>}
        <button className="mt-4 w-full rounded-btn bg-leaf-deep py-3 font-semibold text-white">Войти</button>
      </form>
    </div>
  );
}

function useLoad<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { setData(null); call<T>('GET', path).then(setData).catch((e) => setErr(e.message)); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err, reload: () => call<T>('GET', path).then(setData) };
}

const Box = ({ title, children }: { title?: string; children: React.ReactNode }) => (
  <section className="mb-5 rounded-card bg-white p-5 shadow-card">{title && <h2 className="mb-3 font-bold">{title}</h2>}{children}</section>
);
const Stat = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="rounded-2xl bg-cream p-4"><div className="text-2xl font-bold text-leaf-deep">{value ?? '—'}</div><div className="text-sm text-ink-mute">{label}</div></div>
);
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);

function Summary() {
  const [days, setDays] = useState(30);
  const { data: d, err } = useLoad<any>(`/summary?days=${days}`, [days]);
  return (
    <>
      <div className="mb-4 flex gap-2">{[1, 7, 30, 90].map((n) => <button key={n} onClick={() => setDays(n)} className={`rounded-full px-3 py-1 text-sm ${days === n ? 'bg-leaf-deep text-white' : 'bg-white'}`}>{n === 1 ? 'День' : n === 7 ? 'Неделя' : n === 30 ? 'Месяц' : '90 дней'}</button>)}</div>
      {err && <div className="text-danger">{err}</div>}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Открыли Mini App" value={d.opened} /><Stat label="Начали онбординг" value={d.onboardingStarted} /><Stat label="Завершили обучение" value={d.onboardingCompleted} /><Stat label="Дошли до paywall" value={d.paywall} />
            <Stat label="Начали оплату" value={d.checkoutStarted} /><Stat label="Оплатили" value={d.paid} /><Stat label="Активные подписчики" value={d.activeSubscribers} /><Stat label="Отменяют (до конца периода)" value={d.canceling} />
            <Stat label="Отток за период" value={d.churned} /><Stat label="Возвраты (всего)" value={d.refunded} />
            {d.revenue.map((r: any) => <Stat key={r.currency} label={`Выручка, ${r.currency} (${r.payments} платежей, ${r.refunds} возвр.)`} value={r.amount} />)}
            <Stat label="Тестовые платежи (песочница)" value={d.sandboxPayments} />
          </div>
          <Box title="По дням"><Bars rows={d.daily.map((x: any) => ({ label: x.day.slice(5), value: x.opens, sub: `${x.completions} вып.` }))} /></Box>
        </>
      )}
    </>
  );
}

function Bars({ rows }: { rows: { label: string; value: number; sub?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3 text-sm">
          <span className="w-40 shrink-0 truncate text-ink-soft">{r.label}</span>
          <div className="h-4 flex-1 overflow-hidden rounded bg-cream"><div className="h-full rounded bg-leaf" style={{ width: `${(r.value / max) * 100}%` }} /></div>
          <span className="w-24 shrink-0 text-right tabular-nums">{r.value}{r.sub ? ` · ${r.sub}` : ''}</span>
        </div>
      ))}
    </div>
  );
}

function Funnel() {
  const { data } = useLoad<{ step: string; users: number }[]>('/funnel?days=90');
  return <Box title="Воронка (90 дней, без демо-пользователей)">{data ? <Bars rows={data.map((s, i) => ({ label: s.step, value: s.users, sub: i && data[0].users ? `${Math.round((s.users / data[0].users) * 100)}%` : undefined }))} /> : '…'}</Box>;
}

function Retention() {
  const { data } = useLoad<any[]>('/retention');
  return (
    <Box title="Retention по недельным когортам (открытия Mini App)">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-ink-mute"><th>Когорта</th><th>Размер</th>{['D1', 'D3', 'D7', 'D14', 'D30'].map((d) => <th key={d}>{d}</th>)}</tr></thead>
        <tbody>{data?.map((r) => <tr key={r.cohort} className="border-t border-ink-line"><td className="py-1.5">{r.cohort}</td><td>{r.size}</td>{[r.d1, r.d3, r.d7, r.d14, r.d30].map((v, i) => <td key={i}>{r.size ? `${Math.round((v / r.size) * 100)}%` : '—'}</td>)}</tr>)}</tbody>
      </table>
    </Box>
  );
}

function Product() {
  const { data: d } = useLoad<any>('/stats');
  if (!d) return <>…</>;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Completion rate задач" value={pct(d.completionRate)} />
        <Stat label="Капель в день на активного" value={d.avgDropsPerDay?.toFixed(1)} />
        <Stat label="Часов до первого полива" value={d.avgHoursToFirstWatering?.toFixed(1)} />
        <Stat label="Доля хардкор-задач" value={pct(d.hardcoreShare)} />
        <Stat label="Доля задач с подарками" value={pct(d.rewardsShare)} />
        <Stat label="Доля вредных привычек" value={pct(d.habitsShare)} />
        <Stat label="Пользователей в челленджах" value={pct(d.challengeUsersShare)} />
      </div>
      <Box title="Популярные сферы"><Bars rows={d.popularSpheres.map((s: any) => ({ label: s.name, value: s.tasks }))} /></Box>
      <Box title="Распределение уровней деревьев"><Bars rows={d.levelDistribution.map((s: any) => ({ label: `Уровень ${s.level}`, value: s.n }))} /></Box>
    </>
  );
}

function ConfigEditor({ canWrite }: { canWrite: boolean }) {
  const { data, reload } = useLoad<any>('/config');
  const [key, setKey] = useState('level_curve');
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!data) return;
    const v = key === 'level_curve' ? data.levelCurve : data.values[key];
    setText(JSON.stringify(v, null, 2));
    setMsg('');
  }, [data, key]);
  const save = async () => {
    try {
      await call('PUT', `/config/${key}`, { value: JSON.parse(text) });
      setMsg('Сохранено');
      reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  if (!data) return <>…</>;
  return (
    <>
      <Box title="Конфигурация">
        <div className="mb-3 flex flex-wrap gap-2">
          {['level_curve', 'brand', 'onboarding', 'paywall', 'notification_texts', 'flags', 'asset_manifest'].map((k) => (
            <button key={k} onClick={() => setKey(k)} className={`rounded-full px-3 py-1 text-sm ${key === k ? 'bg-leaf-deep text-white' : 'bg-cream'}`}>{k}</button>
          ))}
        </div>
        {key === 'level_curve' && <p className="mb-2 text-sm text-ink-mute">table[i] — стоимость полива с уровня i+1 на i+2; дальше — плавный рост к ceiling. Применяется сразу, без миграции.</p>}
        <textarea className="h-80 w-full rounded-xl bg-cream p-3 font-mono text-sm ring-1 ring-ink-line" value={text} onChange={(e) => setText(e.target.value)} readOnly={!canWrite} />
        {canWrite && <button onClick={save} className="mt-2 rounded-btn bg-leaf-deep px-4 py-2 font-semibold text-white">Сохранить</button>}
        {msg && <span className="ml-3 text-sm">{msg}</span>}
      </Box>
      <Box title={`Тарифы (провайдер: ${data.provider})`}>
        <p className="mb-2 text-sm text-ink-mute">Суммы меняются только через настройку провайдера и миграцию — здесь тексты и активность.</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-ink-mute"><th>ID</th><th>Название</th><th>Тип</th><th>Дней</th><th>Stars</th><th>≈ ₽</th><th>Кому</th><th>Активен</th></tr></thead>
          <tbody>{data.plans.map((p: any) => (
            <tr key={p.id} className="border-t border-ink-line"><td className="py-1.5">{p.id}</td><td>{p.title}</td><td>{p.kind}</td><td>{p.period_days}</td><td>{p.price_stars}</td><td>{p.display_price_rub}</td><td>{p.eligibility}</td>
              <td>{canWrite ? <input type="checkbox" checked={p.is_active} onChange={async (e) => { await call('PATCH', `/plans/${p.id}`, { isActive: e.target.checked }); reload(); }} /> : String(p.is_active)}</td></tr>
          ))}</tbody>
        </table>
      </Box>
    </>
  );
}

function Support() {
  const [id, setId] = useState('');
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const find = async () => { setErr(''); setData(null); try { setData(await call('GET', `/users/${encodeURIComponent(id.trim())}`)); } catch (e) { setErr((e as Error).message); } };
  return (
    <Box title="Поиск по Telegram ID (минимум персональных данных, без названий задач и ответов о привычках)">
      <div className="flex gap-2"><input className="flex-1 rounded-xl bg-cream px-4 py-2 ring-1 ring-ink-line" value={id} onChange={(e) => setId(e.target.value)} placeholder="123456789" /><button onClick={find} className="rounded-btn bg-leaf-deep px-4 font-semibold text-white">Найти</button></div>
      {err && <div className="mt-2 text-danger">{err}</div>}
      {data && <pre className="mt-3 max-h-[60vh] overflow-auto rounded-xl bg-cream p-3 text-xs">{JSON.stringify(data, null, 2)}</pre>}
    </Box>
  );
}

function Payments({ canRefund }: { canRefund: boolean }) {
  const { data, reload } = useLoad<any[]>('/payments');
  const refund = async (charge: string) => {
    if (!confirm(`Вернуть платёж ${charge}? Доступ, оплаченный им, будет закрыт.`)) return;
    try { await call('POST', `/payments/${encodeURIComponent(charge)}/refund`); reload(); } catch (e) { alert((e as Error).message); }
  };
  return (
    <Box title="Платежи">
      <div className="overflow-x-auto"><table className="w-full text-sm">
        <thead><tr className="text-left text-ink-mute"><th>Время</th><th>TG ID</th><th>Провайдер</th><th>Тип</th><th>План</th><th>Сумма</th><th>Доступ до</th><th /></tr></thead>
        <tbody>{data?.map((p) => (
          <tr key={p.id} className="border-t border-ink-line"><td className="py-1.5">{new Date(p.created_at).toLocaleString('ru')}</td><td>{p.telegram_id}</td><td>{p.provider}</td><td>{p.type}</td><td>{p.plan_id}</td><td>{p.amount} {p.currency}</td><td>{p.access_until ? new Date(p.access_until).toLocaleDateString('ru') : ''}</td>
            <td>{canRefund && ['payment_succeeded', 'renewal'].includes(p.type) && p.charge_id && <button className="text-danger" onClick={() => refund(p.charge_id)}>Возврат</button>}</td></tr>
        ))}</tbody>
      </table></div>
    </Box>
  );
}

function Errors() {
  const { data } = useLoad<any>('/errors');
  return (
    <>
      <Box title="Фоновые задания">{data?.jobs.map((j: any) => <div key={j.name} className="text-sm">{j.name}: последний запуск {j.last_run_at ? new Date(j.last_run_at).toLocaleString('ru') : '—'} {j.last_error && <span className="text-danger">· {j.last_error}</span>}</div>)}</Box>
      <Box title="Ошибки">{data?.errors.length === 0 && 'Ошибок нет 🌱'}{data?.errors.map((e: any) => <div key={e.id} className="border-t border-ink-line py-1.5 text-sm"><b>{e.source}</b> · {new Date(e.created_at).toLocaleString('ru')}<div className="text-ink-soft">{e.message}</div></div>)}</Box>
    </>
  );
}

function Audit() {
  const { data } = useLoad<any[]>('/audit');
  return <Box title="Audit log">{data?.map((a) => <div key={a.id} className="border-t border-ink-line py-1.5 text-sm">{new Date(a.created_at).toLocaleString('ru')} · <b>{a.login ?? '—'}</b> · {a.action} {a.target && `· ${a.target}`}</div>)}</Box>;
}

function Export() {
  const dl = async (kind: string) => {
    const r = await fetch(`/api/admin/export/${kind}`, { headers: { authorization: `Bearer ${token}` } });
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${kind}.csv`;
    a.click();
  };
  return (
    <Box title="Экспорт CSV (без содержимого задач и привычек)">
      <div className="flex flex-wrap gap-2">{['events', 'payments', 'subscriptions', 'users'].map((k) => <button key={k} onClick={() => dl(k)} className="rounded-btn bg-leaf-soft px-4 py-2 font-semibold text-leaf-deep">{k}.csv</button>)}</div>
    </Box>
  );
}
