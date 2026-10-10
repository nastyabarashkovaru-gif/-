import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-surface2', className)} aria-hidden />;
}

type LoadingVariant = 'answers' | 'survey' | 'profile' | 'plans' | 'pending';

interface LoadingStateProps {
  variant: LoadingVariant;
  /** Для pending: текст ожидания. */
  label?: string;
}

/** Состояния загрузки: скелетоны вместо спиннеров. */
export function LoadingState({ variant, label = 'Ждём подтверждения…' }: LoadingStateProps) {
  if (variant === 'pending') {
    return (
      <div role="status" className="flex flex-col items-center gap-3 py-8 text-center">
        <div className="flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-2 w-2 rounded-full bg-accent"
              animate={{ opacity: [0.25, 1, 0.25] }}
              transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>
        <p className="text-[14px] text-muted">{label}</p>
      </div>
    );
  }

  if (variant === 'profile') {
    return (
      <div role="status" aria-label="Загрузка профиля" className="flex items-center gap-3 rounded-card border border-border bg-surface p-4">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    );
  }

  if (variant === 'plans') {
    return (
      <div role="status" aria-label="Загрузка тарифов" className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3 rounded-card border border-border bg-surface p-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'survey') {
    return (
      <div role="status" aria-label="Загрузка анкеты" className="space-y-4">
        <Skeleton className="h-7 w-4/5" />
        <Skeleton className="h-4 w-1/2" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2 pt-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-[88px] w-full rounded-card" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div role="status" aria-label="Загрузка ответов" className="space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-3 rounded-card border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-4" />
          </div>
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  );
}
