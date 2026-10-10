export type PlanId = 'month' | 'quarter' | 'year';

export interface Plan {
  id: PlanId;
  title: string;
  price: number;
  months: number;
  description: string;
  includesReveal: boolean;
}

/** Тарифы. Не менять без согласования. */
export const PLANS: Plan[] = [
  { id: 'month', title: '1 месяц', price: 299, months: 1, description: 'Все ответы на месяц', includesReveal: false },
  { id: 'quarter', title: '3 месяца', price: 499, months: 3, description: 'Все ответы на три месяца', includesReveal: false },
  {
    id: 'year',
    title: '1 год',
    price: 1499,
    months: 12,
    description: 'Все ответы на год + безлимит на «Узнать, кто это написал»',
    includesReveal: true,
  },
];

/** Какой тариф выделен как оптимальный и выбран по умолчанию. */
export const RECOMMENDED_PLAN: PlanId = 'quarter';
export const RECOMMENDED_LABEL = 'Оптимально';

/** Разовая цена раскрытия автора для месячного и трёхмесячного тарифов. */
export const REVEAL_PRICE = 99;

export function planById(id: PlanId): Plan {
  return PLANS.find((p) => p.id === id)!;
}
