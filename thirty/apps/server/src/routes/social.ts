import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { requireUser } from '../auth/telegram';
import { config } from '../config';
import { prisma } from '../db';
import { forbidden, jsonSafe, notFound } from '../http';
import { parse } from '../lib/validate';
import { webhookSecret } from '../lib/telegram';
import { currentMembership } from '../modules/flows';
import { computeLeaderboard } from '../modules/rating';
import { addComment, comments, complain, complaintInput, commentInput, feed, participantProfile, participants, react, reportDetails } from '../modules/social';
import { clubOverview, joinMeeting, meetingDetails } from '../modules/club';
import { inviteLinkFor } from '../modules/chats';
import { acceptInvite, buddyCard, createInvite, requestReplacement } from '../modules/buddy';
import { archive, finalInput, reviewInput, revokeReviewConsent, submitFinal, submitReview } from '../modules/finale';
import { availableCards, generateCard, referralLink, renderCardPng } from '../modules/cards';
import { handleUpdate } from '../modules/bot';
import { track } from '../modules/analytics';
import { feature } from '../settings';
import { getSetting } from '../settings';

function cardSig(id: string) {
  return createHmac('sha256', config.MEDIA_SIGNING_SECRET).update(`card:${id}`).digest('hex').slice(0, 24);
}

export async function socialRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook('preHandler', requireUser);

    // Лента S23 и отчёты S22
    r.get<{ Querystring: { cursor?: string; sort?: string; flowId?: string } }>('/api/feed', async (req) => {
      if (!req.query.cursor) await track({ userId: req.user!.id, eventName: 'feed_open', screenId: 'S23' });
      return jsonSafe(await feed({ cursor: req.query.cursor, sort: req.query.sort === 'popular' ? 'popular' : 'new', flowId: req.query.flowId }));
    });
    r.get<{ Params: { id: string } }>('/api/reports/:id', async (req) => jsonSafe(await reportDetails(req.params.id)));
    r.post<{ Params: { id: string } }>('/api/reports/:id/react', async (req) => react(req.user!.id, req.params.id, parse(z.object({ emoji: z.string() }), req.body).emoji));
    r.get<{ Params: { id: string } }>('/api/reports/:id/comments', async (req) => jsonSafe(await comments(req.params.id)));
    r.post<{ Params: { id: string } }>('/api/reports/:id/comments', async (req) => jsonSafe(await addComment(req.user!.id, req.params.id, parse(commentInput, req.body).text)));
    r.post('/api/complaints', async (req) => jsonSafe(await complain(req.user!.id, parse(complaintInput, req.body))));
    r.post<{ Params: { id: string } }>('/api/reports/:id/appeal', async (req) => {
      const { reason } = parse(z.object({ reason: z.string().trim().min(5).max(1000) }), req.body);
      const report = await prisma.dailyReport.findUnique({ where: { id: req.params.id }, include: { membership: true } });
      if (!report || report.membership.userId !== req.user!.id) throw notFound();
      if (report.status !== 'rejected') throw forbidden('not_rejected', 'Апелляция возможна только на отклонённый отчёт');
      const open = await prisma.reportAppeal.findFirst({ where: { reportId: report.id, status: 'open' } });
      return open ?? prisma.reportAppeal.create({ data: { reportId: report.id, reason } });
    });

    // Участники S24, S25
    r.get<{ Querystring: Record<string, string> }>('/api/participants', async (req) => {
      const q = req.query;
      if (q.q || q.city || q.category || q.flowStart) await track({ userId: req.user!.id, eventName: 'participants_search', screenId: 'S24', metadata: { hasQuery: Boolean(q.q), city: q.city, category: q.category, flowStart: q.flowStart } });
      return participants(req.user!.id, q);
    });
    r.get<{ Params: { id: string } }>('/api/participants/:id', async (req) => participantProfile(req.user!.id, req.params.id));
    r.get('/api/flows', async () => {
      const flows = await prisma.flow.findMany({ orderBy: { startsOn: 'desc' }, take: 24 });
      return { flows: flows.map((f) => ({ id: f.id, title: f.title, startsOn: f.startsOn.toISOString().slice(0, 10), status: f.status })) };
    });

    // Рейтинг S26: снапшот не старше 5 минут
    r.get<{ Querystring: { flowId?: string } }>('/api/leaderboard', async (req) => {
      const m = await currentMembership(req.user!.id);
      const flowId = req.query.flowId ?? m?.flowId;
      if (!flowId) return { rows: [], rules: await getSetting('prize.rulesText') };
      await track({ userId: req.user!.id, eventName: 'leaderboard_open', screenId: 'S26', flowId });
      const fresh = await prisma.leaderboardEntry.findFirst({ where: { flowId }, orderBy: { computedAt: 'desc' } });
      if (!fresh || Date.now() - fresh.computedAt.getTime() > 5 * 60_000) await computeLeaderboard(flowId);
      const rows = await prisma.leaderboardEntry.findMany({ where: { flowId }, orderBy: [{ rank: 'asc' }, { userId: 'asc' }], take: 500 });
      const users = await prisma.user.findMany({ where: { id: { in: rows.map((x) => x.userId) } } });
      const byId = new Map(users.map((u) => [u.id.toString(), u]));
      const flow = await prisma.flow.findUnique({ where: { id: flowId } });
      return jsonSafe({
        flow: flow ? { id: flow.id, title: flow.title } : null,
        rules: await getSetting('prize.rulesText'),
        me: req.user!.id.toString(),
        rows: rows.map((x) => {
          const u = byId.get(x.userId.toString());
          const hidden = u?.visibility === 'hidden' && x.userId !== req.user!.id;
          return {
            userId: x.userId.toString(),
            name: hidden ? 'Участник' : u ? u.displayName || [u.firstName, u.lastName].filter(Boolean).join(' ') : 'Участник',
            photoUrl: hidden ? null : u?.photoUrl ?? null,
            rank: x.rank,
            percent: Math.round(x.ratio * 100),
            successfulDays: x.successfulDays,
            missedReports: x.missedReports,
            perfect: x.perfectSoFar,
          };
        }),
      });
    });

    // Клуб S27, созвоны S28, чаты S18
    r.get('/api/club', async (req) => jsonSafe(await clubOverview(req.user!.id)));
    r.get<{ Params: { id: string } }>('/api/meetings/:id', async (req) => jsonSafe(await meetingDetails(req.user!.id, req.params.id)));
    r.post<{ Params: { id: string } }>('/api/meetings/:id/join', async (req) => joinMeeting(req.user!.id, req.params.id));
    r.post<{ Params: { id: string } }>('/api/chats/:id/invite', async (req) => inviteLinkFor(req.user!.id, req.params.id));

    // Бадди S16, S29
    r.get('/api/buddy', async (req) => {
      const m = await currentMembership(req.user!.id);
      if (!m) return { state: 'none' };
      return jsonSafe(await buddyCard(req.user!.id, m.flowId));
    });
    r.post('/api/buddy/invite', async (req) => {
      const m = await currentMembership(req.user!.id);
      if (!m) throw forbidden('no_membership');
      return createInvite(req.user!.id, m.flowId);
    });
    r.post('/api/buddy/accept', async (req) => acceptInvite(req.user!.id, parse(z.object({ token: z.string().min(4).max(32) }), req.body).token));
    r.post('/api/buddy/replace', async (req) => {
      const body = parse(z.object({ reason: z.enum(['mutual', 'no_contact_5d']), comment: z.string().max(500).optional() }), req.body);
      const m = await currentMembership(req.user!.id);
      if (!m) throw forbidden('no_membership');
      return requestReplacement(req.user!.id, m.flowId, body.reason, body.comment);
    });

    // Финал S33, отзывы S32, архив S34
    r.post('/api/membership/final', async (req) => {
      const m = await currentMembership(req.user!.id);
      if (!m) throw forbidden('no_membership');
      return submitFinal(req.user!.id, m.id, parse(finalInput, req.body));
    });
    r.post('/api/reviews/prompt', async (req) => {
      const { trigger } = parse(z.object({ trigger: z.enum(['day14', 'final', 'meeting']) }), req.body);
      await track({ userId: req.user!.id, eventName: 'review_prompt_view', screenId: 'S32', metadata: { trigger } });
      return { ok: true };
    });
    r.post('/api/reviews', async (req) => submitReview(req.user!.id, parse(reviewInput, req.body)));
    r.post<{ Params: { id: string } }>('/api/reviews/:id/revoke', async (req) => revokeReviewConsent(req.user!.id, req.params.id));
    r.get('/api/archive', async (req) => jsonSafe(await archive(req.user!.id)));

    // Карточки S31
    r.get('/api/cards', async (req) => {
      const m = await currentMembership(req.user!.id);
      if (!m || !['active', 'finished'].includes(m.status)) return { weeks: [] };
      return { weeks: await availableCards(m.id) };
    });
    r.post<{ Params: { week: string } }>('/api/cards/:week', async (req) => {
      const m = await currentMembership(req.user!.id);
      if (!m) throw forbidden('no_membership');
      const card = await generateCard(req.user!.id, m.id, Number(req.params.week));
      return { ...card, imageUrl: `${config.PUBLIC_URL}/api/cards/img/${card.id}.png?s=${cardSig(card.id)}` };
    });
    r.post('/api/share/click', async (req) => {
      const body = parse(z.object({ target: z.enum(['story', 'message', 'download', 'link']), week: z.number().int().optional() }), req.body);
      await track({ userId: req.user!.id, eventName: 'share_clicked', screenId: 'S31', metadata: body });
      return { ok: true };
    });
    r.get('/api/referral', async (req) => {
      const link = await referralLink(req.user!.id);
      const { appLink } = await import('../lib/telegram');
      return { code: link.code, url: appLink(`ref_${link.code}`), visits: await prisma.referralVisit.count({ where: { code: link.code } }) };
    });

    // Апселлы S35 (только при включённом флаге)
    r.get('/api/upsells', async (req) => {
      if (!(await feature('upsells'))) return { items: [] };
      const items = await prisma.upsell.findMany({ where: { active: true }, orderBy: { sort: 'asc' } });
      if (items.length) await track({ userId: req.user!.id, eventName: 'upsell_view', screenId: 'S35' });
      return { items };
    });
    r.post<{ Params: { code: string } }>('/api/upsells/:code/request', async (req) => {
      if (!(await feature('upsells'))) throw forbidden('disabled');
      const u = await prisma.upsell.findUnique({ where: { code: req.params.code } });
      if (!u || !u.active) throw notFound();
      return prisma.upsellRequest.create({ data: { userId: req.user!.id, code: u.code } }).then(jsonSafe);
    });
  });

  /** PNG карточки по подписанной ссылке (нужен публичный URL для shareToStory/downloadFile) */
  app.get<{ Params: { id: string }; Querystring: { s?: string } }>('/api/cards/img/:id.png', async (req, reply) => {
    const sig = cardSig(req.params.id);
    const given = String(req.query.s ?? '');
    if (given.length !== sig.length || !timingSafeEqual(Buffer.from(given), Buffer.from(sig))) throw forbidden();
    const card = await prisma.shareCard.findUnique({ where: { id: req.params.id }, include: { membership: true } });
    if (!card) throw notFound();
    const ref = await referralLink(card.membership.userId);
    const { appLink } = await import('../lib/telegram');
    const png = await renderCardPng(card.stats as Record<string, unknown>, appLink(`ref_${ref.code}`));
    return reply.type('image/png').header('Cache-Control', 'public, max-age=600').send(png);
  });

  /** Webhook бота: проверка секретного заголовка */
  app.post('/api/telegram/webhook', async (req, reply) => {
    if (req.headers['x-telegram-bot-api-secret-token'] !== webhookSecret) return reply.status(401).send();
    try {
      await handleUpdate(req.body as never);
    } catch (e) {
      req.log.error(e as Error);
    }
    return reply.send({ ok: true });
  });
}
