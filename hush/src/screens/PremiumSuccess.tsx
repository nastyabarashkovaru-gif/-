import { useEffect } from 'react';
import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { BigIcon, Cta, Screen, Spacer, TopBar } from '@/ui';

/** Поздравление после оплаты подписки */
export function PremiumSuccessScreen({ pending }: { pending?: boolean }) {
  const nav = useNav();
  const { questionnaires, entitlement, refresh } = useAppState();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const backToAnswers = () =>
    nav.reset(questionnaires[0] ? { name: 'dashboard', qid: questionnaires[0].id } : { name: 'questions' });

  const yearly = entitlement.plan === 'year';

  return (
    <Screen fixed>
      <TopBar />
      <Spacer />
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 320, damping: 18 }}>
        <BigIcon>
          <Check size={30} strokeWidth={2} />
        </BigIcon>
      </motion.div>
      <motion.div
        className="flex flex-col gap-[12px] text-center"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.3 }}
      >
        <h1 className="h1">{pending ? 'Оплата прошла! 💜' : 'Поздравляем! Premium твой 💜'}</h1>
        <p className="muted !text-[16px]">
          {pending
            ? 'Подписка включится в течение пары минут — ответы откроются автоматически.'
            : yearly
              ? 'Теперь тебе доступны все ответы, новые анкеты, свои вопросы и безлимитное раскрытие авторов 👀'
              : 'Теперь тебе доступны все ответы, новые анкеты и свои вопросы 👀'}
        </p>
      </motion.div>
      <Spacer />
      <Cta icon="right" onClick={backToAnswers}>
        Вернуться к ответам
      </Cta>
      <div className="h-[24px] shrink-0" aria-hidden />
    </Screen>
  );
}
