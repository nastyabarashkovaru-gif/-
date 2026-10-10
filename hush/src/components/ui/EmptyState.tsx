import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, children, className }: EmptyStateProps) {
  return (
    <div className={cn('rounded-card border border-border bg-surface px-5 py-6 text-center', className)}>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface2 text-accentSoft">{icon}</div>
      <h3 className="mt-4 text-[17px] font-semibold leading-6">{title}</h3>
      {description && <p className="mx-auto mt-1.5 max-w-[300px] text-[14px] leading-5 text-muted">{description}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
