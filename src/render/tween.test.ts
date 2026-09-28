import { describe, expect, it } from 'vitest';
import { OneShot, hermite, hermiteSlope } from './tween';

describe('OneShot', () => {
  it('waits for its delay, then progresses to exactly 1 and stops', () => {
    const a = new OneShot(1);
    a.start(0.5);
    expect(a.step(0.25)).toBe(false);
    expect(a.active).toBe(true);
    expect(a.step(0.5)).toBe(true);
    expect(a.p).toBeCloseTo(0.25, 6);
    expect(a.step(2)).toBe(true);
    expect(a.p).toBe(1);
    expect(a.active).toBe(false);
    expect(a.step(0.1)).toBe(false);
  });
});

describe('hermite', () => {
  it('eases from p0 to p1 and honours the starting slope', () => {
    expect(hermite(2, 5, 0, 0)).toBe(2);
    expect(hermite(2, 5, 0, 1)).toBe(5);
    expect(hermite(0, 1, 0, 0.5)).toBeCloseTo(0.5, 6);
    expect(hermiteSlope(0, 1, 0.7, 0)).toBeCloseTo(0.7, 6);
    expect(hermiteSlope(0, 1, 0.7, 1)).toBeCloseTo(0, 6);
  });
});
