export type Route =
  | { name: 'loading' }
  | { name: 'welcome' }
  | { name: 'questions' }
  | { name: 'share'; qid: string }
  /** 04 ожидание или 05 результаты — зависит от числа ответов */
  | { name: 'dashboard'; qid: string }
  /** source — откуда пришли (для конверсии апсейла в покупку) */
  | { name: 'premium'; source?: import('@/api').UpsellSource }
  | { name: 'reveal'; qid: string; respondentId: string }
  /** 08 → 08b для респондента */
  | { name: 'answer'; qid: string }
  | { name: 'success' }
  /** Поздравление после оплаты подписки */
  | { name: 'premiumSuccess'; pending?: boolean }
  | { name: 'settings' }
  | { name: 'subscription' }
  | { name: 'myQuestionnaires' }
  /** Статистика для владельца */
  | { name: 'admin' };

export const routeKey = (r: Route): string =>
  [r.name, 'qid' in r ? r.qid : '', 'respondentId' in r ? r.respondentId : ''].join(':');
