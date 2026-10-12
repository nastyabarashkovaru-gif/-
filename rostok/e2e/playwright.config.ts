import { defineConfig, devices } from '@playwright/test';

/** E2E против запущенного демо-сервера (APP_ENV=demo, mock-провайдер). BASE_URL по умолчанию — локальный. */
export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8080',
    launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined },
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'iphone-se', use: { ...devices['iPhone SE'], browserName: 'chromium' } },
    { name: 'iphone-pro-max', use: { ...devices['iPhone 14 Pro Max'], browserName: 'chromium' } },
    { name: 'android-small', use: { ...devices['Galaxy S8'], browserName: 'chromium' } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 }, browserName: 'chromium' } },
  ],
});
