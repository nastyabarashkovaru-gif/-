import { TOPIC_CHATS, fromDbDate } from '@thirty/domain';
import { currentMembership } from './flows';
import { clock } from '../clock';
import { prisma } from '../db';
import { forbidden, notFound } from '../http';
import { accessibleChats } from './chats';
import { LIVE_STATUSES } from './billing';
import { track } from './analytics';

export const DIRECTIONS: Record<string, string> = {
  money: 'Деньги — коуч / психолог',
  english: 'Английский — репетитор',
  habits: 'Привычки и отказы — психолог',
  blog: 'Блог — эксперт',
  weightloss: 'Похудение — встреча участников',
};

async function hasPaidAccess(userId: bigint) {
  return Boolean(await prisma.subscription.findFirst({ where: { userId, status: { in: [...LIVE_STATUSES] } } }));
}

function serializeMeeting(m: { id: string; direction: string; title: string; description: string | null; startsAt: Date; durationMin: number; status: string; expert: { name: string; photoUrl: string | null; bio: string | null } | null }) {
  return {
    id: m.id,
    direction: m.direction,
    directionTitle: DIRECTIONS[m.direction] ?? m.direction,
    title: m.title,
    description: m.description,
    startsAt: m.startsAt,
    durationMin: m.durationMin,
    status: m.status,
    expert: m.expert ? { name: m.expert.name, photoUrl: m.expert.photoUrl, bio: m.expert.bio } : null,
  };
}

/** Клуб S27: чат потока, 5 тематических чатов и календарь созвонов на 3 недели вперёд */
export async function clubOverview(userId: bigint) {
  const chats = await accessibleChats(userId);
  const now = clock.now();
  const meetings = await prisma.meeting.findMany({
    where: { status: { not: 'canceled' }, startsAt: { gt: new Date(now.getTime() - 2 * 3600_000), lt: new Date(now.getTime() + 21 * 24 * 3600_000) } },
    include: { expert: true },
    orderBy: { startsAt: 'asc' },
  });
  await track({ userId, eventName: 'club_open', screenId: 'S27' });
  const channelExists = Boolean(await prisma.telegramChat.findFirst({ where: { kind: 'channel', active: true, telegramChatId: { not: null } }, select: { id: true } }));
  const membership = await currentMembership(userId);
  const flowChat = chats.find((c) => c.kind === 'flow' && c.flowId === membership?.flowId) ?? chats.find((c) => c.kind === 'flow');
  return {
    paid: await hasPaidAccess(userId),
    flowChat: flowChat ? { id: flowChat.id, title: flowChat.title } : null,
    // Информационный канал: доступен оплатившим; null — канала нет или нет доступа (тогда показываем замок, если канал привязан)
    channel: (() => { const c = chats.find((x) => x.kind === 'channel'); return c ? { id: c.id, title: c.title } : null; })(),
    channelExists: channelExists,
    flow: membership ? { startsOn: fromDbDate(membership.flow.startsOn), title: membership.flow.title } : null,
    topicChats: TOPIC_CHATS.map((t) => {
      const c = chats.find((x) => x.kind === 'topic' && x.topic === t.id);
      return { topic: t.id, title: t.title, emoji: t.emoji, id: c?.id ?? null, available: Boolean(c) };
    }),
    meetings: meetings.map(serializeMeeting),
  };
}

export async function meetingDetails(userId: bigint, id: string) {
  const m = await prisma.meeting.findUnique({ where: { id }, include: { expert: true } });
  if (!m) throw notFound();
  await track({ userId, eventName: 'meeting_view', screenId: 'S28', metadata: { meetingId: id, direction: m.direction } });
  const att = await prisma.attendance.findUnique({ where: { meetingId_userId: { meetingId: id, userId } } });
  return { ...serializeMeeting(m), nextStep: m.status === 'done' ? m.nextStep : null, joined: Boolean(att?.joinClickedAt) };
}

/** Ссылка на созвон выдаётся только при оплаченном доступе; клик пишется в посещаемость */
export async function joinMeeting(userId: bigint, id: string) {
  if (!(await hasPaidAccess(userId))) throw forbidden('no_access', 'Созвоны доступны участникам клуба');
  const m = await prisma.meeting.findUnique({ where: { id } });
  if (!m || m.status === 'canceled') throw notFound();
  if (!m.joinUrl) throw notFound('no_link', 'Ссылка появится ближе к началу встречи');
  await prisma.attendance.upsert({
    where: { meetingId_userId: { meetingId: id, userId } },
    create: { meetingId: id, userId, joinClickedAt: clock.now() },
    update: { joinClickedAt: clock.now() },
  });
  await track({ userId, eventName: 'meeting_join_click', screenId: 'S28', metadata: { meetingId: id, direction: m.direction } });
  return { url: m.joinUrl };
}
