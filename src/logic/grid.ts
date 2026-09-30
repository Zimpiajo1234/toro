import type { CellPos, Facing, LevelData } from '../core/types';
import { frontCellOf, racksOf, rackCellOf } from '../core/racks';
import { truckColumnsOf } from '../core/docks';

const EMPTY: readonly number[] = Object.freeze([]);

/** One column of a storage rack (docs/RACKS.md), flattened: every rack, column by column (the order of the slots). */
export interface RackColumn {
  rackIndex: number;
  rackId: string;
  /** Column along its rack. */
  column: number;
  cell: CellPos;
  front: CellPos;
  facing: Facing;
  /** Slots in the column (1–3). */
  levels: number;
  /** Index of its bottom slot in the flat slot list (GameSnapshot.slots); level n is firstSlot + n. */
  firstSlot: number;
}

/**
 * One bed column of a loading dock's truck (docs/DOCKS.md), flattened: every truck, column by column (the order of
 * GameSnapshot.truckSlots). Its boxes are the stack on its bed cell, bottom → top, like a floor stack. The bed cell
 * lies outside the map, just beyond the wall; its door cell (inside) is plain floor.
 */
export interface TruckColumn {
  truckIndex: number;
  truckId: string;
  /** Column along its truck bed. */
  column: number;
  /** Bed cell, outside the map (a north dock: z = -1; a west dock: x = -1). */
  cell: CellPos;
  /** Door cell it is loaded from (floor inside the map, against the wall). */
  front: CellPos;
  /** Side it is loaded from (TRUCK_FACING of its wall). */
  facing: Facing;
  /** Levels of the column (1–2): the most boxes its bed cell holds. */
  levels: number;
  /** Index of its bottom level in the flat truck slot list (GameSnapshot.truckSlots); level n is firstSlot + n. */
  firstSlot: number;
}

/**
 * Cell-indexed lookups for one level: static obstacles (shelves, plants, storage racks), resting boxes (per-cell
 * stacks, one box per rack slot, and the stack of each truck bed column) and zones. O(1) queries with no allocation.
 * Out-of-bounds queries are safe; the truck bed cells, just outside the map, answer the stack queries (height, boxAt,
 * baseAt, stackAt, pushBox, popBox, capacity, truckColumnAt) and nothing else.
 */
export class LevelGrid {
  readonly width: number;
  readonly depth: number;
  /** Tallest stack allowed on a cell (1 = classic level, no stacking). */
  readonly stackLimit: number;
  /** Storage rack columns (empty in levels without racks). */
  readonly columns: readonly RackColumn[];
  /** Total rack slots. */
  readonly slotCount: number;
  /** Truck bed columns (empty in levels without trucks). */
  readonly truckColumns: readonly TruckColumn[];
  /** Total truck slots (levels of every bed column). */
  readonly truckSlotCount: number;
  /** 1 = shelf, plant or storage rack (a dock's door cells are plain floor). */
  private readonly blocked: Uint8Array;
  /** Per cell: indices (into the level's box list) of the boxes resting there, bottom → top. */
  private readonly stacks: number[][];
  /** Per truck bed column (outside the map): the boxes loaded on it, bottom → top. */
  private readonly truckStacks: number[][];
  /** Index (into the level's zone list) of the zone on each cell, or -1. */
  private readonly zones: Int32Array;
  /** Rack column on each cell, or -1. */
  private readonly columnOf: Int32Array;
  /** Box index resting in each rack slot, or -1. */
  private readonly slotBoxes: Int32Array;

  constructor(level: LevelData) {
    const { width, depth } = level.size;
    this.width = width;
    this.depth = depth;
    this.stackLimit = level.stackLimit ?? 1;
    this.blocked = new Uint8Array(width * depth);
    this.stacks = Array.from({ length: width * depth }, () => []);
    this.zones = new Int32Array(width * depth).fill(-1);
    this.columnOf = new Int32Array(width * depth).fill(-1);

    for (const s of level.shelves)
      for (let x = s.x; x < s.x + s.w; x++) for (let z = s.z; z < s.z + s.d; z++) this.blocked[this.index(x, z)] = 1;
    for (const p of level.decor.plants) this.blocked[this.index(p.x, p.z)] = 1;
    const columns: RackColumn[] = [];
    let slots = 0;
    racksOf(level).forEach((rack, rackIndex) => {
      rack.columns.forEach((column, c) => {
        const cell = rackCellOf(rack, c);
        const i = this.index(cell.x, cell.z);
        this.blocked[i] = 1;
        this.columnOf[i] = columns.length;
        columns.push({ rackIndex, rackId: rack.id, column: c, cell, front: frontCellOf(rack, c), facing: rack.facing, levels: column.length, firstSlot: slots });
        slots += column.length;
      });
    });
    this.columns = columns;
    this.slotCount = slots;
    this.slotBoxes = new Int32Array(slots).fill(-1);
    const truckColumns: TruckColumn[] = [];
    for (const ref of truckColumnsOf(level)) {
      truckColumns.push({
        truckIndex: ref.truckIndex,
        truckId: ref.truck.id,
        column: ref.column,
        cell: ref.cell,
        front: ref.front,
        facing: ref.facing,
        levels: ref.cues.length,
        firstSlot: ref.firstSlot,
      });
    }
    this.truckColumns = truckColumns;
    this.truckSlotCount = truckColumns.reduce((n, c) => n + c.levels, 0);
    this.truckStacks = truckColumns.map(() => []);
    level.zones.forEach((zone, i) => (this.zones[this.index(zone.x, zone.z)] = i));
    // Boxes sharing a floor cell are listed bottom → top; a box in a rack names its slot; a box loaded on a truck bed
    // (its bed cell, outside the map) names its level there (validateLevel: they sit on each other from the bed up).
    level.boxes.forEach((box, i) => {
      const column = this.columnAt(box.x, box.z);
      const bed = this.truckColumnAt(box.x, box.z);
      if (column >= 0 && box.level !== undefined) this.slotBoxes[this.columns[column].firstSlot + box.level] = i;
      else if (bed >= 0 && box.level !== undefined) this.truckStacks[bed][box.level] = i;
      else this.stacks[this.index(box.x, box.z)].push(i);
    });
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.depth;
  }

  /** Shelf, plant or storage rack on this cell (a dock's door cells are floor). */
  isBlocked(x: number, z: number): boolean {
    return this.inBounds(x, z) && this.blocked[this.index(x, z)] !== 0;
  }

  /** In bounds, no shelf / plant / rack and no resting box. */
  isFree(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const i = this.index(x, z);
    return this.blocked[i] === 0 && this.stacks[i].length === 0;
  }

  /**
   * Floor cell (no shelf / plant / rack), either empty or holding a stack with room for one more box. A truck bed
   * (outside the map) never is one: it is loaded through its door only (Interaction, GameState: the faced bed column).
   */
  canTakeBox(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const i = this.index(x, z);
    return this.blocked[i] === 0 && this.stacks[i].length < this.stackLimit;
  }

  /** Most boxes the cell's stack may hold: its column's levels on a truck bed, else the level's stack limit. */
  capacity(x: number, z: number): number {
    const column = this.truckColumnAt(x, z);
    return column >= 0 ? this.truckColumns[column].levels : this.stackLimit;
  }

  /** Truck bed column whose bed cell (outside the map) this is, or -1 (always -1 on a map cell). */
  truckColumnAt(x: number, z: number): number {
    if (this.inBounds(x, z)) return -1;
    const columns = this.truckColumns;
    for (let c = 0; c < columns.length; c++) if (columns[c].cell.x === x && columns[c].cell.z === z) return c;
    return -1;
  }

  /** Number of boxes resting on the cell. */
  height(x: number, z: number): number {
    return this.stackOf(x, z)?.length ?? 0;
  }

  /** Top box of the cell's stack, or -1. */
  boxAt(x: number, z: number): number {
    const st = this.stackOf(x, z);
    return st && st.length > 0 ? st[st.length - 1] : -1;
  }

  /** Bottom box of the cell's stack (the one that collides), or -1. */
  baseAt(x: number, z: number): number {
    const st = this.stackOf(x, z);
    return st && st.length > 0 ? st[0] : -1;
  }

  /** The cell's stack, bottom → top (read-only view; empty when out of bounds and not a truck bed cell). */
  stackAt(x: number, z: number): readonly number[] {
    return this.stackOf(x, z) ?? EMPTY;
  }

  /** Put a box on top of the cell's stack; returns its level (0 = floor or bed). */
  pushBox(x: number, z: number, boxIndex: number): number {
    const st = this.stackOf(x, z);
    if (!st) return 0;
    st.push(boxIndex);
    return st.length - 1;
  }

  /** Take the top box off the cell's stack; returns its index or -1. */
  popBox(x: number, z: number): number {
    return this.stackOf(x, z)?.pop() ?? -1;
  }

  zoneAt(x: number, z: number): number {
    return this.inBounds(x, z) ? this.zones[this.index(x, z)] : -1;
  }

  /** Storage rack column on this cell, or -1. */
  columnAt(x: number, z: number): number {
    return this.inBounds(x, z) ? this.columnOf[this.index(x, z)] : -1;
  }

  /** Flat slot index of `level` in rack column `column`, or -1 when out of range. */
  slotOf(column: number, level: number): number {
    const c = this.columns[column];
    return c && level >= 0 && level < c.levels ? c.firstSlot + level : -1;
  }

  /** Box resting in a rack slot, or -1. */
  slotBox(slot: number): number {
    return slot >= 0 && slot < this.slotBoxes.length ? this.slotBoxes[slot] : -1;
  }

  /** Put a box in (index ≥ 0) or take it out of (-1) a rack slot. */
  setSlotBox(slot: number, boxIndex: number): void {
    if (slot >= 0 && slot < this.slotBoxes.length) this.slotBoxes[slot] = boxIndex;
  }

  private index(x: number, z: number): number {
    return z * this.width + x;
  }

  /** The stack on a map cell or on a truck bed cell (outside the map), or null anywhere else. */
  private stackOf(x: number, z: number): number[] | null {
    if (this.inBounds(x, z)) return this.stacks[this.index(x, z)];
    const bed = this.truckColumnAt(x, z);
    return bed >= 0 ? this.truckStacks[bed] : null;
  }
}
