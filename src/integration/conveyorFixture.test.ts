/**
 * The conveyor belt fixture (src/data/levels/pruebas/cinta.level, docs/CONVEYOR.md «Nivel de prueba»): a test-only
 * level that neither the registry nor `npm run levels` reads. A belt of two floor cells runs north from its input A to
 * its end exit B, between two potted plants: the forklift can only send a box there along the belt. It must stay
 * canonical and valid, with one complete assignment and no dead ends, exactly solvable (3 moves: the ride counts none)
 * and played to the end by the autopilot (./autopilot.ts) with the real controls at 60 fps and at Game's worst dt
 * (1/20); and the render builds the belt, whose stripes slide only while it runs.
 */
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import { beltPathOf, conveyorsOf } from '../core/conveyors';
import { assignmentsOf, sortableOf, targetsOf } from '../core/sorting';
import { storageOf } from '../core/storage';
import type { GameEvent } from '../core/types';
import { formatLevel, parseLevel, renderLevel } from '../data/asciiLevel';
import { formatRange, formatTarget } from '../data/difficulty';
import { LEVEL_SOURCES, SPECIAL_LEVEL_SOURCES } from '../data/levels';
import { DEAD_END_STATES, checkLevelTargets, levelMetrics } from '../data/levels/metrics';
import { LevelGrid, deadEnds, minMoves, replayMoves } from '../data/levels/solver';
import { validateLevel } from '../data/validateLevel';
import { CONVEYOR } from '../logic/conveyor';
import { GameState } from '../logic/GameState';
import { LevelView } from '../render/LevelView';
import { defaultTheme } from '../themes/default';
import { autopilot } from './autopilot';
import text from '../data/levels/pruebas/cinta.level?raw';

const FILE = 'src/data/levels/pruebas/cinta.level';
const parsed = parseLevel(text, FILE);
const { level } = parsed;
const grid = new LevelGrid(level);
const plantAt = (x: number, z: number) => level.decor.plants.some((p) => p.x === x && p.z === z);

type Dropped = Extract<GameEvent, { type: 'boxDropped' }>;
const drops = (events: readonly GameEvent[]) => events.filter((e): e is Dropped => e.type === 'boxDropped');

describe('the conveyor belt fixture (pruebas/cinta.level)', () => {
  it('is canonical (as levels:fmt writes it), validates and round-trips; the registry and npm run levels never see it', () => {
    expect(formatLevel(text, FILE)).toBe(text);
    expect(renderLevel(level, parsed)).toBe(text);
    expect(validateLevel(structuredClone(level), level.id)).toStrictEqual(level);
    for (const sources of [LEVEL_SOURCES, SPECIAL_LEVEL_SOURCES]) expect(sources.some((s) => s.file.includes('/pruebas/') || s.level.id === level.id)).toBe(false);
    expect(parsed.notes.join('\n')).toMatch(/conveyorFixture\.test\.ts/);
  });

  it('one belt: input A (3,3), two floor cells north, end exit B (3,0) between two plants; A loaded from its front, free floor', () => {
    const [belt, ...more] = conveyorsOf(level);
    expect(more).toEqual([]);
    expect(belt).toEqual({
      id: 'c1',
      input: 'e1',
      output: 's1',
      cells: [
        { x: 3, z: 2, piece: 'suelo', height: 0 },
        { x: 3, z: 1, piece: 'suelo', height: 0 },
      ],
    });
    expect(storageOf(level)).toEqual([
      { id: 'e1', skin: 'beltIn', x: 3, z: 3, w: 1, access: { kind: 'front', facing: 'south' }, columns: [[null]] },
      { id: 's1', skin: 'beltOut', x: 3, z: 0, w: 1, access: { kind: 'belt', facing: 'south' }, columns: [[{ color: 'blue' }]] },
    ]);
    expect(beltPathOf(level, belt).map((c) => [c.x, c.z])).toEqual([
      [3, 3],
      [3, 2],
      [3, 1],
      [3, 0],
    ]);
    // The forklift can reach B from nowhere: a plant each side, the belt in front, the wall behind.
    expect([plantAt(2, 0), plantAt(4, 0)]).toEqual([true, true]);
    // A's front and the cell behind it: free floor, no zone (the model loads it by one step from behind).
    for (const c of [
      { x: 3, z: 4 },
      { x: 3, z: 5 },
    ]) {
      expect(grid.solid[grid.index(c.x, c.z)]).toBe(0);
      expect(level.zones.some((z) => z.x === c.x && z.z === c.z)).toBe(false);
    }
    // The belt's cells, A and B are obstacles of the model.
    for (const [x, z] of [
      [3, 0],
      [3, 1],
      [3, 2],
      [3, 3],
    ])
      expect(grid.solid[grid.index(x, z)], `${x},${z}`).toBe(1);
  });

  it('has exactly one complete assignment (the end exit is a target, the input never), and its «dificultad:» targets hold', () => {
    const targets = targetsOf(level);
    expect(targets.map((t) => t.skin ?? t.kind)).toEqual(['zone', 'zone', 'beltOut']);
    expect(assignmentsOf(level.boxes.map(sortableOf), targets.map((t) => t.criteria), 2).count).toBe(1);
    const m = levelMetrics(level, { skipMoves: true });
    expect(m.sortings).toBe(1);
    expect(m.belts).toEqual({ belts: 1, cells: 2, floor: 2, exits: 1, cued: 1 });
    expect(parsed.targets.map((t) => t.metric)).toEqual(['movimientos', 'repartos', 'cinta']);
    const failed = checkLevelTargets(level, parsed.targets).filter((c) => !c.ok);
    expect(failed.map((c) => `${formatTarget(c.target)}: medido ${formatRange(c.range)}`)).toEqual([]);
  });

  it('the exact solver: 3 moves, one per box; blue ● goes to B in one move, through A; nothing is ever lifted from B', () => {
    const result = minMoves(level);
    expect(result).toMatchObject({ lower: 3, upper: 3, exact: true, unsolvable: false });
    expect(replayMoves(level, result.plan!)).toBe(true);
    const exit = grid.positionOfSlot('s1:0:0');
    const input = grid.positionOfSlot('e1:0:0');
    const blue = level.boxes.find((b) => b.color === 'blue' && b.symbol === 'circle')!;
    expect(result.plan!.filter((m) => m.drop === exit)).toEqual([expect.objectContaining({ from: grid.index(blue.x, blue.z) })]);
    expect(result.plan!.some((m) => m.from === exit || m.drop === input || m.from === input)).toBe(false);
  });

  it('no dead ends («callejones» = 0) as far as npm run levels looks', { timeout: 60_000 }, () => {
    const result = deadEnds(level, { plan: minMoves(level).plan, maxStates: DEAD_END_STATES });
    expect(result).toMatchObject({ found: 0, unknown: 0 });
  });

  it.each([
    ['60 fps', 1 / 60],
    ['20 fps (Game dt clamp)', 1 / 20],
  ] as const)('%s: the autopilot finishes it, the belt carrying blue ● into B; the ride is no move', (_, dt) => {
    const out = autopilot(level, dt);
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    expect(out.moves).toBe(3);
    expect(out.snapshot.moves).toBe(3);
    const types = out.events.map((e) => e.type);
    expect(types.filter((t) => t === 'levelComplete')).toHaveLength(1);
    const onInput = drops(out.events).filter((d) => d.skin === 'beltIn');
    expect(onInput).toEqual([expect.objectContaining({ boxId: 'b1', slotId: 'e1:0:0', correct: false, recipeLength: 0 })]);
    const at = (type: GameEvent['type']) => types.indexOf(type);
    expect(at('beltStarted')).toBeGreaterThan(out.events.indexOf(onInput[0]));
    expect(out.events.find((e) => e.type === 'beltStarted')).toMatchObject({ conveyorId: 'c1', boxId: 'b1', runSec: expect.closeTo(3 / CONVEYOR.speed + CONVEYOR.rampSec, 9) });
    expect(at('beltDelivered')).toBeGreaterThan(at('beltStarted'));
    expect(out.events.find((e) => e.type === 'beltDelivered')).toMatchObject({ boxId: 'b1', slotId: 's1:0:0', skin: 'beltOut', correct: true });
    expect(types).not.toContain('beltBlocked');
    // Every drop or delivery lit its target, except the drop on the input («libre»: never a target, never a buzz).
    expect(drops(out.events).every((d) => !('wrongTarget' in d) && (d.correct || d.skin === 'beltIn'))).toBe(true);
    expect(out.snapshot.boxes.find((b) => b.id === 'b1')).toMatchObject({ slotId: 's1:0:0', correct: true, locked: true });
  });

  it('the render builds the belt: A\'s pad and the band with its stripes, B\'s tray and its cue board; the stripes slide only as the belt moves', () => {
    const state = new GameState(level);
    const snap = state.getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    view.update(snap, 1 / 60, 0, Math.PI / 4, 0);
    const input = view.root.children.find((c) => c.userData.beltInId === 'e1')!;
    const exit = view.root.children.find((c) => c.userData.beltOutId === 's1')!;
    expect(input).toBeDefined();
    expect(exit).toBeDefined();
    const tagged = (group: typeof input, tag: string) => group.children.filter((c) => c.userData[tag] !== undefined);
    expect(tagged(input, 'beltPad')).toHaveLength(1);
    expect(tagged(input, 'beltBand').map((c) => c.userData.beltBand)).toEqual(['c1']);
    expect(tagged(exit, 'beltTray')).toHaveLength(1);
    expect(tagged(exit, 'beltBoard')).toHaveLength(1);
    expect(tagged(exit, 'beltCue').map((c) => c.userData.beltCue)).toEqual(['s1:0:0']);
    expect(tagged(exit, 'beltGlow')).toHaveLength(1);
    const stripes = tagged(input, 'beltStripes')[0] as unknown as { geometry: { getAttribute(name: string): { array: Float32Array } } };
    const positions = () => Array.from(stripes.geometry.getAttribute('position').array);
    const still = positions();
    // Idle: nothing moves, frame after frame.
    for (let i = 0; i < 5; i++) view.update(snap, 1 / 60, (i + 1) / 60, Math.PI / 4, 0);
    expect(positions()).toEqual(still);
    // The surface moves (ConveyorState.travel): the stripes slide along the belt (north, toward B: world z decreasing)
    // and stay on its band.
    snap.conveyors[0].travel = 0.1;
    view.update(snap, 1 / 60, 0.2, Math.PI / 4, 0);
    const moved = positions();
    expect(moved).not.toEqual(still);
    const zs = (values: number[]) => values.filter((_, i) => i % 3 === 2);
    const xs = (values: number[]) => values.filter((_, i) => i % 3 === 0);
    const bandZ = [3 + 0.5 - level.size.depth / 2 - 0.5 - 2, 3 + 0.5 - level.size.depth / 2 - 0.5];
    for (const z of zs(moved)) {
      expect(z).toBeGreaterThanOrEqual(bandZ[0] - 1e-5);
      expect(z).toBeLessThanOrEqual(bandZ[1] + 1e-5);
    }
    for (const x of xs(moved)) expect(Math.abs(x - (3 + 0.5 - level.size.width / 2))).toBeLessThanOrEqual(0.4 + 1e-5);
    expect(Math.min(...zs(moved).filter((z) => z < bandZ[1] - 1e-5 && z > bandZ[0] + 1e-5))).toBeLessThan(Math.min(...zs(still).filter((z) => z < bandZ[1] - 1e-5 && z > bandZ[0] + 1e-5)));
    view.dispose();
  });
});
