import { describe, expect, it } from 'vitest';
import { Timer } from './Timer';

describe('Timer', () => {
  it('starts at zero and stopped', () => {
    const t = new Timer();
    expect(t.elapsedMs).toBe(0);
    expect(t.running).toBe(false);
  });

  it('only accumulates while running', () => {
    const t = new Timer();
    t.tick(1);
    expect(t.elapsedMs).toBe(0);
    t.start();
    t.tick(0.5);
    expect(t.running).toBe(true);
    expect(t.elapsedMs).toBeCloseTo(500, 9);
    t.stop();
    t.tick(2);
    expect(t.elapsedMs).toBeCloseTo(500, 9);
    t.start();
    t.tick(0.25);
    expect(t.elapsedMs).toBeCloseTo(750, 9);
  });

  it('sums many small frames accurately', () => {
    const t = new Timer();
    t.start();
    for (let i = 0; i < 600; i++) t.tick(1 / 60);
    expect(t.elapsedMs).toBeCloseTo(10_000, 6);
  });

  it('reset returns to zero and stops', () => {
    const t = new Timer();
    t.start();
    t.tick(3);
    t.reset();
    expect(t.elapsedMs).toBe(0);
    expect(t.running).toBe(false);
    t.tick(1);
    expect(t.elapsedMs).toBe(0);
  });

  it('ignores negative and non-finite dt', () => {
    const t = new Timer();
    t.start();
    t.tick(-1);
    t.tick(Number.NaN);
    t.tick(Number.POSITIVE_INFINITY);
    expect(t.elapsedMs).toBe(0);
  });

  it('start and stop are idempotent', () => {
    const t = new Timer();
    t.start();
    t.start();
    t.tick(1);
    t.stop();
    t.stop();
    expect(t.elapsedMs).toBeCloseTo(1000, 9);
    expect(t.running).toBe(false);
  });
});
