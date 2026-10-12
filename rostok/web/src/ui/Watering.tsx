import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { SpeciesId } from '@rostok/shared';
import { Tree } from '../art/Tree';
import { WateringCan } from '../art/icons';
import { haptic } from '../lib/telegram';

/**
 * Анимация полива (≈2.4 с): лейка → капли → дерево разрастается → новый уровень → тизер силуэта следующего.
 * При reduced motion — мягкая смена кадра без движения.
 */
export function WateringScene({ species, fromLevel, toLevel, withered, size = 220, reduced, playing, onDone }: {
  species: SpeciesId; fromLevel: number; toLevel: number; withered?: boolean; size?: number; reduced?: boolean; playing: boolean; onDone?: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'pour' | 'grow' | 'done'>('idle');
  useEffect(() => {
    if (!playing) { setPhase('idle'); return; }
    if (reduced) {
      setPhase('grow');
      const t = setTimeout(() => { setPhase('done'); haptic.success(); onDone?.(); }, 700);
      return () => clearTimeout(t);
    }
    setPhase('pour');
    const t1 = setTimeout(() => { setPhase('grow'); haptic.medium(); }, 1300);
    const t2 = setTimeout(() => { setPhase('done'); haptic.success(); onDone?.(); }, 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [playing, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  const level = phase === 'grow' || phase === 'done' ? toLevel : fromLevel;
  return (
    <div className="relative mx-auto" style={{ width: size, height: (size * 220) / 200 }}>
      <AnimatePresence>
        {phase === 'pour' && (
          <motion.div className="absolute -right-2 -top-6 z-10" initial={{ opacity: 0, x: 30, rotate: 0 }} animate={{ opacity: 1, x: 0, rotate: -28 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.5 }}>
            <WateringCan size={size * 0.38} />
          </motion.div>
        )}
      </AnimatePresence>
      {phase === 'pour' && Array.from({ length: 7 }).map((_, i) => (
        <motion.svg key={i} width="12" height="16" viewBox="0 0 24 24" className="absolute z-10" style={{ left: `${44 + (i % 4) * 7}%`, top: '6%' }}
          initial={{ y: 0, opacity: 0 }} animate={{ y: size * 0.45, opacity: [0, 1, 1, 0] }} transition={{ duration: 0.75, delay: 0.45 + i * 0.1, ease: 'easeIn' }} aria-hidden="true">
          <path d="M12 2.5c3.6 4.6 6.5 8.2 6.5 11.8a6.5 6.5 0 0 1-13 0C5.5 10.7 8.4 7.1 12 2.5z" fill="#7BCBF0" />
        </motion.svg>
      ))}
      <AnimatePresence mode="popLayout">
        <motion.div key={level} className="absolute inset-0"
          initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.86 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={reduced ? { duration: 0.3 } : { type: 'spring', damping: 11, stiffness: 160 }}
          style={{ transformOrigin: '50% 92%' }}>
          <Tree species={species} level={level} withered={withered} size={size} sway={!reduced} title={`Уровень ${level}`} />
        </motion.div>
      </AnimatePresence>
      {(phase === 'grow' || phase === 'done') && !reduced && (
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {Array.from({ length: 10 }).map((_, i) => {
            const a = (i / 10) * Math.PI * 2;
            return (
              <motion.span key={i} className="absolute h-2 w-2 rounded-full" style={{ left: '50%', top: '42%', background: i % 2 ? '#F6C6D8' : '#FFE08A' }}
                initial={{ x: 0, y: 0, opacity: 1, scale: 0.6 }} animate={{ x: Math.cos(a) * size * 0.45, y: Math.sin(a) * size * 0.4, opacity: 0, scale: 1.2 }}
                transition={{ duration: 0.9, ease: 'easeOut' }} />
            );
          })}
        </div>
      )}
      <AnimatePresence>
        {(phase === 'grow' || phase === 'done') && (
          <motion.div className="absolute inset-x-0 -bottom-2 flex justify-center" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : 0.25 }}>
            <span className="rounded-full bg-leaf-deep px-4 py-1.5 text-[14px] font-bold text-white shadow-lift" aria-live="polite">Уровень {toLevel}!</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Затемнённый силуэт следующего изменения — без спойлера. */
export function NextSilhouette({ species, level, size = 64 }: { species: SpeciesId; level: number; size?: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid place-items-center rounded-2xl bg-cream p-1.5 ring-1 ring-ink-line" style={{ opacity: 0.9 }}>
        <div style={{ opacity: 0.16 }}><Tree species={species} level={level} silhouette size={size} /></div>
        <span className="absolute text-[18px] font-bold text-ink-mute" aria-hidden="true">?</span>
      </div>
      <div className="text-[13px] leading-snug text-ink-mute">
        <div className="font-semibold text-ink">Сюрприз уровня {level}</div>
        Откроется после следующего полива
      </div>
    </div>
  );
}
