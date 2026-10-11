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
  /** Обычная сумма автосписания */
  amount?: number | null;
  /** Сумма следующего списания (со скидкой удержания, если она принята) */
  nextChargeAmount?: number | null;
  /** Можно предложить скидку −50% на следующий платёж при отмене */
  retentionOfferAvailable?: boolean;
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
  /** Согласие есть, но подписки нет */
  | { status: 'requires_plan' }
  /** Согласие есть, тариф 1 или 3 месяца — нужна разовая покупка */
  | { status: 'requires_purchase'; price: number }
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

/** Параметры виджета CloudPayments — формирует сервер (сумма и тариф не задаются клиентом) */
export interface CloudPaymentsParams {
  publicId: string;
  description: string;
  amount: number;
  currency: 'RUB';
  invoiceId: string;
  accountId: string;
  skin?: string;
  requireEmail?: boolean;
  data?: Record<string, unknown>;
}

export type BillingResult =
  | { status: 'unavailable' }
  | { status: 'widget'; params: CloudPaymentsParams }
  | { status: 'ok' }
  | { status: 'none' }
  /** Автопродление отключено — для продления нужно оформить подписку заново */
  | { status: 'resubscribe' };

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
  /** Имя бота и short name Mini App — для ссылок на анкеты */
  app?: { botUsername: string; appShortName: string };
  /** Множитель цен: после отмены подписки повторное оформление ×3 */
  pricing?: { multiplier: number };
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
  startCheckout(plan: PlanId, source?: UpsellSource): Promise<BillingResult>;
  restorePurchases(): Promise<BillingResult>;
  /** Разовое раскрытие автора (99 ₽) на тарифах 1 и 3 месяца */
  startRevealCheckout(questionnaireId: string, respondentId: string): Promise<BillingResult>;
  setAutoRenew(enabled: boolean): Promise<BillingResult>;
  /** Скидка удержания: −50% на один следующий платёж */
  retentionDiscount(): Promise<BillingResult>;
  /** Пользователь разрешил боту присылать уведомления */
  grantWriteAccess(): Promise<void>;
  /** Загрузить PNG сторис и получить временную публичную ссылку (для Telegram) */
  uploadStory(dataUrl: string): Promise<{ url: string }>;
  /** Событие аналитики (fire-and-forget) */
  trackEvent(name: AnalyticsEvent, source: string): Promise<void>;
}

/** События воронки апсейла (ТЗ «Новые анкеты и собственные вопросы») */
export type AnalyticsEvent =
  | 'new_questionnaire_clicked'
  | 'new_questionnaire_paywall_shown'
  | 'custom_question_clicked'
  | 'custom_question_paywall_shown'
  | 'custom_question_created'
  | 'premium_upsell_clicked'
  | 'story_sheet_opened'
  | 'story_shared';

/** Откуда пользователь пришёл на экран Premium — для конверсии в покупку */
export type UpsellSource = 'new_questionnaire' | 'custom_question';

/** Порог уникальных ответов до открытия результатов */
export const RESULTS_THRESHOLD = 5;

/** Текущая версия текста согласия на экране 08b */
export const DISCLOSURE_VERSION = '2026-10-v1';
