const env = import.meta.env;

/** botUsername / appShortName обновляются из ответа backend (/api/me) */
export const config = {
  /** Демо-режим: локальный mock API с явно помеченными демо-данными и панель DEMO. */
  demo: env.VITE_DEMO !== 'false',
  /** Базовый URL backend. Пусто → mock (разрешён только в демо-режиме). */
  apiUrl: (env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '',
  botUsername: (env.VITE_BOT_USERNAME as string | undefined) || 'Hush_miniapp_bot',
  appShortName: (env.VITE_APP_SHORT_NAME as string | undefined) || 'app',
  supportUrl: (env.VITE_SUPPORT_URL as string | undefined) || '',
  termsUrl: (env.VITE_TERMS_URL as string | undefined) || '',
  version: '1.0',
};

/** Ссылка на анкету: открывает Mini App с start_param = id анкеты. */
export function questionnaireLink(id: string): string {
  return `https://t.me/${config.botUsername}/${config.appShortName}?startapp=${encodeURIComponent(id)}`;
}
