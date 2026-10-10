import { AnimatePresence, motion, useDragControls, type PanInfo } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Кнопки действий, закреплённые внизу листа. */
  footer?: ReactNode;
}

export function BottomSheet({ open, onClose, title, children, footer }: BottomSheetProps) {
  const dragControls = useDragControls();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 80 || info.velocity.y > 500) onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.div
            className="absolute inset-0 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative flex max-h-[88dvh] w-full max-w-app flex-col rounded-t-[20px] border-x border-t border-border bg-surface"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
          >
            <div
              className="flex touch-none justify-center pt-2.5"
              aria-hidden
              onPointerDown={(e) => dragControls.start(e)}
            >
              <span className="h-1 w-9 rounded-full bg-[#3A3C48]" />
            </div>
            <div
              className="flex touch-none items-start justify-between gap-3 px-4 pb-1 pt-3"
              onPointerDown={(e) => dragControls.start(e)}
            >
              {title && <h2 className="text-[20px] font-semibold leading-7 tracking-[-0.015em]">{title}</h2>}
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                className="-mr-2 -mt-1 flex h-touch w-touch shrink-0 items-center justify-center rounded-control text-muted hover:text-text"
              >
                <X size={20} />
              </button>
            </div>
            <div className="overflow-y-auto px-4 pb-4">{children}</div>
            {footer && <div className="border-t border-border px-4 pb-safe pt-3">{footer}</div>}
            {!footer && <div className="pb-safe" />}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
