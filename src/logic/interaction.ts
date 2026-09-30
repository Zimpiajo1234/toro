import { degToRad } from '../core/math';
import { specificity, takesNext, type Sortable } from '../core/sorting';
import type { BoxState, ForkliftState, LevelData, ZoneState } from '../core/types';
import type { GameConfig } from '../config';
import { circleRectContact, createContact, type CollisionWorld } from './collision';
import type { LevelGrid } from './grid';

/** Largest allowed overlap (u) between a dropped box and the forklift body circle. */
export const DROP_BODY_TOLERANCE = 0.05;
/**
 * Looser overlap accepted only when no cell passes DROP_BODY_TOLERANCE (e.g. forks pressed diagonally into a
 * concave corner) and the body can be eased out of the box freely (see CollisionWorld.softenBox).
 */
export const DROP_BODY_TOLERANCE_TIGHT_SPOT = 0.15;
/** Penetration (u) still counted as free when checking that the eased-out body has room. */
const EASE_OUT_EPSILON = 1e-3;
/** Squared distances closer than this are ties; ties keep the earlier candidate (list / scan order). */
const TIE_EPSILON = 1e-9;

/** Where a carried box would land. */
export interface DropChoice {
  x: number;
  z: number;
  /** Zone on that cell (any color), or -1. */
  zoneIndex: number;
  /** Height the box lands at (0 = floor, 1 = on one box, …; a storage level). */
  level: number;
  /** Storage column (LevelGrid.columns) the box goes into, at `level` (its cell is x, z), or -1 for the floor. */
  column: number;
}

export function createDropChoice(): DropChoice {
  return { x: 0, z: 0, zoneIndex: -1, level: 0, column: -1 };
}

/**
 * Levels with storage (docs/STORAGE.md): the storage column the forks work on this frame, kept up to date by GameState
 * (refreshStorageAim, logic/storageAccess STORAGE_ACCESS), in any skin. Only that column, at that level, is ever a pick
 * or drop candidate in storage: a unit is loaded and unloaded from its front only.
 */
export interface StorageAim {
  /**
   * Storage column (LevelGrid.columns) pick and drop act on, or -1: the one the rig works at, once it faces it (or also
   * while held there, by its access) with the forks at the level chosen (where they are keyed) and the fork point deep
   * enough for a pick (its access's `pickReach`).
   */
  column: number;
  /**
   * The level they act on there: the one selected (keyed forks), or where the forks go by themselves (a stack: its top
   * box to lift, the next level up to load).
   */
  level: number;
  /** Carrying: the fork point is deep enough for the drop (its access's `dropReach`). */
  reach: boolean;
  /**
   * Carrying at a storage column while nothing may be dropped, not even on the floor in front or beside it: the load at
   * a rack's face while the forks are still on their way to the selected level (not held up by a floor stack the load is
   * over), or in a dock door short of the reach (the doorway).
   */
  blocked: boolean;
}

export function createStorageAim(): StorageAim {
  return { column: -1, level: 0, reach: false, blocked: false };
}

/**
 * Pick-up / drop selection rules (pure queries, no mutation). Measured from the fork point
 * `pos + forward * forkReach`, against the live forklift, box and zone state.
 */
export class Interaction {
  private readonly forklift: ForkliftState;
  private readonly boxes: readonly BoxState[];
  private readonly zones: readonly ZoneState[];
  private readonly grid: LevelGrid;
  private readonly world: CollisionWorld;
  private readonly halfWidth: number;
  private readonly halfDepth: number;
  private readonly reach: number;
  private readonly bodyRadius: number;
  private readonly boxHalf: number;
  private readonly pickupRadiusSq: number;
  private readonly pickupCos: number;
  private readonly magnetSq: number;
  private readonly contact = createContact();
  private readonly probe = createContact();
  private readonly aim: StorageAim;

  constructor(
    level: LevelData,
    config: GameConfig,
    forklift: ForkliftState,
    boxes: readonly BoxState[],
    zones: readonly ZoneState[],
    grid: LevelGrid,
    world: CollisionWorld,
    aim: StorageAim = createStorageAim(),
  ) {
    this.aim = aim;
    this.forklift = forklift;
    this.boxes = boxes;
    this.zones = zones;
    this.grid = grid;
    this.world = world;
    this.halfWidth = level.size.width / 2;
    this.halfDepth = level.size.depth / 2;
    const f = config.forklift;
    this.reach = f.forkReach;
    this.bodyRadius = f.bodyRadius;
    this.boxHalf = config.box.size / 2;
    this.pickupRadiusSq = f.pickupRadius * f.pickupRadius;
    this.pickupCos = Math.cos(degToRad(f.pickupAngleDeg));
    this.magnetSq = config.snap.zoneMagnetRadius * config.snap.zoneMagnetRadius;
  }

  /**
   * Box the action would lift now, or -1: resting on top of its stack, center within pickupRadius of the fork point and within
   * pickupAngleDeg of forward (seen from the body). Nearest to the fork point wins. The fork point must not be
   * inside another obstacle, so the load collider can always settle smoothly (a dock door is open for it: its fork
   * point may stand on the bed beyond). A box in storage (any skin) is only a candidate as the one the aim designates
   * (StorageAim: the aimed column's box at the aimed level: the slot the forks stand at, or the top of a stack the rig
   * faces with the forks through its door). A locked box (levels with storage: resting on its destined zone or slot)
   * never is.
   */
  findPickTarget(): number {
    const f = this.forklift;
    const fx = Math.sin(f.heading);
    const fz = Math.cos(f.heading);
    const px = f.pos.x + fx * this.reach;
    const pz = f.pos.z + fz * this.reach;
    let best = -1;
    let bestSq = Infinity;
    const aim = this.aim;
    const aimed = aim.column >= 0 ? this.grid.slotBox(this.grid.slotOf(aim.column, aim.level)) : -1;
    for (let i = 0; i < this.boxes.length; i++) {
      const b = this.boxes[i];
      if (b.carried || b.locked) continue;
      const cell = b.cell;
      let ignore = b.id;
      // The fork point sits in a stored box's own column: only the rest of the world must leave it room there.
      let ignoreColumn = -1;
      if (b.slotId !== null) {
        if (i !== aimed) continue;
        ignoreColumn = aim.column;
      } else if (cell && this.grid.boxAt(cell.x, cell.z) !== i) continue; // only the top of a floor stack
      // The stack's base stands for the whole cell in collisions (a box on a shelf has no collider of its own).
      if (cell) {
        const base = this.grid.baseAt(cell.x, cell.z);
        if (base >= 0) ignore = this.boxes[base].id;
      }
      const dx = b.pos.x - px;
      const dz = b.pos.z - pz;
      const dSq = dx * dx + dz * dz;
      if (dSq > this.pickupRadiusSq || dSq >= bestSq - TIE_EPSILON) continue;
      const ox = b.pos.x - f.pos.x;
      const oz = b.pos.z - f.pos.z;
      const along = ox * fx + oz * fz;
      if (along < Math.sqrt(ox * ox + oz * oz) * this.pickupCos) continue;
      if (this.world.clearance(px, pz, ignore, false, ignoreColumn) < 0) continue;
      best = i;
      bestSq = dSq;
    }
    return best;
  }

  /**
   * Cell the carried `box` would be dropped on. Candidates: the cell under the fork point and its 8
   * neighbours that are in bounds, free (no shelf or plant; empty, or a stack with room — the box goes on top; never
   * a locked box, which takes nothing) and would not overlap the body by more than DROP_BODY_TOLERANCE. Zone magnet:
   * among the zones within zoneMagnetRadius that would take this box next (core/sorting `takesNext`: an empty zone
   * that accepts it, or a stack zone whose recipe asks for its color next), the most specific wins (color + symbol
   * over a single criterion), then the nearest;
   * otherwise the nearest candidate (which may be a zone that does not accept it when the forks are over it). If no
   * cell passes, the nearest one within DROP_BODY_TOLERANCE_TIGHT_SPOT whose overlap the body can ease out of freely
   * is used, so a drop in a snug corner still works. Returns false when nothing fits. At a storage column with the load
   * deep enough (StorageAim.column, `reach`): the aimed level if the column takes the box there now (a free shelf; the
   * next level up of a stack with room, also on a locked box: the next level loads on it), else nothing (never the
   * floor in front or beside it); while the aim is blocked (the forks still on their way to a rack's selected level,
   * the load in a doorway short of the reach), nothing. A dock's door cells are plain floor otherwise.
   */
  findDrop(box: Sortable, out: DropChoice): boolean {
    const f = this.forklift;
    const px = f.pos.x + Math.sin(f.heading) * this.reach;
    const pz = f.pos.z + Math.cos(f.heading) * this.reach;
    const cellX = Math.floor(px + this.halfWidth);
    const cellZ = Math.floor(pz + this.halfDepth);
    out.column = -1;

    const aim = this.aim;
    if (aim.blocked) return false;
    if (aim.column >= 0 && aim.reach) {
      if (!this.grid.canStore(aim.column, aim.level)) return false;
      const cell = this.grid.columns[aim.column].cell;
      out.x = cell.x;
      out.z = cell.z;
      out.zoneIndex = -1;
      out.level = aim.level;
      out.column = aim.column;
      return true;
    }

    let nearestSq = Infinity;
    let nearestX = 0;
    let nearestZ = 0;
    let zoneIndex = -1;
    let zoneRank = 0;
    let zoneSq = Infinity;
    let zoneX = 0;
    let zoneZ = 0;
    let snugSq = Infinity;
    let snugX = 0;
    let snugZ = 0;

    for (let z = cellZ - 1; z <= cellZ + 1; z++) {
      for (let x = cellX - 1; x <= cellX + 1; x++) {
        if (!this.grid.canTakeBox(x, z) || this.lockedAt(x, z)) continue;
        const wx = x + 0.5 - this.halfWidth;
        const wz = z + 0.5 - this.halfDepth;
        const dSq = (wx - px) * (wx - px) + (wz - pz) * (wz - pz);
        const overlap = this.bodyOverlap(wx, wz);
        if (overlap > DROP_BODY_TOLERANCE) {
          // Tight-spot fallback, only needed (and only checked) while no regular candidate exists.
          if (
            nearestSq === Infinity &&
            overlap <= DROP_BODY_TOLERANCE_TIGHT_SPOT &&
            dSq < snugSq - TIE_EPSILON &&
            this.canEaseOut(overlap)
          ) {
            snugSq = dSq;
            snugX = x;
            snugZ = z;
          }
          continue;
        }
        if (dSq < nearestSq - TIE_EPSILON) {
          nearestSq = dSq;
          nearestX = x;
          nearestZ = z;
        }
        // Zone magnet: only zones that would take this box next pull it off the aimed cell; the most specific one
        // first (it can only ever take this kind of box), then the nearest.
        const zi = this.grid.zoneAt(x, z);
        if (zi < 0 || dSq > this.magnetSq || !takesNext(this.zones[zi], box)) continue;
        const rank = specificity(this.zones[zi].accepts);
        if (rank > zoneRank || (rank === zoneRank && dSq < zoneSq - TIE_EPSILON)) {
          zoneIndex = zi;
          zoneRank = rank;
          zoneSq = dSq;
          zoneX = x;
          zoneZ = z;
        }
      }
    }

    if (zoneIndex >= 0) {
      out.x = zoneX;
      out.z = zoneZ;
      out.zoneIndex = zoneIndex;
      out.level = this.grid.height(zoneX, zoneZ);
      return true;
    }
    if (nearestSq === Infinity) {
      if (snugSq === Infinity) return false;
      nearestX = snugX;
      nearestZ = snugZ;
    }
    out.x = nearestX;
    out.z = nearestZ;
    out.zoneIndex = this.grid.zoneAt(nearestX, nearestZ);
    out.level = this.grid.height(nearestX, nearestZ);
    return true;
  }

  /** Levels with racks: the cell holds a locked box (nothing can be dropped or stacked on it). */
  private lockedAt(x: number, z: number): boolean {
    const top = this.grid.boxAt(x, z);
    return top >= 0 && this.boxes[top].locked;
  }

  /**
   * Overlap depth of a box square centered at (wx, wz) with the forklift body circle. Leaves the push-out
   * normal (box → body) in `this.contact`.
   */
  private bodyOverlap(wx: number, wz: number): number {
    const p = this.forklift.pos;
    const h = this.boxHalf;
    return circleRectContact(p.x, p.z, this.bodyRadius, wx - h, wz - h, wx + h, wz + h, this.contact);
  }

  /** Would the body, moved out of the last bodyOverlap() box along its normal by `overlap`, be free? */
  private canEaseOut(overlap: number): boolean {
    const p = this.forklift.pos;
    const c = this.contact;
    const x = p.x + c.nx * overlap;
    const z = p.z + c.nz * overlap;
    return this.world.deepestContact(x, z, this.bodyRadius, this.probe) <= EASE_OUT_EPSILON;
  }
}
