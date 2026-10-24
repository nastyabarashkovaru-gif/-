import { beforeEach, describe, expect, it } from 'vitest';
import { api, clock, getApp, grantMembership, prisma, resetDb, upload } from './helpers';
import { signInitData, validateInitData } from '../src/auth/telegram';
import { computeLeaderboard, selectPrizeCandidates } from '../src/modules/rating';
import { refreshFlowStatuses } from '../src/modules/flows';

const NOV = '2026-11-01';

beforeEach(resetDb);

async function setupGoal(userId: number, tariff = 'm1', task: object = { title: 'Не курить', frequency: 'daily' }, category = 'habits') {
  await grantMembership(userId, NOV, tariff);
  const g = await api('POST', '/api/goals', userId, { category, title: '30 дней без сигарет', pointA: 'старт', pointB: 'финиш', confirmMethod: 'daily_reports', successCriterion: 'Ни одной сигареты' });
  expect(g.status).toBe(200);
  const t = await api('POST', `/api/goals/${g.body.id}/tasks`, userId, task);
  expect(t.status).toBe(200);
  return { goalId: g.body.id as string, taskId: t.body.id as string };
}

describe('Telegram initData', () => {
  it('принимает только корректную подпись и свежий auth_date', async () => {
    const token = '123456:TEST_TOKEN';
    const good = signInitData({ id: 7, first_name: 'A' }, token);
    expect(validateInitData(good, token)?.user.id).toBe(7);
    expect(validateInitData(good, 'other:token')).toBeNull();
    expect(validateInitData(good.replace('A', 'B'), token)).toBeNull();
    const old = signInitData({ id: 7, first_name: 'A' }, token, { authDate: Math.floor(Date.now() / 1000) - 2 * 86400 });
    expect(validateInitData(old, token)).toBeNull();
  });

  it('без подписи — 401; user_id берётся только из initData', async () => {
    const app = await getApp();
    expect((await app.inject({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: { 'x-dev-user': '5' } })).statusCode).toBe(401);
    const me = await api('GET', '/api/me', 42);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe('42');
  });
});

describe('цели и задачи', () => {
  it('лимит целей: 1 месяц — одна (критерий №4)', async () => {
    clock.set('2026-10-21T10:00:00Z');
    await setupGoal(1, 'm1');
    const second = await api('POST', '/api/goals', 1, { category: 'money', title: 'Накопить', pointA: 'старт', pointB: 'финиш', confirmMethod: 'daily_reports', successCriterion: '50 000 ₽' });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('goal_limit');
  });

  it('3 месяца — до трёх, 6 месяцев — больше трёх целей и все в рейтинге (ТЗ 1.1)', async () => {
    clock.set('2026-10-21T10:00:00Z');
    await grantMembership(3, NOV, 'm3');
    for (let i = 0; i < 3; i++) expect((await api('POST', '/api/goals', 3, { category: 'money', title: `Цель ${i}`, pointA: 'старт', pointB: 'финиш', confirmMethod: 'daily_reports', successCriterion: 'ok ok' })).status).toBe(200);
    expect((await api('POST', '/api/goals', 3, { category: 'money', title: 'Четвёртая', pointA: 'старт', pointB: 'финиш', confirmMethod: 'daily_reports', successCriterion: 'ok ok' })).status).toBe(409);

    await grantMembership(6, NOV, 'm6');
    for (let i = 0; i < 5; i++) {
      const g = await api('POST', '/api/goals', 6, { category: 'english', title: `Цель ${i}`, pointA: 'старт', pointB: 'финиш', confirmMethod: 'daily_reports', successCriterion: 'ok ok' });
      expect(g.status).toBe(200);
      expect((await api('POST', `/api/goals/${g.body.id}/tasks`, 6, { title: 'Урок', frequency: 'daily' })).status).toBe(200);
    }
    const fix = await api('POST', '/api/membership/fix', 6);
    expect(fix.body.occurrences).toBe(5 * 30);
  });

  it('до отправки анкеты можно менять, после отправки — нельзя (критерий №5, решение 24.10)', async () => {
    clock.set('2026-10-21T10:00:00Z');
    const { goalId, taskId } = await setupGoal(10);
    expect((await api('PATCH', `/api/tasks/${taskId}`, 10, { title: 'Не курить вообще' })).status).toBe(200);
    // без точек А/Б анкету не отправить
    await api('PATCH', `/api/goals/${goalId}`, 10, { pointB: null });
    expect((await api('POST', '/api/membership/fix', 10)).body.code).toBe('goal_without_points');
    await api('PATCH', `/api/goals/${goalId}`, 10, { pointB: '30 дней без сигарет' });
    const g = (await api('GET', '/api/membership', 10)).body.membership.goals[0];
    expect(g).toMatchObject({ pointA: 'старт', pointB: '30 дней без сигарет', confirmMethod: 'daily_reports', successCriterion: 'Ни одной сигареты' });
    expect((await api('POST', '/api/membership/fix', 10)).body).toMatchObject({ locked: true });

    const m0 = await api('GET', '/api/membership', 10);
    expect(m0.body.membership.status).toBe('registered');
    expect(m0.body.membership.canEdit).toBe(false);
    expect((await api('PATCH', `/api/tasks/${taskId}`, 10, { title: 'Другое' })).status).toBe(403);
    expect((await api('POST', '/api/membership/fix', 10)).status).toBe(403);

    clock.set('2026-11-02T10:00:00Z');
    await refreshFlowStatuses();
    const m = await api('GET', '/api/membership', 10);
    expect(m.body.membership.status).toBe('active');
    expect((await api('PATCH', `/api/tasks/${taskId}`, 10, { frequency: 'n_per_week', n: 2 })).status).toBe(403);
    expect((await api('DELETE', `/api/tasks/${taskId}`, 10)).status).toBe(403);
    expect((await api('POST', '/api/goals', 10, { category: 'money', title: 'Новая', successCriterion: 'ok ok' })).status).toBe(403);
  });

  it('одноразовая задача: дата обязательна и внутри месяца; категория «Другое»', async () => {
    clock.set('2026-10-21T10:00:00Z');
    await grantMembership(12, NOV, 'm1');
    const g = await api('POST', '/api/goals', 12, { category: 'other', title: 'Набрать 1 000 подписчиков', pointA: '250', pointB: '1 000', confirmMethod: 'screenshot' });
    expect(g.status).toBe(200);
    expect((await api('POST', `/api/goals/${g.body.id}/tasks`, 12, { title: 'Шапка профиля', frequency: 'once' })).body.code).toBe('due_date_required');
    expect((await api('POST', `/api/goals/${g.body.id}/tasks`, 12, { title: 'Шапка профиля', frequency: 'once', dueDate: '2026-12-05' })).body.code).toBe('due_date_out_of_flow');
    expect((await api('POST', `/api/goals/${g.body.id}/tasks`, 12, { title: 'Шапка профиля', frequency: 'once', dueDate: '2026-11-05' })).status).toBe(200);
    expect((await api('POST', `/api/goals/${g.body.id}/tasks`, 12, { title: 'Статистика', frequency: 'n_per_week', n: 3 })).status).toBe(200);
    const m = (await api('GET', '/api/membership', 12)).body.membership;
    expect(m.goals[0].tasks.map((t: { schedule: string }) => t.schedule)).toEqual(['Однократно, до 5 ноября', '3 раза в неделю']);
    const fix = await api('POST', '/api/membership/fix', 12);
    expect(fix.status).toBe(200);
    const once = await prisma.taskOccurrence.findMany({ where: { task: { frequency: 'once' } } });
    expect(once).toHaveLength(1);
    expect(once[0].windowEnd.toISOString().slice(0, 10)).toBe('2026-11-05');
  });

  it('политика категории не даёт убрать обязательное фото', async () => {
    clock.set('2026-10-21T10:00:00Z');
    await grantMembership(11, NOV, 'm1');
    const g = await api('POST', '/api/goals', 11, { category: 'weightloss', title: 'Минус 3 кг', pointA: 'старт', pointB: 'финиш', confirmMethod: 'daily_reports', successCriterion: 'Весы -3' });
    const t = await api('POST', `/api/goals/${g.body.id}/tasks`, 11, { title: 'Тренировка', frequency: 'daily', evidence: 'checkbox' });
    expect(t.body.evidence).toBe('photo');
  });
});

describe('отчёты', () => {
  it('отчёт только за сегодня, доказательство обязательно, все отчёты публичны', async () => {
    clock.set('2026-10-21T10:00:00Z');
    const { taskId } = await setupGoal(20, 'm1', { title: 'Фото тарелки', frequency: 'daily', evidence: 'photo' }, 'weightloss');
    await api('POST', '/api/membership/fix', 20);

    clock.set('2026-11-01T09:00:00Z');
    await refreshFlowStatuses();
    const noAck = await api('POST', '/api/reports', 20, { items: [{ taskId, done: true }] });
    expect(noAck.status).toBe(400);
    const noPhoto = await api('POST', '/api/reports', 20, { items: [{ taskId, done: true }], publicAck: true });
    expect(noPhoto.status).toBe(400);
    expect(noPhoto.body.code).toBe('evidence_required');

    const media = await upload(20);
    expect(media.status).toBe(200);
    const ok = await api('POST', '/api/reports', 20, { items: [{ taskId, done: true, mediaIds: [media.body.id] }], publicAck: true });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ date: '2026-11-01', marked: 1 });
    // повтор в тот же день не создаёт второе выполнение
    const again = await api('POST', '/api/reports', 20, { items: [{ taskId, done: true, mediaIds: [media.body.id] }], publicAck: true });
    expect(again.body.marked).toBe(0);

    // чужое медиа использовать нельзя
    const other = await upload(21);
    const steal = await api('POST', '/api/reports', 20, { items: [{ taskId, done: true, mediaIds: [other.body.id] }], publicAck: true });
    expect(steal.status).toBe(400);

    // на следующий день вчерашний пропуск не исправить: отчёт пишется только на сегодняшнюю дату
    clock.set('2026-11-03T09:00:00Z');
    const home = await api('GET', '/api/home', 20);
    expect(home.body.stats.days[0].state).toBe('success');
    expect(home.body.stats.days[1].state).toBe('missed');
    expect(home.body.stats).toMatchObject({ successfulDays: 1, missedReports: 1, percent: 50 });
  });

  it('загрузка медиа проверяет сигнатуру файла', async () => {
    await prisma.user.create({ data: { id: 30n, firstName: 'x' } });
    const bad = await upload(30, Buffer.from('<?php echo 1; ?>'.padEnd(64, ' ')));
    expect(bad.status).toBe(400);
  });
});

describe('рейтинг и претенденты', () => {
  it('1 и 3 цели с одинаковым % на одном месте; идеальный участник попадает в очередь проверки (критерий №9)', async () => {
    clock.set('2026-10-21T10:00:00Z');
    const a = await setupGoal(40, 'm1');
    await api('POST', '/api/membership/fix', 40);
    await grantMembership(41, NOV, 'm3');
    const tasks41: string[] = [];
    for (let i = 0; i < 3; i++) {
      const g = await api('POST', '/api/goals', 41, { category: 'habits', title: `Цель ${i}`, pointA: 'старт', pointB: 'финиш', confirmMethod: 'daily_reports', successCriterion: 'ok ok' });
      tasks41.push((await api('POST', `/api/goals/${g.body.id}/tasks`, 41, { title: 'Дело', frequency: 'daily' })).body.id);
    }
    await api('POST', '/api/membership/fix', 41);

    for (let day = 1; day <= 30; day++) {
      clock.set(`2026-11-${String(day).padStart(2, '0')}T09:00:00Z`);
      await refreshFlowStatuses();
      expect((await api('POST', '/api/reports', 40, { items: [{ taskId: a.taskId, done: true }], publicAck: true })).status).toBe(200);
      expect((await api('POST', '/api/reports', 41, { items: tasks41.map((taskId) => ({ taskId, done: true })), publicAck: true })).status).toBe(200);
    }
    clock.set('2026-12-01T09:00:00Z');
    await refreshFlowStatuses();
    const flow = await prisma.flow.findFirstOrThrow();
    const board = await computeLeaderboard(flow.id);
    expect(board.map((r) => r.rank)).toEqual([1, 1]);
    expect(board[0].ratio).toBe(1);

    // итоговая анкета: 40 подтвердил цель, 41 — не все цели
    const m40 = await prisma.flowMembership.findFirstOrThrow({ where: { userId: 40n } });
    await prisma.goal.updateMany({ where: { membershipId: m40.id }, data: { finalAchieved: true } });
    await prisma.flowMembership.update({ where: { id: m40.id }, data: { finalSubmittedAt: new Date() } });
    const m41 = await prisma.flowMembership.findFirstOrThrow({ where: { userId: 41n } });
    const g41 = await prisma.goal.findMany({ where: { membershipId: m41.id } });
    await prisma.goal.update({ where: { id: g41[0].id }, data: { finalAchieved: false } });
    await prisma.flowMembership.update({ where: { id: m41.id }, data: { finalSubmittedAt: new Date() } });

    const r = await selectPrizeCandidates(flow.id);
    expect(r.candidates).toBe(1);
    const c = await prisma.prizeCandidate.findMany();
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ userId: 40n, status: 'awaiting_review' });
    // повторный запуск идемпотентен
    expect((await selectPrizeCandidates(flow.id)).candidates).toBe(0);
  });
});
