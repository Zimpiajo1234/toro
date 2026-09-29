/**
 * Integration check (Benchmark × logic × controls): the autopilot (./autopilot.ts) plays the test-mode «Benchmark»
 * (src/data/levels/especiales/benchmark.level) with the real GameState and the real controls — slot levels with
 * InputFrame.forkStep (one press per slot, like F / V), loads backed out of slots and out of the 1-cell corridor with
 * the reverse gear (S) — at 60 fps and at Game's worst dt (1/20). It also checks the level's gentle trap in the live
 * state: a box that fits a cue but is not the destined one leaves its slot dark, never anything negative.
 */
import { describe, expect, it } from 'vitest';
import { slotsOf } from '../core/racks';
import { cueFits, isDestined } from '../core/sorting';
import type { GameEvent } from '../core/types';
import { BENCHMARK_ID, getSpecialLevel } from '../data/levels';
import { LevelGrid, misplacedCount } from '../data/levels/solver';
import { GameState } from '../logic/GameState';
import { autopilot, liveStacks } from './autopilot';

const level = getSpecialLevel(BENCHMARK_ID)!;
const grid = new LevelGrid(level);
const slotIndex = (id: string) => slotsOf(level).findIndex((s) => s.id === id);

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
    // Everything lit at the end: the last drop completes the ninth target (3 zones + 6 slots with a cue).
    expect(drops(out.events).at(-1)).toMatchObject({ correct: true, satisfiedCount: 9, total: 9 });
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
    expect(snap.progress).toEqual({ satisfied: 0, total: 9 });
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
    expect(second).toMatchObject({ slotId: diamondSlot.id, level: 1, correct: true });
    expect(third).toMatchObject({ slotId: mintSlot.id, level: 0, correct: true });
    // No move wasted: the park is the one extra move the level needs.
    expect(out.moves).toBe(level.boxes.length + 1);
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
    expect(all[0]).toMatchObject({ boxId: yellow.id, slotId: circle.id, zoneId: null, correct: false, recipeLength: 1 });
    const last = all.filter((d) => d.boxId === yellow.id).at(-1)!;
    expect(last.correct).toBe(true);
    expect(last.slotId).not.toBe(circle.id);
    expect(out.moves).toBeGreaterThan(misplacedCount(grid, liveStacks(grid, snap), level.boxes.length));
  });
});
