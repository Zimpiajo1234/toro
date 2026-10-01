/**
 * Tooling behind src/data/levelMinimums.json (read at runtime by ./minimums.ts): the solver's fewest box moves for
 * every level, the game's and the special ones. Written by `npm run levels -- --minimos` (scripts/levels.mjs) and
 * recomputed by minimums.test.ts, which fails when the file is stale. Never imported by the game (it runs the solver).
 */
import type { LevelData } from '../../core/types';
import type { LevelMinimum, MinimumsFile } from './minimums';
import { minMoves } from './solver';

/** The data file, from the project root. */
export const MINIMUMS_PATH = 'src/data/levelMinimums.json';

/**
 * Default work budget of the exact search: the solver's own default (solver.minMoves), the one `npm run levels`
 * reports «movimientos» with. `npm run levels -- --minimos --estados N` raises it for a level that needs more; the
 * file keeps the budget it was computed with, and later runs and the test reuse it.
 */
export const DEFAULT_MINIMUM_WORK = 150_000;

const COMMENT =
  'Fewest box moves per level id (solver «movimientos»), for the move counter. Generated: npm run levels -- --minimos. Do not edit by hand.';

/**
 * Fewest moves of every level with the exact search capped at `maxWork` (the game's controls: reverse gear on). A level
 * the model cannot finish gets no entry (the levels tests refuse such a level anyway).
 */
export function computeMinimums(levels: readonly LevelData[], maxWork: number = DEFAULT_MINIMUM_WORK): MinimumsFile {
  const out: Record<string, LevelMinimum> = {};
  for (const level of levels) {
    const result = minMoves(level, { maxWork });
    if (result.unsolvable) continue;
    out[level.id] = { moves: result.lower, exact: result.exact };
  }
  return { $comment: COMMENT, maxWork, levels: out };
}

/** The file's text: 2-space JSON, one line per level, final newline (stable, so a regenerated file diffs cleanly). */
export function formatMinimums(file: MinimumsFile): string {
  const ids = Object.keys(file.levels);
  const rows = ids.map((id, i) => {
    const m = file.levels[id];
    return `    ${JSON.stringify(id)}: { "moves": ${m.moves}, "exact": ${m.exact} }${i < ids.length - 1 ? ',' : ''}`;
  });
  return [
    '{',
    `  "$comment": ${JSON.stringify(file.$comment)},`,
    `  "maxWork": ${file.maxWork},`,
    rows.length === 0 ? '  "levels": {}' : `  "levels": {\n${rows.join('\n')}\n  }`,
    '}',
    '',
  ].join('\n');
}

/** What differs between the stored file and a fresh computation, one Spanish line per level (empty = up to date). */
export function minimumsChanges(stored: MinimumsFile | null, fresh: MinimumsFile): string[] {
  const text = (m: LevelMinimum | undefined) => (m === undefined ? 'nada' : m.exact ? `${m.moves} (exacto)` : `≥ ${m.moves}`);
  const before = stored?.levels ?? {};
  const ids = [...new Set([...Object.keys(fresh.levels), ...Object.keys(before)])];
  const changes: string[] = [];
  for (const id of ids) {
    const a = before[id];
    const b = fresh.levels[id];
    if (a?.moves === b?.moves && a?.exact === b?.exact) continue;
    changes.push(`${id}: ${text(a)} → ${text(b)}`);
  }
  if (stored !== null && stored.maxWork !== fresh.maxWork) changes.push(`presupuesto (--estados): ${stored.maxWork} → ${fresh.maxWork}`);
  // Same values in another order still rewrites the file (its order is the levels' order).
  if (changes.length === 0 && stored !== null && Object.keys(before).join() !== Object.keys(fresh.levels).join())
    changes.push('mismo contenido, otro orden de niveles');
  return changes;
}
