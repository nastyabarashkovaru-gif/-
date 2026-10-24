import type { FastifyInstance } from 'fastify';
import { compareWithPrevious, fromDbDate, tariffPerks, toDbDate } from '@thirty/domain';
import { z } from 'zod';
import { requireUser } from '../auth/telegram';
import { prisma } from '../db';
import { forbidden, jsonSafe, notFound } from '../http';
import { parse } from '../lib/validate';
import { signedMediaUrl } from '../lib/storage';
import { currentMembership, flowInfo, previousMembership } from '../modules/flows';
import { canEditGoals, createGoal, createTask, deleteGoal, deleteTask, fixGoals, goalInput, goalLimitFor, goalPatch, scheduleLabel, serializeGoal, taskInput, updateGoal, updateTask } from '../modules/goals';
import { goalStats, memberStats } from '../modules/rating';
import { reportInput, submitReport, todayChecklist } from '../modules/reports';
import { track } from '../modules/analytics';
import { buddyCard } from '../modules/buddy';

export async function memberRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  /** Текущее членство с целями и правами на редактирование (S13–S17) */
  app.get('/api/membership', async (req) => {
    const m = await currentMembership(req.user!.id);
    if (!m) return { membership: null };
    const goals = await prisma.goal.findMany({ where: { membershipId: m.id }, include: { tasks: { orderBy: { createdAt: 'asc' } } }, orderBy: { sort: 'asc' } });
    const before = await prisma.beforeAfter.findUnique({ where: { membershipId_phase: { membershipId: m.id, phase: 'before' } } });
    return jsonSafe({
      membership: {
        id: m.id,
        status: m.status,
        tariffId: m.tariffId,
        goalLimit: await goalLimitFor(m),
        canEdit: await canEditGoals(m),
        registeredAt: m.registeredAt,
        flow: flowInfo(m.flow),
        goals: goals.map((g) => ({ ...serializeGoal(g), tasks: g.tasks.map((t) => ({ ...serializeGoal({ ...g, tasks: [t] }).tasks[0], schedule: scheduleLabel(t) })) })),
        before: before ? { text: before.text, metrics: before.metrics, media: before.mediaIds.map((id) => ({ id, url: signedMediaUrl(id) })) } : null,
      },
    });
  });

  app.post('/api/goals', async (req) => {
    const m = await currentMembership(req.user!.id);
    if (!m) throw forbidden('no_membership', 'Сначала оплатите участие');
    return createGoal(req.user!.id, m.id, parse(goalInput, req.body));
  });
  app.patch<{ Params: { id: string } }>('/api/goals/:id', async (req) => updateGoal(req.user!.id, req.params.id, parse(goalPatch, req.body)));
  app.delete<{ Params: { id: string } }>('/api/goals/:id', async (req) => {
    await deleteGoal(req.user!.id, req.params.id);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/goals/:id/tasks', async (req) => createTask(req.user!.id, req.params.id, parse(taskInput, req.body)));
  app.patch<{ Params: { id: string } }>('/api/tasks/:id', async (req) => updateTask(req.user!.id, req.params.id, parse(taskInput.partial(), req.body)));
  app.delete<{ Params: { id: string } }>('/api/tasks/:id', async (req) => {
    await deleteTask(req.user!.id, req.params.id);
    return { ok: true };
  });

  app.post('/api/membership/fix', async (req) => {
    const m = await currentMembership(req.user!.id);
    if (!m) throw forbidden('no_membership');
    return fixGoals(req.user!.id, m.id);
  });

  /** «ДО»: текст, показатели, фото (фото — только с отдельным согласием на хранение чувствительных фото) */
  app.put('/api/membership/before', async (req) => {
    const body = parse(
      z.object({ text: z.string().max(2000).optional(), metrics: z.record(z.string().max(60)).default({}), mediaIds: z.array(z.string().uuid()).max(6).default([]) }),
      req.body,
    );
    const m = await currentMembership(req.user!.id);
    if (!m) throw forbidden('no_membership');
    if (!(await canEditGoals(m))) throw forbidden('locked', 'Точку «ДО» фиксируют до старта потока');
    if (body.mediaIds.length) {
      const consent = await prisma.consent.findFirst({ where: { userId: req.user!.id, kind: 'sensitive_photos', revokedAt: null } });
      if (!consent) throw forbidden('consent_required', 'Нужно согласие на хранение фото');
      const own = await prisma.mediaFile.count({ where: { id: { in: body.mediaIds }, ownerId: req.user!.id } });
      if (own !== body.mediaIds.length) throw forbidden('bad_media');
      await prisma.mediaFile.updateMany({ where: { id: { in: body.mediaIds } }, data: { sensitive: true } });
    }
    await prisma.beforeAfter.upsert({
      where: { membershipId_phase: { membershipId: m.id, phase: 'before' } },
      create: { membershipId: m.id, phase: 'before', text: body.text, metrics: body.metrics, mediaIds: body.mediaIds },
      update: { text: body.text, metrics: body.metrics, mediaIds: body.mediaIds },
    });
    await track({ userId: req.user!.id, eventName: 'before_uploaded', screenId: 'S15', flowId: m.flowId, metadata: { photos: body.mediaIds.length } });
    return { ok: true };
  });

  /** Главная S19 */
  app.get('/api/home', async (req) => {
    const user = req.user!;
    const m = await currentMembership(user.id);
    if (!m) return { state: 'no_membership' };
    const info = flowInfo(m.flow);
    const goals = await prisma.goal.findMany({ where: { membershipId: m.id }, include: { tasks: true }, orderBy: { sort: 'asc' } });
    const stats = await memberStats(m.id, m.flow);
    const prev = await previousMembership(user.id, m.flow.startsOn);
    const prevStats = prev ? await memberStats(prev.id, prev.flow) : null;
    const today = await prisma.dailyReport.findUnique({ where: { membershipId_date: { membershipId: m.id, date: toDbDate(info.today) } } });
    const tariff = await prisma.tariff.findUnique({ where: { id: m.tariffId } });
    return jsonSafe({
      state: m.status === 'reserved' ? 'registration' : info.phase === 'upcoming' ? 'waiting' : info.phase === 'finished' ? 'finished' : m.status === 'active' ? 'active' : 'registration',
      membership: { id: m.id, status: m.status, finalSubmittedAt: m.finalSubmittedAt },
      flow: info,
      stats: {
        ratio: stats.ratio,
        percent: Math.round(stats.ratio * 100),
        successfulDays: stats.successfulDays,
        completed: stats.completed,
        scheduled: stats.scheduled,
        missedReports: stats.missedReports,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
        dayNumber: info.phase === 'active' ? stats.days.findIndex((d) => d.date === info.today) + 1 : null,
        days: stats.days,
      },
      comparison: compareWithPrevious(prevStats ? prevStats.successfulDays : null, stats.successfulDays),
      goals: await Promise.all(goals.map(async (g) => ({
        ...serializeGoal(g),
        // Для нечисловых целей прогресс — процент выполненных запланированных действий
        planPercent: info.phase === 'upcoming' ? null : Math.round((await goalStats(g.id, m.id, m.flow)).ratio * 100),
        tasks: g.tasks.map((t) => ({ id: t.id, title: t.title, schedule: scheduleLabel(t), evidence: t.evidence })),
      }))),
      todayReported: Boolean(today && today.status === 'accepted'),
      buddy: await buddyCard(user.id, m.flowId),
      perks: tariffPerks(tariff?.months ?? 1),
    });
  });

  app.get('/api/report/today', async (req) => {
    const m = await currentMembership(req.user!.id);
    if (!m || m.status !== 'active') throw forbidden('not_active');
    await track({ userId: req.user!.id, eventName: 'report_started', screenId: 'S21', flowId: m.flowId });
    return todayChecklist(m.id);
  });

  app.post('/api/reports', async (req) => {
    const m = await currentMembership(req.user!.id);
    if (!m) throw forbidden('no_membership');
    return submitReport(req.user!.id, m.id, parse(reportInput, req.body));
  });

  /** Карточка цели S20; расширенная статистика — для тарифов от 3 месяцев */
  app.get<{ Params: { id: string } }>('/api/goals/:id/stats', async (req) => {
    const goal = await prisma.goal.findUnique({ where: { id: req.params.id }, include: { membership: { include: { flow: true } }, tasks: true } });
    if (!goal || goal.membership.userId !== req.user!.id) throw notFound();
    const s = await goalStats(goal.id, goal.membershipId, goal.membership.flow);
    const tariff = await prisma.tariff.findUnique({ where: { id: goal.membership.tariffId } });
    const perks = tariffPerks(tariff?.months ?? 1);
    let previous: { title: string; successfulDays: number } | null = null;
    if (perks.monthComparison) {
      const prev = await previousMembership(req.user!.id, goal.membership.flow.startsOn);
      if (prev) previous = { title: prev.flow.title, successfulDays: (await memberStats(prev.id, prev.flow)).successfulDays };
    }
    return {
      goal: serializeGoal(goal),
      stats: { percent: Math.round(s.ratio * 100), successfulDays: s.successfulDays, currentStreak: s.currentStreak, longestStreak: s.longestStreak, completed: s.completed, scheduled: s.scheduled, days: s.days },
      comparison: compareWithPrevious(previous?.successfulDays ?? null, s.successfulDays),
      extended: perks.extendedStats ? { missedOccurrences: s.missedOccurrences, missedReports: s.missedReports, previous } : null,
    };
  });

  /** История собственных отчётов S22 */
  app.get('/api/reports/mine', async (req) => {
    const m = await currentMembership(req.user!.id);
    if (!m) return { reports: [] };
    const reports = await prisma.dailyReport.findMany({ where: { membershipId: m.id }, orderBy: { date: 'desc' }, include: { _count: { select: { items: true, comments: true } } } });
    return { reports: reports.map((r) => ({ id: r.id, date: fromDbDate(r.date), status: r.status, items: r._count.items, comments: r._count.comments })) };
  });
}
