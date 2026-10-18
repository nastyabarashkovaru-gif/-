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
  adminStats: () => request('GET', '/api/admin/stats'),
  createLink: (source) => request('POST', '/api/me/link', { source }),
  getInbox: () => request('GET', '/api/inbox'),
  answerInbox: (id, text) => request('POST', `/api/inbox/${encodeURIComponent(id)}/answer`, { text }),
  deleteInboxAnswer: (id) => request('DELETE', `/api/inbox/${encodeURIComponent(id)}/answer`),
  markStory: (id) => request('POST', `/api/inbox/${encodeURIComponent(id)}/story`),
  getSent: () => request('GET', '/api/sent'),
  deleteInbox: (id) => request('DELETE', `/api/inbox/${encodeURIComponent(id)}`),
  reportInbox: (id, reason) => request('POST', `/api/inbox/${encodeURIComponent(id)}/report`, { reason }),
  blockInbox: (id) => request('POST', `/api/inbox/${encodeURIComponent(id)}/block`),
  openRecipient: (slug) => request('GET', `/api/public/u/${encodeURIComponent(slug)}`),
  sendQuestion: (slug, text, idempotencyKey) => request('POST', `/api/public/u/${encodeURIComponent(slug)}/questions`, { text, idempotencyKey }),
  createAsk: (text, source) => request('POST', '/api/asks', { text, source }),
  getAsks: () => request('GET', '/api/asks'),
  getAsk: (id) => request('GET', `/api/asks/${encodeURIComponent(id)}`),
  deleteAsk: (id) => request('DELETE', `/api/asks/${encodeURIComponent(id)}`),
  deleteAskAnswer: (askId, answerId) => request('DELETE', `/api/asks/${encodeURIComponent(askId)}/answers/${encodeURIComponent(answerId)}`),
  reportAskAnswer: (askId, answerId) => request('POST', `/api/asks/${encodeURIComponent(askId)}/answers/${encodeURIComponent(answerId)}/report`),
  blockAskAnswer: (askId, answerId) => request('POST', `/api/asks/${encodeURIComponent(askId)}/answers/${encodeURIComponent(answerId)}/block`),
  openAsk: (id) => request('GET', `/api/public/asks/${encodeURIComponent(id)}`),
  answerAsk: (id, text, idempotencyKey) => request('POST', `/api/public/asks/${encodeURIComponent(id)}/answers`, { text, idempotencyKey }),
  activity: () => request('GET', '/api/me/activity'),
  trackEvent: (name, source) => request('POST', '/api/events', { name, source }),
  uploadStory: (image) => request('POST', '/api/stories', { image }),
};
