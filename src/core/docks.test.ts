import { describe, expect, it } from 'vitest';
import { DOCK_RAIL, DOOR_JAMB, dockRailsOf, truckCellOf, truckFrontOf } from './docks';
import { columnFrame, inwardHeading } from './racks';
import { levelDestinies, targetsOf, usesSymbols, zoneMatchKinds } from './sorting';
import { facingOf, storageColumnsOf, storageSlotsOf } from './storage';
import { TRUCK_FACING, cellToWorld, forwardOf, type DoorUnit, type LevelData, type LevelStorage, type WallSide } from './types';

/*
 * Loading dock geometry and targets (docs/DOCKS.md; the `door` access of docs/STORAGE.md): the door cells are map cells
 * against the wall; the bed column of each one lies just beyond the wall, outside the map; a truck reads like a rack
 * loaded from TRUCK_FACING[wall]; a guard rail stands at each end of the door run, on its jamb line, one cell into the
 * room.
 */

/** A dock truck: a unit of skin `truck` (door access), its columns' cues bottom → top. */
const truck = (id: string, wall: WallSide, x: number, z: number, columns: LevelStorage['columns']): DoorUnit => ({
  id,
  skin: 'truck',
  x,
  z,
  w: columns.length,
  access: { kind: 'door', wall },
  columns,
});

const NORTH = truck('t1', 'north', 2, 0, [[{ color: 'blue' }, { symbol: 'triangle' }], [{ color: 'coral', symbol: 'diamond' }]]);
const WEST = truck('t2', 'west', 0, 1, [[{ color: 'mint' }], [{ symbol: 'square' }]]);
/** A truck's door run, as the door geometry reads it: its first door cell and its wall. */
const runOf = (unit: DoorUnit) => ({ x: unit.x, z: unit.z, wall: unit.access.wall });

/** A level whose storage is these trucks. */
const withTrucks = (...trucks: LevelStorage[]): Pick<LevelData, 'storage'> => ({ storage: trucks });

const level: Pick<LevelData, 'boxes' | 'zones' | 'storage'> = {
  boxes: [
    { id: 'b1', color: 'blue', symbol: 'triangle', x: 1, z: 2 },
    { id: 'b2', color: 'coral', symbol: 'diamond', x: 5, z: 2 },
    { id: 'b3', color: 'mint', symbol: 'triangle', x: 3, z: -1, level: 0 },
  ],
  zones: [],
  ...withTrucks(NORTH),
};

describe('core/docks geometry', () => {
  it('a north dock: door cells along row 0, bed columns just beyond the north wall (z = -1); a west one on column 0 / x = -1', () => {
    // The door cells (inside, floor) are where the forklift stands; the bed columns lie outside, one per door cell.
    expect([truckFrontOf(runOf(NORTH), 0), truckFrontOf(runOf(NORTH), 1)]).toEqual([
      { x: 2, z: 0 },
      { x: 3, z: 0 },
    ]);
    expect([truckCellOf(runOf(NORTH), 0), truckCellOf(runOf(NORTH), 1)]).toEqual([
      { x: 2, z: -1 },
      { x: 3, z: -1 },
    ]);
    expect(facingOf(NORTH)).toBe('south');
    expect(TRUCK_FACING.north).toBe('south');
    expect([truckFrontOf(runOf(WEST), 0), truckFrontOf(runOf(WEST), 1)]).toEqual([
      { x: 0, z: 1 },
      { x: 0, z: 2 },
    ]);
    expect([truckCellOf(runOf(WEST), 0), truckCellOf(runOf(WEST), 1)]).toEqual([
      { x: -1, z: 1 },
      { x: -1, z: 2 },
    ]);
    expect(facingOf(WEST)).toBe('east');
    // Facing into the truck from a door cell: north (−z) for a north dock, west (−x) for a west one.
    const n = forwardOf(inwardHeading(facingOf(NORTH)));
    const w = forwardOf(inwardHeading(facingOf(WEST)));
    expect([n.x, n.z].map((v) => Math.round(v) + 0)).toEqual([0, -1]);
    expect([w.x, w.z].map((v) => Math.round(v) + 0)).toEqual([-1, 0]);
  });

  it('in the column frame of a bed cell, depth 0 is the wall line: the door cell is in front of it, the bed beyond', () => {
    const size = { width: 6, depth: 5 };
    const frame = { depth: 0, lateral: 0 };
    const bed = cellToWorld(truckCellOf(runOf(NORTH), 1), size);
    const door = cellToWorld(truckFrontOf(runOf(NORTH), 1), size);
    // The north wall is at z = -depth / 2.
    expect(columnFrame(bed, 'south', bed.x, -size.depth / 2, frame).depth).toBeCloseTo(0, 9);
    expect(columnFrame(bed, 'south', door.x, door.z, frame)).toMatchObject({ depth: -0.5 });
    expect(columnFrame(bed, 'south', bed.x, bed.z, frame)).toMatchObject({ depth: 0.5, lateral: 0 });
  });

  it('a level\'s truck columns and levels flatten truck by truck, column by column, bottom → top, with ids «truck:column:level»', () => {
    const both = withTrucks(NORTH, WEST);
    expect(storageColumnsOf(both).map((c) => [c.unit.id, c.column, c.cues.length, c.firstSlot])).toEqual([
      ['t1', 0, 2, 0],
      ['t1', 1, 1, 2],
      ['t2', 0, 1, 3],
      ['t2', 1, 1, 4],
    ]);
    expect(storageSlotsOf(both).map((s) => s.id)).toEqual(['t1:0:0', 't1:0:1', 't1:1:0', 't2:0:0', 't2:1:0']);
    expect(storageSlotsOf(both)[1]).toMatchObject({ unitIndex: 0, column: 0, level: 1, cell: { x: 2, z: -1 }, front: { x: 2, z: 0 }, cue: { symbol: 'triangle' } });
    expect(storageColumnsOf(both)[3]).toMatchObject({ cell: { x: -1, z: 2 }, front: { x: 0, z: 2 }, facing: 'east' });
  });

  it('guard rails: one at each end of a door run, on its jamb line, one cell into the room, thick outward; none at a corner', () => {
    const size = { width: 7, depth: 5 };
    const T = DOCK_RAIL.thickness;
    // A north door over x 2‥4: its side cells (1,0) and (4,0), its rails just inside the ends of the run.
    expect(dockRailsOf({ ...withTrucks(NORTH), size })).toEqual([
      { unitId: 't1', wall: 'north', end: 0, side: { x: 1, z: 0 }, line: 2 + DOOR_JAMB, outer: 2 + DOOR_JAMB - T, from: 0, to: 1 },
      { unitId: 't1', wall: 'north', end: 1, side: { x: 4, z: 0 }, line: 4 - DOOR_JAMB, outer: 4 - DOOR_JAMB + T, from: 0, to: 1 },
    ]);
    // A west door over z 1‥3: along column 0, from the west wall's inner face (x = 0) one cell in.
    expect(dockRailsOf({ ...withTrucks(NORTH, WEST), size }).slice(2)).toEqual([
      { unitId: 't2', wall: 'west', end: 0, side: { x: 0, z: 0 }, line: 1 + DOOR_JAMB, outer: 1 + DOOR_JAMB - T, from: 0, to: 1 },
      { unitId: 't2', wall: 'west', end: 1, side: { x: 0, z: 3 }, line: 3 - DOOR_JAMB, outer: 3 - DOOR_JAMB + T, from: 0, to: 1 },
    ]);
    // A run that reaches a corner of the room has no side cell (and no rail) at that end.
    expect(dockRailsOf({ ...withTrucks({ ...NORTH, x: 0 }), size }).map((r) => [r.end, r.side])).toEqual([[1, { x: 2, z: 0 }]]);
    expect(dockRailsOf({ ...withTrucks({ ...NORTH, x: 5 }), size }).map((r) => [r.end, r.side])).toEqual([[0, { x: 4, z: 0 }]]);
    expect(dockRailsOf({ ...withTrucks({ ...WEST, z: 0 }), size }).map((r) => r.end)).toEqual([1]);
    expect(dockRailsOf({ ...withTrucks({ ...WEST, z: 3 }), size }).map((r) => r.end)).toEqual([0]);
    expect(dockRailsOf({ size })).toEqual([]);
  });
});

describe('truck levels as targets (core/sorting)', () => {
  it('targets end with every truck level; destinies come from the unique assignment', () => {
    expect(targetsOf(level).map((t) => [t.kind, t.skin, t.id, t.index])).toEqual([
      ['slot', 'truck', 't1:0:0', 0],
      ['slot', 'truck', 't1:0:1', 1],
      ['slot', 'truck', 't1:1:0', 2],
    ]);
    // «azul» takes the only blue box; so «▲» is mint ▲'s, and coral ◆ its exact level.
    expect(levelDestinies(level)).toEqual({
      zones: [],
      slots: [
        { color: 'blue', symbol: 'triangle' },
        { color: 'mint', symbol: 'triangle' },
        { color: 'coral', symbol: 'diamond' },
      ],
    });
    expect(levelDestinies({ ...level, storage: undefined })).toBeNull();
  });

  it('truck cues count for symbols and match kinds (by truck slot id)', () => {
    const plain = { boxes: [{ id: 'b', color: 'blue' as const, x: 0, z: 0 }], zones: [] };
    expect(usesSymbols({ ...plain, ...withTrucks({ ...NORTH, columns: [[{ color: 'blue' }]] }) })).toBe(false);
    expect(usesSymbols({ ...plain, ...withTrucks(NORTH) })).toBe(true);
    const kinds = zoneMatchKinds({ zones: [], ...withTrucks(NORTH) });
    expect([...kinds]).toEqual([
      ['t1:0:0', 'color'],
      ['t1:0:1', 'symbol'],
      ['t1:1:0', 'exact'],
    ]);
  });
});
