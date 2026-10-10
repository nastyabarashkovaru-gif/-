import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CircleDot, SearchX } from 'lucide-react';
import { api, ApiError, DISCLOSURE_VERSION, type ApiErrorCode, type PublicQuestionnaire } from '@/api';
import { QUESTIONS_REQUIRED } from '@/data/questions';
import { cn } from '@/lib/cn';
import { haptic } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { Cta, LoadingScreen, Logo, MessageScreen, Segments, SmallBack, TopBar, useToast } from '@/ui';

const ANSWER_MAX = 1000;

const slide = {
  enter: (dir: number) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? '-100%' : '100%', opacity: 0 }),
};

type Choice = 'anonymous' | 'reveal';

/** 08 — пять шагов ответов, 08b — выбор анонимности, затем атомарная отправка */
export function AnswerScreen({ qid }: { qid: string }) {
  const nav = useNav();
  const toast = useToast();
  const { questionnaires } = useAppState();
  const [form, setForm] = useState<PublicQuestionnaire>();
  const [loadError, setLoadError] = useState<ApiErrorCode>();
  const [[step, dir], setStep] = useState<[number, number]>([0, 1]);
  const [answers, setAnswers] = useState<string[]>(() => Array(QUESTIONS_REQUIRED).fill(''));
  const [choice, setChoice] = useState<Choice>('anonymous');
  const [sending, setSending] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

  const load = () => {
    setLoadError(undefined);
    api
      .openForResponse(qid)
      .then(setForm)
      .catch((e) => setLoadError(e instanceof ApiError ? e.code : 'network'));
  };
  useEffect(load, [qid]);

  const goHome = () =>
    nav.reset(questionnaires[0] ? { name: 'dashboard', qid: questionnaires[0].id } : { name: 'questions' });

  if (loadError) return <AnswerError code={loadError} qid={qid} onRetry={load} onHome={goHome} />;
  if (!form) return <LoadingScreen />;

  const isChoice = step === QUESTIONS_REQUIRED;
  const current = answers[step] ?? '';
  const canNext = isChoice || current.trim().length > 0;

  const move = (delta: number) => {
    haptic.tap();
    setStep(([s]) => [s + delta, delta]);
  };

  const submit = async () => {
    setSending(true);
    try {
      await api.submitResponses({
        questionnaireId: form.id,
        answers: form.questions.map((q, i) => ({ questionId: q.id, text: answers[i].trim() })),
        consent: { revealIdentity: choice === 'reveal', disclosureVersion: DISCLOSURE_VERSION, decidedAt: new Date().toISOString() },
        idempotencyKey: idempotencyKey.current,
      });
      haptic.notify('success');
      nav.reset({ name: 'success' });
    } catch (e) {
      setSending(false);
      if (e instanceof ApiError && e.code === 'already_answered') setLoadError('already_answered');
      else toast.show('Не удалось отправить ответы. Попробуй ещё раз');
    }
  };

  return (
    <div className="screen screen-fixed" style={{ height: 'var(--tg-viewport-height, 100dvh)' }}>
      <TopBar left={<Logo />} right={<span className="step tabular-nums">{isChoice ? 'Последний шаг' : `${step + 1} / ${QUESTIONS_REQUIRED}`}</span>} />
      <Segments filled={isChoice ? QUESTIONS_REQUIRED : step + 1} label="Прогресс" />

      <div className="relative -mx-[23px] flex min-h-[300px] !shrink flex-1 overflow-hidden">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={step}
            custom={dir}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ x: { type: 'tween', duration: 0.3, ease: [0.32, 0.72, 0, 1] }, opacity: { duration: 0.2 } }}
            className="no-scrollbar flex w-full shrink-0 flex-col gap-[19px] overflow-y-auto px-[23px]"
          >
            <div className="flex-1" />
            {isChoice ? (
              <AnonymityChoice value={choice} onChange={setChoice} />
            ) : (
              <>
                <div className="text-[16px] font-medium text-purple-text">Вопрос {step + 1}</div>
                <h1 className="h1" id={`q-${step}`}>
                  {form.questions[step].text}
                </h1>
                <textarea
                  value={current}
                  maxLength={ANSWER_MAX}
                  aria-labelledby={`q-${step}`}
                  onChange={(e) => {
                    const value = e.target.value;
                    setAnswers((a) => a.map((item, i) => (i === step ? value : item)));
                  }}
                  placeholder="Отвечай максимально честно"
                  className="min-h-[160px] w-full shrink-0 resize-none rounded-[18px] border border-[#514160] bg-[#131217] p-[16px] text-[16px] leading-[1.4] text-white outline-none transition-colors placeholder:text-[#77717f] focus:border-purple"
                />
              </>
            )}
            <div className="flex-1" />
          </motion.div>
        </AnimatePresence>
      </div>

      <Cta icon={isChoice ? 'upRight' : 'right'} disabled={!canNext} loading={sending} onClick={isChoice ? submit : () => move(1)}>
        {isChoice ? 'Отправить ответы' : step === QUESTIONS_REQUIRED - 1 ? 'Продолжить' : 'Следующий вопрос'}
      </Cta>
      <div className={cn('flex justify-center', step === 0 && 'invisible')}>
        <SmallBack onClick={() => step > 0 && move(-1)} />
      </div>
    </div>
  );
}

function AnonymityChoice({ value, onChange }: { value: Choice; onChange: (c: Choice) => void }) {
  const options: Array<{ id: Choice; title: string; text: string }> = [
    { id: 'anonymous', title: 'Да, остаться анонимным', text: 'Твой Telegram-профиль не будет раскрыт.' },
    {
      id: 'reveal',
      title: 'Разрешить узнать, кто я',
      text: 'Автор анкеты сможет увидеть твой Telegram-профиль за дополнительную плату или в рамках годовой подписки.',
    },
  ];
  return (
    <>
      <h1 className="h1">Остаться анонимным? 👀</h1>
      <p className="muted">Выбери, сможет ли автор анкеты узнать, кто оставил ответы.</p>
      <div role="radiogroup" aria-label="Анонимность" className="flex flex-col gap-[19px]">
        {options.map((o) => {
          const on = value === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                haptic.select();
                onChange(o.id);
              }}
              className={cn('text-left transition-colors duration-200', on ? 'card-purple' : 'card')}
            >
              <div className="flex items-center gap-[12px] text-[17px] font-medium">
                <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 border-white" aria-hidden>
                  <motion.span className="h-[8px] w-[8px] rounded-full bg-white" initial={false} animate={{ scale: on ? 1 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
                </span>
                {o.title}
              </div>
              <div className="small !text-[14px] ml-[30px] mt-[8px]">{o.text}</div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function AnswerError({ code, qid, onRetry, onHome }: { code: ApiErrorCode; qid: string; onRetry: () => void; onHome: () => void }) {
  const nav = useNav();
  if (code === 'own_questionnaire')
    return (
      <MessageScreen
        icon={<CircleDot size={30} strokeWidth={1.8} />}
        title="Это твоя анкета"
        text="Отвечать на свою анкету нельзя — отправь ссылку друзьям."
        action="Перейти к моим ответам"
        onAction={() => nav.reset({ name: 'dashboard', qid })}
      />
    );
  if (code === 'already_answered')
    return (
      <MessageScreen
        icon={<CircleDot size={30} strokeWidth={1.8} />}
        title="Ты уже ответил(а) 💜"
        text="На одну анкету можно ответить только один раз. Спасибо за честность!"
        action="Узнать, что обо мне думают"
        onAction={onHome}
      />
    );
  if (code === 'not_found')
    return (
      <MessageScreen
        icon={<SearchX size={28} strokeWidth={1.8} />}
        title="Анкета не найдена"
        text="Проверь ссылку или попроси друга отправить её ещё раз."
        action="Узнать, что обо мне думают"
        onAction={onHome}
      />
    );
  return (
    <MessageScreen
      icon={<CircleDot size={30} strokeWidth={1.8} />}
      title="Нет соединения"
      text="Проверь интернет и попробуй ещё раз."
      action="Повторить"
      onAction={onRetry}
    />
  );
}
