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
    regularPrice: 1490,
    comparisonMonthPrice: 2990,
    renewalPrice: 999,
    highlighted: false,
    badge: null,
    // Без слов «архив», «preview», «превью» — требование ТЗ 1.1
    features: [
      'Одна цель в месячном потоке',
      'Бадди на весь месяц',
      'Чат потока и тематические чаты',
      'Еженедельные групповые созвоны с экспертами',
      'Личный календарь, отчёты и рейтинг',
      'Право побороться за приз',
      'Базовая статистика',
      'Еженедельные карточки прогресса',
    ],
  },
  {
    id: 'm3',
    title: '3 месяца',
    months: 3,
    goalLimit: 3,
    promoPrice: 2490,
    regularPrice: 3490,
    comparisonMonthPrice: 2990,
    renewalPrice: 2490,
    highlighted: true,
    badge: 'Хит продаж',
    features: [
      'Три месячных потока подряд',
      'До трёх целей в каждом месяце',
      'Всё из тарифа «1 месяц»',
      'Расширенная статистика каждой цели',
      'Сравнение месяцев',
      'Полный архив результатов',
      'История трансформации «до/после» по месяцам',
    ],
  },
  {
    id: 'm6',
    title: '6 месяцев',
    months: 6,
    goalLimit: null,
    promoPrice: 3990,
    regularPrice: 5490,
    comparisonMonthPrice: 2990,
    renewalPrice: 3990,
    highlighted: false,
    badge: null,
    features: [
      'Шесть месячных потоков подряд',
      'Без ограничения числа целей в каждом месяце',
      'Всё из тарифа «3 месяца»',
      'Визуальная карта трансформации за 6 месяцев',
      'Особый значок участника в профиле',
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
    monthComparison: months >= 3,
    fullArchive: months >= 3,
    transformationHistory: months >= 3,
    transformationMap6: months >= 6,
    badge6: months >= 6,
  };
}
