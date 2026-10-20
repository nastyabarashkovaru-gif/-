import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Clock } from 'lucide-react';
import { api } from '@/api';
import { config } from '@/config';
import { haptic, openExternal } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { BigIcon, Cta, Screen, Spacer, TopBar } from '@/ui';

/** Сколько ждём уведомление CloudPayments, прежде чем предложить поддержку */
const WAIT_MS = 2 * 60_000;

type Phase = 'confirmed' | 'waiting' | 'delayed';

/**
 * После оплаты подписки.
 * Виджет уже сообщил об успешной оплате, но Premium включает сервер — по уведомлению CloudPayments.
 * Пока оно не пришло, честно показываем ожидание и сами переключаемся на поздравление.
 */
export function PremiumSuccessScreen({ pending }: { pending?: boolean }) {
  const nav = useNav();
  const { refresh } = useAppState();
  const [phase, setPhase] = useState<Phase>(pending ? 'waiting' : 'confirmed');

  useEffect(() => {
    if (phase !== 'waiting') {
      void refresh();
      return;
    }
    let stopped = false;
    const started = Date.now();
    const poll = async () => {
      while (!stopped && Date.now() - started < WAIT_MS) {
        const result = await api.restorePurchases().catch(() => null);
        if (stopped) return;
        if (result?.status === 'ok') {
          await refresh();
          haptic.notify('success');
          setPhase('confirmed');
          return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!stopped) setPhase('delayed');
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [phase, refresh]);

  const backToAnswers = () =>
    nav.reset({ name: 'inbox' });
  const support = () => openExternal(config.supportUrl || `https://t.me/${config.botUsername}`);

  const content = {
    confirmed: {
      title: 'Поздравляем! Premium твой 💜',
      text: 'Теперь можно узнать, кто тебя спросил и кто ответил, смотреть все ответы и задавать сколько угодно своих вопросов 👀',
    },
    waiting: {
      title: 'Подтверждаем оплату…',
      text: 'Обычно это занимает несколько секунд. Не закрывай приложение.',
    },
    delayed: {
      title: 'Подтверждение задерживается',
      text: 'Premium включится автоматически, как только платёжная система подтвердит оплату. Если этого не произошло в течение 10 минут — напиши нам, разберёмся.',
    },
  }[phase];

  return (
    <Screen fixed>
      <TopBar />
      <Spacer />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={phase}
          className="flex flex-col items-center gap-[19px] text-center"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3 }}
        >
          <BigIcon>
            {phase === 'confirmed' ? (
              <Check size={30} strokeWidth={2} />
            ) : phase === 'waiting' ? (
              <motion.span
                className="block h-[30px] w-[30px] rounded-full border-[3px] border-[#b98cff] border-t-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                aria-label="Ожидание"
              />
            ) : (
              <Clock size={28} strokeWidth={1.8} />
            )}
          </BigIcon>
          <h1 className="h1">{content.title}</h1>
          <p className="muted !text-[16px]" aria-live="polite">
            {content.text}
          </p>
        </motion.div>
      </AnimatePresence>
      <Spacer />
      {phase !== 'waiting' && (
        <Cta icon="right" onClick={backToAnswers}>
          Вернуться к ответам
        </Cta>
      )}
      {phase === 'delayed' ? (
        <button type="button" onClick={support} className="mx-auto -my-1 px-2 py-1 text-[15px] text-[#a1a1aa] underline underline-offset-[3px]">
          Написать в поддержку
        </button>
      ) : (
        <div className="h-[24px] shrink-0" aria-hidden />
      )}
    </Screen>
  );
}
