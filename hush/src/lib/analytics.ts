import { api, type AnalyticsEvent } from '@/api';

/** Отправка события без ожидания: аналитика не должна мешать интерфейсу */
export function track(name: AnalyticsEvent, source: string): void {
  api.trackEvent(name, source).catch(() => {});
}
