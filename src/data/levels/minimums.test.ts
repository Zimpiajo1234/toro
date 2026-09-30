import { describe, expect, it } from 'vitest';
import fileText from '../levelMinimums.json?raw';
import { parseLevel } from '../asciiLevel';
import { BENCHMARK_ID, LEVELS, SPECIAL_LEVELS } from './index';
import { MINIMUMS_FILE, levelMinimum } from './minimums';
import { DEFAULT_MINIMUM_WORK, computeMinimums, formatMinimums, minimumsChanges } from './minimumsBuild';

/*
 * The precomputed fewest moves the move counter shows (src/data/levelMinimums.json, read by minimums.ts): it must be
 * what the solver finds today for every level. When this fails, a level (or the solver) changed: run
 * `npm run levels -- --minimos` and commit the file it rewrites.
 */

const ALL = [...LEVELS, ...SPECIAL_LEVELS];
const REGENERATE = 'src/data/levelMinimums.json is stale: run `npm run levels -- --minimos`';

describe('precomputed level minimums', () => {
  it('match a fresh solver run on every level (the game\'s and the Benchmark)', () => {
    const fresh = computeMinimums(ALL, MINIMUMS_FILE.maxWork);
    expect(minimumsChanges(MINIMUMS_FILE, fresh), REGENERATE).toEqual([]);
    expect(MINIMUMS_FILE, REGENERATE).toEqual(fresh);
  });

  it('the file is in the form the script writes (so a regeneration only shows real changes)', () => {
    expect(fileText.replace(/\r\n/g, '\n'), REGENERATE).toBe(formatMinimums(MINIMUMS_FILE));
    expect(MINIMUMS_FILE.maxWork).toBeGreaterThanOrEqual(DEFAULT_MINIMUM_WORK);
  });

  it('cover levels 1–3 and the Benchmark, all exact today', () => {
    expect(Object.keys(MINIMUMS_FILE.levels)).toEqual(ALL.map((l) => l.id));
    expect(levelMinimum(BENCHMARK_ID)).toEqual({ moves: 14, exact: true });
    for (const level of ALL) {
      const m = levelMinimum(level.id)!;
      expect(m.exact, level.id).toBe(true);
      // Every box that does not start on its destiny moves at least once.
      expect(m.moves, level.id).toBeGreaterThanOrEqual(level.id === BENCHMARK_ID ? 12 : level.boxes.length);
    }
  });

  it('levelMinimum: the same frozen object each call, null for a level without one', () => {
    const first = levelMinimum('primer-encargo');
    expect(first).toEqual({ moves: 1, exact: true });
    expect(levelMinimum('primer-encargo')).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(levelMinimum('prueba')).toBeNull();
    expect(levelMinimum('toString')).toBeNull();
  });

  it('a changed level is reported as stale, and a search cut short stores a lower bound (exact: false)', () => {
    const swap = parseLevel(
      [
        '# 1 · Cambio',
        'id: cambio',
        'limit: 1',
        '',
        '  0123456',
        '0 .......',
        '1 .1...2.',
        '2 .......',
        '3 ...^...',
        '',
        '1 = zona azul + caja menta      2 = zona menta + caja azul',
        '',
      ].join('\n'),
    ).level;
    const fresh = computeMinimums([swap]);
    expect(fresh.levels.cambio).toEqual({ moves: 3, exact: true });
    const stored = { ...fresh, levels: { cambio: { moves: 2, exact: true } } };
    expect(minimumsChanges(stored, fresh)).toEqual(['cambio: 2 (exacto) → 3 (exacto)']);
    expect(minimumsChanges(null, fresh)).toEqual(['cambio: nada → 3 (exacto)']);
    expect(minimumsChanges(fresh, computeMinimums([swap], DEFAULT_MINIMUM_WORK + 1))).toEqual([`presupuesto (--estados): ${DEFAULT_MINIMUM_WORK} → ${DEFAULT_MINIMUM_WORK + 1}`]);
    // Two such swaps in a stacking level (the classic swap-cycle bound is off there: its bound says 5, the fewest is
    // 6) with almost no budget: only the proven lower bound, marked as such.
    const swaps = parseLevel(
      [
        '# 1 · Dos cambios',
        'id: dos-cambios',
        'limit: 2',
        '',
        '  0123456',
        '0 .......',
        '1 .1...2.',
        '2 .......',
        '3 .3...4.',
        '4 ...^...',
        '',
        '1 = zona azul + caja menta      2 = zona menta + caja azul',
        '3 = zona coral + caja lavanda   4 = zona lavanda + caja coral',
        '',
      ].join('\n'),
    ).level;
    expect(computeMinimums([swaps]).levels['dos-cambios']).toEqual({ moves: 6, exact: true });
    const capped = computeMinimums([swaps], 1).levels['dos-cambios'];
    expect(capped.exact).toBe(false);
    expect(capped.moves).toBeGreaterThanOrEqual(4);
    expect(capped.moves).toBeLessThan(6);
    expect(formatMinimums({ ...fresh, levels: { cambio: capped } })).toContain('"cambio": { "moves": ' + capped.moves + ', "exact": false }');
  });
});
