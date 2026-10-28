import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { addDays, assignPlaces, flowBounds, fromDbDate, prizePool, rank, TOPIC_CHATS } from '@thirty/domain';
import { audit, clearSession, can, hashPassword, issueSession, mfaRequired, newTotpSecret, readSession, requireAdmin, requirePerm, verifyPassword, verifyTotp, PERMISSIONS, type Permission } from '../auth/admin';
import { clock } from '../clock';
import { prisma } from '../db';
import { badRequest, forbidden, HttpError, jsonSafe, notFound } from '../http';
import { parse } from '../lib/validate';
import { signedMediaUrl } from '../lib/storage';
import { setHidden } from '../modules/feedChat';
import { normalizeCode } from '../modules/promos';
import { decideStoryRequest } from '../modules/stories';
import { DEFAULT_SETTINGS, getSetting, setSetting, type SettingKey } from '../settings';
import { dashboard, funnel, retention, screens, toCsv } from '../modules/adminAnalytics';
import { cancelAutoRenew, markRefunded } from '../modules/billing';
import { bindChat } from '../modules/chats';
import { ensureFlow, flowInfo } from '../modules/flows';
import { computeLeaderboard, loadFacts, memberStats } from '../modules/rating';
import { dissolvePair } from '../modules/buddy';
import { displayName } from '../modules/users';
import { track } from '../modules/analytics';
import { notify } from '../modules/notify';
import { computeStats } from '@thirty/domain';

function range(q: { from?: string; to?: string }) {
  const to = q.to ? new Date(q.to) : new Date(clock.now().getTime() + 24 * 3600_000);
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 31 * 24 * 3600_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw badRequest('bad_range');
  return { from, to };
}

const perm = (p: Permission) => ({ preHandler: requirePerm(p) });

export async function adminRoutes(app: FastifyInstance) {
  // ───────── Авторизация ─────────
  app.post('/admin-api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const { login, password } = parse(z.object({ login: z.string().min(1).max(64), password: z.string().min(1).max(200) }), req.body);
    const admin = await prisma.adminUser.findUnique({ where: { login } });
    if (!admin || !admin.active || !(await verifyPassword(password, admin.passwordHash))) throw new HttpError(401, 'bad_credentials', 'Неверный логин или пароль');
    if (!mfaRequired(admin)) {
      const { csrf } = issueSession(reply, admin, true);
      await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: clock.now() } });
      return { mfa: 'ok', csrf, role: admin.role };
    }
    if (!admin.totpEnabled) {
      const secret = admin.totpSecret ?? newTotpSecret();
      if (!admin.totpSecret) await prisma.adminUser.update({ where: { id: admin.id }, data: { totpSecret: secret } });
      issueSession(reply, admin, false);
      return { mfa: 'setup', secret, otpauthUrl: `otpauth://totp/30days:${encodeURIComponent(admin.login)}?secret=${secret}&issuer=30days` };
    }
    issueSession(reply, admin, false);
    return { mfa: 'verify' };
  });

  app.post('/admin-api/auth/mfa', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
    const s = readSession(req);
    if (!s) throw new HttpError(401, 'admin_unauthorized');
    const admin = await prisma.adminUser.findUnique({ where: { id: s.sub } });
    if (!admin?.totpSecret || !verifyTotp(admin.totpSecret, code)) throw new HttpError(401, 'bad_code', 'Неверный код');
    if (!admin.totpEnabled) await prisma.adminUser.update({ where: { id: admin.id }, data: { totpEnabled: true } });
    await prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: clock.now() } });
    const { csrf } = issueSession(reply, admin, true);
    await prisma.auditLog.create({ data: { adminId: admin.id, action: 'login', entity: 'admin', entityId: admin.id, ip: req.ip } });
    return { mfa: 'ok', csrf, role: admin.role };
  });

  app.post('/admin-api/auth/logout', async (_req, reply) => {
    clearSession(reply);
    return { ok: true };
  });

  app.register(async (r) => {
    r.addHook('preHandler', requireAdmin);

    r.get('/admin-api/auth/me', async (req) => ({
      id: req.admin!.id,
      login: req.admin!.login,
      role: req.admin!.role,
      csrf: req.adminSession!.csrf,
      permissions: (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(req.admin!.role, p)),
    }));

    // ───────── A01 дашборд, A02 аналитика ─────────
    r.get<{ Querystring: { from?: string; to?: string } }>('/admin-api/dashboard', perm('dashboard'), async (req) => dashboard(range(req.query)));
    r.get<{ Querystring: Record<string, string> }>('/admin-api/analytics/funnel', perm('analytics'), async (req) =>
      jsonSafe(await funnel({ ...range(req.query), tariffId: req.query.tariff || undefined, variant: req.query.variant || undefined, device: req.query.device || undefined })),
    );
    r.get<{ Querystring: Record<string, string> }>('/admin-api/analytics/screens', perm('analytics'), async (req) => screens(range(req.query)));
    r.get<{ Querystring: Record<string, string> }>('/admin-api/analytics/retention', perm('analytics'), async (req) => retention(range(req.query)));
    r.get<{ Querystring: Record<string, string> }>('/admin-api/analytics/events', perm('analytics'), async (req) => {
      const { from, to } = range(req.query);
      const rows = await prisma.analyticsEvent.groupBy({ by: ['eventName'], where: { ts: { gte: from, lt: to } }, _count: { _all: true } });
      return rows.map((x) => ({ event: x.eventName, count: x._count._all })).sort((a, b) => b.count - a.count);
    });

    // ───────── A03 тарифы, таймер, ценность ─────────
    r.get('/admin-api/tariffs', perm('tariffs'), async () => ({
      tariffs: await prisma.tariff.findMany({ orderBy: { sort: 'asc' } }),
      offerMinutes: await getSetting('offer.durationMinutes'),
      value: await getSetting('value.items'),
    }));
    r.patch<{ Params: { id: string } }>('/admin-api/tariffs/:id', perm('tariffs'), async (req) => {
      const body = parse(
        z.object({
          title: z.string().min(1).max(64), promoPrice: z.number().int().min(1), regularPrice: z.number().int().min(1), comparisonMonthPrice: z.number().int().min(1),
          renewalPrice: z.number().int().min(1), goalLimit: z.number().int().min(1).nullable(),
          highlighted: z.boolean(), badge: z.string().max(40).nullable(), features: z.array(z.string().max(200)).max(15), active: z.boolean(),
        }).partial(),
        req.body,
      );
      const before = await prisma.tariff.findUnique({ where: { id: req.params.id } });
      if (!before) throw notFound();
      const after = await prisma.tariff.update({ where: { id: req.params.id }, data: body });
      await audit(req, 'tariff.update', 'tariff', req.params.id, { before, after });
      return after;
    });
    r.put('/admin-api/value-items', perm('tariffs'), async (req) => {
      const items = parse(z.array(z.object({ id: z.string().max(32), title: z.string().max(120), price: z.number().int().min(0), priceLabel: z.string().max(60).optional(), emoji: z.string().max(16).optional(), description: z.string().max(200).optional(), enabled: z.boolean() })).max(20), req.body);
      await audit(req, 'value.update', 'setting', 'value.items', { before: await getSetting('value.items'), after: items });
      await setSetting('value.items', items);
      return { items };
    });

    // ───────── A04 платежи ─────────
    r.get<{ Querystring: { status?: string; userId?: string; cursor?: string; needsRefund?: string } }>('/admin-api/payments', perm('payments'), async (req) => {
      const q = req.query;
      const rows = await prisma.payment.findMany({
        where: {
          ...(q.status ? { status: q.status as never } : {}),
          ...(q.userId && /^\d+$/.test(q.userId) ? { userId: BigInt(q.userId) } : {}),
          ...(q.needsRefund === '1' ? { needsRefund: true } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        include: { user: true },
      });
      return jsonSafe(rows.map((p) => ({ ...p, userName: displayName(p.user), user: undefined, paymentUrl: undefined })));
    });
    r.get('/admin-api/payments/reconcile', perm('payments'), async () => {
      const pendingWindow = await getSetting('payment.pendingWindowMinutes');
      return jsonSafe({
        webhookErrors: await prisma.paymentEvent.findMany({ where: { OR: [{ error: { not: null } }, { signatureValid: false }] }, orderBy: { createdAt: 'desc' }, take: 100 }),
        stuckPending: await prisma.payment.findMany({ where: { status: 'pending', createdAt: { lt: new Date(clock.now().getTime() - pendingWindow * 60_000) } }, orderBy: { createdAt: 'desc' }, take: 100 }),
        needsRefund: await prisma.payment.findMany({ where: { needsRefund: true } }),
        chargeDateSyncErrors: await prisma.billingSchedule.findMany({ where: { syncError: { not: null }, status: 'scheduled' }, take: 100 }),
        disputed: await prisma.payment.findMany({ where: { status: 'disputed' }, take: 100 }),
      });
    });
    r.post<{ Params: { id: string } }>('/admin-api/payments/:id/refund', perm('refunds'), async (req) => {
      const { reason } = parse(z.object({ reason: z.string().min(3).max(500) }), req.body);
      const before = await prisma.payment.findUnique({ where: { id: req.params.id } });
      if (!before) throw notFound();
      if (before.status !== 'paid') throw badRequest('not_paid');
      const res = await markRefunded(req.params.id, 'admin');
      await audit(req, 'payment.refund', 'payment', req.params.id, { before, reason });
      return res;
    });

    /** Пометка тестовой оплаты вручную (например, проверочная боевая оплата владельца) — вместе с её подпиской */
    r.post<{ Params: { id: string } }>('/admin-api/payments/:id/test', perm('payments'), async (req) => {
      const { test } = parse(z.object({ test: z.boolean() }), req.body);
      const p = await prisma.payment.findUnique({ where: { id: req.params.id } });
      if (!p) throw notFound();
      await prisma.payment.update({ where: { id: p.id }, data: { test } });
      if (p.subscriptionId && p.kind === 'initial') await prisma.subscription.update({ where: { id: p.subscriptionId }, data: { test } });
      await audit(req, 'payment.test', 'payment', p.id, { before: { test: p.test }, after: { test } });
      return { ok: true, test };
    });

    // ───────── A05 потоки ─────────
    r.get('/admin-api/flows', perm('flows'), async () => {
      const flows = await prisma.flow.findMany({ orderBy: { startsOn: 'desc' }, include: { chats: true, _count: { select: { memberships: true } } } });
      return jsonSafe(flows.map((f) => ({ ...flowInfo(f), status: f.status, members: f._count.memberships, chat: f.chats.find((c) => c.active) ?? null, finalizedAt: f.finalizedAt })));
    });
    r.post('/admin-api/flows', perm('flows'), async (req) => {
      const { startsOn } = parse(z.object({ startsOn: z.string().regex(/^\d{4}-\d{2}-01$/) }), req.body);
      const f = await ensureFlow(startsOn);
      await audit(req, 'flow.create', 'flow', f.id);
      return jsonSafe(f);
    });

    // ───────── A06 пользователи ─────────
    r.get<{ Querystring: { q?: string; cursor?: string; stage?: string } }>('/admin-api/users', perm('users'), async (req) => {
      const q = req.query.q?.trim();
      const users = await prisma.user.findMany({
        where: {
          ...(q ? { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { username: { contains: q, mode: 'insensitive' } }, ...(/^\d+$/.test(q) ? [{ id: BigInt(q) }] : [])] } : {}),
          ...(req.query.stage ? { onboardingStage: req.query.stage } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        ...(req.query.cursor ? { cursor: { id: BigInt(req.query.cursor) }, skip: 1 } : {}),
        include: { subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      return jsonSafe(users.map((u) => ({ id: u.id, name: displayName(u), username: u.username, city: u.city, stage: u.onboardingStage, createdAt: u.createdAt, subscription: u.subscriptions[0] ? { status: u.subscriptions[0].status, tariffId: u.subscriptions[0].tariffId } : null })));
    });

    /** Карточка пользователя: воронка, экраны, клики по тарифам, оплаты, подписка, потоки, отчёты, согласия, модерация */
    r.post<{ Params: { id: string } }>('/admin-api/users/:id/reset-offer', perm('payments'), async (req) => {
      const r = await prisma.priceOffer.deleteMany({ where: { userId: BigInt(req.params.id), consumedAt: null } });
      await audit(req, 'offer.reset', 'user', req.params.id);
      return { ok: true, removed: r.count };
    });
    r.post<{ Params: { id: string } }>('/admin-api/users/:id/cancel-subscription', perm('payments'), async (req) => {
      const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
      const r = await cancelAutoRenew(BigInt(req.params.id), `support: ${reason}`);
      await audit(req, 'subscription.cancel', 'user', req.params.id, { reason });
      return jsonSafe(r);
    });
    r.get<{ Params: { id: string } }>('/admin-api/users/:id', perm('users'), async (req) => {
      if (!/^\d+$/.test(req.params.id)) throw notFound();
      const id = BigInt(req.params.id);
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) throw notFound();
      const [events, payments, subscriptions, memberships, consents, complaintsAbout, complaintsBy, botLogs, auditRows] = await Promise.all([
        prisma.analyticsEvent.findMany({ where: { userId: id }, orderBy: { ts: 'desc' }, take: 500 }),
        prisma.payment.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' } }),
        prisma.subscription.findMany({ where: { userId: id }, include: { schedule: true }, orderBy: { createdAt: 'desc' } }),
        prisma.flowMembership.findMany({ where: { userId: id }, include: { flow: true, goals: { include: { tasks: true } } }, orderBy: { createdAt: 'desc' } }),
        prisma.consent.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' } }),
        prisma.complaint.findMany({ where: { targetUserId: id } }),
        prisma.complaint.findMany({ where: { reporterId: id } }),
        prisma.botMessageLog.findMany({ where: { userId: id }, orderBy: { sentAt: 'desc' }, take: 100 }),
        prisma.auditLog.findMany({ where: { entity: 'user', entityId: req.params.id }, orderBy: { createdAt: 'desc' } }),
      ]);
      const ms = [];
      for (const m of memberships) {
        const stats = ['active', 'finished'].includes(m.status) ? await memberStats(m.id, m.flow) : null;
        const reports = await prisma.dailyReport.findMany({ where: { membershipId: m.id }, orderBy: { date: 'desc' }, include: { items: { include: { occurrence: { include: { task: true } }, evidence: true } } } });
        ms.push({ ...m, flow: flowInfo(m.flow), stats, reports: reports.map((x) => ({ ...x, date: fromDbDate(x.date), items: x.items.map((i) => ({ task: i.occurrence.task.title, occurrenceId: i.occurrenceId, link: i.link, media: i.evidence.map((e) => signedMediaUrl(e.mediaId)) })) })) });
      }
      const funnelEvents = ['app_open', 'onboarding_step_view', 'value_screen_view', 'tariff_view', 'tariff_select', 'payment_start', 'payment_success', 'registration_completed', 'report_submitted'];
      return jsonSafe({
        user,
        funnel: funnelEvents.map((e) => ({ event: e, first: events.filter((x) => x.eventName === e).at(-1)?.ts ?? null })),
        screens: events.filter((e) => e.eventName === 'screen_view').map((e) => ({ screen: e.screenId, ts: e.ts })),
        tariffClicks: events.filter((e) => e.eventName === 'tariff_select').map((e) => ({ tariff: e.tariffId, ts: e.ts })),
        events: events.slice(0, 200),
        payments,
        subscriptions,
        memberships: ms,
        consents,
        moderation: { complaintsAbout, complaintsBy, audit: auditRows },
        botLogs,
        offers: await prisma.priceOffer.findMany({ where: { userId: id }, orderBy: { startedAt: 'desc' } }),
        promos: await prisma.promoRedemption.findMany({ where: { userId: id }, include: { promo: true }, orderBy: { appliedAt: 'desc' } }),
        stories: await prisma.storyRequest.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' } }),
      });
    });

    // ───────── Промокоды и заявки «сторис» ─────────
    r.get('/admin-api/promos', perm('tariffs'), async () => {
      const promos = await prisma.promo.findMany({ orderBy: [{ kind: 'asc' }, { createdAt: 'desc' }], take: 300, include: { _count: { select: { redemptions: true } } } });
      return jsonSafe(promos.map((p) => ({ ...p, applied: p._count.redemptions })));
    });
    const promoBody = z.object({
      code: z.string().trim().min(2).max(40), window: z.enum(['dates', 'flow_start']), validFrom: z.string().datetime().nullable(), validTo: z.string().datetime().nullable(),
      daysBefore: z.number().int().min(0).max(30), daysAfter: z.number().int().min(0).max(30), maxUses: z.number().int().min(1).nullable(), active: z.boolean(), note: z.string().max(200).nullable(),
    });
    r.post('/admin-api/promos', perm('tariffs'), async (req) => {
      const b = parse(promoBody, req.body);
      const p = await prisma.promo.create({ data: { ...b, code: normalizeCode(b.code), kind: 'public', validFrom: b.validFrom ? new Date(b.validFrom) : null, validTo: b.validTo ? new Date(b.validTo) : null } });
      await audit(req, 'promo.create', 'promo', p.id, { after: p });
      return jsonSafe(p);
    });
    r.patch<{ Params: { id: string } }>('/admin-api/promos/:id', perm('tariffs'), async (req) => {
      const b = parse(promoBody.omit({ code: true }).partial(), req.body);
      const before = await prisma.promo.findUnique({ where: { id: req.params.id } });
      if (!before) throw notFound();
      const data = { ...b, ...(b.validFrom !== undefined ? { validFrom: b.validFrom ? new Date(b.validFrom) : null } : {}), ...(b.validTo !== undefined ? { validTo: b.validTo ? new Date(b.validTo) : null } : {}) };
      const after = await prisma.promo.update({ where: { id: req.params.id }, data });
      await audit(req, 'promo.update', 'promo', after.id, { before, after });
      return jsonSafe(after);
    });
    r.get<{ Querystring: { status?: string } }>('/admin-api/story-requests', perm('moderation'), async (req) => {
      const rows = await prisma.storyRequest.findMany({ where: { status: req.query.status || 'pending' }, orderBy: { createdAt: 'desc' }, take: 200 });
      const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } } });
      return jsonSafe(rows.map((r) => ({ ...r, name: displayName(users.find((u) => u.id === r.userId)!), screenshot: r.mediaId ? signedMediaUrl(r.mediaId) : null })));
    });
    r.post<{ Params: { id: string } }>('/admin-api/story-requests/:id', perm('moderation'), async (req) => {
      const { decision, reason } = parse(z.object({ decision: z.enum(['approve', 'reject']), reason: z.string().trim().min(3).max(300).optional() }), req.body);
      const res = await decideStoryRequest(req.params.id, decision, req.admin!.login, reason);
      await audit(req, `story.${decision}`, 'story_request', req.params.id, { reason });
      return res;
    });

    /** Ручное исправление спорной отметки — только с причиной и записью в журнал */
    r.post<{ Params: { id: string } }>('/admin-api/occurrences/:id', perm('usersEdit'), async (req) => {
      const { status, reason } = parse(z.object({ status: z.enum(['done', 'pending']), reason: z.string().min(5).max(500) }), req.body);
      const before = await prisma.taskOccurrence.findUnique({ where: { id: req.params.id }, include: { membership: true } });
      if (!before) throw notFound();
      const after = await prisma.taskOccurrence.update({ where: { id: req.params.id }, data: { status, doneAt: status === 'done' ? clock.now() : null } });
      await audit(req, 'occurrence.fix', 'user', before.membership.userId.toString(), { before, after, reason });
      return jsonSafe(after);
    });

    // ───────── A07 модерация ─────────
    r.get<{ Querystring: { status?: string } }>('/admin-api/moderation', perm('moderation'), async (req) => {
      const complaints = await prisma.complaint.findMany({ where: { status: req.query.status ?? 'open' }, orderBy: { createdAt: 'desc' }, take: 100, include: { reporter: true } });
      const appeals = await prisma.reportAppeal.findMany({ where: { status: 'open' }, include: { report: { include: { membership: { include: { user: true } } } } } });
      return jsonSafe({ complaints: complaints.map((c) => ({ ...c, reporterName: displayName(c.reporter), reporter: undefined })), appeals });
    });
    r.post<{ Params: { id: string } }>('/admin-api/reports/:id/reject', perm('moderation'), async (req) => {
      const { reason } = parse(z.object({ reason: z.string().min(3).max(500) }), req.body);
      const report = await prisma.dailyReport.findUnique({ where: { id: req.params.id }, include: { items: true, membership: true } });
      if (!report) throw notFound();
      await prisma.$transaction([
        prisma.dailyReport.update({ where: { id: report.id }, data: { status: 'rejected', rejectReason: reason } }),
        prisma.taskOccurrence.updateMany({ where: { id: { in: report.items.map((i) => i.occurrenceId) } }, data: { status: 'pending', doneAt: null } }),
      ]);
      await audit(req, 'report.reject', 'report', report.id, { reason });
      await track({ userId: report.membership.userId, eventName: 'report_rejected', flowId: report.membership.flowId, metadata: { reason } });
      return { ok: true };
    });
    r.post<{ Params: { id: string } }>('/admin-api/appeals/:id', perm('moderation'), async (req) => {
      const { decision, comment } = parse(z.object({ decision: z.enum(['approved', 'rejected']), comment: z.string().min(3).max(500) }), req.body);
      const appeal = await prisma.reportAppeal.findUnique({ where: { id: req.params.id }, include: { report: { include: { items: true } } } });
      if (!appeal || appeal.status !== 'open') throw notFound();
      await prisma.$transaction(async (tx) => {
        await tx.reportAppeal.update({ where: { id: appeal.id }, data: { status: decision, decision: comment, decidedBy: req.admin!.id } });
        if (decision === 'approved') {
          await tx.dailyReport.update({ where: { id: appeal.reportId }, data: { status: 'accepted', late: true, rejectReason: null } });
          await tx.taskOccurrence.updateMany({ where: { id: { in: appeal.report.items.map((i) => i.occurrenceId) } }, data: { status: 'done', doneAt: clock.now() } });
        }
      });
      await audit(req, `appeal.${decision}`, 'report', appeal.reportId, { reason: comment });
      return { ok: true };
    });
    r.post<{ Params: { id: string } }>('/admin-api/complaints/:id', perm('moderation'), async (req) => {
      const { status, resolution } = parse(z.object({ status: z.enum(['resolved', 'dismissed']), resolution: z.string().min(3).max(500) }), req.body);
      const c = await prisma.complaint.update({ where: { id: req.params.id }, data: { status, resolution } });
      await audit(req, 'complaint.resolve', 'complaint', c.id, { after: c });
      return jsonSafe(c);
    });
    r.post<{ Params: { id: string } }>('/admin-api/comments/:id/hide', perm('moderation'), async (req) => {
      const c = await prisma.reportComment.update({ where: { id: req.params.id }, data: { hidden: true } });
      await audit(req, 'comment.hide', 'comment', c.id);
      return { ok: true };
    });

    r.get<{ Querystring: { flowId?: string } }>('/admin-api/feed', perm('moderation'), async (req) => {
      const rows = await prisma.feedMessage.findMany({ where: req.query.flowId ? { flowId: req.query.flowId } : {}, orderBy: { createdAt: 'desc' }, take: 200, include: { user: true } });
      return jsonSafe({ messages: rows.map((m) => ({ id: m.id, flowId: m.flowId, userId: m.userId, name: displayName(m.user), text: m.text, reportId: m.reportId, hidden: m.hidden, createdAt: m.createdAt })) });
    });
    r.post<{ Params: { id: string } }>('/admin-api/feed/:id/hide', perm('moderation'), async (req) => {
      const { hidden } = parse(z.object({ hidden: z.boolean().default(true) }), req.body ?? {});
      const m = await setHidden(req.params.id, hidden);
      await audit(req, hidden ? 'feed.hide' : 'feed.unhide', 'feed_message', m.id);
      return { ok: true };
    });

    // ───────── A08 рейтинг и правила ─────────
    r.get<{ Params: { flowId: string } }>('/admin-api/leaderboard/:flowId', perm('rating'), async (req) => {
      const rows = await computeLeaderboard(req.params.flowId);
      const revenue = await prisma.payment.aggregate({ where: { status: 'paid', test: false, coversFromFlow: (await prisma.flow.findUniqueOrThrow({ where: { id: req.params.flowId } })).startsOn }, _sum: { amount: true } });
      const formula = await getSetting('prize.formula');
      return { rows, prizePool: prizePool(revenue._sum.amount ?? 0, formula), confirmedRevenue: revenue._sum.amount ?? 0, formula };
    });
    r.get('/admin-api/rules', perm('rating'), async () => ({ rulesText: await getSetting('prize.rulesText'), formula: await getSetting('prize.formula'), evidencePolicy: await getSetting('evidence.policy') }));
    r.put('/admin-api/rules', perm('settings'), async (req) => {
      const body = parse(
        z.object({
          rulesText: z.string().min(20).max(5000).optional(),
          formula: z.object({ percentOfRevenue: z.number().min(0).max(100), fixed: z.number().int().min(0), cap: z.number().int().min(0).nullable() }).optional(),
          evidencePolicy: z.record(z.object({ evidence: z.enum(['checkbox', 'photo', 'screenshot', 'checkbox_photo', 'link']), photoRequired: z.boolean(), selfReported: z.boolean(), note: z.string().max(300) })).optional(),
        }),
        req.body,
      );
      if (body.rulesText) await setSetting('prize.rulesText', body.rulesText);
      if (body.formula) await setSetting('prize.formula', body.formula);
      if (body.evidencePolicy) await setSetting('evidence.policy', body.evidencePolicy as never);
      await audit(req, 'rules.update', 'setting', 'rules', { after: body });
      return { ok: true };
    });

    // ───────── A09 претенденты на приз ─────────
    r.get<{ Querystring: { flowId?: string; status?: string } }>('/admin-api/prizes', perm('prizes'), async (req) => {
      const rows = await prisma.prizeCandidate.findMany({
        where: { ...(req.query.flowId ? { flowId: req.query.flowId } : {}), ...(req.query.status ? { status: req.query.status as never } : {}) },
        include: { flow: true, reviews: { orderBy: { createdAt: 'desc' } } },
        orderBy: { createdAt: 'asc' },
      });
      const users = await prisma.user.findMany({ where: { id: { in: rows.map((x) => x.userId) } } });
      return jsonSafe(rows.map((c) => ({ ...c, flow: { id: c.flow.id, title: c.flow.title }, name: displayName(users.find((u) => u.id === c.userId)!) })));
    });
    /** Полный просмотр доказательств претендента: календарь, все отчёты, цели и критерии, «ДО» и «ПОСЛЕ» */
    r.get<{ Params: { id: string } }>('/admin-api/prizes/:id', perm('prizes'), async (req) => {
      const c = await prisma.prizeCandidate.findUnique({ where: { id: req.params.id }, include: { reviews: { orderBy: { createdAt: 'asc' } }, flow: true } });
      if (!c) throw notFound();
      const m = await prisma.flowMembership.findUniqueOrThrow({ where: { userId_flowId: { userId: c.userId, flowId: c.flowId } }, include: { goals: { include: { tasks: true } }, beforeAfter: true, user: true } });
      const facts = await loadFacts(m.id, c.flow);
      const stats = computeStats({ ...facts, today: facts.today > facts.flowEnd ? addDays(facts.flowEnd, 1) : facts.today });
      const reports = await prisma.dailyReport.findMany({ where: { membershipId: m.id }, orderBy: { date: 'asc' }, include: { items: { include: { evidence: { include: { media: true } }, occurrence: { include: { task: { include: { goal: true } } } } } } } });
      return jsonSafe({
        candidate: c,
        user: { id: m.user.id, name: displayName(m.user), username: m.user.username },
        calendar: stats.days,
        stats: { completed: stats.completed, scheduled: facts.occurrences.length, missedReports: stats.missedReports, successfulDays: stats.successfulDays },
        goals: m.goals.map((g) => ({ title: g.title, category: g.category, criterion: g.successCriterion, finalAchieved: g.finalAchieved, finalComment: g.finalComment, tasks: g.tasks.map((t) => ({ title: t.title, frequency: t.frequency, n: t.n, evidence: t.evidence, criteria: t.criteria, selfReported: t.selfReported })) })),
        before: m.beforeAfter.find((b) => b.phase === 'before') ? { ...m.beforeAfter.find((b) => b.phase === 'before')!, media: m.beforeAfter.find((b) => b.phase === 'before')!.mediaIds.map((id) => signedMediaUrl(id)) } : null,
        after: m.beforeAfter.find((b) => b.phase === 'after') ? { ...m.beforeAfter.find((b) => b.phase === 'after')!, media: m.beforeAfter.find((b) => b.phase === 'after')!.mediaIds.map((id) => signedMediaUrl(id)) } : null,
        reports: reports.map((x) => ({
          id: x.id, date: fromDbDate(x.date), createdAt: x.createdAt, text: x.text, status: x.status, late: x.late,
          items: x.items.map((i) => ({ itemId: i.id, task: i.occurrence.task.title, goal: i.occurrence.task.goal.title, selfReported: i.occurrence.task.selfReported, link: i.link, note: i.note, flagged: i.flagged, media: i.evidence.map((e) => signedMediaUrl(e.mediaId)) })),
        })),
      });
    });
    r.post<{ Params: { id: string } }>('/admin-api/prizes/:id/decision', perm('prizes'), async (req) => {
      const { decision, reason } = parse(z.object({ decision: z.enum(['approve', 'reject', 'appeal_open', 'appeal_approve', 'appeal_reject']), reason: z.string().trim().min(5, 'Причина обязательна').max(1000) }), req.body);
      const c = await prisma.prizeCandidate.findUnique({ where: { id: req.params.id } });
      if (!c) throw notFound();
      const allowed: Record<string, string[]> = {
        approve: ['awaiting_review'], reject: ['awaiting_review'], appeal_open: ['rejected'], appeal_approve: ['appealed'], appeal_reject: ['appealed'],
      };
      if (!allowed[decision].includes(c.status)) throw badRequest('bad_transition', `Из статуса ${c.status} действие недоступно`);
      const status = { approve: 'approved', reject: 'rejected', appeal_open: 'appealed', appeal_approve: 'approved', appeal_reject: 'rejected' }[decision] as 'approved';
      await prisma.$transaction([
        prisma.prizeCandidate.update({ where: { id: c.id }, data: { status, ...(status !== 'approved' ? { place: null } : {}) } }),
        prisma.prizeReview.create({ data: { candidateId: c.id, adminId: req.admin!.id, decision, reason } }),
      ]);
      await audit(req, `prize.${decision}`, 'prize', c.id, { before: c, reason });
      return { status };
    });
    /** Флаг подозрительного доказательства (без автоматических выводов по фото) */
    r.post<{ Params: { itemId: string } }>('/admin-api/report-items/:itemId/flag', perm('prizes'), async (req) => {
      const { flagged, reason } = parse(z.object({ flagged: z.boolean(), reason: z.string().min(3).max(500) }), req.body);
      await prisma.reportItem.update({ where: { id: req.params.itemId }, data: { flagged } });
      await audit(req, 'evidence.flag', 'report_item', req.params.itemId, { after: { flagged }, reason });
      return { ok: true };
    });
    /** Итоговый список: максимум 3 места среди проверенных по объективному тай-брейку (без жеребьёвки) */
    r.post<{ Params: { flowId: string } }>('/admin-api/prizes/flow/:flowId/places', perm('prizes'), async (req) => {
      const approved = await prisma.prizeCandidate.findMany({ where: { flowId: req.params.flowId, status: 'approved' } });
      const ranked = rank(approved.map((a) => ({ userId: a.userId.toString(), id: a.id, ...(a.tiebreak as { ratio: number; successfulDays: number; longestStreak: number; finalSubmittedAt: string | null }) })));
      const { winners, outcome } = assignPlaces(ranked);
      await prisma.$transaction([
        prisma.prizeCandidate.updateMany({ where: { flowId: req.params.flowId }, data: { place: null } }),
        ...winners.map((w) => prisma.prizeCandidate.update({ where: { id: w.id }, data: { place: w.place } })),
      ]);
      await audit(req, 'prize.places', 'flow', req.params.flowId, { after: winners });
      return { outcome, winners, approvedCount: approved.length, note: approved.length > 3 ? 'Проверенных идеальных участников больше трёх: места определены объективным тай-брейком. Случайная жеребьёвка выключена до юридического одобрения.' : null };
    });

    // ───────── A10 бадди ─────────
    r.get<{ Querystring: { flowId?: string } }>('/admin-api/buddy', perm('buddy'), async (req) => {
      const pairs = await prisma.buddyPair.findMany({ where: req.query.flowId ? { flowId: req.query.flowId } : {}, orderBy: { createdAt: 'desc' }, take: 300 });
      const replacements = await prisma.buddyReplacement.findMany({ where: { status: 'open' }, orderBy: { createdAt: 'desc' } });
      let waiting: unknown[] = [];
      if (req.query.flowId) {
        const assigned = new Set((await prisma.buddyAssignment.findMany({ where: { flowId: req.query.flowId } })).map((a) => a.userId.toString()));
        const members = await prisma.flowMembership.findMany({ where: { flowId: req.query.flowId, status: { in: ['reserved', 'registered', 'active'] } }, include: { user: true } });
        waiting = members.filter((m) => !assigned.has(m.userId.toString())).map((m) => ({ id: m.userId, name: displayName(m.user), interests: m.user.interests }));
      }
      return jsonSafe({ pairs, replacements, waiting });
    });
    r.post<{ Params: { id: string } }>('/admin-api/buddy/:id/dissolve', perm('buddy'), async (req) => {
      const { reason } = parse(z.object({ reason: z.string().min(3).max(500) }), req.body);
      await dissolvePair(req.params.id, 'approved', req.admin!.id);
      await audit(req, 'buddy.dissolve', 'buddy_pair', req.params.id, { reason });
      return { ok: true };
    });

    // ───────── A11 чаты ─────────
    r.get('/admin-api/chats', perm('chats'), async () => jsonSafe({ chats: await prisma.telegramChat.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { memberships: true } } } }), topics: TOPIC_CHATS }));
    r.post<{ Params: { id: string } }>('/admin-api/chats/:id/bind', perm('chats'), async (req) => {
      const body = parse(z.union([z.object({ kind: z.literal('flow'), flowId: z.string().uuid() }), z.object({ kind: z.literal('topic'), topic: z.string() })]), req.body);
      const c = await bindChat(req.params.id, body);
      await audit(req, 'chat.bind', 'chat', c.id, { after: body });
      return jsonSafe(c);
    });
    r.post<{ Params: { id: string } }>('/admin-api/chats/:id/unbind', perm('chats'), async (req) => {
      const c = await prisma.telegramChat.update({ where: { id: req.params.id }, data: { active: false } });
      await audit(req, 'chat.unbind', 'chat', c.id);
      return jsonSafe(c);
    });

    // ───────── A12 созвоны и эксперты (эксперт видит только свои встречи) ─────────
    const meetingScope = async (req: FastifyRequest) => {
      if (req.admin!.role !== 'expert') return {};
      const expert = await prisma.expert.findUnique({ where: { adminUserId: req.admin!.id } });
      if (!expert) throw forbidden('no_expert_profile');
      return { expertId: expert.id };
    };
    r.get('/admin-api/meetings', perm('meetings'), async (req) => {
      const scope = await meetingScope(req);
      const meetings = await prisma.meeting.findMany({ where: scope, orderBy: { startsAt: 'desc' }, take: 200, include: { expert: true, _count: { select: { attendances: true } } } });
      const reviews = await prisma.review.groupBy({ by: ['meetingId'], where: { trigger: 'meeting', meetingId: { in: meetings.map((m) => m.id) } }, _count: { _all: true }, _avg: { rating: true } });
      return jsonSafe({ meetings: meetings.map((m) => ({ ...m, feedback: reviews.find((r) => r.meetingId === m.id) ?? null })), experts: req.admin!.role === 'expert' ? [] : await prisma.expert.findMany() });
    });
    const meetingInput = z.object({
      expertId: z.string().uuid().nullable().optional(),
      direction: z.enum(['money', 'english', 'habits', 'blog', 'weightloss']),
      title: z.string().min(3).max(120),
      description: z.string().max(2000).optional(),
      startsAt: z.string().datetime(),
      durationMin: z.number().int().min(15).max(240).default(60),
      joinUrl: z.string().url().optional(),
    });
    r.post('/admin-api/meetings', perm('meetings'), async (req) => {
      const body = parse(meetingInput, req.body);
      const scope = await meetingScope(req);
      const m = await prisma.meeting.create({ data: { ...body, startsAt: new Date(body.startsAt), ...(scope.expertId ? { expertId: scope.expertId } : {}) } });
      await audit(req, 'meeting.create', 'meeting', m.id, { after: m });
      return jsonSafe(m);
    });
    r.patch<{ Params: { id: string } }>('/admin-api/meetings/:id', perm('meetings'), async (req) => {
      const body = parse(meetingInput.partial().extend({ status: z.enum(['scheduled', 'done', 'canceled']).optional(), nextStep: z.string().max(2000).optional(), expertReport: z.string().max(5000).optional(), stats: z.record(z.unknown()).optional() }), req.body);
      const scope = await meetingScope(req);
      const before = await prisma.meeting.findFirst({ where: { id: req.params.id, ...scope } });
      if (!before) throw notFound();
      const m = await prisma.meeting.update({ where: { id: before.id }, data: { ...body, startsAt: body.startsAt ? new Date(body.startsAt) : undefined, stats: body.stats as object | undefined } });
      await audit(req, 'meeting.update', 'meeting', m.id, { before, after: m });
      return jsonSafe(m);
    });
    r.get<{ Params: { id: string } }>('/admin-api/meetings/:id/attendance', perm('meetings'), async (req) => {
      const scope = await meetingScope(req);
      const m = await prisma.meeting.findFirst({ where: { id: req.params.id, ...scope } });
      if (!m) throw notFound();
      const rows = await prisma.attendance.findMany({ where: { meetingId: m.id }, include: { user: true } });
      return jsonSafe(rows.map((a) => ({ userId: a.userId, name: displayName(a.user), joinClickedAt: a.joinClickedAt, attended: a.attended })));
    });
    r.post('/admin-api/experts', perm('settings'), async (req) => {
      const body = parse(z.object({ name: z.string().min(2).max(80), direction: z.enum(['money', 'english', 'habits', 'blog', 'weightloss']), bio: z.string().max(1000).optional(), photoUrl: z.string().url().optional(), adminUserId: z.string().uuid().optional() }), req.body);
      const e = await prisma.expert.create({ data: body });
      await audit(req, 'expert.create', 'expert', e.id, { after: e });
      return e;
    });

    // ───────── A13 отзывы и кейсы ─────────
    r.get<{ Querystring: { trigger?: string; allowed?: string; category?: string } }>('/admin-api/reviews', perm('reviews'), async (req) => {
      const rows = await prisma.review.findMany({
        where: {
          ...(req.query.trigger ? { trigger: req.query.trigger } : {}),
          ...(req.query.allowed === '1' ? { consentRevokedAt: null, OR: [{ allowText: true }, { allowPhoto: true }] } : {}),
        },
        include: { user: { include: { memberships: { include: { goals: true }, orderBy: { createdAt: 'desc' }, take: 1 } } } },
        orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
        take: 300,
      });
      const filtered = req.query.category ? rows.filter((r) => r.user.memberships[0]?.goals.some((g) => g.category === req.query.category)) : rows;
      return jsonSafe(
        filtered.map((r) => ({
          ...r,
          name: r.allowName ? displayName(r.user) : `Участник #${r.userId.toString().slice(-4)}`,
          categories: [...new Set(r.user.memberships[0]?.goals.map((g) => g.category) ?? [])],
          media: r.allowPhoto && !r.consentRevokedAt ? r.mediaIds.map((id) => signedMediaUrl(id)) : [],
          user: undefined,
        })),
      );
    });
    r.post<{ Params: { id: string } }>('/admin-api/reviews/:id/feature', perm('reviews'), async (req) => {
      const { featured } = parse(z.object({ featured: z.boolean() }), req.body);
      const rv = await prisma.review.findUnique({ where: { id: req.params.id } });
      if (!rv) throw notFound();
      if (featured && (rv.consentRevokedAt || !rv.allowText)) throw badRequest('no_consent', 'Нет согласия на публикацию текста');
      await prisma.review.update({ where: { id: rv.id }, data: { featured } });
      await audit(req, 'review.feature', 'review', rv.id, { after: { featured } });
      return { ok: true };
    });

    // ───────── A14 бот ─────────
    r.get('/admin-api/bot/templates', perm('bot'), async () => {
      const templates = await prisma.botMessageTemplate.findMany({ orderBy: { key: 'asc' } });
      const stats = await prisma.botMessageLog.groupBy({ by: ['templateKey', 'status'], _count: { _all: true } });
      const clicks = await prisma.botMessageLog.groupBy({ by: ['templateKey'], where: { clickedAt: { not: null } }, _count: { _all: true } });
      const conv = await prisma.botMessageLog.groupBy({ by: ['templateKey'], where: { convertedAt: { not: null } }, _count: { _all: true } });
      return templates.map((t) => ({
        ...t,
        stats: {
          sent: stats.find((s) => s.templateKey === t.key && s.status === 'sent')?._count._all ?? 0,
          failed: stats.find((s) => s.templateKey === t.key && s.status === 'failed')?._count._all ?? 0,
          clicks: clicks.find((s) => s.templateKey === t.key)?._count._all ?? 0,
          conversions: conv.find((s) => s.templateKey === t.key)?._count._all ?? 0,
        },
      }));
    });
    r.patch<{ Params: { key: string } }>('/admin-api/bot/templates/:key', perm('bot'), async (req) => {
      const body = parse(
        z.object({
          title: z.string().max(120), text: z.string().min(1).max(4000), buttons: z.array(z.object({ text: z.string().min(1).max(64), screen: z.string().regex(/^[a-z_]{1,24}$/) })).max(3),
          enabled: z.boolean(), isMarketing: z.boolean(), delayMinutes: z.number().int().min(0).max(10080), capHours: z.number().int().min(0).max(720), priority: z.number().int().min(0).max(100), approved: z.boolean(), imageUrl: z.string().max(500).nullable(),
        }).partial(),
        req.body,
      );
      const before = await prisma.botMessageTemplate.findUnique({ where: { key: req.params.key } });
      if (!before) throw notFound();
      const after = await prisma.botMessageTemplate.update({ where: { key: req.params.key }, data: body });
      await audit(req, 'bot.template', 'bot_template', req.params.key, { before, after });
      return after;
    });
    r.post<{ Params: { key: string } }>('/admin-api/bot/templates/:key/test', perm('bot'), async (req) => {
      const { userId } = parse(z.object({ userId: z.string().regex(/^\d+$/) }), req.body);
      const { sendTemplate } = await import('../modules/bot');
      const { priceVars } = await import('../jobs/chains');
      return { result: await sendTemplate(BigInt(userId), req.params.key, await priceVars(), `test:${req.params.key}:${Date.now()}`) };
    });
    r.get('/admin-api/bot/logs', perm('bot'), async () => jsonSafe(await prisma.botMessageLog.findMany({ orderBy: { sentAt: 'desc' }, take: 300 })));

    // ───────── A15 апселлы ─────────
    r.get('/admin-api/upsells', perm('upsells'), async () => jsonSafe({ items: await prisma.upsell.findMany({ orderBy: { sort: 'asc' } }), requests: await prisma.upsellRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }) }));
    r.patch<{ Params: { code: string } }>('/admin-api/upsells/:code', perm('upsells'), async (req) => {
      const body = parse(z.object({ title: z.string().max(80), price: z.number().int().min(0), description: z.string().max(2000), disclaimer: z.string().max(500).nullable(), active: z.boolean() }).partial(), req.body);
      const after = await prisma.upsell.update({ where: { code: req.params.code }, data: body });
      await audit(req, 'upsell.update', 'upsell', req.params.code, { after });
      return after;
    });

    // ───────── A16 настройки, роли, журнал ─────────
    r.get('/admin-api/settings', perm('settings'), async () => {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) out[k] = await getSetting(k);
      return out;
    });
    r.put<{ Params: { key: string } }>('/admin-api/settings/:key', perm('settings'), async (req) => {
      const key = req.params.key as SettingKey;
      if (!(key in DEFAULT_SETTINGS)) throw notFound();
      const value = (req.body as { value: unknown }).value;
      const def = DEFAULT_SETTINGS[key];
      if (typeof def !== typeof value || Array.isArray(def) !== Array.isArray(value)) throw badRequest('bad_type');
      const before = await getSetting(key);
      await setSetting(key, value as never);
      await audit(req, 'setting.update', 'setting', key, { before, after: value });
      return { ok: true };
    });
    r.get('/admin-api/admins', perm('roles'), async () => (await prisma.adminUser.findMany()).map((a) => ({ id: a.id, login: a.login, role: a.role, active: a.active, totpEnabled: a.totpEnabled, lastLoginAt: a.lastLoginAt })));
    r.post('/admin-api/admins', perm('roles'), async (req) => {
      const body = parse(z.object({ login: z.string().min(3).max(64), password: z.string().min(12).max(200), role: z.enum(['owner', 'admin', 'moderator', 'expert', 'support', 'analyst']) }), req.body);
      const a = await prisma.adminUser.create({ data: { login: body.login, role: body.role, passwordHash: await hashPassword(body.password) } });
      await audit(req, 'admin.create', 'admin', a.id, { after: { login: a.login, role: a.role } });
      return { id: a.id };
    });
    r.patch<{ Params: { id: string } }>('/admin-api/admins/:id', perm('roles'), async (req) => {
      const body = parse(z.object({ role: z.enum(['owner', 'admin', 'moderator', 'expert', 'support', 'analyst']), active: z.boolean(), resetMfa: z.boolean() }).partial(), req.body);
      if (req.params.id === req.admin!.id && body.active === false) throw badRequest('self_disable');
      const a = await prisma.adminUser.update({ where: { id: req.params.id }, data: { role: body.role, active: body.active, ...(body.resetMfa ? { totpEnabled: false, totpSecret: null } : {}) } });
      await audit(req, 'admin.update', 'admin', a.id, { after: body });
      return { ok: true };
    });
    r.get<{ Querystring: { entity?: string } }>('/admin-api/audit', perm('audit'), async (req) => jsonSafe(await prisma.auditLog.findMany({ where: req.query.entity ? { entity: req.query.entity } : {}, orderBy: { createdAt: 'desc' }, take: 300 })));

    // ───────── A17 A/B-тесты ─────────
    r.get('/admin-api/experiments', perm('experiments'), async () => {
      const exps = await prisma.experiment.findMany();
      const counts = await prisma.experimentAssignment.groupBy({ by: ['experimentKey', 'variant'], _count: { _all: true } });
      return exps.map((e) => ({ ...e, assignments: counts.filter((c) => c.experimentKey === e.key).map((c) => ({ variant: c.variant, users: c._count._all })) }));
    });
    r.put<{ Params: { key: string } }>('/admin-api/experiments/:key', perm('experiments'), async (req) => {
      const body = parse(z.object({ title: z.string().min(2).max(120), variants: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]{1,24}$/), weight: z.number().min(0).max(100) })).min(2).max(5), active: z.boolean() }), req.body);
      const e = await prisma.experiment.upsert({ where: { key: req.params.key }, create: { key: req.params.key, ...body }, update: body });
      await audit(req, 'experiment.upsert', 'experiment', e.key, { after: e });
      return e;
    });

    // ───────── Экспорт CSV ─────────
    r.get<{ Params: { entity: string }; Querystring: Record<string, string> }>('/admin-api/export/:entity', perm('export'), async (req, reply) => {
      const { from, to } = range(req.query);
      let rows: Record<string, unknown>[] = [];
      if (req.params.entity === 'payments') rows = (await prisma.payment.findMany({ where: { createdAt: { gte: from, lt: to } } })).map((p) => ({ id: p.id, userId: p.userId.toString(), kind: p.kind, tariff: p.tariffId, amount: p.amount, status: p.status, paidAt: p.paidAt, refundedAt: p.refundedAt, createdAt: p.createdAt }));
      else if (req.params.entity === 'users') rows = (await prisma.user.findMany({ where: { createdAt: { gte: from, lt: to } } })).map((u) => ({ id: u.id.toString(), name: displayName(u), username: u.username, city: u.city, stage: u.onboardingStage, createdAt: u.createdAt }));
      else if (req.params.entity === 'reviews') rows = (await prisma.review.findMany({ where: { createdAt: { gte: from, lt: to }, consentRevokedAt: null, OR: [{ allowText: true }, { allowPhoto: true }] } })).map((r) => ({ id: r.id, userId: r.userId.toString(), trigger: r.trigger, rating: r.rating, changes: r.allowText ? r.changes : '', result: r.allowText ? r.result : '', allowName: r.allowName, allowPhoto: r.allowPhoto, createdAt: r.createdAt }));
      else if (req.params.entity === 'events') rows = (await prisma.analyticsEvent.findMany({ where: { ts: { gte: from, lt: to } }, take: 100_000, orderBy: { ts: 'asc' } })).map((e) => ({ event_id: e.eventId, user_id: e.userId?.toString() ?? '', session_id: e.sessionId, flow_id: e.flowId, screen_id: e.screenId, event_name: e.eventName, timestamp: e.ts, tariff_id: e.tariffId, experiment_variant: e.variant, metadata: e.metadata }));
      else throw notFound();
      await audit(req, 'export', req.params.entity, null, { after: { from, to, rows: rows.length } });
      return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${req.params.entity}.csv"`).send(toCsv(rows));
    });
  });
}

export { flowBounds };
