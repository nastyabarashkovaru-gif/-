import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, type PanInfo } from 'motion/react';
import { ArrowRight, CircleDot, Lock, LockOpen, Send } from 'lucide-react';
import { RESULTS_THRESHOLD, usingMock, type RespondentView } from '@/api';
import { cn } from '@/lib/cn';
import { plural } from '@/lib/plural';
import { haptic } from '@/lib/telegram';
import { useNav } from '@/nav/Navigator';
import { useAppState } from '@/state/AppState';
import { carouselPosition, useResults } from '@/state/results';
import { Cta, LoadingScreen, MessageScreen, Screen, Segments, SettingsButton, Spacer, TopBar } from '@/ui';
import { useShare } from './Share';

/** 04/05 — в зависимости от числа ответов */
export function DashboardScreen({ qid }: { qid: string }) {
  const nav = useNav();
  const { questionnaires, refresh, entitlement } = useAppState();
  const questionnaire = questionnaires.find((q) => q.id === qid);
  const count = questionnaire?.respondentCount ?? 0;

  // С настоящим backend — периодически проверяем новые ответы
  useEffect(() => {
    if (usingMock) return;
    const id = window.setInterval(() => void refresh(), 15000);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  if (!questionnaire) {
    return (
      <MessageScreen
        icon={<CircleDot size={30} strokeWidth={1.8} />}
        title="Анкета не найдена"
        text="Возможно, она была удалена. Создай новую — это займёт минуту."
        action="Узнать, что обо мне думают"
        onAction={() => nav.reset({ name: 'questions' })}
      />
    );
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {count < RESULTS_THRESHOLD ? (
        <motion.div key="waiting" exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.25 }}>
          <WaitingView qid={qid} count={count} />
        </motion.div>
      ) : (
        <motion.div key="results" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <ResultsView qid={qid} version={`${count}:${entitlement.plan}`} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ───────────────────────── 04 — ожидание ───────────────────────── */

function WaitingView({ qid, count }: { qid: string; count: number }) {
  const nav = useNav();
  const share = useShare(qid);
  const left = RESULTS_THRESHOLD - count;

  return (
    <Screen fixed>
      <TopBar right={<SettingsButton onClick={() => nav.push({ name: 'settings' })} />} />
      <div className="mt-[28px] flex flex-col gap-[8px] text-center">
        <h1 className="h1">Твои ответы уже близко 👀</h1>
        <p className="muted !text-[16px]">Друзья постепенно раскрывают, что думают о тебе.</p>
      </div>
      <Spacer />
      <div className="flex flex-col items-center gap-[10px] text-center">
        <div className="flex items-baseline gap-[6px]" aria-label={`${count} из ${RESULTS_THRESHOLD}`}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={count}
              className="inline-block text-[44px] font-semibold leading-none"
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -18, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            >
              {count}
            </motion.span>
          </AnimatePresence>
          <span className="text-[26px] font-medium leading-none text-[#77737f]">/{RESULTS_THRESHOLD}</span>
        </div>
        <p className="text-[18px] font-medium text-purple-text">
          {plural(count, ['человек', 'человека', 'человек'])} {count === 1 ? 'ответил' : 'ответили'}
        </p>
      </div>
      <Segments filled={count} label="Ответили друзей" />
      <p className="small !text-[14px] -mt-[4px] text-center">
        Ещё {left} {plural(left, ['ответ', 'ответа', 'ответов'])} до открытия
      </p>
      <Spacer />
      <div className="card flex shrink-0 flex-col gap-[8px]">
        <div className="flex items-center gap-[10px] text-[17px] font-medium">
          <Lock size={19} strokeWidth={1.8} className="shrink-0 text-purple" aria-hidden />
          Почему ответы пока скрыты?
        </div>
        <p className="muted">
          Мы откроем ответы, когда анкету заполнят минимум 5 человек. Так сложнее догадаться, кто и что написал, и друзьям
          проще отвечать честно.
        </p>
      </div>
      <Cta leading={<Send size={20} strokeWidth={1.8} />} onClick={share}>
        Поделиться ещё раз
      </Cta>
      <p className="small !text-[14px] text-center">Отправь анкету ещё нескольким друзьям, чтобы быстрее открыть ответы.</p>
    </Screen>
  );
}

/* ───────────────────────── 05 — результаты ───────────────────────── */

const swipeVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? '100%' : '-100%', opacity: 0.4 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? '-100%' : '100%', opacity: 0.4 }),
};

function ResultsView({ qid, version }: { qid: string; version: string }) {
  const nav = useNav();
  const { isPremium } = useAppState();
  const { data, error, retry } = useResults(qid, version);
  const [[index, dir], setPage] = useState<[number, number]>([0, 1]);
  const restored = useRef(false);

  const respondents = data?.respondents ?? [];
  const total = respondents.length;
  const current = respondents[Math.min(index, Math.max(total - 1, 0))];

  // Восстанавливаем позицию карточки по id респондента (новые ответы её не сбивают)
  useEffect(() => {
    if (!data) return;
    const savedId = carouselPosition.get(qid);
    const found = savedId ? data.respondents.findIndex((r) => r.id === savedId) : -1;
    if (found >= 0) setPage([found, 1]);
    restored.current = true;
  }, [data, qid]);

  useEffect(() => {
    if (current && restored.current) carouselPosition.set(qid, current.id);
  }, [current, qid]);

  const go = (delta: number) => {
    if (total < 2) return;
    haptic.select();
    setPage(([i]) => [(i + delta + total) % total, delta]);
  };

  // Стрелки клавиатуры на десктопе
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const swipe = info.offset.x + info.velocity.x * 0.2;
    if (swipe < -60 && index < total - 1) go(1);
    else if (swipe > 60 && index > 0) go(-1);
  };

  if (!data && error) {
    return (
      <MessageScreen
        icon={<CircleDot size={30} strokeWidth={1.8} />}
        title="Не удалось загрузить"
        text="Проверь соединение и попробуй ещё раз."
        action="Повторить"
        onAction={retry}
      />
    );
  }
  if (!data || !current) return <LoadingScreen />;

  const createNew = () => nav.push(isPremium ? { name: 'questions' } : { name: 'premium' });

  return (
    <Screen fixed>
      <TopBar right={<SettingsButton onClick={() => nav.push({ name: 'settings' })} />} />
      <h1 className="h1">Вот что о тебе думают 👀</h1>
      <p className="muted">
        Тебе ответили {data.respondentCount} {plural(data.respondentCount, ['человек', 'человека', 'человек'])}
      </p>

      <div className="flex shrink-0 items-center justify-between">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={current.id} className="tag" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
            Аноним №{current.number}
          </motion.span>
        </AnimatePresence>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={total < 2}
          aria-label="Следующий аноним"
          className="small !text-[15px] -mr-2 flex items-center gap-[8px] px-2 py-2 tabular-nums active:opacity-60"
        >
          {index + 1} / {total}
          <ArrowRight size={16} strokeWidth={1.8} className="text-purple" aria-hidden />
        </button>
      </div>

      <div className="relative min-h-[260px] !shrink flex-1" aria-roledescription="карусель" aria-label="Ответы друзей">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={current.id}
            custom={dir}
            variants={swipeVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ x: { type: 'tween', duration: 0.3, ease: [0.32, 0.72, 0, 1] }, opacity: { duration: 0.2 } }}
            drag={total > 1 ? 'x' : false}
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.6}
            onDragEnd={onDragEnd}
            className="absolute inset-0"
          >
            <RespondentCard
              respondent={current}
              onUnlock={() => nav.push({ name: 'premium' })}
              onReveal={() => nav.push({ name: 'reveal', qid, respondentId: current.id })}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      <Cta onClick={createNew}>Задать новые вопросы 😍</Cta>
      <p className="small text-center">
        Создай новую анкету, чтобы узнать о себе ещё больше. Выбирай другие вопросы или придумай свои.
      </p>
    </Screen>
  );
}

export function AnswerList({ answers, compact }: { answers: RespondentView['answers']; compact?: boolean }) {
  return (
    <>
      {answers.map((a, i) => (
        <div key={a.questionId} className="contents">
          {i > 0 && <div className={cn('divider', compact ? 'my-[7px]' : '!bg-transparent')} />}
          <p className="small">{a.question}</p>
          <p className="text-[16px] leading-[1.4] text-[#f5f3f7]">{a.text}</p>
        </div>
      ))}
    </>
  );
}

function RespondentCard({ respondent, onUnlock, onReveal }: { respondent: RespondentView; onUnlock: () => void; onReveal: () => void }) {
  const open = respondent.answers.filter((a) => !a.locked);
  const locked = respondent.answers.filter((a) => a.locked);

  return (
    <div className="card no-scrollbar flex h-full flex-col gap-[12px] overflow-y-auto overscroll-contain">
      <AnswerList answers={open} />
      {locked.length > 0 && (
        <>
          <div className="divider !bg-transparent" />
          <div className="step">Другие результаты</div>
          {locked.map((a) => (
            <button key={a.questionId} type="button" onClick={onUnlock} className="flex flex-col gap-[12px] text-left">
              <span className="small">{a.question}</span>
              <span className="flex items-center gap-[8px] text-[14px] text-[#8f8b96]">
                <Lock size={15} strokeWidth={1.8} className="text-purple" aria-hidden />
                Ответ доступен по подписке
              </span>
            </button>
          ))}
        </>
      )}
      <div className="mt-auto flex flex-col gap-[10px] pt-[4px]">
        {locked.length > 0 && (
          <button type="button" onClick={onUnlock} className="cta-dark">
            <LockOpen size={18} strokeWidth={1.8} className="text-purple" aria-hidden /> Посмотреть скрытые ответы
          </button>
        )}
        <button type="button" onClick={onReveal} className="mx-auto flex items-center gap-[6px] px-2 py-1 text-[15px] font-medium text-purple-text active:opacity-60">
          Узнать, кто это написал 👀
          <ArrowRight size={16} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
    </div>
  );
}
