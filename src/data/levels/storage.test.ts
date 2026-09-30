import { describe, expect, it } from 'vitest';
import { storageColumnsOf, storageSlotsOf } from '../../core/storage';
import { levelDestinies } from '../../core/sorting';
import { THREE_TRUCKS } from '../../integration/storageCharacterization';
import { parseLevel } from '../asciiLevel';
import { levelMetrics } from './metrics';
import { levelsReport } from './report';
import {
  DIR_X,
  DIR_Z,
  LevelGrid,
  POS_FLOOR,
  POS_SHELF,
  POS_STACK,
  boxCode,
  canLift,
  canStackOn,
  carrySearch,
  deadEnds,
  lift,
  lockedAt,
  minMoves,
  occupancyOf,
  pickupStarts,
  reachableFrom,
  replayMoves,
  stacksOf,
  type Stacks,
} from './solver';

/*
 * One storage model in the solver (docs/STORAGE.md): every storage column of every skin gets its positions after the
 * floor cells, unit by unit (rule 12), by its unit's support — shelves one position per level (capacity 1), a stack one
 * per column (capacity all its levels, the «libre» ones too; steps only its levels with a cue, rule 7) — with one set
 * of per-position arrays (kind, capacity, front cell, inward direction, steps) and one pose table. The lock and the
 * drops go by support, the way in and out by access (the column's front cell), never by skin.
 */

const level = (text: string) => parseLevel(`${text.trim()}\n`, 'prueba.level').level;
const DIR = { E: 0, S: 1, W: 2, N: 3 } as const;
const kind = (color: 'blue' | 'mint' | 'coral', symbol: 'square' | 'triangle' | 'circle' | 'diamond') => boxCode({ color, symbol });

/**
 * Shelves and stacks in one level: a rack of 2 levels (a cue below, «libre» on top, where the coral ◆ starts parked)
 * and a north truck of two columns: the first starts with its destined azul ■ (locked) and takes the ▲ on top of it; the
 * second starts with the menta ▲ loaded by mistake on the «menta ●» level, a «libre» level above it (implicit: `limit:
 * 2`). Unique assignment: azul → azul ■, ▲ → menta ▲, menta ● → menta ●, coral ◆ → coral ◆.
 */
const MIXED = level(`
# 1 · Mixto
id: mixto
limit: 2

  0123456
0 pTTp.R.
1 .......
2 .......
3 ..a....
4 ....^..

a = caja menta ●
R = estantería frente sur: coral ◆ / libre + caja coral ◆
T = camión muelle norte: azul + caja azul ■ / ▲ | menta ● + caja menta ▲
`);

describe('the position table (docs/STORAGE.md: one model for every skin)', () => {
  it('the three-truck fixture: its columns in storage order after the cells, shelves one position per level, stacks one per column', () => {
    const fixture = THREE_TRUCKS.level;
    const grid = new LevelGrid(fixture);
    // The columns of core/storage, in its order (racks, then trucks: rule 12), with their support and positions.
    expect(grid.columns.map((c) => c.ref)).toEqual(storageColumnsOf(fixture));
    expect(grid.columns.map((c) => [`${c.ref.unit.id}:${c.ref.column}`, c.support, c.positions.length])).toEqual([
      ['r1:0', 'shelves', 2],
      ['r2:0', 'shelves', 3],
      ['t1:0', 'stack', 1],
      ['t1:1', 'stack', 1],
      ['t2:0', 'stack', 1],
      ['t3:0', 'stack', 1],
    ]);
    // One run of positions right after the cells, column after column.
    const positions = grid.columns.flatMap((c) => c.positions);
    expect(positions).toEqual(Array.from({ length: 9 }, (_, i) => grid.cellCount + i));
    expect(grid.posCount).toBe(grid.cellCount + 9);
    expect([...grid.kind.slice(grid.cellCount)]).toEqual([POS_SHELF, POS_SHELF, POS_SHELF, POS_SHELF, POS_SHELF, POS_STACK, POS_STACK, POS_STACK, POS_STACK]);
    // Capacity: 1 per shelf; a stack its levels (never the level's stack limit), its implicit «libre» ones too (T's second
    // column and C are written with one level: with `limit: 2` they hold two); a floor cell the stack limit.
    expect([...grid.capacity.slice(grid.cellCount)]).toEqual([1, 1, 1, 1, 1, 2, 2, 2, 2]);
    expect(grid.capacity[0]).toBe(fixture.stackLimit);
    expect(grid.kind[0]).toBe(POS_FLOOR);
    grid.columns.forEach(({ ref, positions: own }, c) => {
      const id = `${ref.unit.id}:${ref.column}`;
      const front = grid.index(ref.front.x, ref.front.z);
      for (const pos of own) {
        // Loaded from its front cell (a rack's front cell, a truck's door cell), facing into its cell.
        expect(grid.front[pos], id).toBe(front);
        expect([ref.front.x + DIR_X[grid.inward[pos]], ref.front.z + DIR_Z[grid.inward[pos]]], id).toEqual([ref.cell.x, ref.cell.z]);
        expect(grid.columnOfPos(pos), id).toBe(grid.columns[c]);
        expect(grid.cellOfPos(pos), id).toEqual(ref.cell);
        expect(grid.accessOf(pos), id).toBe(front);
      }
      // The one pose that loads it; its cell solid inside the map (a rack), off the map beyond a wall (a truck).
      expect(grid.columnAtPose[front * 4 + grid.inward[own[0]]], id).toBe(c);
      const inside = grid.inMap(ref.cell.x, ref.cell.z);
      expect(inside, id).toBe(ref.unit.skin === 'rack');
      if (inside) expect(grid.solid[grid.index(ref.cell.x, ref.cell.z)], id).toBe(1);
      expect(grid.solid[front], id).toBe(0);
    });
    expect([...grid.columnAtPose].filter((c) => c >= 0)).toHaveLength(grid.columns.length);
    // Every storage slot ↔ its position and level, and its destiny read by its index (LevelDestinies.slots).
    const destinies = levelDestinies(fixture)!.slots;
    storageSlotsOf(fixture).forEach((slot, i) => {
      const pos = grid.positionOfSlot(slot.id);
      expect(grid.isStorage(pos), slot.id).toBe(true);
      expect(grid.slotAt(pos, slot.level), slot.id).toBe(i);
      expect(grid.levelAt(pos, slot.level), slot.id).toBe(slot.level);
      const step = grid.kind[pos] === POS_SHELF ? grid.steps[pos]?.[0] : grid.steps[pos]![slot.level];
      expect(step ?? null, slot.id).toEqual(destinies[i]);
    });
    expect(grid.positionOfSlot('r9:0:0')).toBe(-1);
    // A box stored at the start: its position by its cell and level (a stack column whatever the level).
    for (const b of fixture.boxes.filter((box) => box.level !== undefined)) {
      const slot = storageSlotsOf(fixture).find((s) => s.cell.x === b.x && s.cell.z === b.z && s.level === b.level)!;
      expect(grid.posOf(b.x, b.z, b.level), b.id).toBe(grid.positionOfSlot(slot.id));
    }
  });

  it('a mixed level: its rack shelves, then its truck columns; the start stacks by support', () => {
    const grid = new LevelGrid(MIXED);
    const [shelf0, shelf1, stack0, stack1] = [0, 1, 2, 3].map((i) => grid.cellCount + i);
    expect(grid.columns.map((c) => [c.ref.unit.id, c.support, c.positions])).toEqual([
      ['r1', 'shelves', [shelf0, shelf1]],
      ['t1', 'stack', [stack0]],
      ['t1', 'stack', [stack1]],
    ]);
    expect([...grid.capacity.slice(grid.cellCount)]).toEqual([1, 1, 2, 2]);
    // Steps: a shelf its level's destiny (the «libre» one, none); a stack every level's with a cue, bottom → top (the
    // second column's «libre» level on top has none: parking).
    expect(grid.steps.slice(grid.cellCount)).toEqual([
      [{ color: 'coral', symbol: 'diamond' }],
      null,
      [
        { color: 'blue', symbol: 'square' },
        { color: 'mint', symbol: 'triangle' },
      ],
      [{ color: 'mint', symbol: 'circle' }],
    ]);
    const stacks = stacksOf(grid, MIXED);
    expect(stacks.slice(grid.cellCount)).toEqual(['', kind('coral', 'diamond'), kind('blue', 'square'), kind('mint', 'triangle')]);
    expect(stacks[grid.index(2, 3)]).toBe(kind('mint', 'circle'));
    // The rack cell is solid; the truck's door cells are floor.
    expect([grid.solid[grid.index(5, 0)], grid.solid[grid.index(1, 0)], grid.solid[grid.index(2, 0)]]).toEqual([1, 0, 0]);
  });
});

describe('lock and drop rules by support', () => {
  const grid = new LevelGrid(MIXED);
  const [shelf0, shelf1, stack0, stack1] = [0, 1, 2, 3].map((i) => grid.cellCount + i);
  const start = stacksOf(grid, MIXED);
  const blue = kind('blue', 'square');
  const tri = kind('mint', 'triangle');
  const circle = kind('mint', 'circle');
  const coral = kind('coral', 'diamond');
  const at = (changes: Record<number, string>): Stacks => {
    const out = start.slice();
    for (const [pos, stack] of Object.entries(changes)) out[Number(pos)] = stack;
    return out;
  };
  /** The drops of the floor box on (2,3), carried from the forklift's start (every other box where `stacks` has it). */
  const floorDrops = (stacks: Stacks) => {
    const from = grid.index(2, 3);
    const occupancy = occupancyOf(grid, stacks);
    const region = reachableFrom(grid, occupancy, grid.index(4, 4));
    occupancy[from] = -1;
    return carrySearch(grid, occupancy, lift(stacks, from), pickupStarts(grid, region, from)).drops;
  };

  it('shelves: the destined box alone locks its shelf; a «libre» shelf or a wrong box never locks; a shelf holds one box', () => {
    // Parked on the «libre» top shelf: free to lift.
    expect([lockedAt(grid, start, shelf1), canLift(grid, start, shelf1)]).toEqual([false, true]);
    // Its destiny, the shelf below: locked there, never lifted, never a drop again.
    const home = at({ [shelf0]: coral, [shelf1]: '' });
    expect([lockedAt(grid, home, shelf0), canLift(grid, home, shelf0), canStackOn(grid, home, shelf0)]).toEqual([true, false, false]);
    // A wrong box on the cued shelf: not locked (it fits nothing there).
    expect(lockedAt(grid, at({ [shelf0]: circle }), shelf0)).toBe(false);
    // Carrying a box: the empty shelves are drops, an occupied one never (a shelf holds one box).
    expect(floorDrops(start).has(shelf0)).toBe(true);
    expect(floorDrops(start).has(shelf1)).toBe(false);
    expect(floorDrops(home).has(shelf0)).toBe(false);
    expect(floorDrops(home).has(shelf1)).toBe(true);
  });

  it('stacks: a satisfied level locks (its correct prefix), a wrong top or a wrong base never; the next level still loads on a locked box', () => {
    // The azul ■ on its bed: satisfied, locked, never lifted…
    expect([lockedAt(grid, start, stack0), canLift(grid, start, stack0)]).toEqual([true, false]);
    // …but the column still takes its next level on top of it; the wrong load of the other column is liftable.
    expect(floorDrops(start).has(stack0)).toBe(true);
    expect([lockedAt(grid, start, stack1), canLift(grid, start, stack1)]).toEqual([false, true]);
    // Both levels satisfied: the top one locks too, and the full column is no drop.
    const done = at({ [stack0]: blue + tri });
    expect([lockedAt(grid, done, stack0), canLift(grid, done, stack0), floorDrops(done).has(stack0)]).toEqual([true, false, false]);
    // A wrong box on a satisfied level: liftable; a right box on a wrong base: not locked either.
    expect([lockedAt(grid, at({ [stack0]: blue + coral }), stack0), canLift(grid, at({ [stack0]: blue + coral }), stack0)]).toEqual([false, true]);
    expect(lockedAt(grid, at({ [stack0]: tri + blue }), stack0)).toBe(false);
    // The second column: its «libre» level over the wrong load takes a box (parking: never locked, the top liftable,
    // both boxes still to move); then it is full.
    expect(floorDrops(start).has(stack1)).toBe(true);
    const parked = at({ [stack1]: tri + circle });
    expect([lockedAt(grid, parked, stack1), canLift(grid, parked, stack1), floorDrops(parked).has(stack1)]).toEqual([false, true, false]);
    // Over its right box, a box parked on the «libre» level is never locked either: it lifts, the one below stays.
    const onTop = at({ [stack1]: circle + coral });
    expect([lockedAt(grid, onTop, stack1), canLift(grid, onTop, stack1), lockedAt(grid, lift(onTop, stack1), stack1)]).toEqual([false, true, true]);
    expect(floorDrops(at({ [stack1]: '' })).has(stack1)).toBe(true);
  });
});

describe('the way in and out: the column front, straight in, straight back out', () => {
  const grid = new LevelGrid(MIXED);
  const [shelf0, shelf1, stack0, stack1] = [0, 1, 2, 3].map((i) => grid.cellCount + i);
  const stacks = stacksOf(grid, MIXED);
  const occupancy = occupancyOf(grid, stacks);
  const region = reachableFrom(grid, occupancy, grid.index(4, 4));

  it('a box lifted out of storage only backs straight out (a shelf and a stack alike); forward-only, nowhere', () => {
    for (const [from, front] of [
      [shelf1, grid.index(5, 1)],
      [stack1, grid.index(2, 0)],
    ] as const) {
      const starts = pickupStarts(grid, region, from);
      expect(starts).toEqual([front * 4 + DIR.N]);
      const search = carrySearch(grid, occupancy, lift(stacks, from), starts);
      expect(search.drops.size).toBeGreaterThan(5);
      for (const drop of search.drops.keys()) {
        const chain = search.chain(drop)!;
        // Out backwards first: the start pose, then the cell behind the front, still facing in.
        expect(chain.slice(0, 2), `${from} → ${drop}`).toEqual([front * 4 + DIR.N, (front + grid.width) * 4 + DIR.N]);
      }
      expect(carrySearch(new LevelGrid(MIXED, { reverse: false }), occupancy, lift(stacks, from), starts).drops.size).toBe(0);
    }
  });

  it('storage is loaded only by one step on from behind its column front, facing in: never by a turn, never from the side', () => {
    const from = grid.index(2, 3);
    const lifted = lift(stacks, from);
    const occ = occupancy.slice();
    occ[from] = -1;
    const search = carrySearch(grid, occ, lifted, pickupStarts(grid, region, from));
    const into = [...search.drops.keys()].filter((d) => grid.isStorage(d)).sort((a, b) => a - b);
    expect(into).toEqual([shelf0, stack0, stack1]);
    for (const drop of into) {
      const front = grid.front[drop];
      const inward = grid.inward[drop];
      // The chain ends stepping onto the front cell facing in, from the cell behind it; the forklift ends there.
      const chain = search.chain(drop)!;
      expect(chain.slice(-2)).toEqual([grid.step(front, (inward + 2) % 4) * 4 + inward, front * 4 + inward]);
      expect(search.drops.get(drop)!.every((cell) => cell === front)).toBe(true);
      expect(search.chainTo(drop, front)!.at(-1)).toBe(front * 4 + inward);
      expect(search.chainTo(drop, grid.step(front, (inward + 2) % 4))).toBeUndefined();
    }
    // Beside the rack (its side cell, facing its cell) or beside a door: no pose loads a column.
    expect(grid.columnAtPose[grid.index(4, 0) * 4 + DIR.E]).toBe(-1);
    expect(grid.columnAtPose[grid.index(6, 0) * 4 + DIR.W]).toBe(-1);
    expect(grid.columnAtPose[grid.index(1, 0) * 4 + DIR.E]).toBe(-1);
    expect(grid.columnAtPose[grid.index(5, 1) * 4 + DIR.N]).toBe(0);
    expect(grid.columnAtPose[grid.index(1, 0) * 4 + DIR.N]).toBe(1);
    expect(grid.columnAtPose[grid.index(2, 0) * 4 + DIR.N]).toBe(2);
  });

  it('the searches: 3 moves (exact), each box straight to its destiny, the locked one never; the plan replays; no dead ends around it', () => {
    const result = minMoves(MIXED);
    expect(result).toMatchObject({ exact: true, lower: 3, upper: 3, unsolvable: false });
    expect(replayMoves(MIXED, result.plan!)).toBe(true);
    expect(replayMoves(MIXED, result.plan!.slice(0, -1))).toBe(false);
    const byNumber = (a: number, b: number) => a - b;
    expect(result.plan!.map((m) => m.from).sort(byNumber)).toEqual([grid.index(2, 3), shelf1, stack1]);
    expect(result.plan!.map((m) => m.drop).sort(byNumber)).toEqual([shelf0, stack0, stack1]);
    // The wrong load comes off before its column takes the menta ●.
    const plan = result.plan!;
    expect(plan.findIndex((m) => m.from === stack1)).toBeLessThan(plan.findIndex((m) => m.drop === stack1));
    const dead = deadEnds(MIXED, { plan, maxStates: plan.length + 1 });
    expect(dead).toMatchObject({ found: 0, unknown: 0, explored: plan.length + 1 });
    // Each of those moves locks its box on its destiny: no simple undo, so each got the full check.
    expect(dead.deepChecks).toBeGreaterThan(0);
  });
});

describe('metrics and report by skin, counted the same way', () => {
  it('huecos and camion from one count per skin; the plan names each unit by its skin word and its letter', () => {
    const m = levelMetrics(MIXED, { skipMoves: true });
    expect(m.slots).toEqual({ total: 2, cued: 1, free: 1 });
    expect(m.trucks).toEqual({ trucks: 1, columns: 2, levels: 4, cued: 3, free: 1, loaded: 2 });
    expect(m.sortings).toBe(1);
    expect(m.mustMove).toBe(3);
    const source = { file: 'x.level', format: 'level' as const, level: MIXED, targets: [], notes: [] };
    const report = levelsReport([source], ['mixto'], { deadEndStates: 5 });
    for (const part of [
      'caja coral ◆ (5,0), hueco 2 de R → hueco 1 de R (5,0)',
      'caja menta ▲ (2,0), camión T, nivel 1 → camión T (1,0), nivel 2',
      'caja menta ● (2,3) → camión T (2,0), nivel 1',
      'huecos       2 (1 con pista, 1 libre)',
      'camion       4 (3 con pista, 1 libre; 2 columnas, 1 camión; 2 cargados al empezar)',
    ])
      expect(report).toContain(part);
  });
});
