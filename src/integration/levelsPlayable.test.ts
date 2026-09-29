/**
 * Integration check (levels × logic): an autopilot (./autopilot.ts) plays every shipped level with the real GameState —
 * sliding collisions, carried-box collider (gameConfig carriedBoxRadius), pick cone and drop rules — at the
 * normal frame rate and at the worst dt Game allows (1/20). levels.test.ts proves solvability on a grid model;
 * this proves the real controls agree with it.
 *
 * Planner and driver: see ./autopilot.ts (the shared grid model's plans, driven with world-space input and, to back
 * up, the vehicle controls' reverse gear).
 */
import { describe, expect, it } from 'vitest';
import { usesSymbols } from '../core/sorting';
import type { GameEvent } from '../core/types';
import { LEVELS } from '../data/levels';
import { LevelGrid, boxCode, misplacedCount } from '../data/levels/solver';
import { GameState } from '../logic/GameState';
import { autopilot, liveStacks } from './autopilot';

const CASES = LEVELS.map((level, i) => [i + 1, level.id, level] as const);

describe('every shipped level is playable with the real controls', () => {
  for (const [label, dt] of [
    ['60 fps', 1 / 60],
    ['20 fps (Game dt clamp)', 1 / 20],
  ] as const) {
    it.each(CASES)(`${label}: level %i (%s)`, (_, __, level) => {
      const out = autopilot(level, dt);
      expect(out.note).toBe('');
      expect(out.solved).toBe(true);
      const grid = new LevelGrid(level);
      const start = liveStacks(grid, new GameState(level).getSnapshot());
      expect(out.moves).toBeGreaterThanOrEqual(misplacedCount(grid, start, level.boxes.length));
    });
  }

  it('the move bound still counts boxes starting on a zone of another color (classic levels)', () => {
    const classic = LEVELS.filter((level) => level.stackLimit === 1 && !usesSymbols(level));
    expect(classic.length).toBeGreaterThanOrEqual(12);
    for (const level of classic) {
      const grid = new LevelGrid(level);
      const start = liveStacks(grid, new GameState(level).getSnapshot());
      const offZone = level.boxes.filter((b) => !level.zones.some((z) => z.x === b.x && z.z === b.z && z.color === b.color));
      expect(misplacedCount(grid, start, level.boxes.length), level.id).toBe(offZone.length);
    }
  });
});

describe('sorting levels with the real controls (docs/SORTING.md)', () => {
  const sample = LEVELS.find((l) => l.id === 'la-muestra')!;
  const grid = new LevelGrid(sample);
  const cellOf = (p: { x: number; z: number }) => grid.index(p.x, p.z);
  const blueTriangle = sample.boxes.find((b) => b.color === 'blue' && b.symbol === 'triangle')!;
  const blueCircle = sample.boxes.find((b) => b.color === 'blue' && b.symbol === 'circle')!;
  const anyBlue = sample.zones.find((z) => z.color === 'blue' && z.symbol === undefined)!;

  it('level 23 is the sample level, with its trap in reach', () => {
    expect(LEVELS.indexOf(sample)).toBe(22);
    expect(usesSymbols(sample)).toBe(true);
  });

  it.each([
    ['60 fps', 1 / 60],
    ['20 fps', 1 / 20],
  ] as const)('%s: level 23 recovers from its trap: blue ▲ into "any blue" first, moved on once blue ● needs it', (_, dt) => {
    const out = autopilot(sample, dt, [{ from: cellOf(blueTriangle), drop: cellOf(anyBlue) }]);
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    const drops = out.events.filter((e): e is Extract<GameEvent, { type: 'boxDropped' }> => e.type === 'boxDropped');
    // The trap drop is accepted (a correct, chiming drop), then undone without anything negative...
    expect(drops[0]).toMatchObject({ boxId: blueTriangle.id, zoneId: anyBlue.id, correct: true });
    expect(out.events).toContainEqual({ type: 'zoneReleased', zoneId: anyBlue.id, boxId: blueTriangle.id });
    // ...and blue ● ends up in "any blue", blue ▲ on a ▲ zone: one move more than a plan free of the trap needs.
    const last = (id: string) => drops.filter((d) => d.boxId === id).at(-1)!;
    expect(last(blueCircle.id)).toMatchObject({ zoneId: anyBlue.id, correct: true });
    expect(sample.zones.find((z) => z.id === last(blueTriangle.id).zoneId)?.symbol).toBe('triangle');
    expect(out.moves).toBeGreaterThanOrEqual(sample.boxes.length + 1);
  });

  it('the move bound counts a trap as one more move', () => {
    const stacks = new Array<string>(grid.cellCount).fill('');
    for (const b of sample.boxes) stacks[cellOf(b)] = boxCode({ color: b.color, symbol: b.symbol! });
    expect(misplacedCount(grid, stacks, 4)).toBe(4);
    // Blue ▲ in "any blue", blue ■ and mint ▲ in their zones: blue ● is left without one.
    const exact = sample.zones.find((z) => z.symbol === 'square')!;
    const triangle = sample.zones.find((z) => z.symbol === 'triangle')!;
    const blueSquare = sample.boxes.find((b) => b.symbol === 'square')!;
    const mintTriangle = sample.boxes.find((b) => b.color === 'mint')!;
    for (const b of [blueTriangle, blueSquare, mintTriangle]) stacks[cellOf(b)] = '';
    stacks[cellOf(anyBlue)] = boxCode({ color: 'blue', symbol: 'triangle' });
    stacks[cellOf(exact)] = boxCode({ color: 'blue', symbol: 'square' });
    stacks[cellOf(triangle)] = boxCode({ color: 'mint', symbol: 'triangle' });
    expect(misplacedCount(grid, stacks, 4)).toBe(2);
  });
});
