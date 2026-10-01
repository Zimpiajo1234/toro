import { describe, expect, it } from 'vitest';
import { columnFrame, frontCellOf, hasRacks, inwardHeading, rackCellOf, runsAlongX, slotIdOf, slotsOf } from './racks';
import {
  assignmentsOf,
  cueFits,
  cueOf,
  isDestined,
  levelDestinies,
  sameKind,
  satisfiesTarget,
  targetsOf,
  usesSymbols,
  zoneMatchKinds,
  type Sortable,
} from './sorting';
import { forwardOf, type LevelData, type LevelRack } from './types';

const box = (color: Sortable['color'], symbol: Sortable['symbol']): Sortable => ({ color, symbol });

describe('rack geometry (core/racks)', () => {
  const south: LevelRack = { id: 'r1', x: 2, z: 0, w: 3, facing: 'south', columns: [[{}], [{}], [{}]] };
  const west: LevelRack = { id: 'r2', x: 6, z: 1, w: 2, facing: 'west', columns: [[{}], [{}]] };

  it('a rack facing north / south runs along x, one facing east / west along z; fronts are on the facing side', () => {
    expect(runsAlongX('south')).toBe(true);
    expect(runsAlongX('west')).toBe(false);
    expect([0, 1, 2].map((c) => rackCellOf(south, c))).toEqual([
      { x: 2, z: 0 },
      { x: 3, z: 0 },
      { x: 4, z: 0 },
    ]);
    expect(frontCellOf(south, 1)).toEqual({ x: 3, z: 1 });
    expect(rackCellOf(west, 1)).toEqual({ x: 6, z: 2 });
    expect(frontCellOf(west, 1)).toEqual({ x: 5, z: 2 });
    expect(frontCellOf({ x: 0, z: 3, facing: 'east' }, 0)).toEqual({ x: 1, z: 3 });
    expect(frontCellOf({ x: 4, z: 5, facing: 'north' }, 0)).toEqual({ x: 4, z: 4 });
  });

  it('the inward heading points from the front cell into the rack', () => {
    for (const facing of ['north', 'east', 'south', 'west'] as const) {
      const cell = rackCellOf({ x: 5, z: 5, facing }, 0);
      const front = frontCellOf({ x: 5, z: 5, facing }, 0);
      const f = forwardOf(inwardHeading(facing));
      expect(Math.round(f.x) + 0).toBe(cell.x - front.x);
      expect(Math.round(f.z) + 0).toBe(cell.z - front.z);
    }
  });

  it('columnFrame measures depth past the front face and offset from the column centre line', () => {
    const out = { depth: 0, lateral: 0 };
    // Rack cell centred on the origin, front to the south (+z): the face is at z = 0.5.
    expect(columnFrame({ x: 0, z: 0 }, 'south', 0, 0.5, out)).toEqual({ depth: 0, lateral: 0 });
    expect(columnFrame({ x: 0, z: 0 }, 'south', 0.2, 0, out).depth).toBeCloseTo(0.5);
    expect(Math.abs(columnFrame({ x: 0, z: 0 }, 'south', 0.2, 1, out).lateral)).toBeCloseTo(0.2);
    expect(columnFrame({ x: 0, z: 0 }, 'south', 0, 1, out).depth).toBeCloseTo(-0.5);
    expect(columnFrame({ x: 0, z: 0 }, 'west', -1, 0.1, out).depth).toBeCloseTo(-0.5);
    expect(columnFrame({ x: 0, z: 0 }, 'east', 0.3, 0, out).depth).toBeCloseTo(0.2);
  });

  it('flattens slots rack by rack, column by column, bottom → top, with stable ids', () => {
    const level = { racks: [south, { ...west, columns: [[{}, { color: 'blue' as const }], [{}]] }] };
    expect(slotsOf(level).map((s) => s.id)).toEqual(['r1:0:0', 'r1:1:0', 'r1:2:0', 'r2:0:0', 'r2:0:1', 'r2:1:0']);
    expect(slotIdOf('r7', 2, 1)).toBe('r7:2:1');
    expect(hasRacks(level)).toBe(true);
    expect(hasRacks({})).toBe(false);
    expect(slotsOf({})).toEqual([]);
  });
});

describe('cues and destinies (core/sorting)', () => {
  it('a slot with no cue is «libre»: no criteria, never fits, never a target', () => {
    expect(cueOf({})).toBeNull();
    expect(cueOf({ color: 'blue' })).toEqual({ color: 'blue' });
    expect(cueFits({ accepts: null }, box('blue', 'circle'))).toBe(false);
    expect(cueFits({ accepts: { symbol: 'triangle' } }, box('mint', 'triangle'))).toBe(true);
  });

  it('a destined target is satisfied only by its kind; without a destiny, by its criteria (as before)', () => {
    const target = { accepts: { symbol: 'triangle' as const }, destined: box('blue', 'triangle') };
    expect(satisfiesTarget(target, box('blue', 'triangle'))).toBe(true);
    expect(satisfiesTarget(target, box('mint', 'triangle'))).toBe(false); // fits the cue, not the destiny
    expect(isDestined(target, box('mint', 'triangle'))).toBe(false);
    expect(cueFits(target, box('mint', 'triangle'))).toBe(true);
    expect(satisfiesTarget({ accepts: { symbol: 'triangle' }, destined: null }, box('mint', 'triangle'))).toBe(true);
    expect(sameKind(box('blue', 'circle'), box('blue', 'circle'))).toBe(true);
    expect(sameKind(box('blue', 'circle'), box('blue', 'square'))).toBe(false);
  });

  it('counts complete assignments up to identical boxes, and stops at the limit', () => {
    // Two identical blue ● boxes on two «blue» targets: one assignment, not two.
    expect(assignmentsOf([box('blue', 'circle'), box('blue', 'circle')], [{ color: 'blue' }, { color: 'blue' }]).count).toBe(1);
    // Blue ● and blue ▲ on two «blue» targets: two (which one goes where).
    const two = assignmentsOf([box('blue', 'circle'), box('blue', 'triangle')], [{ color: 'blue' }, { color: 'blue' }]);
    expect(two.count).toBe(2);
    expect(two.found).toHaveLength(2);
    expect(two.found[0][0]).not.toEqual(two.found[1][0]);
    // A second cue decides it.
    const one = assignmentsOf([box('blue', 'circle'), box('blue', 'triangle')], [{ color: 'blue' }, { symbol: 'triangle' }]);
    expect(one).toEqual({ count: 1, found: [[box('blue', 'circle'), box('blue', 'triangle')]] });
    // No assignment: a box nobody takes, or counts that differ.
    expect(assignmentsOf([box('mint', 'circle')], [{ color: 'blue' }]).count).toBe(0);
    expect(assignmentsOf([box('blue', 'circle')], [{ color: 'blue' }, { color: 'blue' }]).count).toBe(0);
    // Many: 4 distinct blue boxes on 4 «blue» targets = 24, capped.
    const kinds = (['circle', 'triangle', 'square', 'diamond'] as const).map((s) => box('blue', s));
    const all = [{ color: 'blue' as const }, { color: 'blue' as const }, { color: 'blue' as const }, { color: 'blue' as const }];
    expect(assignmentsOf(kinds, all, 1000).count).toBe(24);
    expect(assignmentsOf(kinds, all, 5).count).toBe(5);
    expect(assignmentsOf([], []).count).toBe(1);
  });

  const rackLevel: Pick<LevelData, 'boxes' | 'zones' | 'racks'> = {
    boxes: [
      { id: 'b1', color: 'blue', symbol: 'triangle', x: 1, z: 1 },
      { id: 'b2', color: 'blue', symbol: 'circle', x: 2, z: 1 },
      { id: 'b3', color: 'mint', symbol: 'triangle', x: 3, z: 1 },
    ],
    zones: [{ id: 'z1', color: 'blue', x: 1, z: 3 }],
    racks: [{ id: 'r1', x: 3, z: 0, w: 1, facing: 'south', columns: [[{ symbol: 'triangle' }, { color: 'mint' }, {}]] }],
  };

  it('targets are the zones, then the slots with a cue; destinies come from the unique assignment', () => {
    expect(targetsOf(rackLevel).map((t) => [t.kind, t.id])).toEqual([
      ['zone', 'z1'],
      ['slot', 'r1:0:0'],
      ['slot', 'r1:0:1'],
    ]);
    // «any blue» zone, «▲» slot, «mint» slot: mint ▲ must take the mint slot, so blue ▲ the ▲ slot, blue ● the zone.
    expect(levelDestinies(rackLevel)).toEqual({
      zones: [box('blue', 'circle')],
      slots: [box('blue', 'triangle'), box('mint', 'triangle'), null],
      trucks: [],
    });
    expect(levelDestinies({ ...rackLevel, racks: undefined })).toBeNull();
    // Ambiguous (two blue boxes, two «blue» targets): no destinies.
    const ambiguous = { ...rackLevel, racks: [{ ...rackLevel.racks![0], columns: [[{ color: 'blue' as const }, { color: 'mint' as const }, {}]] }] };
    expect(levelDestinies(ambiguous)).toBeNull();
  });

  it('rack cues count for symbols and match kinds', () => {
    expect(usesSymbols({ boxes: [{ id: 'b', color: 'blue', x: 0, z: 0 }], zones: [{ id: 'z', color: 'blue', x: 1, z: 0 }], racks: rackLevel.racks })).toBe(true);
    expect(usesSymbols({ boxes: [{ id: 'b', color: 'blue', x: 0, z: 0 }], zones: [{ id: 'z', color: 'blue', x: 1, z: 0 }] })).toBe(false);
    expect(zoneMatchKinds(rackLevel)).toEqual(
      new Map([
        ['z1', 'color'],
        ['r1:0:0', 'symbol'],
        ['r1:0:1', 'color'],
      ]),
    );
  });
});
