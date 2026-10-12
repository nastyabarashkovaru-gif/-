import { createHash } from 'node:crypto';
import { config } from './config.js';
import { pool, logError } from './db.js';
import { tg } from './telegramApi.js';
import { processPaymentSucceeded, processRefund, validateIntent } from './services/subscription.js';
import { openAppButton } from './services/notifications.js';
import { getValue } from './appConfig.js';

/** Секрет webhook выводится из токена бота — отдельная переменная не нужна. */
export const webhookSecret = () => createHash('sha256').update(`rostok-webhook:${config.botToken}`).digest('hex').slice(0, 48);

export async function setupBot() {
  if (!config.botToken) {
    console.warn('[bot] BOT_TOKEN не задан — бот, вход через Telegram и оплата Stars отключены');
    return;
  }
  if (!config.publicUrl.startsWith('https://')) {
    console.warn('[bot] PUBLIC_URL не https — webhook не настроен');
    return;
  }
  try {
    const me = await tg<{ username: string }>('getMe', {});
    if (!config.botUsername) config.botUsername = me.username;
    await tg('setWebhook', {
      url: `${config.publicUrl}/api/telegram/webhook`,
      secret_token: webhookSecret(),
      allowed_updates: ['message', 'pre_checkout_query', 'my_chat_member'],
      drop_pending_updates: false,
    });
    const brand = (await getValue<any>('brand')) ?? {};
    await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Мой сад', web_app: { url: config.publicUrl } } });
    await tg('setMyDescription', { description: `${brand.appName ?? 'ROSTOK'} — ${brand.slogan ?? ''}`.slice(0, 512) }).catch(() => {});
    console.log(`[bot] @${config.botUsername}: webhook и кнопка меню → ${config.publicUrl}`);
  } catch (e) {
    console.error('[bot] настройка не удалась:', (e as Error).message);
  }
}

export async function handleUpdate(u: any) {
  try {
    if (u.pre_checkout_query) {
      const p = u.pre_checkout_query;
      const err = await validateIntent(p.invoice_payload, p.total_amount, p.currency, p.from.id);
      await tg('answerPreCheckoutQuery', err ? { pre_checkout_query_id: p.id, ok: false, error_message: err } : { pre_checkout_query_id: p.id, ok: true });
      return;
    }
    if (u.my_chat_member) {
      const st = u.my_chat_member.new_chat_member?.status;
      await pool.query('UPDATE users SET bot_blocked=$2 WHERE telegram_id=$1', [u.my_chat_member.from.id, st === 'kicked']);
      return;
    }
    const m = u.message;
    if (!m) return;
    if (m.successful_payment) {
      const sp = m.successful_payment;
      await processPaymentSucceeded({
        provider: 'telegram_stars',
        eventKey: `tg:${sp.telegram_payment_charge_id}`,
        intentId: sp.invoice_payload,
        chargeId: sp.telegram_payment_charge_id,
        amount: sp.total_amount,
        currency: sp.currency,
        isRecurring: !!sp.is_recurring,
        isFirstRecurring: !!sp.is_first_recurring,
        subscriptionExpiration: sp.subscription_expiration_date ? new Date(sp.subscription_expiration_date * 1000) : null,
        telegramId: m.from?.id,
        raw: { is_recurring: !!sp.is_recurring, is_first_recurring: !!sp.is_first_recurring },
      });
      await tg('sendMessage', { chat_id: m.chat.id, text: 'Оплата прошла 🌱 Твой сад открыт!', reply_markup: { inline_keyboard: [[openAppButton('Открыть сад')]] } }).catch(() => {});
      return;
    }
    if (m.refunded_payment) {
      const rp = m.refunded_payment;
      await processRefund({ provider: 'telegram_stars', chargeId: rp.telegram_payment_charge_id, eventKey: `tg-refund:${rp.telegram_payment_charge_id}` });
      return;
    }
    if (typeof m.text === 'string' && m.text.startsWith('/start')) {
      await pool.query(
        `INSERT INTO users(telegram_id, first_name, username, language_code, bot_started) VALUES ($1,$2,$3,$4,true)
         ON CONFLICT (telegram_id) DO UPDATE SET bot_started=true, bot_blocked=false`,
        [m.from.id, m.from.first_name ?? null, m.from.username ?? null, m.from.language_code ?? null],
      );
      const brand = (await getValue<any>('brand')) ?? {};
      await tg('sendMessage', {
        chat_id: m.chat.id,
        text: `🌱 ${brand.slogan ?? 'Выполняй задания в реальной жизни и выращивай свой сад'}.\n\nЗдесь будут приходить мягкие напоминания — их можно включить или выключить в настройках приложения.`,
        reply_markup: { inline_keyboard: [[openAppButton('Открыть сад')]] },
      });
      return;
    }
    if (typeof m.text === 'string' && (m.text === '/paysupport' || m.text === '/support')) {
      await tg('sendMessage', {
        chat_id: m.chat.id,
        text: config.supportUsername ? `Поддержка: @${config.supportUsername}. Опиши вопрос, и мы ответим.` : 'Напиши свой вопрос в ответ на это сообщение — мы ответим.',
      });
    }
  } catch (e) {
    await logError('telegram_update', (e as Error).message, { update_id: u?.update_id });
    throw e;
  }
}
