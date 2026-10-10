import { ChevronLeft, Settings2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';
import { Logo } from './Logo';

interface AppHeaderProps {
  onBack?: () => void;
  onSettings?: () => void;
  /** Показывать логотип слева (если нет кнопки «назад»). */
  showLogo?: boolean;
  title?: string;
  right?: ReactNode;
  className?: string;
}

export function AppHeader({ onBack, onSettings, showLogo = true, title, right, className }: AppHeaderProps) {
  return (
    <header className={cn('sticky top-0 z-30 bg-bg/85 pt-safe backdrop-blur-xl', className)}>
      <div className="relative flex h-14 items-center justify-between px-2">
        <div className="flex min-w-touch items-center">
          {onBack ? (
            <IconButton label="Назад" onClick={onBack}>
              <ChevronLeft size={24} strokeWidth={2} />
            </IconButton>
          ) : (
            showLogo && <Logo className="pl-2" />
          )}
        </div>
        {title && (
          <h1 className="pointer-events-none absolute inset-x-16 truncate text-center text-[16px] font-semibold">{title}</h1>
        )}
        <div className="flex min-w-touch items-center justify-end">
          {right}
          {onSettings && (
            <IconButton label="Настройки" onClick={onSettings}>
              <Settings2 size={22} strokeWidth={1.75} />
            </IconButton>
          )}
        </div>
      </div>
    </header>
  );
}
