import { describe, expect, it } from 'vitest';
import { parseLevel } from '../asciiLevel';
import { BENCHMARK_ID, getSpecialLevel } from './index';
import { checkLevelTargets, levelMetrics } from './metrics';
import { parseTargets } from '../difficulty';
import { levelsReport } from './report';
import {
  LevelGrid,
  boxCode,
  canLift,
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
  type Stacks,
} from './solver';

/*
 * The grid model with loading docks (docs/DOCKS.md): a truck bed cell is solid and holds a stack whose steps are the
 * destined kinds of its levels; it is loaded by one step on from behind its front cell and a box lifted off it backs
 * straight out; its satisfied levels are locked, but the next level still loads on top.
 */

const level = (text: string) => parseLevel(`${text.trim()}\n`, 'prueba.level').level;
const DIR = { E: 0, S: 1, W: 2, N: 3 } as const;

/** docs/DOCKS.md's example: menta ▲ loaded by mistake on the «coral ◆» level. */
const EXAMPLE = level(`
# 1 · Muelle de ejemplo
id: muelle-ejemplo
limit: 2
ventanas: oeste 2-3

  01234567
0 ..TT....
1 ........
2 .....1..
3 .a..b...
4 ....^.c.

1 = zona ■
a = caja azul ▲        b = caja amarillo ■    c = caja coral ◆
T = camión muelle norte: azul / ▲ | coral ◆ + caja menta ▲
`);

/** A west dock: its first column starts right at the bottom (locked), the level above is loaded on top of it. */
const WEST = level(`
# 2 · Muelle oeste
id: muelle-oeste
limit: 2

  012345
0 ......
1 T.....
2 T..a..
3 ......
4 ...^b.

a = caja menta ▲        b = caja coral ●
T = camión muelle oeste: azul + caja azul ● / ▲ | coral
`);

/** The bed can only be loaded straight from its front: a plant behind the front cell leaves no approach. */
const BLOCKED = level(`
# 3 · Sin acceso
id: sin-acceso
limit: 1

  01234
0 ..T..
1 .....
2 ..p..
3 .a..^

a = caja azul
T = camión muelle norte: azul
`);

describe('grid model with trucks', () => {
  it('bed cells are solid stacks asking for the destined kind of each level, reached from their front cell', () => {
    const grid = new LevelGrid(EXAMPLE);
    const [bed0, bed1] = [grid.index(2, 0), grid.index(3, 0)];
    expect(grid.targets).toBe(true);
    expect(grid.racks).toBe(false);
    expect(grid.sorting).toBe(false);
    expect([grid.solid[bed0], grid.solid[bed1]]).toEqual([1, 1]);
    expect([grid.bedLevels[bed0], grid.bedLevels[bed1]]).toEqual([2, 1]);
    expect([grid.isBed(bed0), grid.isBed(grid.index(4, 0)), grid.isBed(grid.cellCount)]).toEqual([true, false, false]);
    expect(grid.accessOf(bed1)).toBe(grid.index(3, 1));
    expect(grid.bedDir[bed1]).toBe(DIR.N);
    expect([grid.capacity(bed0), grid.capacity(bed1), grid.capacity(grid.index(0, 0))]).toEqual([2, 1, 2]);
    expect(grid.steps[bed0]).toEqual([
      { color: 'blue', symbol: 'triangle' },
      { color: 'mint', symbol: 'triangle' },
    ]);
    expect(grid.steps[bed1]).toEqual([{ color: 'coral', symbol: 'diamond' }]);
    const stacks = stacksOf(grid, EXAMPLE);
    expect(stacks[bed1]).toBe(boxCode({ color: 'mint', symbol: 'triangle' }));
    expect(grid.posOf(3, 0, 0)).toBe(bed1);
    // The wrong load and the three floor boxes all have to move.
    expect(misplacedCount(grid, stacks, EXAMPLE.boxes.length)).toBe(4);
    // A west dock is loaded from the east (column 1).
    const west = new LevelGrid(WEST);
    expect(west.accessOf(west.index(0, 2))).toBe(west.index(1, 2));
    expect(west.bedDir[west.index(0, 2)]).toBe(DIR.W);
  });

  it('the lock: a satisfied level is never lifted, a wrong top is; the next level loads on top of a locked box', () => {
    const grid = new LevelGrid(WEST);
    const bed = grid.index(0, 1);
    const stacks = stacksOf(grid, WEST);
    const blue = boxCode({ color: 'blue', symbol: 'circle' });
    const mint = boxCode({ color: 'mint', symbol: 'triangle' });
    expect(stacks[bed]).toBe(blue);
    expect(lockedAt(grid, stacks, bed)).toBe(true);
    expect(canLift(grid, stacks, bed)).toBe(false);
    // Loading on top of it is a drop the searches offer (from behind the front cell, one step on).
    const occupancy = occupancyOf(grid, stacks);
    const from = grid.index(3, 2);
    const region = reachableFrom(grid, occupancy, grid.index(3, 4));
    occupancy[from] = -1;
    const drops = carrySearch(grid, occupancy, lift(stacks, from), pickupStarts(grid, region, from)).drops;
    expect(drops.get(bed)).toEqual([grid.index(1, 1)]);
    // Satisfied from the bed up: locked; a wrong box on a satisfied level: liftable; on a wrong base: never locked.
    const done = stacks.slice();
    done[bed] = blue + mint;
    expect(lockedAt(grid, done, bed)).toBe(true);
    const wrongTop = stacks.slice();
    wrongTop[bed] = blue + boxCode({ color: 'coral', symbol: 'circle' });
    expect([lockedAt(grid, wrongTop, bed), canLift(grid, wrongTop, bed)]).toEqual([false, true]);
    const wrongBase = stacks.slice();
    wrongBase[bed] = mint + blue;
    expect(lockedAt(grid, wrongBase, bed)).toBe(false);
    // Levels without racks or trucks never lock anything.
    const plain = level(`
# 4 · Sin muelle
id: sin-muelle

  0123
0 ....
1 .a1.
2 ...^

1 = zona azul
a = caja azul
`);
    const g = new LevelGrid(plain);
    const s = stacksOf(g, plain);
    s[g.index(2, 1)] = s[g.index(1, 1)];
    expect(lockedAt(g, s, g.index(2, 1))).toBe(false);
  });

  it('a box lifted off a truck only backs straight out; a full column takes nothing; from the side, never', () => {
    const grid = new LevelGrid(EXAMPLE);
    const bed = grid.index(3, 0);
    const stacks = stacksOf(grid, EXAMPLE);
    const occupancy = occupancyOf(grid, stacks);
    const region = reachableFrom(grid, occupancy, grid.index(4, 4));
    const starts = pickupStarts(grid, region, bed);
    expect(starts).toEqual([grid.index(3, 1) * 4 + DIR.N]);
    const search = carrySearch(grid, occupancy, lift(stacks, bed), starts);
    // Out backwards first: every chain starts with the step back to (3,2).
    const chain = search.chain(grid.index(2, 0))!;
    expect(chain.slice(0, 2)).toEqual([grid.index(3, 1) * 4 + DIR.N, grid.index(3, 2) * 4 + DIR.N]);
    // …then back onto the other column by one step on from behind its front cell, ending on that front cell.
    expect(search.chainTo(grid.index(2, 0), grid.index(2, 1))?.at(-1)).toBe(grid.index(2, 1) * 4 + DIR.N);
    expect(search.drops.get(grid.index(2, 0))).toEqual([grid.index(2, 1)]);
    // The forward-only model cannot take it off the truck.
    const forward = new LevelGrid(EXAMPLE, { reverse: false });
    expect(carrySearch(forward, occupancy, lift(stacks, bed), starts).drops.size).toBe(0);
    // A full column (1 level, loaded) is never a drop; the side of a bed never either.
    const from = grid.index(1, 3);
    const lifted = lift(stacks, from);
    occupancy[from] = -1;
    const floor = carrySearch(grid, occupancy, lifted, pickupStarts(grid, region, from)).drops;
    expect(floor.has(bed)).toBe(false);
    expect(floor.get(grid.index(2, 0))).toEqual([grid.index(2, 1)]);
    // Unreachable straight from the front: no plan at all.
    expect(minMoves(BLOCKED).unsolvable).toBe(true);
  });
});

describe('searches on truck levels', () => {
  it.each([
    ['muelle-ejemplo', EXAMPLE, 4, 4],
    ['muelle-oeste', WEST, 2, 2],
  ] as const)('%s: fewest moves (exact), obligatory moves, a plan that replays, no dead ends', (_, lvl, moves, must) => {
    const result = minMoves(lvl);
    expect(result).toMatchObject({ exact: true, lower: moves, upper: moves, unsolvable: false });
    expect(replayMoves(lvl, result.plan!)).toBe(true);
    expect(replayMoves(lvl, result.plan!.slice(0, -1))).toBe(false);
    expect(levelMetrics(lvl, { skipMoves: true }).mustMove).toBe(must);
    expect(solve(lvl, { allowParking: true, maxExpansions: 2000 }).solved).toBe(true);
    // The small west dock is explored completely; the example as far as the report looks (and then some).
    const dead = deadEnds(lvl, { maxStates: lvl === WEST ? 5000 : 300 });
    expect(dead).toMatchObject({ found: 0, unknown: 0 });
    expect(dead.complete).toBe(lvl === WEST);
  });

  it('the plan unloads the wrong box before its column is loaded, and loads bottom → top', () => {
    const grid = new LevelGrid(EXAMPLE);
    const plan = minMoves(EXAMPLE).plan!;
    const bed1 = grid.index(3, 0);
    const bed0 = grid.index(2, 0);
    const unload = plan.findIndex((m) => m.from === bed1);
    expect(unload).toBeGreaterThanOrEqual(0);
    expect(plan.findIndex((m) => m.drop === bed1)).toBeGreaterThan(unload);
    // The mint ▲ goes straight from one column to the other, on top of the locked azul ▲.
    expect(plan[unload].drop).toBe(bed0);
    expect(plan.findIndex((m) => m.drop === bed0)).toBeLessThan(unload);
  });

  it('the exact search bound stays consistent with trucks (one move lowers it by at most one), Benchmark included', () => {
    for (const lvl of [EXAMPLE, WEST, getSpecialLevel(BENCHMARK_ID)!]) {
      const grid = new LevelGrid(lvl);
      const start: Stacks = stacksOf(grid, lvl);
      const h = movesLowerBounds(grid, start, lvl.boxes.length);
      const plan = minMoves(lvl).plan!;
      expect(h(start)).toBeLessThanOrEqual(plan.length);
      let at = { stacks: start, forklift: grid.index(lvl.forklift.x, lvl.forklift.z) };
      const states = [at];
      for (const m of plan) {
        const next = lift(at.stacks, m.from);
        next[m.drop] += at.stacks[m.from].slice(-1);
        at = { stacks: next, forklift: m.after! };
        states.push(at);
      }
      const bad: string[] = [];
      let pairs = 0;
      for (const s of states) {
        const before = h(s.stacks);
        const occupancy = occupancyOf(grid, s.stacks);
        const region = reachableFrom(grid, occupancy, s.forklift);
        for (let from = 0; from < grid.posCount; from++) {
          if (!canLift(grid, s.stacks, from)) continue;
          const lifted = lift(s.stacks, from);
          if (from < grid.cellCount) occupancy[from] = lifted[from].length > 0 ? 0 : -1;
          for (const drop of carrySearch(grid, occupancy, lifted, pickupStarts(grid, region, from)).drops.keys()) {
            if (drop === from || drop >= grid.posCount || lifted[drop].length >= grid.capacity(drop)) continue;
            if (!grid.isSlot(drop) && !grid.isBed(drop) && (grid.solid[drop] === 1 || lockedAt(grid, lifted, drop))) continue;
            const next = lifted.slice();
            next[drop] += s.stacks[from].slice(-1);
            pairs++;
            const after = h(next);
            if (before - after > 1) bad.push(`${lvl.id}: ${before} → ${after} moving ${from} → ${drop}`);
          }
          if (from < grid.cellCount) occupancy[from] = s.stacks[from].length > 0 ? 0 : -1;
        }
      }
      expect(pairs, lvl.id).toBeGreaterThan(0);
      expect(bad).toEqual([]);
    }
  });
});

describe('metrics and report on truck levels', () => {
  it('repartos 1, camion counts truck levels, trampas and ambiguas see the truck cues', () => {
    const m = levelMetrics(EXAMPLE, { skipMoves: true });
    expect(m.sortings).toBe(1);
    expect(m.trucks).toEqual({ trucks: 1, columns: 2, levels: 3, loaded: 1 });
    expect(m.slots).toEqual({ total: 0, cued: 0, free: 0 });
    // azul ▲ fits «azul» (its destiny) and «▲» (the mint's): a trap, and a box with two destinations.
    expect(m.traps).toBe(1);
    expect(m.ambiguous).toBe(1);
    // The wrong load covers its level.
    expect(m.blockers.covering).toEqual(['b4']);
    const checks = checkLevelTargets(EXAMPLE, parseTargets('camion=3, camiones>=3, repartos=1, movimientos=4'));
    expect(checks.map((c) => c.ok)).toEqual([true, true, true, true]);
    expect(levelMetrics(level(`
# 5 · Sin camión
id: sin-camion

  012
0 ...
1 a1^
2 ...

1 = zona azul
a = caja azul
`), { skipMoves: true }).trucks).toEqual({ trucks: 0, columns: 0, levels: 0, loaded: 0 });
  });

  it('the report names the truck in the metrics, the plan and the summary', () => {
    const source = { file: 'x.level', format: 'level' as const, level: EXAMPLE, targets: [], notes: [] };
    const report = levelsReport([source], ['muelle-ejemplo'], { deadEndStates: 5 });
    for (const part of [
      'camion       3 (2 columnas, 1 camión; 1 cargado al empezar)',
      'repartos     1',
      'caja menta ▲ (3,0), camión T, nivel 1 → camión T (2,0), nivel 2',
      '→ camión T (3,0), nivel 1',
    ])
      expect(report).toContain(part);
    expect(report).toMatch(/muelle-ejemplo .* — +2\/3 +—/);
    expect(levelsReport([source], [], { deadEndStates: 5 })).toMatch(/camión 3 \(2 columnas, 1 camión; 1 cargado al empezar\)/);
  });
});
