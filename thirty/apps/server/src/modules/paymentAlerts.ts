import { localDate, startOfLocalDay } from '@thirty/domain';
import { clock } from '../clock';
import { prisma } from '../db';
import { getSetting } from '../settings';
import { displayName } from './users';

type Kind = 'initial' | 'renewal' | 'renewal_failed' | 'refund' | 'duplicate';

const TITLE: Record<Kind, string> = {
  initial: '💳 <b>Новая оплата</b>',
  renewal: '🔁 <b>Продление подписки</b>',
  renewal_failed: '⚠️ <b>Не прошло автосписание</b>',
  refund: '↩️ <b>Возврат</b>',
  duplicate: '❗️ <b>Повторная оплата — нужен возврат</b>',
};

/**
 * Уведомление владельцу и команде в админ-бот об оплатах (в фоне: ошибка отправки не мешает обработке платежа).
 * Тестовые оплаты помечаются, в сумму за день не входят.
 */
export function paymentAlert(kind: Kind, p: { userId: bigint; amount: number; tariffId?: string | null; test?: boolean; note?: string }) {
  void (async () => {
    const { notifyAdmins, escAdmin } = await import('./adminBot');
    const [u, tariff] = await Promise.all([
      prisma.user.findUnique({ where: { id: p.userId } }),
      p.tariffId ? prisma.tariff.findUnique({ where: { id: p.tariffId } }) : null,
    ]);
    const tz = await getSetting('flow.timezone');
    const from = startOfLocalDay(localDate(clock.now(), tz), tz);
    const today = await prisma.payment.aggregate({ where: { status: 'paid', test: false, paidAt: { gte: from } }, _sum: { amount: true }, _count: true });
    const who = u ? `${escAdmin(displayName(u))}${u.username ? ` (@${escAdmin(u.username)})` : ''}` : String(p.userId);
    const lines = [
      `${TITLE[kind]} · ${p.amount.toLocaleString('ru-RU')} ₽${p.test ? ' · <i>тестовая</i>' : ''}`,
      `${who}${tariff ? ` · ${escAdmin(tariff.title)}` : ''}`,
      ...(p.note ? [escAdmin(p.note)] : []),
      `Сегодня: ${today._count} ${today._count % 10 === 1 && today._count % 100 !== 11 ? 'оплата' : [2, 3, 4].includes(today._count % 10) && ![12, 13, 14].includes(today._count % 100) ? 'оплаты' : 'оплат'} на ${(today._sum.amount ?? 0).toLocaleString('ru-RU')} ₽`,
    ];
    await notifyAdmins(lines.join('\n'));
  })().catch((e) => console.error('[payment-alert]', (e as Error).message));
}
