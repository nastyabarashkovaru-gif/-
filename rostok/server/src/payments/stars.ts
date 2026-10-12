import { tg } from '../telegramApi.js';
import type { PaymentProvider } from './provider.js';

/**
 * Telegram Stars (XTR). Цифровые товары внутри Telegram оплачиваются только Stars.
 * Подписка: createInvoiceLink c subscription_period=2592000 (30 дней — единственное допустимое значение).
 * 6 месяцев: обычный разовый инвойс (предоплаченный доступ), т.к. нативной 6-месячной подписки нет.
 * Изменить цену уже оформленной Stars-подписки нельзя → удерживающая скидка недоступна.
 */
export const starsProvider: PaymentProvider = {
  id: 'telegram_stars',
  currency: 'XTR',
  supportsNextChargeOverride: false,
  async createCheckout({ intentId, plan }) {
    const body: Record<string, unknown> = {
      title: `ROSTOK · ${plan.title}`.slice(0, 32),
      description: (plan.subtitle || 'Доступ к саду').slice(0, 255),
      payload: intentId,
      currency: 'XTR',
      prices: [{ label: plan.title, amount: plan.price_stars }],
    };
    if (plan.kind === 'recurring') body.subscription_period = 2592000;
    const url = await tg<string>('createInvoiceLink', body);
    return { kind: 'telegram_invoice', url, intentId };
  },
  async cancelAutoRenew({ telegramId, providerRef }) {
    if (!telegramId || !providerRef) return;
    await tg('editUserStarSubscription', { user_id: telegramId, telegram_payment_charge_id: providerRef, is_canceled: true });
  },
  async refund({ telegramId, chargeId }) {
    await tg('refundStarPayment', { user_id: telegramId, telegram_payment_charge_id: chargeId });
  },
};
