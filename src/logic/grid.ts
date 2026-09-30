import { STORAGE_SKINS, storageColumnsOf } from '../core/storage';
import type { CellPos, Facing, LevelData, StorageAccess, StorageSkin, StorageSupport } from '../core/types';

const EMPTY: readonly number[] = Object.freeze([]);

/**
 * One storage column (docs/STORAGE.md), flattened: unit by unit (storage order, rule 12), column by column — the order
 * of the columns of GameSnapshot.storageSlots. Its cell is a map cell (access `front`: a rack's own cell, solid) or lies
 * beyond a wall, outside the map (access `door`: a truck's bed cell; its door cell, inside, is plain floor).
 */
export interface StorageColumn {
  /** Its unit's index in core/storage `storageOf`, its id and skin (STORAGE_SKINS row). */
  unitIndex: number;
  unitId: string;
  skin: StorageSkin;
  /** How its levels hold boxes (its skin's row): each on a shelf apart, or a stack from the bottom up. */
  support: StorageSupport;
  /** How it is loaded (its unit's access; logic/storageAccess `STORAGE_ACCESS`). */
  access: StorageAccess['kind'];
  /** Column along its unit. */
  column: number;
  cell: CellPos;
  /** Where it is loaded from (the floor cell in front, the door cell) and that side. */
  front: CellPos;
  facing: Facing;
  /** Levels of the column: its slots bottom → top (a rack's 1–3, a truck's 1–2). */
  levels: number;
  /** Index of its bottom level in the flat slot list (GameSnapshot.storageSlots); level n is firstSlot + n. */
  firstSlot: number;
  /** Its cell is inside the map (a solid cell) rather than beyond a wall. */
  inside: boolean;
}

/**
 * Cell-indexed lookups for one level: static obstacles (shelves, plants, storage columns inside the map), resting boxes
 * (per-cell stacks and the boxes of every storage column) and zones. O(1) queries with no allocation (a cell outside
 * the map is looked up among the few columns beyond a wall). Out-of-bounds queries are safe.
 *
 * A storage column keeps its boxes by its support (docs/STORAGE.md «Soporte»): on shelves one box per level (`slotBox`),
 * outside every stack; in a stack a stack of its own, bottom → top, which the stack queries (height, boxAt, baseAt,
 * stackAt, pushBox, popBox, capacity) answer on its cell like a floor stack, with its levels as capacity — also beyond a
 * wall, where nothing else answers.
 */
export class LevelGrid {
  readonly width: number;
  readonly depth: number;
  /** Tallest stack allowed on a cell (1 = classic level, no stacking). */
  readonly stackLimit: number;
  /** Storage columns, every unit (empty in levels without storage). */
  readonly columns: readonly StorageColumn[];
  /** Total storage slots (levels of every column). */
  readonly slotCount: number;
  /** 1 = shelf, plant or storage column inside the map (a dock's door cells are plain floor). */
  private readonly blocked: Uint8Array;
  /** Per cell: indices (into the level's box list) of the boxes resting there, bottom → top. */
  private readonly stacks: number[][];
  /** Per storage column of support `stack`: the boxes on it, bottom → top (empty for shelves). */
  private readonly columnStacks: number[][];
  /** Storage columns whose cell lies outside the map (beyond a wall). */
  private readonly outside: readonly number[];
  /** Index (into the level's zone list) of the zone on each cell, or -1. */
  private readonly zones: Int32Array;
  /** Storage column on each map cell, or -1. */
  private readonly columnOf: Int32Array;
  /** Per storage slot: the box resting on that shelf, or -1 (support `shelves` only). */
  private readonly slotBoxes: Int32Array;
  /** Per storage slot: its column. */
  private readonly slotColumn: Int32Array;

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
    const columns: StorageColumn[] = [];
    const outside: number[] = [];
    for (const ref of storageColumnsOf(level)) {
      const inside = this.inBounds(ref.cell.x, ref.cell.z);
      const c = columns.length;
      if (inside) {
        const i = this.index(ref.cell.x, ref.cell.z);
        this.blocked[i] = 1;
        this.columnOf[i] = c;
      } else outside.push(c);
      columns.push({
        unitIndex: ref.unitIndex,
        unitId: ref.unit.id,
        skin: ref.unit.skin,
        support: STORAGE_SKINS[ref.unit.skin].support,
        access: ref.unit.access.kind,
        column: ref.column,
        cell: ref.cell,
        front: ref.front,
        facing: ref.facing,
        levels: ref.cues.length,
        firstSlot: ref.firstSlot,
        inside,
      });
    }
    this.columns = columns;
    this.outside = outside;
    this.slotCount = columns.reduce((n, c) => n + c.levels, 0);
    this.slotBoxes = new Int32Array(this.slotCount).fill(-1);
    this.slotColumn = new Int32Array(this.slotCount);
    columns.forEach((c, i) => this.slotColumn.fill(i, c.firstSlot, c.firstSlot + c.levels));
    this.columnStacks = columns.map(() => []);
    level.zones.forEach((zone, i) => (this.zones[this.index(zone.x, zone.z)] = i));
    // Boxes sharing a floor cell are listed bottom → top; a box stored in a column (a rack cell, a truck's bed cell
    // outside the map) names its level there (validateLevel: in a stack they sit on each other from the bottom up).
    level.boxes.forEach((box, i) => {
      const c = this.columnAt(box.x, box.z);
      if (c >= 0 && box.level !== undefined) {
        const column = columns[c];
        if (column.support === 'shelves') this.slotBoxes[column.firstSlot + box.level] = i;
        else this.columnStacks[c][box.level] = i;
      } else this.stacks[this.index(box.x, box.z)].push(i);
    });
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.depth;
  }

  /** Shelf, plant or storage column inside the map (a dock's door cells are floor). */
  isBlocked(x: number, z: number): boolean {
    return this.inBounds(x, z) && this.blocked[this.index(x, z)] !== 0;
  }

  /** In bounds, no shelf / plant / storage column and no resting box. */
  isFree(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const i = this.index(x, z);
    return this.blocked[i] === 0 && this.stacks[i].length === 0;
  }

  /**
   * Floor cell (no shelf / plant / storage column), either empty or holding a stack with room for one more box. A
   * storage column never is one: it is loaded from its front only (Interaction, GameState: the aimed column).
   */
  canTakeBox(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const i = this.index(x, z);
    return this.blocked[i] === 0 && this.stacks[i].length < this.stackLimit;
  }

  /** Most boxes the cell's stack may hold: a stack column's levels, else the level's stack limit. */
  capacity(x: number, z: number): number {
    const c = this.columnAt(x, z);
    return c >= 0 && this.columns[c].support === 'stack' ? this.columns[c].levels : this.stackLimit;
  }

  /** Storage column on this cell (a map cell, or one beyond a wall outside the map), or -1. */
  columnAt(x: number, z: number): number {
    if (this.inBounds(x, z)) return this.columnOf[this.index(x, z)];
    const outside = this.outside;
    const columns = this.columns;
    for (let k = 0; k < outside.length; k++) {
      const cell = columns[outside[k]].cell;
      if (cell.x === x && cell.z === z) return outside[k];
    }
    return -1;
  }

  /**
   * The cell is a storage column of support `stack` (a truck bed): its boxes are a stack like a floor stack, with its
   * levels as capacity; a locked box there still takes the next level on top.
   */
  isStackColumn(x: number, z: number): boolean {
    const c = this.columnAt(x, z);
    return c >= 0 && this.columns[c].support === 'stack';
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

  /** The cell's stack, bottom → top (read-only view; empty when out of bounds and not a stack column's cell). */
  stackAt(x: number, z: number): readonly number[] {
    return this.stackOf(x, z) ?? EMPTY;
  }

  /** Put a box on top of the cell's stack; returns its level (0 = floor or the bottom of a stack column). */
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

  /** Flat slot index of `level` in storage column `column`, or -1 when out of range. */
  slotOf(column: number, level: number): number {
    const c = this.columns[column];
    return c && level >= 0 && level < c.levels ? c.firstSlot + level : -1;
  }

  /** Box resting at a storage slot (on its shelf, or at its height of its column's stack), or -1. */
  slotBox(slot: number): number {
    if (slot < 0 || slot >= this.slotCount) return -1;
    const c = this.slotColumn[slot];
    const column = this.columns[c];
    return column.support === 'shelves' ? this.slotBoxes[slot] : (this.columnStacks[c][slot - column.firstSlot] ?? -1);
  }

  /**
   * A box may be stored at `level` of `column` now: a shelf is free; in a stack it is the next level up (on what is
   * there) and the column has room.
   */
  canStore(column: number, level: number): boolean {
    const slot = this.slotOf(column, level);
    if (slot < 0) return false;
    return this.columns[column].support === 'shelves' ? this.slotBoxes[slot] < 0 : level === this.columnStacks[column].length;
  }

  /**
   * The box a pick at `level` of `column` would lift, or -1: on shelves the box on that shelf; in a stack only its top
   * box, at its own level (docs/STORAGE.md rule 9: never one from under another).
   */
  liftableAt(column: number, level: number): number {
    const slot = this.slotOf(column, level);
    if (slot < 0) return -1;
    if (this.columns[column].support === 'shelves') return this.slotBoxes[slot];
    const stack = this.columnStacks[column];
    return level === stack.length - 1 ? stack[level] : -1;
  }

  /** Store a box at `level` of `column` (shelves: that shelf; a stack: on top, which is that level). Returns its level. */
  putBox(column: number, level: number, boxIndex: number): number {
    const c = this.columns[column];
    if (c.support === 'shelves') {
      this.slotBoxes[c.firstSlot + level] = boxIndex;
      return level;
    }
    const stack = this.columnStacks[column];
    stack.push(boxIndex);
    return stack.length - 1;
  }

  /** Take the box out of `level` of `column` (in a stack: the top one, which is that level). */
  takeBox(column: number, level: number): void {
    const c = this.columns[column];
    if (c.support === 'shelves') this.slotBoxes[c.firstSlot + level] = -1;
    else this.columnStacks[column].pop();
  }

  private index(x: number, z: number): number {
    return z * this.width + x;
  }

  /** The stack on a cell: a stack column's (inside or outside the map), else a map cell's; null anywhere else. */
  private stackOf(x: number, z: number): number[] | null {
    const c = this.columnAt(x, z);
    if (c >= 0 && this.columns[c].support === 'stack') return this.columnStacks[c];
    return this.inBounds(x, z) ? this.stacks[this.index(x, z)] : null;
  }
}
