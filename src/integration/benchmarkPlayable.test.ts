/**
 * Integration check (Benchmark × logic × controls): the autopilot (./autopilot.ts) plays the test-mode «Benchmark»
 * (src/data/levels/especiales/benchmark.level) with the real GameState and the real controls — slot levels with
 * InputFrame.forkStep (one press per slot, like F / V), loads backed out of slots, off the truck and out of the 1-cell
 * corridor with the reverse gear (S), the truck loaded through its door with its levels chosen by F / V too
 * (docs/STORAGE.md rule 9), the conveyor belt fed from its input on its table, the forks raised there with F as at a
 * rack's level-1 slot (docs/CONVEYOR.md) — at 60 fps and at Game's worst dt
 * (1/20). It also checks the level's gentle traps in the live state: a box that fits a cue but is not
 * the destined one leaves its slot or truck level dark (a soft `wrongTarget`, never anything negative), and a box put
 * on its destiny locks there for good (on the truck, the next level still loads on top of it).
 */
import { describe, expect, it } from 'vitest';
import { cueFits, isDestined } from '../core/sorting';
import { storageOf, storageSlotsOf } from '../core/storage';
import type { GameEvent, GameSnapshot } from '../core/types';
import { BENCHMARK_ID, getSpecialLevel } from '../data/levels';
import { LevelGrid, misplacedCount } from '../data/levels/solver';
import { GameState } from '../logic/GameState';
import { autopilot, liveStacks } from './autopilot';

const level = getSpecialLevel(BENCHMARK_ID)!;
const grid = new LevelGrid(level);
/** Every target: 3 zones, 6 slots with a cue, 3 truck levels, the conveyor belt's end exit. */
const TARGETS = 13;

type Dropped = Extract<GameEvent, { type: 'boxDropped' }>;
type Picked = Extract<GameEvent, { type: 'boxPicked' }>;
type Delivered = Extract<GameEvent, { type: 'beltDelivered' }>;
const drops = (events: readonly GameEvent[]) => events.filter((e): e is Dropped => e.type === 'boxDropped');
const picks = (events: readonly GameEvent[]) => events.filter((e): e is Picked => e.type === 'boxPicked');
const deliveries = (events: readonly GameEvent[]) => events.filter((e): e is Delivered => e.type === 'beltDelivered');
/** The live storage slots of each skin (snapshot.storageSlots: rack slots, then truck levels). */
const rackSlots = (snap: GameSnapshot) => snap.storageSlots.filter((s) => s.skin === 'rack');
const truckSlots = (snap: GameSnapshot) => snap.storageSlots.filter((s) => s.skin === 'truck');

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
    expect(out.snapshot.moves).toBe(out.moves); // the move counter agrees with the box moves driven
    // Real controls: fork level presses and driving in reverse.
    expect(out.controls.forkSteps).toBeGreaterThan(0);
    expect(out.controls.reverseFrames).toBeGreaterThan(0);
    // Both racks loaded, the top slots too; boxes taken out of slots, the one parked high in the back rack included.
    const inSlots = drops(out.events).filter((d) => d.skin === 'rack');
    const racks = storageOf(level).filter((unit) => unit.skin === 'rack');
    expect(racks).toHaveLength(2);
    for (const rack of racks) expect(inSlots.some((d) => d.slotId!.startsWith(`${rack.id}:`)), rack.id).toBe(true);
    expect(inSlots.some((d) => d.level === 2)).toBe(true);
    expect(inSlots.every((d) => d.zoneId === null)).toBe(true);
    const fromSlots = picks(out.events).filter((p) => p.skin === 'rack');
    expect(fromSlots.some((p) => p.level === 2)).toBe(true);
    // The truck: its wrong load taken off from the front, every level with a cue loaded, one on top of a locked box,
    // with F / V there too (the forks go by the keys at every unit: the level-2 drop needs a press at the truck).
    expect(picks(out.events).filter((p) => p.skin === 'truck').map((p) => p.fromSlotId)).toEqual(['t1:0:0']);
    const onTruck = drops(out.events).filter((d) => d.skin === 'truck');
    const truckTargets = storageSlotsOf(level).filter((s) => s.unit.skin === 'truck' && s.cue !== null);
    expect(onTruck.filter((d) => d.correct).map((d) => d.slotId).sort()).toEqual(truckTargets.map((s) => s.id).sort());
    expect(out.controls.forkStepsAt.truck).toBeGreaterThan(0);
    // At the belt's input, one press of F up to its slot on the table (docs/CONVEYOR.md, H1b), as at a rack's level 1.
    expect(out.controls.forkStepsAt.beltIn).toBe(1);
    expect(out.controls.forkStepsAt.beltOut).toBe(0);
    expect(out.controls.forkStepsAt.rack + out.controls.forkStepsAt.truck + out.controls.forkStepsAt.beltIn).toBe(out.controls.forkSteps);
    expect(onTruck.every((d) => d.zoneId === null && d.recipeLength === 1)).toBe(true);
    expect(onTruck.some((d) => d.level === 1 && d.correct)).toBe(true);
    // Everything lit at the end: the last box placed (set down, or brought in by the belt) completes the last target.
    const lit = out.events.filter((e): e is Dropped | Delivered => (e.type === 'boxDropped' || e.type === 'beltDelivered') && e.correct);
    expect(lit.at(-1)).toMatchObject({ satisfiedCount: TARGETS, total: TARGETS });
    // The conveyor belt (docs/CONVEYOR.md): the coral ✚ set down on its input rides into its end exit, which it lights;
    // the drop counts as the move, the ride as none.
    const [belt] = level.conveyors!;
    const ride = deliveries(out.events);
    expect(ride).toHaveLength(1);
    expect(ride[0]).toMatchObject({ conveyorId: belt.id, slotId: `${belt.output}:0:1`, skin: 'beltOut', correct: true });
    expect(ride[0]).not.toHaveProperty('wrongTarget');
    const ontoBelt = drops(out.events).filter((d) => d.skin === 'beltIn');
    expect(ontoBelt).toEqual([expect.objectContaining({ boxId: ride[0].boxId, slotId: `${belt.input}:0:1`, level: 1, correct: false, recipeLength: 0 })]);
    expect(ontoBelt[0]).not.toHaveProperty('wrongTarget'); // a belt's input is «libre»
    const started = out.events.findIndex((e) => e.type === 'beltStarted');
    expect(started).toBeGreaterThan(out.events.indexOf(ontoBelt[0]));
    expect(out.events.indexOf(ride[0])).toBeGreaterThan(started);
    // Each box placed on its destiny locks there: it is never picked up again, and every target is lit once (the end
    // exit by its delivery).
    const placed = [...drops(out.events).filter((d) => d.correct), ...ride.filter((d) => d.correct)];
    expect(placed).toHaveLength(TARGETS);
    for (const d of placed) {
      expect(d).not.toHaveProperty('wrongTarget');
      const after = out.events.slice(out.events.indexOf(d) + 1);
      expect(picks(after).some((p) => p.boxId === d.boxId), d.boxId).toBe(false);
    }
    expect(out.events.some((e) => e.type === 'zoneReleased' || e.type === 'beltBlocked')).toBe(false);
  });
});

describe('the Benchmark in the live game state', () => {
  it('starts with its trap: mint ◆ fits the «menta» slot but is not its box (dark, not wrong); mint ▲ sits in a slot it does not fit', () => {
    const snap = new GameState(level).getSnapshot();
    const boxOf = (slotId: string) => snap.boxes.find((b) => b.id === rackSlots(snap).find((s) => s.id === slotId)!.occupiedBy)!;
    const mintSlot = rackSlots(snap).find((s) => s.accepts?.color === 'mint' && s.accepts.symbol === undefined)!;
    const trap = boxOf(mintSlot.id);
    expect(trap).toMatchObject({ color: 'mint', symbol: 'diamond', correct: false });
    expect(cueFits(mintSlot, trap)).toBe(true);
    expect(isDestined(mintSlot, trap)).toBe(false);
    expect(mintSlot.satisfied).toBe(false);
    const diamondSlot = rackSlots(snap).find((s) => s.accepts?.symbol === 'diamond' && s.accepts.color === undefined)!;
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
    const [azul, square, exact, free] = truckSlots(snap);
    expect([azul.accepts, square.accepts, exact.accepts]).toEqual([{ color: 'blue' }, { symbol: 'square' }, { color: 'yellow', symbol: 'cross' }]);
    // Over «amarillo ✚», its column's «libre» level (docs/STORAGE.md rule 7): parking, never a target.
    expect(free).toMatchObject({ id: 't1:1:1', accepts: null, destined: null, satisfied: false, loadable: false });
    const load = snap.boxes.find((b) => b.id === azul.occupiedBy)!;
    expect(load).toMatchObject({ color: 'yellow', symbol: 'square', slotId: azul.id, correct: false, locked: false });
    expect(cueFits(azul, load)).toBe(false);
    expect(isDestined(square, load)).toBe(true);
    expect([azul.satisfied, azul.loadable, square.loadable, exact.loadable]).toEqual([false, false, false, true]);
  });

  it('parks at height: the mint swap done in its own column, through the «libre» slot on top, in the fewest moves', () => {
    const snap = new GameState(level).getSnapshot();
    const [mintSlot, diamondSlot, top] = rackSlots(snap).filter((s) => s.unitId === 'r1' && s.column === 0);
    expect([mintSlot.accepts, diamondSlot.accepts, top.accepts]).toEqual([{ color: 'mint' }, { symbol: 'diamond' }, null]);
    const at = (id: string) => grid.positionOfSlot(id);
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
    const [azul] = truckSlots(snap);
    const bed = grid.posOf(azul.cell.x, azul.cell.z); // its bed column, outside the map
    const pile = snap.boxes.find((b) => b.color === 'blue' && b.symbol === 'triangle')!;
    // Unload the wrong box (parked east, out of the way), then the trap: blue ▲ off the floor stack onto «azul».
    const opening = [
      { from: bed, drop: grid.index(10, 1) },
      { from: grid.index(pile.cell!.x, pile.cell!.z), drop: bed },
    ];
    const out = autopilot(level, 1 / 60, opening);
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    const [unload, trap] = drops(out.events);
    expect(unload).toMatchObject({ cell: { x: 10, z: 1 }, zoneId: null, correct: false });
    expect(unload).not.toHaveProperty('wrongTarget'); // plain floor is never a target
    expect(trap).toMatchObject({ boxId: pile.id, slotId: azul.id, skin: 'truck', level: 0, zoneId: null, correct: false, recipeLength: 1, wrongTarget: true });
    // It is taken back off the truck later, and ends on its own destiny (the ▲ zone).
    expect(picks(out.events).some((p) => p.boxId === pile.id && p.fromSlotId === azul.id)).toBe(true);
    expect(drops(out.events).filter((d) => d.boxId === pile.id).at(-1)).toMatchObject({ correct: true, zoneId: expect.any(String) });
  });

  it('recovers from a cue that fits but is not the destiny: yellow ● into the «●» slot stays dark, then moves on', () => {
    const snap = new GameState(level).getSnapshot();
    const yellow = snap.boxes.find((b) => b.color === 'yellow')!;
    const circle = rackSlots(snap).find((s) => s.accepts?.symbol === 'circle' && s.accepts.color === undefined)!;
    expect(cueFits(circle, yellow)).toBe(true);
    expect(isDestined(circle, yellow)).toBe(false);
    const out = autopilot(level, 1 / 60, [{ from: grid.index(yellow.cell!.x, yellow.cell!.z), drop: grid.positionOfSlot(circle.id) }]);
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
