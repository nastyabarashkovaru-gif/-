import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { WELCOME_TEASERS } from '@/data/questions';
import { useNav } from '@/nav/Navigator';
import { Cta, Screen, Spacer, TopBar } from '@/ui';

/** 01 — приветствие */
export function WelcomeScreen() {
  const nav = useNav();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setIndex((i) => (i + 1) % WELCOME_TEASERS.length), 3000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <Screen fixed>
      <TopBar />
      <h1 className="h1 mt-[45px]">
        Узнай анонимно, что о тебе <span className="text-purple-text">думают люди</span>
      </h1>
      <Spacer />
      <div className="flex flex-col gap-[21px] text-center">
        <p className="text-[24px] font-extrabold leading-[1.3]">Ты даже не представляешь, что о тебе говорят…</p>
        <div className="relative min-h-[51px]" aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={index}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="text-[18px] font-semibold leading-[1.4] text-purple-soft"
            >
              {WELCOME_TEASERS[index]}
            </motion.p>
          </AnimatePresence>
        </div>
        <p className="muted mx-auto max-w-[320px]">20+ других вопросов и возможность задать свои</p>
      </div>
      <Spacer />
      <Cta icon="right" onClick={() => nav.push({ name: 'questions' })}>
        Узнать, что обо мне думают
      </Cta>
      <div className="h-[40px] shrink-0" aria-hidden />
    </Screen>
  );
}
