/**
 * Локальный mock backend для демо-режима.
 * Повторяет серверные правила (порог 5 ответов, закрытые ответы, проверка согласия
 * до раскрытия), чтобы UI можно было без изменений переключить на настоящий API.
 * Данные хранятся в localStorage и помечены как демо.
 */
import type { PlanId } from '@/data/plans';
import { QUESTIONS, QUESTIONS_REQUIRED, type Question } from '@/data/questions';
import {
  DEMO_ANSWERS,
  DEMO_FRIEND_QUESTION_IDS,
  DEMO_FRIEND_QUESTIONNAIRE_ID,
  DEMO_IDENTITIES,
  DEMO_OWNER_QUESTION_IDS,
  GENERIC_ANSWERS,
  seededRandom,
} from '@/demo/seed';
import { getTelegramUser } from '@/lib/telegram';
import {
  ApiError,
  type BillingResult,
  type Bootstrap,
  type ConsentRecord,
  type HushApi,
  type PublicQuestionnaire,
  type QuestionnaireSummary,
  type ResultsView,
  type RevealResult,
  type SubmitPayload,
} from './types';

const STORAGE_KEY = 'hush.demo.v1';
export const RESULTS_THRESHOLD = 5;
const FREE_VISIBLE_ANSWERS = 2;
const FREE_QUESTIONNAIRES = 1;

interface StoredQuestionnaire {
  id: string;
  createdAt: string;
  questions: Question[];
}

interface StoredResponse {
  id: string;
  questionnaireId: string;
  submittedAt: string;
  answers: Array<{ questionId: string; text: string }>;
  consent: ConsentRecord;
  identity: { firstName: string; username?: string };
}

interface DB {
  questionnaires: StoredQuestionnaire[];
  responses: StoredResponse[];
  plan: PlanId | null;
  autoRenew: boolean;
  /** Ответы, отправленные пользователем на чужие анкеты (аудит согласия) */
  sent: Array<{ questionnaireId: string; idempotencyKey: string; consent: ConsentRecord; answers: SubmitPayload['answers'] }>;
}

const emptyDB = (): DB => ({ questionnaires: [], responses: [], plan: null, autoRenew: true, sent: [] });

function load(): DB {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...emptyDB(), ...(JSON.parse(raw) as DB) };
  } catch {
    /* повреждённые данные — начинаем заново */
  }
  return emptyDB();
}

let db = load();

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* приватный режим — работаем в памяти */
  }
  window.dispatchEvent(new Event('hush:data-changed'));
}

const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms + Math.random() * 120));
const uid = (len = 8) =>
  Array.from({ length: len }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const byId = (ids: string[]) => ids.map((id) => QUESTIONS.find((q) => q.id === id)!).filter(Boolean);
const totalLength = (r: StoredResponse) => r.answers.reduce((sum, a) => sum + a.text.length, 0);

function summary(q: StoredQuestionnaire): QuestionnaireSummary {
  return {
    id: q.id,
    createdAt: q.createdAt,
    questions: q.questions,
    respondentCount: db.responses.filter((r) => r.questionnaireId === q.id).length,
  };
}

function findOwn(id: string): StoredQuestionnaire {
  const q = db.questionnaires.find((item) => item.id === id);
  if (!q) throw new ApiError('not_found');
  return q;
}

/** Порядок карточек: самый содержательный ответ первым, остальные — по времени */
function orderedResponses(questionnaireId: string): StoredResponse[] {
  const list = db.responses
    .filter((r) => r.questionnaireId === questionnaireId)
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  if (list.length === 0) return list;
  const best = list.reduce((top, r) => (totalLength(r) > totalLength(top) ? r : top), list[0]);
  return [best, ...list.filter((r) => r !== best)];
}

export const mockApi: HushApi = {
  async bootstrap(): Promise<Bootstrap> {
    await delay(200);
    const tg = getTelegramUser();
    return {
      me: tg
        ? { id: String(tg.id), firstName: tg.first_name, lastName: tg.last_name, username: tg.username, photoUrl: tg.photo_url }
        : { id: 'demo-user', firstName: '' },
      entitlement: { plan: db.plan, autoRenew: db.autoRenew, renewsAt: null, demo: true },
      questionnaires: [...db.questionnaires].reverse().map(summary),
    };
  },

  async createQuestionnaire(questions) {
    await delay(450);
    const unique = new Set(questions.map((q) => q.id));
    if (questions.length !== QUESTIONS_REQUIRED || unique.size !== QUESTIONS_REQUIRED) throw new ApiError('invalid');
    const premium = db.plan !== null;
    if (!premium && (questions.some((q) => q.custom) || db.questionnaires.length >= FREE_QUESTIONNAIRES)) {
      throw new ApiError('premium_required');
    }
    const q: StoredQuestionnaire = { id: uid(), createdAt: new Date().toISOString(), questions };
    db.questionnaires.push(q);
    save();
    return summary(q);
  },

  async getQuestionnaire(id) {
    await delay(150);
    return summary(findOwn(id));
  },

  async getResults(id): Promise<ResultsView> {
    await delay(300);
    const q = findOwn(id);
    const responses = orderedResponses(id);
    if (responses.length < RESULTS_THRESHOLD) throw new ApiError('threshold_not_met');
    const premium = db.plan !== null;

    return {
      questionnaireId: id,
      respondentCount: responses.length,
      respondents: responses.map((r, index) => {
        // Бесплатно: первый (самый содержательный) — полностью, остальные — 2 самых длинных ответа
        const openIds =
          premium || index === 0
            ? new Set(r.answers.map((a) => a.questionId))
            : new Set(
                [...r.answers]
                  .sort((a, b) => b.text.length - a.text.length)
                  .slice(0, FREE_VISIBLE_ANSWERS)
                  .map((a) => a.questionId),
              );
        const answers = q.questions.map((question) => {
          const answer = r.answers.find((a) => a.questionId === question.id);
          const open = openIds.has(question.id);
          return { questionId: question.id, question: question.text, text: open ? answer?.text ?? '' : null, locked: !open };
        });
        // Открытые — сверху, закрытые — в блоке «Другие результаты»
        answers.sort((a, b) => Number(a.locked) - Number(b.locked));
        return { id: r.id, number: index + 1, answers };
      }),
    };
  },

  async requestReveal(questionnaireId, respondentId): Promise<RevealResult> {
    await delay(500);
    findOwn(questionnaireId);
    const r = db.responses.find((item) => item.id === respondentId && item.questionnaireId === questionnaireId);
    if (!r) throw new ApiError('not_found');
    // 1) Согласие проверяется ДО любых списаний
    if (!r.consent.revealIdentity) return { status: 'anonymous' };
    // 2) Безлимитное раскрытие — только годовой тариф (разовая оплата — после подтверждения продукта)
    if (db.plan !== 'year') return { status: 'requires_plan' };
    // 3) Только разрешённые поля профиля
    return { status: 'revealed', identity: { firstName: r.identity.firstName, username: r.identity.username } };
  },

  async openForResponse(id): Promise<PublicQuestionnaire> {
    await delay(300);
    if (db.questionnaires.some((q) => q.id === id)) throw new ApiError('own_questionnaire');
    if (id !== DEMO_FRIEND_QUESTIONNAIRE_ID) throw new ApiError('not_found');
    if (db.sent.some((s) => s.questionnaireId === id)) throw new ApiError('already_answered');
    return { id, questions: byId(DEMO_FRIEND_QUESTION_IDS) };
  },

  async submitResponses(payload) {
    await delay(700);
    if (db.sent.some((s) => s.idempotencyKey === payload.idempotencyKey)) return;
    if (db.sent.some((s) => s.questionnaireId === payload.questionnaireId)) throw new ApiError('already_answered');
    if (payload.answers.length !== QUESTIONS_REQUIRED || payload.answers.some((a) => !a.text.trim())) {
      throw new ApiError('invalid');
    }
    db.sent.push({ ...payload });
    save();
  },

  async startCheckout(): Promise<BillingResult> {
    await delay(200);
    return { status: 'unavailable' };
  },
  async restorePurchases(): Promise<BillingResult> {
    await delay(200);
    return { status: 'unavailable' };
  },
  async setAutoRenew(): Promise<BillingResult> {
    await delay(200);
    return { status: 'unavailable' };
  },
};

/* ───────────────────────── Управление демо-данными ───────────────────────── */

function makeResponse(questionnaire: StoredQuestionnaire, index: number): StoredResponse {
  const rand = seededRandom(index * 7919 + questionnaire.id.charCodeAt(0));
  const pick = (questionId: string) => {
    const pool = DEMO_ANSWERS[questionId] ?? GENERIC_ANSWERS;
    return pool[Math.floor(rand() * pool.length)];
  };
  const answers = questionnaire.questions.map((q) => {
    const pool = DEMO_ANSWERS[q.id] ?? GENERIC_ANSWERS;
    let text = pick(q.id);
    if (index === 0) {
      // Первый демо-респондент — самый развёрнутый
      text = `${pool[0]} ${pool[pool.length > 1 ? 1 : 0]}`;
    } else if (index === 1 && pool.length) {
      // Совпадает с макетом 05: два самых длинных ответа — про зависть и «сказать в лицо»
      const preferShort = ['q7', 'q5'].includes(q.id) ? pool[0] : [...pool].sort((a, b) => a.length - b.length)[0];
      text = preferShort;
    }
    return { questionId: q.id, text };
  });
  const identity = DEMO_IDENTITIES[index % DEMO_IDENTITIES.length];
  return {
    id: `${questionnaire.id}-r${index + 1}`,
    questionnaireId: questionnaire.id,
    submittedAt: new Date(Date.parse(questionnaire.createdAt) + (index + 1) * 60_000).toISOString(),
    answers,
    consent: { revealIdentity: index % 3 !== 1, disclosureVersion: 'demo', decidedAt: new Date().toISOString() },
    identity: { firstName: `${identity.firstName} (демо)`, username: identity.username },
  };
}

export type DemoScenario = 'new' | 'waiting-0' | 'waiting-3' | 'results-5' | 'results-18' | 'results-50' | 'results-100';

export const demoControls = {
  get plan(): PlanId | null {
    return db.plan;
  },
  get autoRenew(): boolean {
    return db.autoRenew;
  },
  setScenario(scenario: DemoScenario) {
    const keepPlan = db.plan;
    const keepAutoRenew = db.autoRenew;
    db = { ...emptyDB(), plan: keepPlan, autoRenew: keepAutoRenew };
    if (scenario !== 'new') {
      const q: StoredQuestionnaire = {
        id: 'DEMO1',
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        questions: byId(DEMO_OWNER_QUESTION_IDS),
      };
      db.questionnaires.push(q);
      const count = Number(scenario.split('-')[1]);
      for (let i = 0; i < count; i++) db.responses.push(makeResponse(q, i));
    }
    save();
  },
  /** Имитирует, что ещё один друг заполнил последнюю анкету */
  addRespondent(): boolean {
    const q = db.questionnaires[db.questionnaires.length - 1];
    if (!q) return false;
    const index = db.responses.filter((r) => r.questionnaireId === q.id).length;
    db.responses.push({ ...makeResponse(q, index), submittedAt: new Date().toISOString() });
    save();
    return true;
  },
  setPlan(plan: PlanId | null) {
    db.plan = plan;
    if (plan) db.autoRenew = true;
    save();
  },
  setAutoRenew(value: boolean) {
    db.autoRenew = value;
    save();
  },
  resetFriendAnswer() {
    db.sent = [];
    save();
  },
  resetAll() {
    db = emptyDB();
    save();
  },
};
