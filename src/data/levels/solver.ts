/**
 * Grid model of a level and the box-move searches built on it. Shared by the level tests (levels.test.ts), the
 * autopilot planner (src/integration/levelsPlayable.test.ts) and the level metrics / `npm run levels`
 * (metrics.ts): one model, no copies. Pure: no DOM, no three, no GameState.
 *
 * Conservative carrying model (the real controller slides, arcs and reverses, so it is more permissive):
 * - the forklift sits on a cell centre facing one of 4 directions; the carried box occupies the cell ahead;
 * - it only drives forward (no reverse gear): the forklift's next cell and the one after it must be free;
 * - a 90° turn in place needs the new front cell and the diagonal the box sweeps through free
 *   (≈ 2 cells of clearance, the design rule for lanes where the forklift turns while carrying);
 * - stacks block like any box, except as a drop target: a stack with room that ends up right ahead (after a
 *   forward step or a turn) takes the box on top.
 * State = the boxes (colour × symbol) stacked on every cell (identical boxes are interchangeable) + the region the
 * empty forklift can reach. A move lifts the top box of a stack and drops it on the floor or on a stack with room.
 * Zones accept by their criteria (core/sorting); in a sorting level a layout that leaves the loose boxes without a
 * complete sorting (a trap) costs one more move.
 */
import {
  COLOR_IDS,
  SYMBOL_IDS,
  cellToWorld,
  type CellPos,
  type LevelBox,
  type LevelData,
  type LevelZone,
  type Vec2,
  type ZoneCriteria,
} from '../../core/types';
import { assignBoxes, criteriaOf, meets, sortableOf, usesSymbols, type Sortable } from '../../core/sorting';

/* ------------------------------------------------------------------ */
/* Grid model                                                          */
/* ------------------------------------------------------------------ */

/** Grid directions, clockwise: east (+x), south (+z), west (-x), north (-z). Adjacent indices are 90° apart. */
export const DIR_X = [1, 0, -1, 0] as const;
export const DIR_Z = [0, 1, 0, -1] as const;
export const TURNS = [1, 3] as const;

/** Static view of a level on its grid. Cells are indexed `z * width + x`. */
export class LevelGrid {
  readonly width: number;
  readonly depth: number;
  readonly cellCount: number;
  readonly size: { width: number; depth: number };
  /** 1 where a shelf or a plant stands. */
  readonly solid: Uint8Array;
  /**
   * Per zone cell, what each box of its stack must meet, bottom → top: the zone's own criteria (color and / or
   * symbol) for the bottom box, then the colors of its recipe. null off zones.
   */
  readonly steps: (ZoneCriteria[] | null)[];
  readonly stackLimit: number;
  /** The level sorts by symbol (docs/SORTING.md): the search also looks for a complete sorting (see misplacedCount). */
  readonly sorting: boolean;
  /** Neighbour of each cell in each direction (cell * 4 + dir), -1 outside the warehouse. */
  private readonly neighbours: Int32Array;

  constructor(level: LevelData) {
    this.width = level.size.width;
    this.depth = level.size.depth;
    this.size = { width: this.width, depth: this.depth };
    this.cellCount = this.width * this.depth;
    this.solid = new Uint8Array(this.cellCount);
    this.steps = new Array<ZoneCriteria[] | null>(this.cellCount).fill(null);
    this.stackLimit = level.stackLimit ?? 1;
    this.sorting = usesSymbols(level);
    for (const s of level.shelves)
      for (let x = s.x; x < s.x + s.w; x++) for (let z = s.z; z < s.z + s.d; z++) this.solid[this.index(x, z)] = 1;
    for (const p of level.decor.plants) this.solid[this.index(p.x, p.z)] = 1;
    for (const zone of level.zones) this.steps[this.index(zone.x, zone.z)] = zoneSteps(zone);
    this.neighbours = new Int32Array(this.cellCount * 4);
    for (let cell = 0; cell < this.cellCount; cell++) {
      for (let dir = 0; dir < 4; dir++) {
        const x = (cell % this.width) + DIR_X[dir];
        const z = Math.floor(cell / this.width) + DIR_Z[dir];
        this.neighbours[cell * 4 + dir] = x >= 0 && z >= 0 && x < this.width && z < this.depth ? this.index(x, z) : -1;
      }
    }
  }

  index(x: number, z: number): number {
    return z * this.width + x;
  }

  cellOf(cell: number): CellPos {
    return { x: cell % this.width, z: Math.floor(cell / this.width) };
  }

  /** World position of a cell centre. */
  center(cell: number): Vec2 {
    return cellToWorld(this.cellOf(cell), this.size);
  }

  /** Neighbour of `cell` in direction `dir`, or -1 outside the warehouse (also for cell -1). */
  step(cell: number, dir: number): number {
    return cell < 0 ? -1 : this.neighbours[cell * 4 + dir];
  }
}

/** A zone's stack steps: its own criteria for the bottom box, then one color per box of its recipe above it. */
export function zoneSteps(zone: LevelZone): ZoneCriteria[] {
  return [criteriaOf(zone), ...(zone.recipe ?? []).slice(1).map((color) => ({ color }))];
}

/**
 * One character per kind of box (color × symbol): a stack is a string of these, bottom → top. Boxes of the same
 * color and symbol are interchangeable (in levels before 19 that is: of the same color).
 */
export function boxCode(box: Sortable): string {
  return String.fromCharCode(65 + COLOR_IDS.indexOf(box.color) * SYMBOL_IDS.length + SYMBOL_IDS.indexOf(box.symbol));
}

const BOX_KINDS_BY_CODE: Sortable[] = COLOR_IDS.flatMap((color) => SYMBOL_IDS.map((symbol) => ({ color, symbol })));

export function boxOfCode(code: string): Sortable {
  return BOX_KINDS_BY_CODE[code.charCodeAt(0) - 65];
}

/** Per cell: the stack resting there as box codes bottom → top ('' = empty). */
export type Stacks = string[];

/** The level's starting stacks (boxes listed on one cell are stacked in list order, bottom first). */
export function stacksOf(grid: LevelGrid, level: LevelData): Stacks {
  const stacks: Stacks = new Array<string>(grid.cellCount).fill('');
  for (const b of level.boxes) stacks[grid.index(b.x, b.z)] += boxCode(sortableOf(b));
  return stacks;
}

/** Occupancy for driving: any stack blocks its cell (0 = occupied, -1 = empty). */
export function occupancyOf(grid: LevelGrid, stacks: Stacks): Int16Array {
  const occupancy = new Int16Array(grid.cellCount).fill(-1);
  for (let c = 0; c < grid.cellCount; c++) if (stacks[c].length > 0) occupancy[c] = 0;
  return occupancy;
}

/** Boxes on a zone that already fit it from the floor up (the bottom one accepted, the rest its recipe's colors). */
export function correctPrefix(grid: LevelGrid, stacks: Stacks, cell: number): number {
  const steps = grid.steps[cell];
  if (!steps) return 0;
  const stack = stacks[cell];
  let n = 0;
  while (n < stack.length && n < steps.length && meets(steps[n], boxOfCode(stack[n]))) n++;
  return n;
}

/** The box `box` (a code) would extend the zone on `cell` right now (it fits the next step of a correct prefix). */
export function extendsZone(grid: LevelGrid, stacks: Stacks, cell: number, box: string): boolean {
  const steps = grid.steps[cell];
  const h = stacks[cell].length;
  return steps !== null && correctPrefix(grid, stacks, cell) === h && h < steps.length && meets(steps[h], boxOfCode(box));
}

/**
 * Sorting levels (one box per zone): the boxes not yet accepted by the zone they rest on can still all be sorted
 * into the zones not yet done, without moving an accepted box again. False = the layout is a dead end until some
 * accepted box moves (e.g. level 23's trap).
 */
export function sortable(grid: LevelGrid, stacks: Stacks): boolean {
  const loose: Sortable[] = [];
  const open: ZoneCriteria[] = [];
  for (let c = 0; c < grid.cellCount; c++) {
    const steps = grid.steps[c];
    const placed = correctPrefix(grid, stacks, c);
    if (steps && placed < steps.length) open.push(steps[0]);
    for (let i = placed; i < stacks[c].length; i++) loose.push(boxOfCode(stacks[c][i]));
  }
  return assignBoxes(loose, open).every((z) => z >= 0);
}

/**
 * Boxes not yet part of a correct prefix on their zone: each must be moved at least once, so this is a lower bound
 * on the moves still needed (on single-box recipes: boxes not on a zone that accepts them; classic levels: not on a
 * zone of their own color). In a sorting level whose loose boxes cannot all be sorted into the zones left (a trap:
 * an ambiguous box took the only zone another box fits), some accepted box must move too: one more. The bound is
 * consistent (one move changes it by at most 1), which the exact search relies on.
 */
export function misplacedCount(grid: LevelGrid, stacks: Stacks, total: number): number {
  let placed = 0;
  for (let c = 0; c < grid.cellCount; c++) if (grid.steps[c]) placed += correctPrefix(grid, stacks, c);
  return total - placed + (grid.sorting && placed < total && !sortable(grid, stacks) ? 1 : 0);
}

/** A stack (not empty) that still has room for one more box. */
export function canStackOn(grid: LevelGrid, stacks: Stacks, cell: number): boolean {
  return cell >= 0 && grid.solid[cell] === 0 && stacks[cell].length > 0 && stacks[cell].length < grid.stackLimit;
}

export function isFree(grid: LevelGrid, occupancy: Int16Array, cell: number): boolean {
  return cell >= 0 && grid.solid[cell] === 0 && occupancy[cell] === -1;
}

/** Cells the empty forklift can drive to: 4-connected floor without shelves, plants or boxes. */
export function reachableFrom(grid: LevelGrid, occupancy: Int16Array, start: number): Uint8Array {
  const region = new Uint8Array(grid.cellCount);
  const queue = [start];
  region[start] = 1;
  for (let q = 0; q < queue.length; q++) {
    for (let dir = 0; dir < 4; dir++) {
      const next = grid.step(queue[q], dir);
      if (next >= 0 && region[next] === 0 && isFree(grid, occupancy, next)) {
        region[next] = 1;
        queue.push(next);
      }
    }
  }
  return region;
}

/** Pick-up poses for the top box at `from` (cell * 4 + dir): facing it from a reachable orthogonal neighbour. */
export function pickupStarts(grid: LevelGrid, region: Uint8Array, from: number): number[] {
  const starts: number[] = [];
  for (let dir = 0; dir < 4; dir++) {
    const approach = grid.step(from, (dir + 2) % 4);
    if (approach >= 0 && region[approach] === 1) starts.push(approach * 4 + dir);
  }
  return starts;
}

/** Every drop the forklift can make while carrying a box (see carrySearch). */
export interface CarryDrops {
  /** Drop cell → every forklift cell the drop can be made from, in discovery order (may repeat). */
  readonly drops: Map<number, number[]>;
  /**
   * Shortest pose chain (cell * 4 + dir, a start pose first) that ends facing the drop cell. A drop on a stack ends
   * with one extra pose (a forward step or a turn) that brings the stack ahead; that pose is never expanded.
   */
  chain(drop: number): number[] | undefined;
}

/**
 * BFS over carry poses from `starts` (`occupancy` / `stacks` already without the carried box: a lifted stack's cell
 * stays occupied while boxes remain under it). The box can be dropped on the free cell ahead in any reached pose, or
 * on a stack with room that a forward step or a turn brings ahead.
 */
export function carrySearch(grid: LevelGrid, occupancy: Int16Array, stacks: Stacks, starts: readonly number[]): CarryDrops {
  const parent = new Int32Array(grid.cellCount * 4).fill(-2);
  const queue: number[] = [];
  for (const s of starts) {
    if (parent[s] === -2) {
      parent[s] = -1;
      queue.push(s);
    }
  }
  const drops = new Map<number, number[]>();
  /** Per drop cell: its forklift cells (the arrays stored in `drops`, in first-found order). */
  const cellsAt: number[][] = [];
  /** First way found to each drop: the pose facing it, plus the extra pose of a drop on a stack (-1 = none). */
  const firstPose = new Int32Array(grid.cellCount);
  const firstExtra = new Int32Array(grid.cellCount);
  // Every recorded drop is a cell of the warehouse: the front of a reached pose is its own box's cell or free floor.
  const record = (drop: number, cell: number, pose: number, extra: number) => {
    const cells = cellsAt[drop];
    if (cells) cells.push(cell);
    else {
      const list = [cell];
      cellsAt[drop] = list;
      drops.set(drop, list);
      firstPose[drop] = pose;
      firstExtra[drop] = extra;
    }
  };
  let pose = -1;
  const visit = (next: number) => {
    if (parent[next] === -2) {
      parent[next] = pose;
      queue.push(next);
    }
  };
  for (let q = 0; q < queue.length; q++) {
    pose = queue[q];
    const cell = pose >> 2;
    const dir = pose & 3;
    const front = grid.step(cell, dir);
    record(front, cell, pose, -1);
    if (isFree(grid, occupancy, front)) {
      const ahead = grid.step(front, dir);
      if (isFree(grid, occupancy, ahead)) visit(front * 4 + dir);
      else if (canStackOn(grid, stacks, ahead)) record(ahead, front, pose, front * 4 + dir);
    }
    for (const turn of TURNS) {
      const next = (dir + turn) % 4;
      if (!isFree(grid, occupancy, grid.step(front, next))) continue;
      const side = grid.step(cell, next);
      if (isFree(grid, occupancy, side)) visit(cell * 4 + next);
      else if (canStackOn(grid, stacks, side)) record(side, cell, pose, cell * 4 + next);
    }
  }
  return {
    drops,
    chain(drop: number) {
      if (drop < 0 || drop >= grid.cellCount || !cellsAt[drop]) return undefined;
      const chain: number[] = firstExtra[drop] === -1 ? [] : [firstExtra[drop]];
      for (let p = firstPose[drop]; p !== -1; p = parent[p]) chain.push(p);
      return chain.reverse();
    },
  };
}

/** Stacks after lifting the top of `from`. */
export function lift(stacks: Stacks, from: number): Stacks {
  const out = stacks.slice();
  out[from] = out[from].slice(0, -1);
  return out;
}

/** A box move: lift the top box of `from`, drop it on `drop` (the floor or the top of a stack). */
export interface Move {
  from: number;
  drop: number;
  /** Forklift cell right after the drop (which side of the box the plan continues from), when known. */
  after?: number;
}

/** A drop the rules allow: not back on its own cell, not into a shelf / plant, not onto a full stack. */
function validDrop(grid: LevelGrid, lifted: Stacks, from: number, drop: number): boolean {
  return drop !== from && drop >= 0 && grid.solid[drop] === 0 && lifted[drop].length < grid.stackLimit;
}

/** Compact, unique text of a state: the non-empty stacks by cell, then the reachable region (its lowest cell). */
function stateKey(layout: string, region: Uint8Array): string {
  return layout + String.fromCharCode(0x100 + region.indexOf(1));
}

/** Non-empty stacks as text: a cell marker (≥ U+0100) followed by its box codes (A–Y). */
function layoutOf(stacks: Stacks): string {
  let s = '';
  for (let c = 0; c < stacks.length; c++) if (stacks[c].length > 0) s += String.fromCharCode(0x100 + c) + stacks[c];
  return s;
}

function stacksOfLayout(layout: string, cellCount: number): Stacks {
  const stacks: Stacks = new Array<string>(cellCount).fill('');
  let cell = 0;
  for (let i = 0; i < layout.length; i++) {
    const code = layout.charCodeAt(i);
    if (code >= 0x100) cell = code - 0x100;
    else stacks[cell] += layout[i];
  }
  return stacks;
}

/* ------------------------------------------------------------------ */
/* Greedy best-first search over "move one box" macro steps             */
/* ------------------------------------------------------------------ */

export interface GreedyOptions {
  /** When false, a box may only go where it extends a zone's recipe (no temporary parking). */
  allowParking: boolean;
  /** Upper bound on expanded states: keeps the search fast and deterministic. */
  maxExpansions: number;
  /**
   * Successors per drop: 'all' = one per distinct region the forklift may end up in (levels.test.ts solve), 'first'
   * = only where the shortest carry chain leaves it (the autopilot planner, which drives that chain).
   */
  regions: 'all' | 'first';
}

export interface GreedyResult {
  /** Box moves of the plan found (not necessarily the fewest), or null. */
  moves: Move[] | null;
  expansions: number;
}

/**
 * Greedy best-first search: states ranked by misplacedCount, LIFO inside a rank (depth-first flavoured); a
 * layout that leaves a sorting level without a complete sorting ranks one step worse, which steers the search away
 * from traps without forbidding them. Deterministic.
 */
export function greedySearch(grid: LevelGrid, stacks0: Stacks, forklift: number, total: number, options: GreedyOptions): GreedyResult {
  interface SearchNode {
    stacks: Stacks;
    forklift: number;
    moves: Move[];
  }
  const buckets: SearchNode[][] = Array.from({ length: total + 2 }, () => []);
  const seen = new Set<string>();
  const push = (stacks: Stacks, cell: number, moves: Move[], region: Uint8Array) => {
    const key = stateKey(layoutOf(stacks), region);
    if (seen.has(key)) return;
    seen.add(key);
    buckets[misplacedCount(grid, stacks, total)].push({ stacks, forklift: cell, moves });
  };
  push(stacks0, forklift, [], reachableFrom(grid, occupancyOf(grid, stacks0), forklift));

  let expansions = 0;
  while (expansions < options.maxExpansions) {
    const bucketIndex = buckets.findIndex((b) => b.length > 0);
    if (bucketIndex < 0) break;
    const node = buckets[bucketIndex].pop();
    if (!node) break;
    if (bucketIndex === 0) return { moves: node.moves, expansions };
    expansions++;

    const occupancy = occupancyOf(grid, node.stacks);
    const region = reachableFrom(grid, occupancy, node.forklift);
    for (let from = 0; from < grid.cellCount; from++) {
      const stack = node.stacks[from];
      if (stack.length === 0) continue;
      const box = stack[stack.length - 1];
      const lifted = lift(node.stacks, from);
      occupancy[from] = lifted[from].length > 0 ? 0 : -1;
      for (const [drop, cells] of carrySearch(grid, occupancy, lifted, pickupStarts(grid, region, from)).drops) {
        if (!validDrop(grid, lifted, from, drop)) continue;
        if (!options.allowParking && !extendsZone(grid, lifted, drop, box)) continue;
        const next = lifted.slice();
        next[drop] += box;
        const before = occupancy[drop];
        occupancy[drop] = 0;
        if (options.regions === 'first') {
          push(next, cells[0], [...node.moves, { from, drop, after: cells[0] }], reachableFrom(grid, occupancy, cells[0]));
        } else {
          // The same drop may leave the forklift on different sides of the box: keep each distinct region.
          const regions: Uint8Array[] = [];
          for (const cell of cells) {
            if (regions.some((r) => r[cell] === 1)) continue;
            const after = reachableFrom(grid, occupancy, cell);
            regions.push(after);
            push(next, cell, [...node.moves, { from, drop, after: cell }], after);
          }
        }
        occupancy[drop] = before;
      }
      occupancy[from] = 0;
    }
  }
  return { moves: null, expansions };
}

export interface SolveOptions {
  /** When false, a box may only go where it extends a zone's recipe (no temporary parking). */
  allowParking: boolean;
  /** Upper bound on expanded states: keeps the test fast and deterministic. */
  maxExpansions: number;
}

export interface SolveResult {
  solved: boolean;
  /** Box moves (pick + drop) of the solution found; not necessarily optimal. -1 when unsolved. */
  moves: number;
  expansions: number;
}

/** Greedy solvability check from the level's start (levels.test.ts). */
export function solve(level: LevelData, options: SolveOptions): SolveResult {
  const grid = new LevelGrid(level);
  const result = greedySearch(grid, stacksOf(grid, level), grid.index(level.forklift.x, level.forklift.z), level.boxes.length, {
    ...options,
    regions: 'all',
  });
  return { solved: result.moves !== null, moves: result.moves?.length ?? -1, expansions: result.expansions };
}

/* ------------------------------------------------------------------ */
/* Fewest moves: A* over box moves                                      */
/* ------------------------------------------------------------------ */

/** No slot of any zone takes this kind of box (validateLevel never lets that happen). */
const NO_SLOT = 99;

/**
 * Per kind of box (code − 65) × cell: the fewest moves a box of that kind resting there needs, when it is not part of
 * a correct stack: 1 if a slot on another cell fits it, 2 if every fitting slot is on its own cell (only the top box
 * of a stack moves and stacks are built from the floor up, so it has to leave and come back).
 */
function slotCosts(grid: LevelGrid): Uint8Array {
  const kinds = COLOR_IDS.length * SYMBOL_IDS.length;
  const costs = new Uint8Array(kinds * grid.cellCount).fill(NO_SLOT);
  for (let k = 0; k < kinds; k++) {
    const box = BOX_KINDS_BY_CODE[k];
    const cells: number[] = [];
    for (let c = 0; c < grid.cellCount; c++) if (grid.steps[c]?.some((step) => meets(step, box))) cells.push(c);
    if (cells.length === 0) continue;
    for (let x = 0; x < grid.cellCount; x++) costs[k * grid.cellCount + x] = cells.some((c) => c !== x) ? 1 : 2;
  }
  return costs;
}

/** What the A* heuristic is made of, for one layout (updated move by move). */
interface Bound {
  /** Boxes in a correct prefix of their zone. */
  placed: number;
  /** Sorting levels: the loose boxes have no complete sorting into the zones left (misplacedCount's +1). */
  trap: boolean;
  /** Σ over the loose boxes of their slotCosts (≥ the number of loose boxes). */
  sum: number;
}

export interface MinMovesOptions {
  /**
   * Work budget: successors examined plus states expanded (default 150 000: at most a few seconds, on a large level
   * built to be hard). When it runs out the result is a proven lower bound (and the best plan found) instead of an
   * exact value.
   */
  maxWork?: number;
  /** Pending successors kept at most (memory guard, default 800 000). */
  maxPending?: number;
  /**
   * Stop as soon as this returns true for the proven range (lower bound, best plan length or null): e.g. once every
   * `dificultad:` target is decided. The result is then exact only if the range already closed.
   */
  until?: (lower: number, upper: number | null) => boolean;
}

export interface MinMovesResult {
  /** Proven lower bound on the box moves needed (equal to `upper` when exact). */
  lower: number;
  /** Moves of the best plan found, or null (none found, or the level cannot be solved in the model). */
  upper: number | null;
  exact: boolean;
  /** A plan with `upper` moves (one of the shortest when exact). */
  plan: Move[] | null;
  /** The whole state space was searched without a solution: unsolvable with the conservative carrying model. */
  unsolvable: boolean;
  /** Distinct states the exact search reached (0 when the first plan already met the lower bound). */
  states: number;
}

interface StarNode {
  layout: string;
  forklift: number;
  g: number;
  bound: Bound;
  h: number;
  parent: StarNode | null;
  move: Move | null;
}

type StarEntry = { node: StarNode; low: number; high: number } | { parent: StarNode; move: Move; bound: Bound; h: number };

interface StarSearch {
  /** Best plan found (optimal when `weight` is 1 and it was found before `stopAt`). */
  plan: Move[] | null;
  /** Weight 1: every plan shorter than this is ruled out. */
  floor: number;
  /** Every reachable state was searched. */
  exhausted: boolean;
  states: number;
  work: number;
}

/**
 * The fewest-moves machinery for one level: the heuristic and a best-first search over f = g + weight · h with
 * partial expansion (a state first generates only the successors of its own f, then waits for its next f; memory
 * stays small). Weight 1 is A*: exact, since the heuristic is consistent. A larger weight finds a good plan fast.
 */
class MoveSearch {
  readonly grid: LevelGrid;
  readonly total: number;
  readonly stacks0: Stacks;
  readonly start: number;
  readonly bound0: Bound;
  readonly h0: number;
  private readonly zoneCells: number[] = [];
  private readonly costs: Uint8Array;

  constructor(level: LevelData) {
    this.grid = new LevelGrid(level);
    this.total = level.boxes.length;
    this.stacks0 = stacksOf(this.grid, level);
    this.start = this.grid.index(level.forklift.x, level.forklift.z);
    for (let c = 0; c < this.grid.cellCount; c++) if (this.grid.steps[c]) this.zoneCells.push(c);
    this.costs = slotCosts(this.grid);
    this.bound0 = this.boundOf(this.stacks0);
    this.h0 = this.heuristic(this.bound0, () => this.blocked(this.stacks0));
  }

  private costOf(box: string, cell: number): number {
    return this.costs[(box.charCodeAt(0) - 65) * this.grid.cellCount + cell];
  }

  private occupied(stacks: Stacks): number[] {
    const cells: number[] = [];
    for (let c = 0; c < stacks.length; c++) if (stacks[c].length > 0) cells.push(c);
    return cells;
  }

  private boundOf(stacks: Stacks): Bound {
    const grid = this.grid;
    let placed = 0;
    let sum = 0;
    for (let c = 0; c < grid.cellCount; c++) {
      const prefix = correctPrefix(grid, stacks, c);
      placed += prefix;
      for (let i = prefix; i < stacks[c].length; i++) sum += this.costOf(stacks[c][i], c);
    }
    return { placed, trap: grid.sorting && placed < this.total && !sortable(grid, stacks), sum };
  }

  /**
   * Admissible, consistent lower bound on the moves left (one move changes it by at most 1): every loose box moves at
   * least once, plus one when the loose boxes have no complete sorting left (a trap) or when no box can be placed by
   * the next move ("blocked", e.g. two boxes on each other's zones) — not both, one move may cure both; and a loose box
   * whose only fitting slots are in its own stack moves at least twice (Σ slotCosts). Never below misplacedCount.
   */
  private heuristic(bound: Bound, blocked: () => boolean): number {
    const loose = this.total - bound.placed;
    const plain = Math.max(loose + (bound.trap ? 1 : 0), bound.sum);
    // «Blocked» only matters when it can raise the bound over the plain loose count.
    return loose > 0 && plain === loose && blocked() ? plain + 1 : plain;
  }

  /** No loose box on top of a stack extends another zone right now (reachability ignored). */
  private blocked(stacks: Stacks): boolean {
    const { looseTops, openSlots } = this.placeSummary(stacks);
    for (const [c, top] of looseTops) for (const [z, step] of openSlots) if (z !== c && meets(step, boxOfCode(top))) return false;
    return true;
  }

  /** Loose top boxes (cell → code) and zones whose correct, unfinished stack takes a box next (cell → criteria). */
  private placeSummary(stacks: Stacks): { looseTops: Map<number, string>; openSlots: Map<number, ZoneCriteria> } {
    const grid = this.grid;
    const looseTops = new Map<number, string>();
    const openSlots = new Map<number, ZoneCriteria>();
    for (let c = 0; c < grid.cellCount; c++) {
      const stack = stacks[c];
      const steps = grid.steps[c];
      const prefix = steps ? correctPrefix(grid, stacks, c) : 0;
      if (stack.length > prefix) looseTops.set(c, stack[stack.length - 1]);
      if (steps && prefix === stack.length && stack.length < steps.length) openSlots.set(c, steps[stack.length]);
    }
    return { looseTops, openSlots };
  }

  search(weight: number, maxWork: number, maxPending: number, stopAt: number | null, onLayer?: (floor: number) => boolean): StarSearch {
    const grid = this.grid;
    const total = this.total;
    const buckets: StarEntry[][] = [];
    let cursor = Infinity;
    let pending = 0;
    let work = 0;
    const closed = new Set<string>();
    /** (layout, forklift cell) pairs already looked at: the same state again, known without a reachability search. */
    const seen = new Set<string>();
    const push = (f: number, entry: StarEntry) => {
      (buckets[f] ??= []).push(entry);
      pending++;
      if (f < cursor) cursor = f;
    };

    /** Pushes the successors of `node` with low < f ≤ high, and the node again for the next f it can reach. */
    const expand = (node: StarNode, low: number, high: number) => {
      work++;
      const stacks = stacksOfLayout(node.layout, grid.cellCount);
      const occupied = this.occupied(stacks);
      const occupancy = occupancyOf(grid, stacks);
      const region = reachableFrom(grid, occupancy, node.forklift);
      const { looseTops, openSlots } = this.placeSummary(stacks);
      // Every (loose top, open slot on another cell) pair that fits: a box that could be placed by the next move.
      const pairs: number[] = [];
      for (const [c, top] of looseTops) {
        const b = boxOfCode(top);
        for (const [z, step] of openSlots) if (z !== c && meets(step, b)) pairs.push(c, z);
      }
      /** After lifting from `from` and dropping on `drop`, no box could be placed by the next move. */
      const blockedAfter = (from: number, drop: number, fromTop: string | null, fromOpen: ZoneCriteria | null, box: string, dropTop: boolean, dropOpen: ZoneCriteria | null) => {
        for (let i = 0; i < pairs.length; i += 2) {
          const c = pairs[i];
          const z = pairs[i + 1];
          if (c !== from && c !== drop && z !== from && z !== drop) return false;
        }
        // Pairs involving what changed: the new tops of `from` / `drop` and the slots they may open.
        const tops: [number, string | null][] = [
          [from, fromTop],
          [drop, dropTop ? box : null],
        ];
        for (const [cell, top] of tops) {
          if (top === null) continue;
          const b = boxOfCode(top);
          for (const [z, step] of openSlots) if (z !== from && z !== drop && z !== cell && meets(step, b)) return false;
          if (fromOpen && cell !== from && meets(fromOpen, b)) return false;
          if (dropOpen && cell !== drop && meets(dropOpen, b)) return false;
        }
        for (const [slot, step] of [
          [from, fromOpen],
          [drop, dropOpen],
        ] as const) {
          if (!step) continue;
          for (const [c, top] of looseTops) if (c !== from && c !== drop && c !== slot && meets(step, boxOfCode(top))) return false;
        }
        return true;
      };
      let next = Infinity;
      for (const from of occupied) {
        const stack = stacks[from];
        const box = stack[stack.length - 1];
        const stepsFrom = grid.steps[from];
        const prefixFrom = stepsFrom ? correctPrefix(grid, stacks, from) : 0;
        const wasPlaced = prefixFrom === stack.length;
        const rest = stack.slice(0, -1);
        stacks[from] = rest;
        occupancy[from] = rest.length > 0 ? 0 : -1;
        const placedLifted = node.bound.placed - (wasPlaced ? 1 : 0);
        const sumLifted = node.bound.sum - (wasPlaced ? 0 : this.costOf(box, from));
        // After the lift: the box below becomes the top of `from`, and a zone there may take a box again.
        const prefixRest = Math.min(prefixFrom, rest.length);
        const fromTop = rest.length > prefixRest ? rest[rest.length - 1] : null;
        const fromOpen = stepsFrom && prefixRest === rest.length && rest.length < stepsFrom.length ? stepsFrom[rest.length] : null;
        for (const [drop, cells] of carrySearch(grid, occupancy, stacks, pickupStarts(grid, region, from)).drops) {
          if (!validDrop(grid, stacks, from, drop)) continue;
          const extendsIt = extendsZone(grid, stacks, drop, box);
          const placed = placedLifted + (extendsIt ? 1 : 0);
          const sum = sumLifted + (extendsIt ? 0 : this.costOf(box, drop));
          let trap = node.bound.trap;
          const was = stacks[drop];
          if (grid.sorting && (stepsFrom !== null || grid.steps[drop] !== null)) {
            stacks[drop] = was + box;
            trap = placed < total && !sortable(grid, stacks);
            stacks[drop] = was;
          }
          const loose = total - placed;
          let h = Math.max(loose + (trap ? 1 : 0), sum);
          if (loose > 0 && h === loose) {
            const stepsDrop = grid.steps[drop];
            const dropOpen = stepsDrop && extendsIt && was.length + 1 < stepsDrop.length ? stepsDrop[was.length + 1] : null;
            if (blockedAfter(from, drop, fromTop, fromOpen, box, !extendsIt, dropOpen)) h++;
          }
          const f = node.g + 1 + weight * h;
          if (f > low && f <= high) {
            const bound: Bound = { placed, trap, sum };
            for (const cell of new Set(cells)) push(f, { parent: node, move: { from, drop, after: cell }, bound, h });
          } else if (f > high && f < next) next = f;
        }
        stacks[from] = stack;
        occupancy[from] = 0;
      }
      if (next < Infinity) push(next, { node, low: high, high: next });
    };

    const root: StarNode = { layout: layoutOf(this.stacks0), forklift: this.start, g: 0, bound: this.bound0, h: this.h0, parent: null, move: null };
    closed.add(stateKey(root.layout, reachableFrom(grid, occupancyOf(grid, this.stacks0), this.start)));
    seen.add(root.layout + String.fromCharCode(0x100 + this.start));
    expand(root, -Infinity, weight * this.h0);

    const done = (plan: Move[] | null, floor: number, exhausted = false): StarSearch => ({ plan, floor, exhausted, states: closed.size, work });
    let layer = -Infinity;
    for (;;) {
      while (cursor < buckets.length && !(buckets[cursor]?.length)) cursor++;
      if (cursor >= buckets.length) return done(null, Infinity, true);
      if (stopAt !== null && weight === 1 && cursor >= stopAt) return done(null, stopAt);
      if (weight === 1 && cursor > layer) {
        // A new f-layer: every plan shorter than `cursor` is ruled out.
        layer = cursor;
        if (onLayer?.(cursor)) return done(null, cursor);
      }
      if (work >= maxWork || pending > maxPending) return done(null, weight === 1 ? cursor : 0);
      const f = cursor;
      const entry = buckets[f].pop()!;
      pending--;
      if ('node' in entry) {
        expand(entry.node, entry.low, entry.high);
        continue;
      }
      work++;
      const stacks = stacksOfLayout(entry.parent.layout, grid.cellCount);
      const box = stacks[entry.move.from].slice(-1);
      stacks[entry.move.from] = stacks[entry.move.from].slice(0, -1);
      stacks[entry.move.drop] += box;
      const layout = layoutOf(stacks);
      const cell = entry.move.after!;
      const pair = layout + String.fromCharCode(0x100 + cell);
      if (seen.has(pair)) continue;
      seen.add(pair);
      const key = stateKey(layout, reachableFrom(grid, occupancyOf(grid, stacks), cell));
      if (closed.has(key)) continue;
      closed.add(key);
      const node: StarNode = { layout, forklift: cell, g: entry.parent.g + 1, bound: entry.bound, h: entry.h, parent: entry.parent, move: entry.move };
      if (node.h === 0) {
        const plan: Move[] = [];
        for (let n: StarNode | null = node; n && n.move; n = n.parent) plan.push(n.move);
        return done(plan.reverse(), weight === 1 ? node.g : 0);
      }
      expand(node, -Infinity, node.g + weight * node.h);
    }
  }
}

/**
 * Fewest box moves to finish the level in the carrying model. First plans: the greedy search, then a weighted
 * search (f = g + 2h) that usually lands on or near the optimum; then A* (weight 1, exact) stops as soon as every
 * plan shorter than the best one is ruled out. When the work budget runs out it reports the proven lower bound and the
 * best plan found as upper bound.
 */
export function minMoves(level: LevelData, options: MinMovesOptions = {}): MinMovesResult {
  const maxWork = options.maxWork ?? 150_000;
  const maxPending = options.maxPending ?? 800_000;
  const search = new MoveSearch(level);
  const { grid, total, stacks0, start, h0 } = search;
  let best = greedySearch(grid, stacks0, start, total, { allowParking: true, maxExpansions: 2000, regions: 'all' }).moves;
  const result = (lower: number, exact: boolean, states: number, unsolvable = false): MinMovesResult => ({
    lower,
    upper: best?.length ?? null,
    exact: exact || (best !== null && best.length === lower),
    plan: best,
    unsolvable,
    states,
  });
  const enough = () => options.until?.(h0, best?.length ?? null) === true;
  if ((best && best.length === h0) || enough()) return result(h0, false, 0);
  let budget = maxWork;
  if (!best || best.length > h0 + 1) {
    const quick = search.search(2, Math.max(1, Math.floor(maxWork / 2)), maxPending, null);
    budget -= quick.work;
    if (quick.plan && (!best || quick.plan.length < best.length)) best = quick.plan;
    if ((best && best.length === h0) || enough()) return result(h0, false, quick.states);
  }
  const until = options.until;
  const exact = search.search(1, Math.max(1, budget), maxPending, best ? best.length : null, until && ((floor) => until(floor, best?.length ?? null)));
  if (exact.plan) best = exact.plan;
  if (exact.plan || (best && (exact.floor >= best.length || exact.exhausted))) return result(best!.length, true, exact.states);
  if (exact.exhausted) return result(h0, false, exact.states, true);
  return result(Math.max(h0, exact.floor), false, exact.states);
}

/* ------------------------------------------------------------------ */
/* Static helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Boxes that start on a zone above the part of its stack that already fits it from the floor up (classic levels: a
 * box on a zone of another color; sorting levels: a box the zone does not accept). They must move before that zone
 * can be finished.
 */
export function misplacedBoxes(level: LevelData): LevelBox[] {
  const grid = new LevelGrid(level);
  const stacks = stacksOf(grid, level);
  const seen = new Array<number>(grid.cellCount).fill(0);
  return level.boxes.filter((b) => {
    const cell = grid.index(b.x, b.z);
    // List order is bottom → top, so the count so far is this box's level in its stack.
    const index = seen[cell]++;
    return grid.steps[cell] !== null && index >= correctPrefix(grid, stacks, cell);
  });
}

/** Zones that start with a wrong box somewhere in their stack (classic levels: covered by another color). */
export function blockedZones(level: LevelData): LevelZone[] {
  const grid = new LevelGrid(level);
  const stacks = stacksOf(grid, level);
  return level.zones.filter((z) => {
    const cell = grid.index(z.x, z.z);
    return correctPrefix(grid, stacks, cell) < stacks[cell].length;
  });
}

/**
 * Replays `moves` in the model from the level's start: true when every move can be made (the box on top of `from`
 * reachable, carried to `drop`, the forklift ending on `after` when given) and the level ends solved.
 */
export function replayMoves(level: LevelData, moves: readonly Move[]): boolean {
  const grid = new LevelGrid(level);
  let stacks = stacksOf(grid, level);
  let forklift = grid.index(level.forklift.x, level.forklift.z);
  for (const { from, drop, after } of moves) {
    if (from < 0 || from >= grid.cellCount || stacks[from].length === 0) return false;
    const occupancy = occupancyOf(grid, stacks);
    const region = reachableFrom(grid, occupancy, forklift);
    const lifted = lift(stacks, from);
    occupancy[from] = lifted[from].length > 0 ? 0 : -1;
    const cells = carrySearch(grid, occupancy, lifted, pickupStarts(grid, region, from)).drops.get(drop);
    if (!cells || !validDrop(grid, lifted, from, drop) || (after !== undefined && !cells.includes(after))) return false;
    lifted[drop] += stacks[from].slice(-1);
    stacks = lifted;
    forklift = after ?? cells[0];
  }
  return misplacedCount(grid, stacks, level.boxes.length) === 0;
}
