import { clock } from '../clock';
import { prisma } from '../db';
import { priceVars } from '../jobs/chains';
import { sendTemplate } from './bot';

/**
 * Временный режим проверки дожимной цепочки (переменная CHAIN_TEST).
 * CHAIN_TEST=admins — подписчики админ-бота (владелец), или список Telegram id через запятую.
 * Для них /start сбрасывает покупку («будто не купила») и присылает сообщения 02–11 подряд с паузой CHAIN_TEST_STEP_SEC (по умолчанию 3 с).
 * Убрать переменную — и всё работает как обычно.
 */
const STAGES = ['chain_02', 'chain_03', 'chain_04', 'chain_05', 'chain_06', 'chain_07', 'chain_08', 'chain_09', 'chain_10', 'chain_11'];

export async function chainTestUsers(): Promise<Set<string>> {
  const v = (process.env.CHAIN_TEST ?? '').trim();
  if (!v) return new Set();
  if (v === 'admins') {
    const row = await prisma.setting.findUnique({ where: { key: 'adminBot.chats' } });
    return new Set(((row?.value as number[] | undefined) ?? []).filter((id) => id > 0).map(String));
  }
  return new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
}

export async function isChainTestUser(userId: bigint) {
  return (await chainTestUsers()).has(userId.toString());
}

/** «Будто не купила»: покупки и анкета снимаются, таймер скидки и промокоды обнуляются */
export async function resetAsNonBuyer(userId: bigint) {
  await prisma.$transaction([
    prisma.flowMembership.updateMany({ where: { userId, status: { not: 'revoked' } }, data: { status: 'revoked' } }),
    prisma.subscription.updateMany({ where: { userId, status: { not: 'expired' } }, data: { status: 'expired', autoRenew: false } }),
    prisma.payment.updateMany({ where: { userId, status: 'paid' }, data: { status: 'refunded' } }),
    prisma.priceOffer.deleteMany({ where: { userId } }),
    prisma.promoRedemption.deleteMany({ where: { userId } }),
    prisma.storyRequest.deleteMany({ where: { userId } }),
    prisma.botMessageLog.deleteMany({ where: { userId, OR: [{ templateKey: 'welcome' }, { templateKey: { startsWith: 'chain_' } }] } }),
    prisma.user.update({ where: { id: userId }, data: { onboardingStage: 'new', lastScreen: null, marketingOptIn: true } }),
  ]);
  console.log(`[chain-test] ${userId}: покупка сброшена`);
}

/** Все сообщения цепочки подряд с короткой паузой (в фоне, после приветствия) */
const running = new Set<string>();

export function runChainTest(userId: bigint) {
  // Повторный /start, пока цепочка ещё идёт, не запускает вторую
  if (running.has(userId.toString())) return;
  running.add(userId.toString());
  const step = Math.max(1, Number(process.env.CHAIN_TEST_STEP_SEC ?? 3)) * 1000;
  void (async () => {
    const vars = await priceVars();
    for (const key of STAGES) {
      await new Promise((r) => setTimeout(r, step));
      const res = await sendTemplate(userId, key, vars, `test:${key}:${userId}:${clock.now().getTime()}`).catch(() => 'failed');
      console.log(`[chain-test] ${userId} ${key}: ${res}`);
    }
  })().finally(() => running.delete(userId.toString()));
}
