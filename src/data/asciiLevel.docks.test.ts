import { describe, expect, it } from 'vitest';
import docksDoc from '../../docs/DOCKS.md?raw';
import { storageOf } from '../core/storage';
import type { LevelData, StorageSkin } from '../core/types';
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
/** A level's storage units of one skin, as `level.storage` lists them. */
const unitsOf = (level: Pick<LevelData, 'storage'>, skin: StorageSkin) => storageOf(level).filter((unit) => unit.skin === skin);

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
  storage: [
    {
      id: 't1',
      skin: 'truck',
      x: 2,
      z: 0,
      w: 2,
      access: { kind: 'door', wall: 'north' },
      columns: [[{ color: 'blue' }, { symbol: 'triangle' }], [{ color: 'coral', symbol: 'diamond' }]],
    },
  ],
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
    expect(unitsOf(level, 'truck')).toStrictEqual([
      { id: 't1', skin: 'truck', x: 0, z: 1, w: 2, access: { kind: 'door', wall: 'west' }, columns: [[{ color: 'blue' }], [{ symbol: 'triangle' }]] },
    ]);
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
    expect(unitsOf(level, 'truck')[0].id).toBe('grande');
    expect(level.boxes.at(-1)).toStrictEqual({ id: 'b9', color: 'mint', symbol: 'triangle', x: 3, z: -1, level: 0, kind: 'standard' });
    expect(renderLevel(level)).toBe(text(lines));
  });

  it('two trucks with one character are two trucks (reading order), rendered with a character each', () => {
    const level = levelOf(TWIN);
    expect(unitsOf(level, 'truck').map((t) => [t.id, t.x])).toEqual([
      ['t1', 1],
      ['t2', 5],
    ]);
    const again = renderLevel(level);
    expect(again).toContain('0 pTp.pCp');
    expect(again).toContain('T C = camión muelle norte: azul ●');
  });

  it('trucks mix with racks, zones, plants and windows (racks first); levels without racks or trucks get no `storage` key', () => {
    const level = levelOf(MIXED);
    expect(unitsOf(level, 'rack')).toHaveLength(1);
    expect(unitsOf(level, 'truck')).toStrictEqual([
      { id: 't1', skin: 'truck', x: 2, z: 0, w: 2, access: { kind: 'door', wall: 'north' }, columns: [[{ color: 'blue' }], [{ color: 'yellow' }]] },
    ]);
    const plain = ['# 5 · Sin', 'id: sin', '', '..1..', '.a...', '..^..', '', '1 = zona azul', 'a = caja azul'];
    expect('storage' in draftOf(plain).raw).toBe(false);
    expect('storage' in parseLevel(text(plain)).level).toBe(false);
  });

  it('docs/DOCKS.md: its example parses and is canonical', () => {
    const blocks = [...docksDoc.replace(/\r\n/g, '\n').matchAll(/^```\n([\s\S]*?)^```/gm)].map((m) => m[1]);
    const example = blocks.find((b) => b.startsWith('# '));
    expect(example).toBeDefined();
    const level = asLevel(parseLevelDraft(example!).raw);
    expect(unitsOf(level, 'truck').length).toBeGreaterThan(0);
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

  it('levels: at most two per column, none empty, a cue or «libre» (alone)', () => {
    expectError(legend('T = camión muelle norte: azul / ▲ / menta | coral ◆'), 12, 37, /una columna del camión lleva como mucho 2 niveles \(2 cajas de alto\)/);
    expectError(legend('T = camión muelle norte: azul // ▲ | coral ◆'), 12, 32, /falta un nivel: su pista \(color, símbolo, ambos o «libre»\)/);
    expectError(legend('T = camión muelle norte: libre azul / ▲ | coral ◆'), 12, 32, /«libre» va solo: un nivel libre no pide nada/);
    // «libre» is a level of its own (docs/STORAGE.md rule 7): the grammar reads it anywhere; validateLevel wants it on top.
    expect(levelOf(legend('T = camión muelle norte: azul / ▲ | coral ◆ / libre')).storage![0].columns).toEqual([
      [{ color: 'blue' }, { symbol: 'triangle' }],
      [{ color: 'coral', symbol: 'diamond' }, null],
    ]);
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
  it('validateLevel keeps the truck', () => {
    expect(unitsOf(validateLevel(draftOf(NORTH).raw), 'truck')).toHaveLength(1);
  });

  it('parse(render(level)) = level, render(parse(text)) = text', () => {
    for (const lines of [NORTH, WEST, MIXED]) {
      const parsed = parseLevel(text(lines));
      expect(unitsOf(parsed.level, 'truck').length).toBeGreaterThan(0);
      expect(renderLevel(parsed.level, parsed)).toBe(text(lines));
      expect(parseLevel(renderLevel(parsed.level)).level).toStrictEqual(parsed.level);
      expect(formatLevel(text(lines))).toBe(text(lines));
    }
    // validateLevel fills the second column up to limit 2 (its level on top «libre»); the canonical text leaves it out.
    const [dock] = NORTH_LEVEL.storage!;
    expect(parseLevel(text(NORTH)).level).toStrictEqual({ ...NORTH_LEVEL, storage: [{ ...dock, columns: [dock.columns[0], [...dock.columns[1], null]] }] });
    const twin = parseLevel(text(TWIN)).level;
    expect(parseLevel(renderLevel(twin)).level).toStrictEqual(twin);
  });

  it('«libre» in a truck (docs/STORAGE.md rule 7): implicit up to the limit, left out of the canonical text unless it holds a box', () => {
    const level = (lines: readonly string[]) => parseLevel(text(lines)).level;
    // Written or implicit, the same level; the formatter leaves a «libre» on top without a box out (idempotent).
    const written = replace(NORTH, 12, 'T = camión muelle norte: azul / ▲ | coral ◆ / libre');
    expect(level(written)).toStrictEqual(level(NORTH));
    expect(formatLevel(text(written))).toBe(text(NORTH));
    expect(formatLevel(formatLevel(text(written)))).toBe(text(NORTH));
    // With a box parked on it at the start it is written; a column all «libre» keeps one level written.
    const parked = replace(
      replace(replace(replace(NORTH, 8, '2 .a.....'), 9, '3 ...^...'), 11, 'a = caja azul ▲'),
      12,
      'T = camión muelle norte: azul / ▲ | coral ◆ + caja menta ▲ / libre + caja coral ◆',
    );
    expect(level(parked).storage![0].columns[1]).toEqual([{ color: 'coral', symbol: 'diamond' }, null]);
    expect(level(parked).boxes.at(-1)).toMatchObject({ color: 'coral', x: 3, z: -1, level: 1 });
    expect(formatLevel(text(parked))).toBe(text(parked));
    const free = replace(replace(replace(replace(NORTH, 8, '2 .a.....'), 9, '3 ...^...'), 11, 'a = caja azul ▲'), 12, 'T = camión muelle norte: azul / ▲ | libre + caja menta ▲');
    expect(level(free).storage![0].columns[1]).toEqual([null, null]);
    expect(formatLevel(text(free))).toBe(text(free));
    const bare = replace(replace(replace(NORTH, 8, '2 .a.....'), 9, '3 ...^.b.'), 11, 'a = caja azul ▲     b = caja menta ▲').map((l, i) =>
      i === 11 ? 'T = camión muelle norte: azul / ▲ | libre' : l,
    );
    expect(level(bare).storage![0].columns[1]).toEqual([null, null]);
    expect(formatLevel(text(bare))).toBe(text(bare));
    // «libre» under a level with a cue: the level to fix, in Spanish, at the column.
    const under = replace(NORTH, 12, 'T = camión muelle norte: azul / ▲ | libre / coral ◆');
    let error: LevelFormatError | null = null;
    try {
      parseLevel(text(under), 'x.level');
    } catch (e) {
      error = e as LevelFormatError;
    }
    expect(error).toBeInstanceOf(LevelFormatError);
    expect({ line: error!.line, column: error!.column }).toEqual({ line: 6, column: 6 });
    expect(error!.reason).toMatch(/^en un camión las cajas van una sobre otra, así que los niveles «libre» van arriba.*el nivel de arriba de la columna 2 del camión «T» pide algo y el de debajo es libre$/);
  });

  it('keeps the key order: `storage` right after `shelves`, its trucks right after its racks', () => {
    const level = parseLevel(text(MIXED)).level;
    expect(Object.keys(level)).toEqual(['id', 'order', 'name', 'size', 'forklift', 'boxes', 'zones', 'shelves', 'storage', 'decor', 'stackLimit', 'theme']);
    expect(storageOf(level).map((unit) => unit.skin)).toEqual(['rack', 'truck']);
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
