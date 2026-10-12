import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SPHERE_IDS } from '@rostok/shared';
import { config } from './config.js';
import { pool } from './db.js';
import { AppError } from './errors.js';
import { loginDemo, loginTelegram, userFromToken } from './auth.js';
import { trackClient, track } from './analytics.js';
import { getValue } from './appConfig.js';
import { getGarden, getTree, recordOpen, water } from './services/garden.js';
import { addReward, claimReward, completeTask, createTask, deleteTask, getTaskView, habitCheckin, listTasks, taskHistory, updateTask } from './services/tasks.js';
import { acceptRetentionOffer, assertPlanId, availablePlans, cancelInfo, cancelSubscription, checkout, getEntitlement, mockConfirm, subscriptionState } from './services/subscription.js';
import { createChallenge, createInvite, joinChallenge, leaveChallenge, listChallenges, previewInvite } from './services/challenges.js';
import { me, stats, updateOnboarding, updateSettings } from './services/profile.js';
import { handleUpdate, webhookSecret } from './telegram.js';
import * as admin from './admin/admin.js';

declare module 'fastify' {
  interface FastifyRequest { userId: number; admin: admin.Admin }
}

const bearer = (r: FastifyRequest) => r.headers.authorization?.replace(/^Bearer\s+/i, '') || undefined;
const idParam = (r: FastifyRequest) => {
  const id = Number((r.params as any).id);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'bad_id', 'Некорректный id');
  return id;
};

const sphereEnum = z.enum(SPHERE_IDS as [string, ...string[]]);
const taskSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(1000).nullish(),
  sphere: sphereEnum,
  kind: z.enum(['daily', 'weekly', 'once', 'habit']),
  timesPerWeek: z.number().int().nullish(),
  drops: z.number().int(),
  hardcore: z.boolean(),
  penaltyDrops: z.number().int().nullish(),
  deadlineAt: z.string().max(40).nullish(),
  habitQuestion: z.string().max(200).nullish(),
  habitMissingPenaltyConsent: z.boolean().optional(),
  rewards: z.array(z.object({ threshold: z.number().int(), title: z.string().max(200) })).max(20).optional(),
});
const patchSchema = z.object({
  title: z.string().max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  sphere: sphereEnum.optional(),
  timesPerWeek: z.number().int().optional(),
  drops: z.number().int().optional(),
  hardcore: z.boolean().optional(),
  penaltyDrops: z.number().int().nullable().optional(),
  deadlineAt: z.string().max(40).optional(),
  habitQuestion: z.string().max(200).optional(),
  habitMissingPenaltyConsent: z.boolean().optional(),
});

export async function registerRoutes(app: FastifyInstance) {
  const auth = async (req: FastifyRequest) => {
    const u = await userFromToken(bearer(req));
    if (!u) throw new AppError(401, 'unauthorized', 'Нужно войти заново');
    req.userId = u.id;
  };
  /** Платные действия: только при серверно подтверждённом доступе. */
  const paid = async (req: FastifyRequest) => {
    await auth(req);
    const { access } = await getEntitlement(pool, req.userId);
    if (!access) throw new AppError(402, 'subscription_required', 'Нужна активная подписка');
  };
  const adminAuth = (perm: admin.Perm) => async (req: FastifyRequest) => {
    const a = await admin.adminFromToken(bearer(req));
    if (!a) throw new AppError(401, 'unauthorized', 'Нужно войти');
    if (!(admin.PERMS[perm] as readonly string[]).includes(a.role)) throw new AppError(403, 'forbidden', 'Недостаточно прав');
    req.admin = a;
  };

  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true, env: config.appEnv };
  });

  app.get('/api/config/public', async () => ({
    brand: await getValue('brand'),
    onboarding: await getValue('onboarding'),
    paywall: await getValue('paywall'),
    flags: await getValue('flags'),
    assets: await getValue('asset_manifest'),
    demoLogin: config.demoLogin,
    env: config.appEnv,
    botUsername: config.botUsername || null,
    supportUsername: config.supportUsername || null,
  }));

  // ---------------------------------------------------------------- auth
  app.post('/api/auth/telegram', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ initData: z.string().min(1).max(8192), timezone: z.string().max(64).optional() }).parse(req.body);
    const r = await loginTelegram(b.initData, b.timezone);
    return { token: r.token };
  });
  app.post('/api/auth/demo', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ deviceId: z.string().max(64), timezone: z.string().max(64).optional(), name: z.string().max(40).optional() }).parse(req.body);
    const r = await loginDemo(b.deviceId, b.timezone, b.name);
    return { token: r.token };
  });

  app.get('/api/me', { preHandler: auth }, async (req) => me(req.userId));
  app.post('/api/me/open', { preHandler: auth }, async (req) => {
    const s = await recordOpen(req.userId);
    return { streak: s };
  });
  app.patch('/api/settings', { preHandler: auth }, async (req) => updateSettings(req.userId, req.body ?? {}));
  app.post('/api/onboarding', { preHandler: auth }, async (req) => {
    const b = z.object({
      step: z.string().max(20).optional(), slidesSeen: z.number().int().min(0).max(10).optional(),
      tutorialCompleted: z.boolean().optional(), spheres: z.array(z.string()).max(6).optional(), paywallSeen: z.boolean().optional(),
    }).parse(req.body);
    return updateOnboarding(req.userId, b);
  });
  app.post('/api/events', { preHandler: auth, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ events: z.array(z.object({ id: z.string().uuid(), name: z.string().max(40), props: z.record(z.any()).optional() })).max(20) }).parse(req.body);
    for (const e of b.events) await trackClient(req.userId, e.id, e.name, e.props ?? {});
    return { ok: true };
  });

  // ---------------------------------------------------------------- подписка
  app.get('/api/subscription/plans', { preHandler: auth }, async (req) => ({ plans: await availablePlans(req.userId) }));
  app.get('/api/subscription', { preHandler: auth }, async (req) => subscriptionState(req.userId));
  app.post('/api/subscription/checkout', { preHandler: auth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ planId: z.string() }).parse(req.body);
    return checkout(req.userId, assertPlanId(b.planId));
  });
  app.post('/api/subscription/mock/confirm', { preHandler: auth }, async (req) => {
    const b = z.object({ intentId: z.string().uuid() }).parse(req.body);
    await mockConfirm(req.userId, b.intentId);
    return subscriptionState(req.userId);
  });
  app.get('/api/subscription/cancel-info', { preHandler: auth }, async (req) => {
    await track(pool, req.userId, 'subscription_cancel_attempt', {});
    return cancelInfo(req.userId);
  });
  app.post('/api/subscription/cancel', { preHandler: auth }, async (req) => cancelSubscription(req.userId));
  app.post('/api/subscription/accept-retention-offer', { preHandler: auth }, async (req) => acceptRetentionOffer(req.userId));

  // ---------------------------------------------------------------- сад
  app.get('/api/garden', { preHandler: paid }, async (req) => getGarden(req.userId));
  app.get('/api/trees/:sphere', { preHandler: paid }, async (req) => getTree(req.userId, (req.params as any).sphere));
  app.post('/api/trees/:sphere/water', { preHandler: paid, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const key = String(req.headers['idempotency-key'] ?? '');
    const b = z.object({ expectedLevel: z.number().int().positive().optional() }).parse(req.body ?? {});
    return water(req.userId, (req.params as any).sphere, key, b.expectedLevel);
  });

  // ---------------------------------------------------------------- задачи
  app.get('/api/tasks', { preHandler: paid }, async (req) => ({ tasks: await listTasks(req.userId) }));
  app.post('/api/tasks', { preHandler: paid, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => createTask(req.userId, taskSchema.parse(req.body) as any));
  app.get('/api/tasks/:id', { preHandler: paid }, async (req) => getTaskView(req.userId, idParam(req)));
  app.patch('/api/tasks/:id', { preHandler: paid }, async (req) => updateTask(req.userId, idParam(req), patchSchema.parse(req.body)));
  app.delete('/api/tasks/:id', { preHandler: paid }, async (req) => deleteTask(req.userId, idParam(req)));
  app.post('/api/tasks/:id/complete', { preHandler: paid, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => completeTask(req.userId, idParam(req)));
  app.post('/api/tasks/:id/habit-checkin', { preHandler: paid, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ answer: z.enum(['yes', 'no']) }).parse(req.body);
    return habitCheckin(req.userId, idParam(req), b.answer === 'yes');
  });
  app.get('/api/tasks/:id/history', { preHandler: paid }, async (req) => taskHistory(req.userId, idParam(req)));
  app.post('/api/tasks/:id/rewards', { preHandler: paid }, async (req) => {
    const b = z.object({ threshold: z.number().int(), title: z.string().max(200), confirm: z.literal(true) }).parse(req.body);
    return addReward(req.userId, idParam(req), b.threshold, b.title);
  });
  app.post('/api/rewards/:id/claim', { preHandler: paid }, async (req) => claimReward(req.userId, idParam(req)));

  // ---------------------------------------------------------------- челленджи
  app.get('/api/challenges', { preHandler: paid }, async (req) => ({ challenges: await listChallenges(req.userId) }));
  app.post('/api/challenges', { preHandler: paid }, async (req) => {
    const b = z.object({ title: z.string().max(100), goal: z.number().int(), endsOn: z.string().max(10).nullish(), taskId: z.number().int().nullish(), sphereId: z.string().max(20).nullish() }).parse(req.body);
    return createChallenge(req.userId, b);
  });
  app.post('/api/challenges/:id/invite', { preHandler: paid }, async (req) => createInvite(req.userId, idParam(req)));
  app.get('/api/challenges/invite/:token', { preHandler: auth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req) => previewInvite((req.params as any).token));
  app.post('/api/challenges/join', { preHandler: paid, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ token: z.string().max(60), taskId: z.number().int().nullish(), sphereId: z.string().max(20).nullish() }).parse(req.body);
    return joinChallenge(req.userId, b.token, b);
  });
  app.delete('/api/challenges/:id', { preHandler: paid }, async (req) => leaveChallenge(req.userId, idParam(req)));

  app.get('/api/stats', { preHandler: paid }, async (req) => stats(req.userId));

  // ---------------------------------------------------------------- Telegram
  app.post('/api/telegram/webhook', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!config.botToken || req.headers['x-telegram-bot-api-secret-token'] !== webhookSecret()) return reply.code(401).send({ ok: false });
    await handleUpdate(req.body);
    return { ok: true };
  });

  // ---------------------------------------------------------------- админка
  app.post('/api/admin/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const b = z.object({ login: z.string().max(60), password: z.string().max(200) }).parse(req.body);
    return admin.adminLogin(b.login, b.password, req.ip);
  });
  const days = (req: FastifyRequest) => Math.min(365, Math.max(1, Number((req.query as any).days) || 30));
  app.get('/api/admin/whoami', async (req) => {
    const a = await admin.adminFromToken(bearer(req));
    if (!a) throw new AppError(401, 'unauthorized', 'Нужно войти');
    return { ...a, perms: Object.entries(admin.PERMS).filter(([, roles]) => (roles as readonly string[]).includes(a.role)).map(([p]) => p) };
  });
  app.get('/api/admin/summary', { preHandler: adminAuth('metrics') }, async (req) => admin.summary(days(req)));
  app.get('/api/admin/funnel', { preHandler: adminAuth('metrics') }, async (req) => admin.funnel(days(req)));
  app.get('/api/admin/retention', { preHandler: adminAuth('metrics') }, async () => admin.retention());
  app.get('/api/admin/stats', { preHandler: adminAuth('metrics') }, async () => admin.productStats());
  app.get('/api/admin/config', { preHandler: adminAuth('config_read') }, async () => admin.getConfig());
  app.put('/api/admin/config/:key', { preHandler: adminAuth('config_write') }, async (req) => admin.setConfig(req.admin, (req.params as any).key, (req.body as any)?.value));
  app.patch('/api/admin/plans/:id', { preHandler: adminAuth('config_write') }, async (req) => admin.updatePlan(req.admin, (req.params as any).id, (req.body ?? {}) as any));
  app.get('/api/admin/users/:telegramId', { preHandler: adminAuth('support') }, async (req) => admin.lookupUser(req.admin, (req.params as any).telegramId));
  app.get('/api/admin/payments', { preHandler: adminAuth('payments') }, async () => admin.payments());
  app.post('/api/admin/payments/:chargeId/refund', { preHandler: adminAuth('refund') }, async (req) => admin.refund(req.admin, (req.params as any).chargeId));
  app.get('/api/admin/errors', { preHandler: adminAuth('errors') }, async () => admin.errors());
  app.get('/api/admin/audit', { preHandler: adminAuth('audit') }, async () => admin.auditLog());
  app.get('/api/admin/export/:kind', { preHandler: adminAuth('export') }, async (req, reply) => {
    const csv = await admin.exportCsv(req.admin, (req.params as any).kind);
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${(req.params as any).kind}.csv"`);
    return '﻿' + csv;
  });
}
