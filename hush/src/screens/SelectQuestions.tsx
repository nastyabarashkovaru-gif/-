import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useAnimationControls } from 'motion/react';
import { Check, Lock, Plus } from 'lucide-react';
import { track } from '@/lib/analytics';
import { api, ApiError } from '@/api';
import { CUSTOM_QUESTION_MAX, QUESTIONS, QUESTIONS_REQUIRED, type Question } from '@/data/questions';
import { cn } from '@/lib/cn';
import { haptic, requestWriteAccess } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { BackArrow, BigIcon, Cta, Modal, Screen, Segments, TopBar, useToast } from '@/ui';
import { CustomQuestionUpsell } from './Upsell';

/** Черновик выбора переживает переход на Premium и обратно */
const draftStore: { selected: Question[]; custom: Question[] } = { selected: [], custom: [] };

/** 02 — выбор ровно пяти вопросов */
export function SelectQuestionsScreen() {
  const nav = useNav();
  const toast = useToast();
  const { isPremium, refresh } = useAppState();
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [selected, setSelected] = useState<Question[]>(draftStore.selected);
  const [custom, setCustom] = useState<Question[]>(draftStore.custom);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const counter = useAnimationControls();

  useEffect(() => {
    draftStore.selected = selected;
    draftStore.custom = custom;
  }, [selected, custom]);

  const count = selected.length;
  const full = count >= QUESTIONS_REQUIRED;
  const list = [...custom, ...QUESTIONS];

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

  // Свои вопросы — только по подписке (сервер проверяет это же)
  const openCustom = () => {
    track('custom_question_clicked', 'select_questions');
    if (!isPremium) {
      track('custom_question_paywall_shown', 'select_questions');
      setUpsellOpen(true);
      return;
    }
    setComposing(true);
  };

  const addCustom = () => {
    const text = draft.trim().replace(/\s+/g, ' ');
    if (!text) return;
    const q: Question = { id: `custom-${Date.now()}`, text, custom: true };
    setCustom((c) => [q, ...c]);
    // Сразу выбираем, если есть свободное место из пяти
    setSelected((s) => (s.length < QUESTIONS_REQUIRED ? [...s, q] : s));
    setDraft('');
    setComposing(false);
    haptic.notify('success');
    track('custom_question_created', 'select_questions');
    if (full) toast.show('Вопрос добавлен. Сними выбор с другого, чтобы выбрать его');
  };

  const submit = async () => {
    if (!full) return;
    setSaving(true);
    try {
      const created = await api.createQuestionnaire(selected);
      draftStore.selected = [];
      draftStore.custom = [];
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
          {list.map((q) => {
            const isOn = selected.some((s) => s.id === q.id);
            return (
              <motion.button
                key={q.id}
                type="button"
                layout="position"
                initial={q.custom ? { opacity: 0, y: -8 } : false}
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

        <button
          type="button"
          onClick={openCustom}
          className="flex w-full shrink-0 items-center gap-[10px] rounded-[12px] border border-dashed border-[#4a3b5c] bg-[#101013] px-[13px] py-[14px] text-left text-[15px] font-medium leading-[1.35] text-purple-text active:scale-[0.99]"
        >
          <Plus size={17} strokeWidth={2} aria-hidden />
          <span className="flex-1">Добавить свой вопрос</span>
          {!isPremium && <Lock size={15} strokeWidth={1.8} className="text-[#8e8b97]" aria-label="Premium" />}
        </button>
      </div>

      <Cta icon="right" disabled={!full} loading={saving} onClick={submit}>
        Продолжить
      </Cta>
      <p className="small text-center">Ответы увидишь только ты</p>

      <Modal open={composing} onClose={() => setComposing(false)} labelledBy="custom-title" align="top">
        <div className="card-purple flex flex-col gap-[16px] !px-[18px] !py-[24px] text-center">
          <BigIcon size={56}>
            <Plus size={26} strokeWidth={1.8} />
          </BigIcon>
          <h2 id="custom-title" className="h2">
            О чём хочешь спросить? 👀
          </h2>
          <textarea
            autoFocus
            value={draft}
            maxLength={CUSTOM_QUESTION_MAX}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Напиши свой вопрос…"
            aria-label="Свой вопрос"
            className="w-full resize-none rounded-[14px] border border-[#514160] bg-[#131217] p-[14px] text-left text-[16px] leading-[1.4] text-white outline-none transition-colors placeholder:text-[#77717f] focus:border-purple"
          />
          <Cta onClick={addCustom} disabled={!draft.trim()}>
            Добавить вопрос
          </Cta>
          <button type="button" onClick={() => setComposing(false)} className="mx-auto -mt-[4px] px-3 py-2 text-[15px] text-[#a1a1aa] active:opacity-60">
            Отмена
          </button>
        </div>
      </Modal>
      <CustomQuestionUpsell open={upsellOpen} onClose={() => setUpsellOpen(false)} />
    </Screen>
  );
}
