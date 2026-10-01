/**
 * The three-truck fixture (src/data/levels/pruebas/tres-camiones.level, docs/STORAGE.md «Nivel de prueba»): a
 * test-only level that neither the registry nor `npm run levels` reads, built so that the shared storage model can
 * prove it needs no hardcoding for several units: two trucks in the north wall one potted plant apart, a third one in
 * the west wall, a rack of 2 levels and a rack of 3, a zone. It must stay canonical, valid, with one complete assignment
 * and no dead ends, exactly solvable and played to the end by the autopilot (./autopilot.ts) with the real controls at
 * 60 fps and at Game's worst dt (1/20); and the render builds every unit. Its exact numbers are frozen apart, with the
 * Benchmark's, in ./storageCharacterization.json.
 */
import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import { dockRailsOf } from '../core/docks';
import { FACING_X, FACING_Z } from '../core/racks';
import { assignmentsOf, levelDestinies, sortableOf, targetsOf } from '../core/sorting';
import { frontOf, storageColumnsOf, storageOf, storageSlotsOf } from '../core/storage';
import { isDoorUnit, isFrontUnit, type GameEvent } from '../core/types';
import { formatLevel, renderLevel } from '../data/asciiLevel';
import { formatRange, formatTarget } from '../data/difficulty';
import { LEVELS, LEVEL_SOURCES, SPECIAL_LEVELS, SPECIAL_LEVEL_SOURCES, loadSpecialSources } from '../data/levels';
import { DEAD_END_STATES, checkLevelTargets, levelMetrics } from '../data/levels/metrics';
import { LevelGrid, POS_SHELF, POS_STACK, deadEnds, minMoves, replayMoves } from '../data/levels/solver';
import { validateLevel } from '../data/validateLevel';
import { GameState } from '../logic/GameState';
import { LevelView } from '../render/LevelView';
import { defaultTheme } from '../themes/default';
import { autopilot } from './autopilot';
import { THREE_TRUCKS, THREE_TRUCKS_FILE } from './storageCharacterization';
import text from '../data/levels/pruebas/tres-camiones.level?raw';
import storageDoc from '../../docs/STORAGE.md?raw';

const { level } = THREE_TRUCKS;
const grid = new LevelGrid(level);
const cell = (p: { x: number; z: number }) => grid.index(p.x, p.z);
const plantAt = (x: number, z: number) => level.decor.plants.some((p) => p.x === x && p.z === z);

type Dropped = Extract<GameEvent, { type: 'boxDropped' }>;
type Picked = Extract<GameEvent, { type: 'boxPicked' }>;
const drops = (events: readonly GameEvent[]) => events.filter((e): e is Dropped => e.type === 'boxDropped');
const picks = (events: readonly GameEvent[]) => events.filter((e): e is Picked => e.type === 'boxPicked');

describe('the three-truck fixture (pruebas/tres-camiones.level)', () => {
  it('is canonical (as levels:fmt writes it), validates and round-trips; the registry and npm run levels never see it', () => {
    expect(formatLevel(text, THREE_TRUCKS_FILE)).toBe(text);
    expect(renderLevel(level, THREE_TRUCKS)).toBe(text);
    expect(validateLevel(structuredClone(level), 'tres-camiones')).toStrictEqual(level);
    // Not a level of the game nor a special one: the registry's globs skip pruebas/, and scripts/levels.mjs (report and
    // levels:fmt) only walks the registry's two folders.
    for (const levels of [LEVELS, SPECIAL_LEVELS]) expect(levels.some((l) => l.id === level.id)).toBe(false);
    for (const sources of [LEVEL_SOURCES, SPECIAL_LEVEL_SOURCES]) expect(sources.some((s) => s.file.includes('/pruebas/'))).toBe(false);
    // Its id and order clash with no level of the game, so it could be registered as it is.
    expect(loadSpecialSources({ './pruebas/tres-camiones.level': text }, LEVEL_SOURCES).map((s) => s.file)).toEqual([THREE_TRUCKS_FILE]);
    expect(THREE_TRUCKS.notes.join('\n')).toMatch(/deducción/i);
    // docs/STORAGE.md draws it as it is: its map and legend.
    const body = text.split('\n\n').slice(1).join('\n\n');
    expect(storageDoc.replace(/\r\n/g, '\n')).toContain(`\`\`\`\n${body}\`\`\``);
  });

  it('three trucks, no hardcoding: two in the north wall one potted plant apart, one in the west wall, rails and a plant at every door end', () => {
    const trucks = storageOf(level).filter(isDoorUnit);
    expect(trucks.map((t) => [t.id, t.access.wall, t.x, t.z, t.w])).toEqual([
      ['t1', 'north', 1, 0, 2],
      ['t2', 'north', 4, 0, 1],
      ['t3', 'west', 0, 4, 1],
    ]);
    // Between the two north doors, one cell with a plant: the side cell of both doors (their rails on either side of it).
    expect(plantAt(3, 0)).toBe(true);
    // min(2, limit) = 2 levels per column (docs/STORAGE.md rule 7): T's second column and C are written with one, the
    // one on top «libre»; never more than the level's stack limit.
    expect(trucks.map((t) => t.columns.map((c) => c.length))).toEqual([[2, 2], [2], [2]]);
    expect(trucks.map((t) => t.columns.map((c) => c.map((cue) => cue === null)))).toEqual([
      [
        [false, false],
        [false, true],
      ],
      [[false, true]],
      [[false, false]],
    ]);
    expect(Math.max(...trucks.flatMap((t) => t.columns.map((c) => c.length)))).toBeLessThanOrEqual(level.stackLimit!);
    // A guard rail at both ends of every door (none reaches a corner), a static obstacle behind each: a plant.
    const rails = dockRailsOf(level);
    expect(rails.map((r) => [r.unitId, r.end, r.side.x, r.side.z])).toEqual([
      ['t1', 0, 0, 0],
      ['t1', 1, 3, 0],
      ['t2', 0, 3, 0],
      ['t2', 1, 5, 0],
      ['t3', 0, 0, 3],
      ['t3', 1, 0, 5],
    ]);
    for (const { side } of rails) expect(plantAt(side.x, side.z), `${side.x},${side.z}`).toBe(true);
    // Every bed column lies outside the map beyond its wall; its door cell and the cell behind it are free floor.
    for (const bed of storageColumnsOf(level).filter((c) => c.unit.skin === 'truck')) {
      const id = `${bed.unit.id}:${bed.column}`;
      const north = isDoorUnit(bed.unit) && bed.unit.access.wall === 'north';
      expect(bed.cell, id).toEqual(north ? { x: bed.front.x, z: -1 } : { x: -1, z: bed.front.z });
      const behind = { x: bed.front.x + FACING_X[bed.facing], z: bed.front.z + FACING_Z[bed.facing] };
      for (const c of [bed.front, behind]) {
        expect(grid.solid[cell(c)], `${id} at ${c.x},${c.z}`).toBe(0);
        expect(level.zones.some((z) => z.x === c.x && z.z === c.z), `${id}: zone at ${c.x},${c.z}`).toBe(false);
      }
      expect(level.boxes.some((b) => b.x === bed.front.x && b.z === bed.front.z), id).toBe(false);
    }
    // Two boxes start loaded: a wrong one on the second truck, the destined one at the bottom of the third (locked).
    // Truck boxes are numbered after the rack boxes, truck by truck.
    const loaded = level.boxes.filter((b) => grid.kind[grid.posOf(b.x, b.z, b.level)] === POS_STACK);
    expect(loaded.map((b) => [b.id, b.x, b.z, b.level])).toEqual([
      ['b9', 4, -1, 0],
      ['b10', -1, 4, 0],
    ]);
  });

  it('a rack of 2 levels and a rack of 3, loaded from the front; a box starts parked in the free top slot of the first', () => {
    const racks = storageOf(level).filter(isFrontUnit);
    expect(racks.map((r) => [r.id, r.access.facing, r.columns.map((c) => c.length)])).toEqual([
      ['r1', 'south', [2]],
      ['r2', 'north', [3]],
    ]);
    for (const rack of racks) {
      const { facing } = rack.access;
      rack.columns.forEach((_, column) => {
        const front = frontOf(rack, column);
        const behind = { x: front.x + FACING_X[facing], z: front.z + FACING_Z[facing] };
        for (const c of [front, behind]) {
          expect(grid.solid[cell(c)], `${rack.id}:${column} at ${c.x},${c.z}`).toBe(0);
          expect(level.zones.some((z) => z.x === c.x && z.z === c.z), `${rack.id}:${column}: zone at ${c.x},${c.z}`).toBe(false);
        }
      });
    }
    const top = storageSlotsOf(level).find((s) => s.id === 'r1:0:1')!;
    expect(top.cue).toBeNull();
    const parked = level.boxes.find((b) => b.level !== undefined && b.x === top.cell.x && b.z === top.cell.z)!;
    expect(parked).toMatchObject({ id: 'b8', color: 'lavender', symbol: 'triangle', level: 1 });
  });

  it('has exactly one complete assignment, and its «dificultad:» targets hold: 9 moves (exact), repartos 1', () => {
    const targets = targetsOf(level);
    expect(targets.map((t) => t.skin ?? t.kind)).toEqual(['zone', 'rack', 'rack', 'rack', 'truck', 'truck', 'truck', 'truck', 'truck', 'truck']);
    expect(assignmentsOf(level.boxes.map(sortableOf), targets.map((t) => t.criteria), 2).count).toBe(1);
    expect(levelDestinies(level)!.slots).toHaveLength(storageSlotsOf(level).length);
    const m = levelMetrics(level, { skipMoves: true });
    expect(m.sortings).toBe(1);
    expect(m.slots).toEqual({ total: 5, cued: 3, free: 2 });
    expect(m.trucks).toEqual({ trucks: 3, columns: 4, levels: 8, cued: 6, free: 2, loaded: 2 });
    expect(THREE_TRUCKS.targets.map((t) => t.metric)).toEqual(['movimientos', 'extra', 'repartos', 'camion', 'huecos']);
    const failed = checkLevelTargets(level, THREE_TRUCKS.targets).filter((c) => !c.ok);
    expect(failed.map((c) => `${formatTarget(c.target)}: medido ${formatRange(c.range)}`)).toEqual([]);
  });

  it('no dead ends («callejones» = 0) as far as npm run levels looks: every slip along the shortest plan, then around it', { timeout: 60_000 }, () => {
    const result = deadEnds(level, { plan: minMoves(level).plan, maxStates: DEAD_END_STATES });
    expect(result).toMatchObject({ found: 0, unknown: 0, explored: DEAD_END_STATES });
    // A box put on its destiny locks there: those moves cannot be undone, so they got the full check.
    expect(result.deepChecks).toBeGreaterThan(0);
  });

  it('the exact solver: 9 moves, one per box that does not start on its destiny; the plan loads every truck and both racks', () => {
    const result = minMoves(level);
    expect(result).toMatchObject({ lower: 9, upper: 9, exact: true, unsolvable: false });
    expect(replayMoves(level, result.plan!)).toBe(true);
    // 10 boxes, the one loaded on its destiny at the start stays: 9 moves, no parking.
    expect(result.plan).toHaveLength(level.boxes.length - 1);
    const unitsLoaded = (kind: number) =>
      new Set(result.plan!.filter((m) => grid.kind[m.drop] === kind).map((m) => grid.columnOfPos(m.drop)!.ref.unit.id));
    expect([...unitsLoaded(POS_STACK)].sort()).toEqual(['t1', 't2', 't3']);
    expect([...unitsLoaded(POS_SHELF)].sort()).toEqual(['r1', 'r2']);
    // The wrong load comes off the second truck first thing, and nothing is ever parked.
    expect(grid.kind[result.plan![0].from]).toBe(POS_STACK);
    expect(result.plan!.every((m) => grid.steps[m.drop] !== null)).toBe(true);
  });

  it.each([
    ['60 fps', 1 / 60],
    ['20 fps (Game dt clamp)', 1 / 20],
  ] as const)('%s: the autopilot finishes it with the real controls, every truck and rack loaded', (_, dt) => {
    const out = autopilot(level, dt);
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    expect(out.moves).toBe(9);
    expect(out.snapshot.moves).toBe(out.moves); // the move counter agrees with the box moves driven
    expect(out.events.filter((e) => e.type === 'levelComplete')).toHaveLength(1);
    // F / V at the racks (the parked box out of the top slot of r1, into the top slot of r2) and at the trucks (the
    // level-2 loads of T and U: docs/STORAGE.md rule 9), S out of the trucks.
    expect(out.controls.forkStepsAt.rack).toBeGreaterThan(0);
    expect(out.controls.forkStepsAt.truck).toBeGreaterThan(0);
    expect(out.controls.reverseFrames).toBeGreaterThan(0);
    // The wrong load comes off the second truck through its door; the third truck's locked box never moves.
    expect(picks(out.events).filter((p) => p.skin === 'truck').map((p) => p.fromSlotId)).toEqual(['t2:0:0']);
    expect(picks(out.events).some((p) => p.boxId === 'b10')).toBe(false);
    // Every truck level lit exactly once (t3:0:0 starts lit): on both north trucks, on the west one on top of its locked
    // box, bottom → top in the first truck's first column.
    const lit = drops(out.events).filter((d) => d.correct && d.skin === 'truck').map((d) => d.slotId);
    expect([...lit].sort()).toEqual(['t1:0:0', 't1:0:1', 't1:1:0', 't2:0:0', 't3:0:1']);
    expect(lit.indexOf('t1:0:0')).toBeLessThan(lit.indexOf('t1:0:1'));
    // Both racks: every slot with a cue lit, one of them from the other rack's top slot.
    const inSlots = drops(out.events).filter((d) => d.skin === 'rack');
    expect(inSlots.filter((d) => d.correct).map((d) => d.slotId).sort()).toEqual(['r1:0:0', 'r2:0:0', 'r2:0:2']);
    expect(picks(out.events).find((p) => p.boxId === 'b8')).toMatchObject({ fromSlotId: 'r1:0:1', level: 1 });
    // Every drop lit its target and no box ever left its destiny.
    expect(drops(out.events).every((d) => d.correct && !('wrongTarget' in d))).toBe(true);
    expect(drops(out.events).at(-1)).toMatchObject({ satisfiedCount: 10, total: 10 });
    expect(out.events.some((e) => e.type === 'zoneReleased')).toBe(false);
  });

  it('the render builds every unit: three trucks (door, truck, sign, rails) that never overlap, two racks', () => {
    const snap = new GameState(level).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    view.update(snap, 1 / 60, 0, Math.PI / 4, 0);
    const groups = view.root.children.filter((c) => typeof c.userData.truckId === 'string');
    expect(groups.map((g) => g.userData.truckId)).toEqual(['t1', 't2', 't3']);
    const bodies = groups.map((g) => {
      const tagged = (tag: string) => g.children.filter((c) => c.userData[tag] !== undefined);
      // One sign sticker per truck level with a cue (a «libre» one keeps a plain cell), and the door's guard rails.
      expect(tagged('truckCue').map((c) => c.userData.truckCue), g.userData.truckId).toEqual(
        storageSlotsOf(level)
          .filter((s) => s.unit.id === g.userData.truckId && s.cue !== null)
          .map((s) => s.id),
      );
      expect(tagged('dockRails'), g.userData.truckId).toHaveLength(1);
      return new Box3().setFromObject(tagged('truckBody')[0]);
    });
    for (let a = 0; a < bodies.length; a++) for (let b = a + 1; b < bodies.length; b++) expect(bodies[a].intersectsBox(bodies[b]), `trucks ${a}, ${b}`).toBe(false);
    expect(view.root.children.filter((c) => typeof c.userData.rackId === 'string').map((c) => c.userData.rackId)).toEqual(['r1', 'r2']);
    view.dispose();
  });
});
