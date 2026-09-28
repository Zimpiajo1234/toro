import { describe, expect, it } from 'vitest';
import { ElapsedThrottle } from './throttle';

describe('ElapsedThrottle', () => {
  it('publishes at most once per step of elapsed time (~10 Hz at 60 fps)', () => {
    const throttle = new ElapsedThrottle(100);
    let published = 0;
    let ms = 0;
    for (let frame = 0; frame < 60; frame++) {
      ms += 1000 / 60;
      if (throttle.shouldPublish(ms)) published++;
    }
    expect(published).toBeGreaterThanOrEqual(9);
    expect(published).toBeLessThanOrEqual(10);
  });

  it('ignores unchanged values (timer not running)', () => {
    const throttle = new ElapsedThrottle(100);
    expect(throttle.shouldPublish(0)).toBe(false);
    expect(throttle.shouldPublish(0)).toBe(false);
  });

  it('always lets a reset (value going backwards) through', () => {
    const throttle = new ElapsedThrottle(100);
    expect(throttle.shouldPublish(500)).toBe(true);
    expect(throttle.shouldPublish(20)).toBe(true);
  });

  it('measures the next step from an out-of-band publish', () => {
    const throttle = new ElapsedThrottle(100);
    throttle.markPublished(1234);
    expect(throttle.shouldPublish(1300)).toBe(false);
    expect(throttle.shouldPublish(1334)).toBe(true);
    throttle.markPublished(0);
    expect(throttle.shouldPublish(50)).toBe(false);
    expect(throttle.shouldPublish(100)).toBe(true);
  });
});
