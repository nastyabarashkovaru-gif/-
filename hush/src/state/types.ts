import type { PlanId } from '@/data/pricing';
import type { SurveyResponse } from '@/data/responses';

export interface Survey {
  id: string;
  title: string;
  questionIds: string[];
  link: string;
  responses: SurveyResponse[];
}

export interface Subscription {
  plan: PlanId;
  autoRenew: boolean;
  /** Дата следующего списания / окончания доступа (демо). */
  periodEnd: string;
}

export interface UserProfile {
  name: string;
  username: string;
}

export interface AppData {
  scenarioId: ScenarioId;
  user: UserProfile;
  surveys: Survey[];
  activeSurveyId: string | null;
  subscription: Subscription | null;
  /** Черновик выбора вопросов на экране «Что ты хочешь узнать о себе?». */
  draftQuestionIds: string[];
}

export type ScenarioId =
  | 'new'
  | 'created-empty'
  | 'three-answers'
  | 'seven-free'
  | 'sub-month'
  | 'sub-quarter'
  | 'sub-year'
  | 'multi-surveys'
  | 'respondent'
  | 'autorenew-off';
