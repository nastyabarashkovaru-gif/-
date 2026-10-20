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
- Навигация: 3 раздела — «Вопросы» (переключатель «Мне задали» = route `inbox` / «Я спросил(а)» = route `asks`: вопросы людям с их
  личными ответами из GET /api/sent + свои вопросы подписчикам), большой «+» (окно «Создать»), «Профиль» (личная ссылка).
  Во «Мне задали» нет блока ссылки; у вопроса «Ответить лично» (ответ видит только спросивший, ему пуш, `tab_asks`) и
  «В сторис» — маленькая горизонтальная карточка вопроса `renderQuestionSticker` (копировать / поделиться / сохранить → POST /inbox/:id/story).
  Вопрос дня выглядит как обычный анонимный. Пуш на каждый вопрос/ответ (`notifyUser`, ≤30/час на человека).
- Монетизация HUSH 2.0: бесплатно — все входящие вопросы (без замков), ответы, сторис, 3 своих вопроса подписчикам (`FREE_ASKS`,
  удалённые считаются; дальше 402 → модалка → тарифы `ask_limit`) и первые 3 ответа на каждый (`FREE_ASK_ANSWERS`, по порядку сверху,
  закрытые ниже). Клиент ещё умеет показывать `locked` во входящих (сервер сейчас не закрывает). Premium — свои вопросы без лимита, все ответы и авторы: «Узнать, кто спросил / Узнать автора» без подписки сразу
  ведёт на тарифы (без окон, согласие автора до покупки не раскрывается); с подпиской GET /inbox и GET /asks/:id сразу отдают `author`
  (профиль, если автор разрешил — `consent_reveal`, иначе null → «Автор пожелал остаться анонимным»), клиент — `AuthorSlot` на месте кнопки.
  Вопрос дня — всегда анонимно; вопрос сам себе с согласием показывает свой профиль. POST …/reveal оставлены для совместимости (сначала подписка, потом согласие).
  «Мне задали»: вопросы открываются, когда наберётся 5 настоящих (`INBOX_THRESHOLD`, до этого GET /api/inbox отдаёт только `gate` —
  счётчик и объяснение про анонимность). Пуш о вопросе — без текста вопроса.
  Тарифы (`SOLD_PLANS`), 3 часа по предложению / обычная: неделя 99/299 ₽, месяц 299/990 ₽, год 1499/6990 ₽
  (`PLANS[plan].interval/period` → recurrent CloudPayments, `periodSql` — продление доступа; `OFFER_ENABLED`); 3 месяца — только у ранее оформивших.

## Деплой (Railway)

- Бот: @Hush_miniapp_bot. Ветка деплоя: `claude/app-and-instructions-ihq84m`, Root Directory `hush`. Команды сборки/запуска заданы в настройках сервиса (Build/Start Command) — Railway больше не читает `railway.json`
  (config as code устарел; без команд Railpack собирает демо-версию как статический сайт на Caddy). `railway.json` — справочно.
- Один сервис (сервер отдаёт и API, и приложение) + PostgreSQL. Пошагово — `DEPLOY.md`.
- Доступ к Railway: network secret среды (Bearer) на хост `backboard.railway.com` — прокси сам добавляет
  `Authorization`, сессия токен не видит. GraphQL API: `https://backboard.railway.com/graphql/v2`.
- `BOT_TOKEN` владелец вписывает сам в Variables сервиса Railway; в среде Claude его нет. Никогда не выводить и не коммитить токены.
- Переменные сервиса: `BOT_TOKEN` (ссылкой `${{Postgres.BOT_TOKEN}}` — владелец добавил токен в карточку Postgres), `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `APP_SHORT_NAME=app`, `GRANT_PREMIUM_IDS`, `ADMIN_IDS`, оплата: `CP_PUBLIC_ID`, `CP_API_SECRET`, `CP_RECEIPTS`, `CP_TAXATION`, реквизиты `LEGAL_*`.
- Бесплатно: 2 анкеты (`config.freeQuestionnaires`, `FREE_QUESTIONNAIRES` в `screens/Upsell.tsx`), третья и дальше — Premium (модальный апсейл). В результатах без подписки первые 3 ответивших открыты полностью (`freeOpenRespondents`), у остальных — 2 ответа. Каталог — `shared/questions.json`: 12 базовых для всех + 10 «Расширенной библиотеки» (`premium: true`) только по подписке. Первая анкета — только 12 базовых, без упоминаний Premium; со второй видны библиотека и «Добавить свой вопрос» (без подписки — замок, «Доступно по подписке», нажатие ведёт сразу на тарифы).
- Раскрытие автора: только с подпиской и согласием автора; годовой — безлимит, 1/3 месяца — разовая покупка 99 ₽ за автора (`orders.kind = 'reveal'`, `reveal_purchases`). После оплаты подписки — экран `premiumSuccess`.
- Цены: `pricingFor` в `server/src/plans.ts` (`PLANS[plan].amount`/`.standard`). Механика 3-часового предложения (`users.offer_started_at`, POST /api/billing/offer, таймер на экране 06) включается `OFFER_ENABLED`; `OFFER_ALWAYS` — скидка всегда, таймер 3 ч перезапускается при каждом открытии тарифов; после отмены подписки (`users.cancelled_at`) — только обычные цены, без таймера. Продление — по цене первой оплаты (`base_amount`).
- Отмена подписки: окно 1 «Жалко, что ты уходишь» (что потеряешь) → окно 2 «Скидка сгорит» (если платит меньше обычной цены: в следующий раз — без скидки; «Сохранить скидку» / «Потерять скидку») → окно 3 «Мы не хотим тебя терять 🥺» (−50% только на следующий платёж, один раз: `subscriptions/update` к половине, после списания — обратно к `base_amount`) → отмена.
- Статистика владельца: экран `admin` (`screens/Admin.tsx`), ссылка `t.me/Hush_miniapp_bot/app?startapp=admin` (строки в профиле нет — по просьбе владельца); GET /api/admin/stats (`server/src/admin.ts`; дни — до 180, график «Рост по дням»: новые пользователи и анкеты, листается), доступ — `ADMIN_IDS` (Telegram ID или username, сейчас `bar_barash`).
  Статистика (и раздел «Блогеры») считается с `app_settings.stats_since` (`statsSince()` в db.ts); сброс — разовая `TEST_RESET_STATS=true`,
  данные пользователей и платежи при этом не удаляются. Текущие активные подписки показываются все.
- Сторис с ответами: `screens/StoriesSheet.tsx` + `lib/storyCard.ts` (canvas 1080×1920, QR `t.me/<bot>/app?startapp=ref_story`). Для анонима, открытого в карусели: шаг 1 — выбор его ответов (скрытые нельзя), шаг 2 — одна карточка со всеми выбранными ответами (`renderMultiStoryCard`, шрифт подбирается под 1–5 ответов) (стрелка «назад» к выбору). Авто-показ через 1 с при первом открытии результатов анкеты (localStorage), кнопка «Поделиться ответами в сторис». PNG для Telegram (shareToStory/downloadFile) — временная ссылка `/s/<id>.png` (память сервера, 2 ч).
- Сторис-приглашение «Выложи анкету к себе в сторис»: `lib/inviteCard.ts` (3 варианта, контент по центру, QR и личная ссылка текстом на анкету), окно `StoryDeckSheet` на экране 03 — авто через 1 с после создания анкеты (один раз) и кнопка «Выложить в сторис» (также на экране ожидания 04; если окно ещё не показывалось для анкеты — авто и там); аналитика с префиксом `invite_`.
- Аналитика: таблица `events` (POST /api/events, белый список имён; серверные события HUSH 2.0 пишет `logEvent` в qa.ts: link_created, link_opened, question_sent, ask_created, ask_answer_sent, inbox_answered), события `story_sheet_opened` (auto|button), `story_shared` (native|save|telegram_story); источник покупки — `orders.source`; конверсия — view `upsell_conversion`.
- Блогеры (`server/src/blogger.ts`, клиент `src/screens/qa/Blogger.tsx`): ссылка `startapp=blogger` или `bl_<рассыльщик>` помечает
  пользователя (`users.blogger_at`, `blogger_campaign`; при любом входе по ней, один раз). Интерфейс обычный; вместо тарифов
  (route `premium` → `PremiumOrGift` в App.tsx) — «Привет, наш дорогой блогер!»: прикрепил скриншот сторис (POST /api/blogger/proof,
  JPEG до 1280 px, `blogger_proofs`) → сразу Premium на 90 дней (`BLOGGER_PREMIUM_DAYS`, entitlement `quarter`, `source='blogger'`,
  `users.blogger_premium_at`) → экран `premiumSuccess` + пуш. Без промокодов и ручной проверки.
  Админка «Блогеры» (/api/admin/bloggers): воронка, что принесли (люди по `referred_by`, их ссылки/вопросы/анкеты, оплаты и выручка),
  рассыльщики (метка `bl_<имя>` → блогеры, люди, выручка), карточка блогера: скриншот, вопросы ему (/:id/questions), ручная выдача.
  После первой оплаты (по заказу) любой пользователь получает поздравительный пуш (billing.ts) и экран `premiumSuccess`.
- Демо-версия: `build:server-app` собирает ещё и демо-сборку (mock API, выдуманные данные, base `/demo/` → `dist/demo`), сервер отдаёт её
  на `/demo`. Вход — `startapp=demo` или строка «Демо-режим» в профиле, только для `DEMO_IDS` (пусто — никому; `me.demoAccess`; сейчас переменная удалена).
  Панель DEMO (`src/demo/DemoPanel.tsx`): сценарии HUSH 2.0 и события (`qaDemoControls` в `src/api/mockQa.ts`), тариф, переход на любой экран.
- После выдачи домена — redeploy; проверка `GET /api/health`. `/newapp` в BotFather делает владелец (short name `app`).
- Обновления приложения: push в ветку → Railway пересобирает автоматически.
