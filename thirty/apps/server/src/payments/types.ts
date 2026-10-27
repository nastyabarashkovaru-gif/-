export interface CreatePaymentInput {
  paymentId: string;
  amount: number;
  title: string;
  /** id подписки у провайдера (настраивается в кабинете); null — разовая оплата */
  providerSubscriptionId: number | null;
  userId: string;
  linkExpiresAt?: Date;
  successUrl: string;
  returnUrl: string;
  notificationUrl: string;
}

export type WebhookKind = 'payment' | 'renewal' | 'subscription_status' | 'unknown';

export interface ParsedWebhook {
  valid: boolean;
  kind: WebhookKind;
  /** Наш id платежа (order_num) — для первичных и разовых оплат */
  paymentId: string | null;
  /** Уникальный id операции у провайдера (для дедупликации) */
  providerOrderId: string | null;
  status: 'paid' | 'failed' | 'canceled' | 'refunded' | 'unknown';
  amount: number | null;
  providerSubscriptionId: string | null;
  /** Следующая дата списания по данным провайдера, если пришла */
  nextChargeDate: string | null;
  /** Подписка отключена на стороне провайдера */
  subscriptionActive: boolean | null;
  customer: { phone?: string; email?: string; accountId?: string; token?: string };
  raw: Record<string, unknown>;
}

export interface SubscriptionRef {
  providerSubscriptionId: string;
  customer: { phone?: string; email?: string; accountId?: string; token?: string };
}

export interface PaymentProvider {
  name: 'cloudpayments' | 'mock';
  createPayment(input: CreatePaymentInput): Promise<{ url: string }>;
  parseWebhook(headers: Record<string, string | string[] | undefined>, body: Record<string, unknown>): ParsedWebhook;
  /** Перенести дату следующего списания ; amount — сумма продления, если провайдер её хранит */
  setNextChargeDate(ref: SubscriptionRef, date: string, amount?: number): Promise<void>;
  /** Выключить автопродление по инициативе покупателя */
  setActive(ref: SubscriptionRef, active: boolean): Promise<void>;
}
