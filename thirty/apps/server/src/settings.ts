import { prisma } from './db';

export interface ValueItem {
  id: string;
  title: string;
  price: number;
  priceLabel?: string;
  emoji?: string;
  enabled: boolean;
}

export interface EvidencePolicy {
  [category: string]: { evidence: 'checkbox' | 'photo' | 'screenshot' | 'checkbox_photo' | 'link'; photoRequired: boolean; selfReported: boolean; note: string };
}

/** Значения по умолчанию; в БД хранятся только переопределения из админки */
export const DEFAULT_SETTINGS = {
  'flow.timezone': 'Europe/Moscow',
  'flow.lateJoinUntilDay': 1,
  'flow.mandatoryDays': 'all',
  'offer.durationMinutes': 180,
  'payment.pendingWindowMinutes': 30,
  'prize.formula': { percentOfRevenue: 10, fixed: 0, cap: null as number | null },
  'prize.rulesText':
    'Приз получают участники с идеальным результатом: 100% обязательных выполнений по всем целям, ни одного пропущенного ежедневного отчёта и подтверждённое достижение всех выбранных целей. Все претенденты проходят ручную проверку доказательств. Призовых мест не больше трёх; при равенстве места распределяются по публичному тай-брейку: процент выполнения → полностью закрытые дни → самая длинная серия → время подачи итоговой анкеты.',
  'value.items': [
    { id: 'psychologist', emoji: '🧠', title: 'Сессия с психологом', price: 3000, priceLabel: 'от 3 000 ₽', enabled: true },
    { id: 'coach', emoji: '🎯', title: 'Сессия с коучем', price: 3000, priceLabel: 'от 3 000 ₽', enabled: true },
    { id: 'english', emoji: '🇬🇧', title: 'Сессия с репетитором', price: 1500, priceLabel: 'от 1 500 ₽', enabled: true },
    { id: 'blog', emoji: '📚', title: 'Обучение по блогингу и заработку с блога', price: 19000, enabled: true },
    { id: 'planners', emoji: '📅', title: 'Планнеры и трекеры', price: 3999, enabled: true },
    { id: 'products', emoji: '🥑', title: 'Продуктовая корзина для похудения', price: 1500, enabled: true },
  ] as ValueItem[],
  'evidence.policy': {
    money: { evidence: 'checkbox_photo', photoRequired: false, selfReported: false, note: 'Скриншот по желанию. Не показывайте номера карт и суммы на счетах.' },
    weightloss: { evidence: 'photo', photoRequired: true, selfReported: false, note: 'Фото тарелки, весов или тренировки.' },
    blog: { evidence: 'link', photoRequired: false, selfReported: false, note: 'Ссылка на публикацию или скриншот.' },
    english: { evidence: 'checkbox', photoRequired: false, selfReported: true, note: 'Отметка о занятии.' },
    habits: { evidence: 'checkbox', photoRequired: false, selfReported: true, note: 'Отметка — честное слово участника.' },
    selfdev: { evidence: 'checkbox', photoRequired: false, selfReported: true, note: 'Отметка о выполнении.' },
  } as EvidencePolicy,
  'support.username': 'barashkova_a',
  /** Продавец и реквизиты для оферты и политики ПДн */
  'legal.seller': 'Индивидуальный предприниматель Барашкова Анастасия Андреевна (ИНН 420535629401)',
  /** То же в родительном падеже — для фразы «оферта …» */
  'legal.sellerGenitive': 'индивидуального предпринимателя Барашковой Анастасии Андреевны (ИНН 420535629401)',
  'legal.requisites': [
    'Индивидуальный предприниматель Барашкова Анастасия Андреевна',
    'ИНН 420535629401',
    'Расчётный счёт 40802810620000438812',
    'Банк: ООО «Банк Точка»',
    'БИК 044525104',
    'Корреспондентский счёт 30101810745374525104',
    'E-mail: Nastya.barashkova.ru@yandex.ru',
  ].join('\n'),
  'chats.inviteTtlHours': 72,
  'minAge': 18,
  'features': {
    prize_random_draw: false,
    offer_referral_restore: false,
    upsells: false,
    /** Дожимная цепочка бота до оплаты (сообщения 2–11) */
    chain_prepurchase: true,
  } as Record<string, boolean>,
  /** Instagram-аккаунт для отметки в сторис (без @) */
  'instagram.account': 'barashkova.aa',
  /** Сколько дней действует персональный промокод за сторис */
  'promo.personalDays': 3,
  /** «Полезные материалы»: одна ссылка на канал для всех карточек (можно поменять в админке: Настройки → materials) */
  'materials': [
    { id: 'goal', kind: 'Гайд', title: 'Как выбрать цель', text: 'Определи, чего ты действительно хочешь достичь за 30 дней.', icon: 'target', url: 'https://t.me/+DAqhaepx_0oxZjM6' },
    { id: 'basket', kind: 'Подборка', title: 'Моя продуктовая корзина', text: 'Продукты, с которыми я похудела на 7 кг без ограничений.', icon: 'basket', url: 'https://t.me/+DAqhaepx_0oxZjM6' },
    { id: 'monetize', kind: 'Обучение', title: 'Монетизация блога', text: 'Как начать зарабатывать на своём контенте.', icon: 'trend', url: 'https://t.me/+DAqhaepx_0oxZjM6' },
    { id: 'podcast', kind: 'Подкаст', title: 'Как выбрать свою тему блога', text: 'Найди направление, о котором захочется рассказывать.', icon: 'headphones', url: 'https://t.me/+DAqhaepx_0oxZjM6' },
  ] as { id: string; kind: string; title: string; text: string; icon: string; url: string }[],
  'cases': [] as { name: string; text: string; result: string }[],
};

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

const cache = new Map<string, { at: number; value: unknown }>();

export async function getSetting<K extends SettingKey>(key: K): Promise<(typeof DEFAULT_SETTINGS)[K]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10_000) return hit.value as (typeof DEFAULT_SETTINGS)[K];
  const row = await prisma.setting.findUnique({ where: { key } });
  const value = (row?.value ?? DEFAULT_SETTINGS[key]) as (typeof DEFAULT_SETTINGS)[K];
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function setSetting<K extends SettingKey>(key: K, value: (typeof DEFAULT_SETTINGS)[K]) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
  cache.delete(key);
}

export function clearSettingsCache() {
  cache.clear();
}

export async function feature(name: string): Promise<boolean> {
  const f = await getSetting('features');
  return Boolean(f[name] ?? DEFAULT_SETTINGS.features[name]);
}
