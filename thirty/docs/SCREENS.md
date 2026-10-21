# Карта экранов

Обозначения. **События**: кроме общих `screen_view` и `screen_exit` (со временем на экране), которые шлются для каждого экрана автоматически. **Состояния**: L — loading, E — empty, O — offline, Er — error, D — disabled, S — success.

## Бот

| ID | Триггер | Содержание | Кнопки | События |
|---|---|---|---|---|
| B01 | `/start [payload]` | приветствие (шаблон `welcome`) | «Открыть приложение» (web_app) | bot_message_sent, bot_message_click |
| B02 | незавершённая покупка (цепочки ниже) | шаблон `abandoned_*` | «Вернуться» → нужный экран | + bot_conversion_after_click |
| B03 | webhook оплаты `success` | подтверждение, даты потоков, следующего списания | «Заполнить анкету» → S11 | |
| B04 | открыл, не дошёл до тарифов (через 2 ч) | `nudge_not_reached_tariffs` | «Продолжить» → последний экран | |
| B05 | видел тарифы, не выбрал (через 1 ч) | `nudge_tariffs_no_select` | «Посмотреть тарифы» → S06 | |
| B06 | выбрал, не начал оплату (через 30 мин) | `nudge_selected_no_payment`, реальная цена и срок акции | «К оплате» → S07 | |
| B07 | начал оплату, нет webhook за 30 мин или `failed` | `nudge_payment_incomplete` (не пишем «не оплатил», пока окно ожидания не истекло) | «Попробовать ещё раз» → S07 | |
| B08 | до конца предложения 60 и 15 минут | `offer_ending_60`, `offer_ending_15` (только если действует и нет оплаты) | «Забрать цену» | |
| B09 | предложение истекло | `offer_expired`, новая цена + реферальная механика | «Тарифы» | |
| B10 | оплатил, не прошёл S11 / S13 / S16 | `reg_profile`, `reg_goals`, `reg_buddy` | на конкретный экран | |
| B11 | за 3 дня и за 1 день до старта; неуспешное продление; конец оплаченного периода через 7 дней | `flow_start_soon`, `renewal_failed`, `period_ending` | | subscription_renewal_failed |
| B12 | нет отчёта за 3 часа до дедлайна; после пропуска | `report_reminder`, `report_missed_comeback` | «Сдать отчёт» → S21 | |
| B13 | 7/14/21/28 день | `weekly_card` | «Открыть карточку» → S31 | |
| B14 | после созвона, 14-й день, финал | `review_request` | «Оставить отзыв» → S32 | |
| B15 | служебные: бадди назначен, созвон через 1 ч, оплата, финал | `buddy_matched`, `meeting_soon`, `payment_success`, `flow_finished` | | |

У всех шаблонов в A14 настраиваются: выключатель, текст, кнопки, задержка, лимит частоты, приоритет, признак «рекламное» (нужен opt-in и есть отписка).

## Mini App

| ID | Маршрут | Назначение | Основной CTA | События | API |
|---|---|---|---|---|---|
| S01 | `/welcome` | оффер (точная формулировка из ТЗ) | «Начать» / «Пропустить» | app_open, onboarding_started, onboarding_step_view, onboarding_skipped | GET /api/me, POST /api/events |
| S02 | `/onboarding/home` | mock главной с демо-данными | «Дальше» | onboarding_step_view | |
| S03 | `/onboarding/club` | чат потока, 5 тематических чатов, созвоны | «Дальше» | onboarding_step_view | |
| S04 | `/onboarding/cases` | кейсы, отзывы, правила приза | «Дальше» | onboarding_step_view | GET /api/public/cases, /api/public/rules |
| S05 | `/onboarding/value` | ценность (позиции из админки, сумма) | «Выбрать тариф» | value_screen_view | GET /api/public/value |
| S06 | `/tariffs` | 3 тарифа, таймер, честные сравнения | выбор тарифа | tariff_view, tariff_select | GET /api/offer, POST /api/offer/start |
| S07 | `/checkout/:tariff` | даты потоков, дата и сумма следующего списания, автопродление, согласия (ПДн, публичные отчёты, 18+, оферта) | «Оплатить» (D, пока нет согласий) | payment_start | POST /api/checkout |
| S08 | внешняя страница Prodamus | `openLink(paymentUrl)` | | | |
| S09 | `/checkout/success` | ждём webhook (поллинг статуса), затем успех | «Заполнить анкету» | payment_success | GET /api/payments/:id |
| S10 | `/checkout/pending` | ошибка или ожидание | «Повторить» / «В поддержку» | payment_failed | |
| S11 | `/reg/profile` | имя, город?, часовой пояс, интересы, видимость | «Дальше» | registration_started | PATCH /api/me |
| S12 | `/reg/flow` | ближайший поток, обратный отсчёт | «Дальше» | | GET /api/flows/upcoming |
| S13 | `/reg/goals` | цели (лимит по тарифу), категория, критерий | «Добавить задачи» | goal_created | POST/PATCH/DELETE /api/goals |
| S14 | `/reg/tasks/:goal` | задачи: периодичность, доказательство, критерий | «Сохранить» | task_created | POST /api/goals/:id/tasks |
| S15 | `/reg/before` | «ДО»: текст, фото, показатели, отдельные согласия | «Зафиксировать» | before_uploaded | PUT /api/membership/before, POST /api/media |
| S16 | `/reg/buddy` | пригласить друга или «подберите мне» | «Отправить приглашение» | buddy_invite_sent | POST /api/buddy/invite |
| S17 | `/reg/waiting` | ожидание старта, правила | — | registration_completed | |
| S18 | `/reg/chats` | ссылки в чат потока и тематические чаты | «Вступить» | chat_link_open | GET /api/chats |
| S19 | `/` | главная: календарь, %, цель, отчёт, сравнение с прошлым месяцем, бадди | «Сдать отчёт за сегодня» | | GET /api/home |
| S20 | `/goal/:id` | статистика цели | | | GET /api/goals/:id/stats |
| S21 | `/report` | отчёт по задачам, доказательства, предупреждение о публичности | «Опубликовать» (D без evidence) | report_started, report_submitted, report_rejected | POST /api/reports |
| S22 | `/reports/history`, `/report/:id` | история, детали, комментарии, реакции, жалоба | | | GET /api/reports/:id |
| S23 | `/feed` | лента отчётов | | feed_open | GET /api/feed |
| S24 | `/feed/participants` | поиск и фильтры (дата старта потока, город, категория) | | participants_search | GET /api/participants |
| S25 | `/u/:id` | профиль участника | «Написать в Telegram» | | GET /api/participants/:id |
| S26 | `/rating` | рейтинг потока, правила | | leaderboard_open | GET /api/leaderboard |
| S27 | `/club` | чат потока, 5 тематических чатов, календарь созвонов | | club_open, chat_link_open | GET /api/club |
| S28 | `/meeting/:id` | созвон | «Подключиться» | meeting_view, meeting_join_click | GET /api/meetings/:id |
| S29 | `/buddy` | прогресс бадди, написать, замена | «Запросить замену» | | GET/POST /api/buddy |
| S30 | `/profile` | тариф, оплаты, следующий платёж, подписка, архив, уведомления, поддержка | | | GET /api/profile |
| S31 | `/card/:n` | недельная карточка, QR | «Сохранить» / «Поделиться» | share_card_generated, share_clicked | GET /api/cards/:n(.png) |
| S32 | `/review` | отзыв (добровольно), отдельные согласия | «Отправить» | review_prompt_view, review_submitted, review_publish_consent | POST /api/reviews |
| S33 | `/final` | итоговая анкета, «ПОСЛЕ», карточка, следующий поток | | | POST /api/membership/final |
| S34 | `/archive` | архив и сравнение месяцев (3 и 6 месяцев: трансформация «до/после», 6 месяцев: карта и значок) | | | GET /api/archive |
| S35 | `/upsell/:code` | апселлы (если включены) | «Оставить заявку» / «Оплатить» | upsell_view, upsell_purchase | |
| S36–S38 | `/cancel/1..3` | результат → альтернатива → подтверждение | «Отменить автопродление» всегда виден | cancel_started, cancel_step_view, cancel_completed | POST /api/subscription/cancel |

## Админка (`/admin/`)

A01 дашборд · A02 воронка и экраны · A03 тарифы, таймер, ценность · A04 платежи и сверка · A05 потоки · A06 пользователи (карточка с полной историей) · A07 модерация · A08 рейтинг и правила · A09 претенденты на приз · A10 бадди · A11 чаты · A12 созвоны и эксперты · A13 отзывы и кейсы · A14 бот · A15 апселлы · A16 настройки, роли, логи, фичефлаги · A17 A/B-тесты.
