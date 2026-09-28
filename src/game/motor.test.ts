import { describe, expect, it } from 'vitest';
import { forkMotion01, speed01 } from './motor';

describe('speed01', () => {
  it('normalizes |speed| by max speed and clamps', () => {
    expect(speed01(1.55, 3.1)).toBeCloseTo(0.5);
    expect(speed01(-3.1, 3.1)).toBe(1);
    expect(speed01(9, 3.1)).toBe(1);
    expect(speed01(1, 0)).toBe(0);
  });
});

describe('forkMotion01', () => {
  it('is 1 when the forks move at full lift speed, either direction', () => {
    const dt = 1 / 60;
    expect(forkMotion01(3.2 * dt, dt, 3.2)).toBeCloseTo(1);
    expect(forkMotion01(-1.6 * dt, dt, 3.2)).toBeCloseTo(0.5);
  });

  it('is 0 for still forks or a zero-length frame', () => {
    expect(forkMotion01(0, 1 / 60, 3.2)).toBe(0);
    expect(forkMotion01(0.1, 0, 3.2)).toBe(0);
  });
});
