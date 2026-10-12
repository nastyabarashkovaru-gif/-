const env = process.env;

export type AppEnv = 'production' | 'demo' | 'development' | 'test';
const appEnv = (env.APP_ENV as AppEnv) || (env.NODE_ENV === 'production' ? 'production' : 'development');
const railwayDomain = env.RAILWAY_PUBLIC_DOMAIN;

export const config = {
  appEnv,
  isProduction: appEnv === 'production',
  port: Number(env.PORT) || 8080,
  databaseUrl: env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/rostok',
  publicUrl: (env.PUBLIC_URL || (railwayDomain ? `https://${railwayDomain}` : 'http://localhost:5173')).replace(/\/$/, ''),
  botToken: env.BOT_TOKEN || '',
  botUsername: (env.BOT_USERNAME || '').replace(/^@/, ''),
  appShortName: env.APP_SHORT_NAME || '',
  /** Срок годности initData (сек.) */
  initDataTtl: Number(env.INIT_DATA_TTL) || 24 * 3600,
  sessionDays: 30,
  /** Платёжный провайдер: telegram_stars (prod) или mock (только demo/dev). */
  paymentProvider: (env.PAYMENT_PROVIDER || (appEnv === 'production' ? 'telegram_stars' : 'mock')) as 'telegram_stars' | 'mock',
  /** Вход без Telegram (демо в браузере) — только вне production. */
  demoLogin: appEnv !== 'production' && env.DEMO_LOGIN !== 'false',
  adminLogin: env.ADMIN_LOGIN || '',
  adminPassword: env.ADMIN_PASSWORD || '',
  workerEnabled: env.WORKER_ENABLED !== 'false',
  supportUsername: (env.SUPPORT_USERNAME || '').replace(/^@/, ''),
  webDist: env.WEB_DIST || '',
};

export function assertSafeConfig() {
  if (config.isProduction) {
    if (config.paymentProvider === 'mock') throw new Error('PAYMENT_PROVIDER=mock запрещён в production');
    if (!config.botToken) throw new Error('BOT_TOKEN обязателен в production');
    if (config.demoLogin) throw new Error('Демо-вход запрещён в production');
  }
}
