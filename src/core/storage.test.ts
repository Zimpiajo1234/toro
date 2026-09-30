import { describe, expect, it } from 'vitest';
import { DOCK_RAIL, DOOR_JAMB, dockRailsOf, hasTrucks, truckCellOf, truckColumnsOf, truckFrontOf, truckSlotsOf, trucksOf, usesTargetRules } from './docks';
import { frontCellOf, hasRacks, inwardHeading as rackInwardHeading, racksOf, rackCellOf, slotIdOf as rackSlotIdOf, slotsOf } from './racks';
import { levelDestinies, targetsOf, usesSymbols, zoneMatchKinds } from './sorting';
import {
  STORAGE_SKINS,
  STORAGE_SKIN_ORDER,
  cellOf,
  facingOf,
  frontOf,
  hasStorage,
  inwardHeading,
  slotIdOf,
  storageColumnsOf,
  storageOf,
  storageSlotsOf,
} from './storage';
import {
  FACINGS,
  MAX_RACK_SLOTS,
  MAX_TRUCK_COLUMNS,
  MAX_TRUCK_LEVELS,
  TRUCK_FACING,
  forwardOf,
  type LevelData,
  type LevelStorage,
  type StorageAccess,
} from './types';

/*
 * The shared storage model (docs/STORAGE.md, phase 2): one skin row per look, one geometry for every unit through its
 * access, and the old per-skin helpers (core/racks, core/docks) as views of `level.storage`.
 */

const unit = (id: string, skin: LevelStorage['skin'], x: number, z: number, access: StorageAccess, columns: LevelStorage['columns']): LevelStorage => ({
  id,
  skin,
  x,
  z,
  w: columns.length,
  access,
  columns,
});

/**
 * A synthetic 9×8 level (geometry only, never played) with a rack of every facing and a truck in each wall, racks
 * first (rule 12):
 * - r1 faces north along x over (2,5)–(3,5), loaded from row 4; r2 faces east along z over (6,2)–(6,3), loaded from
 *   column 7; r3 faces south on (3,0), loaded from (3,1); r4 faces west on (1,6), loaded from (0,6);
 * - t1: a north door on (5,0)–(6,0), its bed cells at z = -1; t2: a west door on (0,3), its bed cell at x = -1.
 */
const RN = unit('r1', 'rack', 2, 5, { kind: 'front', facing: 'north' }, [[{ color: 'blue' }, null], [null]]);
const RE = unit('r2', 'rack', 6, 2, { kind: 'front', facing: 'east' }, [[{ symbol: 'triangle' }], [null, null, { color: 'mint', symbol: 'circle' }]]);
const RS = unit('r3', 'rack', 3, 0, { kind: 'front', facing: 'south' }, [[null]]);
const RW = unit('r4', 'rack', 1, 6, { kind: 'front', facing: 'west' }, [[{ color: 'coral' }]]);
const TN = unit('t1', 'truck', 5, 0, { kind: 'door', wall: 'north' }, [[{ color: 'yellow' }, { symbol: 'square' }], [{ color: 'lavender', symbol: 'cross' }]]);
const TW = unit('t2', 'truck', 0, 3, { kind: 'door', wall: 'west' }, [[{ color: 'blue', symbol: 'diamond' }]]);
const MANY: Pick<LevelData, 'storage' | 'size'> = { storage: [RN, RE, RS, RW, TN, TW], size: { width: 9, depth: 8 } };

describe('STORAGE_SKINS (docs/STORAGE.md «Modelo»)', () => {
  it('one row per skin, in the order of a level\'s units: racks (shelves, front), then trucks (stack, door)', () => {
    expect(STORAGE_SKIN_ORDER).toEqual(['rack', 'truck']);
    expect(STORAGE_SKINS).toEqual({
      rack: { support: 'shelves', maxLevels: 3, maxColumns: Infinity, access: 'front', idPrefix: 'r', chars: 'RSTUVWXYZKLMNO', fillToMax: false, sound: 'metal' },
      truck: { support: 'stack', maxLevels: 2, maxColumns: 3, access: 'door', idPrefix: 't', chars: 'TCUVWXYZKLMNO', fillToMax: true, sound: 'wood' },
    });
    // The same numbers as the per-skin constants they replace in phase 7.
    expect([STORAGE_SKINS.rack.maxLevels, STORAGE_SKINS.truck.maxLevels, STORAGE_SKINS.truck.maxColumns]).toEqual([MAX_RACK_SLOTS, MAX_TRUCK_LEVELS, MAX_TRUCK_COLUMNS]);
  });

  it('id prefixes differ (no two slot ids clash); each skin\'s letters are distinct capitals, never a fixed map character', () => {
    const prefixes = STORAGE_SKIN_ORDER.map((skin) => STORAGE_SKINS[skin].idPrefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const skin of STORAGE_SKIN_ORDER) {
      const { chars } = STORAGE_SKINS[skin];
      expect(chars, skin).toMatch(/^[A-Z]+$/);
      expect(new Set(chars).size, skin).toBe(chars.length);
    }
  });
});

describe('storage of a level', () => {
  it('storageOf / hasStorage: none, an empty list, some units (usesTargetRules is its old name)', () => {
    for (const level of [{}, { storage: [] }]) {
      expect(storageOf(level)).toEqual([]);
      expect(hasStorage(level)).toBe(false);
      expect(usesTargetRules(level)).toBe(false);
    }
    expect(storageOf(MANY)).toBe(MANY.storage);
    expect(hasStorage(MANY)).toBe(true);
    expect(usesTargetRules(MANY)).toBe(true);
    expect(hasStorage({ storage: [RS] })).toBe(true);
    expect(hasStorage({ storage: [TW] })).toBe(true);
  });
});

describe('geometry of every unit (core/storage)', () => {
  it('front access, all four facings: its own cells along the run, loaded from the floor cell on the facing side', () => {
    expect([0, 1].map((c) => [cellOf(RN, c), frontOf(RN, c)])).toEqual([
      [{ x: 2, z: 5 }, { x: 2, z: 4 }],
      [{ x: 3, z: 5 }, { x: 3, z: 4 }],
    ]);
    expect([0, 1].map((c) => [cellOf(RE, c), frontOf(RE, c)])).toEqual([
      [{ x: 6, z: 2 }, { x: 7, z: 2 }],
      [{ x: 6, z: 3 }, { x: 7, z: 3 }],
    ]);
    expect([cellOf(RS, 0), frontOf(RS, 0)]).toEqual([{ x: 3, z: 0 }, { x: 3, z: 1 }]);
    expect([cellOf(RW, 0), frontOf(RW, 0)]).toEqual([{ x: 1, z: 6 }, { x: 0, z: 6 }]);
    expect([RN, RE, RS, RW].map(facingOf)).toEqual(['north', 'east', 'south', 'west']);
    // The core/racks math, whatever the facing.
    for (const facing of FACINGS) {
      const u = unit('r9', 'rack', 4, 4, { kind: 'front', facing }, [[null], [null]]);
      for (const c of [0, 1]) {
        expect(cellOf(u, c), `${facing} ${c}`).toEqual(rackCellOf({ x: 4, z: 4, facing }, c));
        expect(frontOf(u, c), `${facing} ${c}`).toEqual(frontCellOf({ x: 4, z: 4, facing }, c));
      }
    }
  });

  it('door access, both walls: the door cells along the wall (row 0 / column 0), each column\'s cell beyond the wall, outside the map', () => {
    expect([0, 1].map((c) => [cellOf(TN, c), frontOf(TN, c)])).toEqual([
      [{ x: 5, z: -1 }, { x: 5, z: 0 }],
      [{ x: 6, z: -1 }, { x: 6, z: 0 }],
    ]);
    expect([cellOf(TW, 0), frontOf(TW, 0)]).toEqual([{ x: -1, z: 3 }, { x: 0, z: 3 }]);
    expect([TN, TW].map(facingOf)).toEqual([TRUCK_FACING.north, TRUCK_FACING.west]);
    expect([TN, TW].map(facingOf)).toEqual(['south', 'east']);
    // The core/docks math.
    for (const wall of ['north', 'west'] as const) {
      const u = unit('t9', 'truck', wall === 'north' ? 3 : 0, wall === 'north' ? 0 : 3, { kind: 'door', wall }, [[{ color: 'blue' }], [{ color: 'mint' }]]);
      for (const c of [0, 1]) {
        expect(cellOf(u, c), `${wall} ${c}`).toEqual(truckCellOf({ x: u.x, z: u.z, wall }, c));
        expect(frontOf(u, c), `${wall} ${c}`).toEqual(truckFrontOf({ x: u.x, z: u.z, wall }, c));
      }
    }
  });

  it('the inward heading points from where the forklift stands into the column, for every unit', () => {
    expect(inwardHeading).toBe(rackInwardHeading);
    for (const u of MANY.storage!) {
      u.columns.forEach((_, c) => {
        const cell = cellOf(u, c);
        const front = frontOf(u, c);
        const f = forwardOf(inwardHeading(facingOf(u)));
        expect([Math.round(f.x) + 0, Math.round(f.z) + 0], `${u.id}:${c}`).toEqual([cell.x - front.x, cell.z - front.z]);
      });
    }
  });

  it('columns: unit by unit (racks, then trucks), column by column, each with its cell, front, facing, cues and first slot', () => {
    const columns = storageColumnsOf(MANY);
    expect(columns.map((c) => [c.unit.id, c.unitIndex, c.column, c.cues.length, c.firstSlot])).toEqual([
      ['r1', 0, 0, 2, 0],
      ['r1', 0, 1, 1, 2],
      ['r2', 1, 0, 1, 3],
      ['r2', 1, 1, 3, 4],
      ['r3', 2, 0, 1, 7],
      ['r4', 3, 0, 1, 8],
      ['t1', 4, 0, 2, 9],
      ['t1', 4, 1, 1, 11],
      ['t2', 5, 0, 1, 12],
    ]);
    expect(columns[3]).toMatchObject({ cell: { x: 6, z: 3 }, front: { x: 7, z: 3 }, facing: 'east', cues: RE.columns[1] });
    expect(columns[8]).toMatchObject({ cell: { x: -1, z: 3 }, front: { x: 0, z: 3 }, facing: 'east' });
    expect(storageColumnsOf({})).toEqual([]);
  });

  it('slots: unit by unit, column by column, bottom → top, ids «unit:column:level», «libre» = a null cue', () => {
    const slots = storageSlotsOf(MANY);
    expect(slots.map((s) => s.id)).toEqual(['r1:0:0', 'r1:0:1', 'r1:1:0', 'r2:0:0', 'r2:1:0', 'r2:1:1', 'r2:1:2', 'r3:0:0', 'r4:0:0', 't1:0:0', 't1:0:1', 't1:1:0', 't2:0:0']);
    expect(slots.map((s) => s.cue)).toEqual([{ color: 'blue' }, null, null, { symbol: 'triangle' }, null, null, { color: 'mint', symbol: 'circle' }, null, { color: 'coral' }, { color: 'yellow' }, { symbol: 'square' }, { color: 'lavender', symbol: 'cross' }, { color: 'blue', symbol: 'diamond' }]);
    expect(slots[10]).toMatchObject({ unitIndex: 4, column: 0, level: 1, cell: { x: 5, z: -1 }, front: { x: 5, z: 0 }, facing: 'south' });
    // One slot per level; each column's first slot is where storageColumnsOf says.
    for (const col of storageColumnsOf(MANY)) col.cues.forEach((cue, lvl) => expect(slots[col.firstSlot + lvl]).toMatchObject({ unit: col.unit, column: col.column, level: lvl, cue }));
    expect(slotIdOf('t9', 2, 1)).toBe('t9:2:1');
    expect(slotIdOf).toBe(rackSlotIdOf);
    expect(storageSlotsOf({ storage: [] })).toEqual([]);
  });
});

describe('racksOf / trucksOf and their helpers: views of level.storage (until phase 7)', () => {
  it('racksOf: the rack units in storage order as LevelRack («libre» = {}); trucksOf: the trucks as LevelTruck', () => {
    expect(racksOf(MANY)).toEqual([
      { id: 'r1', x: 2, z: 5, w: 2, facing: 'north', columns: [[{ color: 'blue' }, {}], [{}]] },
      { id: 'r2', x: 6, z: 2, w: 2, facing: 'east', columns: [[{ symbol: 'triangle' }], [{}, {}, { color: 'mint', symbol: 'circle' }]] },
      { id: 'r3', x: 3, z: 0, w: 1, facing: 'south', columns: [[{}]] },
      { id: 'r4', x: 1, z: 6, w: 1, facing: 'west', columns: [[{ color: 'coral' }]] },
    ]);
    expect(trucksOf(MANY)).toEqual([
      { id: 't1', wall: 'north', x: 5, z: 0, w: 2, columns: [[{ color: 'yellow' }, { symbol: 'square' }], [{ color: 'lavender', symbol: 'cross' }]] },
      { id: 't2', wall: 'west', x: 0, z: 3, w: 1, columns: [[{ color: 'blue', symbol: 'diamond' }]] },
    ]);
    // Derived copies: a view never hands out the level's own cue objects.
    expect(racksOf(MANY)[0].columns[0][0]).not.toBe(RN.columns[0][0]);
    expect([hasRacks(MANY), hasTrucks(MANY), hasRacks({ storage: [TW] }), hasTrucks({ storage: [RS] }), hasRacks({}), hasTrucks({})]).toEqual([true, true, false, false, false, false]);
  });

  it('slotsOf / truckSlotsOf / truckColumnsOf: the rack and truck parts of the storage slots and columns, same ids, cells and fronts', () => {
    const slots = storageSlotsOf(MANY);
    const part = (skin: LevelStorage['skin']) => slots.filter((s) => s.unit.skin === skin).map((s) => ({ id: s.id, column: s.column, level: s.level, cell: s.cell, front: s.front }));
    expect(slotsOf(MANY).map((s) => ({ id: s.id, column: s.column, level: s.level, cell: s.cell, front: s.front }))).toEqual(part('rack'));
    expect(truckSlotsOf(MANY).map((s) => ({ id: s.id, column: s.column, level: s.level, cell: s.cell, front: s.front }))).toEqual(part('truck'));
    expect(truckSlotsOf(MANY).map((s) => s.cue)).toEqual(slots.filter((s) => s.unit.skin === 'truck').map((s) => s.cue));
    expect(truckColumnsOf(MANY).map((c) => [c.truck.id, c.column, c.facing, c.firstSlot])).toEqual([
      ['t1', 0, 'south', 0],
      ['t1', 1, 'south', 2],
      ['t2', 0, 'east', 3],
    ]);
  });

  it('dockRailsOf: the rails of every door unit (truckIndex = its trucksOf index), at both ends of each door run', () => {
    const T = DOCK_RAIL.thickness;
    expect(dockRailsOf(MANY)).toEqual([
      { truckIndex: 0, wall: 'north', end: 0, side: { x: 4, z: 0 }, line: 5 + DOOR_JAMB, outer: 5 + DOOR_JAMB - T, from: 0, to: 1 },
      { truckIndex: 0, wall: 'north', end: 1, side: { x: 7, z: 0 }, line: 7 - DOOR_JAMB, outer: 7 - DOOR_JAMB + T, from: 0, to: 1 },
      { truckIndex: 1, wall: 'west', end: 0, side: { x: 0, z: 2 }, line: 3 + DOOR_JAMB, outer: 3 + DOOR_JAMB - T, from: 0, to: 1 },
      { truckIndex: 1, wall: 'west', end: 1, side: { x: 0, z: 4 }, line: 4 - DOOR_JAMB, outer: 4 - DOOR_JAMB + T, from: 0, to: 1 },
    ]);
    // Racks have no door: no rails.
    expect(dockRailsOf({ storage: [RN, RE, RS, RW], size: MANY.size })).toEqual([]);
  });
});

describe('targets and destinies from the storage slots (core/sorting)', () => {
  /** Two racks (one only «libre»), two trucks and a zone; five boxes, one complete assignment. */
  const level: Pick<LevelData, 'boxes' | 'zones' | 'storage'> = {
    boxes: [
      { id: 'b1', color: 'blue', symbol: 'square', x: 1, z: 1 },
      { id: 'b2', color: 'yellow', symbol: 'triangle', x: 2, z: 1 },
      { id: 'b3', color: 'coral', symbol: 'diamond', x: 3, z: 1 },
      { id: 'b4', color: 'mint', symbol: 'circle', x: 4, z: 1 },
    ],
    zones: [{ id: 'z1', color: 'blue', x: 1, z: 3 }],
    storage: [
      unit('r1', 'rack', 3, 5, { kind: 'front', facing: 'north' }, [[{ symbol: 'triangle' }, null]]),
      unit('r2', 'rack', 6, 2, { kind: 'front', facing: 'west' }, [[null]]),
      unit('t1', 'truck', 2, 0, { kind: 'door', wall: 'north' }, [[{ color: 'coral' }]]),
      unit('t2', 'truck', 0, 4, { kind: 'door', wall: 'west' }, [[{ color: 'mint', symbol: 'circle' }]]),
    ],
  };

  it('targets: the zones, then every storage slot with a cue in storage order («libre» never), indexed within its skin', () => {
    expect(targetsOf(level).map((t) => [t.kind, t.id, t.index, t.criteria])).toEqual([
      ['zone', 'z1', 0, { color: 'blue' }],
      ['slot', 'r1:0:0', 0, { symbol: 'triangle' }],
      ['truck', 't1:0:0', 0, { color: 'coral' }],
      ['truck', 't2:0:0', 1, { color: 'mint', symbol: 'circle' }],
    ]);
    expect([...zoneMatchKinds(level)]).toEqual([
      ['z1', 'color'],
      ['r1:0:0', 'symbol'],
      ['t1:0:0', 'color'],
      ['t2:0:0', 'exact'],
    ]);
  });

  it('destinies: per zone, per rack slot (null for «libre») and per truck level, from the unique assignment', () => {
    expect(levelDestinies(level)).toEqual({
      zones: [{ color: 'blue', symbol: 'square' }],
      slots: [{ color: 'yellow', symbol: 'triangle' }, null, null],
      trucks: [
        { color: 'coral', symbol: 'diamond' },
        { color: 'mint', symbol: 'circle' },
      ],
    });
    expect(levelDestinies({ ...level, storage: undefined })).toBeNull();
    expect(levelDestinies({ ...level, storage: [] })).toBeNull();
  });

  it('a symbol in any unit\'s cue makes the level sort by symbol', () => {
    const plain = { boxes: [{ id: 'b', color: 'blue' as const, x: 0, z: 0 }], zones: [{ id: 'z', color: 'blue' as const, x: 1, z: 0 }] };
    expect(usesSymbols({ ...plain, storage: [unit('r1', 'rack', 3, 5, { kind: 'front', facing: 'north' }, [[{ color: 'blue' }, null]])] })).toBe(false);
    expect(usesSymbols({ ...plain, storage: [unit('r1', 'rack', 3, 5, { kind: 'front', facing: 'north' }, [[null, { symbol: 'cross' }]])] })).toBe(true);
    expect(usesSymbols({ ...plain, storage: [unit('t1', 'truck', 2, 0, { kind: 'door', wall: 'north' }, [[{ color: 'blue', symbol: 'circle' }]])] })).toBe(true);
  });
});
