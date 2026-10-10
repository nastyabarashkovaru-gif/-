import type { AppData, ScenarioId, Survey } from '@/state/types';
import { DEMO_RESPONSES, DEMO_SURVEY_QUESTIONS } from './responses';

export const DEMO_USER = { name: 'Саша Миронова', username: 'sasha_m' };

export function makeSurveyLink(id: string): string {
  return `https://t.me/hush_app_bot?startapp=${id}`;
}

function mainSurvey(responseCount: number): Survey {
  return {
    id: 'a7k2m9',
    title: 'Что обо мне думают',
    questionIds: DEMO_SURVEY_QUESTIONS,
    link: makeSurveyLink('a7k2m9'),
    responses: DEMO_RESPONSES.slice(DEMO_RESPONSES.length - responseCount),
  };
}

export interface ScenarioMeta {
  id: ScenarioId;
  title: string;
  hint: string;
  /** Маршрут, который открывается после выбора сценария. */
  route: string;
}

export const SCENARIOS: ScenarioMeta[] = [
  { id: 'new', title: 'Новый пользователь', hint: 'Нет анкет', route: '/' },
  { id: 'created-empty', title: 'Анкета создана', hint: '0 ответов', route: '/home' },
  { id: 'three-answers', title: 'Три ответа', hint: '3 из 5, результаты закрыты', route: '/home' },
  { id: 'seven-free', title: 'Семь ответов', hint: 'Без подписки', route: '/home' },
  { id: 'sub-month', title: 'Подписка · 1 месяц', hint: '7 ответов открыты', route: '/home' },
  { id: 'sub-quarter', title: 'Подписка · 3 месяца', hint: '7 ответов открыты', route: '/home' },
  { id: 'sub-year', title: 'Подписка · 1 год', hint: 'Раскрытие автора включено', route: '/home' },
  { id: 'multi-surveys', title: 'Несколько анкет', hint: 'Годовая подписка, 3 анкеты', route: '/home' },
  { id: 'respondent', title: 'Отвечает на чужую анкету', hint: 'Режим друга', route: '/answer/a7k2m9' },
  { id: 'autorenew-off', title: 'Автопродление выключено', hint: '3 месяца, доступ до конца срока', route: '/home' },
];

export function buildScenario(id: ScenarioId): AppData {
  const base: AppData = {
    scenarioId: id,
    user: DEMO_USER,
    surveys: [],
    activeSurveyId: null,
    subscription: null,
    draftQuestionIds: [],
  };

  const withMain = (count: number): AppData => {
    const survey = mainSurvey(count);
    return { ...base, surveys: [survey], activeSurveyId: survey.id };
  };

  switch (id) {
    case 'new':
      return base;
    case 'created-empty':
      return withMain(0);
    case 'three-answers':
      return withMain(3);
    case 'seven-free':
    case 'respondent':
      return withMain(7);
    case 'sub-month':
      return { ...withMain(7), subscription: { plan: 'month', autoRenew: true, periodEnd: '10 ноября 2026' } };
    case 'sub-quarter':
      return { ...withMain(7), subscription: { plan: 'quarter', autoRenew: true, periodEnd: '10 января 2027' } };
    case 'sub-year':
      return { ...withMain(7), subscription: { plan: 'year', autoRenew: true, periodEnd: '10 октября 2027' } };
    case 'autorenew-off':
      return { ...withMain(7), subscription: { plan: 'quarter', autoRenew: false, periodEnd: '10 января 2027' } };
    case 'multi-surveys': {
      const main = mainSurvey(7);
      const work: Survey = {
        id: 'w3p8x1',
        title: 'Какой я коллега',
        questionIds: ['q3', 'q5', 'q7', 'q2', 'q9'],
        link: makeSurveyLink('w3p8x1'),
        responses: [],
      };
      return {
        ...base,
        surveys: [main, work],
        activeSurveyId: main.id,
        subscription: { plan: 'year', autoRenew: true, periodEnd: '10 октября 2027' },
      };
    }
  }
}
