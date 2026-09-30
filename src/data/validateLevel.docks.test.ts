import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import { trucksOf } from '../core/docks';
import { LevelFormatError, parseLevel } from './asciiLevel';
import { validateLevel } from './validateLevel';

/*
 * validateLevel with loading docks (docs/DOCKS.md «Validación»): a truck parked outside a north / west dock door, its
 * door cells a run along that wall inside the map (row 0 / column 0), 1 to 3 columns of 1 to 2 levels; the door cells
 * are floor free of furniture and other doors, and nothing starts on them; beside each end of the run (its side cell,
 * behind the door's guard rail) a static obstacle, unless the run reaches a corner of the room; boxes loaded at the
 * start rest on their bed cell, just outside the map; heights within the stack limit, the unique assignment including
 * the truck levels, never starting solved. Raw objects (as a JSON level would give), and the Spanish placement of a few
 * through parseLevel.
 */

type Raw = Record<string, unknown>;

/** The plants beside the base door, behind its guard rails: its side cells (1,0) and (4,0). */
const SIDES = [
  { x: 1, z: 0 },
  { x: 4, z: 0 },
];

/**
 * A 7×4 warehouse: a two-column truck at a north dock door (door cells x = 2, 3) with a plant beside each end, three
 * boxes for its three levels.
 */
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
    decor: { plants: SIDES, windows: [] },
    stackLimit: 2,
  };
}

const truck = (raw: Raw) => (raw.trucks as Raw[])[0];
const boxes = (raw: Raw) => raw.boxes as Raw[];
/** Replace the level's plants (its windows kept). */
const plants = (raw: Raw, cells: readonly { x: number; z: number }[]) => {
  raw.decor = { ...(raw.decor as Raw), plants: cells };
};
const fails = (raw: Raw) => {
  try {
    validateLevel(raw, 'x');
  } catch (e) {
    return (e as Error).message.replace(/^\[x\] /, '');
  }
  return null;
};

describe('validateLevel: trucks', () => {
  it('fills defaults (id t1, w = columns) and keeps `storage` right after `shelves`; zones are optional with a truck', () => {
    const level = validateLevel(base(), 'x');
    expect(trucksOf(level)).toEqual([
      { id: 't1', wall: 'north', x: 2, z: 0, w: 2, columns: [[{ color: 'blue' }, { symbol: 'triangle' }], [{ color: 'coral', symbol: 'diamond' }]] },
    ]);
    expect(Object.keys(level).indexOf('storage')).toBe(Object.keys(level).indexOf('shelves') + 1);
    expect(level.zones).toEqual([]);
    // A column of 2 levels loads like a floor stack: without `limit`, the level stacks up to the global maximum.
    const raw = base();
    delete raw.stackLimit;
    expect(validateLevel(raw, 'x').stackLimit).toBe(GAME_CONFIG.stack.maxHeight);
    // One level per column and no `limit`: a classic stack limit of 1.
    const flat = base();
    delete flat.stackLimit;
    truck(flat).columns = [[{ color: 'blue' }], [{ color: 'coral', symbol: 'diamond' }]];
    boxes(flat).pop();
    expect(validateLevel(flat, 'x').stackLimit).toBe(1);
  });

  it('a dock door is in the north or west wall, its door cells along it inside the map, 1 to 3 columns, each level with a cue', () => {
    const wall = base();
    truck(wall).wall = 'south';
    expect(fails(wall)).toBe('trucks[0].wall must be "north" or "west"');
    const off = base();
    truck(off).z = 1;
    expect(fails(off)).toBe('trucks[0] is in the north wall: its door cells run along row z = 0');
    const west = base();
    Object.assign(truck(west), { wall: 'west', x: 1, z: 1 });
    expect(fails(west)).toBe('trucks[0] is in the west wall: its door cells run along column x = 0');
    const out = base();
    truck(out).x = 6;
    expect(fails(out)).toBe('trucks[0] leaves the warehouse at 7,0');
    const empty = base();
    truck(empty).columns = [[{ color: 'blue' }, {}], [{ color: 'coral', symbol: 'diamond' }]];
    expect(fails(empty)).toBe('trucks[0].columns[0][1] must ask for something: a truck level has a color, a symbol or both');
    // At most 2 levels per column («solo hasta 2 alturas»).
    const tall = base();
    truck(tall).columns = [[{ color: 'blue' }, { color: 'blue' }, { color: 'blue' }], [{ color: 'coral', symbol: 'diamond' }]];
    expect(fails(tall)).toBe('trucks[0].columns[0] must have 1 to 2 levels');
    const width = base();
    truck(width).w = 3;
    expect(fails(width)).toBe('trucks[0].w must equal its number of columns (2)');
    // 1 to 3 columns: the door is 1 to 3 cells wide.
    const three = base();
    truck(three).columns = [[{ color: 'blue' }, { symbol: 'triangle' }], [{ color: 'coral', symbol: 'diamond' }], [{ color: 'lavender' }]];
    boxes(three).push({ id: 'b4', color: 'lavender', x: 6, z: 3 });
    plants(three, [SIDES[0], { x: 5, z: 0 }]);
    expect(fails(three)).toBeNull();
    const wide = base();
    truck(wide).columns = [...(truck(three).columns as unknown[]), [{ color: 'yellow' }]];
    boxes(wide).push({ id: 'b4', color: 'lavender', x: 6, z: 3 }, { id: 'b5', color: 'yellow', x: 0, z: 3 });
    expect(fails(wide)).toBe('trucks[0] has 4 columns, more than 3: its dock door is 1 to 3 cells wide');
    const single = base();
    Object.assign(truck(single), { columns: [[{ color: 'blue' }, { symbol: 'triangle' }]] });
    boxes(single).splice(1, 1);
    plants(single, [SIDES[0], { x: 3, z: 0 }]);
    expect(fails(single)).toBeNull();
  });

  it('its door cells are floor, free of furniture and other doors; corners and what stands behind are fine', () => {
    const plant = base();
    plants(plant, [...SIDES, { x: 3, z: 0 }]);
    expect(fails(plant)).toBe('trucks[0] overlaps another obstacle at 3,0');
    const shelf = base();
    shelf.shelves = [{ x: 0, z: 0, w: 3, d: 1 }];
    plants(shelf, [SIDES[1]]);
    expect(fails(shelf)).toBe('trucks[0] overlaps another obstacle at 2,0');
    const rack = base();
    rack.racks = [{ x: 3, z: 0, facing: 'south', columns: [[{ color: 'lavender' }]] }];
    boxes(rack).push({ id: 'b4', color: 'lavender', x: 6, z: 3 });
    expect(fails(rack)).toBe('trucks[0] overlaps another obstacle at 3,0');
    const twice = base();
    twice.trucks = [truck(twice), { wall: 'north', x: 3, z: 0, columns: [[{ color: 'lavender' }]] }];
    boxes(twice).push({ id: 'b4', color: 'lavender', x: 6, z: 3 });
    expect(fails(twice)).toBe('trucks[1] overlaps another obstacle at 3,0');
    // In a corner the run has no side cell at that end (the wall there guides the forklift): only the other end has.
    const corner = base();
    truck(corner).x = 0;
    plants(corner, [{ x: 2, z: 0 }]);
    expect(fails(corner)).toBeNull();
    const east = base();
    truck(east).x = 5;
    plants(east, [SIDES[1]]);
    expect(fails(east)).toBeNull();
    // Two doors on one wall with an obstacle between them; a north and a west door by the same corner.
    const pair = base();
    pair.trucks = [truck(pair), { wall: 'north', x: 5, z: 0, columns: [[{ color: 'lavender' }]] }];
    boxes(pair).push({ id: 'b4', color: 'lavender', x: 6, z: 3 });
    plants(pair, [...SIDES, { x: 6, z: 0 }]);
    expect(fails(pair)).toBeNull();
    const both = base();
    both.trucks = [
      { ...truck(both), x: 0 },
      { wall: 'west', x: 0, z: 2, columns: [[{ color: 'lavender' }]] },
    ];
    boxes(both).push({ id: 'b4', color: 'lavender', x: 6, z: 3 });
    plants(both, [
      { x: 2, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: 3 },
    ]);
    expect(fails(both)).toBeNull();
    // Whatever stands behind a door cell is the level's business (it may close the column: the solver says so).
    const behind = base();
    plants(behind, [...SIDES, { x: 3, z: 1 }]);
    expect(fails(behind)).toBeNull();
    // A rack loaded from a door cell (its front cell) from behind it is fine too: a door cell is floor.
    const front = base();
    front.racks = [{ x: 3, z: 1, facing: 'north', columns: [[{ color: 'lavender' }]] }];
    boxes(front).push({ id: 'b4', color: 'lavender', x: 6, z: 3 });
    expect(fails(front)).toBeNull();
  });

  it('beside each end of the door run, behind its guard rail: a static obstacle (a plant, a shelf, a rack that never faces the door)', () => {
    // Floor, a box, a zone or the forklift there is not enough.
    const bare = base();
    plants(bare, [SIDES[0]]);
    expect(fails(bare)).toBe('trucks[0] needs a static obstacle beside its dock door at 4,0 (a plant, a shelf or a rack): its guard rail stands there');
    const boxed = base();
    plants(boxed, [SIDES[1]]);
    boxes(boxed)[0] = { id: 'b1', color: 'blue', symbol: 'triangle', x: 1, z: 0 };
    expect(fails(boxed)).toBe('trucks[0] needs a static obstacle beside its dock door at 1,0 (a plant, a shelf or a rack): its guard rail stands there');
    // A shelf or a rack does as well as a plant; a rack there never faces the door (the rail stands across its front).
    const shelf = base();
    plants(shelf, [SIDES[1]]);
    shelf.shelves = [{ x: 0, z: 0, w: 2, d: 1 }];
    expect(fails(shelf)).toBeNull();
    const rack = base();
    plants(rack, [SIDES[0]]);
    rack.racks = [{ x: 4, z: 0, facing: 'south', columns: [[{ color: 'lavender' }]] }];
    boxes(rack).push({ id: 'b4', color: 'lavender', x: 6, z: 3 });
    expect(fails(rack)).toBeNull();
    const facing = base();
    plants(facing, [SIDES[0]]);
    facing.racks = [{ x: 4, z: 0, facing: 'west', columns: [[{ color: 'lavender' }]] }];
    boxes(facing).push({ id: 'b4', color: 'lavender', x: 6, z: 3 });
    expect(fails(facing)).toBe('racks[0] column 0 is loaded from the dock door of trucks[0], across its guard rail');
    // Two doors side by side: the cell beside one is the other's door.
    const pair = base();
    pair.trucks = [truck(pair), { wall: 'north', x: 4, z: 0, columns: [[{ color: 'lavender' }]] }];
    boxes(pair).push({ id: 'b4', color: 'lavender', x: 6, z: 3 });
    plants(pair, [SIDES[0], { x: 5, z: 0 }]);
    expect(fails(pair)).toBe(
      'trucks[0] needs a static obstacle beside its dock door at 4,0 for its guard rail, but that is the dock door of trucks[1]: leave a cell with an obstacle between two dock doors',
    );
    // A west door: its side cells are on column 0, north and south of its run.
    const west = base();
    Object.assign(truck(west), { wall: 'west', x: 0, z: 1 });
    plants(west, [{ x: 0, z: 0 }]);
    expect(fails(west)).toBe('trucks[0] needs a static obstacle beside its dock door at 0,3 (a plant, a shelf or a rack): its guard rail stands there');
    plants(west, [
      { x: 0, z: 0 },
      { x: 0, z: 3 },
    ]);
    expect(fails(west)).toBeNull();
  });

  it('no window on the door (the same span on the other wall, or next to it, is fine)', () => {
    const window = base();
    window.decor = { plants: SIDES, windows: [{ wall: 'north', at: 3, width: 2 }] };
    expect(fails(window)).toBe('decor.windows[0] overlaps the dock door of trucks[0]');
    const beside = base();
    beside.decor = { plants: SIDES, windows: [{ wall: 'north', at: 4, width: 2 }, { wall: 'west', at: 2, width: 1 }] };
    expect(fails(beside)).toBeNull();
    const westDoor = base();
    Object.assign(truck(westDoor), { wall: 'west', x: 0, z: 1 });
    westDoor.decor = {
      plants: [
        { x: 0, z: 0 },
        { x: 0, z: 3 },
      ],
      windows: [{ wall: 'west', at: 2, width: 1 }],
    };
    expect(fails(westDoor)).toBe('decor.windows[0] overlaps the dock door of trucks[0]');
  });

  it('nothing starts on a door cell: no zone, no box, no forklift (a box loaded on the truck is on its bed cell)', () => {
    const zone = base();
    zone.zones = [{ id: 'z1', color: 'lavender', x: 2, z: 0 }];
    boxes(zone).push({ id: 'b4', color: 'lavender', x: 6, z: 3 });
    expect(fails(zone)).toBe('zone "z1" is on the dock door of trucks[0] (column 0): the truck is loaded from there');
    const forklift = base();
    forklift.forklift = { x: 3, z: 0 };
    expect(fails(forklift)).toBe('forklift starts on the dock door of trucks[0] (column 1): door cells start empty');
    const box = base();
    boxes(box)[2] = { id: 'b3', color: 'mint', symbol: 'triangle', x: 3, z: 0 };
    expect(fails(box)).toBe('box "b3" starts on the dock door of trucks[0] (column 1): door cells start empty (a box loaded on the truck is on its bed cell 3,-1)');
    const leveled = base();
    boxes(leveled)[2] = { id: 'b3', color: 'mint', symbol: 'triangle', x: 3, z: 0, level: 0 };
    expect(fails(leveled)).toBe('box "b3" has a level but is not in a rack slot (floor stacks go by list order)');
  });

  it('ids: unique among trucks and never a rack id', () => {
    const twin = base();
    twin.trucks = [truck(twin), { id: 't1', wall: 'west', x: 0, z: 1, columns: [[{ color: 'mint' }]] }];
    boxes(twin).push({ id: 'b4', color: 'mint', x: 6, z: 3 });
    expect(fails(twin)).toBe('duplicate truck id "t1"');
    const rack = base();
    rack.racks = [{ id: 't1', x: 6, z: 1, facing: 'west', columns: [[{}]] }];
    expect(fails(rack)).toBe('trucks[0] has the id "t1" of a rack: racks and trucks never share an id');
  });

  it('boxes loaded at the start: on their bed cell outside the map, a level of their column, one per level, each on the one below', () => {
    const noLevel = base();
    boxes(noLevel)[2] = { id: 'b3', color: 'mint', symbol: 'triangle', x: 3, z: -1 };
    expect(fails(noLevel)).toBe('box "b3" is on a truck bed cell: give it its truck level');
    const high = base();
    boxes(high)[2] = { id: 'b3', color: 'mint', symbol: 'triangle', x: 3, z: -1, level: 1 };
    expect(fails(high)).toBe('box "b3" is on level 1 of trucks[0] column 1, which has 1 levels');
    const floating = base();
    boxes(floating)[2] = { id: 'b3', color: 'mint', symbol: 'triangle', x: 2, z: -1, level: 1 };
    expect(fails(floating)).toBe('box "b3" is on trucks[0] column 0 at level 1 with no box below it');
    const shared = base();
    boxes(shared)[1] = { id: 'b2', color: 'coral', symbol: 'diamond', x: 3, z: -1, level: 0 };
    boxes(shared)[2] = { id: 'b3', color: 'mint', symbol: 'triangle', x: 3, z: -1, level: 0 };
    expect(fails(shared)).toBe('two boxes share level 0 of trucks[0] column 1');
    const loaded = base();
    boxes(loaded)[2] = { id: 'b3', color: 'mint', symbol: 'triangle', x: 2, z: -1, level: 0 };
    expect(validateLevel(loaded, 'x').boxes[2]).toEqual({ id: 'b3', color: 'mint', symbol: 'triangle', x: 2, z: -1, level: 0, kind: 'standard' });
    // Outside the map anywhere but a bed cell: out of bounds.
    const beside = base();
    boxes(beside)[2] = { id: 'b3', color: 'mint', symbol: 'triangle', x: 4, z: -1, level: 0 };
    expect(fails(beside)).toBe('box "b3" out of bounds');
    // A west dock: its bed cells at x = -1.
    const west = base();
    Object.assign(truck(west), { wall: 'west', x: 0, z: 1 });
    plants(west, [
      { x: 0, z: 0 },
      { x: 0, z: 3 },
    ]);
    boxes(west)[2] = { id: 'b3', color: 'mint', symbol: 'triangle', x: -1, z: 2, level: 0 };
    expect(validateLevel(west, 'x').boxes[2]).toMatchObject({ x: -1, z: 2, level: 0 });
  });

  it('heights: every column within the stack limit', () => {
    const low = base();
    low.stackLimit = 1;
    expect(fails(low)).toBe('trucks[0].columns[0] has 2 levels, more than stackLimit 1');
  });

  it('the unique assignment counts every truck level; the level never starts solved', () => {
    const few = base();
    boxes(few).pop();
    expect(fails(few)).toBe('a level with storage racks or trucks needs one box per target (2 boxes, 0 zones, 0 slots with a cue, 3 truck levels)');
    const two = base();
    boxes(two)[0] = { id: 'b1', color: 'blue', symbol: 'circle', x: 1, z: 2 };
    boxes(two)[2] = { id: 'b3', color: 'blue', symbol: 'triangle', x: 5, z: 3 };
    truck(two).columns = [[{ color: 'blue' }, { color: 'blue' }], [{ color: 'coral', symbol: 'diamond' }]];
    expect(fails(two)).toBe('more than one complete assignment: trucks[0].columns[0][0] may take blue/circle or blue/triangle');
    const none = base();
    boxes(none)[2] = { id: 'b3', color: 'lavender', x: 5, z: 3 };
    expect(fails(none)).toMatch(/^no complete assignment exists: box "b\d" is always left without a zone or slot$/);
    const solved = base();
    solved.boxes = [
      { id: 'b1', color: 'blue', symbol: 'triangle', x: 2, z: -1, level: 0 },
      { id: 'b2', color: 'mint', symbol: 'triangle', x: 2, z: -1, level: 1 },
      { id: 'b3', color: 'coral', symbol: 'diamond', x: 3, z: -1, level: 0 },
    ];
    expect(fails(solved)).toBe('level starts already solved');
    // Every box loaded, but one of them wrong: not solved.
    const almost = base();
    almost.boxes = [
      { id: 'b1', color: 'mint', symbol: 'triangle', x: 2, z: -1, level: 0 },
      { id: 'b2', color: 'blue', symbol: 'triangle', x: 2, z: -1, level: 1 },
      { id: 'b3', color: 'coral', symbol: 'diamond', x: 3, z: -1, level: 0 },
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
    '0 .pTTp..', //                                          7
    '1 .......', //                                          8
    '2 .a...b.', //                                          9
    '3 ...^.c.', //                                          10
    '', //                                                   11
    'a = caja azul ▲     b = caja coral ◆    c = caja menta ▲', // 12
    'T = camión muelle norte: azul / ▲ | coral ◆', //         13
  ];
  const replace = (line: number, content: string) => LINES.map((l, i) => (i === line - 1 ? content : l));

  it('a window on the door, a column taller than limit, no complete assignment', () => {
    expect(errorOf(replace(4, 'ventanas: norte 3-4'))).toMatchObject({ line: 4, reason: expect.stringMatching(/una ventana choca con la puerta del muelle del camión «T»/) });
    expect(errorOf(replace(3, 'limit: 1'))).toMatchObject({ line: 7, column: 5, reason: expect.stringMatching(/esta columna del camión «T» tiene 2 niveles y limit es 1/) });
    expect(errorOf(replace(12, 'a = caja azul ▲     b = caja coral ◆    c = caja lavanda ●'))).toMatchObject({
      reason: expect.stringMatching(/no hay reparto completo: .* sin zona, hueco ni nivel de camión que la acepte/),
    });
  });

  it('a truck of 4 columns points at the first door cell too many; a door in the corner or right of the map is fine', () => {
    const wide = replace(7, '0 ..TTTT.').map((l, i) =>
      i === 11 ? 'a = caja azul ▲     b = caja coral ◆    c = caja menta ▲    d = caja lavanda    e = caja amarillo' : i === 12 ? 'T = camión muelle norte: azul / ▲ | coral ◆ | lavanda | amarillo' : l,
    );
    const withBoxes = wide.map((l, i) => (i === 7 ? '1 .d...e.' : l));
    expect(errorOf(withBoxes)).toMatchObject({
      line: 7,
      column: 8,
      reason: expect.stringMatching(/^el camión «T» tiene 4 columnas y lleva como mucho 3: su puerta mide de 1 a 3 casillas/),
    });
    expect(trucksOf(parseLevel(text(replace(7, '0 TTp....')), 'x.level').level)[0]).toMatchObject({ x: 0, z: 0, w: 2 });
    const right = replace(7, '0 ....pTT').map((l, i) => (i === 3 ? 'ventanas: oeste 1-2' : l));
    expect(trucksOf(parseLevel(text(right), 'x.level').level)[0]).toMatchObject({ x: 5, z: 0, w: 2 });
  });

  it('beside the door: a missing obstacle, two doors side by side and a rack facing the door point at the cell to fix', () => {
    expect(errorOf(replace(7, '0 .pTT...'))).toMatchObject({
      line: 7,
      column: 7,
      reason: expect.stringMatching(/^junto a la puerta del camión «T» va una barandilla naranja .*tiene que ser un obstáculo fijo: pon una planta «p» \(o una estantería\)$/),
    });
    /** LINES with row 0 and a lavender box `d` at (0,1), plus one more legend line. */
    const withRow0 = (row0: string, legend: string) =>
      LINES.map((l, i) => (i === 6 ? row0 : i === 7 ? '1 d......' : i === 11 ? 'a = caja azul ▲     b = caja coral ◆    c = caja menta ▲    d = caja lavanda' : l)).concat(legend);
    const pair = withRow0('0 .pTTUp.', 'U = camión muelle norte: lavanda');
    expect(errorOf(pair)).toMatchObject({ line: 7, column: 7, reason: expect.stringMatching(/^dos puertas de muelle no van pegadas: .*camión «T», está la del camión «U»: deja entre las dos una casilla con una planta «p»$/) });
    const rack = withRow0('0 .pTTR..', 'R = estantería frente oeste: lavanda');
    expect(errorOf(rack)).toMatchObject({ line: 7, column: 7, reason: expect.stringMatching(/^la estantería «R» se cargaría desde la puerta del camión «T», pero entre las dos va la barandilla naranja/) });
  });
});
