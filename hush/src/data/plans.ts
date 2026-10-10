export type PlanId = 'month' | 'quarter' | 'year';

export interface Plan {
  id: PlanId;
  title: string;
  /** Подпись под названием (макет 06) */
  caption: string;
  price: number;
  perMonth?: number;
  /** Выгода относительно помесячной оплаты 299 ₽ */
  savings?: number;
  /** Подпись в настройках (макет 10/10b) */
  settingsTitle: string;
  periodLabel: string;
  /** Раскрытие авторов, давших согласие — только на годовом */
  unlimitedReveals: boolean;
}

export const PLANS: Plan[] = [
  { id: 'month', title: '1 месяц', caption: 'Попробовать', price: 299, settingsTitle: 'Месячный Premium', periodLabel: 'мес', unlimitedReveals: false },
  { id: 'quarter', title: '3 месяца', caption: 'Выгода 44%', price: 499, perMonth: 166, savings: 44, settingsTitle: 'Premium на 3 месяца', periodLabel: '3 мес', unlimitedReveals: false },
  { id: 'year', title: '1 год', caption: 'Безлимит на раскрытие авторов', price: 1499, perMonth: 125, savings: 58, settingsTitle: 'Годовой Premium', periodLabel: 'год', unlimitedReveals: true },
];

/** Годовой тариф выбран по умолчанию и визуально доминирует */
export const DEFAULT_PLAN: PlanId = 'year';

export const planById = (id: PlanId): Plan => PLANS.find((p) => p.id === id)!;

export const PLAN_SUBTITLE: Record<PlanId, string> = {
  month: 'Месячная подписка',
  quarter: 'Подписка на 3 месяца',
  year: 'Годовая подписка',
};
