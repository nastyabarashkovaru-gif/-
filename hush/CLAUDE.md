# HUSH Mini App

Визуальная спецификация — `design/CLAUDE.md`, скриншоты `design/screens/`, токены `design/design-reference.html`
(скриншоты = 2× рендер этого HTML на 390×844). Сверяйте изменения UI со скриншотами.
Оплата — CloudPayments внутри Mini App (решение владельца, риск правил Telegram о Stars принят): `server/src/billing.ts`; доступ выдаётся только по подписанному Pay-уведомлению. Демо-данные только в `src/demo/`. Проверка: `npm run build`.

Обновление дизайна (v2): `design/v2/*.png` имеет приоритет над `design/screens/` по шрифтам и иконкам —
системный шрифт (SF Pro / Roboto), заголовки 700 без сжатого трекинга, текст кнопок 500/17px,
линейные иконки Lucide (Send, Copy, Lock, LockOpen, CircleCheck) вместо эмодзи-замков и глифов.

## Деплой (Railway)

- Бот: @Hush_miniapp_bot. Ветка деплоя: `claude/app-and-instructions-ihq84m`, Root Directory `hush`, сборка из `railway.json`.
- Один сервис (сервер отдаёт и API, и приложение) + PostgreSQL. Пошагово — `DEPLOY.md`.
- Доступ к Railway: network secret среды (Bearer) на хост `backboard.railway.com` — прокси сам добавляет
  `Authorization`, сессия токен не видит. GraphQL API: `https://backboard.railway.com/graphql/v2`.
- `BOT_TOKEN` владелец вписывает сам в Variables сервиса Railway; в среде Claude его нет. Никогда не выводить и не коммитить токены.
- Переменные сервиса: `BOT_TOKEN` (ссылкой `${{Postgres.BOT_TOKEN}}` — владелец добавил токен в карточку Postgres), `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `APP_SHORT_NAME=app`, `GRANT_PREMIUM_IDS`, оплата: `CP_PUBLIC_ID`, `CP_API_SECRET`, `CP_RECEIPTS`, `CP_TAXATION`, реквизиты `LEGAL_*`.
- Свои вопросы — только Premium и только во второй и следующих анкетах. Каталог — 10 вопросов в `shared/questions.json`.
- После выдачи домена — redeploy; проверка `GET /api/health`. `/newapp` в BotFather делает владелец (short name `app`).
- Обновления приложения: push в ветку → Railway пересобирает автоматически.
