import { describe, expect, it } from 'vitest';
import { runsAlongX, FACING_X, FACING_Z } from '../../core/racks';
import { dockRailsOf } from '../../core/docks';
import { STORAGE_SKINS, cellOf, storageColumnsOf, storageOf, storageSlotsOf } from '../../core/storage';
import { assignmentsOf, criteriaOf, levelDestinies, matchKind, meets, sameKind, sortableOf, targetsOf, type Sortable } from '../../core/sorting';
import { isDoorUnit, isFrontUnit, type LevelData } from '../../core/types';
import { parseLevel, renderLevel } from '../asciiLevel';
import { formatRange, formatTarget } from '../difficulty';
import { validateLevel } from '../validateLevel';
import { BENCHMARK_ID, LEVELS, LEVEL_SOURCES, SPECIAL_LEVELS, SPECIAL_LEVEL_SOURCES, getSpecialLevel, loadSpecialSources } from './index';
import { DEAD_END_STATES, checkLevelTargets, levelMetrics } from './metrics';
import {
  LevelGrid,
  POS_SHELF,
  POS_STACK,
  canLift,
  carrySearch,
  deadEndCorridors,
  deadEnds,
  lift,
  lockedAt,
  minMoves,
  occupancyOf,
  pickupStarts,
  reachableFrom,
  replayMoves,
  solve,
  stacksOf,
} from './solver';

/*
 * The special levels (src/data/levels/especiales/, outside LEVELS) and the «Benchmark» of test mode: every storage
 * rack mechanic of docs/RACKS.md, the loading dock of docs/DOCKS.md and the conveyor belt of docs/CONVEYOR.md in one
 * small, crowded warehouse (plan «estanterías almacenables + Benchmark», fase 3; muelles de carga, 2026-09-30; cinta
 * transportadora H1, 2026-10-01).
 */

const source = SPECIAL_LEVEL_SOURCES.find((s) => s.level.id === BENCHMARK_ID)!;
const level = source.level;
const grid = new LevelGrid(level);
/** Every storage slot (racks, then the truck: snapshot order) and the truck's bed columns. */
const slots = storageSlotsOf(level);
const beds = storageColumnsOf(level).filter((c) => c.unit.skin === 'truck');
const cell = (p: { x: number; z: number }) => grid.index(p.x, p.z);
/** A box that starts stored: in a rack slot or on the truck. */
const isStored = (b: LevelData['boxes'][number]) => b.level !== undefined;
const kindText = (k: Sortable) => `${k.color}/${k.symbol}`;

/** The shortest plan, searched once. */
let shortest: ReturnType<typeof minMoves> | null = null;
const shortestPlan = () => (shortest ??= minMoves(level));

describe('special levels registry', () => {
  it('the Benchmark is the one special level: especiales/benchmark.level, never part of LEVELS', () => {
    expect(SPECIAL_LEVELS.map((l) => l.id)).toEqual([BENCHMARK_ID]);
    expect(source).toMatchObject({ file: 'src/data/levels/especiales/benchmark.level', format: 'level' });
    expect(level.name).toBe('Benchmark');
    expect(getSpecialLevel(BENCHMARK_ID)).toBe(level);
    expect(getSpecialLevel('primer-encargo')).toBeUndefined();
    // The game's registry: its levels (1–3 while 4–24 are redone), none of them special.
    expect(LEVELS).toHaveLength(3);
    expect(LEVELS.some((l) => l.id === BENCHMARK_ID)).toBe(false);
    expect(LEVEL_SOURCES.some((s) => s.file.includes('/especiales/'))).toBe(false);
  });

  it('refuses a special level whose id or order a game level already uses', () => {
    const text = source.text!;
    const clashId = { './especiales/x.level': text.replace('id: benchmark', 'id: primer-encargo') };
    expect(() => loadSpecialSources(clashId, LEVEL_SOURCES)).toThrow(/Nivel repetido: el id «primer-encargo» está en src\/data\/levels\/level-01\.level/);
    const clashOrder = { './especiales/x.level': text.replace('# 100 · Benchmark', '# 2 · Benchmark') };
    expect(() => loadSpecialSources(clashOrder, LEVEL_SOURCES)).toThrow(/Orden repetido: 2 está en src\/data\/levels\/level-02\.level/);
    expect(loadSpecialSources({ './especiales/x.level': text }, LEVEL_SOURCES).map((s) => s.file)).toEqual(['src/data/levels/especiales/x.level']);
  });
});

describe('Benchmark (especiales/benchmark.level)', () => {
  it('is canonical, validates and round-trips', () => {
    expect(renderLevel(level, source)).toBe(source.text);
    expect(parseLevel(source.text!, source.file).level).toStrictEqual(level);
    expect(validateLevel(structuredClone(level), 'benchmark')).toStrictEqual(level);
    expect(level.size.width).toBeLessThanOrEqual(14);
    expect(level.size.depth).toBeLessThanOrEqual(11);
  });

  it('asks for every kind of target: floor zones by colour, by symbol and exact; slot cues of the three kinds and «libre» slots', () => {
    expect(new Set(level.zones.map((z) => matchKind(criteriaOf(z))))).toEqual(new Set(['color', 'symbol', 'exact']));
    const cues = slots.filter((s) => s.unit.skin === 'rack').map((s) => s.cue);
    expect(new Set(cues.filter((c) => c !== null).map((c) => matchKind(c!)))).toEqual(new Set(['color', 'symbol', 'exact']));
    expect(cues.some((c) => c === null)).toBe(true);
    // The truck's levels too, and one «libre» (docs/STORAGE.md rule 7: the one on top of the second column, implicit).
    const truckCues = slots.filter((s) => s.unit.skin === 'truck').map((s) => s.cue);
    expect(new Set(truckCues.filter((c) => c !== null).map((c) => matchKind(c!)))).toEqual(new Set(['color', 'symbol', 'exact']));
    expect(truckCues.filter((c) => c === null)).toHaveLength(1);
  });

  it('has one loading dock: a truck of 2 bed columns at its door, both 2 levels high (the upper level of the second «libre»), clear of the windows', () => {
    const trucks = storageOf(level).filter(isDoorUnit);
    expect(trucks.map((t) => t.skin)).toEqual(['truck']);
    const [truck] = trucks;
    expect(truck.columns).toHaveLength(2);
    expect(truck.columns.length).toBeLessThanOrEqual(STORAGE_SKINS.truck.maxColumns);
    // Every column holds min(2, limit) levels (docs/STORAGE.md rule 7): the second is written with one, its cue.
    expect(truck.columns.map((c) => c.length)).toEqual([STORAGE_SKINS.truck.maxLevels, STORAGE_SKINS.truck.maxLevels]);
    expect(Math.max(...truck.columns.map((c) => c.length))).toBeLessThanOrEqual(level.stackLimit!);
    expect(truck.columns.map((c) => c.map((cue) => cue === null))).toEqual([
      [false, false],
      [false, true],
    ]);
    const { wall } = truck.access;
    const along = (x: number, z: number) => (wall === 'north' ? x : z);
    for (const win of level.decor.windows) {
      if (win.wall !== wall) continue;
      for (const bed of beds) expect(along(bed.front.x, bed.front.z) < win.at || along(bed.front.x, bed.front.z) >= win.at + win.width).toBe(true);
    }
    // Each bed column is a position of the model off the map (a stack) of all its levels, asking for the destined kinds
    // of its levels with a cue, bottom → top (the «libre» one on top is parking).
    for (const bed of beds) {
      const pos = grid.posOf(bed.cell.x, bed.cell.z);
      expect(grid.kind[pos]).toBe(POS_STACK);
      expect(grid.capacity[pos]).toBe(bed.cues.length);
      expect(grid.steps[pos]).toHaveLength(bed.cues.filter((cue) => cue !== null).length);
    }
  });

  it('has two racks of 3 slots per column, one front toward the default camera and one back to it, a wooden shelf one cell past an end', () => {
    const fronts = storageOf(level).filter(isFrontUnit);
    // Loaded from the front: the two racks and the conveyor belt's input (docs/CONVEYOR.md: a slot on its table, at
    // level 1).
    expect(fronts.map((r) => r.skin)).toEqual(['rack', 'rack', 'beltIn']);
    const racks = fronts.filter((r) => r.skin === 'rack');
    for (const rack of racks) for (const column of rack.columns) expect(column).toHaveLength(3);
    // The default camera sits toward +x / +z: a front facing south or east looks at it, north or west turns its back.
    const toCamera = (facing: string) => facing === 'south' || facing === 'east';
    expect(racks.map((r) => toCamera(r.access.facing)).sort()).toEqual([false, true]);
    const shelfAt = (x: number, z: number) => level.shelves.some((s) => x >= s.x && x < s.x + s.w && z >= s.z && z < s.z + s.d);
    for (const rack of racks) {
      const along = runsAlongX(rack.access.facing) ? [1, 0] : [0, 1];
      const ends = [cellOf(rack, 0), cellOf(rack, rack.w - 1)];
      // The cell right past each end stays free so the end-panel cues show (docs/RACKS.md); the wooden shelf comes next.
      expect(shelfAt(ends[0].x - along[0], ends[0].z - along[1]), rack.id).toBe(false);
      expect(shelfAt(ends[1].x + along[0], ends[1].z + along[1]), rack.id).toBe(false);
      expect(shelfAt(ends[0].x - 2 * along[0], ends[0].z - 2 * along[1]) || shelfAt(ends[1].x + 2 * along[0], ends[1].z + 2 * along[1]), rack.id).toBe(true);
    }
  });

  it('the truck waits outside: its bed columns lie beyond the north wall, its door cells (row 0) are floor and start empty', () => {
    expect(storageOf(level).find(isDoorUnit)).toMatchObject({ skin: 'truck', access: { kind: 'door', wall: 'north' }, x: 1, z: 0, w: 2 });
    for (const bed of beds) {
      const door = bed.front;
      const at = `${door.x},${door.z}`;
      expect(bed.cell, at).toEqual({ x: door.x, z: -1 });
      expect(door.z, at).toBe(0);
      expect(grid.solid[cell(door)], at).toBe(0);
      // Nothing starts there: no zone (its locked box would close the column for good), no box, no forklift.
      expect(level.zones.some((z) => z.x === door.x && z.z === door.z), at).toBe(false);
      expect(level.boxes.some((b) => b.x === door.x && b.z === door.z), at).toBe(false);
      expect(level.forklift.x === door.x && level.forklift.z === door.z, at).toBe(false);
    }
    // The box loaded at the start rests on its bed cell, outside the map.
    const loaded = level.boxes.filter((b) => grid.kind[grid.posOf(b.x, b.z, b.level)] === POS_STACK);
    expect(loaded.map((b) => [b.x, b.z, b.level])).toEqual([[1, -1, 0]]);
    // A guard rail at each end of the door run, a plant behind each (docs/DOCKS.md): reached only from the row behind.
    expect(dockRailsOf(level).map((r) => r.side)).toEqual([
      { x: 0, z: 0 },
      { x: 3, z: 0 },
    ]);
    for (const { side } of dockRailsOf(level)) expect(level.decor.plants.some((pl) => pl.x === side.x && pl.z === side.z), `${side.x},${side.z}`).toBe(true);
  });

  it('has a short conveyor belt (docs/CONVEYOR.md): one floor cell, a table at level 1, from its «libre» input to an end exit only the belt loads, destined to one box', () => {
    expect(level.conveyors).toHaveLength(1);
    const [belt] = level.conveyors!;
    expect(belt.cells.map((c) => [c.x, c.z, c.piece, c.height])).toEqual([[8, 1, 'suelo', 1]]);
    const unitOf = (id: string) => storageOf(level).find((u) => u.id === id)!;
    const [input, output] = [unitOf(belt.input), unitOf(belt.output)];
    expect([input.skin, input.x, input.z, output.skin, output.x, output.z]).toEqual(['beltIn', 8, 2, 'beltOut', 8, 0]);
    expect(input.columns).toEqual([[null]]);
    expect(output.columns).toEqual([[{ color: 'coral', symbol: 'cross' }]]);
    // Both on the table: their slot at level 1, A's loaded like a rack's level-1 slot (F once).
    expect([input.baseLevel, output.baseLevel]).toEqual([1, 1]);
    // Its box is the one coral ✚; the end exit's position is fed by the input's: a box set down there rides in.
    const exit = grid.positionOfSlot(`${output.id}:0:1`);
    const entry = grid.positionOfSlot(`${input.id}:0:1`);
    expect([grid.feeds[entry], grid.fedBy[exit]]).toEqual([exit, entry]);
    const destinies = levelDestinies(level)!;
    expect(destinies.slots[slots.findIndex((s) => s.unit.id === output.id)]).toMatchObject({ color: 'coral', symbol: 'cross' });
    expect(level.boxes.filter((b) => b.color === 'coral' && b.symbol === 'cross')).toHaveLength(1);
    // The shortest plan sends it down the belt in one move (the ride counts none) and never picks from the end exit.
    const plan = shortestPlan().plan!;
    expect(plan.filter((m) => m.drop === exit)).toHaveLength(1);
    expect(plan.some((m) => m.from === exit || m.drop === entry)).toBe(false);
    let stacks = stacksOf(grid, level);
    for (const m of plan) {
      expect(canLift(grid, stacks, exit)).toBe(false);
      const next = lift(stacks, m.from);
      next[m.drop] += stacks[m.from].slice(-1);
      stacks = next;
    }
    expect(stacks[exit].length).toBe(1);
  });

  it('every column can be loaded: its front (door) cell and the cell behind it are floor, and no zone stands there', () => {
    // The conveyor belt's end exit is the one column the forklift never loads (docs/CONVEYOR.md): its belt brings its
    // box in, from the belt's last cell, right in front of it.
    const [belt] = level.conveyors!;
    const exits = storageColumnsOf(level).filter((c) => c.unit.access.kind === 'belt');
    expect(exits.map((c) => [c.unit.id, c.front.x, c.front.z])).toEqual([[belt.output, belt.cells.at(-1)!.x, belt.cells.at(-1)!.z]]);
    const loadable = storageColumnsOf(level).filter((c) => c.unit.access.kind !== 'belt');
    const columns = loadable.map((c) => ({ id: `${c.unit.id}:${c.column}`, front: c.front, facing: c.facing }));
    // The racks' 4 columns, the belt's input, the truck's bed columns.
    expect(columns).toHaveLength(4 + 1 + beds.length);
    for (const { id, front, facing } of columns) {
      const behind = { x: front.x + FACING_X[facing], z: front.z + FACING_Z[facing] };
      for (const c of [front, behind]) {
        expect(c.x >= 0 && c.z >= 0 && c.x < grid.width && c.z < grid.depth, id).toBe(true);
        expect(grid.solid[cell(c)], `${id} at ${c.x},${c.z}`).toBe(0);
        // A box locked on a zone there would close the column for good (the model loads it by one step from behind).
        expect(level.zones.some((z) => z.x === c.x && z.z === c.z), `${id}: zone at ${c.x},${c.z}`).toBe(false);
      }
    }
  });

  it('has exactly one complete assignment, reachable by deduction alone (the chain its nota: lines write)', () => {
    const targets = targetsOf(level);
    const boxes = level.boxes.map(sortableOf);
    expect(boxes).toHaveLength(targets.length);
    expect(assignmentsOf(boxes, targets.map((t) => t.criteria), 2).count).toBe(1);
    // Naked singles, like a sudoku: a target only one kind of the boxes left fits, or a kind of box that fits as many
    // open targets as it has boxes. Each step is forced; the chain places every box.
    const left = boxes.slice();
    const open = new Set(targets.map((_, i) => i));
    const got = new Array<Sortable | null>(targets.length).fill(null);
    const chain: string[] = [];
    const take = (t: number, kind: Sortable) => {
      got[t] = kind;
      open.delete(t);
      left.splice(left.findIndex((b) => sameKind(b, kind)), 1);
      chain.push(`${targets[t].id} ← ${kindText(kind)}`);
    };
    while (open.size > 0) {
      const before = open.size;
      for (const t of [...open]) {
        const fits = left.filter((b) => meets(targets[t].criteria, b));
        if (fits.length > 0 && fits.every((b) => sameKind(b, fits[0]))) take(t, fits[0]);
      }
      for (const kind of left.filter((b, i) => left.findIndex((o) => sameKind(o, b)) === i)) {
        const places = [...open].filter((t) => meets(targets[t].criteria, kind));
        if (places.length > 0 && places.length === left.filter((b) => sameKind(b, kind)).length) for (const t of places) take(t, kind);
      }
      expect(open.size, `stuck after ${chain.join(', ')}`).toBeLessThan(before);
    }
    const destinies = levelDestinies(level)!;
    const destinyOf = (t: (typeof targets)[number]) =>
      t.kind === 'zone' ? destinies.zones[t.index] : destinies.slots[t.index]!;
    targets.forEach((t, i) => expect(sameKind(got[i]!, destinyOf(t)), t.id).toBe(true));
    // Every truck level with a cue is a target; the «libre» one never.
    const truckSlots = slots.filter((s) => s.unit.skin === 'truck');
    expect(targets.filter((t) => t.skin === 'truck')).toHaveLength(truckSlots.filter((s) => s.cue !== null).length);
    expect(truckSlots).toHaveLength(4);
    // The deduction is written down for whoever designs or tests with it.
    expect(source.notes.join('\n')).toMatch(/deducción/i);
    expect(source.notes.length).toBeGreaterThanOrEqual(4);
  });

  it('starts with a trap, a box in a wrong slot, a box parked high, a floor stack, a box deep in a 1-cell corridor and a wrong truck load', () => {
    const destinies = levelDestinies(level)!;
    const slotOf = (b: LevelData['boxes'][number]) => slots.findIndex((s) => s.cell.x === b.x && s.cell.z === b.z && s.level === b.level);
    const racked = level.boxes
      .filter(isStored)
      .map((b) => ({ box: sortableOf(b), slot: slotOf(b) }))
      .filter(({ slot }) => slots[slot].unit.skin === 'rack');
    const cue = (i: number) => slots[i].cue;
    // Trap: fits its slot's cue but is not the destined box (the slot stays dark).
    expect(racked.some(({ box, slot }) => cue(slot) !== null && meets(cue(slot)!, box) && !sameKind(destinies.slots[slot]!, box))).toBe(true);
    // Wrong slot: a cue it does not fit.
    expect(racked.some(({ box, slot }) => cue(slot) !== null && !meets(cue(slot)!, box))).toBe(true);
    // Parked at height, in a «libre» slot.
    expect(racked.some(({ slot }) => cue(slot) === null && slots[slot].level > 0)).toBe(true);
    // A floor stack to undo.
    const floor = level.boxes.filter((b) => !isStored(b));
    expect(floor.some((b, i) => floor.findIndex((o) => o.x === b.x && o.z === b.z) !== i)).toBe(true);
    // A box on the deepest cell of a dead-end corridor one cell wide.
    const corridors = deadEndCorridors(grid);
    const deep = floor.find((b) => corridors.some((c) => c[0] === cell(b) && c.length >= 2));
    expect(deep).toBeDefined();
    // Loaded on the truck at the start, on a level that is not its destiny: its destiny is the level above it, in the
    // same column (it has to come off, and back on top of the locked box that goes under it).
    const loaded = level.boxes.filter((b) => grid.kind[grid.posOf(b.x, b.z, b.level)] === POS_STACK);
    expect(loaded).toHaveLength(1);
    const [box] = loaded;
    const ref = slotOf(box);
    expect(sameKind(destinies.slots[ref]!, sortableOf(box))).toBe(false);
    expect(sameKind(destinies.slots[ref + 1]!, sortableOf(box))).toBe(true);
  });

  it('the corridor box only comes out in reverse: without the reverse gear it cannot be carried anywhere', () => {
    const corridors = deadEndCorridors(grid);
    const deep = level.boxes.find((b) => !isStored(b) && corridors.some((c) => c[0] === cell(b)))!;
    const from = cell(deep);
    const drops = (g: LevelGrid) => {
      const stacks = stacksOf(g, level);
      const occupancy = occupancyOf(g, stacks);
      const region = reachableFrom(g, occupancy, cell(level.forklift));
      occupancy[from] = -1;
      return [...carrySearch(g, occupancy, lift(stacks, from), pickupStarts(g, region, from)).drops.keys()].filter((d) => d !== from);
    };
    expect(drops(new LevelGrid(level, { reverse: false }))).toEqual([]);
    expect(drops(grid).length).toBeGreaterThan(10);
  });

  it('no zone, floor box or the forklift starts hidden from the default camera behind a shelf, rack, plant or stack', () => {
    // As levels.test.ts hiddenItems: the cells east, south and south-east of an item stand between it and the camera.
    // (The front cells of the rack that turns its back to the camera are hidden on purpose: read it or turn Q / E.)
    const stacks = stacksOf(grid, level);
    const blocks = (x: number, z: number) => x < grid.width && z < grid.depth && (grid.solid[grid.index(x, z)] === 1 || stacks[grid.index(x, z)].length >= 2);
    const hidden = [...level.zones, ...level.boxes.filter((b) => !isStored(b)), { id: 'forklift', ...level.forklift }].filter((item) =>
      [
        [1, 0],
        [0, 1],
        [1, 1],
      ].some(([dx, dz]) => blocks(item.x + dx, item.z + dz)),
    );
    expect(hidden.map((i) => i.id)).toEqual([]);
  });

  it('the solver finds a shortest plan (exact) that replays; the greedy search solves it too, but only with parking', () => {
    const result = shortestPlan();
    expect(result).toMatchObject({ exact: true, unsolvable: false });
    expect(result.plan!.length).toBe(result.lower);
    expect(replayMoves(level, result.plan!)).toBe(true);
    // Some move lifts a box out of a slot and some drops one into a slot above the bottom one.
    expect(result.plan!.some((m) => grid.kind[m.from] === POS_SHELF)).toBe(true);
    expect(result.plan!.some((m) => grid.kind[m.drop] === POS_SHELF && grid.levelAt(m.drop) > 0)).toBe(true);
    // The truck: its wrong load comes off, and a box is loaded on top of the locked one at the bottom.
    expect(result.plan!.some((m) => grid.kind[m.from] === POS_STACK)).toBe(true);
    let stacks = stacksOf(grid, level);
    let onTop = false;
    for (const m of result.plan!) {
      const next = lift(stacks, m.from);
      if (grid.kind[m.drop] === POS_STACK && next[m.drop].length > 0 && lockedAt(grid, next, m.drop)) onTop = true;
      next[m.drop] += stacks[m.from].slice(-1);
      stacks = next;
    }
    expect(onTop).toBe(true);
    expect(solve(level, { allowParking: true, maxExpansions: 2000 }).solved).toBe(true);
    // The two mint boxes swap places in their column: one of them has to be parked (a «libre» slot or the floor).
    expect(solve(level, { allowParking: false, maxExpansions: 2000 }).solved).toBe(false);
  });

  // The heaviest check of the suite (≈ 15 s alone, more while the other files run): its own timeout.
  it('no dead ends («callejones» = 0): every slip along a shortest plan can be undone, or still finishes', { timeout: 90_000 }, () => {
    const plan = shortestPlan().plan!;
    // As far as the report looks (npm run levels), the states of the plan first: none of them, and no destiny filled
    // early, walls anything off.
    const result = deadEnds(level, { plan, maxStates: DEAD_END_STATES });
    expect(DEAD_END_STATES).toBeGreaterThan(plan.length + 1);
    expect(result).toMatchObject({ found: 0, unknown: 0, explored: DEAD_END_STATES });
    // A box put on its destiny locks there (docs/RACKS.md): such a move cannot be undone, so it gets the full check.
    expect(result.deepChecks).toBeGreaterThan(0);
    expect(result.checked).toBeGreaterThan(result.explored);
  });

  it('with the lock the shortest plan never lifts a box off its destiny: 15 moves, each box placed once and for good', () => {
    const plan = shortestPlan().plan!;
    // 13 boxes + the mint swap's park + the wrong truck load's park.
    expect(level.boxes).toHaveLength(13);
    expect(plan).toHaveLength(15);
    let stacks = stacksOf(grid, level);
    for (const move of plan) {
      expect(lockedAt(grid, stacks, move.from), `move from ${move.from}`).toBe(false);
      const next = lift(stacks, move.from);
      next[move.drop] += stacks[move.from].slice(-1);
      stacks = next;
    }
    // Every target ends full and locked: 3 zones + 6 slots with a cue + the belt's end exit (one box each) and the
    // truck's 2 bed columns (one box per level).
    const targets = stacks.map((stack, pos) => ({ stack, steps: grid.steps[pos] })).filter((t) => t.steps !== null);
    expect(targets).toHaveLength(10 + beds.length);
    expect(targets.every((t) => t.stack.length === t.steps!.length)).toBe(true);
    expect(stacks.every((_, pos) => grid.steps[pos] === null || lockedAt(grid, stacks, pos))).toBe(true);
  });

  it('metrics: repartos 1, huecos 12 (6 with a cue, 6 «libre»), camion 4 (3 with a cue, 1 «libre»), cinta 1 (1 floor cell), traps; its «dificultad:» targets all hold', () => {
    const m = levelMetrics(level, { skipMoves: true });
    expect(m.sortings).toBe(1);
    expect(m.slots).toEqual({ total: 12, cued: 6, free: 6 });
    expect(m.trucks).toEqual({ trucks: 1, columns: 2, levels: 4, cued: 3, free: 1, loaded: 1 });
    expect(m.belts).toEqual({ belts: 1, cells: 1, floor: 1, exits: 1, cued: 1 });
    expect(m.traps).toBeGreaterThan(0);
    expect(source.targets.map((t) => t.metric)).toEqual(expect.arrayContaining(['movimientos', 'repartos', 'huecos', 'camion', 'cinta', 'trampas', 'libre']));
    const failed = checkLevelTargets(level, source.targets).filter((c) => !c.ok);
    expect(failed.map((c) => `${formatTarget(c.target)}: medido ${formatRange(c.range)}`)).toEqual([]);
  });
});
