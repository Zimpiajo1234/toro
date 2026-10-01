import { degToRad } from '../core/math';
import type { StorageAccess } from '../core/types';

/**
 * How the rig works at a storage column, by the access of its unit (docs/STORAGE.md «Acceso»): one row per access
 * kind, read by GameState (refreshStorageAim, the passage of the load) for every unit, whatever its skin; no case per
 * wall or per skin outside it. The forks go by the keys at every access (rule 9: F / V choose the level). Distances in
 * world units along the column's own frame (core/racks `columnFrame`): `depth` 0 = the column's face (a rack's front
 * face, a dock's wall line), negative = in front of it; `lateral` = off its centre line.
 */
export interface StorageAccessRow {
  /**
   * The forklift engages the columns of this access at all (false: a belt's end exit, which only its belt fills: never
   * faced, held, picked or dropped into; the margins below are then unused).
   */
  readonly engages: boolean;
  /**
   * Facing a column engages it: the heading within `faceAngle` (rad) of straight in, the fork point within
   * `faceLateral` of its centre line and between `faceNear` in front of its face and `faceFar` past it.
   */
  readonly faceAngle: number;
  readonly faceLateral: number;
  readonly faceNear: number;
  readonly faceFar: number;
  /**
   * Once engaged, the rig stays at the column (hint and forks kept) until it turns, slides or backs further than these
   * looser margins (heading, lateral, in front of the face; `faceFar` past it): small wobbles never flicker.
   */
  readonly holdAngle: number;
  readonly holdLateral: number;
  readonly holdNear: number;
  /**
   * Facing and holding also need the body in line with the column's front cell (on it or straight behind it), so a
   * column is never worked from the front cell beside it.
   */
  readonly bodyInLine: boolean;
  /** Pick and drop act on the column while it is only held too (true), not just while faced (false). */
  readonly actsHeld: boolean;
  /**
   * Pick and drop act on the column only with the fork point this deep (u): a pick at `pickReach` or more, a drop at
   * `dropReach` or more.
   */
  readonly pickReach: number;
  readonly dropReach: number;
  /**
   * The doorway: carrying with the load already past the column's face (a wall line) while pick and drop do not act
   * there yet (short of the reach, or the forks away from the level chosen), nothing can be dropped, not even on the
   * floor beside it.
   */
  readonly doorway: boolean;
}

/**
 * One row per access (docs/STORAGE.md «Acceso»); the key order is the engagement priority (refreshStorageAim: a unit
 * of the first access that engages a column wins, as a rack always did over a truck).
 */
export const STORAGE_ACCESS: { readonly [K in StorageAccess['kind']]: StorageAccessRow } = {
  /**
   * A storage rack (and a belt's input: one slot at the floor, docs/CONVEYOR.md): loaded from the floor cell in front of
   * each column; the column's cell is solid.
   */
  front: {
    engages: true,
    faceAngle: degToRad(30),
    faceLateral: 0.35,
    faceNear: 0.8,
    faceFar: 1,
    holdAngle: degToRad(50),
    holdLateral: 0.75,
    holdNear: 1.3,
    bodyInLine: false,
    actsHeld: false,
    // Anywhere it faces the column (a pick needs the forks at the slot's level); the load goes into the slot once the
    // fork point is 0.55 in front of the face (a load resting against the face stands carriedBoxRadius = 0.46 in front).
    pickReach: -0.8,
    dropReach: -0.55,
    doorway: false,
  },
  /**
   * A dock truck: loaded through its door from the door cell of each column; the column's cell lies beyond the wall,
   * outside the map. Pick and drop act with the forks through the door (the fork point 0.3 past the wall line, the load
   * mostly on the bed: with the body against the wall it stands 0.5 in, at the bed's centre; on the door cell's centre,
   * 0.42). Short of that the load is in the doorway at most; further back the floor rules apply.
   */
  door: {
    engages: true,
    faceAngle: degToRad(30),
    faceLateral: 0.5,
    faceNear: 0.8,
    faceFar: 1,
    holdAngle: degToRad(45),
    holdLateral: 0.6,
    holdNear: 0.8,
    bodyInLine: true,
    actsHeld: true,
    pickReach: 0.3,
    dropReach: 0.3,
    doorway: true,
  },
  /**
   * A belt's end exit (docs/CONVEYOR.md): its belt fills it, the forklift never works at it (its cell is solid, like
   * any furniture). Nothing below is ever read.
   */
  belt: {
    engages: false,
    faceAngle: 0,
    faceLateral: 0,
    faceNear: 0,
    faceFar: 0,
    holdAngle: 0,
    holdLateral: 0,
    holdNear: 0,
    bodyInLine: false,
    actsHeld: false,
    pickReach: 0,
    dropReach: 0,
    doorway: false,
  },
};

/** The access kinds in engagement priority (STORAGE_ACCESS key order). */
export const STORAGE_ACCESS_ORDER = Object.keys(STORAGE_ACCESS) as readonly StorageAccess['kind'][];
