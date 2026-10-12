import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZodError } from 'zod';
import { config } from './config.js';
import { AppError } from './errors.js';
import { logError } from './db.js';
import { registerRoutes } from './routes.js';

function webDist(): string | null {
  if (config.webDist && existsSync(config.webDist)) return resolve(config.webDist);
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, '..', '..', 'web', 'dist'), join(here, '..', 'web', 'dist')]) if (existsSync(join(p, 'index.html'))) return p;
  return null;
}

export async function buildApp() {
  const app = Fastify({
    logger: config.appEnv === 'test' ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers["x-telegram-bot-api-secret-token"]'] },
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://telegram.org'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://t.me', 'https://*.telegram.org', 'https://*.t.me'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.telegram.org'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.headers.authorization?.slice(-24) || req.ip,
    errorResponseBuilder: () => ({ statusCode: 429, error: 'rate_limited', message: 'Слишком много запросов, подожди немного' }),
  });

  app.setErrorHandler(async (err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: err.code, message: err.message, ...err.extra });
    if (err instanceof ZodError) return reply.code(400).send({ error: 'validation', message: 'Проверь введённые данные', issues: err.issues.slice(0, 5).map((i) => i.path.join('.')) });
    if ((err as any).statusCode === 429) return reply.code(429).send({ error: 'rate_limited', message: 'Слишком много запросов, подожди немного' });
    if ((err as any).statusCode && (err as any).statusCode < 500) return reply.code((err as any).statusCode).send({ error: 'bad_request', message: 'Некорректный запрос' });
    req.log.error(err);
    await logError('api', err.message, { url: req.url.split('?')[0], method: req.method });
    return reply.code(500).send({ error: 'internal', message: 'Что-то пошло не так. Попробуй ещё раз.' });
  });

  await registerRoutes(app);

  const dist = webDist();
  if (dist) {
    await app.register(fastifyStatic, {
      root: dist,
      wildcard: false,
      setHeaders: (res, path) => {
        res.setHeader('cache-control', /\/assets\//.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found', message: 'Не найдено' });
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    });
  }
  return app;
}
