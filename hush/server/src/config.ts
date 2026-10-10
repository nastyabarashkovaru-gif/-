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
  /** Тестовая выдача годового Premium, пока оплата не подключена */
  grantPremiumIds: new Set(
    (process.env.GRANT_PREMIUM_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ),
  /** Сколько живёт подпись initData */
  initDataMaxAgeSec: 24 * 60 * 60,
  resultsThreshold: 5,
  freeVisibleAnswers: 2,
  freeQuestionnaires: 1,
  answerMaxLength: 1000,
  customQuestionMaxLength: 140,
};
