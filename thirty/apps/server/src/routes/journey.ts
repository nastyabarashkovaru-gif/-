import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fromDbDate } from '@thirty/domain';
import { requireUser } from '../auth/telegram';
import { audit, requireAdmin, requirePerm } from '../auth/admin';
import { config } from '../config';
import { prisma } from '../db';
import { jsonSafe, notFound } from '../http';
import { parse } from '../lib/validate';
import { signedMediaUrl } from '../lib/storage';
import { toCsv } from '../modules/adminAnalytics';
import { renderResultCardPng } from '../modules/cards';
import { displayName } from '../modules/users';
import {
  buildResultCard, comebackOffer, decideTrackerReview, expectationInput, feedbackInput, finaleData, finaleInput, readResultCardToken,
  resultCardInput, resultCardToken, saveFinale, setExpectation, submitFeedback, submitTrackerReview, trackerInput, trackerPrompted, trackerState,
} from '../modules/journey';

/** Ожидания, обратная связь 29-го дня, итоги, возврат по прежней цене, отзыв за трекеры, карточка результатов */
export async function journeyRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook('preHandler', requireUser);
    r.put('/api/membership/expectation', async (req) => setExpectation(req.user!.id, parse(expectationInput, req.body)));
    r.post('/api/feedback', async (req) => submitFeedback(req.user!.id, parse(feedbackInput, req.body)));
    r.get('/api/finale', async (req) => jsonSafe(await finaleData(req.user!.id)));
    r.post('/api/finale', async (req) => saveFinale(req.user!.id, parse(finaleInput, req.body)));
    r.post('/api/finale/card', async (req) => {
      const card = await buildResultCard(req.user!.id, parse(resultCardInput, req.body ?? {}));
      return { card, imageUrl: `${config.PUBLIC_URL.replace(/\/$/, '')}/api/public/result-card.png?c=${resultCardToken(card)}` };
    });
    r.get<{ Querystring: { start?: string } }>('/api/comeback', async (req) => comebackOffer(req.user!.id, req.query.start === '1'));
    r.get('/api/trackers', async (req) => trackerState(req.user!.id));
    r.post('/api/trackers/prompted', async (req) => trackerPrompted(req.user!.id));
    r.post('/api/trackers', async (req) => submitTrackerReview(req.user!.id, parse(trackerInput, req.body)));
  });

  // Карточка результатов: содержимое подписано в ссылке, поэтому её можно открыть и сохранить без авторизации
  app.get<{ Querystring: { c?: string } }>('/api/public/result-card.png', async (req, reply) => {
    const card = readResultCardToken(String(req.query.c ?? ''));
    if (!card) throw notFound();
    const png = renderResultCardPng(card);
    return reply.header('Content-Type', 'image/png').header('Cache-Control', 'public, max-age=86400').header('Content-Disposition', 'inline; filename="30-dney-result.png"').send(png);
  });

  app.register(async (r) => {
    r.addHook('preHandler', requireAdmin);
    const perm = { preHandler: requirePerm('reviews') };
    const flowFilter = (q: { flowId?: string; userId?: string }) => ({ ...(q.flowId ? { flowId: q.flowId } : {}), ...(q.userId && /^\d+$/.test(q.userId) ? { userId: BigInt(q.userId) } : {}) });
    const names = async (ids: bigint[]) => {
      const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } } });
      return (id: bigint) => {
        const u = users.find((x) => x.id === id);
        return u ? { name: displayName(u), username: u.username } : { name: String(id), username: null };
      };
    };
    const send = <T extends Record<string, unknown>>(rows: T[], csv: boolean, file: string, reply: { header: (k: string, v: string) => typeof reply; send: (b: unknown) => unknown }) =>
      csv ? reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${file}.csv"`).send(toCsv(rows)) : jsonSafe(rows);

    r.get('/admin-api/journey/flows', perm, async () => (await prisma.flow.findMany({ orderBy: { startsOn: 'desc' }, take: 24 })).map((f) => ({ id: f.id, title: f.title, startsOn: fromDbDate(f.startsOn) })));

    /** Анкета, шаг 1: «Что ты хочешь получить от клуба» — по потокам (история ответов) */
    r.get<{ Querystring: { flowId?: string; userId?: string; csv?: string } }>('/admin-api/journey/expectations', perm, async (req, reply) => {
      const rows = await prisma.flowMembership.findMany({ where: { expectation: { not: null }, ...flowFilter(req.query) }, include: { flow: true }, orderBy: { createdAt: 'desc' }, take: 5000 });
      const who = await names(rows.map((m) => m.userId));
      const out = rows.map((m) => ({ userId: m.userId.toString(), ...who(m.userId), flow: m.flow.title, expectation: m.expectation, createdAt: m.createdAt }));
      return send(out, req.query.csv === '1', 'expectations', reply);
    });

    /** Обратная связь на предпоследний день */
    r.get<{ Querystring: { flowId?: string; userId?: string; csv?: string } }>('/admin-api/journey/feedback', perm, async (req, reply) => {
      const rows = await prisma.flowFeedback.findMany({ where: flowFilter(req.query), include: { membership: { include: { flow: true } } }, orderBy: { createdAt: 'desc' }, take: 5000 });
      const who = await names(rows.map((f) => f.userId));
      const out = rows.map((f) => ({
        userId: f.userId.toString(), ...who(f.userId), flow: f.membership.flow.title, createdAt: f.createdAt,
        month: f.month, helped: [...f.helped, f.helpedOther].filter(Boolean).join('; '), hindered: [...f.hindered, f.hinderedOther].filter(Boolean).join('; '),
        benefit: f.benefit, change: f.change, needHelp: f.needHelp,
      }));
      return send(out, req.query.csv === '1', 'feedback', reply);
    });

    /** Итоги завершённых потоков: оценка целей и фактический результат */
    r.get<{ Querystring: { flowId?: string; userId?: string; csv?: string } }>('/admin-api/journey/results', perm, async (req, reply) => {
      const rows = await prisma.flowMembership.findMany({ where: { finalSubmittedAt: { not: null }, ...flowFilter(req.query) }, include: { flow: true, goals: { orderBy: { sort: 'asc' } } }, orderBy: { finalSubmittedAt: 'desc' }, take: 5000 });
      const who = await names(rows.map((m) => m.userId));
      const label = { full: 'да, полностью', partial: 'частично', none: 'пока нет' } as Record<string, string>;
      const out = rows.map((m) => ({
        userId: m.userId.toString(), ...who(m.userId), flow: m.flow.title, submittedAt: m.finalSubmittedAt,
        expectation: m.expectation ?? '', result: m.finalResult ?? '',
        goals: m.goals.map((g) => `${g.title}${g.pointA ? ` (А: ${g.pointA}` : ''}${g.pointB ? `; Б: ${g.pointB})` : g.pointA ? ')' : ''} — ${label[g.finalOutcome ?? ''] ?? 'без оценки'}`).join(' | '),
      }));
      return send(out, req.query.csv === '1', 'results', reply);
    });

    /** Отзывы за трекеры */
    r.get<{ Querystring: { status?: string } }>('/admin-api/journey/trackers', perm, async (req) => {
      const rows = await prisma.trackerReview.findMany({ where: req.query.status ? { status: req.query.status } : {}, orderBy: { createdAt: 'desc' }, take: 300 });
      const who = await names(rows.map((x) => x.userId));
      return jsonSafe(rows.map((x) => ({ ...x, userId: x.userId.toString(), ...who(x.userId), screenshot: signedMediaUrl(x.mediaId) })));
    });
    r.post<{ Params: { id: string } }>('/admin-api/journey/trackers/:id', perm, async (req) => {
      const { decision } = parse(z.object({ decision: z.enum(['grant', 'clarify']) }), req.body);
      const res = await decideTrackerReview(req.params.id, decision, req.admin!.login);
      await audit(req, `trackers.${decision}`, 'tracker_review', req.params.id, {});
      return res;
    });
  });
}
