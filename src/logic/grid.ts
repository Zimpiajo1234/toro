import type { LevelData } from '../core/types';

/**
 * Cell-indexed lookups for one level: static obstacles (shelves, plants), resting boxes and zones.
 * Flat typed arrays give O(1) queries with no allocation. Out-of-bounds queries are safe.
 */
export class LevelGrid {
  readonly width: number;
  readonly depth: number;
  /** 1 = shelf or plant. */
  private readonly blocked: Uint8Array;
  /** Index (into the level's box list) of the box resting on each cell, or -1. */
  private readonly boxes: Int32Array;
  /** Index (into the level's zone list) of the zone on each cell, or -1. */
  private readonly zones: Int32Array;

  constructor(level: LevelData) {
    const { width, depth } = level.size;
    this.width = width;
    this.depth = depth;
    this.blocked = new Uint8Array(width * depth);
    this.boxes = new Int32Array(width * depth).fill(-1);
    this.zones = new Int32Array(width * depth).fill(-1);

    for (const s of level.shelves)
      for (let x = s.x; x < s.x + s.w; x++) for (let z = s.z; z < s.z + s.d; z++) this.blocked[this.index(x, z)] = 1;
    for (const p of level.decor.plants) this.blocked[this.index(p.x, p.z)] = 1;
    level.zones.forEach((zone, i) => (this.zones[this.index(zone.x, zone.z)] = i));
    level.boxes.forEach((box, i) => (this.boxes[this.index(box.x, box.z)] = i));
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
    return this.blocked[i] === 0 && this.boxes[i] < 0;
  }

  boxAt(x: number, z: number): number {
    return this.inBounds(x, z) ? this.boxes[this.index(x, z)] : -1;
  }

  zoneAt(x: number, z: number): number {
    return this.inBounds(x, z) ? this.zones[this.index(x, z)] : -1;
  }

  /** Record which box rests on a cell (-1 clears it). */
  setBox(x: number, z: number, boxIndex: number): void {
    if (this.inBounds(x, z)) this.boxes[this.index(x, z)] = boxIndex;
  }

  private index(x: number, z: number): number {
    return z * this.width + x;
  }
}
