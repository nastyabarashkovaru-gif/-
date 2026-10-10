import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface SettingsRowProps {
  icon: ReactNode;
  label: string;
  value?: string;
  onClick: () => void;
  tone?: 'default' | 'danger';
  /** Скрыть стрелку справа. */
  plain?: boolean;
}

export function SettingsRow({ icon, label, value, onClick, tone = 'default', plain }: SettingsRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-150 hover:bg-surface2 active:bg-surface2"
    >
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-surface2', tone === 'danger' ? 'text-danger' : 'text-accentSoft')}>
        {icon}
      </span>
      <span className={cn('flex-1 text-[15px]', tone === 'danger' ? 'text-danger' : 'text-text')}>{label}</span>
      {value && <span className="text-[14px] text-muted">{value}</span>}
      {!plain && <ChevronRight size={18} className="text-[#5A5C68]" aria-hidden />}
    </button>
  );
}

export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section>
      {title && <h2 className="mb-2 px-1 text-[13px] font-medium text-muted">{title}</h2>}
      <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">{children}</div>
    </section>
  );
}
