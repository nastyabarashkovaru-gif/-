# Подключение backend

Клиент уже готов: задайте `VITE_API_URL` и `VITE_DEMO=false` — вместо mock начнёт работать `src/api/http.ts`.
Контракт и типы — `src/api/types.ts`. Эталонная реализация правил — `src/api/mock.ts`.

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
