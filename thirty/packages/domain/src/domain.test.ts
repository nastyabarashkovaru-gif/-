import { describe, expect, it } from 'vitest';
import {
  flowBounds, nearestJoinableFlow, planPurchase, planRenewal, subscriptionStatusOn, coversFlow, generateOccurrences,
  computeStats, isPerfect, rank, compareWithPrevious, quote, offerActive, matchBuddies, weekCardStats, cardForFlowDay,
  prizePool, assignPlaces, funnelRates, pickVariant, canAddGoal, DEFAULT_TARIFFS, dayDeadline, localDate, eachDay,
  canRequestReplacement, formatRub, MAIN_PITCH,
} from './index';

const msk = 'Europe/Moscow';
const at = (iso: string) => new Date(iso);

describe('календарь потока', () => {
  it('поток = календарный месяц с фактическим числом дней', () => {
    expect(flowBounds('2026-11-15')).toMatchObject({ startsOn: '2026-11-01', endsOn: '2026-11-30', days: 30, title: 'Ноябрь 2026' });
    expect(flowBounds('2026-12-01').days).toBe(31);
    expect(flowBounds('2027-02-10').days).toBe(28);
    expect(flowBounds('2028-02-10').days).toBe(29); // високосный
  });

  it('локальная дата и дедлайн дня в часовом поясе потока', () => {
    // 21:30 UTC 31 октября = 00:30 МСК 1 ноября
    expect(localDate(at('2026-10-31T21:30:00Z'), msk)).toBe('2026-11-01');
    expect(dayDeadline('2026-11-01', msk).toISOString()).toBe('2026-11-01T21:00:00.000Z');
    expect(dayDeadline('2026-11-01', 'Asia/Vladivostok').toISOString()).toBe('2026-11-01T14:00:00.000Z');
  });

  it('покупка до 1-го числа резервирует ближайший поток; 1-го числа можно войти в текущий', () => {
    expect(nearestJoinableFlow(at('2026-10-21T10:00:00Z'), msk)).toBe('2026-11-01');
    expect(nearestJoinableFlow(at('2026-10-31T20:59:00Z'), msk)).toBe('2026-11-01');
    expect(nearestJoinableFlow(at('2026-10-31T21:01:00Z'), msk)).toBe('2026-11-01'); // уже 1 ноября по МСК
    expect(nearestJoinableFlow(at('2026-11-02T08:00:00Z'), msk)).toBe('2026-12-01');
    expect(nearestJoinableFlow(at('2026-11-01T08:00:00Z'), msk, 0)).toBe('2026-12-01');
    expect(nearestJoinableFlow(at('2026-12-15T08:00:00Z'), msk)).toBe('2027-01-01');
  });
});

describe('биллинг (критерий приёмки №2)', () => {
  it('21 октября, 3 месяца → ноябрь–январь, следующий платёж 28 января, без 28.11 и 28.12', () => {
    const p = planPurchase({ now: at('2026-10-21T09:00:00Z'), tz: msk, months: 3 });
    expect(p.flows).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(p.chargeDate).toBe('2027-01-28');
    expect(p.needsShift).toBe(true); // естественная дата 21.01 → переносим вперёд на 28.01
    expect(p.renewalFlows).toEqual(['2027-02-01', '2027-03-01', '2027-04-01']);
  });

  it('1 и 6 месяцев', () => {
    const m1 = planPurchase({ now: at('2026-10-21T09:00:00Z'), tz: msk, months: 1 });
    expect(m1.flows).toEqual(['2026-11-01']);
    expect(m1.chargeDate).toBe('2026-11-28');
    const m6 = planPurchase({ now: at('2026-10-21T09:00:00Z'), tz: msk, months: 6 });
    expect(m6.lastFlow).toBe('2027-04-01');
    expect(m6.chargeDate).toBe('2027-04-28');
  });

  it('покупка 29–31 числа: перенос назад невозможен, остаётся естественная дата до старта следующего потока', () => {
    const p = planPurchase({ now: at('2026-10-30T09:00:00Z'), tz: msk, months: 1 });
    expect(p.flows).toEqual(['2026-11-01']);
    expect(p.targetChargeDate).toBe('2026-11-28');
    expect(p.chargeDate).toBe('2026-11-30');
    expect(p.needsShift).toBe(false);
    expect(p.chargeDate < '2026-12-01').toBe(true);
  });

  it('покупка 31 января на месяц (февраль): дата не выходит за февраль', () => {
    const p = planPurchase({ now: at('2027-01-31T09:00:00Z'), tz: msk, months: 1 });
    expect(p.flows).toEqual(['2027-02-01']);
    expect(p.chargeDate).toBe('2027-02-28');
    expect(p.chargeDate < '2027-03-01').toBe(true);
  });

  it('продление: следующие N потоков, снова 28-го', () => {
    expect(planRenewal('2027-01-01', 3)).toEqual({ flows: ['2027-02-01', '2027-03-01', '2027-04-01'], lastFlow: '2027-04-01', nextChargeDate: '2027-04-28' });
    expect(planRenewal('2027-01-01', 1).nextChargeDate).toBe('2027-02-28');
  });

  it('статусы подписки', () => {
    const base = { paidFromFlow: '2026-11-01', paidThroughFlow: '2027-01-01', autoRenew: true, nextChargeDate: '2027-01-28' };
    expect(subscriptionStatusOn({ ...base, today: '2026-10-21' })).toBe('prestart');
    expect(subscriptionStatusOn({ ...base, today: '2026-11-28' })).toBe('active'); // 28 ноября списания нет
    expect(subscriptionStatusOn({ ...base, today: '2027-01-29' })).toBe('past_due');
    expect(subscriptionStatusOn({ ...base, today: '2027-02-01' })).toBe('expired');
    expect(subscriptionStatusOn({ ...base, autoRenew: false, today: '2026-12-10' })).toBe('canceled_at_period_end');
    expect(coversFlow('2026-11-01', '2027-01-01', '2026-12-01')).toBe(true);
    expect(coversFlow('2026-11-01', '2027-01-01', '2027-02-01')).toBe(false);
  });
});

describe('тарифы и цены (ТЗ 1.1)', () => {
  it('акционные цены и сравнение с отдельными месяцами', () => {
    const [m1, m3, m6] = DEFAULT_TARIFFS;
    expect([m1.promoPrice, m3.promoPrice, m6.promoPrice]).toEqual([999, 2490, 3990]);
    expect(quote(m1, true)).toMatchObject({ price: 999, comparison: 2990, savingsPercent: 67 });
    expect(quote(m3, true)).toMatchObject({ price: 2490, comparison: 8970, savingsPercent: 72 });
    expect(quote(m6, true)).toMatchObject({ price: 3990, comparison: 17940, savingsPercent: 78 });
    expect(quote(m3, false).price).toBe(m3.regularPrice);
    expect(formatRub(17940)).toBe('17 940 ₽');
  });

  it('в карточке месячного тарифа нет «архив» / «preview» / «превью»', () => {
    const text = DEFAULT_TARIFFS[0].features.join(' ').toLowerCase();
    expect(text).not.toMatch(/архив|preview|превью/);
  });

  it('6-месячный тариф не обещает доп. материалов', () => {
    expect(DEFAULT_TARIFFS[2].features.join(' ').toLowerCase()).not.toMatch(/материал|обучени/);
  });

  it('лимит целей: 1 / 3 / безлимит (критерий №4)', () => {
    expect(canAddGoal(1, 0)).toBe(true);
    expect(canAddGoal(1, 1)).toBe(false);
    expect(canAddGoal(3, 2)).toBe(true);
    expect(canAddGoal(3, 3)).toBe(false);
    expect(canAddGoal(null, 10)).toBe(true);
  });

  it('предложение действует 3 часа и не сбрасывается', () => {
    const offer = { startedAt: at('2026-10-21T10:00:00Z'), expiresAt: at('2026-10-21T13:00:00Z') };
    expect(offerActive(offer, at('2026-10-21T12:59:59Z'))).toBe(true);
    expect(offerActive(offer, at('2026-10-21T13:00:00Z'))).toBe(false);
    expect(offerActive({ ...offer, consumedAt: at('2026-10-21T11:00:00Z') }, at('2026-10-21T11:30:00Z'))).toBe(false);
  });

  it('основная формулировка не изменена', () => {
    expect(MAIN_PITCH).toContain('30 дней, чтобы доказать себе, что ты можешь.');
  });
});

describe('расписание задач', () => {
  it('ежедневно: столько, сколько дней в месяце', () => {
    expect(generateOccurrences({ frequency: 'daily', n: 1 }, '2027-02-01')).toHaveLength(28);
    expect(generateOccurrences({ frequency: 'daily', n: 1 }, '2028-02-01')).toHaveLength(29);
    expect(generateOccurrences({ frequency: 'daily', n: 1 }, '2026-12-01')).toHaveLength(31);
  });

  it('каждые N дней', () => {
    const occ = generateOccurrences({ frequency: 'every_n_days', n: 3 }, '2026-11-01');
    expect(occ.map((o) => o.windowStart).slice(0, 3)).toEqual(['2026-11-01', '2026-11-04', '2026-11-07']);
    expect(occ).toHaveLength(10); // 1,4,...,28
  });

  it('N раз в неделю: неполные недели на границах месяца', () => {
    // Ноябрь 2026: 1 ноября — воскресенье
    const occ = generateOccurrences({ frequency: 'n_per_week', n: 3 }, '2026-11-01');
    const first = occ.filter((o) => o.windowStart === '2026-11-01');
    expect(first).toHaveLength(1); // неделя из 1 дня: ⌈3·1/7⌉ = 1
    expect(first[0].windowEnd).toBe('2026-11-01');
    const full = occ.filter((o) => o.windowStart === '2026-11-02');
    expect(full).toHaveLength(3);
    expect(full[0].windowEnd).toBe('2026-11-08');
    const last = occ.filter((o) => o.windowStart === '2026-11-30');
    expect(last).toHaveLength(1);
  });

  it('некорректная периодичность отклоняется', () => {
    expect(() => generateOccurrences({ frequency: 'n_per_week', n: 8 }, '2026-11-01')).toThrow();
    expect(() => generateOccurrences({ frequency: 'every_n_days', n: 0 }, '2026-11-01')).toThrow();
  });
});

describe('рейтинг', () => {
  const flowStart = '2026-11-01';
  const flowEnd = '2026-11-30';
  const days = eachDay(flowStart, flowEnd);
  const daily = (doneUntil: string, skip: string[] = []) =>
    days.map((d) => ({ windowStart: d, windowEnd: d, done: d <= doneUntil && !skip.includes(d) }));

  it('процент по обязательствам, сегодняшний день не штрафуется до дедлайна', () => {
    const s = computeStats({ flowStart, flowEnd, today: '2026-11-13', occurrences: daily('2026-11-12'), reportDates: days.filter((d) => d <= '2026-11-12') });
    expect(s).toMatchObject({ completed: 12, scheduled: 12, ratio: 1, successfulDays: 12, missedReports: 0, currentStreak: 12, perfectSoFar: true });
    expect(s.days[12].state).toBe('today');
    expect(s.days[13].state).toBe('future');
  });

  it('пропуск снижает процент, обнуляет серию и не исправляется задним числом', () => {
    const s = computeStats({
      flowStart, flowEnd, today: '2026-11-13',
      occurrences: daily('2026-11-12', ['2026-11-05']),
      reportDates: days.filter((d) => d <= '2026-11-12' && d !== '2026-11-05'),
    });
    expect(s.completed).toBe(11);
    expect(s.scheduled).toBe(12);
    expect(s.ratio).toBeCloseTo(11 / 12);
    expect(s.missedReports).toBe(1);
    expect(s.currentStreak).toBe(7);
    expect(s.longestStreak).toBe(7);
    expect(s.perfectSoFar).toBe(false);
    expect(s.days[4].state).toBe('missed');
  });

  it('одна и три цели с одинаковым % весят одинаково (нет бонуса за число целей)', () => {
    const one = computeStats({ flowStart, flowEnd, today: '2026-12-01', occurrences: daily('2026-11-30', ['2026-11-10']), reportDates: days });
    const three = computeStats({
      flowStart, flowEnd, today: '2026-12-01',
      occurrences: [...daily('2026-11-30', ['2026-11-10']), ...daily('2026-11-30', ['2026-11-10']), ...daily('2026-11-30', ['2026-11-10'])],
      reportDates: days,
    });
    expect(one.ratio).toBeCloseTo(three.ratio);
    const ranked = rank([
      { userId: 'a', ratio: one.ratio, successfulDays: one.successfulDays, longestStreak: one.longestStreak },
      { userId: 'b', ratio: three.ratio, successfulDays: three.successfulDays, longestStreak: three.longestStreak },
    ]);
    expect(ranked[0].rank).toBe(ranked[1].rank);
  });

  it('идеальный результат требует 100%, все отчёты и подтверждение всех целей', () => {
    const facts = { flowStart, flowEnd, today: '2026-12-01', occurrences: daily('2026-11-30'), reportDates: days };
    expect(isPerfect(facts, [true, true])).toBe(true);
    expect(isPerfect(facts, [true, false])).toBe(false);
    expect(isPerfect(facts, [true, null])).toBe(false);
    expect(isPerfect({ ...facts, reportDates: days.slice(1) }, [true])).toBe(false);
    expect(isPerfect({ ...facts, occurrences: daily('2026-11-29') }, [true])).toBe(false);
  });

  it('тай-брейк по публичным критериям', () => {
    const r = rank([
      { userId: 'x', ratio: 0.9, successfulDays: 20, longestStreak: 10 },
      { userId: 'y', ratio: 1, successfulDays: 28, longestStreak: 28, finalSubmittedAt: '2026-12-01T10:00:00Z' },
      { userId: 'z', ratio: 1, successfulDays: 28, longestStreak: 28, finalSubmittedAt: '2026-12-01T09:00:00Z' },
    ]);
    expect(r.map((x) => [x.userId, x.rank])).toEqual([['z', 1], ['y', 2], ['x', 3]]);
  });

  it('сравнение с прошлым месяцем: первый месяц от нуля (критерий №6)', () => {
    expect(compareWithPrevious(null, 24)).toEqual({ firstMonth: true, baseline: 0, current: 24, delta: 24 });
    expect(compareWithPrevious(20, 24)).toEqual({ firstMonth: false, baseline: 20, current: 24, delta: 4 });
  });
});

describe('бадди', () => {
  const pool = [
    { userId: '1', interests: ['money'], city: 'Москва' },
    { userId: '2', interests: ['english'], city: 'Казань' },
    { userId: '3', interests: ['money', 'blog'], city: 'Пермь' },
    { userId: '4', interests: ['english'], city: 'Москва' },
    { userId: '5', interests: ['habits'] },
  ];

  it('сначала общие интересы, у каждого не больше одного бадди, нечётный ждёт', () => {
    const { pairs, unmatched } = matchBuddies(pool, 'flow-1');
    const ids = pairs.flatMap((p) => [p.a, p.b]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(pairs).toContainEqual(expect.objectContaining({ a: '1', b: '3', reason: 'interests' }));
    expect(pairs).toContainEqual(expect.objectContaining({ a: '2', b: '4', reason: 'interests' }));
    expect(unmatched).toEqual(['5']);
  });

  it('детерминирован по seed — повторный запуск даёт тот же результат', () => {
    expect(matchBuddies(pool, 'flow-1')).toEqual(matchBuddies([...pool].reverse(), 'flow-1'));
  });

  it('замена: по согласию сразу, по отсутствию связи — после 5 дней', () => {
    const created = at('2026-11-01T00:00:00Z');
    expect(canRequestReplacement('mutual', null, created, at('2026-11-02T00:00:00Z'))).toBe(true);
    expect(canRequestReplacement('no_contact_5d', null, created, at('2026-11-05T00:00:00Z'))).toBe(false);
    expect(canRequestReplacement('no_contact_5d', null, created, at('2026-11-06T00:00:01Z'))).toBe(true);
  });
});

describe('карточки, призы, воронка', () => {
  it('карточки на 7/14/21/28 день, первая неделя сравнивается с 0', () => {
    expect([7, 14, 21, 28, 13].map(cardForFlowDay)).toEqual([1, 2, 3, 4, null]);
    const succ = eachDay('2026-11-01', '2026-11-14').filter((d) => d !== '2026-11-03');
    const w1 = weekCardStats({ flowStart: '2026-11-01', flowEnd: '2026-11-30', week: 1, successfulDates: succ, completedByDate: {} });
    expect(w1).toMatchObject({ from: '2026-11-01', to: '2026-11-07', successfulDays: 6, previous: { successfulDays: 0 }, delta: 6 });
    const w2 = weekCardStats({ flowStart: '2026-11-01', flowEnd: '2026-11-30', week: 2, successfulDates: succ, completedByDate: {} });
    expect(w2).toMatchObject({ successfulDays: 7, delta: 1 });
  });

  it('фонд — из подтверждённых поступлений по формуле', () => {
    expect(prizePool(100000, { percentOfRevenue: 10, fixed: 0, cap: null })).toBe(10000);
    expect(prizePool(100000, { percentOfRevenue: 10, fixed: 5000, cap: 12000 })).toBe(12000);
    expect(prizePool(0, { percentOfRevenue: 0, fixed: 0, cap: null })).toBe(0);
  });

  it('не больше трёх призовых мест, ноль — нет победителей', () => {
    expect(assignPlaces([]).outcome).toBe('none');
    const r = assignPlaces([{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }, { userId: 'd' }]);
    expect(r.winners.map((w) => w.place)).toEqual([1, 2, 3]);
  });

  it('воронка: % от предыдущего шага и от входа', () => {
    const r = funnelRates([{ key: 'a', title: '', count: 200 }, { key: 'b', title: '', count: 100 }, { key: 'c', title: '', count: 25 }]);
    expect(r[1]).toMatchObject({ pctPrev: 50, pctStart: 50, dropOff: 100 });
    expect(r[2]).toMatchObject({ pctPrev: 25, pctStart: 12.5 });
  });

  it('A/B-вариант стабилен для пользователя', () => {
    const v = [{ key: 'A', weight: 50 }, { key: 'B', weight: 50 }];
    expect(pickVariant('42', 'exp', v)).toBe(pickVariant('42', 'exp', v));
    const counts = { A: 0, B: 0 } as Record<string, number>;
    for (let i = 0; i < 2000; i++) counts[pickVariant(String(i), 'exp', v)]++;
    expect(counts.A).toBeGreaterThan(850);
    expect(counts.B).toBeGreaterThan(850);
  });
});
