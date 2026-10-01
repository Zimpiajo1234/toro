import { describe, expect, it } from 'vitest';
import docksDoc from '../../docs/DOCKS.md?raw';
import type { LevelData } from '../core/types';
import { LevelFormatError, formatLevel, parseLevel, parseLevelDraft, renderLevel } from './asciiLevel';
import { validateLevel } from './validateLevel';

/*
 * Loading docks in the .level format (docs/DOCKS.md): «T = camión muelle norte: azul / ▲ | coral ◆», its character on
 * the door cells, a straight run against the north (row 0) or west (column 0) wall, one legend column per cell (the bed
 * column outside, beyond the wall) separated by «|», levels bottom → top separated by «/». A box loaded at the start is
 * on its bed cell: z = -1 (north) or x = -1 (west).
 *
 * The grammar is tested on the draft (parseLevelDraft: before validateLevel), so it does not depend on the truck rules
 * of validateLevel; the round trips through validateLevel follow. Every door here has a plant beside each end of its
 * run (behind its guard rail), unless the run reaches a corner.
 */

const text = (lines: readonly string[]) => `${lines.join('\n')}\n`;
const replace = (lines: readonly string[], line: number, content: string) => lines.map((l, i) => (i === line - 1 ? content : l));

/** The draft as validateLevel returns a level (its defaults filled in), to render it without validateLevel. */
function asLevel(raw: Record<string, unknown>): LevelData {
  const r = raw as unknown as LevelData;
  return {
    ...r,
    boxes: r.boxes.map((b) => ({ ...b, kind: b.kind ?? 'standard' })),
    decor: { plants: r.decor.plants.map((p, i) => ({ ...p, variant: p.variant ?? i })), windows: r.decor.windows },
    stackLimit: r.stackLimit ?? 1,
    theme: r.theme ?? 'default',
  };
}

const draftOf = (lines: readonly string[]) => parseLevelDraft(text(lines), 'x.level');
const levelOf = (lines: readonly string[]) => asLevel(draftOf(lines).raw);

function errorOf(lines: readonly string[]): LevelFormatError {
  try {
    draftOf(lines);
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

/** A two-column truck in the north wall (line numbers as in error messages). */
const NORTH = [
  '# 1 · Un camión', //                                      1
  'id: un-camion', //                                        2
  'limit: 2', //                                             3
  '', //                                                     4
  '  0123456', //                                            5
  '0 .pTTp..', //                                            6
  '1 .......', //                                            7
  '2 .a...b.', //                                            8
  '3 ...^.c.', //                                            9
  '', //                                                     10
  'a = caja azul ▲     b = caja coral ◆    c = caja menta ▲', // 11
  'T = camión muelle norte: azul / ▲ | coral ◆', //          12
];

const NORTH_LEVEL: LevelData = {
  id: 'un-camion',
  order: 1,
  name: 'Un camión',
  size: { width: 7, depth: 4 },
  forklift: { x: 3, z: 3, heading: 180 },
  boxes: [
    { id: 'b1', color: 'blue', symbol: 'triangle', x: 1, z: 2, kind: 'standard' },
    { id: 'b2', color: 'coral', symbol: 'diamond', x: 5, z: 2, kind: 'standard' },
    { id: 'b3', color: 'mint', symbol: 'triangle', x: 5, z: 3, kind: 'standard' },
  ],
  zones: [],
  shelves: [],
  trucks: [{ id: 't1', wall: 'north', x: 2, z: 0, w: 2, columns: [[{ color: 'blue' }, { symbol: 'triangle' }], [{ color: 'coral', symbol: 'diamond' }]] }],
  decor: {
    plants: [
      { x: 1, z: 0, variant: 0 },
      { x: 4, z: 0, variant: 1 },
    ],
    windows: [],
  },
  stackLimit: 2,
  theme: 'default',
};

/** A truck in the west wall (along z) with a box loaded at the start, and a floor zone. */
const WEST = [
  '# 2 · Muelle oeste',
  'id: muelle-oeste',
  'limit: 1',
  '',
  '  012345',
  '0 p.....',
  '1 T.....',
  '2 T..a..',
  '3 p1....',
  '4 ...^b.',
  '',
  '1 = zona ■',
  'a = caja azul ●        b = caja amarillo ■',
  'T = camión muelle oeste: azul + caja menta ▲ | ▲',
];

/** Racks, trucks, zones, plants and windows together. */
const MIXED = [
  '# 4 · Todo junto',
  'id: todo-junto',
  'limit: 1',
  'ventanas: norte 8-9, oeste 2',
  '',
  '  0123456789',
  '0 .pTTp.R...',
  '1 ..........',
  '2 .1..a..b..',
  '3 ....^.....',
  '4 .c.....d.p',
  '',
  '1 = zona coral',
  'a = caja azul        b = caja menta       c = caja coral       d = caja amarillo',
  'R = estantería frente sur: menta / libre',
  'T = camión muelle norte: azul | amarillo',
];

/** Two one-column trucks with one character: two trucks, in reading order. */
const TWIN = [
  '# 3 · Dos camiones',
  'id: dos-camiones',
  'limit: 1',
  '',
  '  0123456',
  '0 pTp.pTp',
  '1 .......',
  '2 ..a.b..',
  '3 ...^...',
  '',
  'a b = caja azul ●',
  'T = camión muelle norte: azul ●',
];


describe('loading docks in .level files (grammar, before validateLevel)', () => {
  it('parses a north truck: its door run on row 0, columns of levels bottom → top, cues', () => {
    expect(levelOf(NORTH)).toStrictEqual(NORTH_LEVEL);
  });

  it('a west truck runs along column 0; a box loaded at the start has its bed cell (x = -1) and level, after the floor boxes', () => {
    const level = levelOf(WEST);
    expect(level.trucks).toStrictEqual([{ id: 't1', wall: 'west', x: 0, z: 1, w: 2, columns: [[{ color: 'blue' }], [{ symbol: 'triangle' }]] }]);
    expect(level.boxes.map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(level.boxes[2]).toStrictEqual({ id: 'b3', color: 'mint', symbol: 'triangle', x: -1, z: 1, level: 0, kind: 'standard' });
    expect(level.boxes.slice(0, 2).every((b) => b.level === undefined)).toBe(true);
  });

  it('renders canonically and round-trips (render(draft) = text, draft(render(level)) = level)', () => {
    expect(renderLevel(NORTH_LEVEL)).toBe(text(NORTH));
    for (const lines of [NORTH, WEST, MIXED]) {
      const level = levelOf(lines);
      expect(renderLevel(level)).toBe(text(lines));
      expect(asLevel(parseLevelDraft(renderLevel(level)).raw)).toStrictEqual(level);
    }
    // Not canonical (one character, two trucks), but the level survives the round trip.
    const twin = levelOf(TWIN);
    expect(asLevel(parseLevelDraft(renderLevel(twin)).raw)).toStrictEqual(twin);
  });

  it('normalises spacing and synonyms («camion en el muelle», «muelle», «truck north»)', () => {
    for (const legend of ['T = camion en el muelle north:azul/▲|coral◆', 'T = muelle norte : azul / ▲ | coral ◆', 'T = truck north: blue / triangle | coral diamond']) {
      const level = levelOf(replace(NORTH, 12, legend));
      expect(level).toStrictEqual(NORTH_LEVEL);
      expect(renderLevel(level)).toBe(text(NORTH));
    }
  });

  it('keeps explicit ids of trucks and of their boxes, and writes them back only when not generated', () => {
    const lines = replace(
      replace(replace(NORTH, 9, '3 ...^...'), 11, 'a = caja azul ▲     b = caja coral ◆'),
      12,
      'T = camión muelle norte (grande): azul / ▲ | coral ◆ + caja menta ▲ (b9)',
    );
    const level = levelOf(lines);
    expect(level.trucks![0].id).toBe('grande');
    expect(level.boxes.at(-1)).toStrictEqual({ id: 'b9', color: 'mint', symbol: 'triangle', x: 3, z: -1, level: 0, kind: 'standard' });
    expect(renderLevel(level)).toBe(text(lines));
  });

  it('two trucks with one character are two trucks (reading order), rendered with a character each', () => {
    const level = levelOf(TWIN);
    expect(level.trucks!.map((t) => [t.id, t.x])).toEqual([
      ['t1', 1],
      ['t2', 5],
    ]);
    const again = renderLevel(level);
    expect(again).toContain('0 pTp.pCp');
    expect(again).toContain('T C = camión muelle norte: azul ●');
  });

  it('trucks mix with racks, zones, plants and windows (racks first); levels without trucks get no `trucks` key', () => {
    const level = levelOf(MIXED);
    expect(level.racks).toHaveLength(1);
    expect(level.trucks).toStrictEqual([{ id: 't1', wall: 'north', x: 2, z: 0, w: 2, columns: [[{ color: 'blue' }], [{ color: 'yellow' }]] }]);
    const plain = ['# 5 · Sin', 'id: sin', '', '..1..', '.a...', '..^..', '', '1 = zona azul', 'a = caja azul'];
    expect('trucks' in draftOf(plain).raw).toBe(false);
    expect('trucks' in parseLevel(text(plain)).level).toBe(false);
  });

  it('docs/DOCKS.md: its example parses and is canonical', () => {
    const blocks = [...docksDoc.replace(/\r\n/g, '\n').matchAll(/^```\n([\s\S]*?)^```/gm)].map((m) => m[1]);
    const example = blocks.find((b) => b.startsWith('# '));
    expect(example).toBeDefined();
    const level = asLevel(parseLevelDraft(example!).raw);
    expect(level.trucks?.length).toBeGreaterThan(0);
    expect(renderLevel(level)).toBe(example);
  });
});

describe('truck grammar errors (Spanish, file:line:column)', () => {
  const legend = (content: string) => replace(NORTH, 12, content);

  it('the wall and the colon', () => {
    expectError(legend('T = camión muelle: azul'), 12, 18, /¿en qué muro está el muelle\?/);
    expectError(legend('T = camión muelle nortee: azul'), 12, 19, /¿quisiste decir «norte»\?/);
    expectError(legend('T = camión muelle sur: azul'), 12, 19, /los muelles van en el muro norte o en el oeste.*no «sur»/);
    expectError(legend('T = camión muelle norte azul'), 12, 25, /van dos puntos/);
    expectError(legend('T = camión muelle norte: azul: ▲'), 12, 30, /los dos puntos van una sola vez, tras «camión muelle …»/);
  });

  it('levels: at most two per column, none empty, every one with a cue (no «libre»)', () => {
    expectError(legend('T = camión muelle norte: azul / ▲ / menta | coral ◆'), 12, 37, /una columna del camión lleva como mucho 2 niveles \(2 cajas de alto\)/);
    expectError(legend('T = camión muelle norte: azul // ▲ | coral ◆'), 12, 32, /falta un nivel/);
    expectError(legend('T = camión muelle norte: libre / ▲ | coral ◆'), 12, 26, /no hay niveles «libre»/);
    expectError(legend('T = camión muelle norte: azull / ▲ | coral ◆'), 12, 26, /palabra desconocida «azull» en un nivel del camión.*«azul»/);
    expectError(legend('T = camión muelle norte: azul menta / ▲ | coral ◆'), 12, 31, /un nivel del camión pide un solo color/);
    expectError(legend('T = camión muelle norte: caja azul / ▲ | coral ◆'), 12, 26, /la caja va después de la pista/);
  });

  it('a box loaded at the start: «+ caja …», one box, with a box under it', () => {
    expectError(legend('T = camión muelle norte: azul + pila azul,menta / ▲ | coral ◆'), 12, 33, /en un nivel del camión cabe una sola caja \(no una pila\)/);
    expectError(legend('T = camión muelle norte: azul / ▲ + caja menta ▲ | coral ◆'), 12, 33, /no tiene nada debajo \(el nivel de abajo está vacío\)/);
  });

  it('truck punctuation outside a rack or a truck', () => {
    expectError(replace(NORTH, 11, 'a = caja azul / menta'), 11, 15, /«\/» solo va en una estantería almacenable o en un camión/);
  });

  it('on the map: a straight run against its wall, one legend column per cell', () => {
    // Off the wall: a north truck's door cells lie on row 0.
    expectError(
      replace(replace(NORTH, 6, '0 .......'), 7, '1 ..TT...'),
      7,
      5,
      /espera fuera, pegado al muro norte: sus casillas son las de la puerta, en la fila 0 del mapa \(aquí está en la fila 1\)/,
    );
    // A north truck runs along the row; a west one along the column.
    expectError(replace(replace(NORTH, 6, '0 ..T....'), 7, '1 ..T....'), 6, 5, /no es una fila recta/);
    expectError(legend('T = camión muelle oeste: azul / ▲ | coral ◆'), 6, 5, /no es una columna recta/);
    // Cells and legend columns.
    expectError(replace(NORTH, 6, '0 ..TTT..'), 6, 5, /ocupa 3 casillas y su leyenda describe 2 columnas/);
    // An own id on a character used by two trucks.
    const twice = replace(TWIN, 12, 'T = camión muelle norte (azules): azul ●');
    expectError(twice, 12, 25, /lleva un id propio y hay 2 camiones/);
  });

  it('a rack and a truck never share an id (their slots are both «id:columna:nivel»)', () => {
    const lines = [...replace(replace(MIXED, 15, 'R = estantería frente sur (m1): menta / libre'), 16, 'T = camión muelle norte (m1): azul | amarillo')];
    expectError(lines, 16, 25, /id repetido «m1»: también es el de la estantería «R».*no comparten id/);
  });
});

describe('trucks through validateLevel (docs/DOCKS.md «Validación»)', () => {
  it('validateLevel keeps `trucks`', () => {
    expect(validateLevel(draftOf(NORTH).raw).trucks).toHaveLength(1);
  });

  it('parse(render(level)) = level, render(parse(text)) = text', () => {
    for (const lines of [NORTH, WEST, MIXED]) {
      const parsed = parseLevel(text(lines));
      expect(parsed.level.trucks?.length).toBeGreaterThan(0);
      expect(renderLevel(parsed.level, parsed)).toBe(text(lines));
      expect(parseLevel(renderLevel(parsed.level)).level).toStrictEqual(parsed.level);
      expect(formatLevel(text(lines))).toBe(text(lines));
    }
    expect(parseLevel(text(NORTH)).level).toStrictEqual(NORTH_LEVEL);
    const twin = parseLevel(text(TWIN)).level;
    expect(parseLevel(renderLevel(twin)).level).toStrictEqual(twin);
  });

  it('keeps the key order: `trucks` right after `racks`', () => {
    expect(Object.keys(parseLevel(text(MIXED)).level)).toEqual(['id', 'order', 'name', 'size', 'forklift', 'boxes', 'zones', 'shelves', 'racks', 'trucks', 'decor', 'stackLimit', 'theme']);
  });

  it('docs/DOCKS.md: its example is a valid level', () => {
    const blocks = [...docksDoc.replace(/\r\n/g, '\n').matchAll(/^```\n([\s\S]*?)^```/gm)].map((m) => m[1]);
    const example = blocks.find((b) => b.startsWith('# '))!;
    expect(renderLevel(parseLevel(example).level)).toBe(example);
  });

  it('places validation errors on the truck to fix', () => {
    // Two blue boxes (● and ▲) and two «azul» levels: which goes where is not decided.
    const lines = replace(replace(NORTH, 11, 'a = caja azul ●     b = caja coral ◆    c = caja azul ▲'), 12, 'T = camión muelle norte: azul / azul | coral ◆');
    const e = (() => {
      try {
        parseLevel(text(lines), 'x.level');
      } catch (error) {
        return error as LevelFormatError;
      }
      throw new Error('expected a LevelFormatError');
    })();
    expect(e).toBeInstanceOf(LevelFormatError);
    expect(e.reason).toMatch(/hay más de un reparto: el nivel de abajo de la columna 1 del camión «T» puede llevar la caja azul ● o la azul ▲/);
  });
});
