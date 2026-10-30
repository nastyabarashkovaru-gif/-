import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, House, Menu, SlidersHorizontal, Users2 } from 'lucide-react';
import QRCode from 'qrcode';
import { api, ApiError } from './api';
import { Dashboard, Funnel } from './pages/Analytics';
import { Home } from './pages/Home';
import { Exports, Insights, MANAGE, MORE, ManageHub, MoreHub } from './pages/Hubs';
import { OnboardingReviews } from './pages/OnboardingReviews';
import { Legacy } from './pages/Legacy';
import { Tariffs, Payments } from './pages/Billing';
import { Promos } from './pages/Promos';
import { Journey } from './pages/Journey';
import { Users, UserDetail } from './pages/Users';
import { Flows, Chats, Buddy, Meetings } from './pages/Community';
import { Moderation, Rating, Prizes, PrizeDetail } from './pages/Quality';
import { Reviews, Bot, Upsells, Settings, Experiments } from './pages/Content';

export interface MeAdmin { id: string; login: string; role: string; permissions: string[]; demo?: boolean }

/** Нижнее меню: какие адреса относятся к какой вкладке */
const TABS: { to: string; title: string; icon: typeof House; match: string[] }[] = [
  { to: '/', title: 'Главная', icon: House, match: ['/'] },
  { to: '/users', title: 'Участники', icon: Users2, match: ['/users', '/moderation', '/rating', '/prizes', '/buddy'] },
  { to: '/manage', title: 'Управление', icon: SlidersHorizontal, match: ['/manage', ...MANAGE.map((m) => m.to).filter((x) => x !== '/journey')] },
  { to: '/more', title: 'Ещё', icon: Menu, match: ['/more', ...MORE.map((m) => m.to)] },
];
const ROOTS = ['/', '/users', '/manage', '/more'];

function tabOf(path: string) {
  if (path === '/') return '/';
  return TABS.find((t) => t.to !== '/' && t.match.some((m) => path === m || path.startsWith(`${m}/`)))?.to ?? null;
}

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
  const logout = async () => { await api('/admin-api/auth/logout', { body: {} }); setMe(null); };
  return <Shell me={me} can={can} logout={logout} />;
}

function Shell({ me, can, logout }: { me: MeAdmin; can: (p: string) => boolean; logout: () => void }) {
  const loc = useLocation();
  const nav = useNavigate();
  const tab = tabOf(loc.pathname);
  const isRoot = ROOTS.includes(loc.pathname);
  useEffect(() => window.scrollTo(0, 0), [loc.pathname]);
  return (
    <div className="app">
      {me.demo && <div className="demo-banner">Демоверсия · цифры демонстрационные</div>}
      {!isRoot && (
        <div className="topbar">
          <button className="back" onClick={() => (window.history.length > 1 ? nav(-1) : nav(tab ?? '/'))}><ChevronLeft size={22} />Назад</button>
        </div>
      )}
      <main className="content">
        <Routes>
          <Route path="/" element={can('dashboard') ? <Home /> : <Navigate to="/meetings" />} />
          <Route path="/manage" element={<ManageHub can={can} />} />
          <Route path="/more" element={<MoreHub can={can} onLogout={logout} who={`${me.login} · ${me.role}`} />} />
          <Route path="/more/insights" element={<Insights />} />
          <Route path="/more/exports" element={<Exports />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/funnel" element={<Funnel />} />
          <Route path="/tariffs" element={<Tariffs />} />
          <Route path="/onboarding-reviews" element={<OnboardingReviews />} />
          <Route path="/legacy" element={<Legacy />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/flows" element={<Flows />} />
          <Route path="/users" element={<Users />} />
          <Route path="/users/:id" element={<UserDetail canEdit={can('usersEdit')} canStartOver={can('roles')} />} />
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
      <nav className="tabbar">
        {TABS.map((t) => (
          <Link key={t.to} to={t.to} className={tab === t.to ? 'on' : ''}>
            <t.icon size={24} strokeWidth={tab === t.to ? 2.3 : 1.8} />
            <span>{t.title}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
