import { describe, expect, it } from 'vitest';
import {
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
import { forwardOf, type LevelData, type LevelTruck } from './types';

/* Loading dock geometry and targets (docs/DOCKS.md): a truck reads like a rack loaded from TRUCK_FACING[wall]. */

const NORTH: LevelTruck = { id: 't1', wall: 'north', x: 2, z: 0, w: 2, columns: [[{ color: 'blue' }, { symbol: 'triangle' }], [{ color: 'coral', symbol: 'diamond' }]] };
const WEST: LevelTruck = { id: 't2', wall: 'west', x: 0, z: 1, w: 2, columns: [[{ color: 'mint' }], [{ symbol: 'square' }]] };

const level: Pick<LevelData, 'boxes' | 'zones' | 'trucks'> = {
  boxes: [
    { id: 'b1', color: 'blue', symbol: 'triangle', x: 1, z: 2 },
    { id: 'b2', color: 'coral', symbol: 'diamond', x: 5, z: 2 },
    { id: 'b3', color: 'mint', symbol: 'triangle', x: 3, z: 0, level: 0 },
  ],
  zones: [],
  trucks: [NORTH],
};

describe('core/docks geometry', () => {
  it('a north dock runs along x on row 0 and is loaded from the south; a west one along z on column 0, from the east', () => {
    expect([truckCellOf(NORTH, 0), truckCellOf(NORTH, 1)]).toEqual([
      { x: 2, z: 0 },
      { x: 3, z: 0 },
    ]);
    expect(truckFrontOf(NORTH, 1)).toEqual({ x: 3, z: 1 });
    expect(truckFacing(NORTH)).toBe('south');
    expect([truckCellOf(WEST, 0), truckCellOf(WEST, 1)]).toEqual([
      { x: 0, z: 1 },
      { x: 0, z: 2 },
    ]);
    expect(truckFrontOf(WEST, 0)).toEqual({ x: 1, z: 1 });
    expect(truckFacing(WEST)).toBe('east');
    // Facing into the truck from the front: north (−z) for a north dock, west (−x) for a west one.
    const n = forwardOf(truckInwardHeading(NORTH));
    const w = forwardOf(truckInwardHeading(WEST));
    expect([n.x, n.z].map((v) => Math.round(v) + 0)).toEqual([0, -1]);
    expect([w.x, w.z].map((v) => Math.round(v) + 0)).toEqual([-1, 0]);
  });

  it('flattens columns and slots truck by truck, column by column, bottom → top, with ids «truck:column:level»', () => {
    const both = { trucks: [NORTH, WEST] };
    expect(truckColumnsOf(both).map((c) => [c.truck.id, c.column, c.cues.length, c.firstSlot])).toEqual([
      ['t1', 0, 2, 0],
      ['t1', 1, 1, 2],
      ['t2', 0, 1, 3],
      ['t2', 1, 1, 4],
    ]);
    expect(truckSlotsOf(both).map((s) => s.id)).toEqual(['t1:0:0', 't1:0:1', 't1:1:0', 't2:0:0', 't2:1:0']);
    expect(truckSlotsOf(both)[1]).toMatchObject({ truckIndex: 0, column: 0, level: 1, cell: { x: 2, z: 0 }, front: { x: 2, z: 1 }, cue: { symbol: 'triangle' } });
    expect(truckSlotIdOf('t9', 3, 2)).toBe('t9:3:2');
    expect(trucksOf({})).toEqual([]);
    expect(hasTrucks({})).toBe(false);
    expect(hasTrucks(both)).toBe(true);
  });

  it('the target rules apply with racks or trucks, never without both', () => {
    expect(usesTargetRules({})).toBe(false);
    expect(usesTargetRules({ racks: [], trucks: [] })).toBe(false);
    expect(usesTargetRules({ trucks: [NORTH] })).toBe(true);
    expect(usesTargetRules({ racks: [{ id: 'r1', x: 0, z: 0, w: 1, facing: 'south', columns: [[{}]] }] })).toBe(true);
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
    expect(levelDestinies({ ...level, trucks: undefined })).toBeNull();
  });

  it('truck cues count for symbols and match kinds (by truck slot id)', () => {
    const plain = { boxes: [{ id: 'b', color: 'blue' as const, x: 0, z: 0 }], zones: [] };
    expect(usesSymbols({ ...plain, trucks: [{ ...NORTH, columns: [[{ color: 'blue' }]] }] })).toBe(false);
    expect(usesSymbols({ ...plain, trucks: [NORTH] })).toBe(true);
    const kinds = zoneMatchKinds({ zones: [], trucks: [NORTH] });
    expect([...kinds]).toEqual([
      ['t1:0:0', 'color'],
      ['t1:0:1', 'symbol'],
      ['t1:1:0', 'exact'],
    ]);
  });
});
