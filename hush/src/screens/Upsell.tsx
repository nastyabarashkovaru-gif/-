import { useState } from 'react';
import { LockOpen, Plus } from 'lucide-react';
import { track } from '@/lib/analytics';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { UpsellModal } from '@/ui';

/**
 * «Задать новые вопросы 😍»: с подпиской — создание анкеты,
 * без подписки — модальное предложение Premium поверх текущего экрана.
 */
export function useNewQuestionnaire(source: 'results' | 'my_questionnaires') {
  const nav = useNav();
  const { isPremium, questionnaires } = useAppState();
  const [open, setOpen] = useState(false);

  const onClick = () => {
    track('new_questionnaire_clicked', source);
    // Первая анкета бесплатная
    if (isPremium || questionnaires.length === 0) {
      nav.push({ name: 'questions' });
      return;
    }
    track('new_questionnaire_paywall_shown', source);
    setOpen(true);
  };

  const modal = (
    <UpsellModal
      open={open}
      onClose={() => setOpen(false)}
      onOpenPremium={() => {
        track('premium_upsell_clicked', 'new_questionnaire');
        setOpen(false);
        nav.push({ name: 'premium', source: 'new_questionnaire' });
      }}
      icon={<LockOpen size={28} strokeWidth={1.8} />}
      title="Хочешь узнать о себе ещё больше? 👀"
      text="Создавай новые анкеты без ограничений, выбирай другие вопросы и придумывай свои."
    />
  );

  return { onClick, modal };
}

/** Модалка «Хочешь задать свой вопрос? 👀» для бесплатного тарифа */
export function CustomQuestionUpsell({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNav();
  return (
    <UpsellModal
      open={open}
      onClose={onClose}
      onOpenPremium={() => {
        track('premium_upsell_clicked', 'custom_question');
        onClose();
        nav.push({ name: 'premium', source: 'custom_question' });
      }}
      icon={<Plus size={30} strokeWidth={1.8} />}
      title="Хочешь задать свой вопрос? 👀"
      text="С Premium ты можешь спрашивать друзей о чём угодно и узнавать то, что давно хотел."
    />
  );
}

/** Модалка «Расширенная библиотека вопросов» для бесплатного тарифа */
export function LibraryUpsell({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNav();
  return (
    <UpsellModal
      open={open}
      onClose={onClose}
      onOpenPremium={() => {
        track('premium_upsell_clicked', 'question_library');
        onClose();
        nav.push({ name: 'premium', source: 'question_library' });
      }}
      icon={<LockOpen size={28} strokeWidth={1.8} />}
      title="Хочешь больше вопросов? 👀"
      text="С Premium тебе доступна расширенная библиотека вопросов — и можно придумывать свои."
    />
  );
}
