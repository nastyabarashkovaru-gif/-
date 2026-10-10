import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

interface ProgressBarProps {
  value: number;
  max: number;
  /** Разбить шкалу на сегменты (например, 5 ответов). */
  segmented?: boolean;
  className?: string;
  label?: string;
}

export function ProgressBar({ value, max, segmented, className, label }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(value, max));
  const common = {
    role: 'progressbar' as const,
    'aria-valuemin': 0,
    'aria-valuemax': max,
    'aria-valuenow': clamped,
    'aria-label': label,
  };

  if (segmented) {
    return (
      <div {...common} className={cn('flex gap-1', className)}>
        {Array.from({ length: max }, (_, i) => (
          <div key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-surface2">
            <motion.div
              className="h-full rounded-full bg-accent"
              initial={false}
              animate={{ width: i < clamped ? '100%' : '0%' }}
              transition={{ duration: 0.25, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div {...common} className={cn('h-1 overflow-hidden rounded-full bg-surface2', className)}>
      <motion.div
        className="h-full rounded-full bg-accent"
        initial={false}
        animate={{ width: `${(clamped / max) * 100}%` }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
