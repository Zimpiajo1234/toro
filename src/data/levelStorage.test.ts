import { describe, expect, it } from 'vitest';
import { trucksOf } from '../core/docks';
import { racksOf } from '../core/racks';
import { storageOf } from '../core/storage';
import { formatLevel, parseLevel } from './asciiLevel';
import { BENCHMARK_ID, getSpecialLevel } from './levels';
import { validateLevel } from './validateLevel';
import threeTrucksText from './levels/pruebas/tres-camiones.level?raw';

/** The Benchmark and the three-truck fixture (docs/STORAGE.md «Nivel de prueba»): racks and trucks of every kind. */
const STORED = [getSpecialLevel(BENCHMARK_ID)!, parseLevel(threeTrucksText).level];

/*
 * `level.storage` in level data (docs/STORAGE.md, phase 2): validateLevel reads it in LevelData's own form or from a
 * legacy JSON level's `racks` / `trucks`, lists the units skin by skin (rule 12) and names them in its messages by
 * their skin (`racks[i]`, `trucks[i]`: the i-th unit of that skin, as asciiLevel places them); asciiLevel writes the
 * units skin by skin whatever the legend's order.
 */

type Raw = Record<string, unknown>;

/** A 7×4 warehouse: a one-level truck at a north door (door cell 2,0, a plant each side) and a rack facing south. */
function base(storage: Raw): Raw {
  return {
    id: 'almacen',
    order: 1,
    name: 'Almacén',
    size: { width: 7, depth: 4 },
    forklift: { x: 3, z: 3, heading: 180 },
    boxes: [
      { id: 'b1', color: 'blue', x: 1, z: 2 },
      { id: 'b2', color: 'mint', x: 5, z: 2 },
    ],
    zones: [],
    shelves: [],
    ...storage,
    decor: { plants: [{ x: 1, z: 0 }, { x: 3, z: 0 }], windows: [] },
    stackLimit: 1,
  };
}

const RACK = { skin: 'rack', x: 5, z: 0, access: { kind: 'front', facing: 'south' }, columns: [[{ color: 'blue' }]] };
const TRUCK = { skin: 'truck', x: 2, z: 0, access: { kind: 'door', wall: 'north' }, columns: [[{ color: 'mint' }]] };

const fails = (raw: Raw) => {
  try {
    validateLevel(raw, 'x');
  } catch (e) {
    return (e as Error).message.replace(/^\[x\] /, '');
  }
  return null;
};

describe('validateLevel: `storage` (docs/STORAGE.md)', () => {
  it('fills the defaults of every unit from its skin (id prefix + number within the skin, w) and keeps «libre» as null', () => {
    const level = validateLevel(base({ storage: [RACK, { ...TRUCK, id: 'muelle' }] }), 'x');
    expect(level.storage).toStrictEqual([
      { id: 'r1', skin: 'rack', x: 5, z: 0, w: 1, access: { kind: 'front', facing: 'south' }, columns: [[{ color: 'blue' }]] },
      { id: 'muelle', skin: 'truck', x: 2, z: 0, w: 1, access: { kind: 'door', wall: 'north' }, columns: [[{ color: 'mint' }]] },
    ]);
    expect(Object.keys(level)).toEqual(['id', 'order', 'name', 'size', 'forklift', 'boxes', 'zones', 'shelves', 'storage', 'decor', 'stackLimit', 'theme']);
    // A cue that asks for nothing is «libre», written null (or `{}`, the legacy form).
    const libre = validateLevel(base({ storage: [{ ...RACK, columns: [[{ color: 'blue' }, {}, null]] }, TRUCK] }), 'x');
    expect(storageOf(libre)[0].columns).toEqual([[{ color: 'blue' }, null, null]]);
  });

  it('lists the units skin by skin, each skin as given (rule 12), and names them by their skin in its messages', () => {
    const level = validateLevel(base({ storage: [TRUCK, RACK, { ...RACK, x: 4, columns: [[null]] }] }), 'x');
    expect(storageOf(level).map((u) => [u.id, u.skin, u.x])).toEqual([
      ['r1', 'rack', 5],
      ['r2', 'rack', 4],
      ['t1', 'truck', 2],
    ]);
    // The truck given first is still `trucks[0]`; the second rack given is `racks[1]`.
    expect(fails(base({ storage: [{ ...TRUCK, access: { kind: 'door', wall: 'south' } }, RACK] }))).toBe('trucks[0].access.wall must be "north" or "west"');
    expect(fails(base({ storage: [TRUCK, RACK, { ...RACK, x: 6, access: { kind: 'front', facing: 'up' } }] }))).toBe('racks[1].access.facing must be north, east, south or west');
    expect(fails(base({ storage: [RACK, { ...TRUCK, z: 1 }] }))).toBe('trucks[0] is in the north wall: its door cells run along row z = 0');
    expect(fails(base({ storage: [{ ...RACK, x: 3 }, TRUCK] }))).toBe('racks[0] overlaps another obstacle at 3,0');
  });

  it('gives a level back as it is (validateLevel(level) = level), whatever its storage', () => {
    for (const level of [...STORED, validateLevel(base({ storage: [RACK, TRUCK] }), 'x')])
      expect(validateLevel(structuredClone(level), level.id)).toStrictEqual(level);
  });

  it('a legacy JSON level (`racks`, `trucks`) gives the same level as its `storage`', () => {
    for (const level of STORED) {
      const legacy: Raw = { ...structuredClone(level), racks: racksOf(level), trucks: trucksOf(level) };
      delete legacy.storage;
      expect(validateLevel(legacy, level.id)).toStrictEqual(level);
    }
    const legacy = base({ racks: [{ x: 5, z: 0, facing: 'south', columns: [[{ color: 'blue' }]] }], trucks: [{ wall: 'north', x: 2, z: 0, columns: [[{ color: 'mint' }]] }] });
    expect(validateLevel(legacy, 'x')).toStrictEqual(validateLevel(base({ storage: [RACK, TRUCK] }), 'x'));
  });

  it('refuses a malformed `storage`: mixed with the legacy lists, an unknown skin, an access of another kind', () => {
    expect(fails({ ...base({ storage: [RACK] }), trucks: [] })).toBe('storage and the legacy racks / trucks lists do not mix: give every storage unit in storage');
    expect(fails(base({ storage: [RACK, 'truck'] }))).toBe('storage[1] must be an object');
    expect(fails(base({ storage: [RACK, { ...TRUCK, skin: 'crate' }] }))).toBe('storage[1].skin must be rack or truck');
    expect(fails(base({ storage: [RACK, { ...TRUCK, access: { kind: 'front', facing: 'south' } }] }))).toBe('trucks[0].access.kind must be "door": the access of a truck');
    expect(fails(base({ storage: [{ ...RACK, access: undefined }, TRUCK] }))).toBe('racks[0].access must be an object');
    // The rules of before, named the same way: ids unique across skins, no «libre» truck level yet (phase 6).
    expect(fails(base({ storage: [{ ...RACK, id: 'x1' }, { ...TRUCK, id: 'x1' }] }))).toBe('trucks[0] has the id "x1" of a rack: racks and trucks never share an id');
    expect(fails(base({ storage: [RACK, { ...TRUCK, columns: [[null]] }] }))).toBe('trucks[0].columns[0][0] must ask for something: a truck level has a color, a symbol or both');
    expect(fails(base({ storage: [{ ...RACK, columns: [[null, null, null, null]] }, TRUCK] }))).toBe('racks[0].columns[0] must have 1 to 3 slots');
  });
});

describe('asciiLevel: the units of `level.storage`, skin by skin', () => {
  /** A truck written before the rack in the legend (not canonical). */
  const LINES = [
    '# 7 · Orden',
    'id: orden',
    'limit: 1',
    '',
    '  0123456',
    '0 .pTp.R.',
    '1 .......',
    '2 .......',
    '3 ...^...',
    '',
    'T = camión muelle norte: menta + caja azul',
    'R = estantería frente sur: azul + caja menta',
  ];
  const text = (lines: readonly string[]) => `${lines.join('\n')}\n`;

  it('racks first, then trucks, and the stored boxes numbered in that order, whatever the legend order', () => {
    const { level } = parseLevel(text(LINES));
    expect(storageOf(level).map((u) => [u.id, u.skin])).toEqual([
      ['r1', 'rack'],
      ['t1', 'truck'],
    ]);
    expect(level.boxes).toStrictEqual([
      { id: 'b1', color: 'mint', x: 5, z: 0, level: 0, kind: 'standard' },
      { id: 'b2', color: 'blue', x: 2, z: -1, level: 0, kind: 'standard' },
    ]);
    // The canonical form writes the rack's entry first; parsing it gives the same level.
    const canonical = text([...LINES.slice(0, 10), LINES[11], LINES[10]]);
    expect(formatLevel(text(LINES))).toBe(canonical);
    expect(parseLevel(canonical).level).toStrictEqual(level);
  });
});
