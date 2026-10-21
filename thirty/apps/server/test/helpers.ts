import type { FastifyInstance } from 'fastify';
import { DEFAULT_TARIFFS, toDbDate, flowBounds } from '@thirty/domain';
import { buildApp } from '../src/app';
import { signInitData } from '../src/auth/telegram';
import { clock } from '../src/clock';
import { prisma } from '../src/db';
import { clearSettingsCache } from '../src/settings';
import { ensureFlow } from '../src/modules/flows';

let app: FastifyInstance | null = null;

export async function getApp() {
  if (!app) app = await buildApp();
  return app;
}

export async function resetDb() {
  clock.set(null);
  clearSettingsCache();
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  for (const t of DEFAULT_TARIFFS) {
    await prisma.tariff.create({
      data: {
        id: t.id, title: t.title, months: t.months, goalLimit: t.goalLimit, promoPrice: t.promoPrice, regularPrice: t.regularPrice,
        comparisonMonthPrice: t.comparisonMonthPrice, renewalPrice: t.renewalPrice, highlighted: t.highlighted, badge: t.badge,
        features: t.features, prodamusSubscriptionPromo: 1000 + t.months, prodamusSubscriptionRegular: 2000 + t.months,
      },
    });
  }
}

export function auth(userId: number, extra: { first_name?: string; username?: string; startParam?: string } = {}) {
  const initData = signInitData(
    { id: userId, first_name: extra.first_name ?? `User${userId}`, username: extra.username, allows_write_to_pm: true },
    '123456:TEST_TOKEN',
    { authDate: Math.floor(Date.now() / 1000), startParam: extra.startParam },
  );
  return { authorization: `tma ${initData}` };
}

export async function api(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, userId: number | null, body?: unknown) {
  const a = await getApp();
  const res = await a.inject({ method, url, headers: userId ? auth(userId) : {}, payload: body as object });
  let json: any = null;
  try {
    json = res.json();
  } catch {
    /* not json */
  }
  return { status: res.statusCode, body: json };
}

/** Оплаченное участие без платёжного сценария — для тестов этапа 2 */
export async function grantMembership(userId: number, flowStart: string, tariffId = 'm1', extra: { interests?: string[]; city?: string } = {}) {
  await prisma.user.upsert({
    where: { id: BigInt(userId) },
    create: { id: BigInt(userId), firstName: `User${userId}`, interests: extra.interests ?? [], city: extra.city },
    update: { interests: extra.interests ?? [], city: extra.city },
  });
  const flow = await ensureFlow(flowStart);
  return prisma.flowMembership.create({ data: { userId: BigInt(userId), flowId: flow.id, tariffId } });
}

export const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

export async function upload(userId: number, buf = PNG_1x1) {
  const a = await getApp();
  const boundary = '----thirty' + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    buf,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const res = await a.inject({ method: 'POST', url: '/api/media', headers: { ...auth(userId), 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
  return { status: res.statusCode, body: res.json() };
}

export { prisma, clock, toDbDate, flowBounds };
