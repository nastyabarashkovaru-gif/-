import { DateTime } from 'luxon';
import { config } from '../config';
import { buildQuery, prodamusSign, prodamusVerify } from './sign';
import type { CreatePaymentInput, ParsedWebhook, PaymentProvider, SubscriptionRef } from './types';

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);

function formBase() {
  if (!config.PRODAMUS_FORM_URL) throw new Error('PRODAMUS_FORM_URL не задан');
  const u = new URL(config.PRODAMUS_FORM_URL.includes('://') ? config.PRODAMUS_FORM_URL : `https://${config.PRODAMUS_FORM_URL}`);
  return `${u.protocol}//${u.host}`;
}

/** Поиск поля в плоском или вложенном виде: subscription[id] / subscription_id */
function pick(body: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = body;
  for (const p of path) {
    if (cur && typeof cur === 'object' && p in (cur as object)) cur = (cur as Record<string, unknown>)[p];
    else return undefined;
  }
  return cur;
}

export class ProdamusProvider implements PaymentProvider {
  name = 'prodamus' as const;

  /**
   * Развёрнутая подписанная ссылка на платёжную форму (do=pay). Короткая ссылка (do=link)
   * требует серверного запроса к форме — используем развёрнутую, она эквивалентна по документации.
   */
  async createPayment(input: CreatePaymentInput) {
    const data: Record<string, unknown> = {
      do: 'pay',
      order_id: input.paymentId,
      customer_extra: `tg:${input.userId}`,
      urlSuccess: input.successUrl,
      urlReturn: input.returnUrl,
      urlNotification: input.notificationUrl,
      callbackType: 'json',
      payments_limit: 1,
      installments_disabled: 1,
      currency: 'rub',
      _param_tg_user: input.userId,
    };
    if (config.PRODAMUS_SYS) data.sys = config.PRODAMUS_SYS;
    if (config.PRODAMUS_DEMO) data.demo_mode = 1;
    if (input.linkExpiresAt) data.link_expired = DateTime.fromJSDate(input.linkExpiresAt, { zone: 'Europe/Moscow' }).toFormat('yyyy-LL-dd HH:mm');
    if (input.providerSubscriptionId) data.subscription = input.providerSubscriptionId;
    else data.products = [{ name: input.title, price: input.amount, quantity: 1, sku: input.paymentId }];
    const signature = prodamusSign(data, config.PRODAMUS_SECRET_KEY);
    return { url: `${formBase()}/?${buildQuery({ ...data, signature })}` };
  }

  parseWebhook(headers: Record<string, string | string[] | undefined>, body: Record<string, unknown>): ParsedWebhook {
    const signHeader = headers['sign'];
    const sign = Array.isArray(signHeader) ? signHeader[0] : signHeader;
    const { __raw: _raw, ...data } = body;
    const valid = prodamusVerify(data, config.PRODAMUS_SECRET_KEY, sign);
    const statusRaw = str(data.payment_status) ?? '';
    const status: ParsedWebhook['status'] =
      statusRaw === 'success' ? 'paid' : statusRaw === 'order_denied' ? 'failed' : statusRaw === 'order_canceled' ? 'canceled' : /refund/.test(statusRaw) ? 'refunded' : 'unknown';
    const subId = str(pick(data, ['subscription', 'id'])) ?? str(data.subscription_id) ?? null;
    const orderNum = str(data.order_num) ?? null;
    // ⚠ Формат уведомлений об автоплатежах проверить в sandbox: ориентируемся на наличие данных подписки
    // и отсутствие нашего order_num либо на признак автоплатежа.
    const isAuto = Boolean(pick(data, ['subscription', 'autopayment']) ?? data.autopayment ?? (subId && !orderNum));
    const nextRaw = str(pick(data, ['subscription', 'date_next_payment'])) ?? str(data.date_next_payment);
    const activeRaw = str(pick(data, ['subscription', 'active'])) ?? str(pick(data, ['subscription', 'active_user']));
    const kind: ParsedWebhook['kind'] = statusRaw ? (isAuto ? 'renewal' : 'payment') : subId ? 'subscription_status' : 'unknown';
    const sum = str(data.sum);
    return {
      valid,
      kind,
      paymentId: orderNum,
      providerOrderId: str(data.order_id) ?? null,
      status,
      amount: sum ? Math.round(Number(sum)) : null,
      providerSubscriptionId: subId,
      nextChargeDate: nextRaw ? nextRaw.slice(0, 10) : null,
      subscriptionActive: activeRaw === undefined ? null : activeRaw === '1' || activeRaw === 'true',
      customer: { phone: str(data.customer_phone), email: str(data.customer_email) },
      raw: data,
    };
  }

  private async rest(method: string, payload: Record<string, unknown>) {
    const signature = prodamusSign(payload, config.PRODAMUS_SECRET_KEY);
    const res = await fetch(`${formBase()}/rest/${method}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildQuery({ ...payload, signature }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Prodamus ${method}: HTTP ${res.status} ${text.slice(0, 200)}`);
    return text;
  }

  private customerParams(ref: SubscriptionRef) {
    return { subscription: ref.providerSubscriptionId, customer_phone: ref.customer.phone, customer_email: ref.customer.email };
  }

  async setNextChargeDate(ref: SubscriptionRef, date: string) {
    // ⚠ Формат даты уточнить в sandbox; документация показывает «гггг-мм-дд чч:мм»
    await this.rest('setSubscriptionPaymentDate', { ...this.customerParams(ref), date: `${date} 12:00` });
  }

  async setActive(ref: SubscriptionRef, active: boolean) {
    await this.rest('setActivity', { ...this.customerParams(ref), active_user: active ? 1 : 0 });
  }
}
