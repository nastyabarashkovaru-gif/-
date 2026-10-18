/**
 * Демо-режим HUSH 2.0: вопросы и ответы в localStorage (только для разработки и просмотра без сервера).
 */
import { ApiError, type Activity, type AskAnswer, type AskSummary, type HushApi, type InboxItem, type QaSummary } from './types';

const KEY = 'hush.demo.qa.v1';
const DEMO_DAILY = ['Что в тебе чаще всего понимают неправильно?', 'В чём ты изменилась сильнее всего за последний год?'];

interface QaDB {
  slug: string | null;
  inbox: InboxItem[];
  asks: Array<AskSummary & { answers: AskAnswer[] }>;
  dailyDate?: string;
}

const uid = (len = 8) => Array.from({ length: len }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const link = (p: string) => `https://t.me/Hush_miniapp_bot/app?startapp=${p}`;

function load(): QaDB {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as QaDB;
  } catch {
    /* начинаем заново */
  }
  return { slug: null, inbox: [], asks: [] };
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

export function mockQaSummary(): QaSummary {
  return {
    askSlug: db.slug,
    link: db.slug ? link(`u_${db.slug}`) : null,
    unanswered: db.inbox.filter((i) => !i.answer).length,
    asks: db.asks.length,
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
const strip = ({ answers: _a, ...a }: AskSummary & { answers: AskAnswer[] }): AskSummary => ({ ...a, answerCount: _a.length });

export const mockQa: Pick<
  HushApi,
  | 'createLink' | 'getInbox' | 'markStory' | 'getSent' | 'answerInbox' | 'deleteInboxAnswer' | 'deleteInbox' | 'reportInbox' | 'blockInbox'
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
    return { items: db.inbox };
  },
  async answerInbox(id, text) {
    await delay();
    const item = findInbox(id);
    Object.assign(item, { answer: text, answeredAt: new Date().toISOString(), status: 'answered' });
    save();
    return item;
  },
  async deleteInboxAnswer(id) {
    await delay();
    const item = findInbox(id);
    Object.assign(item, { answer: null, answeredAt: null, status: 'new' });
    save();
    return item;
  },
  async markStory(id) {
    await delay();
    const item = findInbox(id);
    if (item.status === 'new') item.status = 'story';
    save();
    return item;
  },
  async getSent() {
    await delay();
    return { items: [] };
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
    return { firstName: 'Демо', photoUrl: null, own: slug === db.slug };
  },
  async sendQuestion(slug, text) {
    await delay();
    if (slug === db.slug) {
      db.inbox.unshift({ id: uid(12), text, from: 'anon', status: 'new', answer: null, answeredAt: null, createdAt: new Date().toISOString() });
      save();
    }
    return { status: 'sent' };
  },
  async createAsk(text) {
    await delay();
    const ask = { id: uid(), text, createdAt: new Date().toISOString(), answerCount: 0, link: '', answers: [] as AskAnswer[] };
    ask.link = link(`a_${ask.id}`);
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
    return { ask: strip(a), answers: a.answers };
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
    const a = findAsk(id);
    return { id: a.id, text: a.text, firstName: 'Демо', photoUrl: null, own: true, answered: false };
  },
  async answerAsk(id, text) {
    await delay();
    const a = findAsk(id);
    a.answers.unshift({ id: uid(12), text, createdAt: new Date().toISOString() });
    save();
    return { status: 'sent' };
  },
  async activity(): Promise<Activity> {
    await delay();
    return {
      received: db.inbox.filter((i) => i.from === 'anon').length,
      answered: db.inbox.filter((i) => i.answer).length,
      asks: db.asks.length,
      askAnswers: db.asks.reduce((n, a) => n + a.answers.length, 0),
      sent: 0,
    };
  },
};
