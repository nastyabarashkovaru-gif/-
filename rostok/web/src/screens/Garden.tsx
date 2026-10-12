import { motion } from 'motion/react';
import { useState } from 'react';
import { SPHERES, sphereById, type SphereId } from '@rostok/shared';
import { Island, TREE_SLOTS } from '../art/Island';
import { Tree } from '../art/Tree';
import { Drop } from '../art/icons';
import { useApp } from '../state/app';
import { TreeSheet } from './TreeSheet';

/** Главный экран: общий остров, шесть деревьев с независимыми уровнями, серия входов, уровень сада, прогресс дня. */
export function GardenScreen({ goTasks }: { goTasks: () => void }) {
  const { garden, me } = useApp();
  const [open, setOpen] = useState<SphereId | null>(null);
  if (!garden) return <GardenSkeleton />;
  const g = garden.garden;
  const pct = Math.min(1, (g.totalSpentDrops - g.levelFloor) / Math.max(1, g.nextLevelAt - g.levelFloor));
  return (
    <div className="mx-auto max-w-[560px] px-4 pt-safe pb-nav">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold leading-tight tracking-tight">Мой сад</h1>
          <p className="mt-0.5 text-[13px] text-ink-mute">
            Открываешь приложение {garden.streak.current} {dayWord(garden.streak.current)} подряд 🔥
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-full bg-cream py-1 pl-1 pr-3 ring-1 ring-ink-line" aria-label={`Уровень сада ${g.level}`}>
          <Ring pct={pct} label={String(g.level)} />
          <span className="text-[12px] font-semibold leading-tight text-ink-soft">Уровень<br />сада</span>
        </div>
      </header>

      <button onClick={goTasks} className="mt-3 flex w-full items-center gap-3 rounded-[18px] bg-leaf-soft/70 px-4 py-2.5 text-left active:bg-leaf-soft">
        <span className="text-[14px] font-semibold text-leaf-ink">Сегодня {garden.todayProgress.done} из {garden.todayProgress.total}</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white">
          <span className="block h-full rounded-full bg-leaf transition-all duration-500" style={{ width: `${garden.todayProgress.total ? (garden.todayProgress.done / garden.todayProgress.total) * 100 : 0}%` }} />
        </span>
        <span className="text-[13px] font-medium text-leaf-deep">Задачи ›</span>
      </button>

      <div className="relative mx-auto mt-14 aspect-[400/300] w-full max-w-[520px] touch-pan-y">
        <Island decor={g.decor} className="absolute inset-0 h-full w-full" />
        {SPHERES.map((s) => {
          const t = garden.trees.find((x) => x.sphere === s.id)!;
          const slot = TREE_SLOTS[s.id];
          const w = 19 + 11 * (1 - Math.exp(-(t.level - 1) / 12));
          return (
            <button key={s.id} onClick={() => setOpen(s.id)} aria-label={`${s.name}, уровень ${t.level}, ${t.availableDrops} капель${t.canWater ? ', можно полить' : ''}`}
              className="absolute -translate-x-1/2 -translate-y-full focus-visible:outline-none" style={{ left: `${slot.x}%`, top: `${slot.y}%`, width: `${w}%`, zIndex: Math.round(slot.y) }}>
              <motion.div whileTap={{ scale: 0.95 }}>
                <Tree species={s.species} level={t.level} withered={t.healthVisualState === 'withered'} size={200} className="h-auto w-full" sway={!me.settings.reducedMotion} />
              </motion.div>
              {t.canWater && (
                <span className="drop-pulse absolute -top-1 left-1/2 -ml-[11px]" aria-hidden="true"><Drop size={22} /></span>
              )}
            </button>
          );
        })}
        {SPHERES.map((s) => {
          const t = garden.trees.find((x) => x.sphere === s.id)!;
          const slot = TREE_SLOTS[s.id];
          return (
            <div key={`l-${s.id}`} aria-hidden="true" className="pointer-events-none absolute -translate-x-1/2 whitespace-nowrap rounded-[10px] bg-white/90 px-1.5 py-0.5 text-center text-[10.5px] font-semibold leading-[1.15] shadow-card"
              style={{ left: `${slot.x}%`, top: `calc(${slot.y}% + 3px)`, zIndex: 80, color: s.ink }}>
              {s.name}<br /><span className="font-medium text-ink-mute">Ур. {t.level}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-center text-[13px] text-ink-mute">Нажми на дерево, чтобы полить его и посмотреть задачи сферы</p>
      <TreeSheet sphere={open} onClose={() => setOpen(null)} />
    </div>
  );
}

const dayWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'день' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'дня' : 'дней');

function Ring({ pct, label }: { pct: number; label: string }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r={r} stroke="#E8F4EB" strokeWidth="4" fill="white" />
      <circle cx="18" cy="18" r={r} stroke="#78BC8A" strokeWidth="4" fill="none" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round" transform="rotate(-90 18 18)" />
      <text x="18" y="22.5" textAnchor="middle" fontSize="12" fontWeight="700" fill="#276B48">{label}</text>
    </svg>
  );
}

function GardenSkeleton() {
  return (
    <div className="mx-auto max-w-[560px] px-4 pt-safe">
      <div className="skeleton h-8 w-40 rounded-xl" />
      <div className="skeleton mt-3 h-11 rounded-2xl" />
      <div className="skeleton mx-auto mt-14 aspect-[400/300] w-full rounded-[40%]" />
    </div>
  );
}

export const sphereLabel = (s: SphereId) => sphereById(s)!.name;
