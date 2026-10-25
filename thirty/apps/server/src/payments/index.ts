import { config } from '../config';
import { MockProvider } from './mock';
import { ProdamusProvider } from './prodamus';
import { CloudPaymentsProvider } from './cloudpayments';
import type { PaymentProvider } from './types';

let provider: PaymentProvider =
  config.PAYMENT_PROVIDER === 'prodamus' ? new ProdamusProvider() : config.PAYMENT_PROVIDER === 'cloudpayments' ? new CloudPaymentsProvider() : new MockProvider();

export function paymentProvider(): PaymentProvider {
  return provider;
}

/** Для тестов */
export function setPaymentProvider(p: PaymentProvider) {
  provider = p;
}
