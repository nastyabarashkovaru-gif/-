import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  children: ReactNode;
}

export function IconButton({ label, children, className, onClick, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        haptic.tap('light');
        onClick?.(e);
      }}
      className={cn(
        'flex h-touch w-touch items-center justify-center rounded-control text-text transition-colors duration-150 hover:bg-surface2 active:bg-surface2',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
