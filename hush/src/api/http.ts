/**
 * HTTP-клиент для настоящего backend (см. hush/docs/BACKEND.md).
 * Каждый запрос подписан Telegram initData — сервер обязан проверить подпись.
 */
import { config } from '@/config';
import { getInitData } from '@/lib/telegram';
import { ApiError, type ApiErrorCode, type HushApi } from './types';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `tma ${getInitData()}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('network');
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { code?: ApiErrorCode };
    throw new ApiError(data.code ?? (res.status === 401 ? 'unauthorized' : res.status === 404 ? 'not_found' : 'invalid'));
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const httpApi: HushApi = {
  bootstrap: () => request('GET', '/api/me'),
  createQuestionnaire: (questions) => request('POST', '/api/questionnaires', { questions }),
  getQuestionnaire: (id) => request('GET', `/api/questionnaires/${encodeURIComponent(id)}`),
  getResults: (id) => request('GET', `/api/questionnaires/${encodeURIComponent(id)}/results`),
  requestReveal: (qid, rid) =>
    request('POST', `/api/questionnaires/${encodeURIComponent(qid)}/respondents/${encodeURIComponent(rid)}/reveal`),
  openForResponse: (id) => request('GET', `/api/public/questionnaires/${encodeURIComponent(id)}`),
  submitResponses: (payload) => request('POST', `/api/public/questionnaires/${encodeURIComponent(payload.questionnaireId)}/responses`, payload),
  // Сервер создаёт заказ; доступ выдаётся только после уведомления CloudPayments
  startCheckout: (plan, source) => request('POST', '/api/billing/checkout', { plan, source }),
  startOffer: () => request('POST', '/api/billing/offer'),
  restorePurchases: () => request('POST', '/api/billing/restore'),
  startRevealCheckout: (questionnaireId, respondentId) =>
    request('POST', '/api/billing/reveal-checkout', { questionnaireId, respondentId }),
  setAutoRenew: (enabled) => request('POST', '/api/billing/autorenew', { enabled }),
  retentionDiscount: () => request('POST', '/api/billing/retention-discount'),
  grantWriteAccess: () => request('POST', '/api/me/write-access'),
  trackEvent: (name, source) => request('POST', '/api/events', { name, source }),
  uploadStory: (image) => request('POST', '/api/stories', { image }),
};
