# HUSH Mini App

Визуальная спецификация — `design/CLAUDE.md`, скриншоты `design/screens/`, токены `design/design-reference.html`
(скриншоты = 2× рендер этого HTML на 390×844). Сверяйте изменения UI со скриншотами.
Оплата — CloudPayments внутри Mini App (решение владельца, риск правил Telegram о Stars принят): `server/src/billing.ts`; доступ выдаётся только по подписанному Pay-уведомлению. Демо-данные только в `src/demo/`. Проверка: `npm run build`.

Обновление дизайна (v2): `design/v2/*.png` имеет приоритет над `design/screens/` по шрифтам и иконкам —
системный шрифт (SF Pro / Roboto), заголовки 700 без сжатого трекинга, текст кнопок 500/17px,
линейные иконки Lucide (Send, Copy, Lock, LockOpen, CircleCheck) вместо эмодзи-замков и глифов.

## HUSH 2.0 (анонимные вопросы, как ASKfm) — основной сценарий

План миграции — `docs/HUSH2_MIGRATION.md` (только добавление таблиц, старые данные не трогаются).
- Сервер: `server/src/qa.ts` (личная ссылка `users.ask_slug` → `startapp=u_<slug>`, входящие `inbox` kind user|self|system,
  свои вопросы `asks`/`ask_answers` → `startapp=a_<id>`, блокировки `blocks`, жалобы `reports`, вопрос дня из `shared/daily.json` —
  не чаще раза в день по МСК, создаётся лениво при GET /api/inbox). id отправителя никогда не уходит клиенту.
  Источник привлечения — `users.ref_source`/`referred_by` (пишется в `auth.ts` при первом входе по start_param).
  Общие `handle`/`HttpError`/`newId` — `server/src/http.ts`.
- Клиент: `src/screens/qa/*` (Entry: старт, «Твоя ссылка готова!», форма вопроса гостя, «Отправлено»; Inbox; Asks; Profile; common:
  нижняя панель `TabBar`, окно «Создать», `ShareLinkSheet`, карточки сторис). Карточки — `src/lib/qaCards.ts`.
  Стартовый маршрут — `App.tsx` `Root`: u_/a_/admin/ref_/старый id анкеты; без ссылки: был активен → «Входящие», иначе «start».
  Старые анкеты — архив в «Мои вопросы» и в профиле; прежние экраны анкет работают по старым ссылкам.
- Новая механика бесплатна; ограничения Premium для неё не включены (ждём согласования, что входит в Premium).

## Деплой (Railway)

- Бот: @Hush_miniapp_bot. Ветка деплоя: `claude/app-and-instructions-ihq84m`, Root Directory `hush`, сборка из `railway.json`.
- Один сервис (сервер отдаёт и API, и приложение) + PostgreSQL. Пошагово — `DEPLOY.md`.
- Доступ к Railway: network secret среды (Bearer) на хост `backboard.railway.com` — прокси сам добавляет
  `Authorization`, сессия токен не видит. GraphQL API: `https://backboard.railway.com/graphql/v2`.
- `BOT_TOKEN` владелец вписывает сам в Variables сервиса Railway; в среде Claude его нет. Никогда не выводить и не коммитить токены.
- Переменные сервиса: `BOT_TOKEN` (ссылкой `${{Postgres.BOT_TOKEN}}` — владелец добавил токен в карточку Postgres), `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `APP_SHORT_NAME=app`, `GRANT_PREMIUM_IDS`, `ADMIN_IDS`, оплата: `CP_PUBLIC_ID`, `CP_API_SECRET`, `CP_RECEIPTS`, `CP_TAXATION`, реквизиты `LEGAL_*`.
- Бесплатно: 2 анкеты (`config.freeQuestionnaires`, `FREE_QUESTIONNAIRES` в `screens/Upsell.tsx`), третья и дальше — Premium (модальный апсейл). В результатах без подписки первые 3 ответивших открыты полностью (`freeOpenRespondents`), у остальных — 2 ответа. Каталог — `shared/questions.json`: 12 базовых для всех + 10 «Расширенной библиотеки» (`premium: true`) только по подписке. Первая анкета — только 12 базовых, без упоминаний Premium; со второй видны библиотека и «Добавить свой вопрос» (без подписки — замок, «Доступно по подписке», нажатие ведёт сразу на тарифы).
- Раскрытие автора: только с подпиской и согласием автора; годовой — безлимит, 1/3 месяца — разовая покупка 99 ₽ за автора (`orders.kind = 'reveal'`, `reveal_purchases`). После оплаты подписки — экран `premiumSuccess`.
- Цены: `pricingFor` в `server/src/plans.ts` (`PLANS[plan].amount` — по предложению, `.standard` — обычная). Все тарифы: 299/990, 499/1490, 1490/6990 ₽ — сниженная цена 3 часа с первого открытия тарифов (`users.offer_started_at`, POST /api/billing/offer, общий таймер на экране 06, «цена закрепится на все следующие списания»); после таймера и после отмены подписки (`users.cancelled_at`) — обычные. Продление — по цене первой оплаты (`base_amount`).
- Отмена подписки: окно «Жалко, что ты уходишь» (если платит меньше обычной цены своего тарифа: «вернуться — уже <обычная цена>/<период>, без скидки») → окно «Мы не хотим тебя терять» (−50% только на следующий платёж, один раз: `subscriptions/update` к половине, после списания — обратно к `base_amount`) → отмена.
- Статистика владельца: экран `admin` (`screens/Admin.tsx`), ссылка `t.me/Hush_miniapp_bot/app?startapp=admin` и строка «Статистика» в настройках; GET /api/admin/stats (`server/src/admin.ts`; дни — до 180, график «Рост по дням»: новые пользователи и анкеты, листается), доступ — `ADMIN_IDS` (Telegram ID или username, сейчас `bar_barash`).
- Сторис с ответами: `screens/StoriesSheet.tsx` + `lib/storyCard.ts` (canvas 1080×1920, QR `t.me/<bot>/app?startapp=ref_story`). Для анонима, открытого в карусели: шаг 1 — выбор его ответов (скрытые нельзя), шаг 2 — одна карточка со всеми выбранными ответами (`renderMultiStoryCard`, шрифт подбирается под 1–5 ответов) (стрелка «назад» к выбору). Авто-показ через 1 с при первом открытии результатов анкеты (localStorage), кнопка «Поделиться ответами в сторис». PNG для Telegram (shareToStory/downloadFile) — временная ссылка `/s/<id>.png` (память сервера, 2 ч).
- Сторис-приглашение «Выложи анкету к себе в сторис»: `lib/inviteCard.ts` (3 варианта, контент по центру, QR и личная ссылка текстом на анкету), окно `StoryDeckSheet` на экране 03 — авто через 1 с после создания анкеты (один раз) и кнопка «Выложить в сторис» (также на экране ожидания 04; если окно ещё не показывалось для анкеты — авто и там); аналитика с префиксом `invite_`.
- Аналитика: таблица `events` (POST /api/events, белый список имён; серверные события HUSH 2.0 пишет `logEvent` в qa.ts: link_created, link_opened, question_sent, ask_created, ask_answer_sent, inbox_answered), события `story_sheet_opened` (auto|button), `story_shared` (native|save|telegram_story); источник покупки — `orders.source`; конверсия — view `upsell_conversion`.
- После выдачи домена — redeploy; проверка `GET /api/health`. `/newapp` в BotFather делает владелец (short name `app`).
- Обновления приложения: push в ветку → Railway пересобирает автоматически.
