/**
 * Seeded random numbers for the combat engine (mulberry32). Every random decision of a battle (CRIT
 * rolls, effect-hit chances, enemy skill and target choice, loot) draws from one stream, so the
 * same seed, party and enemy group always give an identical battle log.
 */
export class SeededRng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Current internal state (for tests and replays). */
  get state(): number {
    return this.s;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** True with probability `p` (always consumes exactly one draw, so logs stay aligned). */
  chance(p: number): boolean {
    const r = this.next();
    return r < p;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick() needs a non-empty list');
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))] as T;
  }

  /** Weighted choice; entries with weight <= 0 are never picked. Returns null if nothing has weight. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T | null {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    if (total <= 0) return null;
    let r = this.next() * total;
    let last: T | null = null;
    for (const it of items) {
      const w = Math.max(0, weight(it));
      if (w <= 0) continue;
      last = it;
      if (r < w) return it;
      r -= w;
    }
    return last;
  }
}

/** Hash a string seed (the Battle Sandbox's seed input) to a 32-bit number. */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
