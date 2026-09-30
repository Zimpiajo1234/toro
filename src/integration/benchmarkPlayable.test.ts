/**
 * Integration check (Benchmark × logic × controls): the autopilot (./autopilot.ts) plays the test-mode «Benchmark»
 * (src/data/levels/especiales/benchmark.level) with the real GameState and the real controls — slot levels with
 * InputFrame.forkStep (one press per slot, like F / V), loads backed out of slots, off the truck and out of the 1-cell
 * corridor with the reverse gear (S), the truck loaded from the front at the automatic fork height — at 60 fps and at
 * Game's worst dt (1/20). It also checks the level's gentle traps in the live state: a box that fits a cue but is not
 * the destined one leaves its slot or truck level dark (a soft `wrongTarget`, never anything negative), and a box put
 * on its destiny locks there for good (on the truck, the next level still loads on top of it).
 */
import { describe, expect, it } from 'vitest';
import { slotsOf } from '../core/racks';
import { truckSlotsOf } from '../core/docks';
import { cueFits, isDestined } from '../core/sorting';
import type { GameEvent } from '../core/types';
import { BENCHMARK_ID, getSpecialLevel } from '../data/levels';
import { LevelGrid, misplacedCount } from '../data/levels/solver';
import { GameState } from '../logic/GameState';
import { autopilot, liveStacks } from './autopilot';

const level = getSpecialLevel(BENCHMARK_ID)!;
const grid = new LevelGrid(level);
const slotIndex = (id: string) => slotsOf(level).findIndex((s) => s.id === id);
/** Every target: 3 zones, 6 slots with a cue, 3 truck levels. */
const TARGETS = 12;

type Dropped = Extract<GameEvent, { type: 'boxDropped' }>;
type Picked = Extract<GameEvent, { type: 'boxPicked' }>;
const drops = (events: readonly GameEvent[]) => events.filter((e): e is Dropped => e.type === 'boxDropped');
const picks = (events: readonly GameEvent[]) => events.filter((e): e is Picked => e.type === 'boxPicked');

describe('the Benchmark is playable with the real controls', () => {
  it.each([
    ['60 fps', 1 / 60],
    ['20 fps (Game dt clamp)', 1 / 20],
  ] as const)('%s: the autopilot finishes it with F / V and the reverse gear', (_, dt) => {
    const out = autopilot(level, dt);
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    expect(out.moves).toBeGreaterThanOrEqual(misplacedCount(grid, liveStacks(grid, new GameState(level).getSnapshot()), level.boxes.length));
    expect(out.events.filter((e) => e.type === 'levelComplete')).toHaveLength(1);
    // Real controls: fork level presses and driving in reverse.
    expect(out.controls.forkSteps).toBeGreaterThan(0);
    expect(out.controls.reverseFrames).toBeGreaterThan(0);
    // Both racks loaded, the top slots too; boxes taken out of slots, the one parked high in the back rack included.
    const inSlots = drops(out.events).filter((d) => d.slotId !== undefined);
    for (const rack of level.racks!) expect(inSlots.some((d) => d.slotId!.startsWith(`${rack.id}:`)), rack.id).toBe(true);
    expect(inSlots.some((d) => d.level === 2)).toBe(true);
    expect(inSlots.every((d) => d.zoneId === null)).toBe(true);
    const fromSlots = picks(out.events).filter((p) => p.fromSlotId !== undefined);
    expect(fromSlots.some((p) => p.level === 2)).toBe(true);
    // The truck: its wrong load taken off from the front, every level loaded, one on top of a locked box, at the
    // automatic fork height (no F / V there: the presses above are all at the racks).
    expect(picks(out.events).filter((p) => p.fromTruckSlotId !== undefined).map((p) => p.fromTruckSlotId)).toEqual(['t1:0:0']);
    const onTruck = drops(out.events).filter((d) => d.truckSlotId !== undefined);
    expect(onTruck.filter((d) => d.correct).map((d) => d.truckSlotId).sort()).toEqual(truckSlotsOf(level).map((s) => s.id).sort());
    expect(onTruck.every((d) => d.zoneId === null && d.recipeLength === 1)).toBe(true);
    expect(onTruck.some((d) => d.level === 1 && d.correct)).toBe(true);
    // Everything lit at the end: the last drop completes the last target.
    expect(drops(out.events).at(-1)).toMatchObject({ correct: true, satisfiedCount: TARGETS, total: TARGETS });
    // Each box placed on its destiny locks there: it is never picked up again, and every target is lit once.
    const placed = drops(out.events).filter((d) => d.correct);
    expect(placed).toHaveLength(TARGETS);
    for (const d of placed) {
      expect(d).not.toHaveProperty('wrongTarget');
      const after = out.events.slice(out.events.indexOf(d) + 1);
      expect(picks(after).some((p) => p.boxId === d.boxId), d.boxId).toBe(false);
    }
    expect(out.events.some((e) => e.type === 'zoneReleased')).toBe(false);
  });
});

describe('the Benchmark in the live game state', () => {
  it('starts with its trap: mint ◆ fits the «menta» slot but is not its box (dark, not wrong); mint ▲ sits in a slot it does not fit', () => {
    const snap = new GameState(level).getSnapshot();
    const boxOf = (slotId: string) => snap.boxes.find((b) => b.id === snap.slots.find((s) => s.id === slotId)!.occupiedBy)!;
    const mintSlot = snap.slots.find((s) => s.accepts?.color === 'mint' && s.accepts.symbol === undefined)!;
    const trap = boxOf(mintSlot.id);
    expect(trap).toMatchObject({ color: 'mint', symbol: 'diamond', correct: false });
    expect(cueFits(mintSlot, trap)).toBe(true);
    expect(isDestined(mintSlot, trap)).toBe(false);
    expect(mintSlot.satisfied).toBe(false);
    const diamondSlot = snap.slots.find((s) => s.accepts?.symbol === 'diamond' && s.accepts.color === undefined)!;
    const wrong = boxOf(diamondSlot.id);
    expect(wrong).toMatchObject({ color: 'mint', symbol: 'triangle', correct: false });
    expect(cueFits(diamondSlot, wrong)).toBe(false);
    // Its destiny is the trap box's slot, and the trap box's destiny is its slot: a swap.
    expect(isDestined(mintSlot, wrong)).toBe(true);
    expect(isDestined(diamondSlot, trap)).toBe(true);
    expect(snap.progress).toEqual({ satisfied: 0, total: TARGETS });
  });

  it('starts with a wrong truck load: yellow ■ on the «azul» level, whose destiny is the «■» level right above it', () => {
    const snap = new GameState(level).getSnapshot();
    const [azul, square, exact] = snap.truckSlots!;
    expect([azul.accepts, square.accepts, exact.accepts]).toEqual([{ color: 'blue' }, { symbol: 'square' }, { color: 'yellow', symbol: 'cross' }]);
    const load = snap.boxes.find((b) => b.id === azul.occupiedBy)!;
    expect(load).toMatchObject({ color: 'yellow', symbol: 'square', truckSlotId: azul.id, correct: false, locked: false });
    expect(cueFits(azul, load)).toBe(false);
    expect(isDestined(square, load)).toBe(true);
    expect([azul.satisfied, azul.loadable, square.loadable, exact.loadable]).toEqual([false, false, false, true]);
  });

  it('parks at height: the mint swap done in its own column, through the «libre» slot on top, in the fewest moves', () => {
    const snap = new GameState(level).getSnapshot();
    const [mintSlot, diamondSlot, top] = snap.slots.filter((s) => s.rackId === 'r1' && s.column === 0);
    expect([mintSlot.accepts, diamondSlot.accepts, top.accepts]).toEqual([{ color: 'mint' }, { symbol: 'diamond' }, null]);
    const at = (id: string) => grid.cellCount + slotIndex(id);
    const swap = [
      { from: at(diamondSlot.id), drop: at(top.id) },
      { from: at(mintSlot.id), drop: at(diamondSlot.id) },
      { from: at(top.id), drop: at(mintSlot.id) },
    ];
    const out = autopilot(level, 1 / 60, swap);
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    const [park, second, third] = drops(out.events);
    expect(park).toMatchObject({ slotId: top.id, level: 2, correct: false, recipeLength: 0 });
    expect(park).not.toHaveProperty('wrongTarget'); // a «libre» slot is never a wrong target
    expect(second).toMatchObject({ slotId: diamondSlot.id, level: 1, correct: true });
    expect(third).toMatchObject({ slotId: mintSlot.id, level: 0, correct: true });
    // No move wasted: the two parks (this one and the truck's wrong load) are the extra moves the level needs.
    expect(out.moves).toBe(level.boxes.length + 2);
  });

  it('a truck level that fits but is not the destiny: blue ▲ loaded on «azul» buzzes softly, stays pickable, then moves on', () => {
    const snap = new GameState(level).getSnapshot();
    const [azul] = snap.truckSlots!;
    const bed = grid.index(azul.cell.x, azul.cell.z);
    const pile = snap.boxes.find((b) => b.color === 'blue' && b.symbol === 'triangle')!;
    // Unload the wrong box (parked east, out of the way), then the trap: blue ▲ off the floor stack onto «azul».
    const opening = [
      { from: bed, drop: grid.index(9, 1) },
      { from: grid.index(pile.cell!.x, pile.cell!.z), drop: bed },
    ];
    const out = autopilot(level, 1 / 60, opening);
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    const [unload, trap] = drops(out.events);
    expect(unload).toMatchObject({ cell: { x: 9, z: 1 }, zoneId: null, correct: false });
    expect(unload).not.toHaveProperty('wrongTarget'); // plain floor is never a target
    expect(trap).toMatchObject({ boxId: pile.id, truckSlotId: azul.id, level: 0, zoneId: null, correct: false, recipeLength: 1, wrongTarget: true });
    // It is taken back off the truck later, and ends on its own destiny (the ▲ zone).
    expect(picks(out.events).some((p) => p.boxId === pile.id && p.fromTruckSlotId === azul.id)).toBe(true);
    expect(drops(out.events).filter((d) => d.boxId === pile.id).at(-1)).toMatchObject({ correct: true, zoneId: expect.any(String) });
  });

  it('recovers from a cue that fits but is not the destiny: yellow ● into the «●» slot stays dark, then moves on', () => {
    const snap = new GameState(level).getSnapshot();
    const yellow = snap.boxes.find((b) => b.color === 'yellow')!;
    const circle = snap.slots.find((s) => s.accepts?.symbol === 'circle' && s.accepts.color === undefined)!;
    expect(cueFits(circle, yellow)).toBe(true);
    expect(isDestined(circle, yellow)).toBe(false);
    const out = autopilot(level, 1 / 60, [{ from: grid.index(yellow.cell!.x, yellow.cell!.z), drop: grid.cellCount + slotIndex(circle.id) }]);
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    const all = drops(out.events);
    expect(all[0]).toMatchObject({ boxId: yellow.id, slotId: circle.id, zoneId: null, correct: false, recipeLength: 1, wrongTarget: true });
    const last = all.filter((d) => d.boxId === yellow.id).at(-1)!;
    expect(last.correct).toBe(true);
    expect(last.slotId).not.toBe(circle.id);
    expect(out.moves).toBeGreaterThan(misplacedCount(grid, liveStacks(grid, snap), level.boxes.length));
  });
});
