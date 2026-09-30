/**
 * Loading dock geometry (docs/DOCKS.md), shared by validation, logic, the level solver and render: the door cells of
 * each truck (floor, inside the map), the bed column beyond each one (outside the map, past the wall), truck slot ids
 * and the flattened slot / column lists. A truck reads like a storage rack loaded from TRUCK_FACING[wall] whose cells
 * lie one step beyond the wall (its front cells are the door cells), so the core/racks helpers do the geometry. Pure.
 */
import { TRUCK_FACING, type CellPos, type Facing, type LevelData, type LevelTruck, type TruckCue } from './types';
import { FACING_X, FACING_Z, hasRacks, inwardHeading, rackCellOf } from './racks';

/** A level's trucks (none → an empty list). */
export function trucksOf(level: Pick<LevelData, 'trucks'>): readonly LevelTruck[] {
  return level.trucks ?? [];
}

/** The level has at least one loading dock (the rules of docs/DOCKS.md apply). */
export function hasTrucks(level: Pick<LevelData, 'trucks'>): boolean {
  return (level.trucks?.length ?? 0) > 0;
}

/**
 * The level follows the target rules of docs/RACKS.md «niveles con estanterías» (destined boxes, locks, soft buzz,
 * strong pulse): it has storage racks or trucks (docs/DOCKS.md rule 10). Levels with neither play exactly as before.
 */
export function usesTargetRules(level: Partial<Pick<LevelData, 'racks' | 'trucks'>>): boolean {
  return hasRacks(level) || hasTrucks(level);
}

/** Side a truck is loaded from (its bed columns' front cells lie that way). */
export function truckFacing(truck: Pick<LevelTruck, 'wall'>): Facing {
  return TRUCK_FACING[truck.wall];
}

/**
 * Bed cell of `column` (0 = the truck's first door cell: the west-most of a north dock, the north-most of a west one):
 * OUTSIDE the map, one step beyond the wall from its door cell (a north dock: z = -1; a west dock: x = -1). A box on
 * the truck rests there; its world centre is cellToWorld of it, just past the wall.
 */
export function truckCellOf(truck: Pick<LevelTruck, 'x' | 'z' | 'wall'>, column: number): CellPos {
  const facing = TRUCK_FACING[truck.wall];
  return rackCellOf({ x: truck.x - FACING_X[facing], z: truck.z - FACING_Z[facing], facing }, column);
}

/**
 * Door cell of `column`: the map cell (floor) in front of the door, row 0 of a north dock or column 0 of a west one,
 * where the forklift stands facing the wall to load or unload that column through the door.
 */
export function truckFrontOf(truck: Pick<LevelTruck, 'x' | 'z' | 'wall'>, column: number): CellPos {
  return rackCellOf({ x: truck.x, z: truck.z, facing: TRUCK_FACING[truck.wall] }, column);
}

/** Heading (radians) of a forklift on a column's door cell facing the wall, into the truck. */
export function truckInwardHeading(truck: Pick<LevelTruck, 'wall'>): number {
  return inwardHeading(TRUCK_FACING[truck.wall]);
}

/** Id of a truck slot: `${truckId}:${column}:${level}` (column and level from 0; level 0 = on the bed). */
export function truckSlotIdOf(truckId: string, column: number, level: number): string {
  return `${truckId}:${column}:${level}`;
}

/** One bed column of a level, flattened: every truck, column by column (the order of their slots). */
export interface TruckColumnRef {
  truck: LevelTruck;
  truckIndex: number;
  column: number;
  /** Its bed cell, outside the map (truckCellOf). */
  cell: CellPos;
  /** Its door cell, inside the map (truckFrontOf). */
  front: CellPos;
  facing: Facing;
  /** Levels of the column (1‥MAX_TRUCK_LEVELS): its cues, bottom → top. */
  cues: readonly TruckCue[];
  /** Index of its bottom level in truckSlotsOf (level n is firstSlot + n). */
  firstSlot: number;
}

/** Every bed column of a level, truck by truck, column by column. */
export function truckColumnsOf(level: Pick<LevelData, 'trucks'>): TruckColumnRef[] {
  const out: TruckColumnRef[] = [];
  let firstSlot = 0;
  trucksOf(level).forEach((truck, truckIndex) => {
    truck.columns.forEach((cues, column) => {
      out.push({
        truck,
        truckIndex,
        column,
        cell: truckCellOf(truck, column),
        front: truckFrontOf(truck, column),
        facing: TRUCK_FACING[truck.wall],
        cues,
        firstSlot,
      });
      firstSlot += cues.length;
    });
  });
  return out;
}

/** One truck slot (a level of a bed column), flattened in GameSnapshot.truckSlots order. */
export interface TruckSlotRef {
  id: string;
  truck: LevelTruck;
  truckIndex: number;
  column: number;
  level: number;
  /** Bed cell (outside the map) and door cell (inside) of its column. */
  cell: CellPos;
  front: CellPos;
  /** The level's cue (never «libre»). */
  cue: TruckCue;
}

/** Every truck slot of a level: truck by truck, column by column, bottom → top (the order of snapshot.truckSlots). */
export function truckSlotsOf(level: Pick<LevelData, 'trucks'>): TruckSlotRef[] {
  const out: TruckSlotRef[] = [];
  for (const col of truckColumnsOf(level)) {
    col.cues.forEach((cue, lvl) =>
      out.push({ id: truckSlotIdOf(col.truck.id, col.column, lvl), truck: col.truck, truckIndex: col.truckIndex, column: col.column, level: lvl, cell: col.cell, front: col.front, cue }),
    );
  }
  return out;
}
