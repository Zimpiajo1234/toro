import { describe, expect, it } from 'vitest';
import { ForkStepWatcher, type RackAt } from './forkSteps';

const at = (rackId: string, column: number, level: number): RackAt => ({ rackId, column, level });

describe('ForkStepWatcher', () => {
  it('clicks each step that takes effect at the rack column, never at the top or the bottom', () => {
    const w = new ForkStepWatcher();
    expect(w.observe(null, 0)).toBe(0);
    expect(w.observe(at('r1', 0, 0), 0)).toBe(0); // arriving at the rack
    expect(w.observe(at('r1', 0, 1), 1)).toBe(1);
    expect(w.observe(at('r1', 0, 1), 0)).toBe(0); // the forks climbing: no more clicks
    expect(w.observe(at('r1', 0, 2), 1)).toBe(1);
    expect(w.observe(at('r1', 0, 2), 1)).toBe(0); // already at the top
    expect(w.observe(at('r1', 0, 1), -1)).toBe(-1);
    expect(w.observe(at('r1', 0, 0), -1)).toBe(-1);
    expect(w.observe(at('r1', 0, 0), -1)).toBe(0); // already at the bottom
  });

  it('stays silent away from a rack and when the level changes by itself', () => {
    const w = new ForkStepWatcher();
    expect(w.observe(null, 1)).toBe(0); // F off a rack: the forks stay automatic
    expect(w.observe(null, -1)).toBe(0);
    w.observe(at('r1', 0, 0), 0);
    w.observe(at('r1', 0, 1), 1);
    w.observe(at('r1', 0, 2), 1);
    // Sliding to a shorter column of the same rack clamps the level: not a step.
    expect(w.observe(at('r1', 1, 0), -1)).toBe(0);
    // Leaving the rack resets it; arriving at another starts at its bottom slot.
    expect(w.observe(null, 0)).toBe(0);
    expect(w.observe(at('r2', 0, 0), 0)).toBe(0);
    expect(w.observe(at('r2', 0, 2), 0)).toBe(0); // a change nobody asked for (never expected, never a click)
    expect(w.observe(at('r2', 0, 1), 1)).toBe(0); // against the step asked for
  });

  it('reads the reused hint object by value (GameState mutates hint.rack in place)', () => {
    const w = new ForkStepWatcher();
    const hint = at('r1', 0, 0) as { rackId: string; column: number; level: number };
    expect(w.observe(hint, 0)).toBe(0);
    hint.level = 1;
    expect(w.observe(hint, 1)).toBe(1);
    hint.level = 2;
    expect(w.observe(hint, 1)).toBe(1);
  });

  it('forgets the last column on reset (a level reloads at the same rack)', () => {
    const w = new ForkStepWatcher();
    w.observe(at('r1', 0, 0), 0);
    w.observe(at('r1', 0, 2), 1);
    w.reset();
    expect(w.observe(at('r1', 0, 1), 1)).toBe(0);
    expect(w.observe(at('r1', 0, 2), 1)).toBe(1);
  });
});
