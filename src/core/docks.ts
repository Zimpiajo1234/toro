/**
 * Geometry of the `door` access (docs/STORAGE.md «Acceso»; the loading dock's truck, docs/DOCKS.md), shared by
 * validation, logic, the level solver and render: the door cells of each unit (floor, inside the map), the column
 * beyond each one (outside the map, past the wall) and the guard rails beside each door. A door column reads like a
 * column of the `front` access loaded from TRUCK_FACING[wall] whose cell lies one step beyond the wall (its front cell
 * is the door cell), so the core/racks helpers do the geometry; core/storage builds every door unit's `cellOf` /
 * `frontOf` on it. Pure.
 */
import { TRUCK_FACING, isDoorUnit, type CellPos, type LevelData, type WallSide } from './types';
import { FACING_X, FACING_Z, rackCellOf } from './racks';

/** A door's run of cells: its first door cell (x, z) along `wall`. */
interface DoorRun {
  readonly x: number;
  readonly z: number;
  readonly wall: WallSide;
}

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

/**
 * The guard rails of every dock door of a level (the `door` access, docs/STORAGE.md): door by door in storage order
 * (`unitId` = the door's unit), each door's first end, then its last one.
 */
export function dockRailsOf(level: Pick<LevelData, 'storage' | 'size'>): DockRail[] {
  const out: DockRail[] = [];
  for (const unit of (level.storage ?? []).filter(isDoorUnit)) {
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

/**
 * Cell of door column `column` (0 = the unit's first door cell: the west-most of a north door, the north-most of a
 * west one): OUTSIDE the map, one step beyond the wall from its door cell (a north door: z = -1; a west door: x = -1).
 * A box stored there (on the truck's bed) rests on it; its world centre is cellToWorld of it, just past the wall.
 */
export function truckCellOf(run: DoorRun, column: number): CellPos {
  const facing = TRUCK_FACING[run.wall];
  return rackCellOf({ x: run.x - FACING_X[facing], z: run.z - FACING_Z[facing], facing }, column);
}

/**
 * Door cell of `column`: the map cell (floor) in front of the door, row 0 of a north door or column 0 of a west one,
 * where the forklift stands facing the wall to load or unload that column through the door.
 */
export function truckFrontOf(run: DoorRun, column: number): CellPos {
  return rackCellOf({ x: run.x, z: run.z, facing: TRUCK_FACING[run.wall] }, column);
}
