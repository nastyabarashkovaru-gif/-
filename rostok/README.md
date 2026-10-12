# ROSTOK · «Твой сад»

> Выполняй задания в реальной жизни и выращивай свой сад

Telegram Mini App: реальные задачи пользователя превращаются в капли воды, которыми он сам поливает шесть деревьев своих сфер жизни.
Петля: **выполни задачу → получи капли своей сферы → накопи → вручную полей дерево → открой сюрприз.**

Демо (песочница, без Telegram): https://rostok-production.up.railway.app · админка: `/admin` · витрина арта: `/art`

## Архитектура

TypeScript-монорепо (npm workspaces):

| Пакет | Что внутри |
|---|---|
| `packages/shared` | Чистая доменная логика: сферы/виды, кривая стоимости полива, уровень сада, календарь (IANA tz, неделя Пн–Вс, DST), правила увядания от вредных привычек, валидация задач. Используется сервером и клиентом. |
| `server` | Fastify + PostgreSQL (`pg`, SQL-миграции), Telegram Bot API, планировщик, платежи, админка. |
| `web` | React 18 + Vite + Tailwind + `motion`; Telegram WebApp SDK; процедурный SVG-арт деревьев и острова; админ-панель (`/admin`). |
| `e2e` | Playwright: критические сценарии на iPhone SE / Pro Max / Android small / Desktop. |

**Почему так.** Fastify + «сырой» SQL вместо ORM — потому что ядро продукта это транзакционный ledger: нужны явные `SELECT … FOR UPDATE`,
уникальные ограничения как гарантия идемпотентности и полный контроль над запросами. Redis не используется: идемпотентность обеспечивают
UNIQUE-ограничения Postgres, а фоновые задания — внутрипроцессный планировщик с `pg_try_advisory_lock` (безопасно при нескольких репликах).
Это один сервис + одна БД на Railway. Redis/очередь можно добавить позже без изменения бизнес-логики.

Сервер отдаёт и API (`/api/*`), и собранный фронтенд — один адрес, одна точка настройки.

## Локальный запуск

```bash
cd rostok
npm install
cp .env.example server/.env          # заполните DATABASE_URL
createdb rostok                       # нужен PostgreSQL 14+
npm run dev:server                    # API на :8080 (миграции и сид — автоматически)
npm run dev:web                       # фронтенд на :5173 (проксирует /api)
```

Вне Telegram при `APP_ENV != production` работает демо-вход (отдельный пользователь на браузер) и песочница оплаты.
Готовый скрипт сборки и запуска демо-сервера: `./scripts.sh`.

## Тесты

```bash
npm test                                         # unit (shared) + интеграционные (server, реальная Postgres rostok_test)
./scripts.sh && npx playwright test -c e2e/playwright.config.ts   # E2E на 4 размерах экрана
```

Отчёт о сценариях — [docs/TEST_REPORT.md](docs/TEST_REPORT.md).

## Документация

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — таблицы БД, инварианты, ledger, планировщик, восстановление после сбоев
- [docs/API.md](docs/API.md) — HTTP API и аналитические события
- [docs/PAYMENTS.md](docs/PAYMENTS.md) — Telegram Stars, статусы подписки, отмена и удерживающее предложение
- [docs/CONFIG.md](docs/CONFIG.md) — кривая уровней, тексты, флаги, asset manifest
- [docs/SETUP.md](docs/SETUP.md) — **что нужно сделать владельцу**: бот, BotFather, секреты, запуск в production
- [docs/OWNER_DECISIONS.md](docs/OWNER_DECISIONS.md) — открытые продуктовые решения
