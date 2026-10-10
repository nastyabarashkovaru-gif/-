# HUSH Mini App

Визуальная спецификация — `design/CLAUDE.md`, скриншоты `design/screens/`, токены `design/design-reference.html`
(скриншоты = 2× рендер этого HTML на 390×844). Сверяйте изменения UI со скриншотами.
Платежи не подключать без явного запроса. Демо-данные только в `src/demo/`. Проверка: `npm run build`.

Обновление дизайна (v2): `design/v2/*.png` имеет приоритет над `design/screens/` по шрифтам и иконкам —
системный шрифт (SF Pro / Roboto), заголовки 700 без сжатого трекинга, текст кнопок 500/17px,
линейные иконки Lucide (Send, Copy, Lock, LockOpen, CircleCheck) вместо эмодзи-замков и глифов.

## Деплой (Railway)

- Бот: @Hush_miniapp_bot. Ветка деплоя: `claude/app-and-instructions-ihq84m`, Root Directory `hush`, сборка из `railway.json`.
- Один сервис (сервер отдаёт и API, и приложение) + PostgreSQL. Пошагово — `DEPLOY.md`.
- Секреты среды: `RAILWAY_API_TOKEN` — токен аккаунта Railway (GraphQL API `https://backboard.railway.com/graphql/v2`),
  `HUSH_BOT_TOKEN` — токен бота, переносится в переменную сервиса `BOT_TOKEN`. Никогда не выводить и не коммитить токены.
- Переменные сервиса: `BOT_TOKEN`, `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `APP_SHORT_NAME=app`, опционально `GRANT_PREMIUM_IDS`.
- После выдачи домена — redeploy; проверка `GET /api/health`. `/newapp` в BotFather делает владелец (short name `app`).
- Обновления приложения: push в ветку → Railway пересобирает автоматически.
