import { cn } from '@/lib/cn';

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn('font-display text-[22px] font-extrabold leading-none tracking-[-0.04em] text-text', className)}
      aria-label="hush"
    >
      hush<span className="text-accent">.</span>
    </span>
  );
}
