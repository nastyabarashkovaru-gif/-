export type TariffId = 'm1' | 'm3' | 'm6';

export interface TariffConfig {
  id: TariffId;
  title: string;
  months: number;
  /** null — без ограничения */
  goalLimit: number | null;
  promoPrice: number;
  regularPrice: number;
  comparisonMonthPrice: number;
  /** Справочно: фактическое продление идёт по цене покупки (акционной или обычной) */
  renewalPrice: number;
  highlighted: boolean;
  badge: string | null;
  features: string[];
}

/** Утверждённые тарифы ТЗ 1.1. Всё редактируется в админке; это seed и значения для тестов. */
export const DEFAULT_TARIFFS: TariffConfig[] = [
  {
    id: 'm1',
    title: '1 месяц',
    months: 1,
    goalLimit: 1,
    promoPrice: 999,
    regularPrice: 2990,
    comparisonMonthPrice: 2990,
    renewalPrice: 999,
    highlighted: false,
    badge: null,
    features: [
      '1 цель в месяц',
      'Личный бадди и чаты',
      'Еженедельные встречи с лидерами',
      'Лидерборд и призы',
      'Сравнение месяцев',
      'Архив результатов',
    ],
  },
  {
    id: 'm3',
    title: '3 месяца',
    months: 3,
    goalLimit: 3,
    promoPrice: 2490,
    regularPrice: 8970,
    comparisonMonthPrice: 2990,
    renewalPrice: 2490,
    highlighted: true,
    badge: 'Хит 🔥',
    features: [
      '3 цели вместо одной',
      'Личный бадди и чаты',
      'Еженедельные встречи с лидерами',
      'Лидерборд и призы',
      'Сравнение месяцев',
      'Архив результатов',
      'Расширенная статистика',
      'История трансформации по месяцам',
    ],
  },
  {
    id: 'm6',
    title: '6 месяцев',
    months: 6,
    goalLimit: null,
    promoPrice: 3990,
    regularPrice: 17940,
    comparisonMonthPrice: 2990,
    renewalPrice: 3990,
    highlighted: false,
    badge: null,
    features: [
      'Безлимит целей',
      'Личный бадди и чаты',
      'Еженедельные встречи с лидерами',
      'Лидерборд и призы',
      'Сравнение месяцев',
      'Архив результатов',
      'Расширенная статистика',
      'История трансформации по месяцам',
      'Особый статус участника',
    ],
  },
];

export function canAddGoal(goalLimit: number | null, currentGoals: number): boolean {
  return goalLimit === null || currentGoals < goalLimit;
}

/** Функции, открытые тарифом */
export function tariffPerks(months: number) {
  return {
    extendedStats: months >= 3,
    // Решение владельца 24.10: архив и сравнение месяцев — на всех тарифах
    monthComparison: true,
    fullArchive: true,
    transformationHistory: months >= 3,
    transformationMap6: months >= 6,
    badge6: months >= 6,
  };
}
