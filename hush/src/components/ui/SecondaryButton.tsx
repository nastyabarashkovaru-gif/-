import { motion, type HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';

interface SecondaryButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: ReactNode;
  icon?: ReactNode;
  /** surface — кнопка с фоном, ghost — текстовая кнопка. */
  variant?: 'surface' | 'ghost';
}

export function SecondaryButton({ children, icon, variant = 'surface', className, onClick, ...rest }: SecondaryButtonProps) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.15 }}
      onClick={(e) => {
        haptic.tap('light');
        onClick?.(e);
      }}
      className={cn(
        'flex w-full items-center justify-center gap-2 rounded-button px-4 text-[15px] font-semibold transition-colors duration-200',
        variant === 'surface'
          ? 'h-12 border border-border bg-surface2 text-text hover:border-[#3A3C48] hover:bg-[#262733]'
          : 'min-h-touch text-accentSoft hover:text-text',
        className,
      )}
      {...rest}
    >
      {icon}
      <span>{children}</span>
    </motion.button>
  );
}
