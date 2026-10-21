import { describe, expect, it } from 'vitest';
import { eachDay, generateOccurrences, toDbDate } from '@thirty/domain';
import { auth, clock, getApp, prisma, resetDb } from './helpers';
import { ensureFlow } from '../src/modules/flows';
import { computeLeaderboard } from '../src/modules/rating';

/** Нагрузка: 1200 участников × 3 ежедневные цели × 30 дней (≈108 тыс. выполнений). Запуск: LOAD=1 npx vitest run test/load.test.ts */
describe.runIf(process.env.LOAD === '1')('нагрузка 1000+ участников', () => {
  it('рейтинг и главная укладываются в бюджет времени', async () => {
    await resetDb();
    clock.set('2026-11-25T12:00:00Z');
    const flow = await ensureFlow('2026-11-01');
    await prisma.flow.update({ where: { id: flow.id }, data: { status: 'active' } });
    const N = 1200;
    const days = eachDay('2026-11-01', '2026-11-24');
    const occ = generateOccurrences({ frequency: 'daily', n: 1 }, '2026-11-01');
    const t0 = Date.now();
    for (let i = 0; i < N; i++) {
      const id = BigInt(10_000 + i);
      await prisma.user.create({ data: { id, firstName: `U${i}` } });
      const m = await prisma.flowMembership.create({ data: { userId: id, flowId: flow.id, tariffId: 'm3', status: 'active' } });
      const rows: { taskId: string; membershipId: string; windowStart: Date; windowEnd: Date; status: 'done' | 'pending' }[] = [];
      for (let g = 0; g < 3; g++) {
        const goal = await prisma.goal.create({ data: { membershipId: m.id, category: 'habits', title: `Цель ${g}`, successCriterion: 'ok' } });
        const task = await prisma.task.create({ data: { goalId: goal.id, title: 't', frequency: 'daily' } });
        for (const o of occ) {
          const done = o.windowStart < '2026-11-25' && (i % 7 !== 0 || o.windowStart !== '2026-11-10');
          rows.push({ taskId: task.id, membershipId: m.id, windowStart: toDbDate(o.windowStart), windowEnd: toDbDate(o.windowEnd), status: done ? 'done' : 'pending' });
        }
      }
      await prisma.taskOccurrence.createMany({ data: rows });
      await prisma.dailyReport.createMany({ data: days.map((d) => ({ membershipId: m.id, date: toDbDate(d) })) });
    }
    const seedMs = Date.now() - t0;
    const t1 = Date.now();
    const board = await computeLeaderboard(flow.id);
    const boardMs = Date.now() - t1;
    expect(board).toHaveLength(N);
    const app = await getApp();
    const t2 = Date.now();
    const res = await app.inject({ method: 'GET', url: '/api/home', headers: auth(10_001) });
    const homeMs = Date.now() - t2;
    expect(res.statusCode).toBe(200);
    const t3 = Date.now();
    const lb = await app.inject({ method: 'GET', url: '/api/leaderboard', headers: auth(10_001) });
    const lbMs = Date.now() - t3;
    expect(lb.statusCode).toBe(200);
    console.log(JSON.stringify({ participants: N, occurrences: N * 3 * occ.length, seedMs, leaderboardComputeMs: boardMs, homeMs, leaderboardApiMs: lbMs }));
    expect(boardMs).toBeLessThan(15_000);
    expect(homeMs).toBeLessThan(1_000);
    expect(lbMs).toBeLessThan(3_000);
  }, 900_000);
});
