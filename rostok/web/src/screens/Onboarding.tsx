import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { SlideArt } from '../art/Scenes';
import { IconBack } from '../art/icons';
import { api, track } from '../api/client';
import type { PublicConfig } from '../api/types';
import { Button, cx } from '../ui/kit';

/** 3–4 продающих слайда: свайп, точки, «Дальше», возврат назад. Тексты — из серверного конфига. */
export function Onboarding({ config, startAt, onDone }: { config: PublicConfig; startAt: number; onDone: () => void }) {
  const slides = config.onboarding.slides;
  const [i, setI] = useState(Math.min(startAt, slides.length - 1));
  const [dir, setDir] = useState(1);
  useEffect(() => {
    track('onboarding_slide_view', { index: i, slide: slides[i].id });
    api('POST', '/onboarding', { step: 'slides', slidesSeen: i + 1 }).catch(() => {});
  }, [i, slides]);
  const go = (n: number) => {
    if (n >= slides.length) return onDone();
    if (n < 0) return;
    setDir(n > i ? 1 : -1);
    setI(n);
  };
  const s = slides[i];
  return (
    <div className="fixed inset-0 flex flex-col bg-white pt-safe pb-safe">
      <div className="flex h-11 items-center px-3">
        {i > 0 && (
          <button onClick={() => go(i - 1)} aria-label="Назад" className="grid h-10 w-10 place-items-center rounded-full text-ink-soft active:bg-cream">
            <IconBack size={22} />
          </button>
        )}
      </div>
      <div className="relative flex-1 overflow-hidden">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={s.id}
            custom={dir}
            className="absolute inset-0 flex flex-col px-6"
            initial={{ x: dir * 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: dir * -60, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.x < -60) go(i + 1);
              else if (info.offset.x > 60) go(i - 1);
            }}
          >
            <div className="min-h-[150px] flex-1 overflow-hidden">
              <SlideArt art={s.art} />
            </div>
            <div className="pb-4 pt-2">
              <h1 className="text-[24px] font-bold leading-[1.15] tracking-tight text-ink min-[400px]:text-[27px]">{s.title}</h1>
              <p className="mt-2.5 text-[15.5px] leading-relaxed text-ink-soft">{s.text}</p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="px-6">
        <div className="mb-5 flex justify-center gap-2" role="tablist" aria-label="Слайды">
          {slides.map((x, k) => (
            <button key={x.id} role="tab" aria-selected={k === i} aria-label={`Слайд ${k + 1}`} onClick={() => go(k)}
              className={cx('h-2 rounded-full transition-all duration-300', k === i ? 'w-6 bg-leaf-deep' : 'w-2 bg-ink-line')} />
          ))}
        </div>
        <Button className="w-full" onClick={() => go(i + 1)}>{i === slides.length - 1 ? 'Попробовать' : 'Дальше'}</Button>
      </div>
    </div>
  );
}
