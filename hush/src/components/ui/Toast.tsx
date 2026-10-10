import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Check, Info } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { haptic } from '@/lib/telegram';

type ToastTone = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

const ICONS: Record<ToastTone, ReactNode> = {
  info: <Info size={16} className="text-accentSoft" />,
  success: <Check size={16} strokeWidth={2.5} className="text-success" />,
  error: <AlertCircle size={16} className="text-danger" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef<number>();

  const show = useCallback((message: string, tone: ToastTone = 'info') => {
    window.clearTimeout(timer.current);
    if (tone === 'error') haptic.notify('error');
    if (tone === 'success') haptic.notify('success');
    setToast({ id: Date.now(), message, tone });
    timer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(max(var(--safe-bottom),12px)+68px)] z-[60] flex justify-center px-4" aria-live="polite">
          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.2 }}
                className="pointer-events-auto flex max-w-[398px] items-center gap-2.5 rounded-[14px] border border-border bg-[#1C1D27]/95 px-4 py-3 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.7)] backdrop-blur"
              >
                <span className="shrink-0">{ICONS[toast.tone]}</span>
                <span className="text-[14px] leading-5 text-text">{toast.message}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
