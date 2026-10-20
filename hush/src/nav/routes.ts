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
  | { name: 'admin' }
  /* ───── HUSH 2.0 ───── */
  /** Первый экран нового пользователя: две механики */
  | { name: 'start' }
  /** Вкладки нижней панели */
  | { name: 'inbox' }
  | { name: 'asks' }
  | { name: 'profile' }
  /** «Твоя ссылка готова!» */
  | { name: 'myLink' }
  /** Форма вопроса по личной ссылке (u_<slug>) */
  | { name: 'askMe'; slug: string }
  /** Отправлено: вопрос по личной ссылке или ответ на чужой вопрос */
  | { name: 'sent'; kind: 'question' | 'answer'; slug?: string; revealed?: boolean }
  | { name: 'answerInbox'; id: string }
  | { name: 'createAsk' }
  /** Свой вопрос: ответы; fresh — только что создан */
  | { name: 'askDetail'; id: string; fresh?: boolean }
  /** Ответ подписчика на чужой вопрос (a_<id>) */
  | { name: 'askReply'; id: string };

/** Вкладки нижней панели */
export const TAB_ROUTES = ['inbox', 'asks', 'profile'] as const;

export const routeKey = (r: Route): string =>
  [
    r.name,
    'qid' in r ? r.qid : '',
    'respondentId' in r ? r.respondentId : '',
    'id' in r ? r.id : '',
    'slug' in r ? r.slug : '',
    'kind' in r ? r.kind : '',
  ].join(':');
