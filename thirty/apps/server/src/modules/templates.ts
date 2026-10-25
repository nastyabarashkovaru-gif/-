/**
 * Шаблоны сообщений бота — ПРЕДЛАГАЕМЫЕ тексты на согласование владельцем (approved=false).
 * Служебные включены (без них не работают подтверждения оплаты и отмены), рекламные цепочки выключены
 * до утверждения. Всё редактируется в админке A14: текст, кнопки, задержка, лимит частоты, приоритет.
 */
export interface TemplateSeed {
  key: string;
  title: string;
  text: string;
  buttons: { text: string; screen: string }[];
  enabled: boolean;
  isMarketing: boolean;
  delayMinutes: number;
  capHours: number;
  priority: number;
  imageUrl?: string | null;
}

/**
 * Дожимная цепочка до оплаты (ТЗ владельца 25.10): тексты утверждены, менять без согласования нельзя.
 * delayMinutes: 02–07 — минут после первого показа предложения; 08–09 — минут после окончания акции;
 * 10–11 — минут ДО старта ближайшего потока. Цены подставляются из настроек тарифов.
 */
/** Тексты в HTML-разметке Telegram: <b>…</b> — жирный */
export const WELCOME_TEXT = '<b>Привет! 😍 На связи Настя, основатель сообщества «30 дней» 💜</b>\n\nЗдесь мы:\n- ставим цели\n- делимся на пары\n- и каждый день скидываем отчёты о проделанной работе 🚀\n\n<b>Скорее нажимай «ОТКРЫТЬ ПРИЛОЖЕНИЕ», чтобы попасть к нам! 🔥👇</b>';
export const WELCOME_IMAGE = '{public_url}/img/bot-welcome.jpg';
export const WELCOME_BUTTON = 'Открыть приложение 😍';

const chain = (n: string, title: string, text: string, button: string, screen: string, delayMinutes: number, extra: Partial<TemplateSeed> = {}): TemplateSeed => ({
  key: `chain_${n}`, title: `Цепочка ${n}. ${title}`, text, buttons: [{ text: button, screen }], enabled: true, isMarketing: true, delayMinutes, capHours: 0, priority: 60, ...extra,
});

export const CHAIN_TEMPLATES: TemplateSeed[] = [
  chain('02', 'Через 10 минут после показа предложения', 'Привет, подскажи, получилось посмотреть, что внутри нашего сообщества?\n\nПредставь: всего через 30 дней у тебя будут <b>новые привычки, новые люди, новая версия тебя</b> 💜\n\n<b>А пока для тебя всё ещё действует специальная цена на вступление!</b>\n\n<b>Успей выбрать свой тариф 😍</b>', 'Посмотреть тарифы 💜', 'tariffs', 10),
  chain('03', 'За 2 часа до конца акции', '<b>⏰ ТВОЯ СКИДКА СКОРО СГОРИТ!</b>\n\nСпециальная цена на вступление в сообщество действует <b>всего 3 часа!</b>\n\n🔥 <b>Сейчас ты можешь присоединиться к нам всего за {p1} ₽ в месяц.</b>\n\nПосле оплаты тебе <b>сразу откроется доступ к чатам, полезным материалам и комьюнити</b>. Ты сможешь уже потихоньку готовиться к челленджу! 💜', 'Забрать скидку 🔥', 'tariffs', 60, { imageUrl: '{public_url}/img/chain-value.png' }),
  chain('04', 'За 1 час до конца акции', '<b>⏰ ДО ОКОНЧАНИЯ ТВОЕЙ ПЕРСОНАЛЬНОЙ СКИДКИ ОСТАЛСЯ ВСЕГО ЧАС!</b>\n\n<b>Ты точно хочешь упустить эту возможность?</b>\n\nБадди, новые знакомства, ежедневная мотивация, созвоны с лидерами и целое сообщество людей, которые тоже решили изменить свою жизнь 💜\n\n<b>Всё это может стать твоим уже сегодня!</b>', 'Успеть вступить 😍', 'tariffs', 120),
  chain('05', 'За 30 минут до конца акции', '<b>🥲 ЧТО Ж, Я ВИЖУ, ТЕБЕ ВСЁ РАВНО…</b>\n\nНо тем не менее напомню: <b>до сгорания скидки осталось всего 30 минут!</b>\n\n<b>Успей попасть к нам на челлендж.</b> Поверь, ты точно не пожалеешь 💜\n\n<b>{p1} ₽ — это меньше двух чашек кофе за месяц</b>, которые ты всё равно пропьёшь.\n\nА здесь эта цена — <b>вложение в твою трансформацию и изменённое будущее</b> 🚀', 'Хочу изменить свою жизнь 💜', 'tariffs', 150),
  chain('06', 'За 10 минут до конца акции', '<b>🚨 СРОЧНО! ОСТАЛОСЬ ВСЕГО 10 МИНУТ, ЧТОБЫ УСПЕТЬ!</b>\n\nУ тебя осталось <b>всего 10 минут</b>, чтобы оплатить вход в сообщество по специальной цене!\n\nПосле окончания акции тарифы вернутся к обычной стоимости:\n\n1 месяц: <b>{p1} ₽</b> → {r1} ₽\n\n3 месяца: <b>{p3} ₽</b> → {r3} ₽\n\n6 месяцев: <b>{p6} ₽</b> → {r6} ₽\n\n<b>Успей присоединиться к нам по скидке! 😍</b>', 'Успеть за 10 минут 🔥', 'tariffs', 170),
  chain('07', 'Сразу после окончания акции', '<b>💔 ЧТО Ж… ТВОЯ СКИДКА СГОРЕЛА.</b>\n\nЯ вижу, что тебе пока всё равно.\n\nБольше не буду тебя докучать напоминаниями об этой скидке 🥹\n\nНо если вдруг передумаешь — <b>двери нашего сообщества для тебя всё ещё открыты</b> 💜', 'Открыть сообщество', 'tariffs', 180),
  chain('08', 'Через 2 дня после окончания акции', '<b>👀 спишь?</b>\n\n<b>А что, если через месяц ты пожалеешь, что не начала?</b>\n\nНаш челлендж «30 дней» — это возможность <b>наконец взяться за цели, которые ты постоянно откладываешь</b>.\n\nПредставь: через месяц у тебя уже новые привычки, новые знакомства и первые результаты, которыми ты гордишься 💜\n\n<b>А самое главное — тебе не придётся проходить этот путь одной.</b>', 'Хочу в сообщество 😍', 'tariffs', 2 * 24 * 60),
  chain('09', 'Через 4 дня после окончания акции', '<b>🎁 ХОЧЕШЬ ВЕРНУТЬ СКИДКУ НА ВСТУПЛЕНИЕ? ЕСТЬ СПОСОБ!</b>\n\nЯ решила дать тебе <b>ещё один шанс присоединиться к нам по специальной цене</b> 😍\n\nДля этого:\n\n1. Получи карточку «Я иду на челлендж 30 дней».\n2. Впиши в неё свои цели на ближайший месяц.\n3. Выложи карточку в Instagram Stories и отметь мой аккаунт.\n\nПосле проверки сторис ты получишь <b>персональный промокод, который вернёт тебе первоначальную скидку</b> 💜', 'Вернуть скидку 🎁', 'restore', 4 * 24 * 60),
  chain('10', 'За 2 дня до старта потока', '<b>🚀 ДО СТАРТА «30 ДНЕЙ» ОСТАЛОСЬ ВСЕГО 2 ДНЯ!</b>\n\nСовсем скоро участники начнут выполнять свои планы, знакомиться с бадди и делиться первыми результатами.\n\n<b>А ты всё ещё можешь стать частью нашего сообщества! 😍</b>\n\nПредставь, что уже через месяц ты скажешь себе: «Как хорошо, что я тогда решилась!» 💜', 'Присоединиться к челленджу 🚀', 'tariffs', 2 * 24 * 60),
  chain('11', 'За 1 день до старта потока (промокод СТАРТ)', '<b>🚨 ЗАВТРА СТАРТУЕМ! Я ВЕРНУЛА ТВОЮ СКИДКУ!</b>\n\nУ меня для тебя последний подарок 🎁\n\n<b>По промокоду СТАРТ</b> ты можешь снова вступить в сообщество по первоначальной акционной цене!\n\n1 месяц: {r1} ₽ → <b>{p1} ₽</b>\n\n3 месяца: {r3} ₽ → <b>{p3} ₽</b>\n\n6 месяцев: {r6} ₽ → <b>{p6} ₽</b>\n\n<b>Вводи промокод СТАРТ при оплате и присоединяйся к нам! 💜</b>', 'Забрать скидку 😍', 'tariffs', 24 * 60),
];

export const DEFAULT_TEMPLATES: TemplateSeed[] = [
  // B01–B03
  { key: 'welcome', title: 'Цепочка 01. /start — приветствие (один раз)', text: WELCOME_TEXT, imageUrl: WELCOME_IMAGE, buttons: [{ text: WELCOME_BUTTON, screen: 'welcome' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 0, priority: 100 },
  { key: 'abandoned_purchase', title: 'B02 Незавершённая покупка', text: 'Ты остановился в шаге от старта. Твой выбор сохранён — можно продолжить с того же места.', buttons: [{ text: 'Продолжить', screen: 'resume' }], enabled: false, isMarketing: true, delayMinutes: 60, capHours: 24, priority: 60 },
  { key: 'payment_success', title: 'B03 Оплата прошла', text: 'Оплата прошла, ты в клубе! 🎉\n\nТариф: {tariff}\nТвои потоки: {flows}\nСледующее списание: {next_date}, {next_amount} ₽ (отключить можно в профиле).\n\nЗаполни анкету и выбери цели — это займёт 5 минут.', buttons: [{ text: 'Заполнить анкету', screen: 'reg_profile' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 0, priority: 100 },
  // B04–B09 дожим до оплаты
  { key: 'nudge_not_reached_tariffs', title: 'B04 Открыл, не дошёл до тарифов', text: 'Ты начал знакомиться с «30 днями». Осталось пару экранов — посмотри, что внутри клуба.', buttons: [{ text: 'Продолжить', screen: 'resume' }], enabled: false, isMarketing: true, delayMinutes: 120, capHours: 72, priority: 40 },
  { key: 'nudge_tariffs_no_select', title: 'B05 Видел тарифы, не выбрал', text: 'В одиночку бросить легко. В «30 днях» у тебя будет бадди, чат потока и созвон с экспертом каждую неделю — так дойти до конца проще.', buttons: [{ text: 'Посмотреть тарифы', screen: 'tariffs' }], enabled: false, isMarketing: true, delayMinutes: 60, capHours: 72, priority: 45 },
  { key: 'nudge_selected_no_payment', title: 'B06 Выбрал тариф, не начал оплату', text: 'Ты выбрал тариф «{tariff}». Сейчас он стоит {price} ₽{offer_line}.', buttons: [{ text: 'Перейти к оплате', screen: 'checkout' }], enabled: false, isMarketing: true, delayMinutes: 30, capHours: 48, priority: 50 },
  { key: 'nudge_payment_incomplete', title: 'B07 Оплата не завершилась', text: 'Похоже, оплата не завершилась. Если что-то пошло не так — попробуй ещё раз, ссылка безопасная.', buttons: [{ text: 'Попробовать ещё раз', screen: 'checkout' }], enabled: false, isMarketing: false, delayMinutes: 30, capHours: 24, priority: 70 },
  { key: 'offer_ending_60', title: 'B08 До конца цены 1 час', text: 'Через час специальная цена закончится. Сейчас «{tariff}» — {price} ₽.', buttons: [{ text: 'Забрать цену', screen: 'tariffs' }], enabled: false, isMarketing: true, delayMinutes: 0, capHours: 3, priority: 55 },
  { key: 'offer_ending_15', title: 'B08 До конца цены 15 минут', text: 'Осталось 15 минут специальной цены.', buttons: [{ text: 'Успеть', screen: 'tariffs' }], enabled: false, isMarketing: true, delayMinutes: 0, capHours: 3, priority: 56 },
  { key: 'offer_expired', title: 'B09 Цена истекла', text: 'Специальная цена закончилась. Сейчас участие стоит от {price} ₽.{referral_line}', buttons: [{ text: 'Тарифы', screen: 'tariffs' }], enabled: false, isMarketing: true, delayMinutes: 0, capHours: 168, priority: 30 },
  // B10 регистрация
  { key: 'reg_profile', title: 'B10 Не заполнил профиль', text: 'Остался последний шаг до старта — заполни профиль. Без него мы не подберём тебе бадди.', buttons: [{ text: 'Заполнить', screen: 'reg_profile' }], enabled: true, isMarketing: false, delayMinutes: 120, capHours: 24, priority: 65 },
  { key: 'reg_goals', title: 'B10 Не зафиксировал цели', text: 'Цели ещё не зафиксированы. После старта потока поменять их будет нельзя — давай закрепим сейчас.', buttons: [{ text: 'Выбрать цели', screen: 'reg_goals' }], enabled: true, isMarketing: false, delayMinutes: 120, capHours: 24, priority: 66 },
  { key: 'reg_buddy', title: 'B10 Не выбрал бадди', text: 'Хочешь идти вместе с другом? Пригласи его до старта. Если нет — мы подберём бадди сами.', buttons: [{ text: 'Бадди', screen: 'reg_buddy' }], enabled: true, isMarketing: false, delayMinutes: 240, capHours: 48, priority: 40 },
  // B11 старт и биллинг
  { key: 'flow_start_soon', title: 'B11 Скоро старт', text: 'Поток «{flow}» стартует {date}. Проверь цели и вступи в чат потока.', buttons: [{ text: 'Открыть', screen: 'home' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 20, priority: 70 },
  { key: 'renewal_failed', title: 'B11 Продление не прошло', text: 'Не получилось списать {amount} ₽ за продление. Доступ к следующему потоку откроется после оплаты.', buttons: [{ text: 'Оплатить', screen: 'profile' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 24, priority: 90 },
  { key: 'renewal_success', title: 'B11 Продление прошло', text: 'Подписка продлена: {flows}. Следующее списание — {next_date}.', buttons: [{ text: 'Открыть', screen: 'home' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 0, priority: 80 },
  { key: 'period_ending', title: 'B11 Оплаченный период заканчивается', text: 'Оплаченный доступ закончится {date}. Автопродление выключено — включить его можно в профиле.', buttons: [{ text: 'Профиль', screen: 'profile' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 72, priority: 60 },
  { key: 'buddy_proposal', title: 'Предложение стать парой', text: '<b>{name} предлагает тебе стать парой 💜</b>\n\nБадди — это человек, с которым вы вместе идёте к целям весь месяц. Открой приложение, чтобы подтвердить или отклонить.', buttons: [{ text: 'Ответить 💜', screen: 'buddy' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 0, priority: 85 },
  { key: 'promo_issued', title: 'Персональный промокод за сторис', text: 'Спасибо за сторис! 💜 Твой персональный промокод: <b>{code}</b>\n\nОн вернёт первоначальную акционную цену и действует до {until}. Введи его на экране тарифов.', buttons: [{ text: 'Ввести промокод 🎁', screen: 'tariffs' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 0, priority: 95 },
  { key: 'story_rejected', title: 'Сторис не прошла проверку', text: 'Мы не смогли засчитать сторис: {reason}\n\nМожно выложить карточку ещё раз и отправить заявку повторно.', buttons: [{ text: 'Вернуть скидку 🎁', screen: 'restore' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 0, priority: 90 },
  { key: 'cancel_confirmed', title: 'Отмена автопродления', text: 'Автопродление отключено. Доступ сохранится до {paid_until}. Будем рады видеть тебя снова!', buttons: [{ text: 'Профиль', screen: 'profile' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 0, priority: 95 },
  { key: 'payment_duplicate', title: 'Повторная оплата', text: 'Мы получили повторную оплату, хотя подписка уже действует. Двойного списания за доступ не будет — поддержка оформит возврат.', buttons: [{ text: 'Поддержка', screen: 'support' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 0, priority: 95 },
  // B12 отчёты
  { key: 'report_reminder', title: 'B12 Напоминание об отчёте', text: 'До конца дня {hours} ч. Отметь сегодняшний прогресс 💪', buttons: [{ text: 'Сдать отчёт', screen: 'report' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 20, priority: 75 },
  { key: 'report_missed_comeback', title: 'B12 После пропуска', text: 'Вчера отчёта не было — бывает. Сегодня новый день: отметь прогресс и продолжай. Пропуск снижает процент, но путь не заканчивается.', buttons: [{ text: 'Сдать отчёт', screen: 'report' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 20, priority: 60 },
  // B13–B15
  { key: 'weekly_card', title: 'B13 Карточка недели', text: 'Неделя {week} позади: {days} успешных дней из 7. Твоя карточка прогресса готова!', buttons: [{ text: 'Открыть карточку', screen: 'card' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 0, priority: 50 },
  { key: 'review_request', title: 'B14 Просьба об отзыве', text: 'Поделишься, что изменилось? Это займёт минуту и полностью добровольно — на рейтинг не влияет.', buttons: [{ text: 'Оставить отзыв', screen: 'review' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 72, priority: 30 },
  { key: 'buddy_matched', title: 'B15 Бадди назначен', text: 'У тебя есть бадди! Познакомьтесь и поддерживайте друг друга весь месяц.', buttons: [{ text: 'Мой бадди', screen: 'buddy' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 0, priority: 80 },
  { key: 'meeting_soon', title: 'B15 Созвон через час', text: 'Через час созвон «{title}». Подключайся!', buttons: [{ text: 'Подробнее', screen: 'meeting' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 0, priority: 70 },
  { key: 'flow_finished', title: 'B15 Финал потока', text: 'Поток «{flow}» завершён! Заполни итоговую анкету: подтверди результат по каждой цели и добавь фото «после».', buttons: [{ text: 'Итоги', screen: 'final' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 0, priority: 85 },
];
