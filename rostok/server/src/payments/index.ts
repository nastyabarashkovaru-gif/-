import { config } from '../config.js';
import { mockProvider } from './mock.js';
import { starsProvider } from './stars.js';
import type { PaymentProvider } from './provider.js';

export function getProvider(): PaymentProvider {
  if (config.paymentProvider === 'mock') {
    if (config.isProduction) throw new Error('mock provider disabled in production');
    return mockProvider;
  }
  return starsProvider;
}
