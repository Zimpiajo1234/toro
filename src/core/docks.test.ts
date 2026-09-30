import { describe, expect, it } from 'vitest';
import {
  DOCK_RAIL,
  DOOR_JAMB,
  dockRailsOf,
  hasTrucks,
  truckCellOf,
  truckColumnsOf,
  truckFacing,
  truckFrontOf,
  truckInwardHeading,
  truckSlotIdOf,
  truckSlotsOf,
  trucksOf,
  usesTargetRules,
} from './docks';
import { levelDestinies, targetsOf, usesSymbols, zoneMatchKinds } from './sorting';
import { cellToWorld, forwardOf, type LevelData, type LevelStorage, type LevelTruck } from './types';
import { columnFrame } from './racks';

/*
 * Loading dock geometry and targets (docs/DOCKS.md): the door cells are map cells against the wall; the bed column of
 * each one lies just beyond the wall, outside the map; a truck reads like a rack loaded from TRUCK_FACING[wall]; a
 * guard rail stands at each end of the door run, on its jamb line, one cell into the room.
 */

const NORTH: LevelTruck = { id: 't1', wall: 'north', x: 2, z: 0, w: 2, columns: [[{ color: 'blue' }, { symbol: 'triangle' }], [{ color: 'coral', symbol: 'diamond' }]] };
const WEST: LevelTruck = { id: 't2', wall: 'west', x: 0, z: 1, w: 2, columns: [[{ color: 'mint' }], [{ symbol: 'square' }]] };

/** A level whose storage is these trucks (level data keeps them as LevelStorage; core/docks trucksOf gives them back). */
const withTrucks = (...trucks: LevelTruck[]): Pick<LevelData, 'storage'> => ({
  storage: trucks.map(
    (truck): LevelStorage => ({ id: truck.id, skin: 'truck', x: truck.x, z: truck.z, w: truck.w, access: { kind: 'door', wall: truck.wall }, columns: truck.columns.map((levels) => levels.map((cue) => ({ ...cue }))) }),
  ),
});

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
    expect([truckFrontOf(NORTH, 0), truckFrontOf(NORTH, 1)]).toEqual([
      { x: 2, z: 0 },
      { x: 3, z: 0 },
    ]);
    expect([truckCellOf(NORTH, 0), truckCellOf(NORTH, 1)]).toEqual([
      { x: 2, z: -1 },
      { x: 3, z: -1 },
    ]);
    expect(truckFacing(NORTH)).toBe('south');
    expect([truckFrontOf(WEST, 0), truckFrontOf(WEST, 1)]).toEqual([
      { x: 0, z: 1 },
      { x: 0, z: 2 },
    ]);
    expect([truckCellOf(WEST, 0), truckCellOf(WEST, 1)]).toEqual([
      { x: -1, z: 1 },
      { x: -1, z: 2 },
    ]);
    expect(truckFacing(WEST)).toBe('east');
    // Facing into the truck from a door cell: north (−z) for a north dock, west (−x) for a west one.
    const n = forwardOf(truckInwardHeading(NORTH));
    const w = forwardOf(truckInwardHeading(WEST));
    expect([n.x, n.z].map((v) => Math.round(v) + 0)).toEqual([0, -1]);
    expect([w.x, w.z].map((v) => Math.round(v) + 0)).toEqual([-1, 0]);
  });

  it('in the column frame of a bed cell, depth 0 is the wall line: the door cell is in front of it, the bed beyond', () => {
    const size = { width: 6, depth: 5 };
    const frame = { depth: 0, lateral: 0 };
    const bed = cellToWorld(truckCellOf(NORTH, 1), size);
    const door = cellToWorld(truckFrontOf(NORTH, 1), size);
    // The north wall is at z = -depth / 2.
    expect(columnFrame(bed, 'south', bed.x, -size.depth / 2, frame).depth).toBeCloseTo(0, 9);
    expect(columnFrame(bed, 'south', door.x, door.z, frame)).toMatchObject({ depth: -0.5 });
    expect(columnFrame(bed, 'south', bed.x, bed.z, frame)).toMatchObject({ depth: 0.5, lateral: 0 });
  });

  it('flattens columns and slots truck by truck, column by column, bottom → top, with ids «truck:column:level»', () => {
    const both = withTrucks(NORTH, WEST);
    expect(truckColumnsOf(both).map((c) => [c.truck.id, c.column, c.cues.length, c.firstSlot])).toEqual([
      ['t1', 0, 2, 0],
      ['t1', 1, 1, 2],
      ['t2', 0, 1, 3],
      ['t2', 1, 1, 4],
    ]);
    expect(truckSlotsOf(both).map((s) => s.id)).toEqual(['t1:0:0', 't1:0:1', 't1:1:0', 't2:0:0', 't2:1:0']);
    expect(truckSlotsOf(both)[1]).toMatchObject({ truckIndex: 0, column: 0, level: 1, cell: { x: 2, z: -1 }, front: { x: 2, z: 0 }, cue: { symbol: 'triangle' } });
    expect(truckColumnsOf(both)[3]).toMatchObject({ cell: { x: -1, z: 2 }, front: { x: 0, z: 2 }, facing: 'east' });
    expect(truckSlotIdOf('t9', 3, 2)).toBe('t9:3:2');
    expect(trucksOf({})).toEqual([]);
    expect(hasTrucks({})).toBe(false);
    expect(hasTrucks(both)).toBe(true);
  });

  it('guard rails: one at each end of a door run, on its jamb line, one cell into the room, thick outward; none at a corner', () => {
    const size = { width: 7, depth: 5 };
    const T = DOCK_RAIL.thickness;
    // A north door over x 2‥4: its side cells (1,0) and (4,0), its rails just inside the ends of the run.
    expect(dockRailsOf({ ...withTrucks(NORTH), size })).toEqual([
      { truckIndex: 0, wall: 'north', end: 0, side: { x: 1, z: 0 }, line: 2 + DOOR_JAMB, outer: 2 + DOOR_JAMB - T, from: 0, to: 1 },
      { truckIndex: 0, wall: 'north', end: 1, side: { x: 4, z: 0 }, line: 4 - DOOR_JAMB, outer: 4 - DOOR_JAMB + T, from: 0, to: 1 },
    ]);
    // A west door over z 1‥3: along column 0, from the west wall's inner face (x = 0) one cell in.
    expect(dockRailsOf({ ...withTrucks(NORTH, WEST), size }).slice(2)).toEqual([
      { truckIndex: 1, wall: 'west', end: 0, side: { x: 0, z: 0 }, line: 1 + DOOR_JAMB, outer: 1 + DOOR_JAMB - T, from: 0, to: 1 },
      { truckIndex: 1, wall: 'west', end: 1, side: { x: 0, z: 3 }, line: 3 - DOOR_JAMB, outer: 3 - DOOR_JAMB + T, from: 0, to: 1 },
    ]);
    // A run that reaches a corner of the room has no side cell (and no rail) at that end.
    expect(dockRailsOf({ ...withTrucks({ ...NORTH, x: 0 }), size }).map((r) => [r.end, r.side])).toEqual([[1, { x: 2, z: 0 }]]);
    expect(dockRailsOf({ ...withTrucks({ ...NORTH, x: 5 }), size }).map((r) => [r.end, r.side])).toEqual([[0, { x: 4, z: 0 }]]);
    expect(dockRailsOf({ ...withTrucks({ ...WEST, z: 0 }), size }).map((r) => r.end)).toEqual([1]);
    expect(dockRailsOf({ ...withTrucks({ ...WEST, z: 3 }), size }).map((r) => r.end)).toEqual([0]);
    expect(dockRailsOf({ size })).toEqual([]);
  });

  it('the target rules apply with racks or trucks, never without both', () => {
    expect(usesTargetRules({})).toBe(false);
    expect(usesTargetRules({ storage: [] })).toBe(false);
    expect(usesTargetRules(withTrucks(NORTH))).toBe(true);
    expect(usesTargetRules({ storage: [{ id: 'r1', skin: 'rack', x: 0, z: 0, w: 1, access: { kind: 'front', facing: 'south' }, columns: [[null]] }] })).toBe(true);
  });
});

describe('truck levels as targets (core/sorting)', () => {
  it('targets end with every truck level; destinies come from the unique assignment', () => {
    expect(targetsOf(level).map((t) => [t.kind, t.id, t.index])).toEqual([
      ['truck', 't1:0:0', 0],
      ['truck', 't1:0:1', 1],
      ['truck', 't1:1:0', 2],
    ]);
    // «azul» takes the only blue box; so «▲» is mint ▲'s, and coral ◆ its exact level.
    expect(levelDestinies(level)).toEqual({
      zones: [],
      slots: [],
      trucks: [
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
