export interface Question {
  id: string;
  text: string;
}

/** Готовые вопросы анкеты (экран «Выбор вопросов»). */
export const QUESTIONS: Question[] = [
  { id: 'q1', text: 'Назови три мои самые сильные черты.' },
  { id: 'q2', text: 'Почему ты хочешь со мной общаться?' },
  { id: 'q3', text: 'В чём я точно лучше других?' },
  { id: 'q4', text: 'Какая моя черта тебя сильно бесит, но ты о ней молчишь?' },
  { id: 'q5', text: 'Какая моя привычка отталкивает людей?' },
  { id: 'q6', text: 'Что ты никогда не решался(ась) сказать мне в лицо?' },
  { id: 'q7', text: 'Что плохого во мне видят другие, чего я сам(а) не замечаю?' },
  { id: 'q8', text: 'Опиши меня тремя словами.' },
  { id: 'q9', text: 'Чему ты втайне мне завидуешь?' },
  { id: 'q10', text: 'Какую правду обо мне мне давно пора услышать?' },
];

export const QUESTIONS_REQUIRED = 5;

export function questionById(id: string): Question {
  const q = QUESTIONS.find((item) => item.id === id);
  if (!q) throw new Error(`Unknown question ${id}`);
  return q;
}
