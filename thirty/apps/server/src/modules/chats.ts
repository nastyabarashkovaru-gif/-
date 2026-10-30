import { TOPIC_CHATS, fromDbDate, addDays, flowBounds, localDate } from '@thirty/domain';
import type { TelegramChat } from '@prisma/client';
import { clock } from '../clock';
import { config } from '../config';
import { prisma } from '../db';
import { forbidden, notFound } from '../http';
import { getSetting } from '../settings';
import { tg, TelegramError } from '../lib/telegram';
import { track } from './analytics';
import { LIVE_STATUSES } from './billing';

const FLOW_CHAT_GRACE_DAYS = 7;

/**
 * Какие закрытые чаты доступны пользователю:
 * — чат потока: только участникам этого потока (оплачен, не отозван), до +7 дней после финала;
 * — тематические чаты: любому с действующей оплаченной подпиской.
 */
export async function accessibleChats(userId: bigint, now = clock.now()): Promise<TelegramChat[]> {
  const tz = await getSetting('flow.timezone');
  const today = localDate(now, tz);
  const memberships = await prisma.flowMembership.findMany({ where: { userId, status: { not: 'revoked' } }, include: { flow: true } });
  const flowIds = memberships
    .filter((m) => addDays(flowBounds(fromDbDate(m.flow.startsOn)).endsOn, FLOW_CHAT_GRACE_DAYS) >= today)
    .map((m) => m.flowId);
  const live = await prisma.subscription.findFirst({ where: { userId, status: { in: [...LIVE_STATUSES] } } });
  // Тематические чаты — только по категориям целей участника (решение владельца 24.10)
  const topics = live
    ? [...new Set((await prisma.goal.findMany({ where: { membership: { userId, flowId: { in: flowIds } } }, select: { category: true } })).map((g) => g.category as string))]
    : [];
  const chats = await prisma.telegramChat.findMany({
    where: {
      active: true,
      telegramChatId: { not: null },
      OR: [
        { kind: 'flow', flowId: { in: flowIds } },
        ...(topics.length ? [{ kind: 'topic' as const, topic: { in: topics } }] : []),
        // Информационный канал — всем с оплаченным доступом (действующая подписка или участие в потоке)
        ...(live || flowIds.length ? [{ kind: 'channel' }] : []),
      ],
    },
  });
  // Общий чат открыт сразу после оплаты: если к потоку участника группа ещё не привязана — последний привязанный чат потока
  if (flowIds.length && !chats.some((c) => c.kind === 'flow')) {
    const latest = await prisma.telegramChat.findFirst({ where: { kind: 'flow', active: true, telegramChatId: { not: null } }, orderBy: { createdAt: 'desc' } });
    if (latest) chats.push(latest);
  }
  return chats;
}

/** Персональная ссылка-заявка: вступление только через проверку оплаты ботом (chat_join_request) */
export async function inviteLinkFor(userId: bigint, chatId: string) {
  const chats = await accessibleChats(userId);
  const chat = chats.find((c) => c.id === chatId);
  if (!chat) throw forbidden('no_access', 'Чат доступен только участникам с оплаченным доступом');
  const existing = await prisma.chatMembership.findUnique({ where: { chatId_userId: { chatId, userId } } });
  if (existing?.status === 'joined') return { url: null, joined: true };
  // Демо: настоящих чатов нет, ссылку не создаём
  if (config.DEMO_MODE) return { url: null, joined: false, demo: true };
  const ttlHours = await getSetting('chats.inviteTtlHours');
  const fresh = existing?.inviteLink && existing.updatedAt.getTime() > clock.now().getTime() - (ttlHours - 1) * 3600_000;
  let url = fresh ? existing!.inviteLink! : null;
  if (!url) {
    const link = await tg<{ invite_link: string }>('createChatInviteLink', {
      chat_id: Number(chat.telegramChatId),
      name: `u${userId}`.slice(0, 32),
      creates_join_request: true,
      expire_date: Math.floor(clock.now().getTime() / 1000) + ttlHours * 3600,
    });
    url = link.invite_link;
    await prisma.chatMembership.upsert({
      where: { chatId_userId: { chatId, userId } },
      create: { chatId, userId, inviteLink: url, status: 'invited' },
      update: { inviteLink: url, status: existing?.status === 'removed' ? 'invited' : existing?.status ?? 'invited' },
    });
  }
  await track({ userId, eventName: 'chat_link_open', screenId: 'S27', metadata: { chat: chat.kind, topic: chat.topic } });
  return { url, joined: false };
}

/** Заявка на вступление: одобряем только при действующем праве на этот чат */
export async function onJoinRequest(tgChatId: number, tgUserId: number) {
  const chat = await prisma.telegramChat.findUnique({ where: { telegramChatId: BigInt(tgChatId) } });
  const userId = BigInt(tgUserId);
  if (!chat || !chat.active) return;
  const allowed = (await accessibleChats(userId)).some((c) => c.id === chat.id);
  try {
    await tg(allowed ? 'approveChatJoinRequest' : 'declineChatJoinRequest', { chat_id: tgChatId, user_id: tgUserId });
  } catch (e) {
    console.warn('[chats] join request', (e as Error).message);
  }
  if (allowed) {
    await prisma.chatMembership.upsert({
      where: { chatId_userId: { chatId: chat.id, userId } },
      create: { chatId: chat.id, userId, status: 'joined', joinedAt: clock.now() },
      update: { status: 'joined', joinedAt: clock.now(), removedAt: null },
    });
  } else {
    await prisma.chatMembership.updateMany({ where: { chatId: chat.id, userId }, data: { status: 'declined' } });
  }
}

export async function onChatMemberUpdate(tgChatId: number, tgUserId: number, status: string) {
  const chat = await prisma.telegramChat.findUnique({ where: { telegramChatId: BigInt(tgChatId) } });
  if (!chat) return;
  if (status === 'left' || status === 'kicked') {
    await prisma.chatMembership.updateMany({ where: { chatId: chat.id, userId: BigInt(tgUserId) }, data: { status: 'removed', removedAt: clock.now() } });
  }
}

/**
 * Удаление из закрытых групп тех, у кого закончились права (кик = ban + сразу unban,
 * чтобы при новой оплате можно было вернуться по новой ссылке).
 */
export async function removeExpiredMembers() {
  const joined = await prisma.chatMembership.findMany({ where: { status: 'joined' }, include: { chat: true } });
  const cache = new Map<string, Set<string>>();
  let removed = 0;
  for (const cm of joined) {
    const key = cm.userId.toString();
    if (!cache.has(key)) cache.set(key, new Set((await accessibleChats(cm.userId)).map((c) => c.id)));
    if (cache.get(key)!.has(cm.chatId) || !cm.chat.telegramChatId) continue;
    try {
      await tg('banChatMember', { chat_id: Number(cm.chat.telegramChatId), user_id: Number(cm.userId), until_date: Math.floor(Date.now() / 1000) + 60 });
      await tg('unbanChatMember', { chat_id: Number(cm.chat.telegramChatId), user_id: Number(cm.userId), only_if_banned: true });
    } catch (e) {
      if (!(e instanceof TelegramError && /not found|not a member|PARTICIPANT/i.test(e.description))) {
        console.warn('[chats] remove', (e as Error).message);
        continue;
      }
    }
    await prisma.chatMembership.update({ where: { chatId_userId: { chatId: cm.chatId, userId: cm.userId } }, data: { status: 'removed', removedAt: clock.now() } });
    removed++;
  }
  return { removed };
}

/** Привязка группы админом: поток или тематический чат; проверяем, что бот — админ с нужными правами */
export async function bindChat(chatRowId: string, target: { kind: 'flow'; flowId: string } | { kind: 'topic'; topic: string } | { kind: 'channel' }) {
  const chat = await prisma.telegramChat.findUnique({ where: { id: chatRowId } });
  if (!chat || !chat.telegramChatId) throw notFound('chat_not_found');
  const me = await tg<{ id: number }>('getMe', {});
  const member = await tg<{ status: string; can_invite_users?: boolean; can_restrict_members?: boolean }>('getChatMember', { chat_id: Number(chat.telegramChatId), user_id: me.id });
  const problems: string[] = [];
  if (member.status !== 'administrator') problems.push('бот не администратор группы');
  if (!member.can_invite_users) problems.push('нет права приглашать участников');
  // В канале нет отдельного права «ограничивать», удаление подписчиков доступно администратору с правом приглашать
  if (target.kind !== 'channel' && !member.can_restrict_members) problems.push('нет права ограничивать участников (нужно для удаления после окончания доступа)');
  if (problems.length) throw forbidden('bot_rights', `Выдайте боту права: ${problems.join('; ')}`);
  if (target.kind === 'topic' && !TOPIC_CHATS.some((t) => t.id === target.topic)) throw notFound('topic');
  // Старую привязку того же назначения снимаем
  await prisma.telegramChat.updateMany({
    where:
      target.kind === 'flow' ? { kind: 'flow', flowId: target.flowId, id: { not: chat.id } }
      : target.kind === 'topic' ? { kind: 'topic', topic: target.topic, id: { not: chat.id } }
      : { kind: 'channel', id: { not: chat.id } },
    data: { active: false, kind: 'pending', flowId: null, topic: null },
  });
  return prisma.telegramChat.update({
    where: { id: chat.id },
    data:
      target.kind === 'flow' ? { kind: 'flow', flowId: target.flowId, topic: null, active: true }
      : target.kind === 'topic' ? { kind: 'topic', topic: target.topic, flowId: null, active: true }
      : { kind: 'channel', topic: null, flowId: null, active: true },
  });
}
