import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/telegram';
import { clock } from '../clock';
import { config, isProd } from '../config';
import { prisma } from '../db';
import { forbidden, jsonSafe, notFound } from '../http';
import { parse } from '../lib/validate';
import { paymentProvider } from '../payments';
import { signMock } from '../payments/mock';
import { getSetting } from '../settings';
import { track } from '../modules/analytics';
import {
  appUrl, cancelAutoRenew, checkoutPreview, createCheckout, createDebtPayment, handleWebhook, offerState, resumeAutoRenew, startOffer, subscriptionSummary,
} from '../modules/billing';

import { offerDoc, privacyDoc } from '../legal/docs';
import { CloudPaymentsProvider, cpVerify, payPageSig, type CpKind } from '../payments/cloudpayments';
import { chargeDateFor, coverage, fromDbDate, planRenewal } from '@thirty/domain';
import { applyPromo } from '../modules/promos';
import { myStoryRequest, storyInput, submitStoryRequest } from '../modules/stories';
import { renderStoryCardPng } from '../modules/cards';

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

    // Промокоды: проверка и применение только на сервере
    r.post('/api/promo/apply', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
      const { code } = parse(z.object({ code: z.string().max(40) }), req.body);
      return applyPromo(req.user!.id, code);
    });

    // «Вернуть скидку»: заявка на проверку сторис
    r.get('/api/story-requests/mine', async (req) => myStoryRequest(req.user!.id));
    r.post('/api/story-requests', async (req) => submitStoryRequest(req.user!.id, parse(storyInput, req.body)));
    r.get('/api/story-card', async () => ({ account: await getSetting('instagram.account'), imageUrl: `${config.PUBLIC_URL.replace(/\/$/, '')}/api/public/story-card.png` }));

    r.get('/api/public/materials', async () => ({ items: await getSetting('materials') }));
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
      const { step, reason } = parse(z.object({ step: z.number().int().min(1).max(4), reason: z.string().max(100).optional() }), req.body);
      const sub = await prisma.subscription.findFirst({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } });
      if (step === 1) await track({ userId: req.user!.id, eventName: 'cancel_started', screenId: 'S36', tariffId: sub?.tariffId });
      await track({ userId: req.user!.id, eventName: 'cancel_step_view', screenId: `S3${5 + step}`, tariffId: sub?.tariffId, metadata: { step, ...(reason ? { reason } : {}) } });
      return { ok: true };
    });
  });

  /** Карточка для сторис (PNG 1080×1920) */
  app.get('/api/public/story-card.png', async (_req, reply) => {
    const png = renderStoryCardPng(await getSetting('instagram.account'));
    return reply.header('content-type', 'image/png').header('cache-control', 'public, max-age=600').header('content-disposition', 'inline; filename="30-dney-story.png"').send(png);
  });

  /** Документы: оферта и политика ПДн (открыты без авторизации) */
  app.get<{ Params: { kind: string } }>('/api/public/docs/:kind', async (req) => {
    if (req.params.kind !== 'offer' && req.params.kind !== 'privacy') throw notFound();
    const support = `@${await getSetting('support.username')}`;
    const text = (req.params.kind === 'offer' ? offerDoc : privacyDoc).replaceAll('{{sellerGenitive}}', await getSetting('legal.sellerGenitive')).replaceAll('{{seller}}', await getSetting('legal.seller')).replaceAll('{{requisites}}', await getSetting('legal.requisites')).replaceAll('{{support}}', support);
    return { text };
  });

  /** Webhook Prodamus: подпись в заголовке Sign. Ответ 200 даже на дубликат — иначе провайдер будет повторять. */
  app.post('/api/payments/prodamus/webhook', async (req, reply) => {
    if (paymentProvider().name !== 'prodamus') throw forbidden('provider_disabled');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = typeof body.__raw === 'string' ? body.__raw : JSON.stringify(body);
    const parsed = paymentProvider().parseWebhook(req.headers, body);
    // Диагностика без персональных данных: какие поля прислал провайдер
    const sub = (body as { subscription?: Record<string, unknown> }).subscription;
    console.log(`[prodamus] kind=${parsed.kind} status=${parsed.status} valid=${parsed.valid} order_num=${parsed.paymentId ? 'yes' : 'no'} sub=${parsed.providerSubscriptionId ?? '-'} keys=${Object.keys(body).filter((k) => k !== '__raw').join(',')}${sub && typeof sub === 'object' ? ` subKeys=${Object.keys(sub).join(',')}` : ''}`);
    const result = await handleWebhook(parsed, raw);
    if ((result as { rejected?: string }).rejected) return reply.status(400).send({ ok: false });
    return reply.send('success');
  });

  /**
   * CloudPayments: уведомления Check / Pay / Fail / Recurrent / Refund. Ответ {"code":0}; на Check отказываем,
   * если сумма или заказ не совпадают. Тело — application/x-www-form-urlencoded (настройка по умолчанию), подпись Content-HMAC.
   */
  app.post<{ Params: { kind: string } }>('/api/payments/cloudpayments/:kind', async (req, reply) => {
    const kind = req.params.kind as CpKind;
    if (!['check', 'pay', 'fail', 'recurrent', 'refund'].includes(kind)) throw notFound();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const raw = typeof body.__raw === 'string' ? body.__raw : JSON.stringify(body);
    if (!cpVerify(raw, req.headers)) {
      console.warn(`[cloudpayments] ${kind}: неверная подпись`);
      return reply.status(401).send({ code: 13 });
    }
    if (kind === 'check') return reply.send({ code: await cpCheck(body) });
    const parsed = paymentProvider().name === 'cloudpayments' ? paymentProvider().parseWebhook(req.headers, { ...body, __kind: kind }) : new CloudPaymentsProvider().parseWebhook(req.headers, { ...body, __kind: kind });
    console.log(`[cloudpayments] ${kind} kind=${parsed.kind} status=${parsed.status} invoice=${parsed.paymentId ? 'yes' : 'no'} sub=${parsed.providerSubscriptionId ?? '-'} test=${String(body.TestMode ?? '-')}`);
    await handleWebhook(parsed, `${kind}:${raw}`);
    return reply.send({ code: 0 });
  });

  /** Страница оплаты CloudPayments: виджет с суммой и подпиской из нашей базы (не из ссылки) */
  app.get<{ Params: { id: string }; Querystring: { e?: string; s?: string } }>('/pay/:id', async (req, reply) => {
    const exp = Number(req.query.e ?? 0);
    const page = (body: string) => reply.header('content-type', 'text/html; charset=utf-8').send(payPageHtml(body));
    if (!req.query.s || req.query.s !== payPageSig(req.params.id, exp)) return page('<h2>Ссылка недействительна</h2><p>Вернись в приложение и нажми «Оплатить» ещё раз.</p>');
    const p = await prisma.payment.findUnique({ where: { id: req.params.id }, include: { subscription: { include: { tariff: true } } } });
    const tariff = p?.tariffId ? await prisma.tariff.findUnique({ where: { id: p.tariffId } }) : null;
    if (!p) return page('<h2>Платёж не найден</h2>');
    const back = appUrl(`pay_${p.id}`);
    if (p.status === 'paid') return page(`<h2>Оплата уже прошла ✅</h2><a class="btn" href="${back}">Вернуться в приложение</a>`);
    if (clock.now().getTime() / 1000 > exp) return page('<h2>Ссылка устарела</h2><p>Специальная цена или срок ссылки закончились. Вернись в приложение и открой оплату заново.</p><a class="btn" href="' + back + '">Вернуться в приложение</a>');
    // Подписка: первое автосписание 28-го числа последнего оплаченного месяца, по цене покупки
    let recurrent: { interval: string; period: number; amount: number; startDate: string } | null = null;
    if (p.kind === 'initial' && p.coversFromFlow && p.months) {
      const flows = coverage(fromDbDate(p.coversFromFlow), p.months);
      recurrent = { interval: 'Month', period: p.months, amount: p.amount, startDate: `${chargeDateFor(flows[flows.length - 1])}T09:00:00` };
    } else if (p.kind === 'debt' && p.subscription) {
      const plan = planRenewal(fromDbDate(p.subscription.paidThroughFlow), p.subscription.tariff.months);
      recurrent = { interval: 'Month', period: p.subscription.tariff.months, amount: p.subscription.renewalPrice, startDate: `${plan.nextChargeDate}T09:00:00` };
    }
    const title = tariff ? `«30 дней» — тариф «${tariff.title}»` : '«30 дней»';
    const params = {
      publicId: config.CP_PUBLIC_ID,
      description: title,
      amount: p.amount,
      currency: 'RUB',
      invoiceId: p.id,
      accountId: p.userId.toString(),
      skin: 'mini',
      data: recurrent ? { CloudPayments: { recurrent } } : {},
    };
    return page(`
<h2>${esc(title)}</h2>
<p class="sum">${p.amount.toLocaleString('ru-RU')} ₽</p>
${recurrent ? `<p class="muted">Автопродление: ${recurrent.startDate.slice(8, 10)}.${recurrent.startDate.slice(5, 7)}.${recurrent.startDate.slice(0, 4)} спишем ${Number(recurrent.amount).toLocaleString('ru-RU')} ₽ за следующие ${recurrent.period} мес. Отключить — через поддержку.</p>` : ''}
<button class="btn" id="pay">Оплатить картой</button>
<p class="muted" id="msg"></p>
<a class="link" href="${back}">Вернуться в приложение</a>
<script src="https://widget.cloudpayments.ru/bundles/cloudpayments.js"></script>
<script>
var params = ${JSON.stringify(params).replace(/</g, '\\u003c')};
function pay() {
  var w = new cp.CloudPayments({ language: 'ru-RU' });
  w.pay('charge', params, {
    onSuccess: function () { document.getElementById('msg').textContent = 'Оплата прошла! Возвращаем в приложение…'; location.href = ${JSON.stringify(back)}; },
    onFail: function (reason) { document.getElementById('msg').textContent = 'Оплата не прошла' + (reason ? ': ' + reason : '') + '. Можно попробовать ещё раз.'; },
  });
}
document.getElementById('pay').onclick = pay;
window.addEventListener('load', pay);
</script>`);
  });

  if (config.PAYMENT_PROVIDER === 'mock' && (!isProd || config.ALLOW_SANDBOX_PAYMENTS)) {
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

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function payPageHtml(body: string) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Оплата — 30 дней</title>
<style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F8F8FD;color:#211C35}
main{max-width:440px;margin:0 auto;padding:28px 20px;display:flex;flex-direction:column;gap:14px;text-align:center}
.logo{display:inline-flex;gap:8px;align-items:center;justify-content:center;font-weight:600}.logo b{background:#7150E7;color:#fff;border-radius:9px;padding:4px 8px}
h2{margin:8px 0 0;font-size:22px}.sum{font-size:34px;font-weight:700;margin:0;color:#6C51DF}.muted{color:#77718C;font-size:14px;margin:0}
.btn{display:block;background:#6C51DF;color:#fff;border:0;border-radius:16px;padding:16px;font-size:17px;font-weight:600;text-decoration:none;cursor:pointer}
.link{color:#77718C;font-size:14px}</style></head><body><main><div class="logo"><b>30</b>дней</div>${body}</main></body></html>`;
}

/** Check: разрешаем оплату только своего заказа, на ту же сумму, пока он не оплачен и цена ещё действует */
async function cpCheck(body: Record<string, unknown>): Promise<number> {
  const id = String(body.InvoiceId ?? '');
  if (!id) return Number(body.SubscriptionId ? 0 : 10);
  const p = await prisma.payment.findUnique({ where: { id } }).catch(() => null);
  if (!p) return 10;
  if (String(body.AccountId ?? '') !== p.userId.toString()) return 11;
  if (Math.round(Number(body.Amount)) !== p.amount) return 12;
  if (p.status === 'paid') return 13;
  if (p.priceVariant === 'promo' && p.kind === 'initial') {
    const offer = await prisma.priceOffer.findFirst({ where: { userId: p.userId, consumedAt: null, expiresAt: { gt: new Date(clock.now().getTime() - 15 * 60_000) } } });
    if (!offer) return 13;
  }
  return 0;
}
