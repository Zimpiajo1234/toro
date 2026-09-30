/**
 * Storage rack geometry (docs/RACKS.md), shared by validation, logic, the level solver and render: which cell each
 * column occupies, where its front is, which way is "into the rack", and slot ids. Pure, no allocation in the helpers
 * that take an `out` argument. core/storage builds the geometry of every storage unit on it (docs/STORAGE.md); the
 * level helpers here (`racksOf`, `hasRacks`, `slotsOf`) are views of `level.storage` until phase 7.
 */
import type { CellPos, Facing, LevelData, LevelRack, LevelStorage, StorageAccess, Vec2 } from './types';

/** Outward unit vector of each facing (from the rack cell toward its front cell). North is −z, west is −x. */
export const FACING_X: Readonly<Record<Facing, number>> = { north: 0, east: 1, south: 0, west: -1 };
export const FACING_Z: Readonly<Record<Facing, number>> = { north: -1, east: 0, south: 1, west: 0 };

/** A rack facing north / south runs along x; one facing east / west runs along z. */
export function runsAlongX(facing: Facing): boolean {
  return facing === 'north' || facing === 'south';
}

/** Rack cell of `column` (0 = the rack's first cell). */
export function rackCellOf(rack: Pick<LevelRack, 'x' | 'z' | 'facing'>, column: number): CellPos {
  return runsAlongX(rack.facing) ? { x: rack.x + column, z: rack.z } : { x: rack.x, z: rack.z + column };
}

/** Floor cell in front of `column`: where the forklift stands, facing the rack, to reach its slots. */
export function frontCellOf(rack: Pick<LevelRack, 'x' | 'z' | 'facing'>, column: number): CellPos {
  const cell = rackCellOf(rack, column);
  return { x: cell.x + FACING_X[rack.facing], z: cell.z + FACING_Z[rack.facing] };
}

/** Heading (radians, forward = (sin h, cos h)) of a forklift on the front cell facing into the rack. */
export function inwardHeading(facing: Facing): number {
  return Math.atan2(-FACING_X[facing], -FACING_Z[facing]);
}

/** Id of a slot: `${rackId}:${column}:${level}` (column and level from 0; level 0 = bottom). */
export function slotIdOf(rackId: string, column: number, level: number): string {
  return `${rackId}:${column}:${level}`;
}

/** A storage unit of skin `rack` (always front access: validateLevel checks it). */
function isRack(unit: LevelStorage): unit is LevelStorage & { access: Extract<StorageAccess, { kind: 'front' }> } {
  return unit.skin === 'rack' && unit.access.kind === 'front';
}

/**
 * A level's racks (none → an empty list): its storage units of skin `rack`, in storage order, as LevelRack (a «libre»
 * slot is `{}`). A view of `level.storage` until phase 7 (docs/STORAGE.md), derived anew on every call.
 */
export function racksOf(level: Pick<LevelData, 'storage'>): readonly LevelRack[] {
  const out: LevelRack[] = [];
  for (const unit of level.storage ?? []) {
    if (!isRack(unit)) continue;
    const columns = unit.columns.map((slots) => slots.map((cue) => (cue === null ? {} : { ...cue })));
    out.push({ id: unit.id, x: unit.x, z: unit.z, w: unit.w, facing: unit.access.facing, columns });
  }
  return out;
}

/**
 * The level has at least one storage rack (docs/RACKS.md; the F / V row and fork steps key off it until phase 6). A
 * view of `level.storage` until phase 7.
 */
export function hasRacks(level: Pick<LevelData, 'storage'>): boolean {
  return (level.storage ?? []).some(isRack);
}

/** One slot of a level, flattened: every rack, column by column, bottom → top (the order of GameSnapshot.slots). */
export interface SlotRef {
  id: string;
  rack: LevelRack;
  rackIndex: number;
  column: number;
  level: number;
  cell: CellPos;
  front: CellPos;
}

/** Every slot of a level in snapshot order (a view of `level.storage` until phase 7: core/storage `storageSlotsOf`). */
export function slotsOf(level: Pick<LevelData, 'storage'>): SlotRef[] {
  const out: SlotRef[] = [];
  racksOf(level).forEach((rack, rackIndex) => {
    rack.columns.forEach((slots, column) => {
      const cell = rackCellOf(rack, column);
      const front = frontCellOf(rack, column);
      for (let level = 0; level < slots.length; level++)
        out.push({ id: slotIdOf(rack.id, column, level), rack, rackIndex, column, level, cell, front });
    });
  });
  return out;
}

/**
 * Where a point stands relative to a rack column, in the column's own frame: `depth` = how far past the rack's front
 * face it is (negative = still in front of it; the rack cell spans depth 0‥1), `lateral` = offset from the column's
 * centre line along the rack. Writes into `out`.
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
