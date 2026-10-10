import catalog from '../../shared/questions.json';

export interface Question {
  id: string;
  text: string;
  /** Свой вопрос владельца (только Premium) */
  custom?: boolean;
}

/** Каталог готовых вопросов (21+). Общий для приложения и сервера: shared/questions.json */
export const QUESTIONS: Question[] = catalog;

export const QUESTIONS_REQUIRED = 5;
export const CUSTOM_QUESTION_MAX = 140;

/** Фиолетовая строка на приветствии: первая — из макета, дальше вопросы каталога. */
export const WELCOME_TEASERS = [
  'Чем ты бесишь, о чём тебе не говорят?',
  'Чему ты втайне мне завидуешь?',
  'Что ты никогда не решался(ась) сказать мне в лицо?',
  'Какую правду обо мне мне давно пора услышать?',
  'Какая моя привычка отталкивает людей?',
];
