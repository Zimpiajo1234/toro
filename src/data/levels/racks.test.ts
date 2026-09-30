import { describe, expect, it } from 'vitest';
import { parseLevel } from '../asciiLevel';
import { parseTargets } from '../difficulty';
import { checkLevelTargets, checkTargets, levelMetrics, metricRange } from './metrics';
import { levelsReport } from './report';
import {
  LevelGrid,
  POS_SHELF,
  boxCode,
  canLift,
  canStackOn,
  carrySearch,
  deadEnds,
  lift,
  lockedAt,
  minMoves,
  misplacedCount,
  movesLowerBounds,
  occupancyOf,
  pickupStarts,
  reachableFrom,
  replayMoves,
  solve,
  stacksOf,
} from './solver';

/*
 * The grid model with storage racks (docs/RACKS.md): slots are positions after the floor cells, loaded only from the
 * front, a box lifted out of a slot backs straight out, every target asks for its destined kind.
 */

const level = (text: string) => parseLevel(`${text.trim()}\n`, 'prueba.level').level;
const DIR = { E: 0, S: 1, W: 2, N: 3 } as const;

/** One box in the «libre» top slot; its destiny is the blue slot right below it. */
const UP_DOWN = level(`
# 1 · Abajo
id: abajo
limit: 1

  0123456
0 ...R...
1 .......
2 .......
3 ...^...

R = estantería frente sur: azul / libre + caja azul
`);

/**
 * A two-column rack facing west with symbol cues, a floor zone and a box that starts in a slot it does not belong to
 * (blue ● in the ▲ slot); mint ▲ fits the ▲ slot's cue too, but its destiny is the exact «menta ▲» slot.
 */
const COLUMNS = level(`
# 2 · Dos columnas
id: dos-columnas
limit: 1

  01234567
0 ........
1 ......R.
2 ......R.
3 .1......
4 ..a.b...
5 ....^...
6 ...c....

1 = zona ■
a = caja azul ▲        b = caja menta ▲       c = caja amarillo ■
R = estantería frente oeste: azul ● / ▲ + caja azul ● | menta ▲ / libre
`);

/** Two boxes swapped in one column (a «libre» slot on top to park one) and a floor stack to undo onto two zones. */
const SWAP = level(`
# 3 · Cambio
id: cambio
limit: 3

  012345678
0 ....R....
1 .........
2 .1.......
3 .........
4 .a...2...
5 .........
6 ....^....

1 = zona coral            2 = zona lavanda
a = pila lavanda,coral
R = estantería frente sur: menta + caja azul / azul + caja menta / libre
`);

const LEVELS = [UP_DOWN, COLUMNS, SWAP];

describe('grid model with racks', () => {
  it('rack cells are solid; slots are positions after the cells, each asking for its destined kind', () => {
    const grid = new LevelGrid(COLUMNS);
    expect(grid.targets).toBe(true);
    expect(grid.sorting).toBe(false); // destinies are fixed: no trap bookkeeping
    // Support `shelves`: one position per slot, one box each.
    expect(grid.columns.map((c) => [c.support, c.positions])).toEqual([
      ['shelves', [grid.cellCount, grid.cellCount + 1]],
      ['shelves', [grid.cellCount + 2, grid.cellCount + 3]],
    ]);
    expect(grid.posCount).toBe(grid.cellCount + 4);
    expect([...grid.kind.slice(grid.cellCount)]).toEqual([POS_SHELF, POS_SHELF, POS_SHELF, POS_SHELF]);
    expect([...grid.capacity.slice(grid.cellCount)]).toEqual([1, 1, 1, 1]);
    expect(grid.solid[grid.index(6, 1)]).toBe(1);
    expect(grid.solid[grid.index(6, 2)]).toBe(1);
    expect(grid.posOf(6, 1, 1)).toBe(grid.cellCount + 1);
    expect(grid.posOf(6, 2, 0)).toBe(grid.cellCount + 2);
    expect(grid.posOf(2, 4)).toBe(grid.index(2, 4));
    expect(grid.accessOf(grid.cellCount + 2)).toBe(grid.index(5, 2));
    expect(grid.inward[grid.cellCount]).toBe(DIR.E); // into a rack facing west
    // Destinies as exact criteria; the «libre» slot is not a target.
    expect(grid.steps[grid.cellCount + 0]).toEqual([{ color: 'blue', symbol: 'circle' }]);
    expect(grid.steps[grid.cellCount + 1]).toEqual([{ color: 'blue', symbol: 'triangle' }]);
    expect(grid.steps[grid.cellCount + 3]).toBeNull();
    expect(grid.steps[grid.index(1, 3)]).toEqual([{ color: 'yellow', symbol: 'square' }]);
    const stacks = stacksOf(grid, COLUMNS);
    expect(stacks).toHaveLength(grid.posCount);
    expect(stacks[grid.cellCount + 1]).toBe(boxCode({ color: 'blue', symbol: 'circle' }));
    expect(stacks[grid.index(6, 1)]).toBe('');
    expect(misplacedCount(grid, stacks, COLUMNS.boxes.length)).toBe(4);
  });

  it('a box lifted out of a slot can only back straight out; the slot is loaded by one step on from behind its front', () => {
    const grid = new LevelGrid(UP_DOWN);
    const stacks = stacksOf(grid, UP_DOWN);
    const occupancy = occupancyOf(grid, stacks);
    const region = reachableFrom(grid, occupancy, grid.index(3, 3));
    const top = grid.cellCount + 1;
    const bottom = grid.cellCount;
    const starts = pickupStarts(grid, region, top);
    expect(starts).toEqual([grid.index(3, 1) * 4 + DIR.N]);
    const search = carrySearch(grid, occupancy, lift(stacks, top), starts);
    // No drop on the rack cell itself; the bottom slot is reachable, the floor too.
    expect(search.drops.has(grid.index(3, 0))).toBe(false);
    expect(search.drops.has(bottom)).toBe(true);
    expect(search.drops.has(grid.index(3, 2))).toBe(true);
    // Out backwards, then one step on puts it in the bottom slot, the forklift ending on the front cell.
    expect(search.chainTo(bottom, grid.index(3, 1))).toEqual([grid.index(3, 1) * 4 + DIR.N, grid.index(3, 2) * 4 + DIR.N, grid.index(3, 1) * 4 + DIR.N]);
    expect(search.drops.get(bottom)).toEqual([grid.index(3, 1)]);
    // The forward-only model cannot take it out of the rack at all.
    const forward = new LevelGrid(UP_DOWN, { reverse: false });
    expect(carrySearch(forward, occupancy, lift(stacks, top), starts).drops.has(bottom)).toBe(false);
    expect(minMoves(UP_DOWN, { reverse: false }).unsolvable).toBe(true);
  });

  it('a rack is loaded only from the front: facing it straight from two cells away', () => {
    // The rack in the middle, front to the south; a plant behind the front cell leaves no straight approach.
    const blocked = level(`
# 4 · Sin acceso
id: sin-acceso
limit: 1

  0123456
0 .......
1 .a.....
2 ...R...
3 .......
4 ...p...
5 .....^.

a = caja azul
R = estantería frente sur: azul
`);
    expect(solve(blocked, { allowParking: true, maxExpansions: 500 }).solved).toBe(false);
    expect(minMoves(blocked).unsolvable).toBe(true);
    // Without the plant it is a single move.
    const open = level(`
# 5 · Con acceso
id: con-acceso
limit: 1

  0123456
0 .......
1 .a.....
2 ...R...
3 .......
4 .......
5 .....^.

a = caja azul
R = estantería frente sur: azul
`);
    const result = minMoves(open);
    expect(result).toMatchObject({ exact: true, lower: 1, upper: 1 });
    expect(result.plan![0]).toMatchObject({ drop: new LevelGrid(open).cellCount, after: new LevelGrid(open).index(3, 3) });
  });
});

describe('searches on rack levels', () => {
  it.each([
    ['abajo', UP_DOWN, 1, 1],
    ['dos-columnas', COLUMNS, 4, 4],
    ['cambio', SWAP, 5, 4],
  ] as const)('%s: fewest moves (exact), obligatory moves, a plan that replays', (_, lvl, moves, must) => {
    const result = minMoves(lvl);
    expect(result).toMatchObject({ exact: true, lower: moves, upper: moves, unsolvable: false });
    expect(replayMoves(lvl, result.plan!)).toBe(true);
    expect(replayMoves(lvl, result.plan!.slice(0, -1))).toBe(false);
    expect(levelMetrics(lvl).mustMove).toBe(must);
    expect(solve(lvl, { allowParking: true, maxExpansions: 2000 }).solved).toBe(true);
  });

  it('the swap needs a park (a «libre» slot or the floor): no plan without parking', () => {
    expect(solve(SWAP, { allowParking: false, maxExpansions: 2000 }).solved).toBe(false);
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s: the bound is consistent (one move lowers it by at most one) around a shortest plan', (_, lvl) => {
    const grid = new LevelGrid(lvl);
    const h = movesLowerBounds(grid, stacksOf(grid, lvl), lvl.boxes.length);
    let at = { stacks: stacksOf(grid, lvl), forklift: grid.index(lvl.forklift.x, lvl.forklift.z) };
    const states = [at];
    for (const m of minMoves(lvl).plan!) {
      const next = at.stacks.slice();
      next[m.drop] += next[m.from].slice(-1);
      next[m.from] = next[m.from].slice(0, -1);
      at = { stacks: next, forklift: m.after! };
      states.push(at);
    }
    let pairs = 0;
    for (const s of states) {
      const before = h(s.stacks);
      const occupancy = occupancyOf(grid, s.stacks);
      const region = reachableFrom(grid, occupancy, s.forklift);
      for (let from = 0; from < grid.posCount; from++) {
        if (s.stacks[from].length === 0) continue;
        const lifted = lift(s.stacks, from);
        if (from < grid.cellCount) occupancy[from] = lifted[from].length > 0 ? 0 : -1;
        for (const drop of carrySearch(grid, occupancy, lifted, pickupStarts(grid, region, from)).drops.keys()) {
          if (drop === from || (drop < grid.cellCount && (grid.solid[drop] === 1 || lifted[drop].length >= grid.stackLimit)) || (drop >= grid.cellCount && lifted[drop] !== ''))
            continue;
          const next = lifted.slice();
          next[drop] += s.stacks[from].slice(-1);
          pairs++;
          expect(before - h(next)).toBeLessThanOrEqual(1);
        }
        if (from < grid.cellCount) occupancy[from] = 0;
      }
    }
    expect(pairs).toBeGreaterThan(0);
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s: no dead ends: every move around a shortest plan can be undone or still finishes', (_, lvl) => {
    const plan = minMoves(lvl).plan!;
    const result = deadEnds(lvl, { plan, maxStates: plan.length + 1 });
    expect(result.explored).toBe(plan.length + 1);
    // A box put on its destiny locks (it cannot simply be undone): those moves get the full check, and pass it.
    expect(result).toMatchObject({ found: 0, unknown: 0 });
    expect(result.checked).toBeGreaterThan(result.explored);
  });

  it('explores the whole state space of the smallest rack level: no dead ends at all', () => {
    expect(deadEnds(UP_DOWN, { maxStates: 2000 })).toMatchObject({ found: 0, unknown: 0, complete: true });
  });
});

describe('the lock in the model (a box on its destiny never moves again)', () => {
  /** A 1-cell corridor: the blue zone at its middle, the mint box at its end (its slot is outside). */
  const CORRIDOR = level(`
# 6 · Pasillo
id: pasillo
limit: 1

  0123456
0 .....R.
1 .......
2 ####...
3 a.1....
4 ####...
5 .....^b

1 = zona azul
a = caja menta
b = caja azul
R = estantería frente sur: menta
`);

  /** The same corridor with the blue box already home, in the way of the mint box. */
  const WALLED = level(`
# 7 · Tapado
id: tapado
limit: 1

  0123456
0 .....R.
1 .......
2 ####...
3 a.1....
4 ####...
5 .....^.

1 = zona azul + caja azul
a = caja menta
R = estantería frente sur: menta
`);

  /** Limit 2: blue ● rests on its zone (locked), the mint box to carry past it. */
  const ON_TOP = level(`
# 8 · Encima no
id: encima-no
limit: 2

  0123456
0 .....R.
1 .......
2 ...1...
3 ...a...
4 ...^...

1 = zona azul + caja azul ●
a = caja menta
R = estantería frente sur: menta
`);

  it('lockedAt: the destined box alone on its zone or in its slot; never a trap box, a «libre» slot or a level without racks', () => {
    const grid = new LevelGrid(COLUMNS);
    const stacks = stacksOf(grid, COLUMNS);
    const slot = (i: number) => grid.cellCount + i;
    // Blue ● starts in the ▲ slot (not its destiny): free.
    expect(stacks.map((_, pos) => lockedAt(grid, stacks, pos)).some(Boolean)).toBe(false);
    expect(canLift(grid, stacks, slot(1))).toBe(true);
    const blueCircle = boxCode({ color: 'blue', symbol: 'circle' });
    const mintTriangle = boxCode({ color: 'mint', symbol: 'triangle' });
    const yellow = boxCode({ color: 'yellow', symbol: 'square' });
    const placed = stacks.slice();
    placed[slot(1)] = '';
    placed[slot(0)] = blueCircle; // its destiny
    placed[slot(3)] = mintTriangle; // the «libre» slot
    placed[grid.index(4, 4)] = '';
    placed[grid.index(3, 6)] = '';
    placed[grid.index(1, 3)] = yellow; // its zone
    expect(lockedAt(grid, placed, slot(0))).toBe(true);
    expect(canLift(grid, placed, slot(0))).toBe(false);
    expect(lockedAt(grid, placed, grid.index(1, 3))).toBe(true);
    expect(lockedAt(grid, placed, slot(3))).toBe(false);
    // Mint ▲ in the ▲ slot fits the cue, but its destiny is the exact «menta ▲» slot: free.
    const trap = placed.slice();
    trap[slot(3)] = '';
    trap[slot(1)] = mintTriangle;
    expect(lockedAt(grid, trap, slot(1))).toBe(false);
    // Levels without racks: never, not even a satisfied zone.
    const classic = level(`
# 1 · Clásico
id: clasico
limit: 1

  01234
0 .....
1 .1.a.
2 ..^..

1 = zona azul
a = caja azul
`);
    const cg = new LevelGrid(classic);
    const home = stacksOf(cg, classic);
    home[cg.index(1, 1)] = home[cg.index(3, 1)];
    home[cg.index(3, 1)] = '';
    expect(misplacedCount(cg, home, 1)).toBe(0);
    expect(lockedAt(cg, home, cg.index(1, 1))).toBe(false);
    expect(canLift(cg, home, cg.index(1, 1))).toBe(true);
  });

  it('a locked box is never lifted and nothing is dropped on it (no stack drop, no carry chain, no replay)', () => {
    const grid = new LevelGrid(ON_TOP);
    const stacks = stacksOf(grid, ON_TOP);
    const zone = grid.index(3, 2);
    const mint = grid.index(3, 3);
    expect(lockedAt(grid, stacks, zone)).toBe(true);
    expect(canStackOn(grid, stacks, zone)).toBe(false);
    const occupancy = occupancyOf(grid, stacks);
    const region = reachableFrom(grid, occupancy, grid.index(3, 4));
    occupancy[mint] = -1;
    const drops = carrySearch(grid, occupancy, lift(stacks, mint), pickupStarts(grid, region, mint)).drops;
    expect(drops.size).toBeGreaterThan(3);
    expect(drops.has(zone)).toBe(false);
    expect(replayMoves(ON_TOP, [{ from: mint, drop: zone }])).toBe(false);
    expect(replayMoves(ON_TOP, [{ from: zone, drop: grid.index(1, 1) }])).toBe(false);
    // The plan only moves the mint box, into its slot.
    const result = minMoves(ON_TOP);
    expect(result).toMatchObject({ exact: true, lower: 1, upper: 1 });
    expect(result.plan![0].from).toBe(mint);
    expect(solve(ON_TOP, { allowParking: true, maxExpansions: 500 }).moves).toBe(1);
  });

  it('plans take the lock into account: the corridor box comes out before its zone is filled', () => {
    const grid = new LevelGrid(CORRIDOR);
    const result = minMoves(CORRIDOR);
    expect(result).toMatchObject({ exact: true, lower: 2, upper: 2, unsolvable: false });
    expect(result.plan!.map((m) => m.from)).toEqual([grid.index(0, 3), grid.index(6, 5)]);
    expect(replayMoves(CORRIDOR, result.plan!)).toBe(true);
    // The other order would lock the blue box across the corridor: the mint box could never come out.
    const blueFirst = [
      { from: grid.index(6, 5), drop: grid.index(2, 3) },
      { from: grid.index(0, 3), drop: grid.cellCount },
    ];
    expect(replayMoves(CORRIDOR, blueFirst.slice(0, 1).concat([{ from: grid.index(2, 3), drop: grid.index(6, 5) }]))).toBe(false);
    expect(replayMoves(CORRIDOR, blueFirst)).toBe(false);
  });

  it('a box starting on its destiny stays there: a level that needs it moved cannot be finished', () => {
    // Without the lock this would be 3 moves (blue out, mint out, blue back).
    expect(minMoves(WALLED)).toMatchObject({ unsolvable: true, upper: null });
    expect(solve(WALLED, { allowParking: true, maxExpansions: 500 }).solved).toBe(false);
  });

  it('callejones: a destiny filled too early can wall off the rest; the check finds it (every such move gets a full check)', () => {
    const result = deadEnds(CORRIDOR, { maxStates: 2000 });
    expect(result.complete).toBe(true);
    expect(result.found).toBeGreaterThan(0);
    expect(result.unknown).toBe(0);
    expect(result.deepChecks).toBeGreaterThan(0);
    const grid = new LevelGrid(CORRIDOR);
    expect(result.example!.move.drop).toBe(grid.index(2, 3));
    expect(metricRange(levelMetrics(CORRIDOR, { deadEndStates: 2000 }), 'callejones').lower).toBeGreaterThan(0);
  });
});

describe('metrics and report on rack levels', () => {
  it('repartos is 1, trampas counts cue fits that are not the destiny, huecos counts slots', () => {
    const m = levelMetrics(COLUMNS);
    expect(m).toMatchObject({ sortings: 1, traps: 1, ambiguous: 1, slots: { total: 4, cued: 3, free: 1 } });
    // Blue ● in the ▲ slot covers a target it does not belong to.
    expect(m.blockers.covering).toEqual(['b4']);
    expect(levelMetrics(SWAP)).toMatchObject({ sortings: 1, traps: 0, slots: { total: 3, cued: 2, free: 1 } });
    expect(levelMetrics(SWAP).blockers.covering).toEqual(['b2', 'b3', 'b4']);
    expect(metricRange(m, 'huecos')).toEqual({ lower: 4, upper: 4 });
    expect(metricRange(m, 'repartos')).toEqual({ lower: 1, upper: 1 });
  });

  it('bloqueos: a box locked from the start is no place to reach, so the box in front of it opens nothing', () => {
    // The blue box rests home at the far end of a pocket; the yellow box at the pocket's mouth only leads to it.
    const pocket = level(`
# 9 · Bolsillo
id: bolsillo
limit: 1

  012345
0 1#....
1 .#....
2 .#.R..
3 a.....
4 ...^..

1 = zona azul + caja azul
a = caja amarillo
R = estantería frente sur: amarillo
`);
    const grid = new LevelGrid(pocket);
    expect(lockedAt(grid, stacksOf(grid, pocket), grid.index(0, 0))).toBe(true);
    expect(levelMetrics(pocket, { skipMoves: true }).blockers).toEqual({ count: 0, covering: [], gatekeepers: [] });
  });

  it('difficulty targets can name huecos, repartos and callejones', () => {
    const checks = checkLevelTargets(UP_DOWN, parseTargets('huecos=2, repartos=1, movimientos=1, callejones=0'), { deadEndStates: 2000 });
    expect(checks.map((c) => c.ok)).toEqual([true, true, true, true]);
    expect(checkTargets(levelMetrics(COLUMNS, { skipMoves: true }), parseTargets('huecos>=5'))[0].ok).toBe(false);
  });

  it('the report names the slots in the metrics and in the plan', () => {
    const source = { file: 'x.level', format: 'level' as const, level: COLUMNS, targets: [], notes: [] };
    const report = levelsReport([source], ['dos-columnas'], { deadEndStates: 5 });
    for (const part of [
      'huecos       4 (3 con pista, 1 libre)',
      'repartos     1',
      'Plan de 4 movimientos (uno de los más cortos):',
      'caja azul ● (6,1), hueco 2 de R → hueco 1 de R (6,1)',
      '→ zona 1 (1,3)',
    ])
      expect(report).toContain(part);
    expect(report).toMatch(/dos-columnas .* 4\/3 +—/);
  });
});
