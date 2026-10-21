import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import path from 'node:path';
import { existsSync } from 'node:fs';
import qs from 'qs';
import { Prisma } from '@prisma/client';
import { config, isProd } from './config';
import { HttpError } from './http';
import { meRoutes } from './routes/me';
import { memberRoutes } from './routes/member';

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  // Prodamus присылает application/x-www-form-urlencoded с вложенными ключами products[0][name]
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, { __raw: body, ...qs.parse(body as string, { depth: 5, arrayLimit: 100 }) });
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || !isProd) return cb(null, true);
      const allowed = [config.PUBLIC_URL, config.ADMIN_ORIGIN].filter(Boolean);
      cb(null, allowed.includes(origin));
    },
    credentials: true,
  });
  await app.register(cookie);
  // В тестах лимиты частоты отключены (allowList), в остальном — глобальный лимит + точечные на маршрутах
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', global: true, allowList: () => config.NODE_ENV === 'test' });
  await app.register(multipart);

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ code: err.code, message: err.message, details: err.details });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return reply.status(409).send({ code: 'conflict', message: 'Такая запись уже есть' });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ code: (err as { code?: string }).code ?? 'bad_request', message: (err as Error).message });
    req.log.error(err as Error);
    if (!opts.logger) console.error(err);
    return reply.status(500).send({ code: 'internal', message: 'Что-то пошло не так. Попробуйте ещё раз.' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(meRoutes);
  await app.register(memberRoutes);
  const extra = await import('./routes/index');
  await extra.registerExtraRoutes(app);

  // Статика: Mini App на «/», админка на «/admin/»
  const miniDir = config.STATIC_MINIAPP_DIR || path.resolve(process.cwd(), '../miniapp/dist');
  const adminDir = config.STATIC_ADMIN_DIR || path.resolve(process.cwd(), '../admin/dist');
  if (existsSync(adminDir)) {
    await app.register(fstatic, { root: adminDir, prefix: '/admin/', decorateReply: false, wildcard: false });
    app.get('/admin/*', (_req, reply) => reply.sendFile('index.html', adminDir));
  }
  if (existsSync(miniDir)) {
    await app.register(fstatic, { root: miniDir, prefix: '/', wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ code: 'not_found' });
      return reply.sendFile('index.html', miniDir);
    });
  }
  return app;
}
