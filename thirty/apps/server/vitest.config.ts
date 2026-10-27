import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://thirty:thirty@localhost:5432/thirty_test',
      BOT_TOKEN: '123456:TEST_TOKEN',
      BOT_USERNAME: 'thirty_test_bot',
      PAYMENT_PROVIDER: 'mock',
      PUBLIC_URL: 'https://thirty.example',
      UPLOAD_DIR: '/tmp/thirty-test-uploads',
      NODE_ENV: 'test',
    },
    globalSetup: ['./test/globalSetup.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
