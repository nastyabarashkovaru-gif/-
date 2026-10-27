import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/telegram';
import { prisma } from '../db';
import { badRequest, forbidden, jsonSafe, notFound } from '../http';
import { parse } from '../lib/validate';
import { ALLOWED_MIME, newKey, signedMediaUrl, sniffImage, storage, verifyMediaSig } from '../lib/storage';
import { clientBatch, ingest } from '../modules/analytics';
import { activeConsents, consentInput, profileInput, publicUser, recordConsents } from '../modules/users';
import { currentMembership, flowInfo, homeMembership, monthNumber } from '../modules/flows';
import { getSetting } from '../settings';

export async function meRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook('preHandler', requireUser);

    r.get('/api/me', async (req) => {
      const u = req.user!;
      const m = await currentMembership(u.id);
      const sub = await prisma.subscription.findFirst({
        where: { userId: u.id, status: { in: ['prestart', 'active', 'past_due', 'canceled_at_period_end'] } },
        include: { tariff: true },
      });
      return jsonSafe({
        user: {
          ...publicUser(u),
          firstName: u.firstName,
          displayName: u.displayName,
          age: u.age,
          occupation: u.occupation,
          aspiration: u.aspiration,
          timezone: u.timezone,
          visibility: u.visibility,
          isAdult: u.isAdult,
          marketingOptIn: u.marketingOptIn,
          allowsWrite: u.allowsWrite,
          onboardingStage: u.onboardingStage,
          lastScreen: u.lastScreen,
        },
        consents: [...(await activeConsents(u.id))],
        startParam: req.tg?.startParam ?? null,
        support: `https://t.me/${await getSetting('support.username')}`,
        membership: m ? { id: m.id, status: m.status, tariffId: m.tariffId, flow: flowInfo(m.flow), registeredAt: m.registeredAt } : null,
        // Какой по счёту месяц участия — цвет темы приложения
        month: m ? await monthNumber(u.id, (await homeMembership(u.id)) ?? m) : 1,
        subscription: sub ? { id: sub.id, status: sub.status, tariffId: sub.tariffId, tariffTitle: sub.tariff.title, autoRenew: sub.autoRenew } : null,
      });
    });

    r.patch('/api/me', async (req) => {
      const body = parse(profileInput, req.body);
      const u = await prisma.user.update({ where: { id: req.user!.id }, data: body });
      return jsonSafe({ user: publicUser(u) });
    });

    /** Последний открытый экран — повторный визит возвращает на нужный этап */
    r.post('/api/me/screen', async (req) => {
      const { screen, stage } = parse(z.object({ screen: z.string().max(64), stage: z.enum(['onboarding', 'tariffs', 'checkout']).optional() }), req.body);
      const order = ['new', 'onboarding', 'tariffs', 'checkout', 'paid', 'registered'];
      const cur = req.user!.onboardingStage;
      const data: { lastScreen: string; onboardingStage?: string } = { lastScreen: screen };
      if (stage && order.indexOf(stage) > order.indexOf(cur)) data.onboardingStage = stage;
      await prisma.user.update({ where: { id: req.user!.id }, data });
      return { ok: true };
    });

    r.post('/api/consents', async (req) => {
      await recordConsents(req.user!.id, parse(consentInput, req.body));
      return { consents: [...(await activeConsents(req.user!.id))] };
    });

    r.post('/api/events', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
      return ingest(req.user!.id, parse(clientBatch, req.body));
    });

    /** Загрузка фото/скриншота доказательства (≤ 10 МБ, проверка сигнатуры файла) */
    r.post('/api/media', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
      const file = await req.file({ limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
      if (!file) throw badRequest('no_file');
      const buf = await file.toBuffer();
      if (file.file.truncated) throw badRequest('too_large', 'Файл больше 10 МБ');
      const mime = sniffImage(buf);
      if (!mime || !ALLOWED_MIME[mime]) throw badRequest('bad_type', 'Нужна картинка JPG, PNG, WEBP или HEIC');
      const key = newKey(ALLOWED_MIME[mime]);
      await storage.put(key, buf, mime);
      const media = await prisma.mediaFile.create({ data: { ownerId: req.user!.id, storageKey: key, mime, size: buf.length } });
      return { id: media.id, url: signedMediaUrl(media.id) };
    });
  });

  /** Отдача медиа по подписанной ссылке */
  app.get<{ Params: { id: string }; Querystring: { exp?: string; sig?: string } }>('/api/media/:id', async (req, reply) => {
    const { exp = '', sig = '' } = req.query;
    if (!verifyMediaSig(req.params.id, exp, sig)) throw forbidden('bad_signature');
    const media = await prisma.mediaFile.findUnique({ where: { id: req.params.id } });
    if (!media) throw notFound();
    reply.header('Cache-Control', 'private, max-age=3600').type(media.mime);
    return reply.send(await storage.get(media.storageKey));
  });
}
