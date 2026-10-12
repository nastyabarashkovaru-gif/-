import type { PaymentProvider } from './provider.js';

/** Песочница для demo/dev. В production запрещена (assertSafeConfig). Деньги не списываются. */
export const mockProvider: PaymentProvider = {
  id: 'mock',
  currency: 'XTR',
  supportsNextChargeOverride: true,
  async createCheckout({ intentId }) {
    return { kind: 'mock', intentId };
  },
  async cancelAutoRenew() {},
  async refund() {},
};
