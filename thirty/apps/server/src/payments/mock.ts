import { config } from '../config';
import { signPayload, verifyPayload } from './sign';
import type { CreatePaymentInput, ParsedWebhook, PaymentProvider, SubscriptionRef } from './types';

/** Sandbox без денег: страница-имитатор формы оплаты и подписанные тестовые уведомления */
export const MOCK_SECRET = 'mock-provider-secret';

export const mockCalls: { method: string; ref: SubscriptionRef; arg: unknown }[] = [];

export class MockProvider implements PaymentProvider {
  name = 'mock' as const;

  async createPayment(input: CreatePaymentInput) {
    return { url: `${config.PUBLIC_URL}/api/payments/mock/${input.paymentId}` };
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, body: Record<string, unknown>): ParsedWebhook {
    const { __raw: _r, ...data } = body;
    const sign = headers['sign'];
    const valid = verifyPayload(data, MOCK_SECRET, Array.isArray(sign) ? sign[0] : sign);
    const status = String(data.payment_status ?? '');
    return {
      valid,
      kind: data.autopayment ? 'renewal' : status ? 'payment' : 'subscription_status',
      paymentId: (data.order_num as string) ?? null,
      providerOrderId: (data.order_id as string) ?? null,
      status: status === 'success' ? 'paid' : status === 'order_denied' ? 'failed' : status === 'refund' ? 'refunded' : 'unknown',
      amount: data.sum ? Math.round(Number(data.sum)) : null,
      providerSubscriptionId: (data.subscription_id as string) ?? null,
      nextChargeDate: (data.date_next_payment as string) ?? null,
      subscriptionActive: data.active === undefined ? null : data.active === '1',
      customer: { phone: data.customer_phone as string | undefined },
      raw: data,
    };
  }

  async setNextChargeDate(ref: SubscriptionRef, date: string) {
    mockCalls.push({ method: 'setNextChargeDate', ref, arg: date });
  }

  async setActive(ref: SubscriptionRef, active: boolean) {
    mockCalls.push({ method: 'setActive', ref, arg: active });
  }
}

export function signMock(data: Record<string, unknown>) {
  return signPayload(data, MOCK_SECRET);
}
