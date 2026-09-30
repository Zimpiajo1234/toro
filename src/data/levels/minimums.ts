/**
 * Fewest box moves per level, for the optional move counter (GameSnapshot.moves): the solver's «movimientos» metric
 * (src/data/levels/solver.ts, docs/LEVELS.md), precomputed into src/data/levelMinimums.json by
 * `npm run levels -- --minimos` (src/data/levels/minimumsBuild.ts). Nothing is solved at runtime: this module only
 * reads that file. minimums.test.ts recomputes it and fails when a level changed and the file is stale.
 *
 * The file lives in src/data, not next to the levels: every `*.json` in src/data/levels is loaded as a level.
 */
import data from '../levelMinimums.json';

/** The fewest box moves (one pick + one drop each, the count GameSnapshot.moves keeps) that finish a level. */
export interface LevelMinimum {
  /** Fewest moves: exact, or only a proven lower bound when `exact` is false. */
  readonly moves: number;
  /**
   * The solver's exact search finished: nobody can do it in fewer moves (in its conservative carrying model). false =
   * its work budget ran out first: `moves` is a lower bound, to show as «mín. ≥ N» (a plan that short may not exist).
   */
  readonly exact: boolean;
}

/** Shape of src/data/levelMinimums.json. */
export interface MinimumsFile {
  readonly $comment: string;
  /** Work budget of the exact search the file was computed with (solver.minMoves `maxWork`), reused to check it. */
  readonly maxWork: number;
  /** By level id: the game's levels by order, then the special ones (especiales/). */
  readonly levels: Readonly<Record<string, LevelMinimum>>;
}

/** The checked-in file as imported (tooling and tests compare it with a fresh computation). */
export const MINIMUMS_FILE: MinimumsFile = data;

const BY_ID = new Map<string, LevelMinimum>(
  Object.entries(MINIMUMS_FILE.levels).map(([id, m]) => [id, Object.freeze({ moves: m.moves, exact: m.exact })]),
);

/**
 * The precomputed minimum of a level by id (the same frozen object on every call, cheap to call each frame), or null
 * when the file has none for it: a level built inline (tests), or one the model cannot finish.
 */
export function levelMinimum(levelId: string): LevelMinimum | null {
  return BY_ID.get(levelId) ?? null;
}
