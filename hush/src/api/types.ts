import type { PlanId } from '@/data/plans';
import type { Question } from '@/data/questions';

/**
 * Контракт между Mini App и backend.
 * Важно для приватности: сервер НЕ присылает текст закрытых ответов
 * и Telegram-профиль автора до проверки согласия и прав доступа.
 */

export interface Me {
  id: string;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

export interface Entitlement {
  plan: PlanId | null;
  autoRenew: boolean;
  /** ISO-дата следующего списания — только из платёжной системы */
  renewsAt: string | null;
  /** true — состояние из демо-данных, а не от платёжного провайдера */
  demo: boolean;
}

export interface QuestionnaireSummary {
  id: string;
  createdAt: string;
  questions: Question[];
  /** Уникальные респонденты, полностью заполнившие анкету */
  respondentCount: number;
}

export interface AnswerView {
  questionId: string;
  question: string;
  /** null, если ответ закрыт — текст не покидает сервер */
  text: string | null;
  locked: boolean;
}

export interface RespondentView {
  id: string;
  /** «Аноним №N» */
  number: number;
  answers: AnswerView[];
}

export interface ResultsView {
  questionnaireId: string;
  respondentCount: number;
  respondents: RespondentView[];
}

export interface RevealedIdentity {
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

export type RevealResult =
  /** Автор не давал согласия — показываем модалку, ничего не списываем */
  | { status: 'anonymous' }
  /** Согласие есть, но нет права на раскрытие (нужен годовой тариф) */
  | { status: 'requires_plan' }
  | { status: 'revealed'; identity: RevealedIdentity };

export interface PublicQuestionnaire {
  id: string;
  questions: Question[];
}

export interface ConsentRecord {
  revealIdentity: boolean;
  /** Версия текста раскрытия, который видел пользователь */
  disclosureVersion: string;
  decidedAt: string;
}

export interface SubmitPayload {
  questionnaireId: string;
  answers: Array<{ questionId: string; text: string }>;
  consent: ConsentRecord;
  /** Ключ идемпотентности: повторная отправка не создаёт дубль */
  idempotencyKey: string;
}

export type BillingResult = { status: 'unavailable' };

export type ApiErrorCode =
  | 'not_found'
  | 'own_questionnaire'
  | 'already_answered'
  | 'premium_required'
  | 'threshold_not_met'
  | 'invalid'
  | 'network'
  | 'unauthorized';

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface Bootstrap {
  me: Me;
  entitlement: Entitlement;
  questionnaires: QuestionnaireSummary[];
}

export interface HushApi {
  bootstrap(): Promise<Bootstrap>;
  createQuestionnaire(questions: Question[]): Promise<QuestionnaireSummary>;
  getQuestionnaire(id: string): Promise<QuestionnaireSummary>;
  /** Доступно только после 5 уникальных ответов */
  getResults(id: string): Promise<ResultsView>;
  requestReveal(questionnaireId: string, respondentId: string): Promise<RevealResult>;
  openForResponse(id: string): Promise<PublicQuestionnaire>;
  /** Все пять ответов + согласие отправляются атомарно одним запросом */
  submitResponses(payload: SubmitPayload): Promise<void>;
  /** Платежи не подключены: всегда { status: 'unavailable' } */
  startCheckout(plan: PlanId): Promise<BillingResult>;
  restorePurchases(): Promise<BillingResult>;
  setAutoRenew(enabled: boolean): Promise<BillingResult>;
}

/** Текущая версия текста согласия на экране 08b */
export const DISCLOSURE_VERSION = '2026-10-v1';
