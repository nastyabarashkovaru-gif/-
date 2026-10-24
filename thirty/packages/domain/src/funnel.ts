export interface FunnelStep {
  key: string;
  title: string;
  count: number;
}

export function funnelRates(steps: FunnelStep[]) {
  const start = steps[0]?.count ?? 0;
  return steps.map((s, i) => {
    const prev = i === 0 ? s.count : steps[i - 1].count;
    return {
      ...s,
      pctPrev: prev > 0 ? Math.round((s.count / prev) * 1000) / 10 : 0,
      pctStart: start > 0 ? Math.round((s.count / start) * 1000) / 10 : 0,
      dropOff: Math.max(0, prev - s.count),
    };
  });
}

/** Стабильное распределение по вариантам A/B по весам */
export function pickVariant(userId: string, experimentKey: string, variants: { key: string; weight: number }[]): string {
  let h = 2166136261;
  const s = `${experimentKey}:${userId}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const total = variants.reduce((a, v) => a + Math.max(0, v.weight), 0);
  if (total <= 0) return variants[0]?.key ?? 'control';
  let x = ((h >>> 0) / 4294967296) * total;
  for (const v of variants) {
    x -= Math.max(0, v.weight);
    if (x < 0) return v.key;
  }
  return variants[variants.length - 1].key;
}

/** Словарь событий аналитики ТЗ §10 */
export const EVENT_NAMES = [
  'app_open', 'screen_view', 'screen_exit', 'onboarding_started', 'onboarding_step_view', 'onboarding_skipped',
  'value_screen_view', 'tariff_view', 'tariff_select', 'payment_start', 'payment_success', 'payment_failed',
  'registration_started', 'registration_completed', 'goal_created', 'task_created', 'before_uploaded',
  'buddy_invite_sent', 'buddy_matched', 'report_started', 'report_submitted', 'report_rejected', 'feed_open',
  'participants_search', 'leaderboard_open', 'club_open', 'chat_link_open', 'meeting_view', 'meeting_join_click',
  'review_prompt_view', 'review_submitted', 'review_publish_consent', 'share_card_generated', 'share_clicked',
  'subscription_renewal_success', 'subscription_renewal_failed', 'cancel_started', 'cancel_step_view',
  'cancel_completed', 'upsell_view', 'upsell_purchase', 'bot_message_sent', 'bot_message_click',
  'bot_message_failed', 'bot_conversion_after_click',
] as const;
export type EventName = (typeof EVENT_NAMES)[number];

/** Основная воронка ТЗ §10 */
export const MAIN_FUNNEL: { key: string; title: string; event: EventName; screen?: string }[] = [
  { key: 'open', title: 'Открыли приложение', event: 'app_open' },
  { key: 'o01', title: 'O01 Приветствие', event: 'onboarding_step_view', screen: 'O01' },
  { key: 'o02', title: 'O02 Команда поддержки', event: 'onboarding_step_view', screen: 'O02' },
  { key: 'o03', title: 'O03 Бадди', event: 'onboarding_step_view', screen: 'O03' },
  { key: 'o04', title: 'O04 Чат потока', event: 'onboarding_step_view', screen: 'O04' },
  { key: 'o05', title: 'O05 Тематические чаты', event: 'onboarding_step_view', screen: 'O05' },
  { key: 'o06', title: 'O06 Созвоны', event: 'onboarding_step_view', screen: 'O06' },
  { key: 'o07', title: 'O07 Лидеры', event: 'onboarding_step_view', screen: 'O07' },
  { key: 'o08', title: 'O08 Мой челлендж', event: 'onboarding_step_view', screen: 'O08' },
  { key: 'o09', title: 'O09 Прогресс', event: 'onboarding_step_view', screen: 'O09' },
  { key: 'o10', title: 'O10 Призы', event: 'onboarding_step_view', screen: 'O10' },
  { key: 'o11', title: 'O11 Спасибо', event: 'onboarding_step_view', screen: 'O11' },
  { key: 'tariffs', title: 'S06 Тарифы', event: 'tariff_view' },
  { key: 'select', title: 'Клик на тариф', event: 'tariff_select' },
  { key: 'pay_start', title: 'Платёж начат', event: 'payment_start' },
  { key: 'paid', title: 'Оплата успешна', event: 'payment_success' },
  { key: 'registered', title: 'Анкета завершена', event: 'registration_completed' },
  { key: 'first_report', title: 'Первый отчёт', event: 'report_submitted' },
];
