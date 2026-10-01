/**
 * Integration check (levels × logic): an autopilot (./autopilot.ts) plays every shipped level with the real GameState —
 * sliding collisions, carried-box collider (gameConfig carriedBoxRadius), pick cone and drop rules — at the
 * normal frame rate and at the worst dt Game allows (1/20). levels.test.ts proves solvability on a grid model;
 * this proves the real controls agree with it.
 *
 * Planner and driver: see ./autopilot.ts (the shared grid model's plans, driven with world-space input and, to back
 * up, the vehicle controls' reverse gear).
 *
 * Levels 4–24 were removed (2026-09-30) to be redone: the checks on boxes that start on a wrong zone and on sorting by
 * symbol play small layouts written inline (the former levels 4 and 23).
 */
import { describe, expect, it } from 'vitest';
import { usesSymbols } from '../core/sorting';
import type { GameEvent } from '../core/types';
import { parseLevel } from '../data/asciiLevel';
import { LEVELS } from '../data/levels';
import { LevelGrid, boxCode, misplacedCount } from '../data/levels/solver';
import { GameState } from '../logic/GameState';
import { autopilot, liveStacks } from './autopilot';

const CASES = LEVELS.map((level, i) => [i + 1, level.id, level] as const);

/** An inline layout in the .level format (docs/LEVELS.md). */
const layout = (lines: readonly string[]) => parseLevel(`${lines.join('\n')}\n`).level;

/** The former level 4, «Pequeño desorden»: two boxes start on each other's zones. */
const DISORDER = layout([
  '# 4 · Pequeño desorden',
  'id: pequeno-desorden',
  'limit: 1',
  'ventanas: norte 3-5',
  '',
  '  012345678',
  '0 pHH...HHp',
  '1 .........',
  '2 ...123...',
  '3 .........',
  '4 .........',
  '5 .a.......',
  '6 ....^....',
  '',
  '1 = zona azul + caja amarillo      2 = zona menta',
  '3 = zona amarillo + caja azul',
  'a = caja menta',
  'H = estantería 3 alturas',
]);

/** The former level 23, «La muestra» (docs/SORTING.md): one complete sorting and the classic trap. */
const SAMPLE = layout([
  '# 23 · La muestra',
  'id: la-muestra',
  'limit: 1',
  'ventanas: norte 2-4, oeste 3-4',
  '',
  '  0123456789',
  '0 p.........',
  '1 .1.2.3.4..',
  '2 ..........',
  '3 ..........',
  '4 ....b..a..',
  '5 ..c.......',
  '6 .....d.^.p',
  '',
  '1 2 = zona ▲        3 = zona azul ■     4 = zona azul',
  'a = caja azul ▲     b = caja azul ■     c = caja menta ▲    d = caja azul ●',
]);

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

  it.each([
    ['60 fps', 1 / 60],
    ['20 fps', 1 / 20],
  ] as const)('%s: boxes starting on each other\'s zones are sorted out (the former level 4)', (_, dt) => {
    const out = autopilot(DISORDER, dt);
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    expect(out.moves).toBeGreaterThan(DISORDER.boxes.length);
  });

  it('the move bound still counts boxes starting on a zone of another color (classic levels)', () => {
    const classic = [...LEVELS.filter((level) => level.stackLimit === 1 && !usesSymbols(level)), DISORDER];
    expect(classic.length).toBeGreaterThanOrEqual(2);
    for (const level of classic) {
      const grid = new LevelGrid(level);
      const start = liveStacks(grid, new GameState(level).getSnapshot());
      const offZone = level.boxes.filter((b) => !level.zones.some((z) => z.x === b.x && z.z === b.z && z.color === b.color));
      expect(misplacedCount(grid, start, level.boxes.length), level.id).toBe(offZone.length);
    }
  });
});

describe('sorting levels with the real controls (docs/SORTING.md)', () => {
  const sample = SAMPLE;
  const grid = new LevelGrid(sample);
  const cellOf = (p: { x: number; z: number }) => grid.index(p.x, p.z);
  const blueTriangle = sample.boxes.find((b) => b.color === 'blue' && b.symbol === 'triangle')!;
  const blueCircle = sample.boxes.find((b) => b.color === 'blue' && b.symbol === 'circle')!;
  const anyBlue = sample.zones.find((z) => z.color === 'blue' && z.symbol === undefined)!;

  it('the sample sorts by symbol', () => {
    expect(usesSymbols(sample)).toBe(true);
  });

  it.each([
    ['60 fps', 1 / 60],
    ['20 fps', 1 / 20],
  ] as const)('%s: the sample recovers from its trap: blue ▲ into "any blue" first, moved on once blue ● needs it', (_, dt) => {
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
