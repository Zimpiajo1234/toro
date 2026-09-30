/**
 * Integration check (move counter × logic × solver data): the autopilot (./autopilot.ts) plays level 3 and the
 * Benchmark with the real GameState, and GameSnapshot.moves ends equal to the box moves it made — the solver's
 * «movimientos» criterion, which is also what the precomputed minimum (src/data/levels/minimums.ts) counts, so its
 * shortest plan ends exactly on the minimum the HUD shows. Level 1 with the real vehicle controls: a box picked up and
 * put straight back leaves the count unchanged.
 */
import { describe, expect, it } from 'vitest';
import type { GameEvent, InputFrame } from '../core/types';
import { BENCHMARK_ID, LEVELS, getSpecialLevel } from '../data/levels';
import { levelMinimum } from '../data/levels/minimums';
import { LevelGrid } from '../data/levels/solver';
import { slotsOf } from '../core/racks';
import { GameState } from '../logic/GameState';
import { autopilot } from './autopilot';

const benchmark = getSpecialLevel(BENCHMARK_ID)!;
const level3 = LEVELS.find((l) => l.order === 3)!;
const drops = (events: readonly GameEvent[]) => events.filter((e) => e.type === 'boxDropped');

describe('the move counter with the real controls', () => {
  it.each([
    ['level 3', level3],
    ['the Benchmark', benchmark],
  ] as const)('%s: the autopilot ends with snapshot.moves = its plan length = the precomputed minimum', (_, level) => {
    const out = autopilot(level, 1 / 60);
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    expect(out.snapshot.completed).toBe(true);
    expect(out.snapshot.moves).toBe(out.moves);
    expect(drops(out.events)).toHaveLength(out.moves);
    const min = levelMinimum(level.id);
    expect(min).toMatchObject({ exact: true });
    expect(out.moves, 'the shortest plan, driven for real, ends on the minimum the HUD shows').toBe(min!.moves);
  });

  it('the Benchmark: moves between the slots of one column count one each; a detour counts above the minimum', () => {
    const grid = new LevelGrid(benchmark);
    const slots = slotsOf(benchmark);
    const at = (id: string) => grid.cellCount + slots.findIndex((s) => s.id === id);
    // The mint swap inside column r1:0 through its «libre» top slot (docs/RACKS.md): three moves, levels 1 → 2 → …
    const swap = [
      { from: at('r1:0:1'), drop: at('r1:0:2') },
      { from: at('r1:0:0'), drop: at('r1:0:1') },
      { from: at('r1:0:2'), drop: at('r1:0:0') },
    ];
    const out = autopilot(benchmark, 1 / 60, swap);
    expect(out.solved).toBe(true);
    expect(out.snapshot.moves).toBe(out.moves);
    expect(out.moves).toBe(levelMinimum(BENCHMARK_ID)!.moves);
    // Yellow into the «●» slot first (fits the cue, not its destiny): taken out again later, so more than the minimum.
    const snap = new GameState(benchmark).getSnapshot();
    const yellow = snap.boxes.find((b) => b.color === 'yellow')!;
    const circle = snap.storageSlots.find((s) => s.skin === 'rack' && s.accepts?.symbol === 'circle' && s.accepts.color === undefined)!;
    const detour = autopilot(benchmark, 1 / 60, [{ from: grid.index(yellow.cell!.x, yellow.cell!.z), drop: at(circle.id) }]);
    expect(detour.solved).toBe(true);
    expect(detour.snapshot.moves).toBe(detour.moves);
    expect(detour.snapshot.moves).toBeGreaterThan(levelMinimum(BENCHMARK_ID)!.moves);
  });

  it('level 1: a box picked up and put straight back is no move; carrying it to its zone is the one move', () => {
    const [first] = LEVELS;
    const state = new GameState(first);
    const snap = state.getSnapshot();
    const hold = (throttle: number, actionPressed = false): InputFrame => ({ move: { x: 0, z: 0 }, drive: { throttle, steer: 0 }, actionPressed });
    // W up to the box, then let the forklift come to rest facing it.
    for (let i = 0; i < 600 && !snap.hint.targetBoxId; i++) state.update(1 / 60, hold(1));
    for (let i = 0; i < 90; i++) state.update(1 / 60, hold(0));
    const box = snap.boxes.find((b) => b.id === snap.hint.targetBoxId)!;
    const from = { ...box.cell! };
    for (let k = 0; k < 2; k++) {
      state.update(1 / 60, hold(0, true));
      expect(snap.forklift.carrying).toBe(box.id);
      const put = state.update(1 / 60, hold(0, true)).find((e) => e.type === 'boxDropped');
      expect(put).toMatchObject({ boxId: box.id, cell: from, level: 0 });
      expect(snap.moves).toBe(0);
      for (let i = 0; i < 20; i++) state.update(1 / 60, hold(0));
    }
    // Now the real move: W to the zone and drop there.
    state.update(1 / 60, hold(0, true));
    for (let i = 0; i < 900 && !snap.hint.dropZoneId; i++) state.update(1 / 60, hold(1));
    state.update(1 / 60, hold(1, true));
    expect(snap.completed).toBe(true);
    expect(snap.moves).toBe(1);
    expect(snap.moves).toBe(levelMinimum(first.id)!.moves);
  });
});
