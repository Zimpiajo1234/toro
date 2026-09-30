/**
 * Loading dock geometry (docs/DOCKS.md), shared by validation, logic, the level solver and render: the door cells of
 * each truck (floor, inside the map), the bed column beyond each one (outside the map, past the wall), the guard rails
 * beside each door, truck slot ids and the flattened slot / column lists. A truck reads like a storage rack loaded
 * from TRUCK_FACING[wall] whose cells lie one step beyond the wall (its front cells are the door cells), so the
 * core/racks helpers do the geometry. Pure. core/storage builds the `door` access of every storage unit on it
 * (docs/STORAGE.md); the level helpers here (`trucksOf`, `hasTrucks`, `truckColumnsOf`, `truckSlotsOf`,
 * `usesTargetRules`) are views of `level.storage` until phase 7.
 */
import {
  TRUCK_FACING,
  type CellPos,
  type Facing,
  type LevelData,
  type LevelStorage,
  type LevelTruck,
  type StorageAccess,
  type TruckCue,
  type WallSide,
} from './types';
import { FACING_X, FACING_Z, inwardHeading, rackCellOf } from './racks';

/**
 * The jambs of a dock door (u): the opening the carried load passes is this much narrower than its run of door cells
 * at each end, like the side uprights of a rack slot (logic/collision RACK_WALL), so the load (radius 0.46) goes
 * through a 1-cell door with a few cm of play. The door's guard rails run on this line (dockRailsOf).
 */
export const DOOR_JAMB = 0.02;

/** Guard rails of a dock door (docs/DOCKS.md): how thick one is (u), from the jamb line outward into its side cell. */
export const DOCK_RAIL = { thickness: 0.06 } as const;

/**
 * One guard rail of a dock door (docs/DOCKS.md): every door gets one at each end of its run of door cells, by itself
 * (never written in a `.level`): low, straight into the room from the wall's inner face, one cell long, on the door's
 * jamb line (its inner face flush with the side of the opening, so the rails and the opening make one straight chute)
 * and as thick as DOCK_RAIL outward, into the run's `side` cell, which holds a static obstacle (validateLevel). A run
 * that reaches a corner of the room has no side cell and no rail at that end: the wall there already guides. Map
 * units: cell edges at whole numbers, the wall's inner face at 0.
 */
export interface DockRail {
  /** Id of the unit whose door it guards (a door unit of level.storage: a truck). */
  unitId: string;
  wall: WallSide;
  /** Which end of the door run: 0 = its first door cell's (west of a north dock, north of a west one), 1 = its last. */
  end: 0 | 1;
  /** The map cell just past that end along the wall, behind the rail: it holds a static obstacle. */
  side: CellPos;
  /**
   * Along the wall (x of a north dock, z of a west one): the rail's inner face, on the jamb line (the end of the run,
   * DOOR_JAMB into the door), and its outer face, DOCK_RAIL.thickness further out.
   */
  line: number;
  outer: number;
  /**
   * Into the room (z of a north dock, x of a west one): from the wall's inner face to one cell in, the end of the door
   * cells (it never reaches the row behind them, where the forklift lines up).
   */
  from: number;
  to: number;
}

/** A storage unit loaded through a dock door (docs/STORAGE.md access `door`: the truck). */
type DoorUnit = LevelStorage & { access: Extract<StorageAccess, { kind: 'door' }> };

function isDoor(unit: LevelStorage): unit is DoorUnit {
  return unit.access.kind === 'door';
}

/**
 * The guard rails of every dock door of a level (the `door` access, docs/STORAGE.md): door by door in storage order
 * (`unitId` = the door's unit), each door's first end, then its last one.
 */
export function dockRailsOf(level: Pick<LevelData, 'storage' | 'size'>): DockRail[] {
  const out: DockRail[] = [];
  for (const unit of (level.storage ?? []).filter(isDoor)) {
    const { wall } = unit.access;
    const north = wall === 'north';
    const first = north ? unit.x : unit.z;
    const last = first + unit.w;
    const cell = (along: number): CellPos => (north ? { x: along, z: unit.z } : { x: unit.x, z: along });
    const rail = (end: 0 | 1, side: number, line: number, outward: number) =>
      out.push({ unitId: unit.id, wall, end, side: cell(side), line, outer: line + outward * DOCK_RAIL.thickness, from: 0, to: 1 });
    if (first > 0) rail(0, first - 1, first + DOOR_JAMB, -1);
    if (last < (north ? level.size.width : level.size.depth)) rail(1, last, last - DOOR_JAMB, 1);
  }
  return out;
}

/** A storage unit of skin `truck` (always door access: validateLevel checks it). */
function isTruck(unit: LevelStorage): unit is DoorUnit {
  return unit.skin === 'truck' && isDoor(unit);
}

/**
 * A level's trucks (none → an empty list): its storage units of skin `truck`, in storage order, as LevelTruck. A view
 * of `level.storage` until phase 7 (docs/STORAGE.md), derived anew on every call.
 */
export function trucksOf(level: Pick<LevelData, 'storage'>): readonly LevelTruck[] {
  const out: LevelTruck[] = [];
  for (const unit of level.storage ?? []) {
    if (!isTruck(unit)) continue;
    // Every truck level asks for something until phase 6 (no «libre» in a truck yet: docs/STORAGE.md «Huecos» 3).
    const columns = unit.columns.map((levels) => levels.map((cue) => (cue === null ? {} : { ...cue })));
    out.push({ id: unit.id, wall: unit.access.wall, x: unit.x, z: unit.z, w: unit.w, columns });
  }
  return out;
}

/** The level has at least one loading dock (the rules of docs/DOCKS.md apply). A view of `level.storage` until phase 7. */
export function hasTrucks(level: Pick<LevelData, 'storage'>): boolean {
  return (level.storage ?? []).some(isTruck);
}

/**
 * The level follows the target rules (docs/STORAGE.md rules 4–6: destined boxes, locks, soft buzz, strong pulse): it
 * has storage. The old name of core/storage `hasStorage` (the same test, written here because this module sits below
 * core/storage), kept for its callers until phase 7. Levels without storage play exactly as before.
 */
export function usesTargetRules(level: Pick<LevelData, 'storage'>): boolean {
  return (level.storage?.length ?? 0) > 0;
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

/** Every bed column of a level, truck by truck, column by column (a view of `level.storage` until phase 7). */
export function truckColumnsOf(level: Pick<LevelData, 'storage'>): TruckColumnRef[] {
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

/** One truck slot (a level of a bed column), flattened in the order of the truck levels of snapshot.storageSlots. */
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

/**
 * Every truck slot of a level: truck by truck, column by column, bottom → top (the order of the truck levels of
 * snapshot.storageSlots; a view of `level.storage` until phase 7: core/storage `storageSlotsOf`).
 */
export function truckSlotsOf(level: Pick<LevelData, 'storage'>): TruckSlotRef[] {
  const out: TruckSlotRef[] = [];
  for (const col of truckColumnsOf(level)) {
    col.cues.forEach((cue, lvl) =>
      out.push({ id: truckSlotIdOf(col.truck.id, col.column, lvl), truck: col.truck, truckIndex: col.truckIndex, column: col.column, level: lvl, cell: col.cell, front: col.front, cue }),
    );
  }
  return out;
}
