import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import { Check } from 'lucide-react';
import { api, ApiError } from '@/api';
import { QUESTIONS, QUESTIONS_REQUIRED, type Question } from '@/data/questions';
import { cn } from '@/lib/cn';
import { haptic, requestWriteAccess } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { BackArrow, Cta, Screen, Segments, TopBar, useToast } from '@/ui';

/** Черновик выбора переживает переход на Premium и обратно */
const draftStore: { selected: Question[] } = { selected: [] };

/** 02 — выбор ровно пяти вопросов */
export function SelectQuestionsScreen() {
  const nav = useNav();
  const toast = useToast();
  const { refresh } = useAppState();
  const [selected, setSelected] = useState<Question[]>(draftStore.selected);
  const [saving, setSaving] = useState(false);
  const counter = useAnimationControls();

  useEffect(() => {
    draftStore.selected = selected;
  }, [selected]);

  const count = selected.length;
  const full = count >= QUESTIONS_REQUIRED;

  const tooMany = () => {
    haptic.notify('warning');
    void counter.start({ x: [0, -6, 6, -4, 4, 0], transition: { duration: 0.35 } });
    toast.show('Можно выбрать только 5 вопросов');
  };

  const toggle = (q: Question) => {
    if (selected.some((s) => s.id === q.id)) {
      haptic.select();
      setSelected((s) => s.filter((item) => item.id !== q.id));
      return;
    }
    if (full) return tooMany();
    haptic.select();
    setSelected((s) => [...s, q]);
  };

  const submit = async () => {
    if (!full) return;
    setSaving(true);
    try {
      const created = await api.createQuestionnaire(selected);
      draftStore.selected = [];
      await refresh();
      haptic.notify('success');
      nav.reset({ name: 'share', qid: created.id });
      // Разрешение нужно, чтобы бот прислал уведомление, когда ответят 5 друзей
      void requestWriteAccess().then((granted) => {
        if (granted) api.grantWriteAccess().catch(() => {});
      });
    } catch (e) {
      setSaving(false);
      if (e instanceof ApiError && e.code === 'premium_required') nav.push({ name: 'premium' });
      else toast.show('Не удалось создать анкету. Попробуй ещё раз');
    }
  };

  return (
    <Screen fixed>
      <TopBar
        left={<BackArrow onClick={() => (nav.canGoBack ? nav.back() : nav.reset({ name: 'welcome' }))} />}
        right={<span className="step">Шаг 1 из 2</span>}
      />
      <h1 className="h1">Что хочешь узнать о себе?</h1>
      <p className="muted">Выбери 5 вопросов, на которые друзья ответят анонимно.</p>
      <motion.div animate={counter} className="flex shrink-0 justify-between text-[15px]">
        <span className="font-semibold">
          Выбрано {count} из {QUESTIONS_REQUIRED}
        </span>
        <span className="text-purple-text">
          {count} / {QUESTIONS_REQUIRED}
        </span>
      </motion.div>
      <Segments filled={count} label="Выбрано вопросов" />

      <div className="no-scrollbar -mx-[23px] flex min-h-[200px] !shrink flex-1 flex-col gap-[9px] overflow-y-auto px-[23px] pb-1" role="group" aria-label="Вопросы">
        <AnimatePresence initial={false}>
          {QUESTIONS.map((q) => {
            const isOn = selected.some((s) => s.id === q.id);
            return (
              <motion.button
                key={q.id}
                type="button"
                layout="position"
                initial={false}
                animate={{ opacity: 1, y: 0 }}
                aria-pressed={isOn}
                onClick={() => toggle(q)}
                className={cn(
                  'flex w-full shrink-0 items-center rounded-[12px] border px-[13px] py-[14px] text-left text-[15px] leading-[1.35] transition-colors duration-200 active:scale-[0.99]',
                  isOn ? 'border-purple bg-[#1a1223]' : 'border-line bg-[#101013]',
                )}
              >
                <AnimatePresence initial={false}>
                  {isOn && (
                    <motion.span
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 28, opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="flex shrink-0 overflow-hidden text-purple-check"
                      aria-hidden
                    >
                      <Check size={17} strokeWidth={2} className="shrink-0" />
                    </motion.span>
                  )}
                </AnimatePresence>
                <span>{q.text}</span>
              </motion.button>
            );
          })}
        </AnimatePresence>

      </div>

      <Cta icon="right" disabled={!full} loading={saving} onClick={submit}>
        Продолжить
      </Cta>
      <p className="small text-center">Ответы увидишь только ты</p>
    </Screen>
  );
}
