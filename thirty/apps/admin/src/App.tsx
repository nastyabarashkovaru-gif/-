import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, ApiError } from './api';
import { Dashboard, Funnel } from './pages/Analytics';
import { Tariffs, Payments } from './pages/Billing';
import { Promos } from './pages/Promos';
import { Journey } from './pages/Journey';
import { Users, UserDetail } from './pages/Users';
import { Flows, Chats, Buddy, Meetings } from './pages/Community';
import { Moderation, Rating, Prizes, PrizeDetail } from './pages/Quality';
import { Reviews, Bot, Upsells, Settings, Experiments } from './pages/Content';

export interface MeAdmin { id: string; login: string; role: string; permissions: string[] }

const MENU: { path: string; title: string; perm: string }[] = [
  { path: '/', title: 'A01 Дашборд', perm: 'dashboard' },
  { path: '/funnel', title: 'A02 Воронка и экраны', perm: 'analytics' },
  { path: '/tariffs', title: 'A03 Тарифы и ценность', perm: 'tariffs' },
  { path: '/payments', title: 'A04 Платежи', perm: 'payments' },
  { path: '/flows', title: 'A05 Потоки', perm: 'flows' },
  { path: '/users', title: 'A06 Пользователи', perm: 'users' },
  { path: '/moderation', title: 'A07 Модерация', perm: 'moderation' },
  { path: '/rating', title: 'A08 Рейтинг и правила', perm: 'rating' },
  { path: '/prizes', title: 'A09 Претенденты на приз', perm: 'prizes' },
  { path: '/buddy', title: 'A10 Бадди', perm: 'buddy' },
  { path: '/chats', title: 'A11 Чаты', perm: 'chats' },
  { path: '/meetings', title: 'A12 Созвоны и эксперты', perm: 'meetings' },
  { path: '/reviews', title: 'A13 Отзывы и кейсы', perm: 'reviews' },
  { path: '/bot', title: 'A14 Сообщения бота', perm: 'bot' },
  { path: '/promos', title: 'Промокоды и сторис', perm: 'tariffs' },
  { path: '/journey', title: 'Итоги и отзывы', perm: 'reviews' },
  { path: '/upsells', title: 'A15 Апселлы', perm: 'upsells' },
  { path: '/settings', title: 'A16 Настройки и роли', perm: 'settings' },
  { path: '/experiments', title: 'A17 A/B-тесты', perm: 'experiments' },
];

function Login({ onDone }: { onDone: () => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'pw' | 'setup' | 'verify'>('pw');
  const [secret, setSecret] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const submitPw = async () => {
    setErr('');
    try {
      const r = await api<{ mfa: string; secret?: string; otpauthUrl?: string }>('/admin-api/auth/login', { body: { login, password } });
      if (r.mfa === 'ok') return onDone();
      if (r.mfa === 'setup') setSecret({ secret: r.secret!, qr: await QRCode.toDataURL(r.otpauthUrl!) });
      setStep(r.mfa as 'setup' | 'verify');
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const submitCode = async () => {
    setErr('');
    try {
      await api('/admin-api/auth/mfa', { body: { code } });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="card login">
      <h1>30 дней · админка</h1>
      {err && <div className="err">{err}</div>}
      {step === 'pw' ? (
        <form onSubmit={(e) => { e.preventDefault(); void submitPw(); }} style={{ display: 'grid', gap: 10 }}>
          <label className="f">Логин<input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" /></label>
          <label className="f">Пароль<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
          <button className="btn">Войти</button>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void submitCode(); }} style={{ display: 'grid', gap: 10 }}>
          {step === 'setup' && secret && (
            <>
              <div>Подключите двухфакторную аутентификацию: отсканируйте код в Google Authenticator / Яндекс Ключ.</div>
              <img src={secret.qr} alt="QR для 2FA" style={{ width: 200 }} />
              <div className="muted">Или введите ключ: <code>{secret.secret}</code></div>
            </>
          )}
          <label className="f">Код из приложения<input value={code} inputMode="numeric" maxLength={6} onChange={(e) => setCode(e.target.value)} autoFocus /></label>
          <button className="btn">Подтвердить</button>
        </form>
      )}
    </div>
  );
}

export function App() {
  const [me, setMe] = useState<MeAdmin | null | undefined>(undefined);
  const load = () => api<MeAdmin>('/admin-api/auth/me').then(setMe).catch((e) => (e instanceof ApiError && e.status === 401 ? setMe(null) : setMe(null)));
  useEffect(() => void load(), []);
  if (me === undefined) return <div className="login muted">Загрузка…</div>;
  if (!me) return <Login onDone={load} />;
  const can = (p: string) => me.permissions.includes(p);
  return (
    <div className="layout">
      <aside className="side">
        <div className="brand">30 дней</div>
        {MENU.filter((m) => can(m.perm)).map((m) => <NavLink key={m.path} to={m.path} end={m.path === '/'}>{m.title}</NavLink>)}
        <div className="who">{me.login} · {me.role}<br /><a href="#" onClick={async (e) => { e.preventDefault(); await api('/admin-api/auth/logout', { body: {} }); setMe(null); }}>Выйти</a></div>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={can('dashboard') ? <Dashboard /> : <Navigate to="/meetings" />} />
          <Route path="/funnel" element={<Funnel />} />
          <Route path="/tariffs" element={<Tariffs />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/flows" element={<Flows />} />
          <Route path="/users" element={<Users />} />
          <Route path="/users/:id" element={<UserDetail canEdit={can('usersEdit')} />} />
          <Route path="/moderation" element={<Moderation />} />
          <Route path="/rating" element={<Rating canEdit={can('settings')} />} />
          <Route path="/prizes" element={<Prizes />} />
          <Route path="/prizes/:id" element={<PrizeDetail />} />
          <Route path="/buddy" element={<Buddy />} />
          <Route path="/chats" element={<Chats />} />
          <Route path="/meetings" element={<Meetings expert={me.role === 'expert'} />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/bot" element={<Bot />} />
          <Route path="/promos" element={<Promos />} />
          <Route path="/journey" element={<Journey />} />
          <Route path="/upsells" element={<Upsells />} />
          <Route path="/settings" element={<Settings isOwner={can('roles')} />} />
          <Route path="/experiments" element={<Experiments />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
