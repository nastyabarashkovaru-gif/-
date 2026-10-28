import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';
import type { CreatePaymentInput, ParsedWebhook, PaymentProvider, SubscriptionRef } from './types';

/**
 * CloudPayments. Оплата — на нашей странице /pay/:id с виджетом CloudPayments (подписка создаётся виджетом:
 * recurrent с датой первого автосписания = 28-е последнего оплаченного месяца). Уведомления Check / Pay / Fail /
 * Recurrent / Refund подписаны HMAC-SHA256 (заголовок Content-HMAC, base64) паролем для API.
 * Дату и сумму автосписания сервер дополнительно выставляет через API (subscriptions/update).
 */

const API = 'https://api.cloudpayments.ru';
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined);

export function cpSign(raw: string, secret = config.CP_API_SECRET) {
  return createHmac('sha256', secret).update(raw, 'utf8').digest('base64');
}

export function cpVerify(raw: string, headers: Record<string, string | string[] | undefined>) {
  if (!config.CP_API_SECRET) return false;
  const pickH = (k: string) => {
    const v = headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  const candidates = [cpSign(raw)];
  // X-Content-HMAC считается от раскодированных параметров
  try {
    candidates.push(cpSign(decodeURIComponent(raw.replace(/\+/g, ' '))));
  } catch {
    /* неверная кодировка — проверяем только Content-HMAC */
  }
  const got = [pickH('content-hmac'), pickH('x-content-hmac')].filter(Boolean) as string[];
  return got.some((g) => candidates.some((c) => c.length === g.length && timingSafeEqual(Buffer.from(c), Buffer.from(g))));
}

/** Подпись ссылки на нашу страницу оплаты */
export function payPageSig(paymentId: string, exp: number) {
  return createHmac('sha256', `${config.CP_API_SECRET}:paypage`).update(`${paymentId}:${exp}`).digest('hex').slice(0, 32);
}

export type CpKind = 'check' | 'pay' | 'fail' | 'recurrent' | 'refund';

export class CloudPaymentsProvider implements PaymentProvider {
  name = 'cloudpayments' as const;

  async createPayment(input: CreatePaymentInput) {
    const exp = Math.floor((input.linkExpiresAt ?? new Date(Date.now() + 24 * 3600_000)).getTime() / 1000);
    const base = config.PUBLIC_URL.replace(/\/$/, '');
    return { url: `${base}/pay/${input.paymentId}?e=${exp}&s=${payPageSig(input.paymentId, exp)}` };
  }

  /** Тип уведомления берётся из адреса: /api/payments/cloudpayments/<kind> */
  parseWebhook(headers: Record<string, string | string[] | undefined>, body: Record<string, unknown>): ParsedWebhook {
    const { __raw, __kind, ...data } = body as Record<string, unknown> & { __raw?: string; __kind?: CpKind };
    const raw = typeof __raw === 'string' ? __raw : '';
    const valid = cpVerify(raw, headers);
    const kind = __kind ?? 'pay';
    const invoice = str(data.InvoiceId) || null;
    const subId = str(data.SubscriptionId) || (kind === 'recurrent' ? str(data.Id) : undefined) || null;
    const amount = str(data.Amount);
    const base = {
      valid,
      paymentId: invoice,
      providerOrderId: str(data.TransactionId) ? `cp:${str(data.TransactionId)}` : null,
      amount: amount ? Math.round(Number(amount)) : null,
      providerSubscriptionId: subId,
      nextChargeDate: null as string | null,
      subscriptionActive: null as boolean | null,
      customer: { email: str(data.Email), accountId: str(data.AccountId), token: str(data.Token) } as ParsedWebhook['customer'],
      test: ['1', 'true'].includes((str(data.TestMode) ?? '').toLowerCase()),
      raw: { ...data, customer_extra: str(data.AccountId) ? `tg:${str(data.AccountId)}` : undefined },
    };
    if (kind === 'recurrent') {
      const status = str(data.Status) ?? '';
      const next = str(data.NextTransactionDate);
      return { ...base, kind: 'subscription_status', status: 'unknown', paymentId: null, nextChargeDate: next ? next.slice(0, 10) : null, subscriptionActive: status === 'Active' || status === 'PastDue' };
    }
    if (kind === 'refund') {
      const parent = str(data.PaymentTransactionId);
      return { ...base, kind: 'payment', status: 'refunded', providerOrderId: str(data.TransactionId) ? `cp-refund:${str(data.TransactionId)}` : null, raw: { ...base.raw, PaymentTransactionId: parent } };
    }
    const status: ParsedWebhook['status'] = kind === 'fail' ? 'failed' : 'paid';
    // Автосписание по подписке приходит без нашего InvoiceId, но с SubscriptionId
    const isRenewal = !invoice && Boolean(subId);
    return { ...base, kind: isRenewal ? 'renewal' : 'payment', status, providerOrderId: kind === 'fail' && base.providerOrderId ? `${base.providerOrderId}:fail` : base.providerOrderId };
  }

  private async api<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${config.CP_PUBLIC_ID}:${config.CP_API_SECRET}`).toString('base64')}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { Success?: boolean; Message?: string; Model?: T };
    if (!res.ok || data.Success === false) throw new Error(`CloudPayments ${path}: ${res.status} ${data.Message ?? ''}`);
    return data.Model as T;
  }

  async setNextChargeDate(ref: SubscriptionRef, date: string, amount?: number) {
    // 12:00 по Москве = 09:00 UTC
    await this.api('/subscriptions/update', { Id: ref.providerSubscriptionId, StartDate: `${date}T09:00:00`, ...(amount ? { Amount: amount, Currency: 'RUB' } : {}) });
  }

  async setActive(ref: SubscriptionRef, active: boolean) {
    if (active) throw new Error('CloudPayments: отменённую подписку нельзя включить — нужна новая оплата');
    await this.api('/subscriptions/cancel', { Id: ref.providerSubscriptionId });
  }
}

/** Проверка ключей при старте: POST /test с Basic-авторизацией */
export async function checkCloudPaymentsKeys() {
  if (!config.CP_PUBLIC_ID || !config.CP_API_SECRET) return;
  try {
    const res = await fetch(`${API}/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${config.CP_PUBLIC_ID}:${config.CP_API_SECRET}`).toString('base64')}` },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { Success?: boolean; Message?: string };
    console.log(`[cloudpayments] проверка ключей: HTTP ${res.status} success=${data.Success} ${data.Message ?? ''}`);
  } catch (e) {
    console.error('[cloudpayments] проверка ключей не удалась:', (e as Error).message);
  }
}
