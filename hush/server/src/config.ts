function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[config] Не задана переменная окружения ${name}`);
    process.exit(1);
  }
  return value;
}

const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;

export const config = {
  botToken: required('BOT_TOKEN'),
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.PORT) || 8080,
  /** Публичный HTTPS-адрес (нужен для webhook бота и кнопки меню) */
  publicUrl: (process.env.PUBLIC_URL || (railwayDomain ? `https://${railwayDomain}` : '')).replace(/\/$/, ''),
  botUsername: (process.env.BOT_USERNAME || '').replace(/^@/, ''),
  appShortName: process.env.APP_SHORT_NAME || 'app',
  /** Тестовая выдача годового Premium, пока оплата не подключена: Telegram ID или @username */
  grantPremiumIds: new Set(
    (process.env.GRANT_PREMIUM_IDS || '')
      .split(',')
      .map((s) => s.trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean),
  ),
  /** Доступ к статистике (/api/admin): Telegram ID или @username владельца */
  adminIds: new Set(
    (process.env.ADMIN_IDS || '')
      .split(',')
      .map((s) => s.trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean),
  ),
  /** CloudPayments: без обоих ключей кнопки оплаты показывают «Оплата пока недоступна» */
  cloudPayments: {
    publicId: process.env.CP_PUBLIC_ID || '',
    apiSecret: process.env.CP_API_SECRET || '',
    /** Чеки 54-ФЗ через CloudKassir */
    receipts: process.env.CP_RECEIPTS === 'true',
    /** Система налогообложения для чека: 0 ОСН, 1 УСН доход, 2 УСН доход-расход, 4 ЕСХН, 5 ПСН */
    taxationSystem: Number(process.env.CP_TAXATION ?? 1),
    /** Ставка НДС: пусто — без НДС */
    vat: process.env.CP_VAT ? Number(process.env.CP_VAT) : null,
  },
  /** Реквизиты для оферты и политики (/legal/*) */
  legal: {
    name: process.env.LEGAL_NAME || '',
    inn: process.env.LEGAL_INN || '',
    ogrnip: process.env.LEGAL_OGRNIP || '',
    email: process.env.LEGAL_EMAIL || '',
    account: process.env.LEGAL_ACCOUNT || '',
    bank: process.env.LEGAL_BANK || '',
    bik: process.env.LEGAL_BIK || '',
    corrAccount: process.env.LEGAL_CORR_ACCOUNT || '',
  },
  /** Сколько живёт подпись initData */
  initDataMaxAgeSec: 24 * 60 * 60,
  resultsThreshold: 5,
  freeVisibleAnswers: 2,
  freeQuestionnaires: 1,
  answerMaxLength: 1000,
  customQuestionMaxLength: 140,
};
