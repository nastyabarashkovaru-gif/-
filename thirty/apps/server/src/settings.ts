import { prisma } from './db';

export interface ValueItem {
  id: string;
  title: string;
  price: number;
  priceLabel?: string;
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
    { id: 'coach', title: 'Коуч по финансам', price: 3000, enabled: true },
    { id: 'english', title: 'Английский с репетитором', price: 1500, priceLabel: 'от 1 500 ₽/мес', enabled: true },
    { id: 'blog', title: 'Мини-обучение по блогу', price: 15000, enabled: true },
    { id: 'planners', title: 'Планнеры и трекеры', price: 3999, enabled: true },
    { id: 'products', title: 'Полезные продукты клуба', price: 1500, enabled: true },
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
  'chats.inviteTtlHours': 72,
  'minAge': 18,
  'features': {
    prize_random_draw: false,
    offer_referral_restore: false,
    upsells: false,
  } as Record<string, boolean>,
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
  return Boolean(f[name]);
}
