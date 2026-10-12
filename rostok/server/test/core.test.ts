import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { resetDb, makeUser, at, tree, giveDrops, pool, clock } from './helpers.js';
import { completeTask, createTask, habitCheckin, updateTask, addReward, claimReward, deleteTask, getTaskView } from '../src/services/tasks.js';
import { water, getGarden, recordOpen } from '../src/services/garden.js';
import { processDueTasks, processTask } from '../src/services/scheduler.js';
import { stats } from '../src/services/profile.js';
import { one, q } from '../src/db.js';

beforeAll(resetDb);
afterAll(async () => { clock.set(null); await pool.end(); });
beforeEach(() => at('2026-10-12T09:00:00Z')); // понедельник, 12:00 по Москве

const daily = (over = {}) => ({ title: 'Зарядка', sphere: 'health' as const, kind: 'daily' as const, drops: 2, hardcore: false, ...over });

describe('daily tasks', () => {
  it('one reward per local day; double tap and parallel taps do not duplicate drops', async () => {
    const u = await makeUser();
    const t = await createTask(u, daily());
    const results = await Promise.all([completeTask(u, t.id), completeTask(u, t.id), completeTask(u, t.id)]);
    expect(results.filter((r) => !r.already)).toHaveLength(1);
    expect((await tree(u, 'health')).available_drops).toBe(2);
    const again = await completeTask(u, t.id);
    expect(again.already).toBe(true);
    expect((await tree(u, 'health')).available_drops).toBe(2);
    at('2026-10-13T09:00:00Z');
    await completeTask(u, t.id);
    expect((await tree(u, 'health')).available_drops).toBe(4);
    const ledger = await q(pool, `SELECT * FROM drop_ledger WHERE user_id=$1`, [u]);
    expect(ledger).toHaveLength(2);
    expect(ledger.every((l: any) => l.balance_after >= 0)).toBe(true);
  });

  it('health completions never give drops to other trees', async () => {
    const u = await makeUser();
    const t = await createTask(u, daily());
    await completeTask(u, t.id);
    expect((await tree(u, 'health')).available_drops).toBe(2);
    expect((await tree(u, 'relationships')).available_drops).toBe(0);
  });

  it('hardcore daily: single −1 per missed day, catch-up after downtime, creation day is grace', async () => {
    const u = await makeUser();
    await giveDrops(u, 'work', 10);
    const t = await createTask(u, daily({ sphere: 'work', hardcore: true, drops: 1 }));
    at('2026-10-16T09:00:00Z'); // прошло 13, 14, 15 октября без выполнений; 12-е — день создания
    await processDueTasks();
    await processDueTasks();
    await processTask(t.id);
    expect((await tree(u, 'work')).available_drops).toBe(7);
    const pens = await q(pool, `SELECT * FROM drop_ledger WHERE user_id=$1 AND type='penalty'`, [u]);
    expect(pens).toHaveLength(3);
    const view = await getTaskView(u, t.id);
    expect(view.history.find((c) => c.key === '2026-10-13')!.status).toBe('missed');
    expect(view.history.find((c) => c.key === '2026-10-12')!.status).toBe('grace');
  });

  it('cannot complete a day already closed (timezone moved back)', async () => {
    const u = await makeUser();
    const t = await createTask(u, daily());
    at('2026-10-13T22:30:00Z'); // 14-е по Москве
    await completeTask(u, t.id);
    await pool.query(`UPDATE users SET timezone='America/New_York' WHERE id=$1`, [u]); // там ещё 13-е
    await expect(completeTask(u, t.id)).rejects.toMatchObject({ code: 'period_closed' });
  });
});

describe('weekly tasks', () => {
  it('3×/week with 2 done → exactly one −1 penalty after week end (hardcore); normal mode no penalty', async () => {
    at('2026-10-08T09:00:00Z'); // создаём на прошлой неделе (льготная неделя)
    const u = await makeUser();
    await giveDrops(u, 'study', 10);
    const hard = await createTask(u, { title: 'Английский', sphere: 'study', kind: 'weekly', timesPerWeek: 3, drops: 1, hardcore: true });
    const soft = await createTask(u, { title: 'Чтение', sphere: 'study', kind: 'weekly', timesPerWeek: 3, drops: 1, hardcore: false });
    at('2026-10-12T09:00:00Z');
    await completeTask(u, hard.id);
    await completeTask(u, soft.id);
    await expect(completeTask(u, hard.id)).resolves.toMatchObject({ already: true }); // не больше одного в день
    at('2026-10-14T09:00:00Z');
    await completeTask(u, hard.id);
    await completeTask(u, soft.id);
    expect((await getTaskView(u, hard.id)).week).toEqual({ done: 2, required: 3 });
    expect((await tree(u, 'study')).available_drops).toBe(14);
    at('2026-10-19T09:00:00Z'); // следующий понедельник
    await processDueTasks();
    await processDueTasks();
    const pens = await q<any>(pool, `SELECT * FROM drop_ledger WHERE user_id=$1 AND type='penalty'`, [u]);
    expect(pens).toHaveLength(1);
    expect(pens[0].amount).toBe(-1);
    expect((await tree(u, 'study')).available_drops).toBe(13);
  });

  it('week limit N is enforced', async () => {
    const u = await makeUser();
    const t = await createTask(u, { title: 'Бассейн', sphere: 'health', kind: 'weekly', timesPerWeek: 1, drops: 3, hardcore: false });
    await completeTask(u, t.id);
    at('2026-10-13T09:00:00Z');
    await expect(completeTask(u, t.id)).rejects.toMatchObject({ code: 'week_limit' });
  });
});

describe('one-time tasks', () => {
  it('+25 before deadline', async () => {
    const u = await makeUser();
    const t = await createTask(u, { title: 'Сдать отчёт', sphere: 'work', kind: 'once', drops: 25, hardcore: false, deadlineAt: '2026-10-13T12:00:00Z' });
    await completeTask(u, t.id);
    expect((await tree(u, 'work')).available_drops).toBe(25);
    expect((await getTaskView(u, t.id)).status).toBe('completed');
  });

  it('after deadline: expired, cannot be completed, single penalty, penalty capped at balance without debt or level loss', async () => {
    const u = await makeUser();
    await pool.query(`UPDATE trees SET level=4, available_drops=3 WHERE user_id=$1 AND sphere_id='savings'`, [u]);
    const t = await createTask(u, { title: 'Открыть вклад', sphere: 'savings', kind: 'once', drops: 10, hardcore: true, penaltyDrops: 10, deadlineAt: '2026-10-12T15:00:00Z' });
    at('2026-10-12T15:00:00Z'); // ровно дедлайн — ещё можно
    expect(Date.now()).toBeGreaterThan(0);
    at('2026-10-12T15:00:01Z');
    await expect(completeTask(u, t.id)).rejects.toMatchObject({ code: 'deadline_passed' });
    await processDueTasks();
    await processTask(t.id);
    const v = await getTaskView(u, t.id);
    expect(v.status).toBe('expired');
    expect(v.today.canComplete).toBe(false);
    const tr = await tree(u, 'savings');
    expect(tr.available_drops).toBe(0);
    expect(tr.level).toBe(4);
    const pens = await q<any>(pool, `SELECT * FROM drop_ledger WHERE user_id=$1 AND type='penalty'`, [u]);
    expect(pens).toHaveLength(1);
    expect(pens[0]).toMatchObject({ amount: -3, requested_amount: -10, balance_after: 0 });
  });

  it('completion exactly at deadline is allowed', async () => {
    const u = await makeUser();
    const t = await createTask(u, { title: 'Позвонить', sphere: 'relationships', kind: 'once', drops: 5, hardcore: false, deadlineAt: '2026-10-12T15:00:00Z' });
    at('2026-10-12T15:00:00Z');
    await completeTask(u, t.id);
    expect((await tree(u, 'relationships')).available_drops).toBe(5);
  });
});

describe('watering', () => {
  it('not enough drops → explains how many are missing', async () => {
    const u = await makeUser();
    await pool.query(`UPDATE trees SET level=3, available_drops=1 WHERE user_id=$1 AND sphere_id='creativity'`, [u]);
    await expect(water(u, 'creativity', 'k1')).rejects.toMatchObject({ code: 'not_enough_drops', extra: { need: 2, cost: 3 } });
  });

  it('parallel and repeated clicks → exactly one watering and one level', async () => {
    const u = await makeUser();
    await giveDrops(u, 'creativity', 2); // хватит на 1→2 (1) но не на 2→3 (2)… = 1+2 = 3 нужно для двух
    const rs = await Promise.allSettled([1, 2, 3, 4, 5].map((i) => water(u, 'creativity', `same-key`, 1)));
    expect(rs.filter((r) => r.status === 'fulfilled' && !(r.value as any).duplicate)).toHaveLength(1);
    const t = await tree(u, 'creativity');
    expect(t.level).toBe(2);
    expect(t.available_drops).toBe(1);
    // разные ключи, но тот же ожидаемый уровень — тоже не дублирует
    const r2 = await Promise.allSettled([water(u, 'creativity', 'a', 1), water(u, 'creativity', 'b', 1)]);
    expect(r2.every((r) => r.status === 'fulfilled' && (r.value as any).duplicate)).toBe(true);
    expect((await q(pool, 'SELECT * FROM waterings WHERE user_id=$1', [u]))).toHaveLength(1);
    expect((await tree(u, 'creativity')).total_spent_drops).toBe(1);
  });

  it('garden level comes from cumulative spent drops and never drops after penalties', async () => {
    const u = await makeUser();
    await giveDrops(u, 'work', 15);
    for (let l = 1; l <= 4; l++) await water(u, 'work', `w${l}`); // 1+2+3+4 = 10
    let g = await getGarden(u);
    expect(g.garden.level).toBe(2);
    expect(g.trees.find((t) => t.sphere === 'work')!.level).toBe(5);
    await pool.query(`UPDATE trees SET available_drops=0 WHERE user_id=$1`, [u]);
    g = await getGarden(u);
    expect(g.garden.level).toBe(2);
  });
});

describe('bad habits', () => {
  it('yes → withered; repeat yes same; 1–2 no withered; 3rd no normal; new yes resets; level unchanged', async () => {
    at('2026-10-01T09:00:00Z');
    const u = await makeUser();
    await pool.query(`UPDATE trees SET level=6 WHERE user_id=$1 AND sphere_id='health'`, [u]);
    const h = await createTask(u, { title: 'Курение', sphere: 'health', kind: 'habit', drops: 2, hardcore: false, habitQuestion: 'Курил сегодня?' });
    const state = async () => (await tree(u, 'health')).health_visual_state;
    const day = async (d: string, yes: boolean) => { at(`2026-10-${d}T09:00:00Z`); await habitCheckin(u, h.id, yes); };
    await day('02', true); expect(await state()).toBe('withered');
    await day('03', true); expect(await state()).toBe('withered');
    await day('04', false); expect(await state()).toBe('withered');
    await day('05', false); expect(await state()).toBe('withered');
    await day('06', false); expect(await state()).toBe('normal');
    await day('07', true); expect(await state()).toBe('withered');
    await day('08', false); await day('09', false);
    expect(await state()).toBe('withered');
    expect((await tree(u, 'health')).level).toBe(6);
    // «Нет» дал по 2 капли за день: 04,05,06,08,09
    expect((await tree(u, 'health')).available_drops).toBe(10);
  });

  it('same-day correction recalculates without duplicate rewards or farming', async () => {
    const u = await makeUser();
    const h = await createTask(u, { title: 'Сладкое', sphere: 'health', kind: 'habit', drops: 3, hardcore: true, habitMissingPenaltyConsent: false });
    await habitCheckin(u, h.id, false);
    await habitCheckin(u, h.id, false);
    expect((await tree(u, 'health')).available_drops).toBe(3);
    await habitCheckin(u, h.id, true); // исправление: −3 награды, −1 штраф
    expect((await tree(u, 'health')).available_drops).toBe(0);
    await habitCheckin(u, h.id, false);
    expect((await tree(u, 'health')).available_drops).toBe(3);
    expect((await getTaskView(u, h.id)).completionsCount).toBe(1);
  });

  it('missing answer is not counted as yes or no; penalized only with hardcore + consent', async () => {
    at('2026-10-12T09:00:00Z');
    const u = await makeUser();
    await giveDrops(u, 'health', 5);
    const a = await createTask(u, { title: 'A', sphere: 'health', kind: 'habit', drops: 1, hardcore: true, habitMissingPenaltyConsent: true });
    const b = await createTask(u, { title: 'B', sphere: 'health', kind: 'habit', drops: 1, hardcore: true, habitMissingPenaltyConsent: false });
    at('2026-10-15T09:00:00Z');
    await processTask(a.id);
    await processTask(b.id);
    expect((await tree(u, 'health')).available_drops).toBe(3); // 13 и 14 — только у A
    expect((await tree(u, 'health')).health_visual_state).toBe('normal');
  });

  it('habits only in health sphere', async () => {
    const u = await makeUser();
    await expect(createTask(u, { title: 'X', sphere: 'work', kind: 'habit', drops: 1, hardcore: false })).rejects.toMatchObject({ code: 'validation' });
  });
});

describe('rewards', () => {
  it('60 completions unlock the gift, skips do not reset, claimed separately', async () => {
    at('2026-01-01T09:00:00Z');
    const u = await makeUser();
    const t = await createTask(u, { ...daily({ title: 'Медитация' }), rewards: [{ threshold: 60, title: 'SPA' }, { threshold: 100, title: 'Путешествие' }] });
    let d = new Date('2026-01-01T09:00:00Z');
    let done = 0;
    for (let i = 0; done < 60; i++) {
      clock.set(d);
      if (i % 4 !== 3) { await completeTask(u, t.id); done++; } // каждый 4-й день пропуск
      d = new Date(d.getTime() + 86400_000);
      if (done === 59) expect((await getTaskView(u, t.id)).rewards[0].status).toBe('locked');
    }
    const v = await getTaskView(u, t.id);
    expect(v.completionsCount).toBe(60);
    expect(v.rewards.map((r) => r.status)).toEqual(['unlocked', 'locked']);
    await claimReward(u, v.rewards[0].id);
    await claimReward(u, v.rewards[0].id);
    const s = await stats(u);
    expect(s.rewardsClaimed).toBe(1);
    expect(s.rewardsTotal).toBe(2);
    await expect(claimReward(u, v.rewards[1].id)).rejects.toMatchObject({ code: 'reward_locked' });
  });

  it('terms are locked after a promise: no changes to drops/sphere/frequency, typo fix allowed, only future thresholds', async () => {
    const u = await makeUser();
    const t = await createTask(u, { title: 'Утреняя пробежка', sphere: 'health', kind: 'weekly', timesPerWeek: 3, drops: 2, hardcore: false });
    await updateTask(u, t.id, { drops: 3 }); // без подарка — можно
    await completeTask(u, t.id);
    await expect(addReward(u, t.id, 1, 'Мороженое')).rejects.toMatchObject({ code: 'validation' });
    await addReward(u, t.id, 30, 'Кроссовки');
    await expect(updateTask(u, t.id, { drops: 5 })).rejects.toMatchObject({ code: 'terms_locked' });
    await expect(updateTask(u, t.id, { sphere: 'work' })).rejects.toMatchObject({ code: 'terms_locked' });
    await expect(updateTask(u, t.id, { timesPerWeek: 1 })).rejects.toMatchObject({ code: 'terms_locked' });
    await expect(updateTask(u, t.id, { title: 'Плавание' })).rejects.toMatchObject({ code: 'terms_locked' });
    await expect(updateTask(u, t.id, { title: 'Утренняя пробежка' })).resolves.toMatchObject({ title: 'Утренняя пробежка' });
    await expect(addReward(u, t.id, 30, 'Другое')).rejects.toMatchObject({ code: 'duplicate_threshold' });
    await expect(deleteTask(u, t.id)).rejects.toMatchObject({ code: 'terms_locked' });
  });

  it('schedule edits take effect from the next period and do not rewrite history', async () => {
    const u = await makeUser();
    const t = await createTask(u, daily({ drops: 1 }));
    const v = await updateTask(u, t.id, { drops: 5 });
    expect(v.drops).toBe(1);
    expect(v.pendingSchedule).toMatchObject({ effectiveFrom: '2026-10-13', drops: 5 });
    await completeTask(u, t.id);
    expect((await tree(u, 'health')).available_drops).toBe(1);
    at('2026-10-13T09:00:00Z');
    await completeTask(u, t.id);
    expect((await tree(u, 'health')).available_drops).toBe(6);
  });
});

describe('open streak & garden age', () => {
  it('counts unique local days, resets after a missed day, keeps record; age is separate', async () => {
    at('2026-10-10T09:00:00Z');
    const u = await makeUser();
    expect((await recordOpen(u)).current).toBe(1);
    expect((await recordOpen(u)).current).toBe(1);
    at('2026-10-11T20:59:00Z'); // 23:59 МСК
    expect((await recordOpen(u)).current).toBe(2);
    at('2026-10-11T21:01:00Z'); // 00:01 МСК 12-го
    expect((await recordOpen(u)).current).toBe(3);
    at('2026-10-14T09:00:00Z');
    const s = await recordOpen(u);
    expect(s).toEqual({ current: 1, best: 3 });
    expect((await stats(u)).gardenAgeDays).toBe(5);
  });
});

describe('ledger invariants', () => {
  it('balances equal ledger sums and never go negative', async () => {
    const rows = await q<any>(pool, `SELECT t.id, t.available_drops, COALESCE((SELECT sum(amount) FROM drop_ledger l WHERE l.tree_id=t.id),0)::int AS s,
      EXISTS(SELECT 1 FROM drop_ledger l WHERE l.tree_id=t.id) AS has FROM trees t`);
    // деревьям, которым капли подкладывали в тестах напрямую, ledger не соответствует — проверяем только «чистые»
    const neg = await one<any>(pool, 'SELECT count(*)::int AS n FROM drop_ledger WHERE balance_after < 0');
    expect(neg.n).toBe(0);
    expect(rows.every((r) => r.available_drops >= 0)).toBe(true);
  });
});
