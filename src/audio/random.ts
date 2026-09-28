import type { Rng } from './types';

/** Small seeded PRNG (mulberry32). Used by tests and anywhere reproducibility helps. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform float in [min, max). */
export function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** `value` scaled by a random factor in [1 - amount, 1 + amount] (humanised pitch / gain). */
export function vary(rng: Rng, value: number, amount = 0.05): number {
  return value * (1 + (rng() * 2 - 1) * amount);
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

/** Index chosen proportionally to `weights` (non-negative). Returns 0 when every weight is 0. */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return 0;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** Cents → playback-rate / frequency ratio. */
export function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}
