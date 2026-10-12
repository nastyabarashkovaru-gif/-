import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { createPortal } from 'react-dom';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { IconClose } from '../art/icons';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'pink' | 'danger-outline';
export function Button({ children, variant = 'primary', className, loading, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean }) {
  const styles: Record<BtnVariant, string> = {
    primary: 'bg-leaf-deep text-white shadow-lift active:bg-leaf-ink',
    secondary: 'bg-leaf-soft text-leaf-deep active:bg-[#DCEEE0]',
    ghost: 'bg-transparent text-leaf-deep active:bg-leaf-soft',
    pink: 'bg-blush-accent text-white shadow-soft active:brightness-95',
    'danger-outline': 'bg-white text-ink border-2 border-ink-line active:bg-cream',
  };
  return (
    <button
      {...p}
      disabled={p.disabled || loading}
      className={cx('min-h-[50px] rounded-btn px-5 text-[16px] font-semibold transition-[transform,background,opacity] duration-150 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100', styles[variant], className)}
    >
      {loading ? <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent align-middle" aria-label="Загрузка" /> : children}
    </button>
  );
}

export function Card({ children, className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cx('rounded-card bg-white shadow-card ring-1 ring-ink-line/60', className)}>{children}</div>;
}

export function Chip({ active, children, onClick, className, tint }: { active?: boolean; children: ReactNode; onClick?: () => void; className?: string; tint?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx('inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[14px] font-medium transition-colors duration-150',
        active ? 'bg-leaf-deep text-white' : 'bg-cream text-ink-soft ring-1 ring-ink-line', className)}
      style={!active && tint ? { background: tint } : undefined}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} id={id} onClick={() => onChange(!checked)}
      className={cx('relative h-[30px] w-[52px] shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-leaf' : 'bg-[#DDE3DF]')}>
      <span className={cx('absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition-transform duration-200', checked ? 'translate-x-[25px]' : 'translate-x-[3px]')} />
    </button>
  );
}

export function Stepper({ value, min, max, onChange, label, suffix }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; suffix?: ReactNode }) {
  return (
    <div className="flex items-center gap-3" role="group" aria-label={label}>
      <button type="button" aria-label="Меньше" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}
        className="h-10 w-10 rounded-full bg-cream text-xl font-semibold text-leaf-deep ring-1 ring-ink-line disabled:opacity-40">−</button>
      <div className="min-w-[56px] text-center text-[18px] font-semibold tabular-nums" aria-live="polite">{value}{suffix}</div>
      <button type="button" aria-label="Больше" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}
        className="h-10 w-10 rounded-full bg-cream text-xl font-semibold text-leaf-deep ring-1 ring-ink-line disabled:opacity-40">+</button>
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, label }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1 rounded-[16px] bg-cream p-1 ring-1 ring-ink-line" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cx('min-h-[42px] rounded-[12px] px-2 text-[14px] font-medium leading-tight transition-all duration-150', value === o.value ? 'bg-white text-leaf-deep shadow-card' : 'text-ink-soft')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Нижний лист (модальный), учитывает safe area и reduced motion. */
export function Sheet({ open, onClose, children, title, labelledBy, tall }: { open: boolean; onClose: () => void; children: ReactNode; title?: string; labelledBy?: string; tall?: boolean }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.div className="absolute inset-0 bg-[#26342C]/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.div
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            aria-labelledby={labelledBy}
            className={cx('relative w-full max-w-[560px] overflow-y-auto rounded-t-[28px] bg-white px-5 pt-3 shadow-[0_-10px_40px_-12px_rgba(38,52,44,0.25)] outline-none pb-safe', tall ? 'max-h-[92vh] min-h-[60vh]' : 'max-h-[88vh]')}
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 340 }}
          >
            <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-ink-line" aria-hidden="true" />
            <button type="button" onClick={onClose} aria-label="Закрыть" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-ink-mute active:bg-cream">
              <IconClose size={20} />
            </button>
            {title && <h2 className="mb-3 pr-10 text-[20px] font-bold leading-tight">{title}</h2>}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ---------------------------------------------------------------- тосты
type Toast = { id: number; text: string; tone: 'ok' | 'error' | 'info' };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-safe" aria-live="polite" role="status">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
              className={cx('max-w-[420px] rounded-2xl px-4 py-3 text-[15px] font-medium shadow-soft ring-1',
                t.tone === 'error' ? 'bg-[#FFF4F2] text-[#9B3B33] ring-[#F5D4CF]' : t.tone === 'ok' ? 'bg-leaf-soft text-leaf-ink ring-[#CFE8D6]' : 'bg-white text-ink ring-ink-line')}>
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

export function DropsBadge({ n, className, size = 'md' }: { n: number; className?: string; size?: 'sm' | 'md' }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full bg-drop-soft font-semibold text-[#1F6F96] tabular-nums', size === 'sm' ? 'h-6 px-2 text-[12px]' : 'h-8 px-3 text-[14px]', className)}>
      <svg width={size === 'sm' ? 11 : 13} height={size === 'sm' ? 11 : 13} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c3.6 4.6 6.5 8.2 6.5 11.8a6.5 6.5 0 0 1-13 0C5.5 10.7 8.4 7.1 12 2.5z" fill="#7BCBF0" /></svg>
      {n}
    </span>
  );
}

export function Field({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; htmlFor?: string }) {
  return (
    <div className="mb-4">
      <label htmlFor={htmlFor} className="mb-1.5 block text-[14px] font-semibold text-ink">{label}</label>
      {children}
      {hint && <div className="mt-1.5 text-[13px] leading-snug text-ink-mute">{hint}</div>}
    </div>
  );
}

export const inputCls = 'w-full rounded-[14px] bg-cream px-4 py-3 text-[16px] text-ink ring-1 ring-ink-line placeholder:text-ink-mute focus:outline-none focus:ring-2 focus:ring-leaf';
