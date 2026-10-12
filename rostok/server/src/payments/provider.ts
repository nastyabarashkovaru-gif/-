/** Абстракция платёжного провайдера. Доступ выдаёт только EntitlementService по подтверждённому серверному событию. */
export interface PlanRow {
  id: string; title: string; subtitle: string | null; kind: 'recurring' | 'prepaid'; period_days: number;
  price_stars: number; display_price_rub: number | null; eligibility: string; is_active: boolean; terms: string;
}

export interface CheckoutResult {
  kind: 'telegram_invoice' | 'mock';
  url?: string;
  intentId: string;
}

export interface PaymentProvider {
  readonly id: 'telegram_stars' | 'mock';
  readonly currency: string;
  /** Можно ли безопасно изменить сумму следующего автосписания (нужно для удерживающего предложения). */
  readonly supportsNextChargeOverride: boolean;
  createCheckout(p: { intentId: string; plan: PlanRow; telegramId: number | null }): Promise<CheckoutResult>;
  /** Отключить автопродление. Доступ до конца периода сохраняется. */
  cancelAutoRenew(p: { telegramId: number | null; providerRef: string | null }): Promise<void>;
  refund(p: { telegramId: number | null; chargeId: string }): Promise<void>;
}
