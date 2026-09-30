import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import { LevelFormatError, parseLevel } from './asciiLevel';
import { validateLevel } from './validateLevel';

/*
 * validateLevel with loading docks (docs/DOCKS.md «Validación»): a truck on a north / west wall run inside the map, its
 * bed cells free of other furniture, loadable from the front, heights within the stack limit, the unique assignment
 * including the truck levels, never starting solved. Raw objects (as a JSON level would give), and the Spanish
 * placement of a few through parseLevel.
 */

type Raw = Record<string, unknown>;

/** A 7×4 warehouse: a two-column truck in the north wall (x = 2, 3), three boxes for its three levels. */
function base(): Raw {
  return {
    id: 'muelle',
    order: 1,
    name: 'Muelle',
    size: { width: 7, depth: 4 },
    forklift: { x: 3, z: 3, heading: 180 },
    boxes: [
      { id: 'b1', color: 'blue', symbol: 'triangle', x: 1, z: 2 },
      { id: 'b2', color: 'coral', symbol: 'diamond', x: 5, z: 2 },
      { id: 'b3', color: 'mint', symbol: 'triangle', x: 5, z: 3 },
    ],
    zones: [],
    shelves: [],
    trucks: [{ wall: 'north', x: 2, z: 0, columns: [[{ color: 'blue' }, { symbol: 'triangle' }], [{ color: 'coral', symbol: 'diamond' }]] }],
    decor: { plants: [], windows: [] },
    stackLimit: 2,
  };
}

const truck = (raw: Raw) => (raw.trucks as Raw[])[0];
const fails = (raw: Raw) => {
  try {
    validateLevel(raw, 'x');
  } catch (e) {
    return (e as Error).message.replace(/^\[x\] /, '');
  }
  return null;
};

describe('validateLevel: trucks', () => {
  it('fills defaults (id t1, w = columns) and keeps `trucks` right after `racks`; zones are optional with a truck', () => {
    const level = validateLevel(base(), 'x');
    expect(level.trucks).toEqual([
      { id: 't1', wall: 'north', x: 2, z: 0, w: 2, columns: [[{ color: 'blue' }, { symbol: 'triangle' }], [{ color: 'coral', symbol: 'diamond' }]] },
    ]);
    expect(Object.keys(level).indexOf('trucks')).toBe(Object.keys(level).indexOf('shelves') + 1);
    expect(level.zones).toEqual([]);
    // A column of 2 levels loads like a floor stack: without `limit`, the level stacks up to the global maximum.
    const raw = base();
    delete raw.stackLimit;
    expect(validateLevel(raw, 'x').stackLimit).toBe(GAME_CONFIG.stack.maxHeight);
    // One level per column and no `limit`: a classic stack limit of 1.
    const flat = base();
    delete flat.stackLimit;
    truck(flat).columns = [[{ color: 'blue' }], [{ color: 'coral', symbol: 'diamond' }]];
    (flat.boxes as Raw[]).pop();
    expect(validateLevel(flat, 'x').stackLimit).toBe(1);
  });

  it('a truck is on the north or west wall, against it, inside the map, each level with a cue', () => {
    const wall = base();
    truck(wall).wall = 'south';
    expect(fails(wall)).toBe('trucks[0].wall must be "north" or "west"');
    const off = base();
    truck(off).z = 1;
    expect(fails(off)).toBe('trucks[0] is in the north wall: its bed runs along row z = 0');
    const west = base();
    Object.assign(truck(west), { wall: 'west', x: 1, z: 1 });
    expect(fails(west)).toBe('trucks[0] is in the west wall: its bed runs along column x = 0');
    const out = base();
    truck(out).x = 6;
    expect(fails(out)).toBe('trucks[0] leaves the warehouse at 7,0');
    const empty = base();
    truck(empty).columns = [[{ color: 'blue' }, {}], [{ color: 'coral', symbol: 'diamond' }]];
    expect(fails(empty)).toBe('trucks[0].columns[0][1] must ask for something: a truck level has a color, a symbol or both');
    const tall = base();
    truck(tall).columns = [[{ color: 'blue' }, { color: 'blue' }, { color: 'blue' }, { color: 'blue' }]];
    expect(fails(tall)).toBe('trucks[0].columns[0] must have 1 to 3 levels');
    const width = base();
    truck(width).w = 3;
    expect(fails(width)).toBe('trucks[0].w must equal its number of columns (2)');
  });

  it('its bed cells hold no other furniture, zone or forklift; it is loaded from a floor cell; no window on its door', () => {
    const plant = base();
    plant.decor = { plants: [{ x: 3, z: 0 }], windows: [] };
    expect(fails(plant)).toBe('trucks[0] overlaps another obstacle at 3,0');
    const front = base();
    front.decor = { plants: [{ x: 3, z: 1 }], windows: [] };
    expect(fails(front)).toBe('trucks[0] column 1 has no room in front: cell 3,1 is a shelf, a plant, a rack or another truck');
    const zone = base();
    zone.zones = [{ id: 'z1', color: 'blue', x: 2, z: 0 }];
    expect(fails(zone)).toBe('zone "z1" is inside an obstacle');
    const forklift = base();
    forklift.forklift = { x: 2, z: 0 };
    expect(fails(forklift)).toBe('forklift starts inside an obstacle');
    const window = base();
    window.decor = { plants: [], windows: [{ wall: 'north', at: 3, width: 2 }] };
    expect(fails(window)).toBe('decor.windows[0] overlaps the dock door of trucks[0]');
    // The same span on the other wall, or next to the door, is fine.
    const beside = base();
    beside.decor = { plants: [], windows: [{ wall: 'north', at: 4, width: 2 }, { wall: 'west', at: 2, width: 1 }] };
    expect(fails(beside)).toBeNull();
  });

  it('ids: unique among trucks and never a rack id', () => {
    const twin = base();
    twin.trucks = [truck(twin), { id: 't1', wall: 'west', x: 0, z: 1, columns: [[{ color: 'mint' }]] }];
    (twin.boxes as Raw[]).push({ id: 'b4', color: 'mint', x: 6, z: 3 });
    expect(fails(twin)).toBe('duplicate truck id "t1"');
    const rack = base();
    rack.racks = [{ id: 't1', x: 6, z: 1, facing: 'west', columns: [[{}]] }];
    expect(fails(rack)).toBe('trucks[0] has the id "t1" of a rack: racks and trucks never share an id');
  });

  it('boxes loaded at the start: on a level of their column, one per level, each on the one below', () => {
    const noLevel = base();
    (noLevel.boxes as Raw[])[2] = { id: 'b3', color: 'mint', symbol: 'triangle', x: 3, z: 0 };
    expect(fails(noLevel)).toBe('box "b3" is on a truck bed cell: give it its truck level');
    const high = base();
    (high.boxes as Raw[])[2] = { id: 'b3', color: 'mint', symbol: 'triangle', x: 3, z: 0, level: 1 };
    expect(fails(high)).toBe('box "b3" is on level 1 of trucks[0] column 1, which has 1 levels');
    const floating = base();
    (floating.boxes as Raw[])[2] = { id: 'b3', color: 'mint', symbol: 'triangle', x: 2, z: 0, level: 1 };
    expect(fails(floating)).toBe('box "b3" is on trucks[0] column 0 at level 1 with no box below it');
    const shared = base();
    (shared.boxes as Raw[])[1] = { id: 'b2', color: 'coral', symbol: 'diamond', x: 3, z: 0, level: 0 };
    (shared.boxes as Raw[])[2] = { id: 'b3', color: 'mint', symbol: 'triangle', x: 3, z: 0, level: 0 };
    expect(fails(shared)).toBe('two boxes share level 0 of trucks[0] column 1');
    const loaded = base();
    (loaded.boxes as Raw[])[2] = { id: 'b3', color: 'mint', symbol: 'triangle', x: 2, z: 0, level: 0 };
    expect(validateLevel(loaded, 'x').boxes[2]).toEqual({ id: 'b3', color: 'mint', symbol: 'triangle', x: 2, z: 0, level: 0, kind: 'standard' });
  });

  it('heights: every column within the stack limit', () => {
    const low = base();
    low.stackLimit = 1;
    expect(fails(low)).toBe('trucks[0].columns[0] has 2 levels, more than stackLimit 1');
  });

  it('the unique assignment counts every truck level; the level never starts solved', () => {
    const few = base();
    (few.boxes as Raw[]).pop();
    expect(fails(few)).toBe('a level with storage racks or trucks needs one box per target (2 boxes, 0 zones, 0 slots with a cue, 3 truck levels)');
    const two = base();
    (two.boxes as Raw[])[0] = { id: 'b1', color: 'blue', symbol: 'circle', x: 1, z: 2 };
    (two.boxes as Raw[])[2] = { id: 'b3', color: 'blue', symbol: 'triangle', x: 5, z: 3 };
    truck(two).columns = [[{ color: 'blue' }, { color: 'blue' }], [{ color: 'coral', symbol: 'diamond' }]];
    expect(fails(two)).toBe('more than one complete assignment: trucks[0].columns[0][0] may take blue/circle or blue/triangle');
    const none = base();
    (none.boxes as Raw[])[2] = { id: 'b3', color: 'lavender', x: 5, z: 3 };
    expect(fails(none)).toMatch(/^no complete assignment exists: box "b\d" is always left without a zone or slot$/);
    const solved = base();
    solved.boxes = [
      { id: 'b1', color: 'blue', symbol: 'triangle', x: 2, z: 0, level: 0 },
      { id: 'b2', color: 'mint', symbol: 'triangle', x: 2, z: 0, level: 1 },
      { id: 'b3', color: 'coral', symbol: 'diamond', x: 3, z: 0, level: 0 },
    ];
    expect(fails(solved)).toBe('level starts already solved');
    // Every box loaded, but one of them wrong: not solved.
    const almost = base();
    almost.boxes = [
      { id: 'b1', color: 'mint', symbol: 'triangle', x: 2, z: 0, level: 0 },
      { id: 'b2', color: 'blue', symbol: 'triangle', x: 2, z: 0, level: 1 },
      { id: 'b3', color: 'coral', symbol: 'diamond', x: 3, z: 0, level: 0 },
    ];
    expect(fails(almost)).toBeNull();
  });

  it('levels without trucks: the rack-only message and results are unchanged', () => {
    const racks = base();
    delete racks.trucks;
    racks.racks = [{ x: 6, z: 1, facing: 'west', columns: [[{ color: 'blue' }]] }];
    expect(fails(racks)).toBe('a level with storage racks needs one box per target (3 boxes, 0 zones, 1 slots with a cue)');
    const plain = base();
    delete plain.trucks;
    expect(fails(plain)).toBe('a level needs at least one zone');
  });
});

describe('parseLevel: truck validation errors in Spanish, where to fix them', () => {
  const text = (lines: string[]) => `${lines.join('\n')}\n`;
  const errorOf = (lines: string[]) => {
    try {
      parseLevel(text(lines), 'x.level');
    } catch (e) {
      if (e instanceof LevelFormatError) return { line: e.line, column: e.column, reason: e.reason };
      throw e;
    }
    throw new Error('expected a LevelFormatError');
  };
  const LINES = [
    '# 1 · Un camión', //                                    1
    'id: un-camion', //                                      2
    'limit: 2', //                                           3
    'ventanas: norte 5-6', //                                4
    '', //                                                   5
    '  0123456', //                                          6
    '0 ..TT...', //                                          7
    '1 .......', //                                          8
    '2 .a...b.', //                                          9
    '3 ...^.c.', //                                          10
    '', //                                                   11
    'a = caja azul ▲     b = caja coral ◆    c = caja menta ▲', // 12
    'T = camión muelle norte: azul / ▲ | coral ◆', //         13
  ];
  const replace = (line: number, content: string) => LINES.map((l, i) => (i === line - 1 ? content : l));

  it('a plant in front of a column, a window on the door, a column taller than limit', () => {
    expect(errorOf(replace(8, '1 ...p...'))).toMatchObject({ line: 7, column: 6, reason: expect.stringMatching(/^el camión «T» se carga desde el almacén y delante de esta casilla \(la 3,1\)/) });
    expect(errorOf(replace(4, 'ventanas: norte 3-4'))).toMatchObject({ line: 4, reason: expect.stringMatching(/una ventana choca con la puerta del muelle del camión «T»/) });
    expect(errorOf(replace(3, 'limit: 1'))).toMatchObject({ line: 7, column: 5, reason: expect.stringMatching(/esta columna del camión «T» tiene 2 niveles y limit es 1/) });
    expect(errorOf(replace(12, 'a = caja azul ▲     b = caja coral ◆    c = caja lavanda ●'))).toMatchObject({
      reason: expect.stringMatching(/no hay reparto completo: .* sin zona, hueco ni nivel de camión que la acepte/),
    });
  });
});
