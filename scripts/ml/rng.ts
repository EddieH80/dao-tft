/** A seeded random number generator (mulberry32), so every dataset can be regenerated exactly. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(xs: readonly T[]): T {
    if (!xs.length) throw new Error("pick from an empty list");
    return xs[Math.floor(this.next() * xs.length)];
  }

  /** One value, chosen in proportion to its weight. */
  weighted<T>(pairs: readonly (readonly [T, number])[]): T {
    const total = pairs.reduce((n, [, w]) => n + w, 0);
    let r = this.next() * total;
    for (const [value, w] of pairs) if ((r -= w) < 0) return value;
    return pairs[pairs.length - 1][0];
  }

  shuffle<T>(xs: readonly T[]): T[] {
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Up to `n` distinct items. */
  sample<T>(xs: readonly T[], n: number): T[] {
    return this.shuffle(xs).slice(0, n);
  }
}
