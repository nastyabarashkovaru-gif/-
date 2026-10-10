import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Обёртка экрана: плавное появление и колонка на всю высоту. */
export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.main
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn('flex min-h-dvh flex-col', className)}
    >
      {children}
    </motion.main>
  );
}

/** Нижняя панель с главным действием: прилипает к низу и учитывает safe-area. */
export function BottomBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('sticky bottom-0 z-20 mt-auto bg-gradient-to-t from-bg from-70% to-bg/0 px-gutter pb-safe pt-6', className)}>
      {children}
    </div>
  );
}
