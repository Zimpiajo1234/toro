/**
 * Geometry of the `front` access (docs/STORAGE.md «Acceso»; the storage rack, docs/RACKS.md): a straight run of cells
 * from (x, z) whose front looks toward `facing`, the floor cell in front of each column, which way is "into the
 * column", and a column's own frame. core/storage builds every unit's geometry on it (`cellOf`, `frontOf`), and
 * core/docks the `door` access (a door column reads like a front column one step beyond the wall). Pure, no
 * allocation in the helpers that take an `out` argument.
 */
import type { CellPos, Facing, Vec2 } from './types';

/** A run of cells from its first cell (x, z), its front toward `facing`: a front unit's cells. */
interface FrontRun {
  readonly x: number;
  readonly z: number;
  readonly facing: Facing;
}

/** Outward unit vector of each facing (from a column's cell toward its front cell). North is −z, west is −x. */
export const FACING_X: Readonly<Record<Facing, number>> = { north: 0, east: 1, south: 0, west: -1 };
export const FACING_Z: Readonly<Record<Facing, number>> = { north: -1, east: 0, south: 1, west: 0 };

/** A run whose front faces north / south runs along x; one facing east / west runs along z. */
export function runsAlongX(facing: Facing): boolean {
  return facing === 'north' || facing === 'south';
}

/** Cell of `column` (0 = the run's first cell). */
export function rackCellOf(run: FrontRun, column: number): CellPos {
  return runsAlongX(run.facing) ? { x: run.x + column, z: run.z } : { x: run.x, z: run.z + column };
}

/** Floor cell in front of `column`: where the forklift stands, facing the column, to reach its levels. */
export function frontCellOf(run: FrontRun, column: number): CellPos {
  const cell = rackCellOf(run, column);
  return { x: cell.x + FACING_X[run.facing], z: cell.z + FACING_Z[run.facing] };
}

/** Heading (radians, forward = (sin h, cos h)) of a forklift on a front cell facing into its column. */
export function inwardHeading(facing: Facing): number {
  return Math.atan2(-FACING_X[facing], -FACING_Z[facing]);
}

/**
 * Where a point stands relative to a storage column, in the column's own frame: `depth` = how far past the column's
 * face it is (negative = still in front of it; a rack's cell spans depth 0‥1, a dock's face is the wall line),
 * `lateral` = offset from the column's centre line along the run. Writes into `out`.
 */
export function columnFrame(
  cellCenter: Vec2,
  facing: Facing,
  px: number,
  pz: number,
  out: { depth: number; lateral: number },
): { depth: number; lateral: number } {
  const ox = FACING_X[facing];
  const oz = FACING_Z[facing];
  // Inward = −outward. The face is half a cell out from the cell centre.
  const dx = px - cellCenter.x;
  const dz = pz - cellCenter.z;
  out.depth = 0.5 - (dx * ox + dz * oz);
  out.lateral = dx * oz - dz * ox;
  return out;
}
