# «30 дней»: Telegram Mini App, бот и админка

Клуб дисциплины с ежемесячными потоками, публичными отчётами, бадди, чатами, созвонами и призом.

```
thirty/
  packages/domain   доменные правила: календарь, биллинг, рейтинг, бадди, карточки (+ тесты)
  apps/server       Fastify + Prisma/Postgres: API, бот, webhook Prodamus, планировщик
  apps/miniapp      Mini App (React + Vite), экраны S01–S38
  apps/admin        веб-админка A01–A17 (/admin/)
  docs/             архитектура, экраны, ограничения, вопросы, план
```

Документы: [архитектура](docs/ARCHITECTURE.md) · [экраны](docs/SCREENS.md) · [ограничения Telegram и Prodamus](docs/LIMITATIONS.md) · [вопросы владельцу](docs/QUESTIONS.md) · [план и приёмка](docs/PLAN.md)

## Локальный запуск

```bash
cd thirty
npm install
cp apps/server/.env.example apps/server/.env      # DATABASE_URL, DEV_AUTH=true, PAYMENT_PROVIDER=mock
cd apps/server && npx prisma migrate deploy && cd ../..
npm run dev:server     # API на :4100 (сид тарифов и шаблонов — автоматически)
npm run dev:miniapp    # Mini App на :5175 — вне Telegram вход тестовым пользователем
npm run dev:admin      # админка на :5176/admin/
```

Первый администратор создаётся из `ADMIN_BOOTSTRAP_LOGIN` / `ADMIN_BOOTSTRAP_PASSWORD`. При первом входе обязательна настройка 2FA: QR-код для Google Authenticator или Яндекс Ключа.

Sandbox-оплата (`PAYMENT_PROVIDER=mock`) показывает тестовую форму и шлёт подписанный webhook в формате Prodamus. Деньги не списываются. В production mock запрещён, пока явно не задан `ALLOW_SANDBOX_PAYMENTS=true` (только для staging).

## Деплой (Railway)

1. New Project → Deploy from GitHub → этот репозиторий, **Root Directory: `thirty`** (используются `Dockerfile` и `railway.json`).
2. Добавить Postgres и прописать в сервис `DATABASE_URL`.
3. Переменные из `apps/server/.env.example`: обязательно `NODE_ENV=production`, `PUBLIC_URL` (домен Railway), `BOT_TOKEN`, `BOT_USERNAME`, `APP_SHORT_NAME`, `ADMIN_JWT_SECRET`, `MEDIA_SIGNING_SECRET`, `ADMIN_BOOTSTRAP_*`, `PAYMENT_PROVIDER=prodamus`, `PRODAMUS_FORM_URL`, `PRODAMUS_SECRET_KEY`, `SCHEDULER=true`, S3_* для медиа.
4. При старте сервер сам ставит webhook бота и кнопку меню.
5. В кабинете Prodamus указать URL уведомлений `https://<домен>/api/payments/prodamus/webhook` (и для оплат, и для подписок).
6. BotFather → `/newapp` → URL `https://<домен>/` и короткое имя = `APP_SHORT_NAME`.

Бэкапы: включить ежедневные снапшоты Postgres в Railway; медиа держать в S3 с версионированием.
