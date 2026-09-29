import { describe, expect, it } from 'vitest';
import { parseLevel } from '../asciiLevel';
import { parseTargets } from '../difficulty';
import { checkLevelTargets, checkTargets, levelMetrics, metricRange } from './metrics';
import { levelsReport } from './report';
import {
  LevelGrid,
  boxCode,
  carrySearch,
  deadEnds,
  lift,
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
    expect(grid.racks).toBe(true);
    expect(grid.sorting).toBe(false); // destinies are fixed: no trap bookkeeping
    expect(grid.slotCount).toBe(4);
    expect(grid.posCount).toBe(grid.cellCount + 4);
    expect(grid.solid[grid.index(6, 1)]).toBe(1);
    expect(grid.solid[grid.index(6, 2)]).toBe(1);
    expect(grid.posOf(6, 1, 1)).toBe(grid.cellCount + 1);
    expect(grid.posOf(6, 2, 0)).toBe(grid.cellCount + 2);
    expect(grid.posOf(2, 4)).toBe(grid.index(2, 4));
    expect(grid.accessOf(grid.cellCount + 2)).toBe(grid.index(5, 2));
    expect(grid.slotDir[0]).toBe(DIR.E); // into a rack facing west
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

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s: no dead ends: every move from every state of a shortest plan can be undone', (_, lvl) => {
    const plan = minMoves(lvl).plan!;
    const result = deadEnds(lvl, { plan, maxStates: plan.length + 1 });
    expect(result.explored).toBe(plan.length + 1);
    expect(result).toMatchObject({ found: 0, unknown: 0, deepChecks: 0 });
    expect(result.checked).toBeGreaterThan(result.explored);
  });

  it('explores the whole state space of the smallest rack level: no dead ends at all', () => {
    expect(deadEnds(UP_DOWN, { maxStates: 2000 })).toMatchObject({ found: 0, unknown: 0, complete: true });
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
