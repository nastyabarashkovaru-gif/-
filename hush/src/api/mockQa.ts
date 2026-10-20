/**
 * Демо-режим HUSH 2.0: вопросы и ответы в localStorage (только для просмотра без сервера, все данные выдуманные).
 * Сценарии и события для панели DEMO — `qaDemoControls`.
 */
import { ApiError, type Activity, type AskAnswer, type AskSummary, type HushApi, type InboxItem, type QaSummary, type RevealResult, type SentItem } from './types';

const KEY = 'hush.demo.qa.v2';
const DEMO_DAILY = ['Что в тебе чаще всего понимают неправильно?', 'В чём ты изменилась сильнее всего за последний год?'];
/** Сколько вопросов нужно собрать, чтобы их прочитать (как INBOX_THRESHOLD на сервере) */
const THRESHOLD = 5;
/** Без подписки видны первые 3 ответа на свой вопрос (как FREE_ASK_ANSWERS) */
const FREE_ANSWERS = 3;
/** Без подписки открыты первые 5 полученных вопросов (как FREE_INBOX_OPEN) */
const FREE_INBOX = 5;

/** consent — автор разрешил узнать, кто он (в демо видно только через «Узнать автора») */
type StoredInbox = InboxItem & { consent?: boolean };
type StoredAnswer = { id: string; text: string; createdAt: string; consent?: boolean };
type StoredAsk = Omit<AskSummary, 'answerCount'> & { answers: StoredAnswer[] };

interface QaDB {
  slug: string | null;
  inbox: StoredInbox[];
  asks: StoredAsk[];
  sent: SentItem[];
  dailyDate?: string;
}

const uid = (len = 8) => Array.from({ length: len }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const link = (p: string) => `https://t.me/Hush_miniapp_bot/app?startapp=${p}`;
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

/** Слаг «друга» — форма вопроса гостя в демо */
export const DEMO_FRIEND_SLUG = 'DEMOFRIEND';

const DEMO_QUESTIONS = [
  'Какое было твоё первое впечатление обо мне?',
  'Ты когда-нибудь была влюблена в друга?',
  'Что ты никогда не расскажешь подписчикам?',
  'Какую песню ты слушаешь на повторе?',
  'О чём ты мечтаешь, но боишься сказать вслух?',
  'Кто тебе нравится прямо сейчас?',
  'Что тебя бесит в людях больше всего?',
  'Какой совет ты дала бы себе 5 лет назад?',
];
const DEMO_ANSWERS = [
  'Ты кажешься строгой, но на самом деле очень добрая.',
  'С тобой всегда легко и спокойно, спасибо за это.',
  'Мне кажется, ты недооцениваешь себя.',
  'Ты самая смешная из всех, кого я знаю 😂',
  'Твоя уверенность вдохновляет.',
  'Иногда ты слишком много берёшь на себя.',
  'Хочу, чтобы мы чаще виделись!',
];
/** Без username: кнопка «Открыть профиль» не должна вести на настоящий чужой аккаунт */
const DEMO_IDENTITIES = [{ firstName: 'Аня (демо)' }, { firstName: 'Макс (демо)' }, { firstName: 'Лиза (демо)' }];

function emptyDB(): QaDB {
  return { slug: null, inbox: [], asks: [], sent: [] };
}
function load(): QaDB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...emptyDB(), ...(JSON.parse(raw) as QaDB) };
  } catch {
    /* начинаем заново */
  }
  return emptyDB();
}
let db = load();
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* приватный режим */
  }
  window.dispatchEvent(new Event('hush:data-changed'));
}

/** Подписка в демо хранится в mock.ts — он передаёт сюда, как её узнать */
let hasPlan = () => false;
export function bindDemoPlan(fn: () => boolean) {
  hasPlan = fn;
}

const realCount = () => db.inbox.filter((i) => i.from !== 'hush').length;

export function mockQaSummary(): QaSummary {
  return {
    askSlug: db.slug,
    link: db.slug ? link(`u_${db.slug}`) : null,
    unanswered: db.inbox.filter((i) => !i.answer && i.status === 'new' && (i.from !== 'hush' || realCount() >= THRESHOLD)).length,
    asks: db.asks.length,
    sentUnread: db.sent.filter((s) => s.unread).length,
    sent: db.sent.length,
  };
}

function findInbox(id: string) {
  const item = db.inbox.find((i) => i.id === id);
  if (!item) throw new ApiError('not_found');
  return item;
}
function findAsk(id: string) {
  const a = db.asks.find((x) => x.id === id);
  if (!a) throw new ApiError('not_found');
  return a;
}
const strip = ({ answers, ...a }: StoredAsk): AskSummary => ({ ...a, answerCount: answers.length, lastAnswerAt: answers[0]?.createdAt ?? null });
const view = ({ consent: _c, ...i }: StoredInbox): InboxItem => i;

function revealOf(consent: boolean | undefined, index: number): RevealResult {
  if (!hasPlan()) return { status: 'requires_plan' };
  if (!consent) return { status: 'anonymous' };
  return { status: 'revealed', identity: DEMO_IDENTITIES[index % DEMO_IDENTITIES.length] };
}
const authorOf = (consent: boolean | undefined, index: number) => (consent ? DEMO_IDENTITIES[index % DEMO_IDENTITIES.length] : null);

function makeInbox(count: number) {
  return Array.from({ length: count }, (_, i): StoredInbox => ({
    id: uid(12),
    text: DEMO_QUESTIONS[i % DEMO_QUESTIONS.length],
    from: 'anon',
    status: 'new',
    answer: null,
    answeredAt: null,
    createdAt: ago(20 + i * 47),
    consent: i % 2 === 0,
  }));
}
function makeAsk(answers: number): StoredAsk {
  const id = uid();
  return {
    id,
    text: 'Какое было твоё первое впечатление обо мне?',
    createdAt: ago(60 * 26),
    link: link(`a_${id}`),
    answers: Array.from({ length: answers }, (_, i) => ({ id: uid(12), text: DEMO_ANSWERS[i % DEMO_ANSWERS.length], createdAt: ago(10 + i * 90), consent: i % 2 === 0 })),
  };
}

export type QaDemoScenario = 'new' | 'link' | 'gate-2' | 'inbox-7' | 'full';

export const QA_SCENARIOS: Array<[QaDemoScenario, string]> = [
  ['new', 'Новый пользователь'],
  ['link', 'Ссылка, вопросов нет'],
  ['gate-2', 'Собрано 2/5'],
  ['inbox-7', '7 вопросов'],
  ['full', 'Всё: вопросы, ответы, «Я спросил(а)»'],
];

export const qaDemoControls = {
  setScenario(s: QaDemoScenario) {
    db = emptyDB();
    if (s !== 'new') db.slug = uid();
    if (s === 'gate-2') db.inbox = makeInbox(2);
    if (s === 'inbox-7' || s === 'full') db.inbox = makeInbox(7);
    if (s === 'full') {
      db.inbox[1] = { ...db.inbox[1], status: 'answered', answer: 'Честно — с первой встречи 🙈', answeredAt: ago(15) };
      db.asks = [makeAsk(6)];
      db.sent = [
        { id: uid(12), text: 'Что ты думаешь обо мне на самом деле?', recipient: { firstName: 'Аня', photoUrl: null }, answer: 'Что ты очень светлый человек 💜', status: 'answered', unread: true, answeredAt: ago(30), createdAt: ago(300) },
        { id: uid(12), text: 'Куда поедешь летом?', recipient: { firstName: 'Макс', photoUrl: null }, answer: null, status: 'waiting', unread: false, answeredAt: null, createdAt: ago(120) },
      ];
    }
    save();
  },
  /** Ещё один анонимный вопрос во «Мне задали» */
  addQuestion() {
    if (!db.slug) db.slug = uid();
    db.inbox.unshift({ ...makeInbox(1)[0], text: DEMO_QUESTIONS[realCount() % DEMO_QUESTIONS.length], createdAt: new Date().toISOString(), consent: realCount() % 2 === 0 });
    save();
  },
  /** Ещё один ответ на свой вопрос подписчикам (создаёт вопрос, если его нет) */
  addAskAnswer(): string {
    if (!db.asks.length) db.asks.unshift(makeAsk(0));
    const a = db.asks[0];
    a.answers.unshift({ id: uid(12), text: DEMO_ANSWERS[a.answers.length % DEMO_ANSWERS.length], createdAt: new Date().toISOString(), consent: a.answers.length % 2 === 0 });
    save();
    return a.id;
  },
  firstInboxId: () => db.inbox.find((i) => i.from !== 'hush')?.id ?? null,
  firstAskId: () => db.asks[0]?.id ?? null,
  get slug() {
    return db.slug;
  },
  reset() {
    db = emptyDB();
    save();
  },
};

export const mockQa: Pick<
  HushApi,
  | 'createLink' | 'getInbox' | 'markStory' | 'getSent' | 'revealInbox' | 'revealAskAnswer' | 'answerInbox' | 'deleteInboxAnswer' | 'deleteInbox' | 'reportInbox' | 'blockInbox'
  | 'openRecipient' | 'sendQuestion' | 'createAsk' | 'getAsks' | 'getAsk' | 'deleteAsk' | 'deleteAskAnswer'
  | 'reportAskAnswer' | 'blockAskAnswer' | 'openAsk' | 'answerAsk' | 'activity'
> = {
  async createLink() {
    await delay();
    if (!db.slug) {
      db.slug = uid();
      save();
    }
    return { slug: db.slug, link: link(`u_${db.slug}`) };
  },
  async getInbox() {
    await delay();
    const today = new Date().toISOString().slice(0, 10);
    if (db.slug && db.dailyDate !== today) {
      db.dailyDate = today;
      const text = DEMO_DAILY[db.inbox.filter((i) => i.from === 'hush').length % DEMO_DAILY.length];
      db.inbox.unshift({ id: uid(12), text, from: 'hush', status: 'new', answer: null, answeredAt: null, createdAt: new Date().toISOString() });
      save();
    }
    const collected = realCount();
    if (collected < THRESHOLD) return { items: [], gate: { collected, required: THRESHOLD } };
    const premium = hasPlan();
    const real = db.inbox.filter((i) => i.from !== 'hush');
    const open = new Set([...db.inbox.filter((i) => i.from === 'hush'), ...[...real].reverse().slice(0, premium ? real.length : FREE_INBOX)].map((i) => i.id));
    const author = (i: StoredInbox) => (premium ? { author: authorOf(i.from !== 'hush' && i.consent, db.inbox.indexOf(i)) } : {});
    return {
      items: [
        ...db.inbox.filter((i) => open.has(i.id)).map((i) => ({ ...view(i), ...author(i) })),
        ...db.inbox.filter((i) => !open.has(i.id)).map((i) => ({ ...view(i), text: null, answer: null, locked: true })),
      ],
    };
  },
  async answerInbox(id, text) {
    await delay();
    const item = findInbox(id);
    Object.assign(item, { answer: text, answeredAt: new Date().toISOString(), status: 'answered' });
    save();
    return view(item);
  },
  async deleteInboxAnswer(id) {
    await delay();
    const item = findInbox(id);
    Object.assign(item, { answer: null, answeredAt: null, status: 'new' });
    save();
    return view(item);
  },
  async revealInbox(id) {
    await delay();
    const item = findInbox(id);
    return revealOf(item.from !== 'hush' && item.consent, db.inbox.indexOf(item));
  },
  async revealAskAnswer(askId, answerId) {
    await delay();
    const a = findAsk(askId);
    const x = a.answers.find((y) => y.id === answerId);
    if (!x) throw new ApiError('not_found');
    return revealOf(x.consent, a.answers.indexOf(x));
  },
  async markStory(id) {
    await delay();
    const item = findInbox(id);
    if (item.status === 'new') item.status = 'story';
    save();
    return view(item);
  },
  async getSent() {
    await delay();
    const items = db.sent.map((s) => ({ ...s }));
    if (db.sent.some((s) => s.unread)) {
      db.sent = db.sent.map((s) => ({ ...s, unread: false }));
      save();
    }
    return { items };
  },
  async deleteInbox(id) {
    await delay();
    db.inbox = db.inbox.filter((i) => i.id !== id);
    save();
  },
  async reportInbox(id) {
    return mockQa.deleteInbox(id);
  },
  async blockInbox(id) {
    return mockQa.deleteInbox(id);
  },
  async openRecipient(slug) {
    await delay();
    return { firstName: slug === db.slug ? 'Ты' : 'Аня', photoUrl: null, own: slug === db.slug };
  },
  async sendQuestion(slug, text, _key, revealIdentity) {
    await delay();
    if (slug === db.slug) db.inbox.unshift({ id: uid(12), text, from: 'anon', status: 'new', answer: null, answeredAt: null, createdAt: new Date().toISOString(), consent: revealIdentity });
    else db.sent.unshift({ id: uid(12), text, recipient: { firstName: 'Аня', photoUrl: null }, answer: null, status: 'waiting', unread: false, answeredAt: null, createdAt: new Date().toISOString() });
    save();
    return { status: 'sent' };
  },
  async createAsk(text) {
    await delay();
    const id = uid();
    const ask: StoredAsk = { id, text, createdAt: new Date().toISOString(), link: link(`a_${id}`), answers: [] };
    db.asks.unshift(ask);
    save();
    return strip(ask);
  },
  async getAsks() {
    await delay();
    return { items: db.asks.map(strip) };
  },
  async getAsk(id) {
    await delay();
    const a = findAsk(id);
    // Без подписки — первые 3 ответа по времени, остальные под замком
    const open = new Set([...a.answers].reverse().slice(0, hasPlan() ? a.answers.length : FREE_ANSWERS).map((x) => x.id));
    // Как на сервере: без подписки — по порядку (3 бесплатных сверху), с подпиской — новые сверху
    const ordered = hasPlan() ? a.answers : [...a.answers].reverse();
    const answers: AskAnswer[] = ordered.map((x) =>
      open.has(x.id)
        ? { id: x.id, text: x.text, createdAt: x.createdAt, ...(hasPlan() ? { author: authorOf(x.consent, a.answers.indexOf(x)) } : {}) }
        : { id: x.id, text: null, locked: true, createdAt: x.createdAt },
    );
    return { ask: strip(a), answers };
  },
  async deleteAsk(id) {
    await delay();
    db.asks = db.asks.filter((a) => a.id !== id);
    save();
  },
  async deleteAskAnswer(askId, answerId) {
    await delay();
    const a = findAsk(askId);
    a.answers = a.answers.filter((x) => x.id !== answerId);
    save();
  },
  async reportAskAnswer(askId, answerId) {
    return mockQa.deleteAskAnswer(askId, answerId);
  },
  async blockAskAnswer(askId, answerId) {
    return mockQa.deleteAskAnswer(askId, answerId);
  },
  async openAsk(id) {
    await delay();
    const a = db.asks.find((x) => x.id === id);
    // Чужой вопрос в демо — от «Ани»
    if (!a) return { id, text: 'Какое было твоё первое впечатление обо мне?', firstName: 'Аня', photoUrl: null, own: false, answered: false };
    return { id: a.id, text: a.text, firstName: 'Ты', photoUrl: null, own: true, answered: false };
  },
  async answerAsk(id, text, _key, revealIdentity) {
    await delay();
    const a = db.asks.find((x) => x.id === id);
    if (a) {
      a.answers.unshift({ id: uid(12), text, createdAt: new Date().toISOString(), consent: revealIdentity });
      save();
    }
    return { status: 'sent' };
  },
  async activity(): Promise<Activity> {
    await delay();
    return {
      received: realCount(),
      answered: db.inbox.filter((i) => i.answer).length,
      asks: db.asks.length,
      askAnswers: db.asks.reduce((n, a) => n + a.answers.length, 0),
      sent: db.sent.length,
    };
  },
};
