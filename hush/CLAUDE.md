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
- Свои вопросы и новые анкеты (кроме первой) — только Premium; без подписки — модальный апсейл (`screens/Upsell.tsx`), не отдельная страница. Каталог — `shared/questions.json`: 12 базовых для всех + 10 «Расширенной библиотеки» (`premium: true`) только по подписке; «+ Добавить свой вопрос» — в разделе библиотеки. При создании первой анкеты — только 12 базовых, без упоминаний Premium.
- Раскрытие автора: только с подпиской и согласием автора; годовой — безлимит, 1/3 месяца — разовая покупка 99 ₽ за автора (`orders.kind = 'reveal'`, `reveal_purchases`). После оплаты подписки — экран `premiumSuccess`.
- Цены: `pricingFor` в `server/src/plans.ts`. Месяц — стандарт 990 ₽; 299 ₽ — предложение на 3 часа с первого открытия тарифов (`users.offer_started_at`, POST /api/billing/offer, таймер на экране 06); после отмены подписки (`users.cancelled_at`) — только 990 ₽. 3 месяца и год — 499/1499 всегда. Продление — по цене первой оплаты (`base_amount`).
- Отмена подписки: окно «Жалко, что ты уходишь» (только месячный тариф дешевле 990: «вернуться можно только по стандартной цене — 990 ₽/мес») → окно «Мы не хотим тебя терять» (−50% только на следующий платёж, один раз: `subscriptions/update` к половине, после списания — обратно к `base_amount`) → отмена.
- Сторис: `screens/StoriesSheet.tsx` + `lib/storyCard.ts` (canvas 1080×1920, QR `t.me/<bot>/app?startapp=ref_story`); авто-показ через 1 с при первом открытии результатов анкеты (localStorage), кнопка на экране результатов. PNG для Telegram (shareToStory/downloadFile) — временная ссылка `/s/<id>.png` (память сервера, 2 ч).
- Сторис-приглашение «Выложи анкету к себе в сторис»: `lib/inviteCard.ts` (3 варианта, контент по центру, QR и личная ссылка текстом на анкету), окно `StoryDeckSheet` на экране 03 — авто через 1 с после создания анкеты (один раз) и кнопка «Выложить в сторис» (также на экране ожидания 04; если окно ещё не показывалось для анкеты — авто и там); аналитика с префиксом `invite_`.
- Аналитика: таблица `events` (POST /api/events, белый список имён), события `story_sheet_opened` (auto|button), `story_shared` (native|save|telegram_story); источник покупки — `orders.source`; конверсия — view `upsell_conversion`.
- После выдачи домена — redeploy; проверка `GET /api/health`. `/newapp` в BotFather делает владелец (short name `app`).
- Обновления приложения: push в ветку → Railway пересобирает автоматически.
