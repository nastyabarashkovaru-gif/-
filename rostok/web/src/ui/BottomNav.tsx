import { Sprout } from '../art/Tree';
import { IconList, IconUser } from '../art/icons';
import { cx } from './kit';

export type Tab = 'tasks' | 'garden' | 'profile';

/** Три элемента: Задачи — круглая кнопка «Сад» (выше боковых) — Профиль. Учитывает safe area. */
export function BottomNav({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const side = (t: Tab, label: string, icon: React.ReactNode) => (
    <button onClick={() => onChange(t)} aria-current={tab === t ? 'page' : undefined}
      className={cx('flex h-[56px] flex-1 flex-col items-center justify-center gap-0.5 text-[12px] font-semibold transition-colors', tab === t ? 'text-leaf-deep' : 'text-ink-mute')}>
      {icon}
      {label}
    </button>
  );
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-line/70 bg-white/95 backdrop-blur" style={{ paddingBottom: 'var(--safe-bottom)' }} aria-label="Навигация">
      <div className="relative mx-auto flex max-w-[560px] items-end px-6">
        {side('tasks', 'Задачи', <IconList size={24} />)}
        <div className="flex w-[96px] shrink-0 justify-center">
          <button onClick={() => onChange('garden')} aria-label="Сад" aria-current={tab === 'garden' ? 'page' : undefined}
            className={cx('-mt-7 mb-1.5 grid h-[68px] w-[68px] place-items-center rounded-full bg-leaf shadow-lift ring-[5px] ring-white transition-transform active:scale-95', tab === 'garden' && 'bg-leaf-deep')}>
            <span className="-mt-1 block w-[46px]"><Sprout size={46} sway={false} /></span>
          </button>
        </div>
        {side('profile', 'Профиль', <IconUser size={24} />)}
      </div>
    </nav>
  );
}
