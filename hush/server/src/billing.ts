/**
 * Оплата подписки через CloudPayments.
 *
 * Доступ выдаётся ТОЛЬКО по уведомлению Pay от CloudPayments с проверенной подписью HMAC —
 * никогда по сигналу из приложения. Цены и тарифы берутся с сервера (plans.ts).
 * Уведомления в ЛК CloudPayments: /api/billing/cloudpayments/{check,pay,fail,recurrent}
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { Router, type Request, type Response } from 'express';
import { config } from './config';
import { pool, tx } from './db';
import { getPlan, isPlan, PLANS, pricingFor, RETENTION_DISCOUNT, REVEAL_PRICE, type Plan } from './plans';
import { rateLimit } from './rateLimit';
import { newId } from './routes';

const cp = config.cloudPayments;
export const billingEnabled = Boolean(cp.publicId && cp.apiSecret);

/** Вызов API CloudPayments (Basic-авторизация Public ID + API Secret) */
async function cpApi(method: string, body: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${process.env.CP_API_URL || 'https://api.cloudpayments.ru'}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${cp.publicId}:${cp.apiSecret}`).toString('base64')}`,
    },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as { Success?: boolean; Message?: string };
  if (!data.Success) throw new Error(`${method}: ${data.Message || `HTTP ${r.status}`}`);
}

/* ───────────────────────── API приложения ───────────────────────── */

export const billingApi = Router();

/** Экран тарифов открыт — запускаем 3-часовое предложение (один раз) и отдаём цены */
billingApi.post('/offer', rateLimit('offer', 60, 60 * 60_000), async (req: Request, res: Response) => {
  res.json(await pricingFor(req.user.id, true));
});

billingApi.post('/checkout', rateLimit('checkout', 20, 60 * 60_000), async (req: Request, res: Response) => {
  if (!billingEnabled) {
    res.json({ status: 'unavailable' });
    return;
  }
  const plan = req.body?.plan;
  if (!isPlan(plan)) {
    res.status(400).json({ code: 'invalid' });
    return;
  }
  const { months, title } = PLANS[plan];
  // Цена месяца зависит от предложения на 3 часа и от того, отменял ли пользователь подписку (см. оферту)
  const amount = (await pricingFor(req.user.id, true)).prices[plan];
  const orderId = `H${newId(11)}`;
  // Откуда пришёл покупатель — для конверсии апсейла
  const source = ['new_questionnaire', 'custom_question', 'question_library'].includes(req.body?.source) ? req.body.source : null;
  await pool.query('INSERT INTO orders (id, user_id, plan, amount, source) VALUES ($1, $2, $3, $4, $5)', [
    orderId,
    req.user.id,
    plan,
    amount,
    source,
  ]);

  const receipt = cp.receipts
    ? {
        Items: [{ label: title, price: amount, quantity: 1, amount, vat: cp.vat, method: 4, object: 4 }],
        taxationSystem: cp.taxationSystem,
        amounts: { electronic: amount },
      }
    : undefined;

  res.json({
    status: 'widget',
    params: {
      publicId: cp.publicId,
      description: title,
      amount,
      currency: 'RUB',
      invoiceId: orderId,
      accountId: String(req.user.id),
      skin: 'mini',
      requireEmail: cp.receipts,
      data: {
        plan,
        CloudPayments: {
          ...(receipt ? { CustomerReceipt: receipt } : {}),
          // Автопродление: следующее списание через период тарифа
          recurrent: { interval: 'Month', period: months, ...(receipt ? { customerReceipt: receipt } : {}) },
        },
      },
    },
  });
});

/**
 * Разовое раскрытие автора за 99 ₽ (тарифы 1 и 3 месяца).
 * Перед созданием заказа проверяем: анкета своя, автор дал согласие, подписка есть, автор ещё не куплен.
 */
billingApi.post('/reveal-checkout', rateLimit('checkout', 20, 60 * 60_000), async (req: Request, res: Response) => {
  if (!billingEnabled) {
    res.json({ status: 'unavailable' });
    return;
  }
  const { questionnaireId, respondentId } = req.body ?? {};
  const { rows } = await pool.query(
    `SELECT r.id, r.consent_reveal FROM responses r JOIN questionnaires q ON q.id = r.questionnaire_id
     WHERE r.id = $1 AND q.id = $2 AND q.owner_id = $3`,
    [String(respondentId ?? ''), String(questionnaireId ?? ''), req.user.id],
  );
  const response = rows[0];
  if (!response || !response.consent_reveal) {
    res.status(404).json({ code: 'not_found' });
    return;
  }
  const { plan } = await getPlan(req.user);
  if (!plan || plan === 'year') {
    res.status(409).json({ code: plan ? 'already_included' : 'premium_required' });
    return;
  }
  const bought = await pool.query('SELECT 1 FROM reveal_purchases WHERE owner_id = $1 AND response_id = $2', [req.user.id, response.id]);
  if (bought.rowCount) {
    res.json({ status: 'ok' });
    return;
  }
  const orderId = `R${newId(11)}`;
  await pool.query(
    "INSERT INTO orders (id, user_id, plan, amount, kind, response_id) VALUES ($1, $2, 'reveal', $3, 'reveal', $4)",
    [orderId, req.user.id, REVEAL_PRICE, response.id],
  );
  const receipt = cp.receipts
    ? {
        Items: [{ label: 'hush. Раскрытие автора ответа', price: REVEAL_PRICE, quantity: 1, amount: REVEAL_PRICE, vat: cp.vat, method: 4, object: 4 }],
        taxationSystem: cp.taxationSystem,
        amounts: { electronic: REVEAL_PRICE },
      }
    : undefined;
  res.json({
    status: 'widget',
    params: {
      publicId: cp.publicId,
      description: 'hush. Узнать, кто написал ответ',
      amount: REVEAL_PRICE,
      currency: 'RUB',
      invoiceId: orderId,
      accountId: String(req.user.id),
      skin: 'mini',
      requireEmail: cp.receipts,
      // Разовый платёж: без recurrent
      data: { kind: 'reveal', ...(receipt ? { CloudPayments: { CustomerReceipt: receipt } } : {}) },
    },
  });
});

/** Отмена автопродления — только через CloudPayments, состояние меняем после их ответа */
billingApi.post('/autorenew', rateLimit('autorenew', 20, 60 * 60_000), async (req: Request, res: Response) => {
  const enabled = req.body?.enabled === true;
  const { rows } = await pool.query(
    `SELECT subscription_id, auto_renew FROM entitlements
     WHERE user_id = $1 AND (renews_at IS NULL OR renews_at > now())`,
    [req.user.id],
  );
  const ent = rows[0];
  if (enabled) {
    // Возобновить отменённую подписку нельзя — только оформить новую
    res.json({ status: ent?.auto_renew ? 'ok' : 'resubscribe' });
    return;
  }
  if (!billingEnabled || !ent?.subscription_id) {
    res.json({ status: 'unavailable' });
    return;
  }
  try {
    await cpApi('subscriptions/cancel', { Id: ent.subscription_id });
    await pool.query('UPDATE entitlements SET auto_renew = FALSE, discount_next = FALSE, updated_at = now() WHERE user_id = $1', [req.user.id]);
    // Повторное оформление после отмены — по тройному тарифу
    await pool.query('UPDATE users SET cancelled_at = now() WHERE id = $1', [req.user.id]);
    res.json({ status: 'ok' });
  } catch (e) {
    console.error('[billing] отмена подписки не удалась:', (e as Error).message);
    res.status(502).json({ code: 'billing_error' });
  }
});

/**
 * Скидка удержания при попытке отменить подписку: −50% только на следующий платёж, один раз.
 * Меняем сумму подписки в CloudPayments; после этого списания сумма возвращается к обычной.
 */
billingApi.post('/retention-discount', rateLimit('autorenew', 20, 60 * 60_000), async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT subscription_id, base_amount, auto_renew, retention_used FROM entitlements
     WHERE user_id = $1 AND (renews_at IS NULL OR renews_at > now())`,
    [req.user.id],
  );
  const ent = rows[0];
  if (!billingEnabled || !ent?.subscription_id || !ent.base_amount || !ent.auto_renew || ent.retention_used) {
    res.json({ status: 'unavailable' });
    return;
  }
  const discounted = Math.round(Number(ent.base_amount) * RETENTION_DISCOUNT);
  try {
    await cpApi('subscriptions/update', { Id: ent.subscription_id, Amount: discounted, Currency: 'RUB' });
    await pool.query(
      'UPDATE entitlements SET discount_next = TRUE, retention_used = TRUE, updated_at = now() WHERE user_id = $1',
      [req.user.id],
    );
    console.log(`[billing] скидка удержания: user ${req.user.id}, следующий платёж ${discounted} ₽`);
    res.json({ status: 'ok' });
  } catch (e) {
    console.error('[billing] скидка удержания не применена:', (e as Error).message);
    res.status(502).json({ code: 'billing_error' });
  }
});

/** «Восстановить покупку»: заново читаем подписку из базы */
billingApi.post('/restore', async (req: Request, res: Response) => {
  const plan = await getPlan(req.user);
  res.json({ status: plan.plan ? 'ok' : 'none' });
});

/* ───────────────────────── Уведомления CloudPayments ───────────────────────── */

type Fields = Record<string, string>;

function hmac(body: string): Buffer {
  return createHmac('sha256', cp.apiSecret).update(body, 'utf8').digest();
}

function safeEqualB64(given: string | undefined, expected: Buffer): boolean {
  if (!given) return false;
  const buf = Buffer.from(given, 'base64');
  return buf.length === expected.length && timingSafeEqual(buf, expected);
}

/** Content-HMAC — от тела как есть, X-Content-HMAC — от url-декодированного тела */
function verify(req: Request, raw: string): boolean {
  if (!cp.apiSecret) return false;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    /* тело не url-encoded */
  }
  const candidates = [hmac(raw), hmac(decoded)];
  const headers = [req.get('content-hmac'), req.get('x-content-hmac')];
  return headers.some((h) => candidates.some((c) => safeEqualB64(h, c)));
}

function parse(req: Request, raw: string): Fields {
  if ((req.get('content-type') || '').includes('json')) {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

const sameAmount = (a: unknown, b: unknown) => Math.abs(Number(a) - Number(b)) < 0.01;

/** Обёртка: подпись → разбор → обработчик → { code } */
function hook(handler: (f: Fields) => Promise<number>) {
  return async (req: Request, res: Response) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!verify(req, raw)) {
      console.warn('[billing] уведомление с неверной подписью отклонено');
      res.status(401).json({ code: 13 });
      return;
    }
    try {
      res.json({ code: await handler(parse(req, raw)) });
    } catch (e) {
      console.error('[billing] ошибка обработки уведомления:', e);
      // Не 0 — CloudPayments повторит уведомление позже
      res.status(500).json({ code: 13 });
    }
  };
}

export const cloudPaymentsWebhooks = Router();
cloudPaymentsWebhooks.use(express.raw({ type: '*/*', limit: '200kb' }));

/** Check: перед списанием проверяем заказ, владельца и сумму */
cloudPaymentsWebhooks.post(
  '/check',
  hook(async (f) => {
    if (!f.InvoiceId) return f.SubscriptionId ? 0 : 10; // повторные списания подписки идут без заказа
    const { rows } = await pool.query('SELECT user_id, amount FROM orders WHERE id = $1', [f.InvoiceId]);
    const order = rows[0];
    if (!order) return 10;
    if (String(order.user_id) !== f.AccountId) return 11;
    if (!sameAmount(order.amount, f.Amount)) return 12;
    return 0;
  }),
);

/** Pay: успешная оплата — первая или очередное автосписание */
cloudPaymentsWebhooks.post(
  '/pay',
  hook(async (f) => {
    if (f.Status && f.Status !== 'Completed') return 0; // двухстадийные платежи не используем
    const transactionId = f.TransactionId;
    if (!transactionId) return 13;

    return tx(async (db) => {
      const seen = await db.query('SELECT 1 FROM payments WHERE transaction_id = $1', [transactionId]);
      if (seen.rowCount) return 0; // повтор уведомления

      let userId: string | undefined;
      let plan: Plan | undefined;
      let orderId: string | null = null;
      let restoreAmount: { subscriptionId: string; amount: number } | null = null;
      if (f.InvoiceId) {
        const { rows } = await db.query('SELECT id, user_id, plan, amount, kind, response_id FROM orders WHERE id = $1 FOR UPDATE', [f.InvoiceId]);
        const order = rows[0];
        if (!order || String(order.user_id) !== f.AccountId || !sameAmount(order.amount, f.Amount)) {
          console.error('[billing] Pay не совпадает с заказом', f.InvoiceId, f.AccountId, f.Amount);
          return 0; // не просим повторять: данные не изменятся
        }
        if (order.kind === 'reveal') {
          // Разовое раскрытие: подписку не трогаем
          await db.query("UPDATE orders SET status = 'paid', paid_at = now() WHERE id = $1", [order.id]);
          await db.query(
            `INSERT INTO payments (transaction_id, user_id, order_id, plan, amount, test_mode, raw)
             VALUES ($1, $2, $3, 'reveal', $4, $5, $6)`,
            [transactionId, order.user_id, order.id, Number(f.Amount), f.TestMode === '1' || f.TestMode === 'true', JSON.stringify(f)],
          );
          await db.query(
            'INSERT INTO reveal_purchases (owner_id, response_id, order_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [order.user_id, order.response_id, order.id],
          );
          console.log(`[billing] раскрытие автора оплачено: user ${order.user_id}, ${f.Amount} ₽`);
          return 0;
        }
        userId = String(order.user_id);
        plan = order.plan;
        orderId = order.id;
        await db.query("UPDATE orders SET status = 'paid', paid_at = now() WHERE id = $1", [order.id]);
      } else if (f.SubscriptionId) {
        const { rows } = await db.query('SELECT user_id, plan, discount_next, base_amount FROM entitlements WHERE subscription_id = $1', [
          f.SubscriptionId,
        ]);
        if (!rows[0]) {
          console.error('[billing] автосписание по неизвестной подписке', f.SubscriptionId);
          return 0;
        }
        userId = String(rows[0].user_id);
        plan = rows[0].plan;
        // Это был платёж со скидкой удержания — дальше снова обычная цена
        if (rows[0].discount_next && rows[0].base_amount) {
          restoreAmount = { subscriptionId: f.SubscriptionId, amount: Number(rows[0].base_amount) };
          await db.query('UPDATE entitlements SET discount_next = FALSE WHERE subscription_id = $1', [f.SubscriptionId]);
        } else if (rows[0].base_amount && Number(f.Amount) < Number(rows[0].base_amount) - 0.01) {
          // Страховка: прошлый возврат суммы не удался — пробуем снова
          restoreAmount = { subscriptionId: f.SubscriptionId, amount: Number(rows[0].base_amount) };
        }
      }
      if (!userId || !plan || !isPlan(plan)) return 0;

      await db.query(
        `INSERT INTO payments (transaction_id, user_id, order_id, subscription_id, plan, amount, test_mode, raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [transactionId, userId, orderId, f.SubscriptionId || null, plan, Number(f.Amount), f.TestMode === '1' || f.TestMode === 'true', JSON.stringify(f)],
      );
      // Продлеваем от конца текущего периода (или от сегодня, если подписки нет)
      await db.query(
        `INSERT INTO entitlements (user_id, plan, auto_renew, renews_at, source, subscription_id, base_amount)
         VALUES ($1, $2, $3, now() + make_interval(months => $4), 'cloudpayments', $5, $6)
         ON CONFLICT (user_id) DO UPDATE SET
           plan = EXCLUDED.plan,
           auto_renew = EXCLUDED.auto_renew,
           renews_at = GREATEST(COALESCE(entitlements.renews_at, now()), now()) + make_interval(months => $4),
           source = 'cloudpayments',
           subscription_id = COALESCE(EXCLUDED.subscription_id, entitlements.subscription_id),
           base_amount = COALESCE(EXCLUDED.base_amount, entitlements.base_amount),
           updated_at = now()`,
        // base_amount — сумма первого платежа по заказу (обычная цена этой подписки)
        [userId, plan, Boolean(f.SubscriptionId), PLANS[plan].months, f.SubscriptionId || null, orderId ? Number(f.Amount) : null],
      );
      if (restoreAmount) {
        const { subscriptionId, amount } = restoreAmount;
        // После коммита: вернуть обычную сумму следующих списаний
        setImmediate(() => {
          cpApi('subscriptions/update', { Id: subscriptionId, Amount: amount, Currency: 'RUB' })
            .then(() => console.log(`[billing] подписка ${subscriptionId}: сумма возвращена к ${amount} ₽`))
            .catch((e) => console.error(`[billing] НЕ удалось вернуть сумму подписки ${subscriptionId} к ${amount} ₽:`, e.message));
        });
      }
      console.log(`[billing] оплачено: user ${userId}, ${plan}, ${f.Amount} ₽${f.TestMode === '1' ? ' (тест)' : ''}`);
      return 0;
    });
  }),
);

/** Fail: оплата не прошла — доступ не меняем */
cloudPaymentsWebhooks.post(
  '/fail',
  hook(async (f) => {
    if (f.InvoiceId) await pool.query("UPDATE orders SET status = 'failed' WHERE id = $1 AND status = 'pending'", [f.InvoiceId]);
    console.warn(`[billing] оплата не прошла: ${f.InvoiceId || f.SubscriptionId} — ${f.Reason || f.ReasonCode || ''}`);
    return 0;
  }),
);

/** Recurrent: изменение статуса подписки (отмена, просрочка и т. п.) */
cloudPaymentsWebhooks.post(
  '/recurrent',
  hook(async (f) => {
    if (!f.Id) return 0;
    const active = f.Status === 'Active' || f.Status === 'PastDue';
    const updated = await pool.query('UPDATE entitlements SET auto_renew = $1, updated_at = now() WHERE subscription_id = $2', [
      active,
      f.Id,
    ]);
    // Если Pay пришёл без SubscriptionId — привязываем подписку к пользователю по AccountId
    if (!updated.rowCount && f.AccountId && /^\d+$/.test(f.AccountId)) {
      await pool.query(
        `UPDATE entitlements SET subscription_id = $1, auto_renew = $2, updated_at = now()
         WHERE user_id = $3 AND subscription_id IS NULL AND source = 'cloudpayments'`,
        [f.Id, active, f.AccountId],
      );
    }
    console.log(`[billing] подписка ${f.Id}: ${f.Status}`);
    return 0;
  }),
);
