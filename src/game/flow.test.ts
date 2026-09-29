import { describe, expect, it } from 'vitest';
import type { LevelData } from '../core/types';
import { Countdown, buildLevelSummaries, continueIndexAfter, continueTarget, resolveStartLevel, shouldShowHint } from './flow';

const fresh = { lastLevel: 0, highestUnlocked: 0, hasProgress: false };

function level(id: string, order: number): LevelData {
  return {
    id,
    order,
    name: `Nivel ${order}`,
    size: { width: 5, depth: 5 },
    forklift: { x: 0, z: 0, heading: 0 },
    boxes: [],
    zones: [],
    shelves: [],
    decor: { plants: [], windows: [] },
    theme: 'default',
  };
}

describe('resolveStartLevel', () => {
  it('starts a fresh save at the first level', () => {
    expect(resolveStartLevel(undefined, fresh, 8)).toBe(0);
  });

  it('continues at the last played level', () => {
    expect(resolveStartLevel(undefined, { lastLevel: 3, highestUnlocked: 5, hasProgress: true }, 8)).toBe(3);
  });

  it('falls back to the highest unlocked level without a saved game', () => {
    expect(resolveStartLevel(undefined, { lastLevel: 0, highestUnlocked: 2, hasProgress: false }, 8)).toBe(2);
  });

  it('never continues past what is unlocked or past the last level', () => {
    expect(resolveStartLevel(undefined, { lastLevel: 6, highestUnlocked: 4, hasProgress: true }, 8)).toBe(4);
    expect(resolveStartLevel(undefined, { lastLevel: 9, highestUnlocked: 9, hasProgress: true }, 3)).toBe(2);
  });

  it('honours an explicit request, clamped to the level range', () => {
    expect(resolveStartLevel(2, fresh, 8)).toBe(2);
    expect(resolveStartLevel(-4, fresh, 8)).toBe(0);
    expect(resolveStartLevel(99, fresh, 8)).toBe(7);
    expect(resolveStartLevel(1.7, fresh, 8)).toBe(1);
  });

  it('ignores non-numeric requests (a click event passed straight through)', () => {
    const event = { type: 'click' } as unknown as number;
    expect(resolveStartLevel(event, { lastLevel: 3, highestUnlocked: 3, hasProgress: true }, 8)).toBe(3);
    expect(resolveStartLevel(Number.NaN, fresh, 8)).toBe(0);
  });
});

describe('continueIndexAfter', () => {
  it('points at the next level, staying on the last one at the end', () => {
    expect(continueIndexAfter(0, 5)).toBe(1);
    expect(continueIndexAfter(4, 5)).toBe(4);
  });
});

describe('continueTarget', () => {
  const clearedUpTo = (last: number) => (i: number) => i <= last;

  it('moves a cleared last level on to the open, never-cleared next one (a save from before new levels)', () => {
    // 12 classic levels all cleared, saved while level 12 was the final one: level 13 is open.
    expect(continueTarget(11, 12, clearedUpTo(11))).toBe(12);
  });

  it('keeps the saved level otherwise', () => {
    expect(continueTarget(3, 3, clearedUpTo(2))).toBe(3); // the usual case: the next level to clear
    expect(continueTarget(2, 5, clearedUpTo(4))).toBe(2); // a replay: the next level is cleared too
    expect(continueTarget(7, 7, clearedUpTo(7))).toBe(7); // everything cleared: nothing after the last level
    expect(continueTarget(0, 0, () => false)).toBe(0); // fresh save
  });
});

describe('shouldShowHint', () => {
  it('shows only on the first hint levels until the first drop', () => {
    expect(shouldShowHint(0, 1, false)).toBe(true);
    expect(shouldShowHint(0, 1, true)).toBe(false);
    expect(shouldShowHint(1, 1, false)).toBe(false);
  });
});

describe('buildLevelSummaries', () => {
  it('reports best times and unlocked state per level', () => {
    const levels = [level('a', 1), level('b', 2), level('c', 3)];
    const best: Record<string, number> = { a: 31_000 };
    const summaries = buildLevelSummaries(levels, (id) => best[id] ?? null, 1);
    expect(summaries).toEqual([
      { index: 0, id: 'a', name: 'Nivel 1', bestMs: 31_000, unlocked: true },
      { index: 1, id: 'b', name: 'Nivel 2', bestMs: null, unlocked: true },
      { index: 2, id: 'c', name: 'Nivel 3', bestMs: null, unlocked: false },
    ]);
  });

  it('always unlocks the first level', () => {
    expect(buildLevelSummaries([level('a', 1)], () => null, -1)[0].unlocked).toBe(true);
  });
});

describe('Countdown', () => {
  it('fires exactly once after the accumulated dt reaches the delay', () => {
    const c = new Countdown();
    c.arm(1.1);
    let fired = 0;
    let frames = 0;
    while (frames < 200) {
      frames++;
      if (c.tick(1 / 60)) fired++;
    }
    expect(fired).toBe(1);
    expect(c.active).toBe(false);
  });

  it('fires on the frame the delay runs out', () => {
    const c = new Countdown();
    c.arm(0.1);
    expect(c.tick(0.05)).toBe(false);
    expect(c.active).toBe(true);
    expect(c.tick(0.05)).toBe(true);
    expect(c.tick(0.05)).toBe(false);
  });

  it('can be cancelled and does nothing when idle', () => {
    const c = new Countdown();
    expect(c.tick(1)).toBe(false);
    c.arm(0.5);
    c.cancel();
    expect(c.tick(1)).toBe(false);
  });
});
