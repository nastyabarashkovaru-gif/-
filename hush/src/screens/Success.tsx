import { motion } from 'motion/react';
import { Check, Sparkles } from 'lucide-react';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { BigIcon, CloseButton, Cta, Screen, Spacer, TopBar } from '@/ui';

/** 09 — ответы отправлены + вирусный CTA */
export function SuccessScreen() {
  const nav = useNav();
  const { questionnaires } = useAppState();
  const own = questionnaires[0];
  // Приветствие пропускаем: сразу к выбору вопросов (или к своим ответам, если анкета уже есть)
  const start = () => nav.reset(own ? { name: 'dashboard', qid: own.id } : { name: 'questions' });
  const close = () => nav.reset(own ? { name: 'dashboard', qid: own.id } : { name: 'welcome' });

  return (
    <Screen fixed>
      <TopBar right={<CloseButton onClick={close} />} />
      <Spacer />
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 18 }}>
        <BigIcon>
          <Check size={28} strokeWidth={2} />
        </BigIcon>
      </motion.div>
      <h1 className="h1 text-center">Твои ответы отправлены! 💜</h1>
      <p className="muted text-center">Спасибо за честность!</p>
      <motion.div
        className="card-purple flex shrink-0 flex-col gap-[17px] !px-[17px] !py-[25px] text-center"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.35 }}
      >
        <div className="flex items-center justify-center gap-[6px] text-[15px] font-medium text-purple-text">
          <Sparkles size={17} strokeWidth={1.8} aria-hidden />А теперь твоя очередь
        </div>
        <h2 className="h2">А что друзья думают о тебе? 👀</h2>
        <p className="muted">Выбери 5 вопросов, отправь друзьям и узнай, что они никогда не говорили тебе в лицо.</p>
      </motion.div>
      <Spacer />
      <Cta icon="right" onClick={start}>
        Узнать, что обо мне думают
      </Cta>
      <p className="small text-center">Создай свою анкету за минуту</p>
    </Screen>
  );
}
