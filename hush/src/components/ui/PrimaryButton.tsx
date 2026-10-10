import { motion, type HTMLMotionProps } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';

interface PrimaryButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  children: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
  /**
   * Визуально неактивна, но нажатие всё равно вызывает onClick —
   * чтобы показать подсказку, почему действие пока недоступно.
   */
  softDisabled?: boolean;
}

export function PrimaryButton({
  children,
  icon,
  loading,
  loadingLabel,
  softDisabled,
  disabled,
  className,
  onClick,
  ...rest
}: PrimaryButtonProps) {
  const inactive = softDisabled || disabled;
  return (
    <motion.button
      type="button"
      whileTap={loading || disabled ? undefined : { scale: 0.98 }}
      transition={{ duration: 0.15 }}
      disabled={disabled || loading}
      aria-disabled={inactive || loading}
      aria-busy={loading}
      onClick={(e) => {
        if (!inactive) haptic.tap('medium');
        onClick?.(e);
      }}
      className={cn(
        'relative flex h-btn w-full items-center justify-center gap-2 rounded-button px-5 text-button transition-colors duration-200',
        inactive
          ? 'border border-border bg-surface2 text-muted'
          : 'bg-accent text-white shadow-[0_8px_24px_-12px_rgba(137,92,246,0.7)] hover:bg-[#9468F7] active:bg-[#7C50EA]',
        loading && 'cursor-wait',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <>
          <span className="flex gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-white"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
              />
            ))}
          </span>
          {loadingLabel && <span>{loadingLabel}</span>}
        </>
      ) : (
        <>
          {icon}
          <span>{children}</span>
        </>
      )}
    </motion.button>
  );
}
