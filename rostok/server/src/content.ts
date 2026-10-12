/** Тексты и флаги по умолчанию. Всё редактируется в админке (app_config) без деплоя. */
export const DEFAULT_BRAND = {
  appName: 'ROSTOK',
  slogan: 'Выполняй задания в реальной жизни и выращивай свой сад',
};

export const DEFAULT_ONBOARDING = {
  slides: [
    { id: 'restart', title: 'Устала начинать новую жизнь с понедельника?', text: 'Планы копятся. Мотивация исчезает. А ты снова обещаешь себе начать завтра.', art: 'lonely-sprout' },
    { id: 'small-steps', title: 'Большие перемены начинаются с маленьких действий', text: 'Не нужно менять всю жизнь за день. Просто выполняй то, что важно тебе, и смотри, как растёт твой сад.', art: 'sprout-to-tree' },
    { id: 'progress', title: 'Ты увидишь свой прогресс', text: 'Работа, здоровье, отношения, накопления, творчество и учёба — каждая сфера растёт вместе с тобой.', art: 'island-trees' },
    { id: 'gifts', title: 'Твои обещания станут приятнее', text: 'Дари себе подарки на каждом из этапов своего пути. Вознаграждай себя за собственный прогресс, который приближает тебя к цели, чтобы путь был приятным для тебя.', art: 'gift-line' },
  ],
  tutorialIntro: 'Всё начинается с маленького ростка',
};

export const DEFAULT_PAYWALL = {
  title: 'Твой сад ждёт',
  subtitle: 'Создавай настоящие задачи, получай капли и выращивай шесть деревьев своей жизни.',
  bullets: [
    'Шесть деревьев — шесть сфер жизни',
    'Задачи, капли, полив и сюрпризы на каждом уровне',
    'Подарки себе за прогресс и челленджи с друзьями',
    'Весь прогресс сохраняется, даже если сделаешь паузу',
  ],
};

export const DEFAULT_NOTIFICATION_TEXTS = {
  bored: 'Твоё дерево заскучало 🌱 Загляни в сад — одна маленькая задача уже порадует его.',
  almostWater: 'Для полива дерева «{sphere}» осталось {n} {drops} 💧',
  deadline: 'Сегодня дедлайн задачи «{task}» ⏳',
  giftClose: 'Твой подарок всё ближе 🎁 До «{gift}» — {n} {completions}.',
};

export const DEFAULT_FLAGS = {
  /** Удерживающее предложение при отмене. Показывается, только если провайдер поддерживает смену следующего платежа. */
  retentionOffer: true,
  /** Отдельный тариф для вернувшихся пользователей — решение владельца, по умолчанию выключен. */
  winbackOffer: false,
  challenges: true,
  reminders: true,
};

/**
 * Asset manifest: species → level → state → URL. Пустые записи = процедурная SVG-иллюстрация (placeholder),
 * пока не нарисован финальный арт. Добавление уровня не меняет бизнес-логику.
 */
export const DEFAULT_ASSET_MANIFEST = {
  version: 1,
  note: 'Процедурные SVG-деревья — временный арт. Финальные PNG/WebP 3D clay-ассеты добавляются сюда без изменения кода.',
  species: {
    sakura: {}, golden: {}, oak: {}, blossom: {}, lush: {}, willow: {},
  } as Record<string, Record<string, { normal?: string; withered?: string }>>,
  island: {} as Record<string, string>,
  sprout: null as string | null,
};

export const DEFAULT_PLANS = [
  {
    id: 'month', title: '1 месяц', subtitle: 'Продлевается каждые 30 дней', kind: 'recurring', period_days: 30,
    price_stars: 400, display_price_rub: 499, eligibility: 'all', is_active: true, sort: 1,
    terms: 'Подписка Telegram Stars, автопродление каждые 30 дней по той же цене. Отменить можно в любой момент: Профиль → Настройки → Управление подпиской. После отмены доступ сохраняется до конца оплаченного периода.',
  },
  {
    id: 'half_year', title: '6 месяцев', subtitle: '≈ 250 ₽ в месяц, оплата один раз', kind: 'prepaid', period_days: 180,
    price_stars: 1200, display_price_rub: 1499, eligibility: 'all', is_active: true, sort: 2,
    terms: 'Разовая оплата Telegram Stars за 180 дней доступа без автопродления. Telegram Stars не поддерживает 6-месячные рекуррентные подписки, поэтому по окончании срока продление — вручную.',
  },
  {
    id: 'retention_month', title: 'Следующий месяц со скидкой', subtitle: 'Разовое предложение при отмене', kind: 'recurring', period_days: 30,
    price_stars: 200, display_price_rub: 249, eligibility: 'retention', is_active: true, sort: 10,
    terms: 'Следующий платёж — по сниженной цене один раз, затем стандартная цена тарифа «1 месяц».',
  },
  {
    id: 'winback_month', title: 'Возвращение: первый месяц', subtitle: 'Для тех, кто отменял подписку', kind: 'recurring', period_days: 30,
    price_stars: 2400, display_price_rub: 2990, eligibility: 'returning', is_active: false, sort: 20,
    terms: 'Тариф для повторного подключения. Включается владельцем только при прозрачном раскрытии условий до первой покупки.',
  },
];
