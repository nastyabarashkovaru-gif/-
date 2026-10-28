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

/** Экран 3 онбординга «Что ты получишь внутри клуба?» (ТЗ владельца 28.10) */
export const VALUE_ITEMS_V2: ValueItem[] = [
  { id: 'weekly', emoji: '🎥', title: 'Еженедельные разборы', description: 'Отслеживаем прогресс за неделю и ставим план на следующую.', details: 'Раз в неделю созвон с лидером твоей темы: разбираем, что получилось и что мешало, и составляем план на следующую неделю.', price: 0, enabled: true },
  { id: 'reports', emoji: '📸', title: 'Ежедневная отчётность', description: 'Каждый день делимся результатами и поддерживаем дисциплину.', details: 'Каждый день отмечаешь выполненные действия и прикрепляешь фото. Отчёты видят другие участники — так проще не откладывать на завтра.', price: 0, enabled: true },
  { id: 'experts', emoji: '🧠', title: 'Лидеры и специалисты', description: 'Сессии с психологом, финансовый коуч, английский язык, продвижение и монетизация блога.', details: 'У каждой темы свой лидер: финансовый коуч, психолог, репетитор по английскому, лидер по продвижению блога, лидер по питанию и спорту.', price: 0, enabled: true },
  { id: 'buddy', emoji: '🤝', title: 'Личный бадди', description: 'Напарник, который поддерживает и помогает не сдаваться.', details: 'Мы подберём тебе бадди с похожими целями — или приходи с подругой. Вы поддерживаете друг друга и не даёте слиться.', price: 0, enabled: true },
  { id: 'chats', emoji: '💬', title: 'Тематические чаты', description: 'Общение с людьми, которые идут к похожим целям.', details: 'Чаты по целям: деньги, похудение, блог, английский, привычки. Делись опытом, задавай вопросы и находи поддержку.', price: 0, enabled: true },
  { id: 'blogging', emoji: '📚', title: 'Обучение по блогингу', description: 'Материалы по продвижению и монетизации социальных сетей.', details: 'Материалы и разборы по росту подписчиков, продвижению и монетизации блога.', price: 0, enabled: true },
  { id: 'planners', emoji: '🗓', title: 'Планеры и трекеры', description: 'Помогают дисциплинировать и оцифровать свою жизнь.', details: 'Готовые планеры и трекеры, чтобы планировать день и неделю и видеть свой прогресс в цифрах.', price: 0, enabled: true },
  { id: 'products', emoji: '🥑', title: 'Продукты для похудения', description: 'Список продуктов, на которых основательница клуба похудела на 7 кг.', details: 'Список продуктов, на которых основательница клуба Анастасия похудела на 7 кг.', price: 0, enabled: true },
  { id: 'support', emoji: '💜', title: 'Поддержка и окружение', description: 'Новые друзья, с которыми можно расти и развиваться вместе.', details: 'Общий чат потока, где можно быть собой, делиться победами и каждый день видеть, как другие идут к своим целям.', price: 0, enabled: true },
];

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
  'value.items': VALUE_ITEMS_V2,
  'onboarding.reviews': DEFAULT_REVIEWS,
  /** «С нами уже … участников!» на первом экране */
  'community.count': '300+',
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
  /** Три трекера в Google Таблицах — подарок за отзыв (ссылки задаёт администратор) */
  'trackers.links': { tasks: 'https://docs.google.com/spreadsheets/d/1qyq0ghlBROxV1NyedXJLQB_tNAkCXVkwNQFl2b21_Tg/edit?usp=sharing', week: 'https://docs.google.com/spreadsheets/d/1qyq0ghlBROxV1NyedXJLQB_tNAkCXVkwNQFl2b21_Tg/edit?usp=sharing', finance: 'https://docs.google.com/spreadsheets/d/1qyq0ghlBROxV1NyedXJLQB_tNAkCXVkwNQFl2b21_Tg/edit?usp=sharing' },
  /** Ссылка в QR-коде карточки результатов: бот с продающей цепочкой (метка stories — для аналитики переходов) */
  'stories.botLink': 'https://t.me/Dney30_bot?start=stories',
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
