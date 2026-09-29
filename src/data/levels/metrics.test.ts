import { describe, expect, it } from 'vitest';
import { parseLevel } from '../asciiLevel';
import { parseTargets } from '../difficulty';
import { LEVEL_SOURCES, LEVELS } from './index';
import { checkLevelTargets, checkTargets, levelMetrics, metricRange } from './metrics';
import { levelsReport, selectSources } from './report';
import { LevelGrid, greedySearch, minMoves, misplacedCount, replayMoves, stacksOf } from './solver';

const level = (lines: string[]) => parseLevel(`${lines.join('\n')}\n`).level;
const byId = (id: string) => LEVELS.find((l) => l.id === id)!;

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
    const capped = minMoves(byId('al-reves'), { maxWork: 1 });
    expect(capped.exact).toBe(false);
    expect(capped.lower).toBeGreaterThanOrEqual(3);
    expect(capped.lower).toBeLessThanOrEqual(5);
    expect(capped.upper).toBeGreaterThanOrEqual(5);
    expect(minMoves(byId('al-reves'))).toMatchObject({ lower: 5, upper: 5, exact: true });
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

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s: bounded by the obligatory moves and the greedy plan; the plan replays', (_, lvl) => {
    const result = minMoves(lvl);
    const grid = new LevelGrid(lvl);
    const start = grid.index(lvl.forklift.x, lvl.forklift.z);
    const stacks = stacksOf(grid, lvl);
    const greedy = greedySearch(grid, stacks, start, lvl.boxes.length, { allowParking: true, maxExpansions: 2000, regions: 'all' });
    expect(result.lower).toBeGreaterThanOrEqual(misplacedCount(grid, stacks, lvl.boxes.length));
    expect(result.upper).not.toBeNull();
    expect(result.upper!).toBeLessThanOrEqual(greedy.moves!.length);
    expect(result.plan).toHaveLength(result.upper!);
    expect(replayMoves(lvl, result.plan!)).toBe(true);
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
    expect(levelMetrics(byId('torre-de-tres')).blockers.covering).toEqual(['b2']);
    expect(levelMetrics(byId('una-encima')).blockers.count).toBe(0);
  });

  it('sorting levels: ambiguous boxes, trap placements and distinct complete sortings', () => {
    const summary = (id: string) => {
      const m = levelMetrics(byId(id));
      return [m.ambiguous, m.traps, m.sortings];
    };
    expect(summary('dos-sitios-posibles')).toEqual([1, 1, 1]);
    expect(summary('la-muestra')).toEqual([2, 2, 1]);
    expect(summary('el-gran-reparto')).toEqual([3, 3, 1]);
    // Stacking: a box that fits the base of one zone and a higher step of another has two destinations.
    expect(levelMetrics(byId('el-gran-apilado')).ambiguous).toBe(6);
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
      'pequeno-desorden',
      'cruce-de-pasillos',
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
    const report = levelsReport(LEVEL_SOURCES);
    expect(report.match(/^== /gm)).toHaveLength(LEVELS.length);
    const table = report.slice(report.indexOf('Resumen'));
    for (const l of LEVELS) expect(table).toContain(` ${l.id} `);
  });
});
