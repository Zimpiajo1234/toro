import { describe, expect, it } from 'vitest';
import { validateLevel } from './validateLevel';

/*
 * validateLevel with conveyor belts (docs/CONVEYOR.md «Datos y validación»): a belt (`conveyors[i]`) links its input (a
 * storage unit of skin beltIn, «libre», loaded from its front) and its end exit (skin beltOut, access `belt`) through
 * its cells, every one a floor piece for now, a table at level 1 (its height, H1b), in one straight run, both ends
 * facing away from it and standing on it (their units' base level: the belt's height there); its cells are obstacles of
 * their own, and a belt starts empty. Raw objects, as a JSON level would give them; the .level side (and its Spanish
 * messages) is in asciiLevel.conveyor.test.ts.
 */

type Raw = Record<string, unknown>;

/**
 * A 7×5 warehouse: a belt along the west wall from its input (0,2) north over one floor cell (0,1) to its end exit (0,0),
 * «azul»; a mint zone; blue ● for the end exit, mint ▲ for the zone.
 */
function base(): Raw {
  return {
    id: 'cinta',
    order: 1,
    name: 'Cinta',
    size: { width: 7, depth: 5 },
    forklift: { x: 3, z: 4, heading: 180 },
    boxes: [
      { id: 'b1', color: 'blue', symbol: 'circle', x: 3, z: 2 },
      { id: 'b2', color: 'mint', symbol: 'triangle', x: 5, z: 3 },
    ],
    zones: [{ id: 'z1', color: 'mint', x: 5, z: 1 }],
    shelves: [],
    storage: [
      { skin: 'beltIn', x: 0, z: 2, access: { kind: 'front', facing: 'south' }, columns: [[null]] },
      { skin: 'beltOut', x: 0, z: 0, access: { kind: 'belt', facing: 'south' }, columns: [[{ color: 'blue' }]] },
    ],
    conveyors: [{ input: 'e1', output: 's1', cells: [{ x: 0, z: 1 }] }],
    decor: { plants: [], windows: [] },
    stackLimit: 1,
  };
}

const units = (raw: Raw) => raw.storage as Raw[];
const belt = (raw: Raw, i = 0) => (raw.conveyors as Raw[])[i];
const cells = (raw: Raw) => belt(raw).cells as Raw[];
const fails = (raw: Raw) => {
  try {
    validateLevel(raw, 'x');
  } catch (e) {
    return (e as Error).message.replace(/^\[x\] /, '');
  }
  return null;
};
/** The base level changed by `edit`, then validated: its error, or null. */
const failsWith = (edit: (raw: Raw) => void) => {
  const raw = base();
  edit(raw);
  return fails(raw);
};

describe('validateLevel: conveyor belts', () => {
  it('fills the defaults (units e1 / s1 on the belt, belt c1, floor pieces at level 1) and keeps `conveyors` right after `storage`', () => {
    const level = validateLevel(base(), 'x');
    // Both ends stand on the belt's table: their base level is its height (a .level never writes it).
    expect(level.storage).toStrictEqual([
      { id: 'e1', skin: 'beltIn', x: 0, z: 2, w: 1, access: { kind: 'front', facing: 'south' }, columns: [[null]], baseLevel: 1 },
      { id: 's1', skin: 'beltOut', x: 0, z: 0, w: 1, access: { kind: 'belt', facing: 'south' }, columns: [[{ color: 'blue' }]], baseLevel: 1 },
    ]);
    expect(level.conveyors).toStrictEqual([{ id: 'c1', input: 'e1', output: 's1', cells: [{ x: 0, z: 1, piece: 'suelo', height: 1 }] }]);
    expect(Object.keys(level)).toEqual(['id', 'order', 'name', 'size', 'forklift', 'boxes', 'zones', 'shelves', 'storage', 'conveyors', 'decor', 'stackLimit', 'theme']);
    // It gives a level back as it is; one without belts has no `conveyors` at all.
    expect(validateLevel(structuredClone(level), 'x')).toStrictEqual(level);
    const plain = validateLevel({ ...base(), storage: undefined, conveyors: undefined, boxes: [{ id: 'b1', color: 'mint', symbol: 'triangle', x: 5, z: 3 }] }, 'x');
    expect(plain).not.toHaveProperty('conveyors');
    expect(plain).not.toHaveProperty('storage');
  });

  it('the pieces: only the floor one is built so far (ramp and ceiling: a clear message), a table at level 1', () => {
    for (const piece of ['rampa', 'techo'])
      expect(failsWith((raw) => (cells(raw)[0].piece = piece))).toBe(`conveyors[0].cells[0] is a ${piece} piece: only floor belts («suelo») are built so far`);
    expect(failsWith((raw) => (cells(raw)[0].piece = 'escalera'))).toBe('conveyors[0].cells[0].piece must be suelo, rampa, techo');
    for (const height of [0, 2])
      expect(failsWith((raw) => (cells(raw)[0].height = height))).toBe(
        `conveyors[0].cells[0] has height ${height}: a floor belt («suelo») is a table at level 1 (the floor of a rack's level-1 slot)`,
      );
    expect(failsWith((raw) => (cells(raw)[0].height = 1))).toBeNull();
    expect(failsWith((raw) => (belt(raw).cells = []))).toBe('conveyors[0] needs at least one belt cell between its input and its end exit');
  });

  it('a belt\'s input and end exit stand on it: their base level is its height there, never another; every other unit stands at the floor', () => {
    // Given as it is (validateLevel gives a level back), fine; any other value, refused.
    expect(failsWith((raw) => (units(raw)[0].baseLevel = 1))).toBeNull();
    expect(failsWith((raw) => (units(raw)[1].baseLevel = 0))).toBe("beltExits[0].baseLevel must be 1: a belt's input and end exit stand at their belt's height");
    expect(failsWith((raw) => (units(raw)[0].baseLevel = 2))).toBe("beltInputs[0].baseLevel must be 1: a belt's input and end exit stand at their belt's height");
    const rack = { skin: 'rack', x: 6, z: 2, access: { kind: 'front', facing: 'west' }, columns: [[null]] };
    const withRack = (baseLevel?: number) => failsWith((raw) => (raw.storage = [...units(raw), { ...rack, ...(baseLevel === undefined ? {} : { baseLevel }) }]));
    expect(withRack()).toBeNull();
    expect(withRack(0)).toBeNull();
    expect(withRack(1)).toBe('racks[0].baseLevel must be 0: only a conveyor belt\'s input and end exit stand above the floor');
    // A rack keeps no base level in the level (0, the floor: omitted), a belt's ends keep theirs.
    const level = validateLevel({ ...base(), storage: [...units(base()), { ...rack, baseLevel: 0 }] }, 'x');
    expect(level.storage!.map((u) => [u.id, u.baseLevel])).toEqual([
      ['r1', undefined],
      ['e1', 1],
      ['s1', 1],
    ]);
    expect(level.storage![0]).not.toHaveProperty('baseLevel');
  });

  it('one straight run: input, cells and end exit one cell apart, always the same way; both ends facing away from the belt', () => {
    expect(failsWith((raw) => (cells(raw)[0].x = 1))).toBe('conveyors[0] is not a straight run from its input to its end exit at 1,1');
    expect(
      failsWith((raw) => {
        units(raw)[1].x = 1;
        units(raw)[1].z = 1;
      }),
    ).toBe('conveyors[0] is not a straight run from its input to its end exit at 1,1');
    expect(failsWith((raw) => (units(raw)[0].access = { kind: 'front', facing: 'north' }))).toBe(
      'beltInputs[0] must face south: a belt input is loaded from the side away from its belt',
    );
    expect(failsWith((raw) => (units(raw)[1].access = { kind: 'belt', facing: 'north' }))).toBe(
      "beltExits[0] must face south: a belt's end exit takes its box from the belt's last cell",
    );
    // Each skin has its access.
    expect(failsWith((raw) => (units(raw)[0].access = { kind: 'belt', facing: 'south' }))).toBe('beltInputs[0].access.kind must be "front": the access of a belt input');
    expect(failsWith((raw) => (units(raw)[1].access = { kind: 'front', facing: 'south' }))).toBe('beltExits[0].access.kind must be "belt": the access of a belt exit');
  });

  it('the input is «libre» with room in front; both ends belong to exactly one belt, of the right skins', () => {
    expect(failsWith((raw) => (units(raw)[0].columns = [[{ color: 'blue' }]]))).toBe('beltInputs[0] asks for a cue: a belt input is «libre» (any box set down there rides its belt)');
    expect(failsWith((raw) => (raw.decor = { plants: [{ x: 0, z: 3 }], windows: [] }))).toBe(
      'beltInputs[0] column 0 has no room in front: cell 0,3 is a wall, a shelf, a plant or another rack',
    );
    expect(failsWith((raw) => (belt(raw).input = 'e9'))).toBe('conveyors[0].input "e9" is not a belt input (a storage unit of skin beltIn)');
    expect(failsWith((raw) => (belt(raw).output = 'e1'))).toBe('conveyors[0].output "e1" is not a belt exit (a storage unit of skin beltOut)');
    expect(failsWith((raw) => (raw.conveyors = []))).toBe("beltInputs[0] belongs to no conveyor: a belt's input and end exit come with their belt");
    expect(failsWith((raw) => (raw.conveyors = [belt(raw), { ...belt(raw) }]))).toBe('beltInputs[0] belongs to conveyors[0] and to conveyors[1]: every belt has its own input and end exit');
    expect(failsWith((raw) => (raw.conveyors = [{ ...belt(raw), id: 'k' }, { ...belt(raw), id: 'k' }]))).toBe('duplicate conveyor id "k"');
  });

  it('its cells are obstacles of their own, and a belt starts empty', () => {
    expect(failsWith((raw) => (raw.decor = { plants: [{ x: 0, z: 1 }], windows: [] }))).toBe('conveyors[0] overlaps another obstacle at 0,1');
    expect(failsWith((raw) => ((raw.boxes as Raw[])[0] = { id: 'b1', color: 'blue', symbol: 'circle', x: 0, z: 1 }))).toBe('box "b1" is inside an obstacle');
    expect(failsWith((raw) => ((raw.zones as Raw[])[0] = { id: 'z1', color: 'mint', x: 0, z: 1 }))).toBe('zone "z1" is inside an obstacle');
    expect(failsWith((raw) => (raw.forklift = { x: 0, z: 1, heading: 0 }))).toBe('forklift starts inside an obstacle');
    expect(failsWith((raw) => ((raw.boxes as Raw[])[0] = { id: 'b1', color: 'blue', symbol: 'circle', x: 0, z: 2, level: 0 }))).toBe(
      'box "b1" starts on beltInputs[0]: a conveyor belt starts empty (a box rides it once set down on its input)',
    );
    expect(failsWith((raw) => ((raw.boxes as Raw[])[0] = { id: 'b1', color: 'blue', symbol: 'circle', x: 0, z: 0, level: 0 }))).toBe(
      'box "b1" starts on beltExits[0]: a conveyor belt starts empty (a box rides it once set down on its input)',
    );
  });

  it('targets: an end exit with a cue is one (one box for it), a «libre» one none; the assignment names it', () => {
    expect(failsWith((raw) => (raw.boxes as Raw[]).push({ id: 'b3', color: 'coral', x: 6, z: 3 }))).toBe(
      'a level with storage needs one box per target (3 boxes, 1 zones, 0 slots with a cue, 0 truck levels, 1 belt exits with a cue)',
    );
    expect(failsWith((raw) => (units(raw)[1].columns = [[null]]))).toBe(
      'a level with storage needs one box per target (2 boxes, 1 zones, 0 slots with a cue, 0 truck levels, 0 belt exits with a cue)',
    );
    // Two belts, both end exits «azul», two blue boxes: which goes where is not decided.
    const two = base();
    two.zones = [];
    two.storage = [
      ...units(two),
      { skin: 'beltIn', x: 5, z: 2, access: { kind: 'front', facing: 'south' }, columns: [[null]] },
      { skin: 'beltOut', x: 5, z: 0, access: { kind: 'belt', facing: 'south' }, columns: [[{ color: 'blue' }]] },
    ];
    two.boxes = [
      { id: 'b1', color: 'blue', symbol: 'circle', x: 3, z: 2 },
      { id: 'b2', color: 'blue', symbol: 'square', x: 3, z: 3 },
    ];
    two.conveyors = [belt(two), { input: 'e2', output: 's2', cells: [{ x: 5, z: 1 }] }];
    expect(fails(two)).toBe('more than one complete assignment: beltExits[0].columns[0][0] may take blue/circle or blue/square');
  });
});
