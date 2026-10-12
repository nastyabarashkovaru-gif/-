import type { SphereId } from './spheres.js';

export type TaskKind = 'daily' | 'weekly' | 'once' | 'habit';
export type TaskStatus = 'active' | 'completed' | 'expired' | 'deleted';

export const TASK_LIMITS = {
  recurringDrops: { min: 1, max: 5, default: 1 },
  onceDrops: { min: 1, max: 25, default: 5 },
  oncePenalty: { min: 1, max: 25, default: 3 },
  timesPerWeek: { min: 1, max: 7 },
  titleMax: 80,
  descriptionMax: 500,
  rewardTitleMax: 80,
  rewardThresholdMax: 10000,
} as const;

export interface TaskInput {
  title: string;
  description?: string | null;
  sphere: SphereId;
  kind: TaskKind;
  timesPerWeek?: number | null;
  drops: number;
  hardcore: boolean;
  penaltyDrops?: number | null;
  deadlineAt?: string | null;
  habitQuestion?: string | null;
  habitMissingPenaltyConsent?: boolean;
  rewards?: { threshold: number; title: string }[];
}

/** Возвращает текст ошибки или null. Те же правила проверяет сервер. */
export function validateTaskInput(t: TaskInput, now: Date): string | null {
  const title = (t.title ?? '').trim();
  if (!title) return 'Введи название задачи';
  if (title.length > TASK_LIMITS.titleMax) return `Название — до ${TASK_LIMITS.titleMax} символов`;
  if (t.description && t.description.length > TASK_LIMITS.descriptionMax) return 'Описание слишком длинное';
  if (!['daily', 'weekly', 'once', 'habit'].includes(t.kind)) return 'Выбери частоту';
  if (t.kind === 'habit' && t.sphere !== 'health') return 'Вредные привычки — только в сфере «Здоровье»';
  if (t.kind === 'once') {
    if (!Number.isInteger(t.drops) || t.drops < 1 || t.drops > TASK_LIMITS.onceDrops.max) return 'За одноразовую задачу — от 1 до 25 капель';
    if (!t.deadlineAt) return 'Для одноразовой задачи нужен дедлайн';
    const dl = new Date(t.deadlineAt);
    if (Number.isNaN(dl.getTime())) return 'Некорректный дедлайн';
    if (dl.getTime() <= now.getTime()) return 'Дедлайн должен быть в будущем';
    if (t.hardcore) {
      const p = t.penaltyDrops ?? 0;
      if (!Number.isInteger(p) || p < 1 || p > TASK_LIMITS.oncePenalty.max) return 'Штраф — от 1 до 25 капель';
    }
  } else {
    if (!Number.isInteger(t.drops) || t.drops < 1 || t.drops > TASK_LIMITS.recurringDrops.max) return 'За повторяющуюся задачу — от 1 до 5 капель';
  }
  if (t.kind === 'weekly') {
    const n = t.timesPerWeek ?? 0;
    if (!Number.isInteger(n) || n < 1 || n > 7) return 'Выбери, сколько раз в неделю: от 1 до 7';
  }
  if (t.kind === 'habit' && t.hardcore && t.habitMissingPenaltyConsent !== true && t.habitMissingPenaltyConsent !== false) {
    return 'Отметь, штрафовать ли за пропущенный ответ';
  }
  const rewards = t.rewards ?? [];
  const seen = new Set<number>();
  for (const r of rewards) {
    if (!Number.isInteger(r.threshold) || r.threshold < 1 || r.threshold > TASK_LIMITS.rewardThresholdMax) return 'Порог подарка — целое число выполнений';
    if (t.kind === 'once' && r.threshold !== 1) return 'У одноразовой задачи подарок возможен только за 1 выполнение';
    if (seen.has(r.threshold)) return 'Два подарка на одном пороге';
    seen.add(r.threshold);
    if (!r.title?.trim()) return 'Назови подарок';
    if (r.title.length > TASK_LIMITS.rewardTitleMax) return 'Название подарка слишком длинное';
  }
  return null;
}

/** Расстояние Левенштейна — разрешаем «исправить опечатку» в названии задачи с обещанием. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n];
}
export const isTypoFix = (a: string, b: string) => levenshtein(a.trim().toLowerCase(), b.trim().toLowerCase()) <= Math.max(2, Math.floor(a.trim().length * 0.2));

/** Подпись счётчика подарка: «60 выполнений» (не «дней») — склонение по-русски. */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
export const completionsLabel = (n: number) => `${n} ${plural(n, 'выполнение', 'выполнения', 'выполнений')}`;
export const dropsLabel = (n: number) => `${n} ${plural(n, 'капля', 'капли', 'капель')}`;
export const daysLabel = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
