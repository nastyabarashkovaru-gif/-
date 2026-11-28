import { coverage, fromDbDate, humanDate } from '@thirty/domain';
import type { Payment, PaymentAccessDeliveryStatus, Subscription } from '@prisma/client';
import { clock } from '../clock';
import { config } from '../config';
import { prisma } from '../db';
import { badRequest, notFound } from '../http';
import { TelegramError } from '../lib/telegram';
import { monthName } from './billing';
import { accessibleChats, inviteLinkFor } from './chats';
import { notify } from './notify';

const MINUTE = 60_000;
const RETRY_MINUTES = [1, 3, 10, 30, 120];
const CLAIM_MINUTES = 5;

type AccessPayment = Payment & { subscription: Subscription | null };

function isEligible(payment: AccessPayment): payment is AccessPayment & { subscription: Subscription; tariffId: string } {
  return payment.kind === 'initial' && payment.status === 'paid' && !payment.needsRefund &&
    Boolean(payment.tariffId && payment.subscription && payment.subscription.status !== 'expired');
}

/** Historical paid orders can be queued on request. A scheduled or delivered order stays idempotent. */
export async function requestPaymentAccessDelivery(paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: { subscription: true } });
  if (!payment) throw notFound();
  if (config.DEMO_MODE || !isEligible(payment)) {
    throw badRequest('payment_access_unavailable', 'Приглашение можно отправить по подтверждённой первой оплате с действующим доступом');
  }
  const now = clock.now();
  await prisma.paymentAccessDelivery.upsert({
    where: { paymentId },
    create: { paymentId, nextAttemptAt: now },
    update: {},
  });
  await prisma.paymentAccessDelivery.updateMany({
    where: { paymentId, OR: [{ status: 'failed' }, { status: 'pending', lastError: { not: null } }] },
    data: { status: 'pending', nextAttemptAt: now, lastError: null },
  });
  return prisma.paymentAccessDelivery.findUniqueOrThrow({ where: { paymentId } });
}

class DeliveryError extends Error {}

async function sendPaymentAccess(payment: AccessPayment, attempt: number): Promise<PaymentAccessDeliveryStatus> {
  if (!isEligible(payment)) return 'canceled';

  const keyPrefix = `payment_access:${payment.id}:`;
  const sent = await prisma.botMessageLog.findFirst({
    where: { userId: payment.userId, dedupeKey: { startsWith: keyPrefix }, status: 'sent' },
    select: { id: true },
  });
  if (sent) return 'sent';

  let invite: Awaited<ReturnType<typeof inviteLinkFor>> | undefined;
  if (!config.TRIBUTE_VERIFIED_ACCESS) {
    const chat = (await accessibleChats(payment.userId)).find((entry) => entry.kind === 'flow');
    if (!chat) throw new DeliveryError('Общий чат клуба не привязан');
    invite = await inviteLinkFor(payment.userId, chat.id);
    if (!invite.joined && !invite.url) throw new DeliveryError('Telegram не вернул действительное приглашение');
  }

  const tariff = await prisma.tariff.findUniqueOrThrow({ where: { id: payment.tariffId } });
  const sub = payment.subscription;
  const result = await notify(payment.userId, 'payment_success', {
    tariff: tariff.title,
    flows: coverage(fromDbDate(payment.coversFromFlow ?? sub.paidFromFlow), payment.months ?? tariff.months).map(monthName).join(', '),
    next_date: sub.nextChargeDate ? humanDate(fromDbDate(sub.nextChargeDate), true) : '—',
    next_amount: payment.amount,
    chat_url: invite?.url ?? '',
  }, `${keyPrefix}${attempt}`);
  if (invite?.joined) return 'joined';
  if (result !== 'sent') throw new DeliveryError(result === 'skipped' ? 'Бот не может отправить сообщение или шаблон отключён' : 'Бот не отправил сообщение');
  return 'sent';
}

/** An atomic claim can expire after a restart. The attempt number protects against stale workers. */
export async function deliverPaymentAccess() {
  if (config.DEMO_MODE) return;
  const due = await prisma.paymentAccessDelivery.findMany({
    where: { status: { in: ['pending', 'sending'] }, nextAttemptAt: { lte: clock.now() } },
    orderBy: { nextAttemptAt: 'asc' },
    take: 10,
  });
  for (const delivery of due) {
    const attempt = delivery.attempts + 1;
    const claim = await prisma.paymentAccessDelivery.updateMany({
      where: { paymentId: delivery.paymentId, status: delivery.status, attempts: delivery.attempts, nextAttemptAt: { lte: clock.now() } },
      data: { status: 'sending', attempts: attempt, nextAttemptAt: new Date(clock.now().getTime() + CLAIM_MINUTES * MINUTE) },
    });
    if (!claim.count) continue;
    const where = { paymentId: delivery.paymentId, status: 'sending' as const, attempts: attempt };
    let status: PaymentAccessDeliveryStatus;
    let lastError: string | null = null;
    let nextAttemptAt = clock.now();
    try {
      const payment = await prisma.payment.findUniqueOrThrow({
        where: { id: delivery.paymentId },
        include: { subscription: true },
      });
      status = await sendPaymentAccess(payment, attempt);
    } catch (error) {
      const retryIn = RETRY_MINUTES[attempt - 1];
      status = retryIn ? 'pending' : 'failed';
      if (retryIn) nextAttemptAt = new Date(clock.now().getTime() + retryIn * MINUTE);
      lastError = error instanceof DeliveryError ? error.message :
        error instanceof TelegramError ? `Telegram ${error.method}: ${error.code} ${error.description}`.slice(0, 240) : 'Временная ошибка обработки приглашения';
      console.warn('[payment-access]', lastError);
    }
    await prisma.paymentAccessDelivery.updateMany({ where, data: { status, nextAttemptAt, lastError } });
  }
}
