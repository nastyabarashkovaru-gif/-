import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buildScenario, makeSurveyLink } from '@/data/scenarios';
import type { PlanId } from '@/data/pricing';
import { QUESTIONS_REQUIRED } from '@/data/questions';
import type { AppData, ScenarioId, Survey } from './types';

const STORAGE_KEY = 'hush.prototype.v1';

function load(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppData;
  } catch {
    /* хранилище недоступно — стартуем с нуля */
  }
  return buildScenario('new');
}

const PERIOD_END: Record<PlanId, string> = {
  month: '10 ноября 2026',
  quarter: '10 января 2027',
  year: '10 октября 2027',
};

interface AppStateValue {
  data: AppData;
  activeSurvey: Survey | null;
  isPremium: boolean;
  applyScenario: (id: ScenarioId) => void;
  toggleDraftQuestion: (id: string) => 'added' | 'removed' | 'limit';
  createSurveyFromDraft: () => Survey;
  purchase: (plan: PlanId) => void;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* noop */
    }
  }, [data]);

  const applyScenario = useCallback((id: ScenarioId) => setData(buildScenario(id)), []);

  const toggleDraftQuestion = useCallback(
    (id: string) => {
      const selected = data.draftQuestionIds;
      if (selected.includes(id)) {
        setData((d) => ({ ...d, draftQuestionIds: d.draftQuestionIds.filter((q) => q !== id) }));
        return 'removed' as const;
      }
      if (selected.length >= QUESTIONS_REQUIRED) return 'limit' as const;
      setData((d) => ({ ...d, draftQuestionIds: [...d.draftQuestionIds, id] }));
      return 'added' as const;
    },
    [data.draftQuestionIds],
  );

  const createSurveyFromDraft = useCallback((): Survey => {
    const id = Math.random().toString(36).slice(2, 8);
    const survey: Survey = {
      id,
      title: 'Что обо мне думают',
      questionIds: data.draftQuestionIds,
      link: makeSurveyLink(id),
      responses: [],
    };
    setData((d) => ({
      ...d,
      scenarioId: 'created-empty',
      surveys: [...d.surveys, survey],
      activeSurveyId: survey.id,
      draftQuestionIds: [],
    }));
    return survey;
  }, [data.draftQuestionIds]);

  const purchase = useCallback((plan: PlanId) => {
    setData((d) => ({ ...d, subscription: { plan, autoRenew: true, periodEnd: PERIOD_END[plan] } }));
  }, []);

  const value = useMemo<AppStateValue>(() => {
    const activeSurvey = data.surveys.find((s) => s.id === data.activeSurveyId) ?? null;
    return {
      data,
      activeSurvey,
      isPremium: data.subscription !== null,
      applyScenario,
      toggleDraftQuestion,
      createSurveyFromDraft,
      purchase,
    };
  }, [data, applyScenario, toggleDraftQuestion, createSurveyFromDraft, purchase]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}
