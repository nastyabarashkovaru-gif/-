export interface BuddyCandidate {
  userId: string;
  interests: string[];
  city?: string | null;
  timezone?: string | null;
}

export interface BuddyMatch {
  a: string;
  b: string;
  reason: 'interests' | 'compatibility' | 'random';
  score: number;
}

/** Детерминированный ГПСЧ (mulberry32): одинаковый seed → одинаковый результат, автоподбор идемпотентен */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function score(x: BuddyCandidate, y: BuddyCandidate) {
  const common = x.interests.filter((i) => y.interests.includes(i)).length;
  const compat = (x.city && x.city === y.city ? 1 : 0) + (x.timezone && x.timezone === y.timezone ? 0.5 : 0);
  return { common, total: common * 10 + compat };
}

/**
 * Подбор пар среди тех, у кого ещё нет бадди: сначала общие категории интересов,
 * затем совместимость (город, часовой пояс), иначе случайно среди доступных.
 * Каждый попадает максимум в одну пару; при нечётном числе один остаётся в очереди ожидания.
 */
export function matchBuddies(pool: BuddyCandidate[], seed: string): { pairs: BuddyMatch[]; unmatched: string[] } {
  const rnd = seededRandom(seed);
  const people = [...pool].sort((a, b) => a.userId.localeCompare(b.userId));
  const jitter = new Map(people.map((p) => [p.userId, rnd()]));
  const edges: { a: BuddyCandidate; b: BuddyCandidate; common: number; total: number; tie: number }[] = [];
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const s = score(people[i], people[j]);
      edges.push({ a: people[i], b: people[j], ...s, tie: rnd() });
    }
  }
  edges.sort((x, y) => y.total - x.total || x.tie - y.tie);
  const used = new Set<string>();
  const pairs: BuddyMatch[] = [];
  for (const e of edges) {
    if (e.total <= 0) break; // остальные — случайно ниже
    if (used.has(e.a.userId) || used.has(e.b.userId)) continue;
    used.add(e.a.userId);
    used.add(e.b.userId);
    pairs.push({ a: e.a.userId, b: e.b.userId, reason: e.common > 0 ? 'interests' : 'compatibility', score: e.total });
  }
  const rest = people.filter((p) => !used.has(p.userId)).sort((x, y) => jitter.get(x.userId)! - jitter.get(y.userId)!);
  while (rest.length >= 2) {
    const a = rest.shift()!;
    const b = rest.shift()!;
    pairs.push({ a: a.userId, b: b.userId, reason: 'random', score: 0 });
  }
  return { pairs, unmatched: rest.map((r) => r.userId) };
}

/** Можно ли просить замену бадди: взаимное согласие или нет связи больше 5 дней */
export function canRequestReplacement(reason: 'mutual' | 'no_contact_5d', lastContactAt: Date | null, pairCreatedAt: Date, now: Date): boolean {
  if (reason === 'mutual') return true;
  const since = lastContactAt ?? pairCreatedAt;
  return now.getTime() - since.getTime() > 5 * 24 * 3600 * 1000;
}
