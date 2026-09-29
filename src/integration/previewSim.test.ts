/**
 * Integration check (dev render preview × logic): the preview's stand-in simulation starts every shipped level
 * exactly like GameState and follows the same stack rules, so the render preview never shows a state the game
 * cannot reach.
 */
import { describe, expect, it } from 'vitest';
import { PreviewSim, snapshotFromLevel } from '../../dev/previewSim';
import { GAME_CONFIG } from '../config';
import { cellToWorld, type CellPos, type GameEvent } from '../core/types';
import { LEVELS } from '../data/levels';
import { validateLevel } from '../data/validateLevel';
import { GameState } from '../logic/GameState';

const eventOf = <T extends GameEvent['type']>(events: GameEvent[], type: T) =>
  events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** Blue under mint on (1,2); a [blue, mint] zone on (4,2); stacks of 2. */
const LEVEL = validateLevel(
  {
    id: 'preview-stack',
    order: 1,
    name: 'Preview stack',
    stackLimit: 2,
    size: { width: 7, depth: 5 },
    forklift: { x: 5, z: 4, heading: 0 },
    boxes: [
      { id: 'a', color: 'blue', x: 1, z: 2 },
      { id: 'b', color: 'mint', x: 1, z: 2 },
      { id: 'c', color: 'coral', x: 2, z: 4 },
    ],
    zones: [
      { id: 'z', color: 'blue', x: 4, z: 2, recipe: ['blue', 'mint'] },
      { id: 'y', color: 'coral', x: 6, z: 0 },
    ],
    shelves: [],
    decor: { plants: [], windows: [] },
  },
  'preview-stack',
);

/** Park the forklift so its fork point sits over `cell` (facing +z). */
function aimAt(sim: PreviewSim, cell: CellPos): void {
  const p = cellToWorld(cell, LEVEL.size);
  sim.setPose(p.x, p.z - GAME_CONFIG.forklift.forkReach, 0);
}

describe('dev render preview simulation', () => {
  it.each(LEVELS.map((l) => [l.id, l] as const))('starts %s exactly like GameState', (_id, level) => {
    expect(snapshotFromLevel(level)).toEqual(new GameState(level).getSnapshot());
  });

  it('picks only stack tops and drops on stacks with room, deriving zones from their recipe', () => {
    const sim = new PreviewSim(LEVEL);
    const s = sim.snapshot;
    const box = (id: string) => s.boxes.find((b) => b.id === id)!;
    const zone = s.zones.find((z) => z.id === 'z')!;
    expect(box('b').level).toBe(1);

    aimAt(sim, { x: 1, z: 2 });
    expect(eventOf(sim.pick(), 'boxPicked')).toMatchObject({ boxId: 'b', level: 1 });
    // Mint first on the blue-first zone: a wrong (neutral) stack that takes nothing next.
    let ev = sim.drop({ x: 4, z: 2 });
    expect(eventOf(ev, 'boxDropped')).toMatchObject({ level: 0, correct: false, recipeLength: 2 });
    expect(zone).toMatchObject({ stack: ['b'], satisfied: false, next: null });
    aimAt(sim, { x: 4, z: 2 });
    sim.pick();
    expect(zone).toMatchObject({ stack: [], next: 'blue' });
    sim.drop({ x: 3, z: 2 });

    aimAt(sim, { x: 1, z: 2 });
    expect(eventOf(sim.pick(), 'boxPicked')).toMatchObject({ boxId: 'a', level: 0 });
    sim.drop({ x: 4, z: 2 });
    expect(zone).toMatchObject({ stack: ['a'], satisfied: false, next: 'mint' });
    expect(box('a').correct).toBe(true);

    aimAt(sim, { x: 3, z: 2 });
    sim.pick();
    ev = sim.drop({ x: 4, z: 2 });
    expect(eventOf(ev, 'boxDropped')).toMatchObject({ boxId: 'b', level: 1, correct: true, recipeLength: 2 });
    expect(zone).toMatchObject({ stack: ['a', 'b'], satisfied: true, next: null, occupiedBy: 'b' });

    // The stack is full (stackLimit 2): nothing lands on it.
    aimAt(sim, { x: 2, z: 4 });
    sim.pick();
    expect(sim.drop({ x: 4, z: 2 })).toEqual([{ type: 'actionIdle', carrying: true }]);
  });

  it('solves a recipe zone one step at a time, never from under another box', () => {
    const sim = new PreviewSim(LEVEL);
    const zone = sim.snapshot.zones.find((z) => z.id === 'z')!;
    // The only blue box is buried under mint: nothing to teleport yet.
    expect(sim.solveZone('z')).toEqual([]);
    aimAt(sim, { x: 1, z: 2 });
    sim.pick();
    sim.drop({ x: 3, z: 2 });
    const ev = sim.solveZone('z');
    expect(ev.filter((e) => e.type === 'boxDropped').map((e) => (e.type === 'boxDropped' ? e.level : -1))).toEqual([0, 1]);
    expect(zone).toMatchObject({ stack: ['a', 'b'], satisfied: true });
    const all = sim.solveZone('y');
    expect(eventOf(all, 'levelComplete')).toBeDefined();
    expect(sim.snapshot.forklift.carrying).toBeNull();
  });
});
