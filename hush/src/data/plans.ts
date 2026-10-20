export type PlanId = 'week' | 'month' | 'quarter' | 'year';

export interface Plan {
  id: PlanId;
  title: string;
  /** Подпись под названием */
  caption: string;
  price: number;
  /** Подпись в настройках (макет 10/10b) */
  settingsTitle: string;
  periodLabel: string;
}

/** Обычные цены; price в PLANS — цена по 3-часовому предложению (точные цены считает сервер) */
export const STANDARD_PRICES: Record<PlanId, number> = { week: 299, month: 990, quarter: 1490, year: 6990 };

export const PLANS: Plan[] = [
  { id: 'week', title: '1 неделя', caption: 'Попробовать', price: 99, settingsTitle: 'Premium на неделю', periodLabel: 'нед' },
  { id: 'month', title: '1 месяц', caption: 'Все функции hush.', price: 299, settingsTitle: 'Месячный Premium', periodLabel: 'мес' },
  { id: 'quarter', title: '3 месяца', caption: 'Все функции hush.', price: 499, settingsTitle: 'Premium на 3 месяца', periodLabel: '3 мес' },
  { id: 'year', title: '1 год', caption: '≈ 125 ₽ в месяц', price: 1499, settingsTitle: 'Годовой Premium', periodLabel: 'год' },
];

/** Тариф по умолчанию */
export const DEFAULT_PLAN: PlanId = 'month';
/** Тарифы для новых покупок; 3 месяца — только у ранее оформивших */
export const SOLD_PLAN_IDS: PlanId[] = ['week', 'month', 'year'];

export const planById = (id: PlanId): Plan => PLANS.find((p) => p.id === id)!;

export const PLAN_SUBTITLE: Record<PlanId, string> = {
  week: 'Недельная подписка',
  month: 'Месячная подписка',
  quarter: 'Подписка на 3 месяца',
  year: 'Годовая подписка',
};
