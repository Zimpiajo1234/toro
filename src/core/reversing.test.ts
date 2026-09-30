import { describe, expect, it } from 'vitest';
import { REVERSING, nextReversing, signedSpeed01 } from './reversing';

/**
 * The reverse beeper's own rule before the latch was shared (469b8c3, audio/beeper.ts `update`): silent, it starts once
 * the signed speed drops below −onSpeed (0.04); beeping, it stops once it rises above −offSpeed (0.015). Non-finite = 0.
 */
function beeperRule(active: boolean, speed: number): boolean {
  const s = Number.isFinite(speed) ? speed : 0;
  if (!active) return s < -0.04;
  return !(s > -0.015);
}

describe('the shared reversing latch', () => {
  it('keeps the beeper’s thresholds: starts below −0.04, holds down to −0.015, a hysteresis band between', () => {
    expect(REVERSING).toEqual({ onSpeed: 0.04, offSpeed: 0.015 });
    expect(nextReversing(false, -0.05)).toBe(true);
    expect(nextReversing(false, -0.03)).toBe(false); // creeping back inside the band: not yet
    expect(nextReversing(true, -0.03)).toBe(true); // …but once on, it holds there
    expect(nextReversing(true, -0.01)).toBe(false);
    expect(nextReversing(true, 0)).toBe(false);
    expect(nextReversing(false, 0.6)).toBe(false); // driving forward never counts
    expect(nextReversing(true, 0.6)).toBe(false);
  });

  it('switches on the same frames as the beeper’s own rule, for any speed sequence (edges, noise, non-finite)', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const edges = [-0.04, -0.015, -0.0400001, -0.0149999, -0, 0, Number.NaN, Infinity, -Infinity, -1, 1];
    let latch = false;
    let beeper = false;
    let switches = 0;
    let s = 0;
    for (let frame = 0; frame < 20000; frame++) {
      // A noisy speed hovering round both thresholds (mean ≈ −0.03), with an edge value now and then.
      const prev = Number.isFinite(s) ? Math.max(-1, Math.min(1, s)) : 0;
      s = frame % 97 === 0 ? edges[(frame / 97) % edges.length] : 0.95 * prev + (random() - 0.5) * 0.03 - 0.0014;
      const next = nextReversing(latch, s);
      beeper = beeperRule(beeper, s);
      if (next !== latch) switches++;
      latch = next;
      expect(latch, `frame ${frame}, speed ${s}`).toBe(beeper);
    }
    expect(switches).toBeGreaterThan(50); // the walk really crossed both thresholds many times
  });

  it('reads speed / maxSpeed, clamped to −1‥1 (0 without a top speed or for a non-finite speed)', () => {
    expect(signedSpeed01(-1.15, 2.3)).toBeCloseTo(-0.5, 12);
    expect(signedSpeed01(1.15, 2.3)).toBeCloseTo(0.5, 12);
    expect(signedSpeed01(-9, 2.3)).toBe(-1);
    expect(signedSpeed01(9, 2.3)).toBe(1);
    expect(signedSpeed01(-1, 0)).toBe(0);
    expect(signedSpeed01(Number.NaN, 2.3)).toBe(0);
    expect(nextReversing(false, signedSpeed01(-0.1, 2.3))).toBe(true); // ≈ 0.09 u/s back is a nudge that counts
    expect(nextReversing(false, signedSpeed01(-0.08, 2.3))).toBe(false);
  });
});
