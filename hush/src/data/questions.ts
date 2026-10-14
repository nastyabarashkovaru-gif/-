import catalog from '../../shared/questions.json';

export interface Question {
  id: string;
  text: string;
  /** Свой вопрос владельца (только Premium) */
  custom?: boolean;
  /** Расширенная библиотека — только Premium */
  premium?: boolean;
}

/** Каталог вопросов (10, свои вопросы не задаются). Общий для приложения и сервера: shared/questions.json */
export const QUESTIONS: Question[] = catalog;
/** 10 утверждённых вопросов — доступны всем */
export const BASE_QUESTIONS = QUESTIONS.filter((q) => !q.premium);
/** Расширенная библиотека — только по подписке */
export const LIBRARY_QUESTIONS = QUESTIONS.filter((q) => q.premium);

export const QUESTIONS_REQUIRED = 5;
export const CUSTOM_QUESTION_MAX = 140;

/** Фиолетовая строка на приветствии: первая — из макета, дальше вопросы каталога. */
export const WELCOME_TEASERS = [
  'Узнай свои сильные стороны, которые мы часто не видим со стороны',
  'Чем ты бесишь, о чём тебе не говорят?',
  'Чему ты втайне мне завидуешь?',
  'Что ты никогда не решался(ась) сказать мне в лицо?',
  'Какую правду обо мне мне давно пора услышать?',
  'Какая моя привычка отталкивает людей?',
];
