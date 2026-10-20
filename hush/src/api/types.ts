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
  /** Владелец: доступна статистика */
  isAdmin?: boolean;
  /** Доступна демо-версия /demo */
  demoAccess?: boolean;
  /** Бот может присылать пуш-уведомления о новых вопросах */
  allowsWrite?: boolean;
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
  | 'rate_limited'
  | 'invalid'
  | 'network'
  | 'unauthorized';

export class ApiError extends Error {
  constructor(public code: ApiErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface Pricing {
  prices: Record<PlanId, number>;
  /** Обычные цены (зачёркнутые на экране тарифов) */
  standard: Record<PlanId, number>;
  /** Конец предложения «месяц за 299 ₽»; null — таймер не запущен или предложения нет */
  offerEndsAt: string | null;
  /** Отменял подписку — предложение не положено */
  returning: boolean;
}

type Periods = { today: number | string; d7: number | string; d30: number | string; total: number | string };
export interface AdminStats {
  /** HUSH 2.0 */
  qa?: {
    links: Periods;
    questions: Periods;
    inboxAnswers: Periods;
    asks: Periods;
    askAnswers: Periods;
    funnel: Array<{ name: string; source: string | null; count: number; users: number }>;
    referrers: Array<{ id: string; username: string | null; first_name: string; invited: number; made_link: number }>;
    sources: Array<{ source: string; users: number }>;
    guestConversion: { guests: number; guests_with_link: number };
  };
  users: Periods;
  questionnaires: Periods;
  responses: Periods;
  /** Сумма оплат, ₽ (без тестовых, до комиссий) */
  revenue: Periods;
  paymentsCount: Periods;
  byKind: Array<{ plan: string; count: number; sum: number | string }>;
  testPayments: { count: number; sum: number | string };
  active: Array<{ plan: string; count: number; renewing: number }>;
  cancelled: { count: number };
  /** По дням (МСК), новые сверху; до 180 дней */
  days: Array<{ date: string; day: string; users: number; questionnaires: number; questions?: number; responses: number; payments: number; revenue: number | string }>;
  upsell: Array<Record<string, unknown>>;
  stories: Array<{ name: string; source: string | null; count: number }>;
  offers: { paywall_opened: number; paying_users: number };
}

/* ───────────── HUSH 2.0: вопросы и ответы ───────────── */

export interface QaSummary {
  /** Код постоянной личной ссылки; null — ещё не создана */
  askSlug: string | null;
  link: string | null;
  /** Входящие без ответа */
  unanswered: number;
  /** Свои вопросы аудитории */
  asks: number;
  /** Новые личные ответы на вопросы, которые пользователь задал другим */
  sentUnread?: number;
  /** Сколько вопросов задал другим людям */
  sent?: number;
  /** Сколько своих вопросов подписчикам создано всего (вместе с удалёнными) и сколько бесплатно */
  asksCreated?: number;
  freeAsks?: number;
}

/** Пока не набралось required вопросов, они не показываются — так сложнее догадаться, кто что спросил */
export interface InboxGate {
  collected: number;
  required: number;
}

export interface InboxItem {
  id: string;
  /** null — вопрос закрыт (без подписки открыты первые 5) */
  text: string | null;
  locked?: boolean;
  /** Только с подпиской: профиль автора, если он разрешил, иначе null («пожелал остаться анонимным») */
  author?: RevealedIdentity | null;
  /** Все вопросы выглядят как анонимные (вопрос дня — тоже) */
  from: 'anon' | 'hush';
  /** answered — ответил лично, story — ответил в сторис */
  status: 'new' | 'answered' | 'story';
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
}

/** Вопрос, который пользователь задал другому человеку по его личной ссылке */
export interface SentItem {
  id: string;
  text: string;
  recipient: { firstName: string; photoUrl: string | null };
  answer: string | null;
  status: 'waiting' | 'answered' | 'story';
  unread: boolean;
  answeredAt: string | null;
  createdAt: string;
}

export interface AskSummary {
  id: string;
  text: string;
  createdAt: string;
  answerCount: number;
  lastAnswerAt?: string | null;
  link: string;
}

export interface AskAnswer {
  id: string;
  /** null — ответ под замком (без подписки видны первые 3) */
  text: string | null;
  locked?: boolean;
  /** Только с подпиской: профиль автора, если он разрешил, иначе null */
  author?: RevealedIdentity | null;
  createdAt: string;
}

export interface PublicRecipient {
  firstName: string;
  photoUrl: string | null;
  /** Своя ссылка — «глазами подписчика» */
  own: boolean;
}

export interface PublicAsk extends PublicRecipient {
  id: string;
  text: string;
  answered: boolean;
}

export interface Activity {
  received: number;
  answered: number;
  asks: number;
  askAnswers: number;
  sent: number;
}

export interface Bootstrap {
  me: Me;
  entitlement: Entitlement;
  questionnaires: QuestionnaireSummary[];
  /** Имя бота и short name Mini App — для ссылок на анкеты */
  app?: { botUsername: string; appShortName: string };
  /** Цены для этого пользователя (считает сервер) */
  pricing?: Pricing;
  /** HUSH 2.0: личная ссылка и счётчики */
  qa?: QaSummary;
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
  /** Экран тарифов открыт: запускает 3-часовое предложение и возвращает цены */
  startOffer(): Promise<Pricing>;
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
  /** Статистика для владельца */
  adminStats(): Promise<AdminStats>;

  /* HUSH 2.0 */
  /** Создать (или вернуть существующую) постоянную личную ссылку */
  createLink(source: string): Promise<{ slug: string; link: string }>;
  getInbox(): Promise<{ items: InboxItem[]; gate?: InboxGate }>;
  answerInbox(id: string, text: string): Promise<InboxItem>;
  deleteInboxAnswer(id: string): Promise<InboxItem>;
  deleteInbox(id: string): Promise<void>;
  /** Ответил в сторис (скопировал карточку вопроса) */
  markStory(id: string): Promise<InboxItem>;
  getSent(): Promise<{ items: SentItem[] }>;
  reportInbox(id: string, reason?: string): Promise<void>;
  blockInbox(id: string): Promise<void>;
  openRecipient(slug: string): Promise<PublicRecipient>;
  sendQuestion(slug: string, text: string, idempotencyKey: string, revealIdentity: boolean): Promise<{ status: 'sent' }>;
  /** «Узнать автора» вопроса во входящих / ответа на свой вопрос */
  revealInbox(id: string): Promise<RevealResult>;
  revealAskAnswer(askId: string, answerId: string): Promise<RevealResult>;
  createAsk(text: string, source: string): Promise<AskSummary>;
  getAsks(): Promise<{ items: AskSummary[] }>;
  getAsk(id: string): Promise<{ ask: AskSummary; answers: AskAnswer[] }>;
  deleteAsk(id: string): Promise<void>;
  deleteAskAnswer(askId: string, answerId: string): Promise<void>;
  reportAskAnswer(askId: string, answerId: string): Promise<void>;
  blockAskAnswer(askId: string, answerId: string): Promise<void>;
  openAsk(id: string): Promise<PublicAsk>;
  answerAsk(id: string, text: string, idempotencyKey: string, revealIdentity: boolean): Promise<{ status: 'sent' }>;
  activity(): Promise<Activity>;
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
  | 'question_library_clicked'
  | 'question_library_paywall_shown'
  | 'story_sheet_opened'
  | 'story_shared'
  | 'app_open'
  | 'start_choice'
  | 'share_clicked'
  | 'feedback_clicked'
  | 'link_copied'
  | 'question_typing_started'
  | 'guest_create_link'
  | 'paywall_opened'
  | 'card_shared'
  | 'reveal_clicked';

/** Откуда пользователь пришёл на экран Premium — для конверсии в покупку */
export type UpsellSource = 'new_questionnaire' | 'custom_question' | 'question_library' | 'reveal' | 'ask_limit' | 'answers_locked' | 'inbox_locked';

/** Порог уникальных ответов до открытия результатов */
export const RESULTS_THRESHOLD = 5;

/** Текущая версия текста согласия на экране 08b */
export const DISCLOSURE_VERSION = '2026-10-v1';
