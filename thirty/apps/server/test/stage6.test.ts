import { beforeEach, describe, expect, it } from 'vitest';
import { api, clock, getApp, grantMembership, prisma, resetDb } from './helpers';
import { hashPassword, totp } from '../src/auth/admin';

beforeEach(resetDb);

async function adminSession(role: 'owner' | 'moderator' | 'analyst' | 'expert' = 'owner', login = `adm-${role}`) {
  const app = await getApp();
  await prisma.adminUser.create({ data: { login, role, passwordHash: await hashPassword('correct horse battery') } });
  const l = await app.inject({ method: 'POST', url: '/admin-api/auth/login', payload: { login, password: 'correct horse battery' } });
  let cookies = l.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  let csrf = l.json().csrf as string | undefined;
  if (l.json().mfa !== 'ok') {
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { login } });
    const m = await app.inject({ method: 'POST', url: '/admin-api/auth/mfa', headers: { cookie: cookies }, payload: { code: totp(admin.totpSecret!) } });
    expect(m.statusCode).toBe(200);
    cookies = m.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    csrf = m.json().csrf;
  }
  const call = async (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: object, withCsrf = true) => {
    const res = await app.inject({ method, url, headers: { cookie: cookies, ...(withCsrf && csrf ? { 'x-csrf-token': csrf } : {}) }, payload });
    return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.body };
  };
  return call;
}

describe('админка: доступ', () => {
  it('owner обязан пройти 2FA; без неё API закрыт; неверный пароль — 401', async () => {
    const app = await getApp();
    await prisma.adminUser.create({ data: { login: 'boss', role: 'owner', passwordHash: await hashPassword('correct horse battery') } });
    expect((await app.inject({ method: 'POST', url: '/admin-api/auth/login', payload: { login: 'boss', password: 'wrong' } })).statusCode).toBe(401);
    const l = await app.inject({ method: 'POST', url: '/admin-api/auth/login', payload: { login: 'boss', password: 'correct horse battery' } });
    expect(l.json().mfa).toBe('setup');
    expect(l.json().otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const cookie = l.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const blocked = await app.inject({ method: 'GET', url: '/admin-api/dashboard', headers: { cookie } });
    expect(blocked.statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/admin-api/auth/mfa', headers: { cookie }, payload: { code: '000000' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/admin-api/dashboard' })).statusCode).toBe(401);
  });

  it('CSRF обязателен для изменений; роли ограничивают разделы', async () => {
    const owner = await adminSession('owner');
    expect((await owner('PATCH', '/admin-api/tariffs/m1', { promoPrice: 990 }, false)).status).toBe(403);
    expect((await owner('PATCH', '/admin-api/tariffs/m1', { promoPrice: 999 })).status).toBe(200);
    const mod = await adminSession('moderator');
    expect((await mod('GET', '/admin-api/moderation')).status).toBe(200);
    expect((await mod('PATCH', '/admin-api/tariffs/m1', { promoPrice: 1 })).status).toBe(403);
    expect((await mod('GET', '/admin-api/analytics/funnel')).status).toBe(403);
    const audit = await owner('GET', '/admin-api/audit');
    expect(audit.body.some((a: { action: string }) => a.action === 'tariff.update')).toBe(true);
  });
});

describe('аналитика (критерии №1, №14)', () => {
  it('воронка по когорте с % от предыдущего шага и от входа, клики по тарифам отдельно; экраны с drop-off', async () => {
    clock.set('2026-10-21T09:00:00Z');
    const ev = (uid: number, n: number, name: string, extra: object = {}) => ({ event_id: `e-${uid}-${n}-${name}`, session_id: `sess-${uid}`, event_name: name, timestamp: new Date(Date.UTC(2026, 9, 21, 9, n)).toISOString(), ...extra });
    for (let uid = 1; uid <= 4; uid++) {
      const events = [ev(uid, 0, 'app_open'), ev(uid, 1, 'screen_view', { screen_id: 'O01' }), ev(uid, 1, 'onboarding_step_view', { screen_id: 'O01' })];
      if (uid <= 3) {
        events.push(ev(uid, 2, 'screen_view', { screen_id: 'O02' }));
        for (let n = 2; n <= 3; n++) events.push(ev(uid, 2 + n, 'onboarding_step_view', { screen_id: `O${String(n).padStart(2, '0')}` }));
        events.push(ev(uid, 14, 'tariff_view'));
      }
      if (uid <= 2) events.push(ev(uid, 15, 'tariff_select', { tariff_id: uid === 1 ? 'm3' : 'm1' }));
      // повторная отправка тех же событий (ретрай клиента) не задваивает
      const sent = await api('POST', '/api/events', uid, { events });
      expect(sent.body).toMatchObject({ accepted: events.length });
      await api('POST', '/api/events', uid, { events });
    }
    expect(await prisma.analyticsEvent.count({ where: { eventName: 'app_open' } })).toBe(4);
    const owner = await adminSession('owner');
    const f = await owner('GET', '/admin-api/analytics/funnel?from=2026-10-20&to=2026-10-22');
    const step = (k: string) => f.body.steps.find((s: { key: string }) => s.key === k);
    expect(step('open')).toMatchObject({ count: 4, pctStart: 100 });
    expect(step('o01').count).toBe(4);
    expect(step('o02')).toMatchObject({ count: 3, pctPrev: 75, pctStart: 75 });
    expect(step('tariffs').count).toBe(3);
    expect(step('select')).toMatchObject({ count: 2, pctPrev: 66.7, pctStart: 50 });
    expect(f.body.tariffClicks).toEqual({ m1: 1, m3: 1 });
    const scr = await owner('GET', '/admin-api/analytics/screens?from=2026-10-20&to=2026-10-22');
    expect(scr.body.find((s: { screen: string }) => s.screen === 'O01')).toMatchObject({ views: 4, users: 4, exits: 1 });
    const u = await owner('GET', '/admin-api/users/1');
    expect(u.body.tariffClicks).toEqual([expect.objectContaining({ tariff: 'm3' })]);
    expect(u.body.screens.map((s: { screen: string }) => s.screen)).toEqual(['O02', 'O01']);
    const csv = await owner('GET', '/admin-api/export/events?from=2026-10-20&to=2026-10-22');
    expect(csv.status).toBe(200);
    expect(String(csv.body)).toContain('event_id;user_id;session_id');
  });
});

describe('претенденты на приз (A09)', () => {
  it('решение только с причиной, журнал, переходы статусов; места — максимум 3 по тай-брейку', async () => {
    clock.set('2026-12-05T09:00:00Z');
    const flowStart = '2026-11-01';
    const ids: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const m = await grantMembership(100 + i, flowStart, 'm1');
      await prisma.flowMembership.update({ where: { id: m.id }, data: { status: 'finished' } });
      const c = await prisma.prizeCandidate.create({ data: { flowId: m.flowId, userId: BigInt(100 + i), tiebreak: { ratio: 1, successfulDays: 30, longestStreak: 30, finalSubmittedAt: `2026-12-0${i}T10:00:00Z` } } });
      ids.push(c.id);
    }
    const mod = await adminSession('moderator');
    expect((await mod('POST', `/admin-api/prizes/${ids[0]}/decision`, { decision: 'approve', reason: '' })).status).toBe(400);
    for (const id of ids) expect((await mod('POST', `/admin-api/prizes/${id}/decision`, { decision: 'approve', reason: 'Все доказательства на месте' })).status).toBe(200);
    expect((await mod('POST', `/admin-api/prizes/${ids[0]}/decision`, { decision: 'approve', reason: 'повтор повтор' })).status).toBe(400);
    const detail = await mod('GET', `/admin-api/prizes/${ids[0]}`);
    expect(detail.status).toBe(200);
    expect(detail.body.calendar).toHaveLength(30);
    const flow = await prisma.flow.findFirstOrThrow();
    const places = await mod('POST', `/admin-api/prizes/flow/${flow.id}/places`);
    expect(places.body.winners.map((w: { userId: string; place: number }) => [w.userId, w.place])).toEqual([['101', 1], ['102', 2], ['103', 3]]);
    expect(places.body.note).toContain('жеребьёвка выключена');
    expect(await prisma.prizeReview.count()).toBe(4);
    expect(await prisma.auditLog.count({ where: { action: 'prize.approve' } })).toBe(4);
  });
});
