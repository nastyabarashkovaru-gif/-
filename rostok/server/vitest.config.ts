import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      APP_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/rostok_test',
      PAYMENT_PROVIDER: 'mock',
      BOT_TOKEN: '123456:TEST_TOKEN',
      WORKER_ENABLED: 'false',
    },
  },
});
