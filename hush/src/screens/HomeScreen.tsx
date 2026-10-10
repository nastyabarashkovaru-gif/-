import { AnimatePresence, motion } from 'framer-motion';
import { Lock, Plus, Send, Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  AnswerCard,
  AppHeader,
  BottomBar,
  EmptyState,
  PrimaryButton,
  ProgressBar,
  Screen,
  SecondaryButton,
  useToast,
  type AnswerItem,
} from '@/components/ui';
import { questionById } from '@/data/questions';
import { isAnswerVisible, pickFullyOpenResponseId, RESULTS_THRESHOLD } from '@/lib/access';
import { plural } from '@/lib/format';
import { shareLink } from '@/lib/share';
import { useAppState } from '@/state/AppState';
import type { Survey } from '@/state/types';

const SHARE_TEXT = 'Ответь анонимно на мою анкету в hush. 👀';

function useShare(survey: Survey | null) {
  const toast = useToast();
  return async () => {
    if (!survey) return;
    const result = await shareLink(survey.link, SHARE_TEXT);
    if (result === 'copied') toast('Ссылка скопирована — отправь её друзьям', 'success');
    if (result === 'failed') toast('Не получилось скопировать ссылку. Попробуй ещё раз', 'error');
  };
}

export function HomeScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { activeSurvey: survey, isPremium } = useAppState();
  const share = useShare(survey);
  const justPurchased = (location.state as { justPurchased?: boolean } | null)?.justPurchased ?? false;

  if (!survey) return <Navigate to="/" replace />;

  const count = survey.responses.length;
  const onNewSurvey = () => navigate(isPremium ? '/soon/builder' : '/soon/upsell');

  return (
    <Screen>
      <AppHeader onSettings={() => navigate('/soon/settings')} />

      <div className="px-gutter pt-1">
        <h1 className="font-display text-[24px] font-bold leading-[30px] tracking-[-0.02em]">Твои ответы</h1>
        <p className="mt-1 text-[14px] leading-5 text-muted">
          «{survey.title}» · {count} {plural(count, ['человек ответил', 'человека ответили', 'человек ответили'])}
        </p>
      </div>

      {count === 0 && <NoAnswers onShare={share} onNewSurvey={onNewSurvey} />}
      {count > 0 && count < RESULTS_THRESHOLD && <Waiting count={count} onShare={share} />}
      {count >= RESULTS_THRESHOLD && (
        <Results survey={survey} isPremium={isPremium} justPurchased={justPurchased} onShare={share} />
      )}
    </Screen>
  );
}

/* ——— Нет ответов ——— */

function NoAnswers({ onShare, onNewSurvey }: { onShare: () => void; onNewSurvey: () => void }) {
  return (
    <>
      <div className="px-gutter pt-5">
        <EmptyState
          icon={<Send size={20} />}
          title="Пока никто не ответил"
          description="Отправь анкету друзьям, чтобы узнать, что они о тебе думают."
        >
          <div className="mx-auto max-w-[260px]">
            <ProgressBar value={0} max={RESULTS_THRESHOLD} segmented label="Ответили" />
            <p className="mt-2 text-[13px] text-muted">0 / {RESULTS_THRESHOLD}</p>
          </div>
        </EmptyState>
      </div>
      <BottomBar>
        <PrimaryButton onClick={onShare}>Поделиться анкетой</PrimaryButton>
        <SecondaryButton variant="ghost" className="mt-1" icon={<Plus size={18} />} onClick={onNewSurvey}>
          Создать новую анкету
        </SecondaryButton>
      </BottomBar>
    </>
  );
}

/* ——— 1–4 ответа ——— */

function Waiting({ count, onShare }: { count: number; onShare: () => void }) {
  const left = RESULTS_THRESHOLD - count;
  return (
    <>
      <div className="px-gutter pt-5">
        <div className="rounded-card border border-border bg-surface p-5">
          <h2 className="text-[18px] font-semibold leading-6">Первые ответы уже приходят 👀</h2>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="font-display text-[28px] font-bold leading-8">
              {count} <span className="text-[18px] font-semibold text-muted">из {RESULTS_THRESHOLD}</span>
            </span>
          </div>
          <ProgressBar value={count} max={RESULTS_THRESHOLD} segmented className="mt-3" label="Ответили" />
          <p className="mt-4 flex gap-2 text-[14px] leading-5 text-muted">
            <Lock size={16} className="mt-0.5 shrink-0 text-accentSoft" />
            Ответы откроются, когда ответят ещё {left} {plural(left, ['человек', 'человека', 'человек'])}. Так никто не
            догадается, кто что написал.
          </p>
        </div>
      </div>
      <BottomBar>
        <PrimaryButton onClick={onShare}>Поделиться ещё раз</PrimaryButton>
      </BottomBar>
    </>
  );
}

/* ——— 5+ ответов ——— */

function Results({
  survey,
  isPremium,
  justPurchased,
  onShare,
}: {
  survey: Survey;
  isPremium: boolean;
  justPurchased: boolean;
  onShare: () => void;
}) {
  const navigate = useNavigate();
  const fullyOpenId = useMemo(() => pickFullyOpenResponseId(survey.responses), [survey.responses]);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(isPremium ? [survey.responses[0]?.id] : fullyOpenId ? [fullyOpenId] : []),
  );
  const [bannerVisible, setBannerVisible] = useState(justPurchased);
  const questions = survey.questionIds.map((id) => questionById(id).text);

  const cards = survey.responses.map((r, idx) => {
    const fullyOpen = r.id === fullyOpenId;
    const items: AnswerItem[] = r.answers.map((answer, i) => ({
      question: questions[i],
      answer,
      visible: isAnswerVisible(i, { premium: isPremium, fullyOpen }),
    }));
    return { response: r, number: idx + 1, items, fullyOpen };
  });

  const hiddenTotal = cards.reduce((sum, c) => sum + c.items.filter((i) => !i.visible).length, 0);
  const openPaywall = () => navigate('/paywall');

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="px-gutter pt-4">
        <AnimatePresence>
          {isPremium && bannerVisible && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.2 }}
              className="mb-3 flex items-center gap-3 rounded-card border border-accent/40 bg-[#1E1A2E] py-2 pl-4 pr-1"
            >
              <Sparkles size={18} className="shrink-0 text-accentSoft" />
              <p className="flex-1 text-[15px] font-medium">Все ответы открыты!</p>
              <button
                type="button"
                aria-label="Скрыть"
                onClick={() => setBannerVisible(false)}
                className="flex h-touch w-touch items-center justify-center rounded-control text-muted hover:text-text"
              >
                <X size={18} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {!isPremium && (
          <div className="mb-3 flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15">
              <Lock size={16} className="text-accentSoft" />
            </span>
            <p className="text-[14px] leading-5 text-muted">
              <span className="font-medium text-text">
                {hiddenTotal} {plural(hiddenTotal, ['ответ скрыт', 'ответа скрыто', 'ответов скрыто'])}
              </span>
              <br />
              Один ответ открыт целиком — остальные частично.
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2.5 px-gutter pb-2">
        {cards.map(({ response, number, items, fullyOpen }) => (
          <AnswerCard
            key={response.id}
            number={number}
            receivedAgo={response.receivedAgo}
            items={items}
            expanded={expanded.has(response.id)}
            onToggle={() => toggle(response.id)}
            onUnlock={openPaywall}
            badge={!isPremium && fullyOpen ? 'Открыт полностью' : undefined}
          />
        ))}
      </div>

      <BottomBar>
        {isPremium ? (
          <PrimaryButton icon={<Send size={18} />} onClick={onShare}>
            Пригласить ещё друзей
          </PrimaryButton>
        ) : (
          <PrimaryButton onClick={openPaywall}>Открыть все ответы</PrimaryButton>
        )}
      </BottomBar>
    </>
  );
}
