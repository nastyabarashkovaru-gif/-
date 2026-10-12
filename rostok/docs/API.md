# HTTP API

Все ответы — JSON. Ошибки: `{ error: <code>, message: <текст для пользователя>, ...extra }`.
Авторизация — `Authorization: Bearer <session>` (сессия выдаётся сервером после проверки Telegram initData).
`402 subscription_required` — для платных действий без серверно подтверждённого доступа.

| Метод и путь | Назначение |
|---|---|
| `POST /api/auth/telegram` `{initData, timezone}` | проверка подписи HMAC и `auth_date` (TTL 24 ч) → сессия |
| `POST /api/auth/demo` `{deviceId}` | демо-вход, только `APP_ENV != production` |
| `GET /api/me`, `POST /api/me/open` | профиль/доступ/онбординг; отметка открытия (серия дней) |
| `PATCH /api/settings`, `POST /api/onboarding`, `POST /api/events` | настройки; прогресс онбординга; клиентские события (белый список) |
| `GET /api/config/public` | тексты, флаги, asset manifest |
| `GET /api/garden` | сад: деревья, уровень сада, серия, «сегодня N из M» |
| `GET /api/trees/:sphere` | карточка дерева, ledger, ближайший подарок |
| `POST /api/trees/:sphere/water` `{expectedLevel}` + `Idempotency-Key` | атомарный полив. `409 not_enough_drops {need, cost}` |
| `GET/POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/:id` | задачи. `409 terms_locked` при попытке изменить условия задачи с подарком |
| `POST /api/tasks/:id/complete` | выполнение. `409 deadline_passed / week_limit / period_closed` |
| `POST /api/tasks/:id/habit-checkin` `{answer: yes|no}` | ответ по привычке |
| `GET /api/tasks/:id/history` | полная история и ledger задачи |
| `POST /api/tasks/:id/rewards` `{threshold, title, confirm: true}`, `POST /api/rewards/:id/claim` | подарки |
| `GET/POST /api/challenges`, `POST /api/challenges/:id/invite`, `GET /api/challenges/invite/:token`, `POST /api/challenges/join`, `DELETE /api/challenges/:id` | челленджи |
| `GET /api/subscription/plans`, `GET /api/subscription`, `POST /api/subscription/checkout`, `GET /api/subscription/cancel-info`, `POST /api/subscription/cancel`, `POST /api/subscription/accept-retention-offer` | подписка |
| `POST /api/subscription/mock/confirm` | песочница (только mock-провайдер) |
| `GET /api/stats` | профиль: выполнения, подарки X из Y, уровни по сферам, возраст сада |
| `POST /api/telegram/webhook` | Bot API (проверка `X-Telegram-Bot-Api-Secret-Token`): `pre_checkout_query`, `successful_payment`, `refunded_payment`, `/start` |
| `/api/admin/*` | админка (RBAC): summary, funnel, retention, stats, config, plans, users/:telegramId, payments, refund, errors, audit, export/:kind |

## Аналитические события
Сервер: `task_created, task_completed, habit_checkin, drops_earned, drops_penalized, watering_success, level_unlocked, reward_unlocked, reward_claimed, challenge_invited, challenge_joined, checkout_start, purchase_success, subscription_cancel_attempt, retention_offer_accepted, subscription_canceled`.
Клиент: `app_open, onboarding_slide_view, tutorial_start, tutorial_step, tutorial_watering, tutorial_complete, spheres_selected, paywall_view, challenge_demo_view`.
Каждое событие имеет UUID (серверные — детерминированный из ключа источника), повтор не дублируется. Содержимое ответов о привычках и названия задач в события не попадают; демо-пользователи исключены из воронки.
