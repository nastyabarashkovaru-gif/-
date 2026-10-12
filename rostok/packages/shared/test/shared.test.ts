import { describe, expect, it } from 'vitest';
import {
  wateringCost, gardenLevel, gardenThreshold, validateLevelCurve, DEFAULT_LEVEL_CURVE,
  isHabitWithered, healthTreeState, habitTargetAmount,
  localDate, weekStart, openStreak, longestStreak, deadlineFromLocal, addDays,
  validateTaskInput, isTypoFix, completionsLabel,
} from '../src/index';

describe('level curve', () => {
  it('matches the starting table', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((l) => wateringCost(l))).toEqual([1, 2, 3, 4, 5, 7, 9, 12, 15, 20]);
    expect([11, 12, 13, 14, 15, 16].map((l) => wateringCost(l))).toEqual([25, 30, 35, 40, 45, 50]);
  });
  it('grows smoothly with a soft ceiling and no jumps', () => {
    let prev = wateringCost(16);
    for (let l = 17; l < 300; l++) {
      const c = wateringCost(l);
      expect(c).toBeGreaterThanOrEqual(prev);
      expect(c - prev).toBeLessThanOrEqual(5);
      expect(c).toBeLessThanOrEqual(90);
      prev = c;
    }
  });
  it('validates config', () => {
    expect(validateLevelCurve(DEFAULT_LEVEL_CURVE)).toBe(true);
    expect(validateLevelCurve({ table: [3, 2], tail: { ceiling: 90, rate: 0.1 } })).toBe(false);
  });
});

describe('garden level', () => {
  it('uses cumulative spent drops thresholds', () => {
    expect(gardenLevel(0)).toBe(1);
    expect(gardenLevel(9)).toBe(1);
    expect(gardenLevel(10)).toBe(2);
    expect(gardenLevel(29)).toBe(2);
    expect(gardenLevel(30)).toBe(3);
    expect(gardenLevel(100)).toBe(5);
    for (let s = 0; s < 5000; s += 7) expect(gardenThreshold(gardenLevel(s))).toBeLessThanOrEqual(s);
  });
});

describe('habit withering', () => {
  const c = (date: string, yes: boolean) => ({ date, yes });
  it('yes → withered, repeated yes stays withered', () => {
    expect(isHabitWithered([c('2026-10-01', true)])).toBe(true);
    expect(isHabitWithered([c('2026-10-01', true), c('2026-10-02', true)])).toBe(true);
  });
  it('1 and 2 consecutive no → still withered, 3rd → normal', () => {
    const base = [c('2026-10-01', true)];
    expect(isHabitWithered([...base, c('2026-10-02', false)])).toBe(true);
    expect(isHabitWithered([...base, c('2026-10-02', false), c('2026-10-03', false)])).toBe(true);
    expect(isHabitWithered([...base, c('2026-10-02', false), c('2026-10-03', false), c('2026-10-04', false)])).toBe(false);
  });
  it('new yes resets recovery; missing day breaks the run', () => {
    expect(isHabitWithered([c('2026-10-01', true), c('2026-10-02', false), c('2026-10-03', false), c('2026-10-04', true), c('2026-10-05', false)])).toBe(true);
    expect(isHabitWithered([c('2026-10-01', true), c('2026-10-02', false), c('2026-10-03', false), c('2026-10-05', false)])).toBe(true);
    expect(isHabitWithered([c('2026-10-01', true), c('2026-10-02', false), c('2026-10-04', false), c('2026-10-05', false), c('2026-10-06', false)])).toBe(false);
  });
  it('a gap after recovery does not re-wither', () => {
    expect(isHabitWithered([c('2026-10-01', true), c('2026-10-02', false), c('2026-10-03', false), c('2026-10-04', false), c('2026-10-06', false)])).toBe(false);
  });
  it('several habits: normal only when none withered', () => {
    expect(healthTreeState([[c('2026-10-01', false)], [c('2026-10-01', true)]])).toBe('withered');
    expect(healthTreeState([[c('2026-10-01', false)], []])).toBe('normal');
  });
  it('target amounts', () => {
    expect(habitTargetAmount(false, 3, true)).toBe(3);
    expect(habitTargetAmount(true, 3, true)).toBe(-1);
    expect(habitTargetAmount(true, 3, false)).toBe(0);
  });
});

describe('periods', () => {
  it('local date respects timezone', () => {
    const t = new Date('2026-10-12T22:30:00Z');
    expect(localDate(t, 'Europe/Moscow')).toBe('2026-10-13');
    expect(localDate(t, 'America/New_York')).toBe('2026-10-12');
  });
  it('week is Monday–Sunday', () => {
    expect(weekStart('2026-10-12')).toBe('2026-10-12'); // Monday
    expect(weekStart('2026-10-18')).toBe('2026-10-12'); // Sunday
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
  });
  it('DST-safe day arithmetic', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    const dl = deadlineFromLocal('2026-03-29', '12:00', 'Europe/Berlin')!;
    expect(dl.toISOString()).toBe('2026-03-29T10:00:00.000Z');
  });
  it('open streak counts unique days and resets after a gap', () => {
    expect(openStreak(['2026-10-10', '2026-10-11', '2026-10-12'], '2026-10-12')).toBe(3);
    expect(openStreak(['2026-10-10', '2026-10-11'], '2026-10-12')).toBe(2);
    expect(openStreak(['2026-10-09', '2026-10-11', '2026-10-12'], '2026-10-12')).toBe(2);
    expect(openStreak(['2026-10-09'], '2026-10-12')).toBe(0);
    expect(longestStreak(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05'])).toBe(3);
  });
});

describe('task validation', () => {
  const now = new Date('2026-10-12T10:00:00Z');
  const base = { title: 'Бег', sphere: 'health' as const, kind: 'daily' as const, drops: 1, hardcore: false };
  it('accepts valid and rejects invalid', () => {
    expect(validateTaskInput(base, now)).toBeNull();
    expect(validateTaskInput({ ...base, title: ' ' }, now)).toMatch(/название/);
    expect(validateTaskInput({ ...base, drops: 6 }, now)).toMatch(/1 до 5/);
    expect(validateTaskInput({ ...base, kind: 'once', drops: 25 }, now)).toMatch(/дедлайн/);
    expect(validateTaskInput({ ...base, kind: 'once', drops: 25, deadlineAt: '2026-10-11T10:00:00Z' }, now)).toMatch(/будущем/);
    expect(validateTaskInput({ ...base, kind: 'once', drops: 25, deadlineAt: '2026-10-13T10:00:00Z' }, now)).toBeNull();
    expect(validateTaskInput({ ...base, kind: 'habit', sphere: 'work' }, now)).toMatch(/Здоровье/);
    expect(validateTaskInput({ ...base, kind: 'weekly', timesPerWeek: 8 }, now)).toMatch(/1 до 7/);
    expect(validateTaskInput({ ...base, rewards: [{ threshold: 60, title: 'SPA' }, { threshold: 60, title: 'x' }] }, now)).toMatch(/одном пороге/);
  });
  it('typo fix detection and labels', () => {
    expect(isTypoFix('Утреняя пробежка', 'Утренняя пробежка')).toBe(true);
    expect(isTypoFix('Утренняя пробежка', 'Читать книгу')).toBe(false);
    expect(completionsLabel(60)).toBe('60 выполнений');
    expect(completionsLabel(1)).toBe('1 выполнение');
    expect(completionsLabel(3)).toBe('3 выполнения');
  });
});
