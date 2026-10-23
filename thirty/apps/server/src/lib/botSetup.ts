import { config } from '../config';
import { tg, webhookSecret } from './telegram';

/** Настройка webhook и кнопки меню при старте (идемпотентно) */
export async function setupBot() {
  if (!config.BOT_TOKEN) {
    console.warn('[bot] BOT_TOKEN не задан — бот выключен');
    return;
  }
  try {
    const me = await tg<{ username: string }>('getMe', {});
    if (!config.BOT_USERNAME) config.BOT_USERNAME = me.username;
    if (!config.PUBLIC_URL) {
      console.warn('[bot] PUBLIC_URL не задан — webhook не настроен');
      return;
    }
    await tg('setWebhook', {
      url: `${config.PUBLIC_URL}/api/telegram/webhook`,
      secret_token: webhookSecret,
      allowed_updates: ['message', 'chat_join_request', 'my_chat_member', 'chat_member'],
    });
    await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: '30 дней', web_app: { url: `${config.PUBLIC_URL}/` } } });
    await tg('setMyCommands', { commands: [{ command: 'start', description: 'Открыть «30 дней»' }, { command: 'stop', description: 'Отписаться от рекламных напоминаний' }, { command: 'support', description: 'Поддержка' }] });
    console.log(`[bot] @${me.username}: webhook → ${config.PUBLIC_URL}`);
    const info = await tg<{ url: string; pending_update_count: number; last_error_date?: number; last_error_message?: string; allowed_updates?: string[]; ip_address?: string }>('getWebhookInfo', {});
    console.log(`[bot] webhookInfo url=${info.url} pending=${info.pending_update_count} ip=${info.ip_address ?? '-'} allowed=${(info.allowed_updates ?? []).join('|')} lastError=${info.last_error_message ?? '-'}${info.last_error_date ? ` at ${new Date(info.last_error_date * 1000).toISOString()}` : ''}`);
  } catch (e) {
    console.error('[bot] настройка не удалась:', (e as Error).message);
  }
}
