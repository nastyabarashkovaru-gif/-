import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Bell, Home, LayoutList, MessagesSquare, User, WifiOff, RefreshCw, X } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { screenView } from '../lib/analytics';
import { haptic } from '../lib/telegram';

export function Screen({ id, children, nav, className = '' }: { id: string; children: ReactNode; nav?: boolean; className?: string }) {
  useEffect(() => {
    screenView(id);
    window.scrollTo(0, 0);
  }, [id]);
  return (
    <div className={`screen ${nav ? 'with-nav' : ''} ${className}`}>
      <OfflineBanner />
      {children}
      {nav && <BottomNav />}
    </div>
  );
}

export function Header({ title, sub, back, right }: { title: ReactNode; sub?: ReactNode; back?: boolean | string; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="screen-head">
      <div className="row grow" style={{ alignItems: 'flex-start' }}>
        {back && (
          <button className="icon-btn" aria-label="Назад" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}>
            <ArrowLeft size={20} />
          </button>
        )}
        <div className="grow">
          <h1 className="h1">{title}</h1>
          {sub && <p className="sub">{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

const TABS = [
  { path: '/', label: 'Главная', Icon: Home },
  { path: '/feed', label: 'Лента', Icon: LayoutList },
  { path: '/club', label: 'Сообщество', Icon: MessagesSquare },
  { path: '/profile', label: 'Профиль', Icon: User },
];

export function BottomNav() {
  const loc = useLocation();
  const nav = useNavigate();
  return (
    <nav className="nav" aria-label="Навигация">
      {TABS.map(({ path, label, Icon }) => {
        const on = path === '/' ? loc.pathname === '/' : loc.pathname.startsWith(path) || (path === '/feed' && (loc.pathname.startsWith('/rating') || loc.pathname.startsWith('/u/')));
        return (
          <button key={path} className={on ? 'on' : ''} onClick={() => { haptic(); nav(path); }} aria-current={on ? 'page' : undefined}>
            <span className="nav-ic"><Icon size={22} strokeWidth={1.8} /></span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}

export function Bar({ value }: { value: number }) {
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export type DayState = 'success' | 'partial' | 'missed' | 'today' | 'future';

export function DayGrid({ days }: { days: { date: string; state: DayState }[] }) {
  return (
    <div className="days">
      {days.map((d, i) => (
        <div key={d.date} className={`day ${d.state === 'future' ? '' : d.state}`} aria-label={`${d.date}: ${STATE_LABEL[d.state]}`}>
          {d.state === 'success' ? '✓' : i + 1}
        </div>
      ))}
    </div>
  );
}
const STATE_LABEL: Record<DayState, string> = { success: 'выполнено', partial: 'частично', missed: 'пропуск', today: 'сегодня', future: 'впереди' };

export function Avatar({ name, url, size }: { name: string; url?: string | null; size?: 'lg' }) {
  return <div className={`ava ${size ?? ''}`}>{url ? <img src={url} alt="" /> : (name || '?').slice(0, 1).toUpperCase()}</div>;
}

export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="col" aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ height: i === 0 ? 180 : 96 }} />)}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const offline = error instanceof ApiError && (error.code === 'offline' || error.code === 'network');
  return (
    <div className="state">
      {offline ? <WifiOff size={36} /> : <RefreshCw size={36} />}
      <div>{error instanceof Error ? error.message : 'Не удалось загрузить данные'}</div>
      {retry && <button className="btn btn-secondary btn-sm" onClick={retry}>Повторить</button>}
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="state">
      {icon}
      <div className="h3" style={{ color: 'var(--ink)' }}>{title}</div>
      {text && <div className="small">{text}</div>}
      {action}
    </div>
  );
}

function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online ? null : <div className="banner warn">Нет интернета. Данные обновятся, когда связь появится.</div>;
}

/** Загрузка данных с состояниями loading / error / reload */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fnRef.current().then(
      (d) => { setData(d); setLoading(false); },
      (e) => { setError(e); setLoading(false); },
    );
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, deps);
  return { data, error, loading, reload, setData };
}

let toastSetter: ((t: string | null) => void) | null = null;
export function toast(text: string) {
  toastSetter?.(text);
}
export function ToastHost() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    toastSetter = setText;
    return () => { toastSetter = null; };
  }, []);
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => setText(null), 3200);
    return () => clearTimeout(t);
  }, [text]);
  return text ? <div className="toast" role="status">{text}</div> : null;
}

export function errorText(e: unknown) {
  return e instanceof Error ? e.message : 'Что-то пошло не так';
}

export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog">
        {children}
      </div>
    </div>
  );
}

/** Всплывающее окно по центру; смена содержимого (stepKey) проигрывает анимацию заново */
export function Popup({ open, onClose, children, stepKey }: { open: boolean; onClose: () => void; children: ReactNode; stepKey?: string | number }) {
  if (!open) return null;
  // В body: у экранов есть анимация (transform), внутри неё position: fixed перестаёт работать относительно окна
  return createPortal(
    <div className="popup-bg" onClick={onClose}>
      <div className="popup" key={stepKey} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="popup-x" aria-label="Закрыть" onClick={onClose}><X size={20} /></button>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export function humanDate(iso: string, year = false) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS_GEN[m - 1]}${year ? ` ${y}` : ''}`;
}

/** Шапка макетов: логотип «30 дней» слева, счётчик или статус справа */
export function BrandBar({ right }: { right?: ReactNode }) {
  return (
    <div className="brand-bar">
      <span className="brand"><b>30</b>дней</span>
      {right}
    </div>
  );
}

export function Dots({ count, at }: { count: number; at: number }) {
  return (
    <div className="dots" aria-label={`Шаг ${at + 1} из ${count}`}>
      {Array.from({ length: count }, (_, i) => <i key={i} className={i === at ? 'on' : ''} />)}
    </div>
  );
}

/** Основная кнопка макетов: текст и стрелка → */
export function Cta({ children, onClick, disabled, type }: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: 'submit' }) {
  return (
    <button className="btn btn-primary" onClick={onClick} disabled={disabled} type={type ?? 'button'}>
      {children}
      <ArrowRight size={16} strokeWidth={2.2} />
    </button>
  );
}

/** Шапка разделов приложения: логотип, колокольчик уведомлений, профиль */
export function AppBar() {
  const nav = useNavigate();
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => api<{ unread: number }>('/api/notifications/unread').then((r) => alive && setUnread(r.unread > 0)).catch(() => undefined);
    void check();
    const t = setInterval(check, 30_000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  return (
    <div className="brand-bar" style={{ minHeight: 44 }}>
      <span className="brand"><b>30</b>дней</span>
      <span className="row" style={{ gap: 14 }}>
        <button className="bell" aria-label="Уведомления" onClick={() => nav('/notifications')}>
          <Bell size={21} strokeWidth={1.8} />
          {unread && <i />}
        </button>
        <button className="ic" style={{ border: 0, cursor: 'pointer' }} aria-label="Профиль" onClick={() => nav('/profile')}><User size={18} /></button>
      </span>
    </div>
  );
}

/** Цвет процента участника (решение владельца 24.10): >80 зелёный, 50–80 фиолетовый, 30–<50 жёлтый, <30 красный */
export function pctColor(p: number | null | undefined) {
  if (p === null || p === undefined) return 'var(--muted-2)';
  if (p > 80) return 'var(--green)';
  if (p >= 50) return 'var(--accent)';
  if (p >= 30) return 'var(--gold-ink)';
  return 'var(--danger)';
}
