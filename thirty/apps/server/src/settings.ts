import { prisma } from './db';

export interface ValueItem {
  id: string;
  title: string;
  price: number;
  priceLabel?: string;
  emoji?: string;
  /** Короткое пояснение под названием на экране «Что входит в клуб» */
  description?: string;
  /** Подробности по нажатию на карточку */
  details?: string;
  enabled: boolean;
}

/** Продающее видео на первом экране (ссылка на YouTube; пусто — карточки нет) */
export interface OnboardingVideo { url: string; title: string; duration: string }

/** id ролика из любой ссылки YouTube (watch, youtu.be, shorts, embed, live); vertical — Shorts */
export function youtubeVideo(url: string): { id: string; vertical: boolean } | null {
  const m = url.trim().match(/^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? { id: m[1], vertical: /\/shorts\//.test(url) } : null;
}

/** Карточка результата участницы в карусели первого экрана (только реальные отзывы) */
export interface ReviewCard {
  id: string;
  emoji: string;
  title: string;
  text?: string;
  /** Оригинальный скриншот: путь /img/… из приложения или ключ reviews/… загруженного в админке файла */
  image?: string;
  enabled: boolean;
}


export interface EvidencePolicy {
  [category: string]: { evidence: 'checkbox' | 'photo' | 'screenshot' | 'checkbox_photo' | 'link'; photoRequired: boolean; selfReported: boolean; note: string };
}

/** Реальные результаты участниц (по скриншотам владельца 28.10); порядок — как просила владелица */
export const DEFAULT_REVIEWS: ReviewCard[] = [
  { id: 'weight', emoji: '⚖️🔥', title: '−6,2 кг!', text: 'С 65,9 до 59,7 кг за 1,5 месяца.', image: '/img/reviews/weight.jpg', enabled: true },
  { id: 'reels', emoji: '📈🚀', title: '309 000 просмотров на одном Reels!', image: '/img/reviews/reels.jpg', enabled: true },
  { id: 'veneers', emoji: '🦷😍', title: 'Начала лечение зубов и готовится поставить виниры!', text: '«Месяц назад даже не могла мечтать об этом».', image: '/img/reviews/veneers.jpg', enabled: true },
  { id: 'income', emoji: '💰🔥', title: '100 000 ₽ за один день!', text: 'Впервые пробила свой потолок по заработку.', image: '/img/reviews/income.jpg', enabled: true },
  { id: 'english', emoji: '🇬🇧📱', title: '51 день английского и блога без пропусков!', text: '«Моя бадди меня поддерживает… Очень…»', image: '/img/reviews/english.jpg', enabled: true },
  { id: 'learning', emoji: '📚🌟', title: 'Перестала откладывать и решилась на перемены!', text: 'Обучается почти каждый день.', image: '/img/reviews/learning.jpg', enabled: true },
  { id: 'discipline', emoji: '💪😍', title: 'Появилась дисциплина, которой раньше не хватало!', text: '«Очень дисциплинирует отчётность».', image: '/img/reviews/discipline.jpg', enabled: true },
  { id: 'voice', emoji: '🎙️💜', title: 'Результат уже за полмесяца!', text: '«Даже муж заметил».', image: '/img/reviews/voice.jpg', enabled: true },
  { id: 'weight2', emoji: '🥗💪', title: '−1,5 кг на пути к цели!', text: 'Держит калораж и двигается каждый день.', image: '/img/reviews/weight2.jpg', enabled: true },
];

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
    { id: 'weekly', emoji: '📊', title: 'Еженедельные разборы', description: 'Отслеживаем прогресс за неделю и ставим план на следующую', price: 0, enabled: true },
    { id: 'reports', emoji: '📸', title: 'Отчётность', description: 'Ежедневно скидываем отчёты в чат', price: 0, enabled: true },
    { id: 'experts', emoji: '🎓', title: 'Эксперты в тематических чатах', description: 'Сессии с финансовым коучем, психологом, репетитором по английскому в разговорном клубе и продюсером блогеров', price: 0, enabled: true },
    { id: 'planners', emoji: '📅', title: 'Планнеры и трекеры', description: 'Помогают дисциплинировать и оцифровать жизнь', price: 0, enabled: true },
    { id: 'products', emoji: '🥑', title: 'Продукты для похудения', description: 'На которых Анастасия похудела на −7 кг', price: 0, enabled: true },
    { id: 'support', emoji: '💜', title: 'Поддержка и окружение', description: 'Найдёшь новых друзей, с кем будешь расти дальше вместе', price: 0, enabled: true },
  ] as ValueItem[],
  'onboarding.reviews': DEFAULT_REVIEWS,
  'onboarding.video': { url: '', title: 'Видео о клубе «30 дней»', duration: '6 мин' } as OnboardingVideo,
  /** «С нами уже больше … участников!» на первом экране (число) */
  'community.count': '274',
  /** С какого момента к стартовому числу прибавляются новые оплатившие (ISO); пусто — только стартовое число */
  'community.countSince': '',
  'evidence.policy': {
    money: { evidence: 'checkbox_photo', photoRequired: false, selfReported: false, note: 'Скриншот по желанию. Не показывайте номера карт и суммы на счетах.' },
    weightloss: { evidence: 'photo', photoRequired: true, selfReported: false, note: 'Фото тарелки, весов или тренировки.' },
    blog: { evidence: 'link', photoRequired: false, selfReported: false, note: 'Ссылка на публикацию или скриншот.' },
    english: { evidence: 'checkbox', photoRequired: false, selfReported: true, note: 'Отметка о занятии.' },
    habits: { evidence: 'checkbox', photoRequired: false, selfReported: true, note: 'Отметка — честное слово участника.' },
    selfdev: { evidence: 'checkbox', photoRequired: false, selfReported: true, note: 'Отметка о выполнении.' },
  } as EvidencePolicy,
  'support.username': 'barashkova_a',
  /** Лендинг клуба: кнопка «Изучить ЧАСТЫЕ ВОПРОСЫ» в боте */
  'landing.url': 'https://nastyabarashkovaru-gif.github.io/-/',
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
  /** Три трекера в Google Таблицах — подарок за отзыв (ссылки задаёт администратор) */
  'trackers.links': { tasks: 'https://docs.google.com/spreadsheets/d/1qyq0ghlBROxV1NyedXJLQB_tNAkCXVkwNQFl2b21_Tg/edit?usp=sharing', week: 'https://docs.google.com/spreadsheets/d/1qyq0ghlBROxV1NyedXJLQB_tNAkCXVkwNQFl2b21_Tg/edit?usp=sharing', finance: 'https://docs.google.com/spreadsheets/d/1qyq0ghlBROxV1NyedXJLQB_tNAkCXVkwNQFl2b21_Tg/edit?usp=sharing' },
  /** Ссылка в QR-коде карточки результатов: бот с продающей цепочкой (метка stories — для аналитики переходов) */
  'stories.botLink': 'https://t.me/Dney30_bot?start=stories',
  /** Ссылка для оплативших до запуска приложения: месяц участия без оплаты (код создаётся при запуске сервера) */
  'legacy.invite': { code: '', maxUses: 200, expiresAt: '2026-11-07', enabled: true },
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
