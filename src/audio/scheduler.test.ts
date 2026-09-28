import { afterEach, describe, expect, it, vi } from 'vitest';
import { LookaheadScheduler } from './scheduler';

function setup(stepSec = 0.25) {
  const clock = { currentTime: 10 };
  const steps: [number, number][] = [];
  const s = new LookaheadScheduler(clock, (step, time) => steps.push([step, time]), { stepSec, horizonSec: 0.2, startDelaySec: 0.1 });
  return { clock, steps, s };
}

describe('LookaheadScheduler', () => {
  afterEach(() => vi.useRealTimers());

  it('schedules only steps inside the horizon, in order, exactly once', () => {
    vi.useFakeTimers();
    const { clock, steps, s } = setup();
    s.start();
    expect(steps).toEqual([[0, 10.1]]);
    for (let i = 0; i < 40; i++) {
      clock.currentTime += 0.025;
      s.tick();
      for (const [, t] of steps) expect(t).toBeLessThan(clock.currentTime + 0.2 + 1e-9);
    }
    const indices = steps.map(([i]) => i);
    expect(indices).toEqual(indices.map((_, i) => i));
    for (let i = 1; i < steps.length; i++) expect(steps[i][1] - steps[i - 1][1]).toBeCloseTo(0.25, 9);
    s.stop();
  });

  it('does nothing while the clock is frozen (suspended context)', () => {
    const { steps, s } = setup();
    s.tick();
    const n = steps.length;
    for (let i = 0; i < 20; i++) s.tick();
    expect(steps.length).toBe(n);
  });

  it('skips missed steps after a stall instead of bursting them', () => {
    const { clock, steps, s } = setup();
    s.tick();
    clock.currentTime += 5; // 20 steps behind
    s.tick();
    const late = steps.filter(([, t]) => t < clock.currentTime - 0.25);
    expect(late.length).toBeLessThanOrEqual(1);
    expect(steps[steps.length - 1][0]).toBeGreaterThanOrEqual(20);
  });

  it('never emits a step already in the past after a short stall (no off-grid stumble)', () => {
    const clock = { currentTime: 10 };
    const late: number[] = [];
    const s = new LookaheadScheduler(clock, (_, time) => late.push(clock.currentTime - time), { stepSec: 0.25, horizonSec: 0.2, startDelaySec: 0.1 });
    s.tick(); // step 0 at 10.1
    clock.currentTime = 10.4; // 0.3 s stall: step 1 (10.35) is 50 ms late, less than one step
    s.tick();
    clock.currentTime = 10.7;
    s.tick();
    for (const l of late) expect(l).toBeLessThanOrEqual(0.02 + 1e-9);
    expect(s.nextStepTime).toBeGreaterThanOrEqual(clock.currentTime);
  });

  it('runs on an interval and stops cleanly', () => {
    vi.useFakeTimers();
    const { clock, steps, s } = setup();
    s.start();
    expect(s.running).toBe(true);
    s.start(); // idempotent
    clock.currentTime += 1;
    vi.advanceTimersByTime(50);
    const n = steps.length;
    expect(n).toBeGreaterThan(1);
    s.stop();
    expect(s.running).toBe(false);
    clock.currentTime += 1;
    vi.advanceTimersByTime(200);
    expect(steps.length).toBe(n);
  });

  it('finds the next grid boundary', () => {
    vi.useFakeTimers();
    const { s } = setup(0.25);
    s.start(); // step 0 at 10.1, next step 1 at 10.35
    expect(s.nextGridTime(2, 10.2)).toBeCloseTo(10.6, 9);
    expect(s.nextGridTime(1, 10.2)).toBeCloseTo(10.35, 9);
    expect(s.nextGridTime(2, 10.1)).toBeCloseTo(10.1, 9);
    s.stop();
  });
});
