import { describe, expect, it } from 'vitest';
import { parseLevel } from '../asciiLevel';
import { parseTargets } from '../difficulty';
import { LEVEL_SOURCES, LEVELS } from './index';
import { checkLevelTargets, checkTargets, levelMetrics, metricRange } from './metrics';
import { levelsReport, selectSources } from './report';
import {
  LevelGrid,
  carrySearch,
  deadEndCorridors,
  deadEnds,
  greedySearch,
  lift,
  minMoves,
  misplacedCount,
  movesLowerBound,
  movesLowerBounds,
  occupancyOf,
  pickupStarts,
  reachableFrom,
  replayMoves,
  stacksOf,
} from './solver';

const level = (lines: string[]) => parseLevel(`${lines.join('\n')}\n`).level;
const byId = (id: string) => LEVELS.find((l) => l.id === id)!;

/** Shortest plans of the shipped levels, searched once for the tests below that need one. */
const shortest = new Map<string, ReturnType<typeof minMoves>>();
const shortestOf = (lvl: (typeof LEVELS)[number]) => {
  let result = shortest.get(lvl.id);
  if (!result) shortest.set(lvl.id, (result = minMoves(lvl)));
  return result;
};

/** Each box sits on the other's zone: one must be parked first (2 obligatory moves + 1). */
const SWAP = level([
  '# 1 · Cambio',
  'id: cambio',
  '.........',
  '.12......',
  '.........',
  '....^....',
  'p........',
  '1 = zona azul + caja menta    2 = zona menta + caja azul',
]);

/** The blue box waits in a 1-wide pocket behind the mint one, with no room to turn: unsolvable in the model. */
const POCKET = level([
  '# 2 · Bolsillo',
  'id: bolsillo',
  '.......',
  '.#####.',
  '.Ea.b..',
  '.FFFFF.',
  '1..^..2',
  '1 = zona azul    2 = zona menta',
  'a = caja azul    b = caja menta',
  'E F = estantería',
]);

/** Two zones whose towers start upside down: every box has to leave its stack (and most come back). */
const REVERSED = level([
  '# 4 · Al revés doble',
  'id: al-reves-doble',
  'limit: 3',
  'p.........',
  '..........',
  '.1....2...',
  '..........',
  '......^..p',
  '1 = zona pila azul,menta,coral + pila coral,menta,azul',
  '2 = zona pila amarillo,lavanda,azul + pila azul,lavanda,amarillo',
]);

/** Two pillars: the top row and the cells between / beside the pillars leave no 2×2 square to turn in. */
const NARROW = level(['# 3 · Estrecho', 'id: estrecho', '.....', '.#.#.', '.....', '1.^.a', '1 = zona azul', 'a = caja azul']);

describe('minMoves (exact A* over box moves)', () => {
  it('finds the fewest moves and a plan that replays in the model', () => {
    const swap = minMoves(SWAP);
    expect(swap).toMatchObject({ lower: 3, upper: 3, exact: true, unsolvable: false });
    expect(replayMoves(SWAP, swap.plan!)).toBe(true);
    expect(replayMoves(SWAP, swap.plan!.slice(0, 2))).toBe(false);
  });

  it('reports a proven lower bound when the search is capped', () => {
    // Level 16 in the forward-only model: its first plans are a move too long, so a capped search leaves a range.
    const capped = minMoves(byId('al-reves'), { maxWork: 1, reverse: false });
    expect(capped.exact).toBe(false);
    expect(capped.lower).toBeGreaterThanOrEqual(3);
    expect(capped.lower).toBeLessThanOrEqual(5);
    expect(capped.upper).toBeGreaterThanOrEqual(5);
    expect(minMoves(byId('al-reves'), { reverse: false })).toMatchObject({ lower: 5, upper: 5, exact: true });
    // With the reverse gear (the default model) its greedy plan is already a shortest one; the towers still need A*.
    expect(minMoves(byId('al-reves'))).toMatchObject({ lower: 5, upper: 5, exact: true });
    const towers = minMoves(REVERSED, { maxWork: 1 });
    expect(towers.exact).toBe(false);
    expect(towers.lower).toBeGreaterThanOrEqual(6);
    expect(towers.lower).toBeLessThanOrEqual(11);
    expect(towers.upper).toBeGreaterThanOrEqual(11);
  });

  it('solves harder puzzles exactly: towers that start upside down', () => {
    // Obligatory moves 6; the bound already sees that 4 boxes must leave their own tower and come back (10).
    expect(minMoves(REVERSED)).toMatchObject({ lower: 11, upper: 11, exact: true });
  });

  it('can stop as soon as the question is answered (`until`), keeping the range proven', () => {
    const early = minMoves(REVERSED, { until: (lower) => lower >= 10 });
    expect(early.exact).toBe(false);
    expect(early.lower).toBeGreaterThanOrEqual(10);
    expect(early.lower).toBeLessThanOrEqual(11);
  });

  it('says so when no plan exists in the carrying model', () => {
    expect(minMoves(POCKET)).toMatchObject({ exact: false, unsolvable: true, upper: null, plan: null });
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s: exact, bounded by the obligatory moves and any greedy plan; the plan replays', (_, lvl) => {
    const result = shortestOf(lvl);
    const grid = new LevelGrid(lvl);
    const start = grid.index(lvl.forklift.x, lvl.forklift.z);
    const stacks = stacksOf(grid, lvl);
    expect(result.exact).toBe(true);
    expect(result.lower).toBeGreaterThanOrEqual(misplacedCount(grid, stacks, lvl.boxes.length));
    expect(result.upper).not.toBeNull();
    // The greedy search gives up on the harder puzzles; when it finds a plan, the shortest one is never longer.
    const greedy = greedySearch(grid, stacks, start, lvl.boxes.length, { allowParking: true, maxExpansions: 100, regions: 'all' });
    if (greedy.moves) expect(result.upper!).toBeLessThanOrEqual(greedy.moves.length);
    // The heuristic never overestimates.
    expect(movesLowerBound(grid, stacks, start, lvl.boxes.length)).toBeLessThanOrEqual(result.lower);
    expect(result.plan).toHaveLength(result.upper!);
    expect(replayMoves(lvl, result.plan!)).toBe(true);
  });

  it('the reverse gear: a box is backed out of a dead-end lane, which the forward-only model cannot do', () => {
    // The blue box waits at the end of a lane one cell wide: it can only come out backwards.
    const lane = level(['# 6 · Callejón', 'id: callejon', '....1.', '......', '####..', 'a...^.', '1 = zona azul', 'a = caja azul']);
    expect(minMoves(lane, { reverse: false }).unsolvable).toBe(true);
    const backed = minMoves(lane);
    expect(backed).toMatchObject({ exact: true, lower: 1, upper: 1 });
    expect(replayMoves(lane, backed.plan!)).toBe(true);
    expect(replayMoves(lane, backed.plan!, { reverse: false })).toBe(false);
    // The carry chain backs straight up the lane, then drives on; chainTo ends where the plan continues from.
    const grid = new LevelGrid(lane);
    const stacks = stacksOf(grid, lane);
    const occupancy = occupancyOf(grid, stacks);
    const region = reachableFrom(grid, occupancy, grid.index(4, 3));
    const [move] = backed.plan!;
    const lifted = lift(stacks, move.from);
    occupancy[move.from] = -1;
    const chain = carrySearch(grid, occupancy, lifted, pickupStarts(grid, region, move.from)).chainTo(move.drop, move.after!)!;
    expect(chain[chain.length - 1] >> 2).toBe(move.after);
    const backSteps = chain.filter((p, i) => i > 0 && (p & 3) === (chain[i - 1] & 3) && p >> 2 === grid.step(chain[i - 1] >> 2, ((p & 3) + 2) % 4));
    expect(backSteps.length).toBeGreaterThanOrEqual(3);
  });

  it('corridors: dead-end chains of cells, deepest first, and the extra moves their order forces', () => {
    const back = level(['# 8 · Fondo', 'id: fondo', '##.....', '12....a', '##..^..', '1 = zona coral', '2 = zona amarillo + caja amarillo', 'a = caja coral']);
    const grid = new LevelGrid(back);
    expect(deadEndCorridors(grid)).toEqual([[grid.index(0, 1), grid.index(1, 1)]]);
    // The finished yellow box has to leave and come back so the coral can reach the end: 1 obligatory move + 2.
    expect(movesLowerBound(grid, stacksOf(grid, back), grid.index(4, 2), back.boxes.length)).toBe(3);
    expect(minMoves(back)).toMatchObject({ exact: true, lower: 3, upper: 3 });
  });
});

describe('the exact search heuristic', () => {
  /** States around the start and around every state of a shortest plan, for the consistency checks. */
  const explore = (lvl: (typeof LEVELS)[number], limit: number) => {
    const grid = new LevelGrid(lvl);
    const start = { stacks: stacksOf(grid, lvl), forklift: grid.index(lvl.forklift.x, lvl.forklift.z) };
    const states = [start];
    let at = start;
    for (const m of shortestOf(lvl).plan ?? []) {
      const next = at.stacks.slice();
      next[m.drop] += next[m.from].slice(-1);
      next[m.from] = next[m.from].slice(0, -1);
      at = { stacks: next, forklift: m.after! };
      states.push(at);
    }
    return { grid, states: states.slice(0, limit) };
  };

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s: is consistent (one move lowers it by at most one) around a shortest plan', (_, lvl) => {
    const { grid, states } = explore(lvl, 12);
    const h = movesLowerBounds(grid, states[0].stacks, lvl.boxes.length);
    let pairs = 0;
    const drops: string[] = [];
    for (const s of states) {
      const before = h(s.stacks);
      const occupancy = occupancyOf(grid, s.stacks);
      const region = reachableFrom(grid, occupancy, s.forklift);
      for (let from = 0; from < grid.cellCount; from++) {
        if (s.stacks[from].length === 0) continue;
        const lifted = lift(s.stacks, from);
        occupancy[from] = lifted[from].length > 0 ? 0 : -1;
        for (const drop of carrySearch(grid, occupancy, lifted, pickupStarts(grid, region, from)).drops.keys()) {
          if (drop === from || grid.solid[drop] === 1 || lifted[drop].length >= grid.stackLimit) continue;
          const next = lifted.slice();
          next[drop] += s.stacks[from].slice(-1);
          pairs++;
          const after = h(next);
          if (before - after > 1) drops.push(`${before} → ${after} moving ${from} → ${drop}`);
        }
        occupancy[from] = 0;
      }
    }
    expect(pairs).toBeGreaterThan(0);
    expect(drops).toEqual([]);
  });
});

describe('dead ends («callejones»)', () => {
  it('finds a real dead end when the forklift cannot back up, and none with the reverse gear', () => {
    // Level 14 (unchanged): two boxes pushed into the nook between the shelf and the plant can only come out backwards.
    const nook = byId('primero-la-base');
    const forward = deadEnds(nook, { reverse: false, maxStates: 300, checkWork: 20_000 });
    expect(forward.found).toBeGreaterThan(0);
    expect(forward.example).not.toBeNull();
    const withReverse = deadEnds(nook, { maxStates: 300 });
    expect(withReverse).toMatchObject({ found: 0, unknown: 0, deepChecks: 0 });
  });

  it('explores the whole state space of a small level and says so', () => {
    const result = deadEnds(byId('primer-encargo'), { maxStates: 1000 });
    expect(result).toMatchObject({ found: 0, unknown: 0, complete: true });
    const range = metricRange(levelMetrics(byId('primer-encargo'), { deadEndStates: 1000 }), 'callejones');
    expect(range).toEqual({ lower: 0, upper: 0 });
    // A partial search only proves a lower bound.
    const partial = metricRange(levelMetrics(byId('el-gran-almacen-v2'), { deadEndStates: 5 }), 'callejones');
    expect(partial).toEqual({ lower: 0, upper: Infinity });
  });
});

describe('levelMetrics', () => {
  it('swap: 2 obligatory moves, 1 extra, both boxes cover a zone', () => {
    const m = levelMetrics(SWAP);
    expect(m).toMatchObject({ mustMove: 2, extra: { lower: 1, upper: 1 }, ambiguous: 0, traps: 0, sortings: null });
    expect(m.blockers).toEqual({ count: 2, covering: ['b1', 'b2'], gatekeepers: [] });
  });

  it('a box that closes the only way to another one is a blocker (gatekeeper)', () => {
    const m = levelMetrics(POCKET);
    expect(m.blockers).toEqual({ count: 1, covering: [], gatekeepers: ['b2'] });
    expect(m.moves.unsolvable).toBe(true);
  });

  it('narrow cells: no free 2×2 square to turn with a load; free floor counts shelves, plants and boxes', () => {
    const m = levelMetrics(NARROW);
    expect(m.narrow.floor).toBe(18);
    const cells = m.narrow.cells.map((c) => [c % 5, Math.floor(c / 5)]);
    expect(cells).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [0, 1],
      [2, 1],
      [4, 1],
    ]);
    expect(m.narrow.count).toBe(8);
    expect(m.freeFloorPct).toBe(85);
  });

  it('stacks: boxes above a wrong base or on top of a box that must move are blockers', () => {
    expect(levelMetrics(byId('al-reves')).blockers.covering).toEqual(['b1', 'b2']);
    // Level 17: the lavender box on the tower's base, and the whole blue-yellow-mint pile on the mint zone.
    expect(levelMetrics(byId('torre-de-tres-v2')).blockers.covering).toEqual(['b1', 'b2', 'b3', 'b4']);
    expect(levelMetrics(byId('una-encima')).blockers.count).toBe(0);
  });

  it('sorting levels: ambiguous boxes, trap placements and distinct complete sortings', () => {
    const summary = (id: string) => {
      const m = levelMetrics(byId(id));
      return [m.ambiguous, m.traps, m.sortings];
    };
    expect(summary('dos-sitios-posibles-v2')).toEqual([1, 1, 1]);
    expect(summary('la-muestra')).toEqual([2, 2, 1]);
    expect(summary('el-gran-reparto-v2')).toEqual([3, 3, 1]);
    // Stacking: a box that fits two steps of a tower (or the base of one zone and a step of another) has two destinations.
    expect(levelMetrics(byId('el-gran-apilado-v2')).ambiguous).toBe(4);
  });

  it('checkLevelTargets measures only what the targets need and stops once they are decided', () => {
    const results = (text: string) => checkLevelTargets(REVERSED, parseTargets(text)).map((r) => r.ok);
    expect(results('extra>=4, bloqueos=6, estrechas=0')).toEqual([true, true, true]);
    expect(results('movimientos=11, extra=5')).toEqual([true, true]);
    expect(results('movimientos<=10')).toEqual([false]);
    expect(checkLevelTargets(REVERSED, [])).toEqual([]);
  });

  it('targets are checked against proven ranges; a metric that does not apply never holds', () => {
    const m = levelMetrics(SWAP);
    const results = checkTargets(m, parseTargets('extra>=1, bloqueos=2, movimientos<=3, extra>=2, repartos>=0, libre>=80'));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false, false, true]);
    expect(metricRange(m, 'movimientos')).toEqual({ lower: 3, upper: 3 });
    const capped = levelMetrics(byId('al-reves'), { maxWork: 1 });
    expect(metricRange(capped, 'movimientos').lower).toBe(capped.moves.lower);
    expect(checkTargets(capped, parseTargets('movimientos<=5'))[0].ok).toBe(capped.moves.upper === 5 && capped.moves.exact);
  });
});

describe('npm run levels report', () => {
  it('selects levels by order, #position, id or file name', () => {
    const ids = (args: string[]) => selectSources(LEVEL_SOURCES, args).map((s) => s.level.id);
    expect(ids(['23', '#1', 'dos-colores', 'level-04', 'level-05.level'])).toEqual([
      'la-muestra',
      'primer-encargo',
      'dos-colores',
      'pequeno-desorden-v2',
      'cruce-de-pasillos-v2',
    ]);
    expect(() => selectSources(LEVEL_SOURCES, ['nada'])).toThrow(/No encuentro el nivel «nada»/);
  });

  it('prints one level in detail: its text, metrics, targets and a shortest plan', () => {
    const report = levelsReport(LEVEL_SOURCES, ['23']);
    expect(report).toBe(levelsReport(LEVEL_SOURCES, ['la-muestra']));
    for (const part of [
      '== 23 · La muestra · la-muestra · src/data/levels/level-23.level ==',
      '4 ....b..a..',
      'a = caja azul ▲',
      'movimientos  4 (exacto)',
      'trampas      2',
      'Objetivos (dificultad:)\n  ninguno',
      'callejones   0 (',
      'Plan de 4 movimientos (uno de los más cortos):',
      ' → zona 4 (7,1)',
      'la-muestra    10×7      4      4      1     4      0',
    ])
      expect(report).toContain(part);
  });

  it('shows a capped search as a proven range', () => {
    const source = { file: 'x.level', format: 'level' as const, level: REVERSED, targets: [], notes: [] };
    const report = levelsReport([source], ['al-reves-doble'], { maxWork: 1 });
    expect(report).toMatch(/movimientos {2}≥ 1\d, el mejor plan encontrado hace \d+ \(presupuesto agotado tras \d+ estados: sube --estados\)/);
    expect(report).toMatch(/al-reves-doble .* ≥1\d +≥\d/);
  });

  it('prints every level and one summary row per level', () => {
    const report = levelsReport(LEVEL_SOURCES, [], { deadEndStates: 1 });
    expect(report.match(/^== /gm)).toHaveLength(LEVELS.length);
    const table = report.slice(report.indexOf('Resumen'));
    for (const l of LEVELS) expect(table).toContain(` ${l.id} `);
  });
});
