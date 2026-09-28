import { describe, expect, it } from 'vitest';
import { applyRadialDeadzone, clampToUnit } from './axes';

describe('clampToUnit', () => {
  it('keeps short vectors and shortens long ones', () => {
    expect(clampToUnit({ x: 0.3, y: 0.4 })).toEqual({ x: 0.3, y: 0.4 });
    const v = clampToUnit({ x: 1, y: 1 });
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    expect(v.x).toBeCloseTo(v.y);
  });
});

describe('applyRadialDeadzone', () => {
  const out = { x: 0, y: 0 };

  it('zeroes stick drift inside the deadzone', () => {
    applyRadialDeadzone(0.12, -0.15, 0.2, out);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('rescales so motion starts at 0 just outside the deadzone and reaches 1 at full tilt', () => {
    applyRadialDeadzone(0.21, 0, 0.2, out);
    expect(out.x).toBeCloseTo(0.0125);
    applyRadialDeadzone(0, 1, 0.2, out);
    expect(out.y).toBeCloseTo(1);
    applyRadialDeadzone(0.6, 0, 0.2, out);
    expect(out.x).toBeCloseTo(0.5);
  });

  it('keeps the direction and clamps corner values of square-gate sticks', () => {
    applyRadialDeadzone(1, 1, 0.2, out);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(1);
    expect(out.x).toBeCloseTo(out.y);
  });

  it('treats NaN axes as neutral', () => {
    applyRadialDeadzone(Number.NaN, 0.5, 0.2, out);
    expect(out).toEqual({ x: 0, y: 0 });
  });
});
