import { randomBytes } from 'node:crypto';
import { canRequestReplacement, matchBuddies } from '@thirty/domain';
import { clock } from '../clock';
import { prisma, serializable, type Tx } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../http';
import { memberStats } from './rating';
import { displayName } from './users';
import { track } from './analytics';
import { notify } from './notify';
import { pushNotification } from './notifications';

const ELIGIBLE = ['reserved', 'registered', 'active'] as const;

async function membershipIn(userId: bigint, flowId: string, db: Tx | typeof prisma = prisma) {
  return db.flowMembership.findFirst({ where: { userId, flowId, status: { in: [...ELIGIBLE] } } });
}

/** Создать пару транзакционно: первичный ключ BuddyAssignment(flowId, userId) не даст назначить второго бадди */
async function createPair(tx: Tx, flowId: string, a: bigint, b: bigint, source: string, matchReason?: string) {
  const pair = await tx.buddyPair.create({ data: { flowId, userA: a, userB: b, source, matchReason } });
  await tx.buddyAssignment.createMany({ data: [{ flowId, userId: a, pairId: pair.id }, { flowId, userId: b, pairId: pair.id }] });
  // Пара есть: остальные ожидающие предложения обоих недействительны, из очереди автоподбора оба выходят
  await tx.buddyInvite.updateMany({ where: { status: 'pending', toUserId: { not: null }, OR: [{ fromUserId: { in: [a, b] } }, { toUserId: { in: [a, b] } }] }, data: { status: 'expired' } });
  await tx.flowMembership.updateMany({ where: { flowId, userId: { in: [a, b] } }, data: { buddyQueuedAt: null } });
  return pair;
}

export async function createInvite(userId: bigint, flowId: string) {
  if (!(await membershipIn(userId, flowId))) throw forbidden('no_membership');
  if (await prisma.buddyAssignment.findUnique({ where: { flowId_userId: { flowId, userId } } })) throw conflict('already_paired', 'У вас уже есть бадди');
  const existing = await prisma.buddyInvite.findFirst({ where: { flowId, fromUserId: userId, status: 'pending' } });
  const invite = existing ?? (await prisma.buddyInvite.create({ data: { flowId, fromUserId: userId, token: randomBytes(9).toString('base64url') } }));
  await track({ userId, eventName: 'buddy_invite_sent', screenId: 'S16', flowId });
  return { token: invite.token, startParam: `bd_${invite.token}` };
}

/** Принять приглашение: оба оплатили этот поток и оба свободны → пара «по приглашению» (не перераспределяется) */
export async function acceptInvite(userId: bigint, token: string) {
  const invite = await prisma.buddyInvite.findUnique({ where: { token } });
  if (!invite || invite.status !== 'pending') throw notFound('invite_not_found', 'Приглашение недействительно');
  if (invite.fromUserId === userId) throw badRequest('self_invite', 'Нельзя пригласить самого себя');
  const pair = await serializable(async (tx) => {
    const [mine, theirs] = await Promise.all([membershipIn(userId, invite.flowId, tx), membershipIn(invite.fromUserId, invite.flowId, tx)]);
    if (!mine) throw forbidden('no_membership', 'Чтобы стать бадди, нужно участие в этом же потоке');
    if (!theirs) throw conflict('inviter_inactive');
    const taken = await tx.buddyAssignment.findMany({ where: { flowId: invite.flowId, userId: { in: [userId, invite.fromUserId] } } });
    if (taken.length) throw conflict('already_paired', 'У кого-то из вас уже есть бадди');
    const p = await createPair(tx, invite.flowId, invite.fromUserId, userId, 'invite');
    await tx.buddyInvite.update({ where: { id: invite.id }, data: { status: 'accepted', toUserId: userId } });
    return p;
  });
  await onMatched(pair.flowId, [pair.userA, pair.userB]);
  return { pairId: pair.id };
}

/** Предложение стать парой конкретному участнику: пуш в боте и запрос в приложении */
export async function proposeBuddy(userId: bigint, flowId: string, targetId: bigint) {
  if (userId === targetId) throw badRequest('self_invite', 'Нельзя пригласить самого себя');
  const observers = await (await import('./observers')).observerIds();
  if (observers.has(String(userId)) || observers.has(String(targetId))) throw forbidden('observer', 'Организатор не участвует в подборе бадди');
  const [mine, theirs] = await Promise.all([membershipIn(userId, flowId), membershipIn(targetId, flowId)]);
  if (!mine) throw forbidden('no_membership', 'Предложить пару можно участнику своего потока');
  if (!theirs) throw conflict('other_flow', 'Этот участник в другом потоке — пару можно составить только внутри одного потока');
  const taken = await prisma.buddyAssignment.findMany({ where: { flowId, userId: { in: [userId, targetId] } } });
  if (taken.some((t) => t.userId === userId)) throw conflict('already_paired', 'У тебя уже есть бадди');
  if (taken.length) throw conflict('target_paired', 'У этого участника уже есть бадди');
  const counter = await prisma.buddyInvite.findFirst({ where: { flowId, fromUserId: targetId, toUserId: userId, status: 'pending' } });
  if (counter) return { ...(await acceptInvite(userId, counter.token)), matched: true };
  const existing = await prisma.buddyInvite.findFirst({ where: { flowId, fromUserId: userId, toUserId: targetId, status: 'pending' } });
  if (existing) return { proposalId: existing.id, matched: false };
  const inv = await prisma.buddyInvite.create({ data: { flowId, fromUserId: userId, toUserId: targetId, token: randomBytes(9).toString('base64url') } });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { sendBuddyProposal } = await import('./bot');
  await sendBuddyProposal(targetId, inv.id, { name: displayName(me), username: me.username });
  await pushNotification(targetId, 'buddy_proposal', { title: 'Тебе предложили стать парой 💜', body: `${displayName(me)} хочет стать твоим бадди`, link: '/buddy' }, `buddy_proposal:${inv.id}`);
  await track({ userId, eventName: 'buddy_invite_sent', screenId: 'S25', flowId, metadata: { direct: true } });
  return { proposalId: inv.id, matched: false };
}

/** Ответ на предложение: подтвердить → пара; отклонить → предложившему уведомление */
export async function respondProposal(userId: bigint, proposalId: string, accept: boolean) {
  const inv = await prisma.buddyInvite.findUnique({ where: { id: proposalId } });
  if (!inv || inv.toUserId !== userId || inv.status !== 'pending') throw notFound('proposal_not_found', 'Предложение уже неактуально');
  if (accept) return { ...(await acceptInvite(userId, inv.token)), accepted: true };
  await prisma.buddyInvite.update({ where: { id: inv.id }, data: { status: 'declined' } });
  const me = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const { sendBuddyDeclined } = await import('./bot');
  await sendBuddyDeclined(inv.fromUserId, displayName(me));
  await pushNotification(inv.fromUserId, 'buddy_proposal', { title: 'Предложение стать парой отклонено', body: `${displayName(me)} пока не готов(а) стать парой. Выбери другого участника или доверь подбор нам.`, link: '/feed?tab=people' }, `buddy_declined:${inv.id}`);
  return { accepted: false };
}

/** Входящие и исходящие предложения для экрана «Мой бадди» */
export async function proposals(userId: bigint, flowId: string) {
  const [incoming, outgoing] = await Promise.all([
    prisma.buddyInvite.findMany({ where: { flowId, toUserId: userId, status: 'pending' }, orderBy: { createdAt: 'desc' } }),
    prisma.buddyInvite.findMany({ where: { flowId, fromUserId: userId, toUserId: { not: null }, status: 'pending' }, orderBy: { createdAt: 'desc' } }),
  ]);
  const ids = [...incoming.map((i) => i.fromUserId), ...outgoing.map((i) => i.toUserId!)];
  const users = await prisma.user.findMany({ where: { id: { in: ids } } });
  const card = (id: bigint) => {
    const u = users.find((x) => x.id === id);
    return { id: id.toString(), name: u ? displayName(u) : 'Участник', city: u?.city ?? null, photoUrl: u?.photoUrl ?? null };
  };
  return { incoming: incoming.map((i) => ({ id: i.id, user: card(i.fromUserId) })), outgoing: outgoing.map((i) => ({ id: i.id, user: card(i.toUserId!) })) };
}

async function onMatched(flowId: string, users: bigint[]) {
  const people = await prisma.user.findMany({ where: { id: { in: users } } });
  for (const u of users) {
    const other = people.find((p) => p.id !== u);
    const vars = { buddy: other ? (other.username ? `@${other.username}` : displayName(other)) : 'твой бадди', buddy_url: other?.username ? `https://t.me/${other.username}` : '' };
    await track({ userId: u, eventName: 'buddy_matched', flowId, dedupeKey: `buddy_matched:${flowId}:${u}` });
    await notify(u, 'buddy_matched', vars, `buddy_matched:${flowId}:${u}:${clock.now().toISOString().slice(0, 16)}`);
  }
}

/**
 * Автоподбор для всех свободных участников потока. Идемпотентен: уже назначенные не трогаются,
 * повторный запуск ничего не меняет. Пары по приглашению не перераспределяются.
 */
export async function autoMatch(flowId: string) {
  const { observerIds } = await import('./observers');
  const observers = await observerIds();
  const members = (await prisma.flowMembership.findMany({ where: { flowId, status: { in: [...ELIGIBLE] } }, include: { user: true } })).filter((m) => !observers.has(m.userId.toString()));
  const assigned = new Set((await prisma.buddyAssignment.findMany({ where: { flowId } })).map((a) => a.userId.toString()));
  const pool = members
    .filter((m) => !assigned.has(m.userId.toString()))
    .map((m) => ({ userId: m.userId.toString(), interests: m.user.interests, city: m.user.city, timezone: m.user.timezone }));
  // после замены бывших бадди друг с другом снова не ставим
  const past = await prisma.buddyPair.findMany({ where: { flowId, status: 'dissolved' }, select: { userA: true, userB: true } });
  const avoid = new Set(past.flatMap((p) => [`${p.userA}:${p.userB}`, `${p.userB}:${p.userA}`]));
  const { pairs, unmatched } = matchBuddies(pool, `${flowId}:${pool.length}`, (a, b) => avoid.has(`${a}:${b}`));
  let created = 0;
  for (const p of pairs) {
    try {
      await serializable((tx) => createPair(tx, flowId, BigInt(p.a), BigInt(p.b), 'auto', p.reason));
      created++;
      await onMatched(flowId, [BigInt(p.a), BigInt(p.b)]);
    } catch (e) {
      // Гонка с ручным приглашением — эту пару пропускаем, человек уже с бадди
      if (!(e instanceof Error && /Unique|P2002/.test(e.message))) throw e;
    }
  }
  return { created, waiting: unmatched.length };
}

export async function buddyOf(userId: bigint, flowId: string) {
  const a = await prisma.buddyAssignment.findUnique({ where: { flowId_userId: { flowId, userId } }, include: { pair: true } });
  if (!a) return null;
  const otherId = a.pair.userA === userId ? a.pair.userB : a.pair.userA;
  return { pair: a.pair, otherId };
}

/** Карточка бадди на главной: имя, разрешённый прогресс, «Написать» */
export async function buddyCard(userId: bigint, flowId: string) {
  const b = await buddyOf(userId, flowId);
  if (!b) {
    const waiting = await prisma.buddyInvite.findFirst({ where: { flowId, fromUserId: userId, status: 'pending' } });
    const m = await prisma.flowMembership.findFirst({ where: { userId, flowId }, select: { buddyMode: true } });
    return { state: waiting ? 'invited' : 'waiting', mode: (m?.buddyMode ?? null) as 'auto' | 'self' | null } as const;
  }
  const other = await prisma.user.findUniqueOrThrow({ where: { id: b.otherId } });
  const m = await prisma.flowMembership.findFirst({ where: { userId: b.otherId, flowId }, include: { flow: true } });
  const showProgress = m && m.status === 'active';
  const percent = showProgress ? Math.round((await memberStats(m.id, m.flow)).ratio * 100) : null;
  return {
    state: 'paired' as const,
    pairId: b.pair.id,
    source: b.pair.source,
    since: b.pair.createdAt,
    buddy: {
      id: other.id.toString(),
      name: displayName(other),
      photoUrl: other.photoUrl,
      percent,
      writeUrl: other.username ? `https://t.me/${other.username}` : `tg://user?id=${other.id}`,
    },
  };
}

/**
 * Замена бадди: по взаимному согласию (нужны запросы обоих) или при отсутствии связи > 5 дней
 * (декларация, видна модератору). Пара распускается, оба возвращаются в пул и сразу пробуют переподбор.
 */
export async function requestReplacement(userId: bigint, flowId: string, reason: 'mutual' | 'no_contact_5d', comment?: string) {
  const b = await buddyOf(userId, flowId);
  if (!b) throw notFound('no_buddy');
  const now = clock.now();
  if (!canRequestReplacement(reason, null, b.pair.createdAt, now)) throw forbidden('too_early', 'Замена по отсутствию связи доступна через 5 дней после назначения');
  const existing = await prisma.buddyReplacement.findFirst({ where: { pairId: b.pair.id, requesterId: userId, status: 'open' } });
  if (!existing) await prisma.buddyReplacement.create({ data: { pairId: b.pair.id, requesterId: userId, reason, comment } });
  if (reason === 'mutual') {
    const partner = await prisma.buddyReplacement.findFirst({ where: { pairId: b.pair.id, requesterId: b.otherId, reason: 'mutual', status: 'open' } });
    if (!partner) return { state: 'waiting_partner' as const };
  }
  await dissolvePair(b.pair.id, 'approved');
  const rematch = await runBuddyQueue();
  const now2 = await buddyOf(userId, flowId);
  return { state: now2 ? ('rematched' as const) : ('waiting_pool' as const), rematch };
}

/** Распустить пару: оба снова в очереди автоподбора (кроме тех, кто ищет бадди сама) */
export async function dissolvePair(pairId: string, replacementStatus = 'approved', decidedBy?: string) {
  const pair = await prisma.buddyPair.findUniqueOrThrow({ where: { id: pairId } });
  const now = clock.now();
  await prisma.$transaction([
    prisma.buddyAssignment.deleteMany({ where: { pairId } }),
    prisma.buddyPair.update({ where: { id: pairId }, data: { status: 'dissolved', dissolvedAt: now } }),
    prisma.buddyReplacement.updateMany({ where: { pairId, status: 'open' }, data: { status: replacementStatus, decidedBy } }),
    prisma.flowMembership.updateMany({ where: { flowId: pair.flowId, userId: { in: [pair.userA, pair.userB] }, OR: [{ buddyMode: null }, { buddyMode: 'auto' }] }, data: { buddyMode: 'auto', buddyQueuedAt: now } }),
  ]);
}

/**
 * Замена бадди организатором (админка): пара распускается, оба сразу получают новых из свободных участников потока.
 * Тот, кого не удалось подобрать, ждёт — подберём, как только появится свободный участник.
 */
export async function adminReplaceBuddy(userId: bigint) {
  const a = await prisma.buddyAssignment.findFirst({ where: { userId, pair: { status: 'active' } }, include: { pair: true }, orderBy: { pair: { createdAt: 'desc' } } });
  if (!a) throw notFound('no_buddy', 'У участницы сейчас нет бадди');
  const flowId = a.pair.flowId;
  const otherId = a.pair.userA === userId ? a.pair.userB : a.pair.userA;
  await dissolvePair(a.pair.id, 'approved');
  // та, кого меняли, — первой в очереди автоподбора (бывших вместе не ставим)
  await prisma.flowMembership.updateMany({ where: { flowId, userId }, data: { buddyMode: 'auto', buddyQueuedAt: new Date(0) } });
  await runBuddyQueue();
  const name = async (u: bigint) => {
    const b = await buddyOf(u, flowId);
    return b ? displayName(await prisma.user.findUniqueOrThrow({ where: { id: b.otherId } })) : null;
  };
  return { pairId: a.pair.id, newBuddy: await name(userId), formerBuddyNew: await name(otherId) };
}

const REPLACE_REASON: Record<string, string> = { no_contact: 'не выходит на связь', mismatch: 'не сошлись', other: 'другое' };

/**
 * Замена бадди самой участницей (кнопка «Заменить бадди»): сразу, без ожидания второго и без 5 дней.
 * Причина и комментарий сохраняются (видны в админке), организаторам — сообщение в админ-бот.
 */
export async function memberReplaceBuddy(userId: bigint, flowId: string, reason: 'no_contact' | 'mismatch' | 'other', comment?: string) {
  const b = await buddyOf(userId, flowId);
  if (!b) throw notFound('no_buddy', 'У тебя сейчас нет бадди');
  await prisma.buddyReplacement.create({ data: { pairId: b.pair.id, requesterId: userId, reason, comment: comment?.trim() || null } });
  const [me, former] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: userId } }), prisma.user.findUniqueOrThrow({ where: { id: b.otherId } })]);
  const r = await adminReplaceBuddy(userId);
  const { notifyAdmins, escAdmin } = await import('./adminBot');
  const who = (u: { username: string | null }, n: string) => `${escAdmin(n)}${u.username ? ` (@${escAdmin(u.username)})` : ''}`;
  await notifyAdmins(
    `🔄 <b>Замена бадди</b>\n${who(me, displayName(me))} сменила бадди ${who(former, displayName(former))}.\nПричина: ${REPLACE_REASON[reason]}${comment?.trim() ? `\nКомментарий: ${escAdmin(comment.trim())}` : ''}\n` +
      `Новый бадди: ${r.newBuddy ? escAdmin(r.newBuddy) : 'пока нет свободных — ждёт'}${r.formerBuddyNew ? `\nБывший бадди получил: ${escAdmin(r.formerBuddyNew)}` : ''}`,
  ).catch(() => undefined);
  return { state: r.newBuddy ? ('rematched' as const) : ('waiting_pool' as const), newBuddy: r.newBuddy };
}

// ───────────── Очередь автоподбора и самостоятельный выбор (ТЗ 02.11) ─────────────

/** Пары без учёта целей: кто раньше встал в очередь, тот раньше получает бадди. Бывших вместе не ставим. */
export async function runBuddyQueue() {
  const observers = await (await import('./observers')).observerIds();
  const queued = await prisma.flowMembership.findMany({
    where: { buddyMode: 'auto', buddyQueuedAt: { not: null }, status: { in: [...ELIGIBLE] }, flow: { status: { not: 'finished' } } },
    orderBy: { buddyQueuedAt: 'asc' },
  });
  const assigned = new Set((await prisma.buddyAssignment.findMany({ where: { userId: { in: queued.map((m) => m.userId) } } })).map((x) => `${x.flowId}:${x.userId}`));
  let created = 0;
  const byFlow = new Map<string, typeof queued>();
  for (const m of queued) {
    if (observers.has(m.userId.toString())) continue;
    if (assigned.has(`${m.flowId}:${m.userId}`)) {
      await prisma.flowMembership.update({ where: { id: m.id }, data: { buddyQueuedAt: null } });
      continue;
    }
    byFlow.set(m.flowId, [...(byFlow.get(m.flowId) ?? []), m]);
  }
  for (const [flowId, list] of byFlow) {
    const past = await prisma.buddyPair.findMany({ where: { flowId, status: 'dissolved' }, select: { userA: true, userB: true } });
    const avoid = new Set(past.flatMap((p) => [`${p.userA}:${p.userB}`, `${p.userB}:${p.userA}`]));
    const rest = [...list];
    while (rest.length >= 2) {
      const first = rest.shift()!;
      const k = rest.findIndex((x) => !avoid.has(`${first.userId}:${x.userId}`));
      if (k < 0) continue;
      const [second] = rest.splice(k, 1);
      try {
        await serializable(async (tx) => {
          const taken = await tx.buddyAssignment.findMany({ where: { flowId, userId: { in: [first.userId, second.userId] } } });
          if (taken.length) throw conflict('already_paired');
          await createPair(tx, flowId, first.userId, second.userId, 'auto', 'queue');
        });
        created++;
        await onMatched(flowId, [first.userId, second.userId]);
      } catch (e) {
        // гонка с ручным выбором — этих двоих пропускаем, следующий проход разберётся
        if (!(e instanceof Error)) throw e;
      }
    }
  }
  return { created };
}

/** Выбор способа поиска бадди: auto — в очередь (пара сразу, если кто-то уже ждёт), self — выбрать самой */
export async function setBuddyMode(userId: bigint, mode: 'auto' | 'self') {
  const { currentMembership } = await import('./flows');
  const m = await currentMembership(userId);
  if (!m || !ELIGIBLE.includes(m.status as (typeof ELIGIBLE)[number])) throw forbidden('no_membership', 'Бадди доступен участникам клуба');
  const observers = await (await import('./observers')).observerIds();
  if (observers.has(String(userId))) throw forbidden('observer', 'Организатор не участвует в подборе бадди');
  if (await buddyOf(userId, m.flowId)) throw conflict('already_paired', 'У тебя уже есть бадди');
  await prisma.flowMembership.update({ where: { id: m.id }, data: { buddyMode: mode, buddyQueuedAt: mode === 'auto' ? (m.buddyQueuedAt ?? clock.now()) : null } });
  await track({ userId, eventName: 'buddy_mode_selected', flowId: m.flowId, metadata: { mode } });
  if (mode === 'auto') await runBuddyQueue();
  return buddyCard(userId, m.flowId);
}

/** Свободные участники (без пары) для самостоятельного выбора: поиск по имени и нику */
export async function freeParticipants(userId: bigint, q?: string) {
  const { currentMembership } = await import('./flows');
  const m = await currentMembership(userId);
  if (!m) throw forbidden('no_membership');
  const observers = [...(await (await import('./observers')).observerIds())].map((x) => BigInt(x));
  const paired = (await prisma.buddyAssignment.findMany({ where: { flowId: m.flowId }, select: { userId: true } })).map((a) => a.userId);
  const term = q?.trim().replace(/^@+/, '');
  const members = await prisma.flowMembership.findMany({
    where: {
      flowId: m.flowId,
      status: { in: [...ELIGIBLE] },
      userId: { notIn: [userId, ...paired, ...observers] },
      user: { deletedAt: null, ...(term ? { OR: [{ firstName: { contains: term, mode: 'insensitive' } }, { lastName: { contains: term, mode: 'insensitive' } }, { displayName: { contains: term, mode: 'insensitive' } }, { username: { contains: term, mode: 'insensitive' } }] } : {}) },
    },
    include: { user: true, goals: { select: { title: true } } },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  const sent = new Set((await prisma.buddyInvite.findMany({ where: { flowId: m.flowId, fromUserId: userId, status: 'pending', toUserId: { not: null } } })).map((i) => i.toUserId!.toString()));
  return members.map((x) => ({
    id: x.userId.toString(),
    name: displayName(x.user),
    username: x.user.username,
    photoUrl: x.user.photoUrl,
    city: x.user.city,
    goals: x.goals.map((g) => g.title),
    proposed: sent.has(x.userId.toString()),
  }));
}
