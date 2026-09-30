import { describe, expect, it } from 'vitest';
import racksDoc from '../../docs/RACKS.md?raw';
import { racksOf } from '../core/racks';
import { LevelFormatError, formatLevel, parseLevel, renderLevel } from './asciiLevel';
import { validateLevel } from './validateLevel';

/*
 * Storage racks in the .level format (docs/LEVELS.md, docs/RACKS.md): «R = estantería frente sur: azul / ▲ + caja
 * coral / libre», one legend column per map cell separated by «|», slots bottom → top separated by «/».
 */

const text = (lines: readonly string[]) => `${lines.join('\n')}\n`;
const replace = (lines: readonly string[], line: number, content: string) => lines.map((l, i) => (i === line - 1 ? content : l));

function errorOf(lines: readonly string[]): LevelFormatError {
  try {
    parseLevel(text(lines), 'x.level');
  } catch (e) {
    if (e instanceof LevelFormatError) return e;
    throw e;
  }
  throw new Error('expected a LevelFormatError');
}

function expectError(lines: readonly string[], line: number, column: number, reason: RegExp) {
  const e = errorOf(lines);
  expect({ line: e.line, column: e.column, reason: e.reason }).toEqual({ line, column, reason: expect.stringMatching(reason) });
  expect(e.message).toBe(`x.level:${line}:${column}: ${e.reason}`);
}

/** One rack of one column against the north wall, front to the south (line numbers as in error messages). */
const ONE = [
  '# 1 · Una estantería', //                                1
  'id: una', //                                             2
  'limit: 1', //                                            3
  '', //                                                    4
  '  0123456', //                                           5
  '0 ...R...', //                                           6
  '1 .......', //                                           7
  '2 .a...b.', //                                           8
  '3 ...^...', //                                           9
  '', //                                                    10
  'a = caja azul       b = caja menta', //                  11
  'R = estantería frente sur: azul / menta / libre', //     12
];

/** Canonical: a two-column rack facing west (along z), symbol cues, boxes in slots, a floor zone. */
const TWO = [
  '# 2 · Dos columnas',
  'id: dos',
  'limit: 1',
  '',
  '  01234567',
  '0 ........',
  '1 ......R.',
  '2 ......R.',
  '3 .1......',
  '4 ..a.b...',
  '5 ....^...',
  '6 ...c....',
  '',
  '1 = zona ■',
  'a = caja azul ▲        b = caja menta ▲       c = caja amarillo ■',
  'R = estantería frente oeste: azul ● / ▲ + caja azul ● | menta ▲ / libre',
];

describe('storage racks in .level files', () => {
  it('parses a rack: cells, front, columns of slots bottom → top, cues and «libre»', () => {
    const level = parseLevel(text(ONE)).level;
    expect(racksOf(level)).toEqual([{ id: 'r1', x: 3, z: 0, w: 1, facing: 'south', columns: [[{ color: 'blue' }, { color: 'mint' }, {}]] }]);
    expect(level.boxes.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(level.zones).toEqual([]);
  });

  it('a multi-column rack is one run of its character, one legend column per cell («|»), along its front', () => {
    const level = parseLevel(text(TWO)).level;
    expect(racksOf(level)).toEqual([
      {
        id: 'r1',
        x: 6,
        z: 1,
        w: 2,
        facing: 'west',
        columns: [[{ color: 'blue', symbol: 'circle' }, { symbol: 'triangle' }], [{ color: 'mint', symbol: 'triangle' }, {}]],
      },
    ]);
    // A box in a slot: its rack cell and the slot level; numbered after the floor boxes.
    expect(level.boxes.at(-1)).toEqual({ id: 'b4', color: 'blue', symbol: 'circle', x: 6, z: 1, level: 1, kind: 'standard' });
    expect(level.boxes.slice(0, 3).every((b) => b.level === undefined)).toBe(true);
  });

  it('renders canonically and round-trips (render(parse) = text, parse(render) = level)', () => {
    for (const lines of [ONE, TWO]) {
      const parsed = parseLevel(text(lines));
      expect(renderLevel(parsed.level, parsed)).toBe(text(lines));
      expect(parseLevel(renderLevel(parsed.level)).level).toStrictEqual(parsed.level);
      expect(formatLevel(text(lines))).toBe(text(lines));
    }
  });

  it('normalises spacing, synonyms and a rack written with English words', () => {
    const loose = replace(ONE, 12, 'R = estanteria   frente south :azul/menta/ libre');
    const parsed = parseLevel(text(loose));
    expect(parsed.level).toStrictEqual(parseLevel(text(ONE)).level);
    expect(renderLevel(parsed.level)).toBe(text(ONE));
  });

  it('keeps explicit ids of racks and of boxes in slots, and writes them back only when not generated', () => {
    const lines = replace(TWO, 16, 'R = estantería frente oeste (alta): azul ● / ▲ + caja azul ● (b9) | menta ▲ / libre');
    const level = parseLevel(text(lines)).level;
    expect(racksOf(level)[0].id).toBe('alta');
    expect(level.boxes.at(-1)!.id).toBe('b9');
    expect(renderLevel(level)).toBe(text(lines));
    expect(parseLevel(renderLevel(level)).level).toStrictEqual(level);
  });

  it('two racks with one character are two racks (reading order), each described by the same legend', () => {
    // Four targets (two «azul ▲», two «azul ●»), two boxes of each kind: identical boxes, one assignment.
    const lines = [
      '# 3 · Dos iguales',
      'id: dos-iguales',
      '',
      '  012345678',
      '0 .R.....R.',
      '1 .........',
      '2 .a.b.c.d.',
      '3 ....^....',
      '',
      'a b = caja azul ●    c d = caja azul ▲',
      'R = estantería frente sur: azul ▲ / azul ●',
    ];
    const level = parseLevel(text(lines)).level;
    expect(racksOf(level).map((r) => [r.id, r.x])).toEqual([
      ['r1', 1],
      ['r2', 7],
    ]);
    // Rendered with a character per rack.
    const again = parseLevel(renderLevel(level)).level;
    expect(again).toStrictEqual(level);
    expect(renderLevel(level)).toContain('S = estantería frente sur: azul ▲ / azul ●');
  });

  it('racks mix with shelves, plants, zones and floor stacks; levels without racks or trucks get no `storage` key', () => {
    const lines = [
      '# 4 · Todo junto',
      'id: todo-junto',
      'limit: 3',
      '',
      '  0123456789',
      '0 p##R......',
      '1 ..........',
      '2 .1..a...2.',
      '3 ....^.....',
      '4 .........p',
      '',
      '1 = zona coral            2 = zona lavanda',
      'a = pila lavanda,coral',
      'R = estantería frente sur: menta + caja azul / azul + caja menta / libre',
    ];
    const parsed = parseLevel(text(lines));
    expect(parsed.level.stackLimit).toBe(3);
    expect(parsed.level.shelves).toEqual([{ x: 1, z: 0, w: 2, d: 1, tiers: 2 }]);
    expect(renderLevel(parsed.level)).toBe(text(lines));
    expect('storage' in parseLevel(text(['# 5 · Sin', 'id: sin', '', '..1..', '.a...', '..^..', '', '1 = zona azul', 'a = caja azul'])).level).toBe(false);
  });

  it('docs/RACKS.md: its example is a valid level with racks', () => {
    const blocks = [...racksDoc.replace(/\r\n/g, '\n').matchAll(/^```\n([\s\S]*?)^```/gm)].map((m) => m[1]);
    const example = blocks.find((b) => b.startsWith('# '));
    expect(example).toBeDefined();
    const level = parseLevel(example!).level;
    expect(racksOf(level).length).toBeGreaterThan(0);
    expect(renderLevel(level)).toBe(example);
  });
});

describe('storage rack grammar errors (Spanish, file:line:column)', () => {
  const legend = (content: string) => replace(ONE, 12, content);

  it('the front direction and the colon', () => {
    expectError(legend('R = estantería frente: azul'), 12, 22, /¿hacia dónde mira el frente\?/);
    expectError(legend('R = estantería frente suur: azul'), 12, 23, /¿quisiste decir «sur»\?/);
    expectError(legend('R = estantería frente sur azul'), 12, 27, /van dos puntos/);
    expectError(legend('R = estantería frente sur: azul: menta'), 12, 32, /los dos puntos van una sola vez/);
  });

  it('slots: at most three per column, none empty, cues and «libre»', () => {
    expectError(legend('R = estantería frente sur: azul / menta / libre / coral'), 12, 51, /como mucho 3 huecos/);
    expectError(legend('R = estantería frente sur: azul // menta'), 12, 34, /falta un hueco/);
    expectError(legend('R = estantería frente sur: azull / menta'), 12, 28, /palabra desconocida «azull» en un hueco.*«azul»/);
    expectError(legend('R = estantería frente sur: libre azul'), 12, 34, /«libre» va solo/);
    expectError(legend('R = estantería frente sur: azul menta'), 12, 33, /un solo color/);
    expectError(legend('R = estantería frente sur: ▲ ■'), 12, 30, /un solo símbolo/);
    expectError(legend('R = estantería frente sur: caja azul'), 12, 28, /la caja va después de la pista/);
  });

  it('a box in a slot: «+ caja …», one box', () => {
    expectError(legend('R = estantería frente sur: azul + menta / menta'), 12, 35, /después del «\+» va «caja …»/);
    expectError(legend('R = estantería frente sur: azul + pila azul,menta'), 12, 35, /una sola caja \(no una pila\)/);
    expectError(legend('R = estantería frente sur: azul + / menta'), 12, 33, /falta la caja después del «\+»/);
    expectError(legend('R = estantería frente sur: azul + caja azul + caja menta'), 12, 45, /un hueco guarda una sola caja/);
    expectError(legend('R = estantería frente sur: + caja azul / menta'), 12, 28, /falta la pista del hueco/);
  });

  it('rack punctuation outside a rack, and «frente» on an obstacle shelf', () => {
    expectError(replace(ONE, 11, 'a = caja azul / menta    b = caja menta'), 11, 15, /«\/» solo va en una estantería almacenable/);
    expectError(legend('R = estantería 2 alturas frente sur'), 12, 26, /estantería almacenable se escribe «estantería frente sur: …»/);
  });

  it('on the map: a straight run along its front, one legend column per cell', () => {
    // Facing south, a rack runs along a row: a vertical run is not one.
    const vertical = replace(replace(ONE, 7, '1 ...R...'), 8, '2 .a...b.');
    expectError(vertical, 6, 6, /no es una fila recta.*frente sur/);
    // Facing east, it runs along a column.
    expectError(replace(legend('R = estantería frente este: azul'), 6, '0 ...RR..'), 6, 6, /no es una columna recta/);
    // Two cells, one column described.
    expectError(replace(ONE, 6, '0 ...RR..'), 6, 6, /ocupa 2 casillas y su leyenda describe 1 columna/);
    // An own id on a character used by two racks.
    const twice = replace(replace(ONE, 6, '0 .R...R.'), 12, 'R = estantería frente sur (alta): azul / menta / libre');
    expectError(twice, 12, 27, /lleva un id propio y hay 2 estanterías/);
  });
});

describe('storage rack validation (Spanish at the place to fix)', () => {
  it('a rack needs room in front of every column', () => {
    // Facing north against the north wall: its front is outside the warehouse.
    expectError(replace(ONE, 12, 'R = estantería frente norte: azul / menta / libre'), 6, 6, /se carga por delante.*pared, una estantería o una planta/);
    // A plant right in front of it.
    expectError(replace(ONE, 7, '1 ...p...'), 6, 6, /se carga por delante/);
  });

  it('zones ask for one box in a level with racks (floor stacks only park)', () => {
    const lines = [...replace(ONE, 7, '1 .1.....'), '1 = zona pila azul,menta'];
    expectError(replace(lines, 3, 'limit: 2'), 13, 1, /las zonas piden una sola caja/);
  });

  it('one box per target (zones and slots with a cue; «libre» slots do not count)', () => {
    expectError(replace(replace(ONE, 8, '2 .a.....'), 11, 'a = caja azul'), 1, 1, /hay 1 cajas para 0 zonas y 2 huecos con pista/);
  });

  it('a complete assignment must exist', () => {
    expectError(replace(ONE, 11, 'a = caja azul       b = caja coral'), 8, 8, /no hay reparto completo: la caja «b» de esta casilla/);
  });

  it('and be unique: every box has exactly one place', () => {
    // Two blue boxes (● and ▲) and two «azul» slots: which goes where is not decided.
    const lines = replace(replace(ONE, 11, 'a = caja azul ●     b = caja azul ▲'), 12, 'R = estantería frente sur: azul / azul / libre');
    expectError(lines, 6, 6, /hay más de un reparto: el hueco de abajo de la estantería «R» puede llevar la caja azul ● o la azul ▲/);
    // A zone and a slot that both take either blue box.
    const zone = [...replace(replace(replace(ONE, 7, '1 .1.....'), 11, 'a = caja azul ●     b = caja azul ▲'), 12, 'R = estantería frente sur: azul / libre'), '1 = zona azul'];
    expectError(zone, 13, 1, /hay más de un reparto: la zona «1» puede llevar la caja azul ● o la azul ▲/);
    // Identical boxes are interchangeable: two «azul» slots and two plain blue boxes are one assignment.
    const identical = replace(replace(ONE, 11, 'a = caja azul       b = caja azul'), 12, 'R = estantería frente sur: azul / azul / libre');
    expect(racksOf(parseLevel(text(identical)).level)).toHaveLength(1);
  });

  it('must not start solved', () => {
    const solved = replace(replace(ONE, 8, '2 .......'), 11, '');
    expectError(replace(solved, 12, 'R = estantería frente sur: azul + caja azul / menta + caja menta / libre'), 1, 1, /empieza ya resuelto/);
  });

  it('lifts the «symbols do not stack» rule for levels with racks only', () => {
    const lines = [
      '# 6 · Símbolos y pilas',
      'id: simbolos-pilas',
      'limit: 3',
      '',
      '  0123456',
      '0 ...R...',
      '1 .......',
      '2 .a.....',
      '3 ...^...',
      '',
      'a = pila azul ●,menta ▲',
      'R = estantería frente sur: ● / ▲',
    ];
    const level = parseLevel(text(lines)).level;
    expect(level.stackLimit).toBe(3);
    // Without the rack the same boxes break the sorting chapter's rule.
    expect(() =>
      validateLevel({ ...level, storage: undefined, zones: [{ id: 'z1', symbol: 'circle', x: 5, z: 1 }, { id: 'z2', symbol: 'triangle', x: 5, z: 2 }] }),
    ).toThrow(/does not stack yet/);
  });
});

describe('validateLevel: raw racks (JSON)', () => {
  const base = {
    id: 'crudo',
    order: 1,
    name: 'Crudo',
    size: { width: 7, depth: 5 },
    forklift: { x: 3, z: 4, heading: 180 },
    boxes: [
      { id: 'b1', color: 'blue', x: 1, z: 2 },
      { id: 'b2', color: 'mint', x: 5, z: 2 },
    ],
    zones: [],
    shelves: [],
    racks: [{ x: 3, z: 0, facing: 'south', columns: [[{ color: 'blue' }, { color: 'mint' }, {}]] }],
  };
  const withRack = (rack: Record<string, unknown>) => ({ ...base, racks: [{ ...base.racks[0], ...rack }] });

  it('fills id and w, keeps key order stable', () => {
    const level = validateLevel(base);
    expect(racksOf(level)).toEqual([{ id: 'r1', x: 3, z: 0, w: 1, facing: 'south', columns: [[{ color: 'blue' }, { color: 'mint' }, {}]] }]);
    expect(Object.keys(level)).toEqual(['id', 'order', 'name', 'size', 'forklift', 'boxes', 'zones', 'shelves', 'storage', 'decor', 'stackLimit', 'theme']);
    expect(Object.keys(validateLevel({ ...base, racks: [], zones: [{ id: 'z1', color: 'blue', x: 1, z: 1 }, { id: 'z2', color: 'mint', x: 2, z: 1 }] }))).not.toContain('storage');
  });

  it('rejects malformed racks', () => {
    expect(() => validateLevel(withRack({ facing: 'up' }))).toThrow(/racks\[0\]\.facing must be north, east, south or west/);
    expect(() => validateLevel(withRack({ columns: [] }))).toThrow(/needs at least one column/);
    expect(() => validateLevel(withRack({ columns: [[{}, {}, {}, {}]] }))).toThrow(/must have 1 to 3 slots/);
    expect(() => validateLevel(withRack({ w: 2 }))).toThrow(/w must equal its number of columns/);
    expect(() => validateLevel(withRack({ columns: [[{ color: 'grey' }]] }))).toThrow(/unknown color "grey"/);
    expect(() => validateLevel(withRack({ x: 7 }))).toThrow(/leaves the warehouse/);
    expect(() => validateLevel({ ...base, shelves: [{ x: 3, z: 0, w: 1, d: 1 }] })).toThrow(/overlaps another obstacle/);
    expect(() => validateLevel({ ...base, racks: [base.racks[0], { ...base.racks[0], id: 'r1', x: 4 }] })).toThrow(/duplicate rack id "r1"/);
  });

  it('checks boxes in slots', () => {
    const inRack = (box: Record<string, unknown>) => ({ ...base, boxes: [base.boxes[0], { id: 'b2', color: 'mint', x: 3, z: 0, ...box }] });
    expect(validateLevel(inRack({ level: 1 })).boxes[1]).toEqual({ id: 'b2', color: 'mint', x: 3, z: 0, level: 1, kind: 'standard' });
    expect(() => validateLevel(inRack({}))).toThrow(/is in a rack cell: give it the level of its slot/);
    expect(() => validateLevel(inRack({ level: 3 }))).toThrow(/is in slot 3 of racks\[0\] column 0, which has 3 slots/);
    expect(() => validateLevel({ ...base, boxes: [{ ...base.boxes[0], level: 0 }, base.boxes[1]] })).toThrow(/has a level but is not in a rack slot/);
    expect(() =>
      validateLevel({ ...base, boxes: [{ id: 'b1', color: 'blue', x: 3, z: 0, level: 2 }, { id: 'b2', color: 'mint', x: 3, z: 0, level: 2 }] }),
    ).toThrow(/two boxes share slot 2/);
  });

  it('refuses an ambiguous rack level in English for JSON sources', () => {
    expect(() => validateLevel(withRack({ columns: [[{ color: 'blue' }, { color: 'blue' }, {}]] }))).toThrow(/no complete assignment exists: box "b2"/);
    expect(() =>
      validateLevel({ ...withRack({ columns: [[{ color: 'blue' }, { color: 'blue' }, {}]] }), boxes: [{ id: 'b1', color: 'blue', x: 1, z: 2 }, { id: 'b2', color: 'blue', symbol: 'triangle', x: 5, z: 2 }] }),
    ).toThrow(/more than one complete assignment: racks\[0\]\.columns\[0\]\[0\] may take blue\/circle or blue\/triangle/);
  });
});
