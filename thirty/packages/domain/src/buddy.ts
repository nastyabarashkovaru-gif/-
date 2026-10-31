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
/** avoid — кого нельзя ставить в пару снова (бывшие бадди после замены) */
export function matchBuddies(pool: BuddyCandidate[], seed: string, avoid: (a: string, b: string) => boolean = () => false): { pairs: BuddyMatch[]; unmatched: string[] } {
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
    if (used.has(e.a.userId) || used.has(e.b.userId) || avoid(e.a.userId, e.b.userId)) continue;
    used.add(e.a.userId);
    used.add(e.b.userId);
    pairs.push({ a: e.a.userId, b: e.b.userId, reason: e.common > 0 ? 'interests' : 'compatibility', score: e.total });
  }
  const rest = people.filter((p) => !used.has(p.userId)).sort((x, y) => jitter.get(x.userId)! - jitter.get(y.userId)!);
  const unmatched: string[] = [];
  while (rest.length) {
    const a = rest.shift()!;
    const k = rest.findIndex((b) => !avoid(a.userId, b.userId));
    if (k < 0) { unmatched.push(a.userId); continue; }
    const [b] = rest.splice(k, 1);
    pairs.push({ a: a.userId, b: b.userId, reason: 'random', score: 0 });
  }
  // Оставшиеся без пары из-за запрета (бывшие бадди): меняемся с уже собранной парой x+y → u1+x и u2+y
  for (let i = 0; i < unmatched.length; i++) {
    for (let j = i + 1; j < unmatched.length; j++) {
      const [u1, u2] = [unmatched[i], unmatched[j]];
      const k = pairs.findIndex((p) => (!avoid(u1, p.a) && !avoid(u2, p.b)) || (!avoid(u1, p.b) && !avoid(u2, p.a)));
      if (k < 0) continue;
      const p = pairs[k];
      const [x, y] = !avoid(u1, p.a) && !avoid(u2, p.b) ? [p.a, p.b] : [p.b, p.a];
      pairs.splice(k, 1, { a: u1, b: x, reason: 'random', score: 0 }, { a: u2, b: y, reason: 'random', score: 0 });
      unmatched.splice(j, 1);
      unmatched.splice(i, 1);
      i = -1;
      break;
    }
  }
  return { pairs, unmatched };
}

/** Можно ли просить замену бадди: взаимное согласие или нет связи больше 5 дней */
export function canRequestReplacement(reason: 'mutual' | 'no_contact_5d', lastContactAt: Date | null, pairCreatedAt: Date, now: Date): boolean {
  if (reason === 'mutual') return true;
  const since = lastContactAt ?? pairCreatedAt;
  return now.getTime() - since.getTime() > 5 * 24 * 3600 * 1000;
}
