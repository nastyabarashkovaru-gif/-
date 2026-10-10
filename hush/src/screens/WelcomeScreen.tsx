import { motion, useReducedMotion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AppHeader, BottomBar, PrimaryButton, Screen } from '@/components/ui';

/** Ненавязчивая иллюстрация: стопка карточек с ответами, две из них скрыты. */
function SecretsStack() {
  const reduce = useReducedMotion();
  const float = (delay: number) =>
    reduce ? {} : { animate: { y: [0, -4, 0] }, transition: { duration: 5, repeat: Infinity, ease: 'easeInOut', delay } };

  return (
    <div className="relative mx-auto h-[232px] w-full max-w-[340px]" aria-hidden>
      {/* задняя карточка */}
      <motion.div
        {...float(0.6)}
        className="absolute left-8 right-8 top-0 rounded-card border border-border bg-[#13141B] px-4 py-3.5 opacity-70"
      >
        <p className="text-[12px] text-[#71717A]">Что ты никогда не решался(ась) сказать мне в лицо?</p>
        <LockedRow />
      </motion.div>

      {/* средняя карточка */}
      <motion.div
        {...float(0.3)}
        className="absolute left-4 right-4 top-[58px] rounded-card border border-border bg-surface px-4 py-3.5"
      >
        <p className="text-[12px] text-muted">Какую правду обо мне мне давно пора услышать?</p>
        <LockedRow />
      </motion.div>

      {/* передняя карточка */}
      <motion.div
        {...float(0)}
        className="absolute inset-x-0 top-[118px] rounded-card border border-accent/50 bg-[#1A1824] px-4 py-4 shadow-[0_24px_48px_-24px_rgba(137,92,246,0.45)]"
      >
        <div className="flex items-center justify-between">
          <p className="text-[12px] text-muted">Опиши меня тремя словами</p>
          <span className="text-[11px] text-[#71717A]">только что</span>
        </div>
        <p className="mt-1.5 font-display text-[19px] font-semibold tracking-[-0.01em] text-text">
          Огонь. Загадка. Опора.
        </p>
      </motion.div>
    </div>
  );
}

function LockedRow() {
  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-[10px] bg-surface2/80 px-2.5 py-2">
      <Lock size={12} className="text-accentSoft" />
      <span className="text-[12px] text-[#71717A]">Ответ скрыт</span>
    </div>
  );
}

export function WelcomeScreen() {
  const navigate = useNavigate();

  return (
    <Screen>
      <AppHeader />

      <div className="flex flex-1 flex-col px-gutter pb-2 pt-2">
        <div className="flex flex-1 items-center py-4">
          <SecretsStack />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, delay: 0.08 }}
          className="mt-2"
        >
          <h1 className="font-display text-[30px] font-bold leading-[36px] tracking-[-0.025em] min-[400px]:text-[32px] min-[400px]:leading-[38px]">
            Узнай, что о тебе думают <span className="text-accentSoft">на&nbsp;самом&nbsp;деле</span>
          </h1>
          <p className="mt-3 text-[16px] leading-6 text-muted">
            Отправь друзьям анонимную анкету и узнай, что они давно хотели тебе сказать.
          </p>
        </motion.div>
      </div>

      <BottomBar>
        <PrimaryButton onClick={() => navigate('/questions')}>Создать анкету бесплатно</PrimaryButton>
        <p className="mt-3 text-center text-[12px] leading-4 text-[#71717A]">Ответы анонимны · друзьям — 1 минута</p>
      </BottomBar>
    </Screen>
  );
}
