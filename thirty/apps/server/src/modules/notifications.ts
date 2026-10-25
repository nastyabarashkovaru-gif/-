import { clock } from '../clock';
import { prisma } from '../db';
import { notFound } from '../http';

/** Уведомления в приложении (колокольчик). Создаются только по реальным событиям; dedupeKey защищает от повторов. */
export async function pushNotification(userId: bigint, kind: 'buddy_report' | 'chat_reply' | 'report_due' | 'buddy_proposal', data: { title: string; body?: string | null; link?: string | null }, dedupeKey?: string) {
  try {
    await prisma.notification.create({ data: { userId, kind, title: data.title, body: data.body ?? null, link: data.link ?? null, dedupeKey: dedupeKey ?? null, createdAt: clock.now() } });
  } catch (e) {
    // Повтор того же события — не ошибка
    if ((e as { code?: string }).code !== 'P2002') throw e;
  }
}

export async function listNotifications(userId: bigint) {
  const rows = await prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
  return {
    unread: rows.filter((r) => !r.readAt).length,
    items: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, read: Boolean(r.readAt), createdAt: r.createdAt.toISOString() })),
  };
}

export async function unreadCount(userId: bigint) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: bigint, id: string) {
  const r = await prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: clock.now() } });
  if (!r.count && !(await prisma.notification.findFirst({ where: { id, userId } }))) throw notFound();
  return { ok: true, unread: await unreadCount(userId) };
}
