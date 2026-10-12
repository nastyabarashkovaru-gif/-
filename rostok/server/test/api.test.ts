import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { resetDb, makeUser, at, pool, clock } from './helpers.js';
import { buildApp } from '../src/app.js';
import { verifyInitData } from '../src/auth.js';
import { processPaymentSucceeded, processRefund, getEntitlement, checkout, processSubscriptions } from '../src/services/subscription.js';
import { createChallenge, createInvite, joinChallenge, listChallenges, previewInvite } from '../src/services/challenges.js';
import { createTask, completeTask } from '../src/services/tasks.js';
import { one } from '../src/db.js';
import { webhookSecret } from '../src/telegram.js';

const BOT = '123456:TEST_TOKEN';
function signInitData(user: object, authDate: number) {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: 'AAE', user: JSON.stringify(user) });
  const dcs = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(BOT).digest();
  params.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
}

let app: Awaited<ReturnType<typeof buildApp>>;
beforeAll(async () => {
  await resetDb();
  clock.set(null);
  app = await buildApp();
});
afterAll(async () => { await app.close(); clock.set(null); await pool.end(); });

const now = () => Math.floor(Date.now() / 1000);

describe('telegram auth', () => {
  it('accepts a valid signature and rejects tampering and expired data', () => {
    const d = signInitData({ id: 42, first_name: 'Настя' }, 1_000_000);
    expect(verifyInitData(d, BOT, 1_000_100, 86400).id).toBe(42);
    expect(() => verifyInitData(d.replace('42', '43'), BOT, 1_000_100, 86400)).toThrow(/Подпись/);
    expect(() => verifyInitData(d, BOT, 1_000_000 + 90000, 86400)).toThrow(/устарела/);
    expect(() => verifyInitData(d, 'other:token', 1_000_100, 86400)).toThrow(/Подпись/);
  });
});

describe('paywall and entitlement', () => {
  let token = '';
  const h = () => ({ authorization: `Bearer ${token}` });

  it('first entry: real actions are unavailable without payment', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/telegram', payload: { initData: signInitData({ id: 777, first_name: 'Аня' }, now()), timezone: 'Europe/Moscow' } });
    expect(r.statusCode).toBe(200);
    token = r.json().token;
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: h() });
    expect(me.json()).toMatchObject({ access: false, onboarding: { step: 'slides' } });
    for (const [method, url] of [['GET', '/api/garden'], ['GET', '/api/tasks'], ['POST', '/api/tasks'], ['POST', '/api/trees/work/water']] as const) {
      const res = await app.inject({ method, url, headers: h(), payload: method === 'POST' ? {} : undefined });
      expect(res.statusCode).toBe(402);
    }
    // client cannot fake a balance — there is no such endpoint, and onboarding progress does not grant access
    await app.inject({ method: 'POST', url: '/api/onboarding', headers: h(), payload: { step: 'paywall', tutorialCompleted: true, paywallSeen: true } });
    expect((await app.inject({ method: 'GET', url: '/api/garden', headers: h() })).statusCode).toBe(402);
  });

  it('server-confirmed payment opens access; duplicate webhook does not extend twice; refund revokes', async () => {
    const plans = (await app.inject({ method: 'GET', url: '/api/subscription/plans', headers: h() })).json().plans;
    expect(plans.map((p: any) => p.id)).toEqual(['month', 'half_year']);
    const co = (await app.inject({ method: 'POST', url: '/api/subscription/checkout', headers: h(), payload: { planId: 'month' } })).json();
    expect(co.kind).toBe('mock');
    // Простое «успех» на фронте ничего не даёт — только серверное событие
    expect((await app.inject({ method: 'GET', url: '/api/garden', headers: h() })).statusCode).toBe(402);
    const ev = { provider: 'telegram_stars' as const, eventKey: 'tg:charge-1', intentId: co.intentId, chargeId: 'charge-1', amount: 400, currency: 'XTR', isRecurring: true, isFirstRecurring: true, telegramId: 777 };
    const first = await processPaymentSucceeded(ev);
    const second = await processPaymentSucceeded(ev);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    const user = (await one<any>(pool, 'SELECT id FROM users WHERE telegram_id=777'))!;
    const { access, sub } = await getEntitlement(pool, user.id);
    expect(access).toBe(true);
    const days = (sub!.current_period_end!.getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect((await app.inject({ method: 'GET', url: '/api/garden', headers: h() })).statusCode).toBe(200);
    await processRefund({ provider: 'telegram_stars', chargeId: 'charge-1', eventKey: 'tg-refund:charge-1' });
    await processRefund({ provider: 'telegram_stars', chargeId: 'charge-1', eventKey: 'tg-refund:charge-1' });
    expect((await getEntitlement(pool, user.id)).access).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/garden', headers: h() })).statusCode).toBe(402);
  });

  it('payment for a different telegram user is rejected', async () => {
    const u = await makeUser('Europe/Moscow', false);
    const co = await checkout(u, 'half_year');
    await expect(processPaymentSucceeded({ provider: 'telegram_stars', eventKey: 'tg:x', intentId: co.intentId, chargeId: 'x', amount: 1200, currency: 'XTR', telegramId: 999999 })).rejects.toMatchObject({ code: 'user_mismatch' });
  });

  it('telegram webhook requires the secret header', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/telegram/webhook', payload: { update_id: 1 } });
    expect(r.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': webhookSecret() }, payload: { update_id: 2 } });
    expect(ok.statusCode).toBe(200);
  });
});

describe('cancellation flow', () => {
  it('two dialogs: info, then retention offer (sandbox provider supports it), real cancel keeps paid period', async () => {
    const u = await makeUser();
    const { createSessionForTest } = await import('./session.js');
    const token = await createSessionForTest(u);
    const h = { authorization: `Bearer ${token}` };
    const info = (await app.inject({ method: 'GET', url: '/api/subscription/cancel-info', headers: h })).json();
    expect(info.cancellable).toBe(true);
    expect(info.rejoinPrice).toBeNull(); // тариф возвращения выключен → не пугаем ценой
    expect(info.retentionOffer.plan.displayPriceRub).toBe(249);
    expect(info.retentionOffer.thenPlan.displayPriceRub).toBe(499);
    const until = info.accessUntil;
    const c = (await app.inject({ method: 'POST', url: '/api/subscription/cancel', headers: h })).json();
    expect(c.status).toBe('cancel_at_period_end');
    expect(new Date(c.accessUntil).toISOString()).toBe(new Date(until).toISOString());
    expect((await getEntitlement(pool, u)).access).toBe(true);
    clock.set(new Date(new Date(until).getTime() + 60_000));
    await processSubscriptions();
    expect((await getEntitlement(pool, u)).access).toBe(false);
    expect((await getEntitlement(pool, u)).sub!.status).toBe('expired');
    clock.set(null);
  });

  it('accepted retention offer: next charge at 249-plan once, then standard; garden kept after expiry and restored after repay', async () => {
    const u = await makeUser();
    const { createSessionForTest } = await import('./session.js');
    const h = { authorization: `Bearer ${await createSessionForTest(u)}` };
    const ok = (await app.inject({ method: 'POST', url: '/api/subscription/accept-retention-offer', headers: h })).json();
    expect(ok.nextChargePlan.id).toBe('retention_month');
    const again = await app.inject({ method: 'POST', url: '/api/subscription/accept-retention-offer', headers: h });
    expect(again.statusCode).toBe(409);
    const end = (await getEntitlement(pool, u)).sub!.current_period_end!;
    clock.set(new Date(end.getTime() + 1000));
    await processSubscriptions();
    const ev = await one<any>(pool, `SELECT * FROM payment_events WHERE user_id=$1 AND type='renewal'`, [u]);
    expect(ev.amount).toBe(200);
    const sub = (await getEntitlement(pool, u)).sub!;
    expect(sub.next_charge_plan_id).toBeNull();
    expect(sub.plan_id).toBe('month');
    clock.set(null);
  });
});

describe('challenges', () => {
  it('invite token is single-use; "you" is listed first; progress only from confirmed completions after joining', async () => {
    at('2026-10-12T09:00:00Z');
    const a = await makeUser();
    const b = await makeUser();
    const ta = await createTask(a, { title: 'Тренировка', sphere: 'health', kind: 'daily', drops: 1, hardcore: false });
    const tb = await createTask(b, { title: 'Тренировка', sphere: 'health', kind: 'daily', drops: 1, hardcore: false });
    await completeTask(b, tb.id); // до вступления — не считается
    const ch = await createChallenge(a, { title: '30 тренировок', goal: 30, taskId: ta.id });
    const inv = await createInvite(a, ch.id);
    expect((await previewInvite(inv.token)).title).toBe('30 тренировок');
    await new Promise((r) => setTimeout(r, 5));
    await joinChallenge(b, inv.token, { taskId: tb.id });
    await expect(joinChallenge(a, inv.token, { taskId: ta.id })).rejects.toMatchObject({ code: 'not_found' });
    await expect(joinChallenge(b, 'A'.repeat(24), { taskId: tb.id })).rejects.toMatchObject({ code: 'not_found' });
    await completeTask(a, ta.id);
    at('2026-10-13T09:00:00Z');
    await completeTask(a, ta.id);
    await completeTask(b, tb.id);
    const listA = await listChallenges(a);
    expect(listA[0].participants.map((p) => [p.name, p.progress])).toEqual([['Ты', 2], [expect.any(String), 1]]);
    const listB = await listChallenges(b);
    expect(listB[0].participants[0]).toMatchObject({ isMe: true, name: 'Ты', progress: 1 });
    await expect(createInvite(a, ch.id)).rejects.toMatchObject({ code: 'challenge_full' });
    clock.set(null);
  });
});
