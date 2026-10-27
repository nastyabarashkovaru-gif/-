import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4100),
  DATABASE_URL: z.string(),
  /** Публичный HTTPS-адрес сервиса (webhook бота, уведомления оплаты, ссылки на картинки) */
  PUBLIC_URL: z.string().default(''),
  BOT_TOKEN: z.string().default(''),
  BOT_USERNAME: z.string().default(''),
  /** Отдельный бот для владельца: уведомления о сторис с кнопкой «Выслать промокод» */
  ADMIN_BOT_TOKEN: z.string().default(''),
  /** Короткое имя Mini App из BotFather (/newapp) для ссылок t.me/<bot>/<app>?startapp= */
  APP_SHORT_NAME: z.string().default('app'),
  INIT_DATA_MAX_AGE_SEC: z.coerce.number().default(24 * 3600),
  /** Только локально: вход без Telegram по заголовку X-Dev-User */
  DEV_AUTH: bool,
  ADMIN_JWT_SECRET: z.string().default('dev-admin-secret-change-me'),
  ADMIN_BOOTSTRAP_LOGIN: z.string().default(''),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().default(''),
  ADMIN_ORIGIN: z.string().default(''),
  PAYMENT_PROVIDER: z.enum(['cloudpayments', 'mock']).default('mock'),
  /** CloudPayments: Public ID и пароль для API из настроек сайта в кабинете */
  CP_PUBLIC_ID: z.string().default(''),
  CP_API_SECRET: z.string().default(''),
  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('ru-central1'),
  S3_BUCKET: z.string().default(''),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  UPLOAD_DIR: z.string().default('uploads'),
  MEDIA_SIGNING_SECRET: z.string().default('dev-media-secret'),
  SCHEDULER: bool,
  /** Разрешить sandbox-оплату (mock) при NODE_ENV=production — только для staging */
  ALLOW_SANDBOX_PAYMENTS: bool,
  /** Демо-версия для владельца: сценарии, перемотка времени, вход без Telegram по ключу */
  DEMO_MODE: bool,
  DEMO_KEY: z.string().default(''),
  STATIC_MINIAPP_DIR: z.string().default(''),
  STATIC_ADMIN_DIR: z.string().default(''),
});

export type Config = z.infer<typeof schema>;

export const config: Config = schema.parse(process.env);

export const isProd = config.NODE_ENV === 'production';

if (isProd) {
  const problems: string[] = [];
  if (config.DEMO_MODE && config.DEMO_KEY.length < 16) problems.push('DEMO_KEY must be at least 16 chars');
  if (config.DEV_AUTH && !config.DEMO_MODE) problems.push('DEV_AUTH must be off in production');
  if (config.ADMIN_JWT_SECRET.startsWith('dev-')) problems.push('ADMIN_JWT_SECRET is default');
  if (config.MEDIA_SIGNING_SECRET.startsWith('dev-')) problems.push('MEDIA_SIGNING_SECRET is default');
  if (!config.BOT_TOKEN && !config.DEMO_MODE) problems.push('BOT_TOKEN is empty');
  if (config.PAYMENT_PROVIDER === 'mock' && !config.ALLOW_SANDBOX_PAYMENTS) problems.push('PAYMENT_PROVIDER=mock in production (set ALLOW_SANDBOX_PAYMENTS=true only on staging)');
  if (config.PAYMENT_PROVIDER === 'cloudpayments' && (!config.CP_PUBLIC_ID || !config.CP_API_SECRET)) problems.push('CP_PUBLIC_ID / CP_API_SECRET not configured');
  if (problems.length) throw new Error(`Unsafe production config: ${problems.join('; ')}`);
}
