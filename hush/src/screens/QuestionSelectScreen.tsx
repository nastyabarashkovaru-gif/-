import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBack } from '@/lib/useBack';
import { AppHeader, BottomBar, PrimaryButton, ProgressBar, QuestionCard, Screen, useToast } from '@/components/ui';
import { QUESTIONS, QUESTIONS_REQUIRED } from '@/data/questions';
import { plural } from '@/lib/format';
import { haptic } from '@/lib/telegram';
import { useAppState } from '@/state/AppState';

export function QuestionSelectScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const back = useBack('/');
  const { data, toggleDraftQuestion, createSurveyFromDraft } = useAppState();
  const selected = data.draftQuestionIds;
  const count = selected.length;
  const ready = count === QUESTIONS_REQUIRED;
  const [shake, setShake] = useState<{ id: string; n: number } | null>(null);

  const onToggle = (id: string) => {
    const result = toggleDraftQuestion(id);
    if (result === 'limit') {
      haptic.notify('warning');
      setShake((s) => ({ id, n: (s?.n ?? 0) + 1 }));
      toast('Уже выбрано 5 вопросов. Сними один, чтобы выбрать другой');
    } else {
      haptic.select();
    }
  };

  const onCreate = () => {
    if (!ready) {
      const left = QUESTIONS_REQUIRED - count;
      toast(`Выбери ещё ${left} ${plural(left, ['вопрос', 'вопроса', 'вопросов'])}`);
      return;
    }
    createSurveyFromDraft();
    toast('Анкета создана', 'success');
    navigate('/home', { replace: true });
  };

  return (
    <Screen>
      <AppHeader onBack={back} />

      <div className="px-gutter pt-1">
        <h1 className="font-display text-[24px] font-bold leading-[30px] tracking-[-0.02em]">Что ты хочешь узнать о себе?</h1>
        <p className="mt-2 text-[15px] leading-[22px] text-muted">
          Выбери любые 5 вопросов, на которые ответят твои друзья.
        </p>
      </div>

      {/* Счётчик прилипает под шапкой, пока пользователь листает список */}
      <div className="sticky top-[calc(56px+var(--safe-top))] z-20 bg-bg/90 px-gutter pb-3 pt-4 backdrop-blur-xl">
        <div className="flex items-baseline justify-between">
          <p className="text-[14px] font-medium" aria-live="polite">
            Выбрано <span className={ready ? 'text-accentSoft' : 'text-text'}>{count}</span>{' '}
            <span className="text-muted">из {QUESTIONS_REQUIRED}</span>
          </p>
          {ready && <p className="text-[13px] text-accentSoft">Готово</p>}
        </div>
        <ProgressBar value={count} max={QUESTIONS_REQUIRED} segmented className="mt-2.5" label="Выбрано вопросов" />
      </div>

      <div className="space-y-2.5 px-gutter pb-2 pt-1">
        {QUESTIONS.map((q) => (
          <QuestionCard
            key={q.id}
            text={q.text}
            selected={selected.includes(q.id)}
            onToggle={() => onToggle(q.id)}
            shakeSignal={shake?.id === q.id ? shake.n : undefined}
          />
        ))}
      </div>

      <BottomBar>
        <PrimaryButton softDisabled={!ready} onClick={onCreate}>
          Создать мою анкету
        </PrimaryButton>
      </BottomBar>
    </Screen>
  );
}
