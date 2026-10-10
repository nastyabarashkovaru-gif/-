import { createContext, useCallback, useContext, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Loader2, Settings, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';

/* ───────── Layout ───────── */

export function Screen({ fixed, className, children }: { fixed?: boolean; className?: string; children: ReactNode }) {
  return <div className={cn('screen', fixed && 'screen-fixed', className)}>{children}</div>;
}

export const Spacer = ({ min = 0 }: { min?: number }) => <div className="flex-1" style={{ minHeight: min }} aria-hidden />;

export function Logo() {
  return (
    <div className="logo" aria-label="hush">
      hush<span className="text-purple">.</span>
    </div>
  );
}

export function TopBar({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="top">
      {left ?? <Logo />}
      {right}
    </header>
  );
}

/* ───────── Иконки-кнопки шапки ───────── */

function HeaderIconButton({ label, onClick, children, className }: { label: string; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      className={cn('-m-2.5 flex h-11 w-11 items-center justify-center rounded-full transition-opacity active:opacity-50', className)}
    >
      {children}
    </button>
  );
}

export const CloseButton = ({ onClick }: { onClick: () => void }) => (
  <HeaderIconButton label="Закрыть" onClick={onClick} className="-mr-3.5">
    <X size={20} strokeWidth={2.4} color="#aaa" />
  </HeaderIconButton>
);

export const SettingsButton = ({ onClick }: { onClick: () => void }) => (
  <HeaderIconButton label="Настройки" onClick={onClick} className="-mr-[11px]">
    <Settings size={20} strokeWidth={2.3} color="#aaa" />
  </HeaderIconButton>
);

export const BackArrow = ({ onClick }: { onClick: () => void }) => (
  <HeaderIconButton label="Назад" onClick={onClick} className="-ml-3.5">
    <ArrowLeft size={30} strokeWidth={1.6} color="#fff" />
  </HeaderIconButton>
);

/* ───────── Кнопки ───────── */

type CtaIcon = 'right' | 'upRight' | 'none';

interface CtaProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode;
  icon?: CtaIcon;
  loading?: boolean;
}

/** Главная белая кнопка (.cta из reference) */
export function Cta({ children, icon = 'none', loading, disabled, onClick, className, ...rest }: CtaProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={(e) => {
        haptic.tap('medium');
        onClick?.(e);
      }}
      className={cn('cta', loading && '!opacity-90', className)}
    >
      {loading ? (
        <Loader2 size={17} strokeWidth={2.6} className="animate-spin" aria-label="Загрузка" />
      ) : (
        <>
          <span>{children}</span>
          {icon === 'right' && <ArrowRight size={16} strokeWidth={2.6} className="ml-[15px] shrink-0" aria-hidden />}
          {icon === 'upRight' && <ArrowUpRight size={18} strokeWidth={2.6} className="ml-[13px] shrink-0" aria-hidden />}
        </>
      )}
    </button>
  );
}

export function SmallBack({ onClick, label = 'Назад' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
      className="link-small -my-1"
    >
      <ArrowLeft size={13} strokeWidth={1.8} aria-hidden />
      {label}
    </button>
  );
}

/* ───────── Прогресс из 5 сегментов ───────── */

export function Segments({ filled, total = 5, label }: { filled: number; total?: number; label?: string }) {
  return (
    <div
      className="flex shrink-0 gap-[5px]"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(filled, total)}
      aria-label={label}
    >
      {Array.from({ length: total }, (_, i) => (
        <i
          key={i}
          className="block h-[5px] flex-1 rounded-[9px] transition-colors duration-300 ease-out"
          style={{ background: i < filled ? '#a855f7' : '#302a36' }}
        />
      ))}
    </div>
  );
}

export function BigIcon({ size = 72, children, className }: { size?: number; children: ReactNode; className?: string }) {
  return (
    <div className={cn('bigicon', className)} style={{ width: size, height: size }} aria-hidden>
      {children}
    </div>
  );
}

/* ───────── Toast ───────── */

interface ToastApi {
  show(text: string): void;
}
const ToastContext = createContext<ToastApi>({ show: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const timer = useRef<number>();
  const show = useCallback((text: string) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text });
    timer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-50 mx-auto flex max-w-app justify-center px-[23px]"
        style={{ bottom: 'calc(118px + var(--safe-bottom))' }}
        aria-live="polite"
      >
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="rounded-[12px] border border-[#2a2930] bg-[#1d1b23] px-4 py-3 text-center text-[13px] font-semibold leading-snug text-white shadow-[0_8px_30px_rgba(0,0,0,0.6)]"
            >
              {toast.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/* ───────── Модалка (07b) ───────── */

export function Modal({ open, onClose, children, labelledBy }: { open: boolean; onClose: () => void; children: ReactNode; labelledBy?: string }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 mx-auto flex max-w-app items-center px-[20px]"
          style={{ background: 'rgba(0,0,0,0.86)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
        >
          <motion.div
            className="w-full"
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────── Состояния загрузки / ошибки ───────── */

export function LoadingScreen() {
  return (
    <Screen fixed>
      <TopBar />
      <div className="flex flex-1 items-center justify-center" role="status" aria-label="Загрузка">
        <div className="flex gap-[6px]">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-[7px] w-[7px] rounded-full bg-purple"
              animate={{ opacity: [0.25, 1, 0.25] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>
      </div>
    </Screen>
  );
}

export function MessageScreen({
  icon,
  title,
  text,
  action,
  actionIcon = 'right',
  onAction,
  top,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action: string;
  actionIcon?: CtaIcon;
  onAction: () => void;
  top?: ReactNode;
}) {
  return (
    <Screen fixed>
      <TopBar right={top} />
      <Spacer />
      <BigIcon>{icon}</BigIcon>
      <h1 className="h1 text-center">{title}</h1>
      <p className="muted text-center">{text}</p>
      <Spacer />
      <Cta icon={actionIcon} onClick={onAction}>
        {action}
      </Cta>
    </Screen>
  );
}

/* ───────── Глифы из макета: ◉ ▣ ♢ ───────── */

export function DotIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <circle cx="10" cy="10" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="5.6" fill="currentColor" />
    </svg>
  );
}

export function SquareDotIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden>
      <rect x="1.8" y="1.8" width="16.4" height="16.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="4.6" y="4.6" width="10.8" height="10.8" fill="currentColor" />
    </svg>
  );
}

export function RowsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="2" y="2" width="16" height="16" />
      <path d="M2 6h16M2 10h16M2 14h16" />
    </svg>
  );
}

export function RhombusIcon({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden>
      <path d="M15 4 L23.5 15 L15 26 L6.5 15 Z" />
    </svg>
  );
}
