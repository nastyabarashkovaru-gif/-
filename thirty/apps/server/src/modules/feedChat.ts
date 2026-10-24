import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { forbidden, notFound } from '../http';
import { signedMediaUrl } from '../lib/storage';
import { currentMembership } from './flows';

/** Общий чат отчётов потока (S23): отчёты публикуются автоматически, участники пишут и отвечают на сообщения */

export const chatMessageInput = z.object({
  text: z.string().trim().min(1).max(1000),
  replyToId: z.string().uuid().nullable().optional(),
});

const include = {
  user: true,
  replyTo: { include: { user: true } },
} satisfies Prisma.FeedMessageInclude;

type Row = Prisma.FeedMessageGetPayload<{ include: typeof include }>;

const nameOf = (u: { displayName: string | null; firstName: string; lastName: string | null }) => u.displayName || [u.firstName, u.lastName].filter(Boolean).join(' ');

async function chatFlow(userId: bigint) {
  const m = await currentMembership(userId);
  if (!m || m.status === 'revoked') throw forbidden('no_membership', 'Чат доступен участникам потока');
  return m;
}

async function serialize(rows: Row[], me: bigint) {
  const reportIds = rows.map((r) => r.reportId).filter((x): x is string => Boolean(x));
  const reports = reportIds.length
    ? await prisma.dailyReport.findMany({
        where: { id: { in: reportIds } },
        include: { items: { include: { evidence: true, occurrence: { include: { task: true } } } } },
      })
    : [];
  const byId = new Map(reports.map((r) => [r.id, r]));
  return rows.map((r) => {
    const rep = r.reportId ? byId.get(r.reportId) : undefined;
    const hidden = r.hidden || rep?.status === 'rejected';
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      mine: r.userId === me,
      user: { id: r.userId.toString(), name: r.user.deletedAt ? 'Участник' : nameOf(r.user), photoUrl: r.user.photoUrl },
      text: hidden ? null : r.text,
      hidden,
      report: rep && !hidden
        ? {
            id: rep.id,
            photos: [...rep.mediaIds, ...rep.items.flatMap((i) => i.evidence.map((e) => e.mediaId))].map((id) => signedMediaUrl(id)),
            done: rep.items.map((i) => i.occurrence.task.title),
          }
        : null,
      replyTo: r.replyTo ? { id: r.replyTo.id, name: nameOf(r.replyTo.user), text: r.replyTo.hidden ? 'Сообщение скрыто' : (r.replyTo.text ?? 'Фотоотчёт') } : null,
    };
  });
}

/** Страница сообщений: по умолчанию последние; before — старее; after — новые для опроса */
export async function listChat(userId: bigint, q: { before?: string; after?: string; limit?: number }) {
  const m = await chatFlow(userId);
  const limit = Math.min(q.limit ?? 30, 100);
  const where: Prisma.FeedMessageWhereInput = { flowId: m.flowId };
  if (q.after) {
    const a = await prisma.feedMessage.findUnique({ where: { id: q.after } });
    if (a) where.createdAt = { gt: a.createdAt };
  }
  if (q.before) {
    const b = await prisma.feedMessage.findUnique({ where: { id: q.before } });
    if (b) where.createdAt = { lt: b.createdAt };
  }
  const rows = await prisma.feedMessage.findMany({
    where,
    include,
    orderBy: [{ createdAt: q.after ? 'asc' : 'desc' }, { id: 'asc' }],
    take: limit + 1,
  });
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  if (!q.after) page.reverse();
  return { flow: { id: m.flow.id, title: m.flow.title, startsOn: m.flow.startsOn.toISOString().slice(0, 10) }, messages: await serialize(page, userId), hasMore: !q.after && more };
}

export async function postChat(userId: bigint, input: z.infer<typeof chatMessageInput>) {
  const m = await chatFlow(userId);
  if (input.replyToId) {
    const parent = await prisma.feedMessage.findUnique({ where: { id: input.replyToId } });
    if (!parent || parent.flowId !== m.flowId) throw notFound('message_not_found');
  }
  const row = await prisma.feedMessage.create({ data: { flowId: m.flowId, userId, text: input.text, replyToId: input.replyToId ?? null }, include });
  return (await serialize([row], userId))[0];
}

/** Модерация: скрыть или вернуть сообщение */
export async function setHidden(id: string, hidden: boolean) {
  return prisma.feedMessage.update({ where: { id }, data: { hidden } });
}
