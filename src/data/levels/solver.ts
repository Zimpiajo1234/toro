/**
 * Grid model of a level and the box-move searches built on it. Shared by the level tests (levels.test.ts), the
 * autopilot (src/integration/autopilot.ts) and the level metrics / `npm run levels` (metrics.ts): one model, no
 * copies. Pure: no DOM, no three, no GameState.
 *
 * Conservative carrying model (the real controller slides and arcs, so it is more permissive):
 * - the forklift sits on a cell centre facing one of 4 directions; the carried box occupies the cell ahead;
 * - it drives forward (the forklift's next cell and the one after it must be free) or, like S in the game, straight
 *   back in reverse (the cell behind it must be free; `LevelGrid` option `reverse: false` = forward only);
 * - a 90° turn in place needs the new front cell and the diagonal the box sweeps through free
 *   (≈ 2 cells of clearance, the design rule for lanes where the forklift turns while carrying);
 * - stacks block like any box, except as a drop target: a stack with room that ends up right ahead (after a
 *   forward step or a turn) takes the box on top.
 * State = the boxes (colour × symbol) stacked on every cell (identical boxes are interchangeable) + the region the
 * empty forklift can reach. A move lifts the top box of a stack and drops it on the floor or on a stack with room.
 * Zones accept by their criteria (core/sorting); in a sorting level a layout that leaves the loose boxes without a
 * complete sorting (a trap) costs one more move.
 *
 * With the reverse gear every move can be undone (drive the same poses backwards and put the box back), so no state
 * the forklift can reach is a dead end; `deadEnds` checks that on the states around a shortest plan. In a level with
 * racks, a box placed on its destiny is locked (see below): those moves cannot be undone, so they are checked in full.
 *
 * Storage racks (docs/RACKS.md): rack cells are solid; every slot is one more position after the floor cells
 * (`cellCount + slot`, core/racks `slotsOf` order) holding at most one box. A slot is loaded only from its column's
 * front cell, facing the rack: a forward step from the cell behind it onto the front cell puts the box in (any empty
 * slot of the column: the forks choose the level), and a box lifted out of a slot starts inside the rack, where the
 * only way out is straight back. In a level with racks every zone and every slot with a cue takes exactly its
 * destined kind of box (the level's unique assignment), so the goal is fixed and there are no traps; and a box resting
 * alone on its destined zone or slot is locked, as in the game (BoxState.locked): it is never lifted again and nothing
 * is dropped on it (`lockedAt`). A move there can no longer be undone, so the dead-end check fully checks it.
 *
 * Loading docks (docs/DOCKS.md): the truck waits outside the building, so each bed column is one more position after
 * the rack slots (`cellCount + slotCount + column`, core/docks `truckColumnsOf` order), off the map beyond the wall;
 * its door cell is plain floor. It holds a stack, like a stack zone whose steps are the destined kinds of its levels
 * bottom → top (its capacity is its column's levels, not the level's stack limit). It is reached only from its door
 * cell facing the wall, as a rack column from its front cell: one step on from the cell behind the door cell loads the
 * box on top (the box goes through the door), and a box lifted off it backs straight out. The boxes of its correct
 * prefix (satisfied levels) are locked: the top one is never lifted, but a box may still be loaded on top of it.
 * Levels with trucks follow the rules of levels with racks (fixed destinies, no traps, locks).
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
import { assignBoxes, criteriaOf, cueOf, levelDestinies, meets, sortableOf, usesSymbols, type Sortable } from '../../core/sorting';
import { racksOf, rackCellOf, slotsOf } from '../../core/racks';
import { truckColumnsOf, usesTargetRules } from '../../core/docks';

/* ------------------------------------------------------------------ */
/* Grid model                                                          */
/* ------------------------------------------------------------------ */

/** Grid directions, clockwise: east (+x), south (+z), west (-x), north (-z). Adjacent indices are 90° apart. */
export const DIR_X = [1, 0, -1, 0] as const;
export const DIR_Z = [0, 1, 0, -1] as const;
export const TURNS = [1, 3] as const;

export interface GridOptions {
  /**
   * The loaded forklift may also back up in a straight line (S). Default true, like the game's controls; false = the
   * older forward-only model (only for comparisons and tests).
   */
  reverse?: boolean;
}

/** Grid direction (DIR_X / DIR_Z index) that points into a rack (or a truck bed) from its front (door) cell. */
const INWARD_DIR = { north: 1, east: 2, south: 3, west: 0 } as const;

/**
 * Static view of a level on its grid. Cells are indexed `z * width + x`; positions (where boxes rest) are the cells,
 * then one per storage rack slot (`cellCount + slot`), then one per truck bed column (`bedBase + column`, outside the
 * map).
 */
export class LevelGrid {
  /** Carrying may back up in a straight line (see GridOptions). */
  readonly reverse: boolean;
  readonly width: number;
  readonly depth: number;
  readonly cellCount: number;
  /** Rack slots (0 without racks). */
  readonly slotCount: number;
  /** First truck bed position: cellCount + slotCount. */
  readonly bedBase: number;
  /** Positions: cellCount + slotCount + truck bed columns. Stacks arrays have this length. */
  readonly posCount: number;
  readonly size: { width: number; depth: number };
  /** 1 where a shelf, a plant or a storage rack stands (a dock's door cells are floor). */
  readonly solid: Uint8Array;
  /**
   * Per position, what each box of its stack must meet, bottom → top: on a zone cell the zone's own criteria (color
   * and / or symbol) for the bottom box, then the colors of its recipe; on a rack slot its cue. In a level with racks
   * or trucks every zone and slot with a cue asks for exactly its destined kind instead, and a truck bed column the
   * destined kind of each of its levels, bottom → top. null off targets.
   */
  readonly steps: (ZoneCriteria[] | null)[];
  readonly stackLimit: number;
  /** The level sorts by symbol (docs/SORTING.md): the search also looks for a complete sorting (see misplacedCount). */
  readonly sorting: boolean;
  /** The level has storage racks (docs/RACKS.md). */
  readonly racks: boolean;
  /** The level has racks or trucks (docs/RACKS.md, docs/DOCKS.md): fixed destinies, locks, no traps. */
  readonly targets: boolean;
  /** Per position: the levels of a truck bed column (docs/DOCKS.md), 0 on every other position. */
  readonly bedLevels: Uint8Array;
  /** Per truck bed position: its door cell and the direction into the truck from there, toward the wall (-1 elsewhere). */
  readonly bedFront: Int32Array;
  readonly bedDir: Int8Array;
  /** Per truck bed column (position − bedBase): its bed cell, outside the map. */
  readonly bedCells: readonly CellPos[];
  /** Per pose (cell * 4 + dir): the truck bed position right ahead of it (on its door cell facing the wall), or -1. */
  readonly bedAtPose: Int32Array;
  /** Neighbour of each cell in each direction, indexed like a pose (cell * 4 + dir); -1 outside the warehouse. */
  readonly links: Int32Array;
  /** Rack column on each cell, or -1. */
  readonly columnAt: Int32Array;
  /** Per rack column: the direction into the rack (a pose facing it from the front cell) and its slot positions, bottom → top. */
  readonly columnDir: Int8Array;
  readonly columnSlots: readonly (readonly number[])[];
  /** Per slot (position − cellCount): its rack cell, front cell and direction into the rack. */
  readonly slotCell: Int32Array;
  readonly slotFront: Int32Array;
  readonly slotDir: Int8Array;

  constructor(level: LevelData, options: GridOptions = {}) {
    this.reverse = options.reverse ?? true;
    this.width = level.size.width;
    this.depth = level.size.depth;
    this.size = { width: this.width, depth: this.depth };
    this.cellCount = this.width * this.depth;
    const slots = slotsOf(level);
    const beds = truckColumnsOf(level);
    this.slotCount = slots.length;
    this.bedBase = this.cellCount + this.slotCount;
    this.posCount = this.bedBase + beds.length;
    this.solid = new Uint8Array(this.cellCount);
    this.steps = new Array<ZoneCriteria[] | null>(this.posCount).fill(null);
    this.stackLimit = level.stackLimit ?? 1;
    this.racks = slots.length > 0;
    this.targets = this.racks || usesTargetRules(level);
    this.sorting = usesSymbols(level) && !this.targets;
    for (const s of level.shelves)
      for (let x = s.x; x < s.x + s.w; x++) for (let z = s.z; z < s.z + s.d; z++) this.solid[this.index(x, z)] = 1;
    for (const p of level.decor.plants) this.solid[this.index(p.x, p.z)] = 1;
    this.columnAt = new Int32Array(this.cellCount).fill(-1);
    const columnDir: number[] = [];
    const columnSlots: number[][] = [];
    this.slotCell = new Int32Array(this.slotCount);
    this.slotFront = new Int32Array(this.slotCount);
    this.slotDir = new Int8Array(this.slotCount);
    for (const rack of racksOf(level)) {
      rack.columns.forEach((_, column) => {
        const cell = rackCellOf(rack, column);
        this.solid[this.index(cell.x, cell.z)] = 1;
        this.columnAt[this.index(cell.x, cell.z)] = columnSlots.length;
        columnDir.push(INWARD_DIR[rack.facing]);
        columnSlots.push([]);
      });
    }
    slots.forEach((slot, i) => {
      const column = this.columnAt[this.index(slot.cell.x, slot.cell.z)];
      columnSlots[column].push(this.cellCount + i);
      this.slotCell[i] = this.index(slot.cell.x, slot.cell.z);
      this.slotFront[i] = this.index(slot.front.x, slot.front.z);
      this.slotDir[i] = columnDir[column];
    });
    this.columnDir = Int8Array.from(columnDir);
    this.columnSlots = columnSlots;
    this.bedLevels = new Uint8Array(this.posCount);
    this.bedFront = new Int32Array(this.posCount).fill(-1);
    this.bedDir = new Int8Array(this.posCount).fill(-1);
    this.bedCells = beds.map((bed) => ({ x: bed.cell.x, z: bed.cell.z }));
    this.bedAtPose = new Int32Array(this.cellCount * 4).fill(-1);
    beds.forEach((bed, i) => {
      const pos = this.bedBase + i;
      const door = this.index(bed.front.x, bed.front.z);
      this.bedLevels[pos] = bed.cues.length;
      this.bedFront[pos] = door;
      this.bedDir[pos] = INWARD_DIR[bed.facing];
      this.bedAtPose[door * 4 + INWARD_DIR[bed.facing]] = pos;
    });
    const destinies = levelDestinies(level);
    level.zones.forEach((zone, i) => {
      const destined = destinies?.zones[i];
      this.steps[this.index(zone.x, zone.z)] = destined ? [{ color: destined.color, symbol: destined.symbol }] : zoneSteps(zone);
    });
    slots.forEach((slot, i) => {
      const destined = destinies?.slots[i];
      const cue = cueOf(slot.rack.columns[slot.column][slot.level]);
      this.steps[this.cellCount + i] = destined ? [{ color: destined.color, symbol: destined.symbol }] : cue ? [cue] : null;
    });
    beds.forEach((bed, i) => {
      // Each level asks for its destined kind (its cue if the level has no unique assignment, as a hand-built one).
      this.steps[this.bedBase + i] = bed.cues.map((cue, lvl) => {
        const destined = destinies?.trucks[bed.firstSlot + lvl];
        return destined ? { color: destined.color, symbol: destined.symbol } : { ...cue };
      });
    });
    this.links = new Int32Array(this.cellCount * 4);
    for (let cell = 0; cell < this.cellCount; cell++) {
      for (let dir = 0; dir < 4; dir++) {
        const x = (cell % this.width) + DIR_X[dir];
        const z = Math.floor(cell / this.width) + DIR_Z[dir];
        this.links[cell * 4 + dir] = x >= 0 && z >= 0 && x < this.width && z < this.depth ? this.index(x, z) : -1;
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

  /** Neighbour of `cell` in direction `dir`, or -1 outside the warehouse (also for cell -1 and for a slot position). */
  step(cell: number, dir: number): number {
    return cell < 0 || cell >= this.cellCount ? -1 : this.links[cell * 4 + dir];
  }

  /**
   * Position of a box resting on (x, z): its rack slot when (x, z) is a rack cell and `level` names the slot, its truck
   * bed column when (x, z) is a bed cell (outside the map), else the cell (-1 outside the map anywhere else).
   */
  posOf(x: number, z: number, level?: number): number {
    if (x < 0 || z < 0 || x >= this.width || z >= this.depth) {
      const bed = this.bedCells.findIndex((c) => c.x === x && c.z === z);
      return bed >= 0 ? this.bedBase + bed : -1;
    }
    const cell = this.index(x, z);
    const column = this.columnAt[cell];
    return column >= 0 && level !== undefined ? (this.columnSlots[column][level] ?? cell) : cell;
  }

  /** The cell of a position: a floor cell itself, a slot's rack cell, a truck bed column's bed cell (outside the map). */
  cellOfPos(pos: number): CellPos {
    if (this.isBed(pos)) return { ...this.bedCells[pos - this.bedBase] };
    return this.cellOf(this.isSlot(pos) ? this.slotCell[pos - this.cellCount] : pos);
  }

  /** A rack slot position (not a floor cell, not a truck bed). */
  isSlot(pos: number): boolean {
    return pos >= this.cellCount && pos < this.bedBase;
  }

  /** A truck bed column (docs/DOCKS.md): a stack outside the map, reached only from its door cell. */
  isBed(pos: number): boolean {
    return pos >= this.bedBase && pos < this.posCount;
  }

  /** The floor cell a position is reached at: the cell itself, a slot's front cell or a truck bed's door cell. */
  accessOf(pos: number): number {
    if (this.isBed(pos)) return this.bedFront[pos];
    return this.isSlot(pos) ? this.slotFront[pos - this.cellCount] : pos;
  }

  /** Most boxes a position holds: 1 in a rack slot, its levels on a truck bed, else the level's stack limit. */
  capacity(pos: number): number {
    if (this.isBed(pos)) return this.bedLevels[pos];
    return this.isSlot(pos) ? 1 : this.stackLimit;
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

/**
 * The level's starting stacks (boxes listed on one cell are stacked in list order, bottom first; boxes loaded on a truck
 * bed by their level), one entry per position (rack slots after the floor cells, then the truck bed columns).
 */
export function stacksOf(grid: LevelGrid, level: LevelData): Stacks {
  const stacks: Stacks = new Array<string>(grid.posCount).fill('');
  const onBed = (b: LevelBox) => grid.isBed(grid.posOf(b.x, b.z, b.level));
  for (const b of level.boxes) if (!onBed(b)) stacks[grid.posOf(b.x, b.z, b.level)] += boxCode(sortableOf(b));
  const loaded = level.boxes.filter(onBed).sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
  for (const b of loaded) stacks[grid.posOf(b.x, b.z, b.level)] += boxCode(sortableOf(b));
  return stacks;
}

/** Occupancy for driving: any stack blocks its cell (0 = occupied, -1 = empty). */
export function occupancyOf(grid: LevelGrid, stacks: Stacks): Int16Array {
  const occupancy = new Int16Array(grid.cellCount).fill(-1);
  for (let c = 0; c < grid.cellCount; c++) if (stacks[c].length > 0) occupancy[c] = 0;
  return occupancy;
}

/**
 * Levels with racks or trucks: the position's top box is locked, its destined box alone on its zone or in its slot (the
 * game's BoxState.locked), or on a truck bed a satisfied level (every box of the stack in its correct prefix). It is
 * never lifted again; nothing is dropped on a locked zone or slot box, while a truck bed still takes the next level on
 * top (validDrop). Always false in levels without racks or trucks.
 */
export function lockedAt(grid: LevelGrid, stacks: Stacks, pos: number): boolean {
  if (!grid.targets || pos < 0 || pos >= grid.posCount) return false;
  const steps = grid.steps[pos];
  if (steps === null) return false;
  if (grid.isBed(pos)) return stacks[pos].length > 0 && correctPrefix(grid, stacks, pos) === stacks[pos].length;
  return stacks[pos].length === 1 && meets(steps[0], boxOfCode(stacks[pos]));
}

/** The top box of `pos` can be lifted: there is one and it is not locked (lockedAt). */
export function canLift(grid: LevelGrid, stacks: Stacks, pos: number): boolean {
  return stacks[pos].length > 0 && !lockedAt(grid, stacks, pos);
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
  for (let c = 0; c < grid.posCount; c++) {
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
  for (let c = 0; c < grid.posCount; c++) if (grid.steps[c]) placed += correctPrefix(grid, stacks, c);
  return total - placed + (grid.sorting && placed < total && !sortable(grid, stacks) ? 1 : 0);
}

/**
 * A stack (not empty) on the floor that still has room for one more box (never a locked box: lockedAt; never a truck
 * bed, off the floor and loaded through its door only).
 */
export function canStackOn(grid: LevelGrid, stacks: Stacks, cell: number): boolean {
  return (
    cell >= 0 &&
    cell < grid.cellCount &&
    grid.solid[cell] === 0 &&
    stacks[cell].length > 0 &&
    stacks[cell].length < grid.stackLimit &&
    !lockedAt(grid, stacks, cell)
  );
}

export function isFree(grid: LevelGrid, occupancy: Int16Array, cell: number): boolean {
  return cell >= 0 && cell < grid.cellCount && grid.solid[cell] === 0 && occupancy[cell] === -1;
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

/** The 8 neighbours around a cell, in ring order (N, NE, E, SE, S, SW, W, NW) as (dx, dz). */
const RING = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
] as const;

/**
 * Cheap region bookkeeping for one lift (the forklift's region `region` — lowest cell `lowest` — with the box still on
 * `from`): after the move the empty forklift's region is the old one plus `from` minus `drop`, unless lifting joins
 * `from` to another region or the drop cuts the region in two. `lowestAfter(drop)` returns the lowest cell of the new
 * region in the easy case, or -1 when the caller must search it (reachableFrom). `occupancy` is the one after the lift.
 */
export function regionShift(grid: LevelGrid, occupancy: Int16Array, region: Uint8Array, lowest: number, from: number) {
  // Rack slots and truck beds are off the floor: lifting from or dropping into one changes no region.
  const free = (c: number) => c >= 0 && c < grid.cellCount && grid.solid[c] === 0 && occupancy[c] === -1;
  // Lifting may open `from` onto floor the forklift could not reach before: then everything needs a search.
  let joins = false;
  for (let d = 0; d < 4 && !grid.isBed(from); d++) {
    const n = grid.step(from, d);
    if (free(n) && region[n] === 0) joins = true;
  }
  const lowestNow = free(from) ? Math.min(lowest, from) : lowest;
  return {
    lowestAfter(drop: number): number {
      if (joins) return -1;
      if (!free(drop)) return lowestNow; // a drop on a stack changes no floor
      if (drop === lowestNow) return -1;
      // The drop can only cut the region if its open neighbours are not joined around it (8-ring runs).
      const x = drop % grid.width;
      const z = Math.floor(drop / grid.width);
      const open = RING.map(([dx, dz]) => {
        const nx = x + dx;
        const nz = z + dz;
        return nx >= 0 && nz >= 0 && nx < grid.width && nz < grid.depth && free(grid.index(nx, nz));
      });
      // Count the open runs around the ring that hold an orthogonal neighbour (consecutive ring cells share an edge).
      const closed = open.indexOf(false);
      if (closed < 0) return lowestNow;
      let runs = 0;
      let inRun = false;
      let orthogonal = false;
      for (let n = 1; n <= 8; n++) {
        const k = (closed + n) % 8;
        if (open[k]) {
          if (!inRun) (inRun = true), (orthogonal = false);
          if (k % 2 === 0) orthogonal = true;
        } else if (inRun) {
          inRun = false;
          if (orthogonal) runs++;
        }
      }
      return runs <= 1 ? lowestNow : -1;
    },
  };
}

/**
 * Pick-up poses for the top box at `from` (cell * 4 + dir): facing it from a reachable orthogonal neighbour; for a rack
 * slot, facing the rack from its column's front cell; for a truck bed, facing the wall from its door cell.
 */
export function pickupStarts(grid: LevelGrid, region: Uint8Array, from: number): number[] {
  const starts: number[] = [];
  if (grid.isSlot(from)) {
    const slot = from - grid.cellCount;
    const front = grid.slotFront[slot];
    if (region[front] === 1) starts.push(front * 4 + grid.slotDir[slot]);
    return starts;
  }
  if (grid.isBed(from)) {
    const front = grid.bedFront[from];
    if (region[front] === 1) starts.push(front * 4 + grid.bedDir[from]);
    return starts;
  }
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
   * Cheapest pose chain (cell * 4 + dir, a start pose first) that ends facing the drop cell. A drop on a stack ends
   * with one extra pose (a forward step or a turn) that brings the stack ahead; that pose is never expanded.
   * Consecutive poses differ by one step: a forward step, a turn in place or (reverse gear) a step back.
   */
  chain(drop: number): number[] | undefined;
  /** Like `chain`, for the first way found that leaves the forklift on `cell` (one of `drops.get(drop)`). */
  chainTo(drop: number, cell: number): number[] | undefined;
}

/**
 * Search over carry poses from `starts` (`occupancy` / `stacks` already without the carried box: a lifted stack's cell
 * stays occupied while boxes remain under it). The box can be dropped on the free cell ahead in any reached pose, or
 * on a stack with room (not a locked box) that a forward step or a turn brings ahead, into an empty rack slot that a
 * forward step onto its front cell (facing the rack) brings ahead, or on top of a truck bed column with room (a locked
 * box included) that a forward step onto its door cell (facing the wall) brings ahead, through the door. A turn never
 * puts the box in a rack or a truck. A start pose with the box inside a rack or on a truck bed (just lifted off it) can
 * only back straight out. Chains are the cheapest ones, a step back (grid.reverse) counting double, so a chain only
 * backs up when that saves driving.
 */
export function carrySearch(grid: LevelGrid, occupancy: Int16Array, stacks: Stacks, starts: readonly number[]): CarryDrops {
  const links = grid.links;
  const solid = grid.solid;
  const limit = grid.stackLimit;
  const reverse = grid.reverse;
  const parent = new Int32Array(grid.cellCount * 4).fill(-2);
  // Cheapest chains first (Dial's buckets): a forward step or a turn costs 1, a step back 2, like the slower reverse
  // gear of the game. Which drops exist does not depend on it; only which chain reaches each one first.
  const cost = new Int32Array(grid.cellCount * 4).fill(0x7fffffff);
  const buckets: number[][] = [[]];
  for (const s of starts) {
    if (cost[s] !== 0) {
      cost[s] = 0;
      parent[s] = -1;
      buckets[0].push(s);
    }
  }
  const reach = (next: number, from: number, c: number) => {
    if (c < cost[next]) {
      cost[next] = c;
      parent[next] = from;
      (buckets[c] ??= []).push(next);
    }
  };
  /** Poses in the order they were settled (cheapest first). */
  const queue: number[] = [];
  const free = (cell: number) => cell >= 0 && solid[cell] === 0 && occupancy[cell] === -1;
  const targets = grid.targets;
  const stackable = (cell: number) =>
    cell >= 0 && solid[cell] === 0 && stacks[cell].length > 0 && stacks[cell].length < limit && !(targets && lockedAt(grid, stacks, cell));
  const columnAt = grid.columnAt;
  const bedLevels = grid.bedLevels;
  const bedAtPose = grid.bedAtPose;
  /** The pose's box is inside a rack column or on a truck bed beyond a door (only a start pose: just lifted off it). */
  const inside = (pose: number) => {
    const front = links[pose];
    return (front >= 0 && columnAt[front] >= 0) || bedAtPose[pose] >= 0;
  };
  const drops = new Map<number, number[]>();
  /** Per drop position: its forklift cells (the arrays stored in `drops`, in first-found order). */
  const cellsAt: number[][] = [];
  /** First way found to each drop: the pose facing it, plus the extra pose of a drop on a stack or into a slot (-1 = none). */
  const firstPose = new Int32Array(grid.posCount);
  const firstExtra = new Int32Array(grid.posCount);
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
  for (let c = 0; c < buckets.length; c++) {
    const bucket = buckets[c];
    if (!bucket) continue;
    for (let q = 0; q < bucket.length; q++) {
      const pose = bucket[q];
      if (cost[pose] !== c) continue; // reached again later, more cheaply
      queue.push(pose);
      const cell = pose >> 2;
      const dir = pose & 3;
      const front = links[pose];
      if (inside(pose)) {
        // The box is inside a rack or on a truck bed (just lifted off it): only straight back out.
        if (reverse) {
          const back = links[pose - dir + ((dir + 2) & 3)];
          if (free(back)) reach(back * 4 + dir, pose, c + 2);
        }
        continue;
      }
      record(front, cell, pose, -1);
      if (free(front)) {
        const ahead = links[front * 4 + dir];
        if (free(ahead)) reach(front * 4 + dir, pose, c + 1);
        else if (stackable(ahead)) record(ahead, front, pose, front * 4 + dir);
        else if (ahead >= 0 && columnAt[ahead] >= 0 && grid.columnDir[columnAt[ahead]] === dir) {
          // Facing a rack column from behind its front cell: one step on puts the box into any empty slot.
          for (const slot of grid.columnSlots[columnAt[ahead]]) if (stacks[slot].length === 0) record(slot, front, pose, front * 4 + dir);
        } else {
          // Facing the wall from behind a door cell: one step on takes the box through the door, on top of the bed.
          const bed = bedAtPose[front * 4 + dir];
          if (bed >= 0 && stacks[bed].length < bedLevels[bed]) record(bed, front, pose, front * 4 + dir);
        }
      }
      for (let turn = 1; turn < 4; turn += 2) {
        const d = (dir + turn) & 3;
        if (!free(links[front * 4 + d])) continue;
        const side = links[pose - dir + d];
        if (free(side)) reach(pose - dir + d, pose, c + 1);
        else if (stackable(side)) record(side, cell, pose, pose - dir + d);
      }
      if (reverse) {
        // Back up one cell: the box follows into the cell the forklift leaves.
        const back = links[pose - dir + ((dir + 2) & 3)];
        if (free(back)) reach(back * 4 + dir, pose, c + 2);
      }
    }
  }
  const chainOf = (pose: number, extra: number) => {
    const chain: number[] = extra === -1 ? [] : [extra];
    for (let p = pose; p !== -1; p = parent[p]) chain.push(p);
    return chain.reverse();
  };
  return {
    drops,
    chain(drop: number) {
      if (drop < 0 || drop >= grid.posCount || !cellsAt[drop]) return undefined;
      return chainOf(firstPose[drop], firstExtra[drop]);
    },
    chainTo(drop: number, cell: number) {
      if (grid.isSlot(drop)) {
        // A slot: from the cell behind its front cell, one step on (the forklift ends on the front cell).
        const slot = drop - grid.cellCount;
        const front = grid.slotFront[slot];
        const dir = grid.slotDir[slot];
        if (cell !== front || !cellsAt[drop]) return undefined;
        for (const pose of queue) if ((pose & 3) === dir && links[pose] === front && columnAt[pose >> 2] < 0) return chainOf(pose, front * 4 + dir);
        return undefined;
      }
      if (grid.isBed(drop)) {
        // A truck bed: from the cell behind its door cell, one step on (the forklift ends on the door cell).
        const front = grid.bedFront[drop];
        const dir = grid.bedDir[drop];
        if (cell !== front || !cellsAt[drop]) return undefined;
        for (const pose of queue) if ((pose & 3) === dir && links[pose] === front && !inside(pose)) return chainOf(pose, front * 4 + dir);
        return undefined;
      }
      // The first settled pose (cheapest first) that makes this drop from this cell, as `record` saw it.
      for (const pose of queue) {
        if (inside(pose)) continue; // a pose with the box still inside a rack or on a truck bed drops nothing
        const at = pose >> 2;
        const dir = pose & 3;
        const front = links[pose];
        if (at === cell && front === drop) return chainOf(pose, -1);
        if (front === cell && free(front) && links[front * 4 + dir] === drop && !free(drop) && stackable(drop)) return chainOf(pose, front * 4 + dir);
        if (at !== cell || free(drop) || !stackable(drop)) continue;
        for (let turn = 1; turn < 4; turn += 2) {
          const d = (dir + turn) & 3;
          if (links[pose - dir + d] === drop && free(links[front * 4 + d])) return chainOf(pose, pose - dir + d);
        }
      }
      return undefined;
    },
  };
}

/**
 * The undo test of the dead-end check: every carry pose (cell * 4 + dir, box ahead) from which the carrying rules of
 * carrySearch lead to a drop on `target` that leaves the forklift on a cell with `end[cell] === 1`. Same `occupancy` /
 * `stacks` as carrySearch (without the carried box). A pose whose front is occupied (a pick from the top of a stack)
 * can only be a starting pose, so nothing leads into it.
 */
export function carryBackTo(grid: LevelGrid, occupancy: Int16Array, stacks: Stacks, target: number, end: Uint8Array): Uint8Array {
  const found = new Uint8Array(grid.cellCount * 4);
  const queue: number[] = [];
  const free = (cell: number) => isFree(grid, occupancy, cell);
  const add = (pose: number) => {
    if (found[pose] === 0) {
      found[pose] = 1;
      queue.push(pose);
    }
  };
  const stackable = canStackOn(grid, stacks, target);
  if (grid.isSlot(target)) {
    // Into a slot: the last pose stands behind the column's front cell facing the rack (the box on the front cell);
    // one step on leaves the forklift on the front cell.
    const slot = target - grid.cellCount;
    const front = grid.slotFront[slot];
    const dir = grid.slotDir[slot];
    const behind = grid.step(front, (dir + 2) % 4);
    if (stacks[target].length === 0 && free(front) && end[front] === 1 && free(behind)) add(behind * 4 + dir);
  }
  if (grid.isBed(target)) {
    // Onto a truck bed: the same, from behind its door cell facing the wall, while the column has room.
    const front = grid.bedFront[target];
    const dir = grid.bedDir[target];
    const behind = grid.step(front, (dir + 2) % 4);
    if (stacks[target].length < grid.bedLevels[target] && free(front) && end[front] === 1 && free(behind)) add(behind * 4 + dir);
  }
  for (let dir = 0; dir < 4 && !grid.isSlot(target) && !grid.isBed(target); dir++) {
    // `before` is the cell next to the target on the side the forklift comes from, facing `dir`.
    const before = grid.step(target, (dir + 2) % 4);
    if (!free(before) || end[before] !== 1) continue;
    if (free(target)) {
      add(before * 4 + dir); // facing the free target: drop on it
    } else if (stackable) {
      // A forward step from one cell further back brings the stack ahead (the forklift ends on `before`).
      const further = grid.step(before, (dir + 2) % 4);
      if (free(further)) add(further * 4 + dir);
      // A turn on `before` brings it to the side: the box sweeps the diagonal (the forklift stays on `before`).
      for (const turn of TURNS) {
        const from = (dir + turn) % 4;
        if (free(grid.step(grid.step(before, from), dir))) add(before * 4 + from);
      }
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const pose = queue[q];
    const cell = pose >> 2;
    const dir = pose & 3;
    // Only a pose whose box is over free floor can be the result of a step.
    if (!free(grid.step(cell, dir))) continue;
    // Reached by a forward step from the cell behind.
    const behind = grid.step(cell, (dir + 2) % 4);
    if (free(behind)) add(behind * 4 + dir);
    // Reached by a turn in place from a pose facing a side (the box swept the diagonal toward `dir`).
    for (const turn of TURNS) {
      const from = (dir + turn) % 4;
      if (free(grid.step(grid.step(cell, from), dir))) add(cell * 4 + from);
    }
    // Reached by backing up from the cell ahead.
    if (grid.reverse) add(grid.step(cell, dir) * 4 + dir);
  }
  return found;
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

/**
 * A drop the rules allow: not back where it was, not into a shelf / plant / rack cell, not onto a full stack, slot or
 * truck bed column, nor onto a locked zone or slot box (a truck bed column takes its next level on a locked box).
 */
function validDrop(grid: LevelGrid, lifted: Stacks, from: number, drop: number): boolean {
  if (drop === from || drop < 0 || drop >= grid.posCount) return false;
  if (grid.isSlot(drop)) return lifted[drop].length === 0;
  if (grid.isBed(drop)) return lifted[drop].length < grid.bedLevels[drop];
  return grid.solid[drop] === 0 && lifted[drop].length < grid.stackLimit && !lockedAt(grid, lifted, drop);
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

/**
 * The layout after moving the top box of `from` onto `drop` (both given as cells; `box` is that box's code): the
 * same text layoutOf would write for the new stacks, built by editing the two segments only.
 */
function moveInLayout(layout: string, from: number, drop: number, box: string): string {
  // Take the box off the end of `from`'s segment (and the segment itself when it was the only box).
  const fromMark = String.fromCharCode(0x100 + from);
  const at = layout.indexOf(fromMark);
  let end = at + 1;
  while (end < layout.length && layout.charCodeAt(end) < 0x100) end++;
  let s = end - at === 2 ? layout.slice(0, at) + layout.slice(end) : layout.slice(0, end - 1) + layout.slice(end);
  // Put it on top of `drop`'s segment, or open a new segment in cell order.
  const dropMark = String.fromCharCode(0x100 + drop);
  const to = s.indexOf(dropMark);
  if (to >= 0) {
    let stop = to + 1;
    while (stop < s.length && s.charCodeAt(stop) < 0x100) stop++;
    return s.slice(0, stop) + box + s.slice(stop);
  }
  let i = 0;
  while (i < s.length && !(s.charCodeAt(i) >= 0x100 && s.charCodeAt(i) - 0x100 > drop)) i++;
  s = s.slice(0, i) + dropMark + box + s.slice(i);
  return s;
}

/** The code of the top box on `cell` in a layout (the cell must hold a stack). */
function topOfLayout(layout: string, cell: number): string {
  let end = layout.indexOf(String.fromCharCode(0x100 + cell)) + 1;
  while (end < layout.length && layout.charCodeAt(end) < 0x100) end++;
  return layout[end - 1];
}

/** Occupancy (as occupancyOf) of a layout: every floor cell with a stack is occupied (rack slots are off the floor). */
function occupancyOfLayout(layout: string, cellCount: number): Int16Array {
  const occupancy = new Int16Array(cellCount).fill(-1);
  for (let i = 0; i < layout.length; i++) {
    const code = layout.charCodeAt(i);
    if (code >= 0x100 && code - 0x100 < cellCount) occupancy[code - 0x100] = 0;
  }
  return occupancy;
}

/** Stacks of a layout, one entry per position (`posCount`). */
function stacksOfLayout(layout: string, posCount: number): Stacks {
  const stacks: Stacks = new Array<string>(posCount).fill('');
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
    layout: string;
    forklift: number;
    parent: SearchNode | null;
    move: Move | null;
  }
  const buckets: SearchNode[][] = Array.from({ length: total + 2 }, () => []);
  const seen = new Set<string>();
  const root: SearchNode = { layout: layoutOf(stacks0), forklift, parent: null, move: null };
  seen.add(stateKey(root.layout, reachableFrom(grid, occupancyOf(grid, stacks0), forklift)));
  buckets[misplacedCount(grid, stacks0, total)].push(root);
  const movesOf = (node: SearchNode) => {
    const moves: Move[] = [];
    for (let n: SearchNode | null = node; n && n.move; n = n.parent) moves.push(n.move);
    return moves.reverse();
  };

  let expansions = 0;
  while (expansions < options.maxExpansions) {
    let rank = -1;
    for (let b = 0; b < buckets.length && rank < 0; b++) if (buckets[b].length > 0) rank = b;
    if (rank < 0) break;
    const node = buckets[rank].pop()!;
    if (rank === 0) return { moves: movesOf(node), expansions };
    expansions++;

    // One stacks array per expansion, edited in place for each move and put back.
    const stacks = stacksOfLayout(node.layout, grid.posCount);
    const occupancy = occupancyOf(grid, stacks);
    const region = reachableFrom(grid, occupancy, node.forklift);
    const lowest = region.indexOf(1);
    for (let from = 0; from < grid.posCount; from++) {
      const stack = stacks[from];
      if (!canLift(grid, stacks, from)) continue;
      const starts = pickupStarts(grid, region, from);
      if (starts.length === 0) continue;
      const box = stack[stack.length - 1];
      const wasPlaced = grid.steps[from] !== null && correctPrefix(grid, stacks, from) === stack.length;
      const floorFrom = from < grid.cellCount;
      stacks[from] = stack.slice(0, -1);
      if (floorFrom) occupancy[from] = stacks[from].length > 0 ? 0 : -1;
      const shift = regionShift(grid, occupancy, region, lowest, from);
      for (const [drop, cells] of carrySearch(grid, occupancy, stacks, starts).drops) {
        if (!validDrop(grid, stacks, from, drop)) continue;
        const placing = extendsZone(grid, stacks, drop, box);
        if (!options.allowParking && !placing) continue;
        const layout = moveInLayout(node.layout, from, drop, box);
        const quick = shift.lowestAfter(drop);
        const floorDrop = drop < grid.cellCount;
        const before = floorDrop ? occupancy[drop] : 0;
        if (floorDrop) occupancy[drop] = 0;
        // The new state's rank: counted from the move, or (sorting levels: traps) measured on the edited stacks.
        let nextRank = -1;
        const rankOf = () => {
          if (nextRank >= 0) return nextRank;
          if (!grid.sorting) return (nextRank = rank + (wasPlaced ? 1 : 0) - (placing ? 1 : 0));
          const was = stacks[drop];
          stacks[drop] = was + box;
          nextRank = misplacedCount(grid, stacks, total);
          stacks[drop] = was;
          return nextRank;
        };
        const add = (cell: number, lowestAfter: number) => {
          const key = layout + String.fromCharCode(0x100 + lowestAfter);
          if (seen.has(key)) return;
          seen.add(key);
          buckets[rankOf()].push({ layout, forklift: cell, parent: node, move: { from, drop, after: cell } });
        };
        if (quick >= 0) {
          // Connectivity unchanged: every cell the drop can be made from lies in the same region.
          add(cells[0], quick);
        } else if (options.regions === 'first') {
          add(cells[0], reachableFrom(grid, occupancy, cells[0]).indexOf(1));
        } else {
          // The same drop may leave the forklift on different sides of the box: keep each distinct region.
          const regions: Uint8Array[] = [];
          for (const cell of cells) {
            if (regions.some((r) => r[cell] === 1)) continue;
            const after = reachableFrom(grid, occupancy, cell);
            regions.push(after);
            add(cell, after.indexOf(1));
          }
        }
        if (floorDrop) occupancy[drop] = before;
      }
      stacks[from] = stack;
      if (floorFrom) occupancy[from] = 0;
    }
  }
  return { moves: null, expansions };
}

export interface SolveOptions extends GridOptions {
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
  const grid = new LevelGrid(level, options);
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
  const n = grid.posCount;
  const costs = new Uint8Array(kinds * n).fill(NO_SLOT);
  for (let k = 0; k < kinds; k++) {
    const box = BOX_KINDS_BY_CODE[k];
    const cells: number[] = [];
    for (let c = 0; c < n; c++) if (grid.steps[c]?.some((step) => meets(step, box))) cells.push(c);
    if (cells.length === 0) continue;
    for (let x = 0; x < n; x++) costs[k * n + x] = cells.some((c) => c !== x) ? 1 : 2;
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
  /** Classic levels: swap cycles no free zone breaks (MoveSearch.closedCycles), 0 elsewhere. */
  cycles: number;
  /** Of those, the ones none of whose colours has a zone in a dead-end corridor (they add to the corridor bound). */
  apart: number;
  /** Levels without stacks: extra moves dead-end corridors force (MoveSearch.corridorBonus, summed). */
  corridor: number;
  /** Sorting levels with a single complete sorting of distinct boxes: boxes resting on their own destination. */
  home: number;
  /** Such levels: cycles of boxes each resting on the next one's destination (destinationCycles), and those clear of corridors. */
  destCycles: number;
  destApart: number;
  /** Such levels: the corridor bound with «in place» meaning «on its destination» (corridorBonus with dest). */
  corridorDest: number;
}

export interface MinMovesOptions extends GridOptions {
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

/** Colour index (COLOR_IDS) of each box code, by char code. */
const COLOR_OF_CODE = Int8Array.from({ length: 65 + COLOR_IDS.length * SYMBOL_IDS.length }, (_, c) => (c < 65 ? -1 : Math.floor((c - 65) / SYMBOL_IDS.length)));

/**
 * Dead-end corridors of the static layout (shelves, plants, walls): chains of cells, deepest first, that start at a
 * cell with a single open neighbour and go on while each cell has exactly two, up to the first cell with more (the
 * mouth, not included). Only chains of two cells or more. Anything reaching a cell of the chain goes through every
 * cell between it and the mouth: last in, first out.
 */
export function deadEndCorridors(grid: LevelGrid): number[][] {
  const open = (c: number) => c >= 0 && grid.solid[c] === 0;
  const degree = (c: number) => [0, 1, 2, 3].filter((d) => open(grid.step(c, d))).length;
  const corridors: number[][] = [];
  const used = new Uint8Array(grid.cellCount);
  for (let end = 0; end < grid.cellCount; end++) {
    if (!open(end) || used[end] === 1 || degree(end) !== 1) continue;
    const chain = [end];
    used[end] = 1;
    for (;;) {
      const last = chain[chain.length - 1];
      const next = [0, 1, 2, 3].map((d) => grid.step(last, d)).find((c) => open(c) && used[c] === 0 && c !== chain[chain.length - 2]);
      if (next === undefined || degree(next) !== 2) break;
      chain.push(next);
      used[next] = 1;
    }
    if (chain.length >= 2) corridors.push(chain);
  }
  return corridors;
}

/**
 * Sorting levels: when every box is of a different kind and there is exactly one complete sorting (each box on a zone
 * that accepts it, one per zone), each box has a fixed destination: the zone cell per kind (code − 65), else null.
 */
function uniqueDestinations(grid: LevelGrid, stacks: Stacks): Int16Array | null {
  const kinds: number[] = [];
  for (const stack of stacks) for (const code of stack) kinds.push(code.charCodeAt(0) - 65);
  if (new Set(kinds).size !== kinds.length) return null;
  const zones: number[] = [];
  for (let c = 0; c < grid.cellCount; c++) if (grid.steps[c]) zones.push(c);
  if (zones.length !== kinds.length) return null;
  const used = new Uint8Array(zones.length);
  const pick: number[] = [];
  let found: number[] | null = null;
  let count = 0;
  const place = (i: number) => {
    if (count > 1) return;
    if (i === kinds.length) {
      count++;
      found = pick.slice();
      return;
    }
    const box = BOX_KINDS_BY_CODE[kinds[i]];
    zones.forEach((z, j) => {
      if (used[j] === 1 || !meets(grid.steps[z]![0], box)) return;
      used[j] = 1;
      pick.push(z);
      place(i + 1);
      pick.pop();
      used[j] = 0;
    });
  };
  place(0);
  const assignment = found as number[] | null;
  if (count !== 1 || !assignment) return null;
  const destOf = new Int16Array(BOX_KINDS_BY_CODE.length).fill(-1);
  kinds.forEach((kind, i) => (destOf[kind] = assignment[i]));
  return destOf;
}

/**
 * Levels with racks or trucks: every target asks for its destined kind, so a kind with a single target has a fixed
 * destination. Per kind (code − 65): that target when it is a one-box target (a zone or a slot), else -1 (kinds with
 * several targets, and those whose target is a truck level: truck beds are stacks, never a node of destinationCycles).
 * null when some target does not name an exact kind (a hand-built level with no unique assignment).
 */
function targetDestinations(grid: LevelGrid): Int16Array | null {
  const count = new Int16Array(BOX_KINDS_BY_CODE.length);
  const at = new Int16Array(BOX_KINDS_BY_CODE.length).fill(-1);
  for (let c = 0; c < grid.posCount; c++) {
    const steps = grid.steps[c];
    if (!steps) continue;
    for (const step of steps) {
      if (step.color === undefined || step.symbol === undefined) return null;
      const kind = COLOR_IDS.indexOf(step.color) * SYMBOL_IDS.length + SYMBOL_IDS.indexOf(step.symbol);
      count[kind]++;
      at[kind] = grid.isBed(c) ? -1 : c;
    }
  }
  for (let kind = 0; kind < at.length; kind++) if (count[kind] !== 1) at[kind] = -1;
  return at;
}

/**
 * The fewest-moves machinery from one state (a level's start, or any layout + forklift cell): the heuristic and a
 * best-first search over f = g + weight · h with partial expansion (a state first generates only the successors of
 * its own f, then waits for its next f; memory stays small). Weight 1 is A*: exact, since the heuristic is
 * consistent. A larger weight finds a good plan fast.
 */
class MoveSearch {
  readonly bound0: Bound;
  readonly h0: number;
  private readonly zoneCells: number[] = [];
  private readonly costs: Uint8Array;
  /**
   * Classic levels (one box per zone, colour only): colour of the zone on each zone cell, for the swap-cycle bound
   * (closedCycles). null in stacking and sorting levels.
   */
  private readonly zoneColor: Int8Array | null;
  private readonly uf = new Int8Array(COLOR_IDS.length);
  /** Classic levels: colours with a zone inside a dead-end corridor (bit per COLOR_IDS index). */
  private corridorColors = 0;
  /** Set by closedCycles: how many of the closed groups it counted keep clear of corridorColors. */
  private lastApart = 0;
  /** Levels without stacks: dead-end corridors (deadEndCorridors) for the corridor bound; empty otherwise. */
  private readonly corridors: number[][];
  /** Corridor index of each cell, -1 outside any. */
  private readonly corridorOf: Int16Array;
  /** Per box kind (code − 65) × corridor: 1 when every zone that accepts that kind lies in that corridor. */
  private readonly onlyIn: Uint8Array;
  /**
   * Sorting levels whose boxes are all different and have one complete sorting: the zone cell each kind of box ends on
   * (by code − 65, -1 for kinds not in the level). Levels with racks or trucks: the one-box target of each kind that
   * has a single one (targetDestinations). null otherwise.
   */
  private readonly destOf: Int16Array | null;
  /** Set by destinationCycles: how many of the cycles it counted keep clear of every corridor. */
  private lastDestApart = 0;

  constructor(
    readonly grid: LevelGrid,
    readonly stacks0: Stacks,
    readonly start: number,
    readonly total: number,
  ) {
    for (let c = 0; c < grid.posCount; c++) if (grid.steps[c]) this.zoneCells.push(c);
    this.costs = slotCosts(grid);
    // The swap-cycle and corridor bounds reason about floor zones only: off in levels with racks or trucks (whose slots
    // and beds are reached from their front and door cells), where the plain bounds stay admissible and consistent.
    const classic = !grid.sorting && !grid.targets && grid.stackLimit === 1 && this.zoneCells.every((c) => grid.steps[c]!.length === 1);
    this.zoneColor = classic ? new Int8Array(grid.cellCount).fill(-1) : null;
    if (this.zoneColor) for (const c of this.zoneCells) this.zoneColor[c] = COLOR_IDS.indexOf(grid.steps[c]![0].color!);
    this.corridors = grid.stackLimit === 1 && !grid.targets ? deadEndCorridors(grid) : [];
    this.corridorOf = new Int16Array(grid.posCount).fill(-1);
    this.corridors.forEach((cells, k) => cells.forEach((c) => (this.corridorOf[c] = k)));
    if (this.zoneColor) for (const c of this.zoneCells) if (this.corridorOf[c] >= 0) this.corridorColors |= 1 << this.zoneColor[c];
    const kinds = BOX_KINDS_BY_CODE.length;
    this.onlyIn = new Uint8Array(kinds * Math.max(1, this.corridors.length));
    for (let kind = 0; kind < kinds; kind++) {
      const homes = this.zoneCells.filter((c) => meets(grid.steps[c]![0], BOX_KINDS_BY_CODE[kind]));
      if (homes.length === 0) continue;
      const k = this.corridorOf[homes[0]];
      if (k >= 0 && homes.every((c) => this.corridorOf[c] === k)) this.onlyIn[kind * this.corridors.length + k] = 1;
    }
    this.destOf = grid.sorting && grid.stackLimit === 1 ? uniqueDestinations(grid, stacks0) : grid.targets ? targetDestinations(grid) : null;
    this.bound0 = this.boundOf(stacks0);
    this.h0 = this.heuristic(this.bound0, () => this.blocked(stacks0));
  }

  /**
   * Sorting levels with fixed destinations (destOf): the boxes that rest on a zone other than their destination point
   * to it; every cycle of such boxes (each on the next one's destination, like two boxes on each other's zones) needs
   * one move that does not bring a box home, whether it parks the box or puts it in a trap: a bound on top of the boxes
   * not yet home (never on top of the accepted-based count, since a trap move is «accepted» and breaks a cycle at once).
   * Also leaves in `lastDestApart` the cycles with no cell in a dead-end corridor (their boxes are not the ones the
   * corridor bound counts). 0 when destinations are not fixed. Levels with racks or trucks: the same on their one-box
   * targets (zones and slots, their bottom box; truck beds are left out), where it adds to the plain slot costs (see
   * heuristic).
   */
  private destinationCycles(stacks: Stacks): number {
    const destOf = this.destOf;
    this.lastDestApart = 0;
    if (!destOf) return 0;
    const next = new Map<number, number>();
    for (const c of this.zoneCells) {
      const stack = stacks[c];
      if (stack.length === 0 || this.grid.isBed(c)) continue;
      const d = destOf[stack.charCodeAt(0) - 65];
      if (d >= 0 && d !== c) next.set(c, d);
    }
    let cycles = 0;
    const state = new Map<number, number>(); // 1 = on the current walk, 2 = done
    for (const startCell of next.keys()) {
      if (state.has(startCell)) continue;
      const walk: number[] = [];
      let c: number | undefined = startCell;
      while (c !== undefined && !state.has(c)) {
        state.set(c, 1);
        walk.push(c);
        c = next.get(c);
      }
      if (c !== undefined && state.get(c) === 1) {
        cycles++;
        const cycle = walk.slice(walk.indexOf(c));
        if (cycle.every((cell) => this.corridorOf[cell] < 0)) this.lastDestApart++;
      }
      for (const cell of walk) state.set(cell, 2);
    }
    return cycles;
  }

  private homeCount(stacks: Stacks): number {
    const destOf = this.destOf;
    if (!destOf) return 0;
    let home = 0;
    for (const c of this.zoneCells) if (stacks[c].length > 0 && destOf[stacks[c].charCodeAt(0) - 65] === c) home++;
    return home;
  }

  /** The heuristic of any state of this level (the forklift's place does not enter it). */
  estimate(stacks: Stacks): number {
    return this.heuristic(this.boundOf(stacks), () => this.blocked(stacks));
  }

  private costOf(box: string, cell: number): number {
    return this.costs[(box.charCodeAt(0) - 65) * this.grid.posCount + cell];
  }

  /**
   * The box (a code) is in place on `cell`: accepted by the zone there (false off zones), or with `dest`, `cell` is its
   * destination (destOf). Levels without stacks.
   */
  private fits(cell: number, box: string, dest = false): boolean {
    if (dest) return this.destOf![box.charCodeAt(0) - 65] === cell;
    const steps = this.grid.steps[cell];
    return steps !== null && meets(steps[0], boxOfCode(box));
  }

  /** Every place the box can end in lies in corridor `k`: every zone accepting its kind, or with `dest` its destination. */
  private only(box: string, k: number, dest: boolean): boolean {
    const kind = box.charCodeAt(0) - 65;
    if (dest) return this.corridorOf[this.destOf![kind]] === k;
    return this.onlyIn[kind * this.corridors.length + k] === 1;
  }

  /**
   * Corridor bound, levels without stacks: in dead-end corridor `k`, let the deepest unfinished cell be the deepest
   * zone without a box it accepts, or the deepest other cell holding a box. Filling it (or taking its box out) needs
   * every shallower cell of the corridor empty, so each box resting there moves one more time than the plain bound
   * says: a box that sits on its zone leaves and comes back (+2) unless another zone outside the corridor takes it or it
   * can go straight into the empty cell below (+1); a loose box whose every zone lies in the corridor leaves and comes
   * back (+1) unless it can go straight into that empty cell; and a wrong box on that deepest zone, whose every zone lies
   * in the corridor too, has to wait outside (+1). One move lowers it by at most one more than it places, so the bound
   * stays consistent. With `dest` (fixed destinations), «in place» means on its destination and «every zone» its
   * destination: the same argument for the destination-based count.
   */
  private corridorBonus(stacks: Stacks, k: number, dest = false): number {
    const cells = this.corridors[k];
    let i = 0;
    for (; i < cells.length; i++) {
      const stack = stacks[cells[i]];
      if (this.grid.steps[cells[i]] ? stack.length === 0 || !this.fits(cells[i], stack, dest) : stack.length > 0) break;
    }
    if (i >= cells.length) return 0;
    const star = cells[i];
    const waiting = stacks[star];
    let bonus = 0;
    for (let j = i + 1; j < cells.length; j++) {
      const box = stacks[cells[j]];
      if (box.length === 0) continue;
      const only = this.only(box, k, dest);
      const intoStar = waiting.length === 0 && this.fits(star, box, dest);
      if (this.fits(cells[j], box, dest)) bonus += intoStar || !only ? 1 : 2;
      else if (only && !intoStar) bonus += 1;
    }
    if (waiting.length > 0 && this.grid.steps[star] && this.only(waiting, k, dest)) bonus += 1;
    return bonus;
  }

  private corridorTotal(stacks: Stacks, dest = false): number {
    let total = 0;
    for (let k = 0; k < this.corridors.length; k++) total += this.corridorBonus(stacks, k, dest);
    return total;
  }

  /**
   * Classic levels: swap cycles that no free zone can break. Colours are the nodes; a box on a zone of another colour
   * links the two. A group of linked colours none of whose zones is free (so no box of those colours rests off the
   * zones either: every colour has as many boxes as zones) cannot place any of its boxes before one of them is set
   * aside: at least one move that places nothing, per group (two boxes on each other's zones need 3 moves, not 2).
   * One move opens at most one group, so the bound stays consistent. 0 in other levels. Also leaves in `lastApart` the
   * groups none of whose colours has a zone in a dead-end corridor: their set-aside moves are moves of boxes that are
   * not in any corridor, so they add to the corridor bound (a move that closes a group is a placement, and a group
   * only starts or stops touching a corridor with its zones, which never move).
   */
  private closedCycles(stacks: Stacks): number {
    const zoneColor = this.zoneColor;
    if (!zoneColor) return 0;
    const parent = this.uf;
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (a: number): number => {
      while (parent[a] !== a) a = parent[a] = parent[parent[a]];
      return a;
    };
    let linked = 0;
    let free = 0;
    for (const c of this.zoneCells) {
      const zc = zoneColor[c];
      const stack = stacks[c];
      if (stack.length === 0) {
        free |= 1 << zc;
        continue;
      }
      const bc = COLOR_OF_CODE[stack.charCodeAt(0)];
      if (bc === zc) continue;
      linked |= (1 << zc) | (1 << bc);
      parent[find(zc)] = find(bc);
    }
    this.lastApart = 0;
    if (linked === 0) return 0;
    let groups = 0;
    let open = 0;
    let touching = 0;
    for (let i = 0; i < parent.length; i++) {
      if (free & (1 << i)) open |= 1 << find(i);
      if (this.corridorColors & (1 << i)) touching |= 1 << find(i);
    }
    for (let i = 0; i < parent.length; i++) {
      if (!(linked & (1 << i)) || find(i) !== i || open & (1 << i)) continue;
      groups++;
      if (!(touching & (1 << i))) this.lastApart++;
    }
    return groups;
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
    for (let c = 0; c < grid.posCount; c++) {
      const prefix = correctPrefix(grid, stacks, c);
      placed += prefix;
      for (let i = prefix; i < stacks[c].length; i++) sum += this.costOf(stacks[c][i], c);
    }
    return {
      placed,
      trap: grid.sorting && placed < this.total && !sortable(grid, stacks),
      sum,
      cycles: this.closedCycles(stacks),
      apart: this.lastApart,
      corridor: this.corridorTotal(stacks),
      home: this.homeCount(stacks),
      destCycles: this.destinationCycles(stacks),
      destApart: this.lastDestApart,
      corridorDest: this.destOf ? this.corridorTotal(stacks, true) : 0,
    };
  }

  /**
   * Admissible, consistent lower bound on the moves left (one move changes it by at most 1): every loose box moves at
   * least once, plus one when the loose boxes have no complete sorting left (a trap) or when no box can be placed by
   * the next move ("blocked", e.g. two boxes on each other's zones) — not both, one move may cure both; plus, in
   * classic levels, one per closed swap cycle (closedCycles, which covers «blocked» when there is one); and a loose box
   * whose only fitting slots are in its own stack moves at least twice (Σ slotCosts). Never below misplacedCount.
   * Levels with racks or trucks: Σ slotCosts plus one per cycle of boxes resting on each other's one-box destinations
   * (destinationCycles: such a box has a destination elsewhere, so it costs 1, and some box of the cycle must move once
   * without being placed; a move places a box, breaks one cycle or sets a box on its own destination, never two of
   * these, so the bound stays consistent).
   */
  private heuristic(bound: Bound, blocked: () => boolean): number {
    const loose = this.total - bound.placed;
    const plain = Math.max(
      loose + (bound.trap ? 1 : 0),
      bound.sum,
      loose + bound.cycles,
      loose + bound.apart + bound.corridor,
      this.destTerm(bound.home, bound.sum, bound.destCycles, bound.destApart, bound.corridorDest),
    );
    // «Blocked» only matters when it can raise the bound over the plain loose count.
    return loose > 0 && plain === loose && blocked() ? plain + 1 : plain;
  }

  /** The fixed-destination part of the heuristic (0 when destinations are not fixed). */
  private destTerm(home: number, sum: number, destCycles: number, destApart: number, corridorDest: number): number {
    if (!this.destOf) return 0;
    if (this.grid.targets) return sum + destCycles;
    return this.total - home + Math.max(destCycles, destApart + corridorDest);
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
    for (let c = 0; c < grid.posCount; c++) {
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
      const stacks = stacksOfLayout(node.layout, grid.posCount);
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
      // Corridor bound of this state, per corridor (a move only changes the ones it lifts from or drops into).
      const corridorBefore = this.corridors.map((_, k) => this.corridorBonus(stacks, k));
      const corridorDestBefore = this.destOf ? this.corridors.map((_, k) => this.corridorBonus(stacks, k, true)) : [];
      let next = Infinity;
      for (const from of occupied) {
        if (!canLift(grid, stacks, from)) continue;
        const stack = stacks[from];
        const box = stack[stack.length - 1];
        const stepsFrom = grid.steps[from];
        const prefixFrom = stepsFrom ? correctPrefix(grid, stacks, from) : 0;
        const wasPlaced = prefixFrom === stack.length;
        const rest = stack.slice(0, -1);
        const floorFrom = from < grid.cellCount;
        stacks[from] = rest;
        if (floorFrom) occupancy[from] = rest.length > 0 ? 0 : -1;
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
          let cycles = node.bound.cycles;
          let apart = node.bound.apart;
          let corridor = node.bound.corridor;
          let home = node.bound.home;
          let destCycles = node.bound.destCycles;
          let destApart = node.bound.destApart;
          let corridorDest = node.bound.corridorDest;
          const was = stacks[drop];
          const kFrom = this.corridorOf[from];
          const kDrop = this.corridorOf[drop];
          const cyclic = this.destOf !== null && grid.targets;
          if (((grid.sorting || this.zoneColor || cyclic) && (stepsFrom !== null || grid.steps[drop] !== null)) || kFrom >= 0 || kDrop >= 0) {
            stacks[drop] = was + box;
            if (cyclic) {
              destCycles = this.destinationCycles(stacks);
              destApart = this.lastDestApart;
            } else if (grid.sorting) {
              trap = placed < total && !sortable(grid, stacks);
              if (this.destOf) {
                const d = this.destOf[box.charCodeAt(0) - 65];
                home = node.bound.home - (d === from ? 1 : 0) + (d === drop ? 1 : 0);
                destCycles = this.destinationCycles(stacks);
                destApart = this.lastDestApart;
              }
            } else if (this.zoneColor) {
              cycles = this.closedCycles(stacks);
              apart = this.lastApart;
            }
            if (kFrom >= 0) corridor += this.corridorBonus(stacks, kFrom) - corridorBefore[kFrom];
            if (kDrop >= 0 && kDrop !== kFrom) corridor += this.corridorBonus(stacks, kDrop) - corridorBefore[kDrop];
            if (this.destOf && kFrom >= 0) corridorDest += this.corridorBonus(stacks, kFrom, true) - corridorDestBefore[kFrom];
            if (this.destOf && kDrop >= 0 && kDrop !== kFrom) corridorDest += this.corridorBonus(stacks, kDrop, true) - corridorDestBefore[kDrop];
            stacks[drop] = was;
          }
          const loose = total - placed;
          let h = Math.max(
            loose + (trap ? 1 : 0),
            sum,
            loose + cycles,
            loose + apart + corridor,
            this.destTerm(home, sum, destCycles, destApart, corridorDest),
          );
          if (loose > 0 && h === loose) {
            const stepsDrop = grid.steps[drop];
            const dropOpen = stepsDrop && extendsIt && was.length + 1 < stepsDrop.length ? stepsDrop[was.length + 1] : null;
            if (blockedAfter(from, drop, fromTop, fromOpen, box, !extendsIt, dropOpen)) h++;
          }
          const f = node.g + 1 + weight * h;
          if (f > low && f <= high) {
            const bound: Bound = { placed, trap, sum, cycles, apart, corridor, home, destCycles, destApart, corridorDest };
            for (const cell of new Set(cells)) push(f, { parent: node, move: { from, drop, after: cell }, bound, h });
          } else if (f > high && f < next) next = f;
        }
        stacks[from] = stack;
        if (floorFrom) occupancy[from] = 0;
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
      const layout = moveInLayout(entry.parent.layout, entry.move.from, entry.move.drop, topOfLayout(entry.parent.layout, entry.move.from));
      const cell = entry.move.after!;
      const pair = layout + String.fromCharCode(0x100 + cell);
      if (seen.has(pair)) continue;
      seen.add(pair);
      const key = stateKey(layout, reachableFrom(grid, occupancyOfLayout(layout, grid.cellCount), cell));
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
 * Fewest box moves to finish the level in the carrying model. First plans: a short greedy search, then a weighted
 * search (f = g + 2h) that usually lands on or near the optimum; then A* (weight 1, exact) stops as soon as every
 * plan shorter than the best one is ruled out. When the work budget runs out it reports the proven lower bound and the
 * best plan found as upper bound.
 */
export function minMoves(level: LevelData, options: MinMovesOptions = {}): MinMovesResult {
  const grid = new LevelGrid(level, options);
  return minMovesFrom(grid, stacksOf(grid, level), grid.index(level.forklift.x, level.forklift.z), level.boxes.length, options);
}

/**
 * The exact search's lower bound on the moves still needed from a state (its heuristic: admissible and consistent, so
 * one move never lowers it by more than one; tested on the shipped levels).
 */
export function movesLowerBound(grid: LevelGrid, stacks: Stacks, forklift: number, total: number): number {
  return new MoveSearch(grid, stacks, forklift, total).h0;
}

/**
 * movesLowerBound for many states of one level, reusing what the bound precomputes (`stacks0`: any state of the level,
 * e.g. its start). The forklift's place does not change the bound.
 */
export function movesLowerBounds(grid: LevelGrid, stacks0: Stacks, total: number): (stacks: Stacks) => number {
  const search = new MoveSearch(grid, stacks0, -1, total);
  return (stacks) => search.estimate(stacks);
}

/**
 * minMoves from any state: `stacks` on `grid` with the forklift on cell `forklift` (e.g. the live state of a game, or
 * a state the dead-end check explores). `total` = number of boxes.
 */
export function minMovesFrom(grid: LevelGrid, stacks: Stacks, forklift: number, total: number, options: MinMovesOptions = {}): MinMovesResult {
  const maxWork = options.maxWork ?? 150_000;
  const maxPending = options.maxPending ?? 800_000;
  const search = new MoveSearch(grid, stacks, forklift, total);
  const { stacks0, start, h0 } = search;
  // A short greedy try first (instant on easy levels); on hard ones the weighted search finds a first plan faster.
  let best = greedySearch(grid, stacks0, start, total, { allowParking: true, maxExpansions: 60, regions: 'all' }).moves;
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
/* Dead ends («callejones»)                                            */
/* ------------------------------------------------------------------ */

export interface DeadEndOptions extends GridOptions {
  /** States to expand at most (default 300); the exploration starts from the states of a shortest plan. */
  maxStates?: number;
  /** The plan whose states seed the exploration (default: minMoves' plan). */
  plan?: readonly Move[] | null;
  /** Work budget of each full check (a move that cannot simply be undone; default 20 000, see minMoves `maxWork`). */
  checkWork?: number;
}

export interface DeadEndResult {
  /**
   * Dead ends found: states one move away from a state that can still be finished, from which the level can no
   * longer be finished (proven: everything reachable from them was searched).
   */
  found: number;
  /** Such states the full check could not decide within its budget (possible dead ends). */
  unknown: number;
  /** States expanded: every move from them was checked. */
  explored: number;
  /** Distinct states checked (the explored ones and the frontier). */
  checked: number;
  /** Moves that could not simply be undone, so they needed a full check. */
  deepChecks: number;
  /** Every state reachable from the start was explored: `found` is exact for the whole level. */
  complete: boolean;
  /** The first dead end (or undecided state) found: the state it comes from and the move that leads into it. */
  example: { stacks: Stacks; forklift: number; move: Move } | null;
}

/** Applies one move in the model (the replay rules); null when it cannot be made. */
function applyMove(grid: LevelGrid, stacks: Stacks, forklift: number, move: Move): { stacks: Stacks; forklift: number } | null {
  const { from, drop, after } = move;
  if (from < 0 || from >= grid.posCount || !canLift(grid, stacks, from)) return null;
  const occupancy = occupancyOf(grid, stacks);
  const region = reachableFrom(grid, occupancy, forklift);
  const lifted = lift(stacks, from);
  if (from < grid.cellCount) occupancy[from] = lifted[from].length > 0 ? 0 : -1;
  const cells = carrySearch(grid, occupancy, lifted, pickupStarts(grid, region, from)).drops.get(drop);
  if (!cells || !validDrop(grid, lifted, from, drop) || (after !== undefined && !cells.includes(after))) return null;
  lifted[drop] += stacks[from].slice(-1);
  return { stacks: lifted, forklift: after ?? cells[0] };
}

/**
 * «Callejones»: explores the states the forklift can reach, breadth first from the states of a shortest plan (so
 * every single slip anywhere along a good game is covered first), and checks that the level can still be finished
 * from each one. A move that can be undone (the box carried back where it was, the forklift back in the same region:
 * carryBackTo) leads to a state as good as the one it left; any other move gets a full solvability check (greedy,
 * then the exact search within `checkWork`). With the reverse gear every move can be undone, so `found` should
 * always be 0: the check guards that property (and any future rule that breaks it) on real levels. In a level with
 * racks a box placed on its destiny is locked (lockedAt), so every such move gets the full check: a destiny that
 * walls off what is still to do would be a dead end.
 */
export function deadEnds(level: LevelData, options: DeadEndOptions = {}): DeadEndResult {
  const grid = new LevelGrid(level, options);
  const total = level.boxes.length;
  const maxStates = options.maxStates ?? 300;
  const checkWork = options.checkWork ?? 20_000;
  interface State {
    stacks: Stacks;
    forklift: number;
    region: Uint8Array;
  }
  /** Verdict per state key: 1 = can still be finished, 2 = dead end, 3 = undecided. */
  const known = new Map<string, number>();
  const queue: State[] = [];
  const seed = (stacks: Stacks, forklift: number) => {
    const region = reachableFrom(grid, occupancyOf(grid, stacks), forklift);
    const key = stateKey(layoutOf(stacks), region);
    if (known.has(key)) return;
    known.set(key, 1);
    queue.push({ stacks, forklift, region });
  };
  const plan = options.plan !== undefined ? options.plan : minMoves(level, { reverse: grid.reverse }).plan;
  let at: { stacks: Stacks; forklift: number } | null = { stacks: stacksOf(grid, level), forklift: grid.index(level.forklift.x, level.forklift.z) };
  seed(at.stacks, at.forklift);
  for (const move of plan ?? []) {
    at = applyMove(grid, at.stacks, at.forklift, move);
    if (!at) break;
    seed(at.stacks, at.forklift);
  }
  const check = (stacks: Stacks, forklift: number): number => {
    if (greedySearch(grid, stacks, forklift, total, { allowParking: true, maxExpansions: 300, regions: 'all' }).moves) return 1;
    const full = minMovesFrom(grid, stacks, forklift, total, { maxWork: checkWork });
    return full.upper !== null ? 1 : full.unsolvable ? 2 : 3;
  };

  let found = 0;
  let unknown = 0;
  let deepChecks = 0;
  let example: DeadEndResult['example'] = null;
  let head = 0;
  while (head < queue.length && head < maxStates) {
    const state = queue[head++];
    const occupancy = occupancyOf(grid, state.stacks);
    for (let from = 0; from < grid.posCount; from++) {
      const stack = state.stacks[from];
      if (!canLift(grid, state.stacks, from)) continue;
      const starts = pickupStarts(grid, state.region, from);
      if (starts.length === 0) continue;
      const box = stack[stack.length - 1];
      const lifted = lift(state.stacks, from);
      const floorFrom = from < grid.cellCount;
      if (floorFrom) occupancy[from] = lifted[from].length > 0 ? 0 : -1;
      const drops = carrySearch(grid, occupancy, lifted, starts).drops;
      // Poses from which the box can be carried back onto `from`, leaving the forklift in this state's region.
      const back = carryBackTo(grid, occupancy, lifted, from, state.region);
      for (const [drop, cells] of drops) {
        if (!validDrop(grid, lifted, from, drop)) continue;
        const next = lifted.slice();
        next[drop] += box;
        const floorDrop = drop < grid.cellCount;
        const before = floorDrop ? occupancy[drop] : 0;
        if (floorDrop) occupancy[drop] = 0;
        const layout = layoutOf(next);
        const regions: Uint8Array[] = [];
        for (const cell of cells) {
          if (regions.some((r) => r[cell] === 1)) continue;
          const region = reachableFrom(grid, occupancy, cell);
          regions.push(region);
          const key = stateKey(layout, region);
          if (known.has(key)) continue;
          // Undone when a pose that picks the box up again (in the region left after the drop) carries it back. A box
          // locked on its destiny never comes back: that move gets the full check.
          let verdict = 0;
          if (!lockedAt(grid, next, drop)) for (const pose of pickupStarts(grid, region, drop)) if (back[pose] === 1) verdict = 1;
          if (verdict === 0) {
            deepChecks++;
            verdict = check(next, cell);
          }
          known.set(key, verdict);
          if (verdict === 1) {
            queue.push({ stacks: next, forklift: cell, region });
            continue;
          }
          if (verdict === 2) found++;
          else unknown++;
          example ??= { stacks: state.stacks, forklift: state.forklift, move: { from, drop, after: cell } };
        }
        if (floorDrop) occupancy[drop] = before;
      }
      if (floorFrom) occupancy[from] = 0;
    }
  }
  return { found, unknown, explored: head, checked: known.size, deepChecks, complete: head >= queue.length, example };
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
  const seen = new Array<number>(grid.posCount).fill(0);
  return level.boxes.filter((b) => {
    const cell = grid.posOf(b.x, b.z, b.level);
    // List order is bottom → top, so the count so far is this box's level in its stack (on a truck bed: its level).
    const index = grid.isBed(cell) ? (b.level ?? 0) : seen[cell]++;
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
export function replayMoves(level: LevelData, moves: readonly Move[], options: GridOptions = {}): boolean {
  const grid = new LevelGrid(level, options);
  let state: { stacks: Stacks; forklift: number } | null = {
    stacks: stacksOf(grid, level),
    forklift: grid.index(level.forklift.x, level.forklift.z),
  };
  for (const move of moves) {
    state = applyMove(grid, state.stacks, state.forklift, move);
    if (!state) return false;
  }
  return misplacedCount(grid, state.stacks, level.boxes.length) === 0;
}
