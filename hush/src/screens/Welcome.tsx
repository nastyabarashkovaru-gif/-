import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { WELCOME_TEASERS } from '@/data/questions';
import { cn } from '@/lib/cn';
import { useNav } from '@/nav/Navigator';
import { Cta, Screen, Spacer, TopBar } from '@/ui';

/** 01 — приветствие: заголовок, одна сменяющаяся фраза, белая кнопка */
export function WelcomeScreen() {
  const nav = useNav();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % WELCOME_TEASERS.length), 3000);
    return () => window.clearTimeout(id);
  }, [index]);

  return (
    <Screen fixed>
      <TopBar />
      <div className="mt-[40px] flex flex-col gap-[14px]">
        <h1 className="h1 !text-[31px] !leading-[1.15]">
          Узнай анонимно, что о тебе <span className="text-purple-text">думают люди</span>
        </h1>
        <p className="muted !text-[17px]">Ты даже не представляешь, что о тебе говорят…</p>
      </div>
      <Spacer />
      <div className="flex flex-col items-center gap-[18px] text-center">
        <div className="step">О чём ты узнаешь</div>
        <div className="relative flex min-h-[90px] w-full items-center justify-center" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="px-[8px] text-[23px] font-bold leading-[1.3] tracking-[-0.2px] text-purple-soft"
            >
              {WELCOME_TEASERS[index]}
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="flex items-center gap-[8px]" role="tablist" aria-label="Примеры вопросов">
          {WELCOME_TEASERS.map((t, i) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Вопрос ${i + 1}`}
              onClick={() => setIndex(i)}
              className={cn(
                'h-[7px] rounded-full transition-all duration-300',
                i === index ? 'w-[22px] bg-purple' : 'w-[7px] bg-[#4a4752]',
              )}
            />
          ))}
        </div>
      </div>
      <Spacer />
      <Cta icon="right" onClick={() => nav.push({ name: 'questions' })}>
        Узнать, что обо мне думают
      </Cta>
      <div className="h-[24px] shrink-0" aria-hidden />
    </Screen>
  );
}
