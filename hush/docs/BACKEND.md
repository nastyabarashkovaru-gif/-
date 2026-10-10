# Backend

Реализован в `hush/server/` (Node.js + Express + PostgreSQL), деплой — [`../DEPLOY.md`](../DEPLOY.md).
Сервер раздаёт приложение (`npm run build:server-app` → `VITE_DEMO=false`) на том же домене, поэтому `VITE_API_URL` не нужен.
Контракт и типы — `src/api/types.ts`; демо-mock `src/api/mock.ts` повторяет те же правила.

| Файл | Что делает |
|---|---|
| `server/src/auth.ts` | проверка подписи initData, срок 24 ч, upsert пользователя |
| `server/src/routes.ts` | все эндпоинты и бизнес-правила |
| `server/src/db.ts` | схема (создаётся при старте) |
| `server/src/telegram.ts` | webhook, `/start`, кнопка меню, уведомление о 5 ответах |
| `shared/questions.json` | каталог вопросов, общий для приложения и сервера |

Переменные: `BOT_TOKEN`, `DATABASE_URL` (обязательно), `PUBLIC_URL` (на Railway берётся из `RAILWAY_PUBLIC_DOMAIN`),
`BOT_USERNAME` (иначе из getMe), `APP_SHORT_NAME`, `GRANT_PREMIUM_IDS` (годовой Premium для тестов, пока нет оплаты).

## Авторизация

Каждый запрос несёт заголовок `Authorization: tma <initData>`. Сервер обязан проверить подпись initData
токеном бота и брать пользователя только из проверенных данных.

## Эндпоинты

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/api/me` | `Bootstrap` — профиль, подписка (`entitlement`), анкеты владельца |
| POST | `/api/questionnaires` | `{ questions }` (ровно 5) → `QuestionnaireSummary`; `premium_required` для своих вопросов и 2-й анкеты на бесплатном |
| GET | `/api/questionnaires/:id` | `QuestionnaireSummary` (только владельцу) |
| GET | `/api/questionnaires/:id/results` | `ResultsView`; `threshold_not_met`, пока < 5 уникальных респондентов |
| POST | `/api/questionnaires/:id/respondents/:rid/reveal` | `RevealResult` |
| GET | `/api/public/questionnaires/:id` | `PublicQuestionnaire`; ошибки `not_found`, `own_questionnaire`, `already_answered` |
| POST | `/api/public/questionnaires/:id/responses` | `SubmitPayload` → 204 |
| POST | `/api/me/write-access` | пользователь разрешил боту писать (для уведомлений) |
| POST | `/api/telegram/webhook` | обновления бота, защищены `X-Telegram-Bot-Api-Secret-Token` |
| GET | `/api/health` | `{ ok: true }` |
| POST | `/api/events` | `{ name, source }` — событие аналитики (только из белого списка) |
| POST | `/api/billing/checkout` | `{ plan }` → параметры виджета CloudPayments (заказ создаётся на сервере) |
| POST | `/api/billing/autorenew` | `{ enabled }` → отмена подписки через API CloudPayments |
| POST | `/api/billing/restore` | `{ status: 'ok' \| 'none' }` |
| POST | `/api/billing/cloudpayments/{check,pay,fail,recurrent}` | уведомления CloudPayments, подпись `Content-HMAC` |
| GET | `/legal/offer`, `/legal/privacy` | оферта и политика (реквизиты из `LEGAL_*`) |

Ошибки: HTTP 4xx с телом `{ "code": ApiErrorCode }`.

## Обязательные правила сервера

- **Порог 5** уникальных респондентов до показа результатов; при достижении — одно уведомление ботом владельцу (идемпотентно).
- **Закрытые ответы**: текст не отправляется клиенту (`text: null, locked: true`). Бесплатно: первый (самый содержательный)
  респондент — все 5 ответов, остальные — 2 ответа. С подпиской — всё.
- **Раскрытие автора**: сначала проверяется согласие (`consent.revealIdentity`) — без него `anonymous` и никаких списаний;
  с согласием и годовым тарифом — `revealed` только с разрешёнными полями профиля; иначе `requires_plan`.
  Разовая покупка раскрытия (99 ₽) ожидает подтверждения продукта.
- Telegram-профиль респондента не попадает в результаты, логи и аналитику до авторизованного раскрытия.
- **Отправка ответов атомарна**: 5 ответов + согласие (версия текста, время) одним запросом, `idempotencyKey` против дублей.
  Запрещены ответ на свою анкету и повторный ответ того же пользователя.
- Rate limit и антиабьюз на создание анкет и отправку ответов. Не обещать «гарантированную» анонимность.
- **Подписки**: `entitlement` выдаётся только после подтверждения платёжного провайдера; `renewsAt` — из провайдера.
  Отмена/автопродление — только через провайдера, UI не должен сообщать об отмене без подтверждения.

## Telegram

- Бот с Mini App: short name → `VITE_APP_SHORT_NAME`, имя бота → `VITE_BOT_USERNAME`.
  Ссылка анкеты: `https://t.me/<bot>/<app>?startapp=<id>`; клиент читает `start_param` и открывает экран ответа.
- Шаринг использует `openTelegramLink('https://t.me/share/url?…')`, нативная кнопка «Назад» — `BackButton`.
