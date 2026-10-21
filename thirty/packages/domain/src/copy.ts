/** Основная формулировка продукта (ТЗ §1) — без изменения смысла */
export const MAIN_PITCH =
  '30 дней, чтобы доказать себе, что ты можешь. Выбери цель, выполняй задания, отмечай прогресс каждый день. А мы дадим тебе бадди, окружение, еженедельные созвоны и возможность побороться за главный приз.';

export const GOAL_CATEGORIES = [
  { id: 'money', title: 'Деньги', emoji: '💰' },
  { id: 'weightloss', title: 'Похудение', emoji: '🥗' },
  { id: 'blog', title: 'Блог', emoji: '📱' },
  { id: 'english', title: 'Английский', emoji: '🇬🇧' },
  { id: 'habits', title: 'Привычки', emoji: '🌱' },
  { id: 'selfdev', title: 'Саморазвитие', emoji: '📚' },
] as const;

/** Пять постоянных тематических чатов */
export const TOPIC_CHATS = GOAL_CATEGORIES.filter((c) => c.id !== 'selfdev');

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
