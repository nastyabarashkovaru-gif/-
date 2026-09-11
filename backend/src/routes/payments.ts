import { Router } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import db from '../db';
import { requireTelegramAuth } from '../auth/telegramAuth';
import { PaymentRow, UserRow } from '../types';

const router = Router();

const PRODAMUS_SHOP_URL = process.env.PRODAMUS_SHOP_URL || '';
const PRODAMUS_SECRET_KEY = process.env.PRODAMUS_SECRET_KEY || '';

/**
 * ВАЖНО: точные названия полей и алгоритм подписи нужно свериться с личным кабинетом
 * Продамуса (Магазин → Настройки → API) — у разных тарифов/версий API они могут отличаться.
 * Здесь реализована стандартная схема подписи Продамуса (HMAC SHA256 по отсортированным
 * параметрам). Перед продакшеном протестируйте связку на тестовом платеже.
 */
function signParams(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHmac('sha256', secret).update(sorted).digest('hex');
}

function buildProdamusLink(orderId: string, amount: number, description: string): string {
  const params: Record<string, string> = {
    do: 'link',
    order_id: orderId,
    'products[0][price]': String(amount),
    'products[0][quantity]': '1',
    'products[0][name]': description,
  };
  const signature = signParams(params, PRODAMUS_SECRET_KEY);
  const query = new URLSearchParams({ ...params, signature }).toString();
  return `${PRODAMUS_SHOP_URL}/?${query}`;
}

// Создать ссылку на оплату "цены слова" в общий фонд (если участник не дошёл до конца)
router.post('/word-price/create-link', requireTelegramAuth, (req, res) => {
  const tg = req.tgUser!;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(tg.id) as UserRow | undefined;
  if (!user) return res.status(404).json({ error: 'not_found' });
  if (!user.price_of_word) return res.status(400).json({ error: 'no_price_of_word' });

  if (!PRODAMUS_SHOP_URL || !PRODAMUS_SECRET_KEY) {
    return res.status(503).json({ error: 'prodamus_not_configured' });
  }

  const orderId = `wp_${user.id}_${uuidv4().slice(0, 8)}`;
  const link = buildProdamusLink(orderId, user.price_of_word, `Цена слова — 100 дней спорта`);

  db.prepare(
    `INSERT INTO payments (user_id, amount, kind, status, prodamus_link, prodamus_order_id) VALUES (?, ?, 'word_price', 'pending', ?, ?)`
  ).run(user.id, user.price_of_word, link, orderId);

  res.json({ link, orderId });
});

// Мои платежи
router.get('/mine', requireTelegramAuth, (req, res) => {
  const tg = req.tgUser!;
  const rows = db
    .prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC')
    .all(tg.id) as PaymentRow[];
  res.json(rows);
});

// Вебхук Продамуса об успешной оплате
router.post('/webhook/prodamus', (req, res) => {
  const body = req.body as Record<string, any>;
  const orderId = body.order_id || body.order_num;
  const paymentStatus = body.payment_status || body.status;

  if (!orderId) return res.status(400).json({ error: 'missing_order_id' });

  // Опциональная проверка подписи, если Продамус присылает её в вебхуке
  const incomingSignature = req.header('Sign') || body.signature;
  if (incomingSignature && PRODAMUS_SECRET_KEY) {
    const { signature, ...rest } = body;
    const stringified: Record<string, string> = {};
    Object.keys(rest).forEach((k) => (stringified[k] = String(rest[k])));
    const expected = signParams(stringified, PRODAMUS_SECRET_KEY);
    if (expected !== incomingSignature) {
      return res.status(401).json({ error: 'invalid_signature' });
    }
  }

  const isSuccess = ['success', 'paid', 'completed'].includes(String(paymentStatus).toLowerCase());
  if (isSuccess) {
    db.prepare(
      `UPDATE payments SET status = 'paid', paid_at = datetime('now') WHERE prodamus_order_id = ?`
    ).run(orderId);
  }

  res.json({ ok: true });
});

export default router;
