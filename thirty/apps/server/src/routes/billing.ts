import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/telegram';
import { config, isProd } from '../config';
import { prisma } from '../db';
import { forbidden, jsonSafe, notFound } from '../http';
import { parse } from '../lib/validate';
import { paymentProvider } from '../payments';
import { signMock } from '../payments/mock';
import { getSetting } from '../settings';
import { track } from '../modules/analytics';
import {
  cancelAutoRenew, checkoutPreview, createCheckout, createDebtPayment, handleWebhook, offerState, resumeAutoRenew, startOffer, subscriptionSummary,
} from '../modules/billing';

export async function billingRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook('preHandler', requireUser);

    /** Тарифы и состояние персонального таймера (S06) */
    r.get('/api/offer', async (req) => jsonSafe(await offerState(req.user!.id)));

    /** Первый показ тарифов запускает таймер на сервере (один раз) */
    r.post('/api/offer/start', async (req) => {
      await startOffer(req.user!.id);
      return jsonSafe(await offerState(req.user!.id));
    });

    /** Ценность до тарифов (S05) — только включённые админом позиции */
    r.get('/api/public/value', async () => {
      const items = (await getSetting('value.items')).filter((i) => i.enabled);
      return { items, total: items.reduce((a, i) => a + i.price, 0) };
    });

    r.get('/api/public/rules', async () => ({ prizeRules: await getSetting('prize.rulesText'), cases: await getSetting('cases') }));

    r.get<{ Querystring: { tariff: string } }>('/api/checkout/preview', async (req) => jsonSafe(await checkoutPreview(req.user!.id, String(req.query.tariff ?? ''))));

    r.post('/api/checkout', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
      const body = parse(z.object({ tariffId: z.enum(['m1', 'm3', 'm6']), idempotencyKey: z.string().min(8).max(64) }), req.body);
      return createCheckout(req.user!.id, body.tariffId, body.idempotencyKey);
    });

    /** Статус платежа для экрана ожидания S09/S10 (источник истины — webhook) */
    r.get<{ Params: { id: string } }>('/api/payments/:id', async (req) => {
      const p = await prisma.payment.findUnique({ where: { id: req.params.id } });
      if (!p || p.userId !== req.user!.id) throw notFound();
      const pendingWindow = await getSetting('payment.pendingWindowMinutes');
      const waitedMin = (Date.now() - p.createdAt.getTime()) / 60_000;
      return { id: p.id, status: p.status, amount: p.amount, needsRefund: p.needsRefund, waitingTooLong: p.status === 'pending' && waitedMin > pendingWindow };
    });

    r.get('/api/subscription', async (req) => jsonSafe(await subscriptionSummary(req.user!.id)));

    r.post('/api/subscription/cancel', async (req) => {
      const body = parse(z.object({ reason: z.string().max(500).optional() }), req.body ?? {});
      return cancelAutoRenew(req.user!.id, body.reason);
    });
    r.post('/api/subscription/resume', async (req) => resumeAutoRenew(req.user!.id));
    r.post('/api/subscription/pay-debt', async (req) => createDebtPayment(req.user!.id));

    /** Шаги удержания S36–S38 — только аналитика, отмену они не блокируют */
    r.post('/api/subscription/cancel-step', async (req) => {
      const { step } = parse(z.object({ step: z.number().int().min(1).max(3) }), req.body);
      const sub = await prisma.subscription.findFirst({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } });
      if (step === 1) await track({ userId: req.user!.id, eventName: 'cancel_started', screenId: 'S36', tariffId: sub?.tariffId });
      await track({ userId: req.user!.id, eventName: 'cancel_step_view', screenId: `S3${5 + step}`, tariffId: sub?.tariffId, metadata: { step } });
      return { ok: true };
    });
  });

  /** Webhook Prodamus: подпись в заголовке Sign. Ответ 200 даже на дубликат — иначе провайдер будет повторять. */
  app.post('/api/payments/prodamus/webhook', async (req, reply) => {
    if (paymentProvider().name !== 'prodamus') throw forbidden('provider_disabled');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = typeof body.__raw === 'string' ? body.__raw : JSON.stringify(body);
    const parsed = paymentProvider().parseWebhook(req.headers, body);
    const result = await handleWebhook(parsed, raw);
    if ((result as { rejected?: string }).rejected) return reply.status(400).send({ ok: false });
    return reply.send('success');
  });

  if (!isProd || config.PAYMENT_PROVIDER === 'mock') {
    /** Sandbox-форма оплаты: никаких реальных денег, только имитация уведомлений провайдера */
    app.get<{ Params: { id: string } }>('/api/payments/mock/:id', async (req, reply) => {
      const p = await prisma.payment.findUnique({ where: { id: req.params.id } });
      if (!p) throw notFound();
      const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Тестовая оплата</title><body style="font-family:-apple-system,Roboto,sans-serif;background:#FFF9F2;color:#20211F;padding:24px">
<h2>Тестовая оплата (sandbox)</h2><p>Сумма: <b>${p.amount} ₽</b>. Деньги не списываются.</p>
<form method="post" action="/api/payments/mock/${p.id}/success"><button style="background:#FF6B35;color:#fff;border:0;border-radius:14px;padding:14px 20px;font-size:17px;width:100%">Оплатить</button></form><br>
<form method="post" action="/api/payments/mock/${p.id}/fail"><button style="background:#eee;border:0;border-radius:14px;padding:14px 20px;font-size:17px;width:100%">Отказ банка</button></form></body>`;
      return reply.type('text/html').send(html);
    });

    app.post<{ Params: { id: string; result: string } }>('/api/payments/mock/:id/:result', async (req, reply) => {
      if (paymentProvider().name !== 'mock') throw forbidden('provider_disabled');
      const p = await prisma.payment.findUnique({ where: { id: req.params.id } });
      if (!p) throw notFound();
      const data: Record<string, unknown> = {
        order_num: p.id,
        order_id: `mock-${p.id}`,
        sum: `${p.amount}.00`,
        payment_status: req.params.result === 'success' ? 'success' : 'order_denied',
        customer_phone: '+70000000000',
        customer_extra: `tg:${p.userId}`,
        subscription_id: `mock-sub-${p.userId}`,
      };
      const parsed = paymentProvider().parseWebhook({ sign: signMock(data) }, data);
      await handleWebhook(parsed, JSON.stringify(data));
      return reply.type('text/html').send(`<meta charset="utf-8"><body style="font-family:sans-serif;padding:24px;background:#FFF9F2">${req.params.result === 'success' ? '✅ Оплачено (sandbox). Вернитесь в Telegram.' : '❌ Платёж отклонён (sandbox).'}</body>`);
    });
  }
}
