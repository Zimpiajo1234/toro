import type { LevelData } from '../core/types';

const EMPTY: readonly number[] = Object.freeze([]);

/**
 * Cell-indexed lookups for one level: static obstacles (shelves, plants), resting boxes (per-cell stacks) and
 * zones. O(1) queries with no allocation. Out-of-bounds queries are safe.
 */
export class LevelGrid {
  readonly width: number;
  readonly depth: number;
  /** Tallest stack allowed on a cell (1 = classic level, no stacking). */
  readonly stackLimit: number;
  /** 1 = shelf or plant. */
  private readonly blocked: Uint8Array;
  /** Per cell: indices (into the level's box list) of the boxes resting there, bottom → top. */
  private readonly stacks: number[][];
  /** Index (into the level's zone list) of the zone on each cell, or -1. */
  private readonly zones: Int32Array;

  constructor(level: LevelData) {
    const { width, depth } = level.size;
    this.width = width;
    this.depth = depth;
    this.stackLimit = level.stackLimit ?? 1;
    this.blocked = new Uint8Array(width * depth);
    this.stacks = Array.from({ length: width * depth }, () => []);
    this.zones = new Int32Array(width * depth).fill(-1);

    for (const s of level.shelves)
      for (let x = s.x; x < s.x + s.w; x++) for (let z = s.z; z < s.z + s.d; z++) this.blocked[this.index(x, z)] = 1;
    for (const p of level.decor.plants) this.blocked[this.index(p.x, p.z)] = 1;
    level.zones.forEach((zone, i) => (this.zones[this.index(zone.x, zone.z)] = i));
    // Boxes sharing a cell are listed bottom → top.
    level.boxes.forEach((box, i) => this.stacks[this.index(box.x, box.z)].push(i));
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.depth;
  }

  /** Shelf or plant on this cell. */
  isBlocked(x: number, z: number): boolean {
    return this.inBounds(x, z) && this.blocked[this.index(x, z)] === 1;
  }

  /** In bounds, no shelf / plant and no resting box. */
  isFree(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const i = this.index(x, z);
    return this.blocked[i] === 0 && this.stacks[i].length === 0;
  }

  /** In bounds, no shelf / plant, and either empty or holding a stack with room for one more box. */
  canTakeBox(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const i = this.index(x, z);
    return this.blocked[i] === 0 && this.stacks[i].length < this.stackLimit;
  }

  /** Number of boxes resting on the cell. */
  height(x: number, z: number): number {
    return this.inBounds(x, z) ? this.stacks[this.index(x, z)].length : 0;
  }

  /** Top box of the cell's stack, or -1. */
  boxAt(x: number, z: number): number {
    if (!this.inBounds(x, z)) return -1;
    const st = this.stacks[this.index(x, z)];
    return st.length > 0 ? st[st.length - 1] : -1;
  }

  /** Bottom box of the cell's stack (the one that collides), or -1. */
  baseAt(x: number, z: number): number {
    if (!this.inBounds(x, z)) return -1;
    const st = this.stacks[this.index(x, z)];
    return st.length > 0 ? st[0] : -1;
  }

  /** The cell's stack, bottom → top (read-only view; empty when out of bounds). */
  stackAt(x: number, z: number): readonly number[] {
    return this.inBounds(x, z) ? this.stacks[this.index(x, z)] : EMPTY;
  }

  /** Put a box on top of the cell's stack; returns its level (0 = floor). */
  pushBox(x: number, z: number, boxIndex: number): number {
    if (!this.inBounds(x, z)) return 0;
    const st = this.stacks[this.index(x, z)];
    st.push(boxIndex);
    return st.length - 1;
  }

  /** Take the top box off the cell's stack; returns its index or -1. */
  popBox(x: number, z: number): number {
    if (!this.inBounds(x, z)) return -1;
    return this.stacks[this.index(x, z)].pop() ?? -1;
  }

  zoneAt(x: number, z: number): number {
    return this.inBounds(x, z) ? this.zones[this.index(x, z)] : -1;
  }

  private index(x: number, z: number): number {
    return z * this.width + x;
  }
}
