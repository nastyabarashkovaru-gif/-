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
}

export const DEFAULT_TEMPLATES: TemplateSeed[] = [
  // B01–B03
  { key: 'welcome', title: 'B01 /start — приветствие', text: 'Привет! Это «30 дней» — клуб дисциплины.\n\nВыбери цель, отмечай прогресс каждый день, а мы дадим бадди, окружение и еженедельные созвоны с экспертами.', buttons: [{ text: 'Открыть приложение', screen: 'welcome' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 0, priority: 100 },
  { key: 'abandoned_purchase', title: 'B02 Незавершённая покупка', text: 'Ты остановился в шаге от старта. Твой выбор сохранён — можно продолжить с того же места.', buttons: [{ text: 'Продолжить', screen: 'resume' }], enabled: false, isMarketing: true, delayMinutes: 60, capHours: 24, priority: 60 },
  { key: 'payment_success', title: 'B03 Оплата прошла', text: 'Оплата прошла, ты в клубе! 🎉\n\nТариф: {tariff}\nТвои потоки: {flows}\nСледующее списание: {next_date}, {next_amount} ₽ (отключить можно в профиле).\n\nЗаполни анкету и выбери цели — это займёт 5 минут.', buttons: [{ text: 'Заполнить анкету', screen: 'reg_profile' }], enabled: true, isMarketing: false, delayMinutes: 0, capHours: 0, priority: 100 },
  // B04–B09 дожим до оплаты
  { key: 'nudge_not_reached_tariffs', title: 'B04 Открыл, не дошёл до тарифов', text: 'Ты начал знакомиться с «30 днями». Осталось пару экранов — посмотри, что внутри клуба.', buttons: [{ text: 'Продолжить', screen: 'resume' }], enabled: false, isMarketing: true, delayMinutes: 120, capHours: 72, priority: 40 },
  { key: 'nudge_tariffs_no_select', title: 'B05 Видел тарифы, не выбрал', text: 'В одиночку бросить легко. В «30 днях» у тебя будет бадди, чат потока и созвон с экспертом каждую неделю — так дойти до конца проще.', buttons: [{ text: 'Посмотреть тарифы', screen: 'tariffs' }], enabled: false, isMarketing: true, delayMinutes: 60, capHours: 72, priority: 45 },
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
