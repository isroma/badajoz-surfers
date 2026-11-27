/** Small deterministic PRNG (mulberry32) with helpers. Pure, no three.js. */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  range(min: number, max: number): number;
  int(min: number, maxInclusive: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  /** Weighted pick; entries with weight <= 0 are skipped. Falls back to the first item. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0 || 0x9e3779b9;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, maxInclusive) => min + Math.floor(next() * (maxInclusive - min + 1)),
    chance: (p) => next() < p,
    pick<T>(items: readonly T[]): T {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error("pick from empty list");
      return item;
    },
    weighted<T>(entries: readonly (readonly [T, number])[]): T {
      let total = 0;
      for (const [, w] of entries) if (w > 0) total += w;
      let r = next() * total;
      for (const [item, w] of entries) {
        if (w <= 0) continue;
        r -= w;
        if (r < 0) return item;
      }
      const first = entries[0];
      if (!first) throw new Error("weighted pick from empty list");
      return first[0];
    },
  };
  return rng;
}
