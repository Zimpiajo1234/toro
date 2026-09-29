import { describe, expect, it } from 'vitest';
import readme from '../../README.md?raw';
import levelsDoc from '../../docs/LEVELS.md?raw';
import level23 from './levels/level-23.level?raw';
import type { LevelData } from '../core/types';
import { LevelFormatError, arrowOf, formatLevel, parseLevel, renderLevel } from './asciiLevel';
import { formatRange, parseTargets, targetHolds, targetRefuted } from './difficulty';
import { loadLevelSources } from './levels';
import { validateLevel } from './validateLevel';

/** A small classic level; tests edit single lines of it (line numbers are 1-based, as in error messages). */
const BASE = [
  '# 1 · Base', //         1
  'id: base', //           2
  '', //                   3
  '  01234', //            4
  '0 p....', //            5
  '1 .1...', //            6
  '2 ...a.', //            7
  '3 ..^..', //            8
  '', //                   9
  '1 = zona azul', //      10
  'a = caja azul', //      11
];
const text = (lines: readonly string[]) => `${lines.join('\n')}\n`;
const replace = (line: number, content: string, lines: readonly string[] = BASE) => lines.map((l, i) => (i === line - 1 ? content : l));
const insert = (line: number, content: string, lines: readonly string[] = BASE) => [...lines.slice(0, line - 1), content, ...lines.slice(line - 1)];

function errorOf(lines: readonly string[] | string): LevelFormatError {
  try {
    parseLevel(typeof lines === 'string' ? lines : text(lines), 'x.level');
  } catch (e) {
    if (e instanceof LevelFormatError) return e;
    throw e;
  }
  throw new Error('expected a LevelFormatError');
}

function expectError(lines: readonly string[] | string, line: number, column: number, reason: RegExp) {
  const e = errorOf(lines);
  expect({ line: e.line, column: e.column, reason: e.reason }).toEqual({ line, column, reason: expect.stringMatching(reason) });
  expect(e.message).toBe(`x.level:${line}:${column}: ${e.reason}`);
}

const BASE_LEVEL: LevelData = {
  id: 'base',
  order: 1,
  name: 'Base',
  size: { width: 5, depth: 4 },
  forklift: { x: 2, z: 3, heading: 180 },
  boxes: [{ id: 'b1', color: 'blue', x: 3, z: 2, kind: 'standard' }],
  zones: [{ id: 'z1', color: 'blue', x: 1, z: 1 }],
  shelves: [],
  decor: { plants: [{ x: 0, z: 0, variant: 0 }], windows: [] },
  stackLimit: 1,
  theme: 'default',
};

/** Every stacking feature at once: recipes, a stacked start, a box on a zone, touching shelves, tiers, plant variants. */
const STACKS = [
  '# 7.5 · Todo junto',
  'id: todo-junto',
  'limit: 3',
  'ventanas: norte 4-5, oeste 2',
  '',
  '  012345678',
  '0 p##E.HH.p',
  '1 ...E.....',
  '2 ...1.2...',
  '3 .b.3...a.',
  '4 >...c...q',
  '',
  '1 = zona pila azul,menta     2 = zona coral + caja azul     3 = zona azul,amarillo',
  'a = pila menta,coral     b = caja azul     c = caja amarillo',
  'E = estantería     H = estantería de 3 alturas     q = planta variante 5',
];

const STACKS_LEVEL: LevelData = {
  id: 'todo-junto',
  order: 7.5,
  name: 'Todo junto',
  size: { width: 9, depth: 5 },
  forklift: { x: 0, z: 4, heading: 90 },
  boxes: [
    { id: 'b1', color: 'blue', x: 5, z: 2, kind: 'standard' },
    { id: 'b2', color: 'mint', x: 7, z: 3, kind: 'standard' },
    { id: 'b3', color: 'coral', x: 7, z: 3, kind: 'standard' },
    { id: 'b4', color: 'blue', x: 1, z: 3, kind: 'standard' },
    { id: 'b5', color: 'yellow', x: 4, z: 4, kind: 'standard' },
  ],
  zones: [
    { id: 'z1', color: 'blue', x: 3, z: 2, recipe: ['blue', 'mint'] },
    { id: 'z2', color: 'coral', x: 5, z: 2 },
    { id: 'z3', color: 'blue', x: 3, z: 3, recipe: ['blue', 'yellow'] },
  ],
  shelves: [
    { x: 1, z: 0, w: 2, d: 1, tiers: 2 },
    { x: 3, z: 0, w: 1, d: 2, tiers: 2 },
    { x: 5, z: 0, w: 2, d: 1, tiers: 3 },
  ],
  decor: {
    plants: [
      { x: 0, z: 0, variant: 0 },
      { x: 8, z: 0, variant: 1 },
      { x: 8, z: 4, variant: 5 },
    ],
    windows: [
      { wall: 'north', at: 4, width: 2 },
      { wall: 'west', at: 2, width: 1 },
    ],
  },
  stackLimit: 3,
  theme: 'default',
};

/** Sorting by symbol, written loosely: capitals, accents, words and glyphs, a glyph glued to its colour. */
const SYMBOLS = [
  '# 30 · Símbolos',
  'ID: simbolos',
  'Ventanas: Oeste 1-2',
  '',
  'p.......',
  '.1.2.3.4',
  '........',
  '..a.b.c.',
  '.d.....<',
  '',
  '1 = Zona AZUL    2 = zona ▲    3 = zona Menta ●     4 = zona Cruz',
  'a = caja azul',
  'b = caja lavanda triángulo    c = caja menta●',
  'd = caja coral ✚',
];

const SYMBOLS_LEVEL: LevelData = {
  id: 'simbolos',
  order: 30,
  name: 'Símbolos',
  size: { width: 8, depth: 5 },
  forklift: { x: 7, z: 4, heading: 270 },
  boxes: [
    { id: 'b1', color: 'blue', x: 2, z: 3, kind: 'standard' },
    { id: 'b2', color: 'lavender', symbol: 'triangle', x: 4, z: 3, kind: 'standard' },
    { id: 'b3', color: 'mint', symbol: 'circle', x: 6, z: 3, kind: 'standard' },
    { id: 'b4', color: 'coral', symbol: 'cross', x: 1, z: 4, kind: 'standard' },
  ],
  zones: [
    { id: 'z1', color: 'blue', x: 1, z: 1 },
    { id: 'z2', symbol: 'triangle', x: 3, z: 1 },
    { id: 'z3', color: 'mint', symbol: 'circle', x: 5, z: 1 },
    { id: 'z4', symbol: 'cross', x: 7, z: 1 },
  ],
  shelves: [],
  decor: { plants: [{ x: 0, z: 0, variant: 0 }], windows: [{ wall: 'west', at: 1, width: 2 }] },
  stackLimit: 1,
  theme: 'default',
};

describe('parseLevel: the format', () => {
  it('reads the title, header, numbered map and legend', () => {
    expect(parseLevel(text(BASE))).toStrictEqual({ level: BASE_LEVEL, targets: [], notes: [] });
  });

  it('reads stacks, recipes, a box on a zone, touching shelves as separate units, tiers and plant variants', () => {
    expect(parseLevel(text(STACKS)).level).toStrictEqual(STACKS_LEVEL);
  });

  it('is case- and accent-insensitive and takes symbol words or glyphs (glued or not)', () => {
    expect(parseLevel(text(SYMBOLS)).level).toStrictEqual(SYMBOLS_LEVEL);
    // Emoji-style glyphs carry a variation selector (U+FE0F): still a symbol.
    const emoji = SYMBOLS.map((l) => l.replace('caja coral ✚', 'caja coral ✚\uFE0F'));
    expect(parseLevel(text(emoji)).level).toStrictEqual(SYMBOLS_LEVEL);
  });

  it('rulers, row numbers, CRLF, a BOM and trailing spaces are optional noise', () => {
    const bare = ['# 1 · Base', 'id: base', 'p....', '.1...', '...a.', '..^..', '1 = zona azul', 'a = caja azul'];
    expect(parseLevel(text(bare)).level).toStrictEqual(BASE_LEVEL);
    expect(parseLevel(`\uFEFF${BASE.map((l) => `${l}   `).join('\r\n')}`).level).toStrictEqual(BASE_LEVEL);
    const noRuler = BASE.filter((l) => l !== '  01234');
    expect(parseLevel(text(noRuler)).level).toStrictEqual(BASE_LEVEL);
  });

  it('maps the four arrows to the headings used in the game (N = −z, E = +x, S = +z, W = −x)', () => {
    const heading = (arrow: string) => parseLevel(text(replace(8, `3 ..${arrow}..`))).level.forklift.heading;
    expect(['^', '>', 'v', '<'].map(heading)).toEqual([180, 90, 0, 270]);
    // The arrow drawn for any heading is its nearest cardinal direction.
    expect([0, 90, 180, 270, 360, -90, 44, 46, 225].map(arrowOf)).toEqual(['v', '>', '^', '<', 'v', '<', 'v', '>', '<']);
  });

  it('`rumbo:` sets any heading; the arrow shows the nearest direction', () => {
    const level = parseLevel(text(insert(3, 'rumbo: 100', replace(8, '3 ..>..')))).level;
    expect(level.forklift.heading).toBe(100);
    expect(renderLevel(level)).toContain('rumbo: 100');
    expect(parseLevel(renderLevel(level)).level).toStrictEqual(level);
  });

  it('keeps stackLimit, theme, windows, targets and notes', () => {
    const lines = insert(
      3,
      'límite: 1',
      insert(3, 'tema: nocturno', insert(3, 'ventanas: norte 1-3, oeste 2', insert(3, 'dificultad: extra>=2, bloqueos >= 1', insert(3, 'nota: una nota libre')))),
    );
    const parsed = parseLevel(text(lines));
    expect(parsed.level).toMatchObject({
      stackLimit: 1,
      theme: 'nocturno',
      decor: {
        windows: [
          { wall: 'north', at: 1, width: 3 },
          { wall: 'west', at: 2, width: 1 },
        ],
      },
    });
    expect(parsed.targets).toEqual([
      { metric: 'extra', op: '>=', value: 2 },
      { metric: 'bloqueos', op: '>=', value: 1 },
    ]);
    expect(parsed.notes).toEqual(['una nota libre']);
    const formatted = formatLevel(text(lines));
    expect(formatted).toContain('dificultad: extra>=2, bloqueos>=1\nnota: una nota libre\n');
    expect(parseLevel(formatted)).toStrictEqual(parsed);
  });

  it('a legend character may stand on several cells: its boxes / zones follow in reading order', () => {
    const lines = replace(7, '2 .a.a.', replace(6, '1 .1.1.'));
    const level = parseLevel(text(lines)).level;
    expect(level.zones.map((z) => [z.id, z.x, z.z])).toEqual([
      ['z1', 1, 1],
      ['z2', 3, 1],
    ]);
    expect(level.boxes.map((b) => [b.id, b.x, b.z])).toEqual([
      ['b1', 1, 2],
      ['b2', 3, 2],
    ]);
  });

  it('entries may share a line, share a description («1 2 = …») or have their own line', () => {
    const lines = [...replace(7, '2 ...ab', replace(6, '1 .12..')).slice(0, 9), '1 2 = zona azul    a b = caja azul'];
    const level = parseLevel(text(lines)).level;
    expect(level.zones.map((z) => z.id)).toEqual(['z1', 'z2']);
    expect(level.boxes.map((b) => [b.id, b.x])).toEqual([
      ['b1', 3],
      ['b2', 4],
    ]);
  });

  it('`zona azul,menta` is short for `zona pila azul,menta`; English colour and symbol ids work too', () => {
    const stacked = (legend: string) =>
      text(['# 1 · Base', 'id: base', 'limit: 2', '', 'p....', '.1...', '..ba.', '..^..', '', legend, 'a = caja azul']);
    const short = stacked('1 = zona azul,menta    b = caja mint');
    const long = stacked('1 = zona pila blue,mint    b = caja menta');
    expect(parseLevel(short).level).toStrictEqual(parseLevel(long).level);
    expect(parseLevel(short).level.zones[0]).toEqual({ id: 'z1', color: 'blue', x: 1, z: 1, recipe: ['blue', 'mint'] });
  });

  it('explicit ids «(…)» are kept, and rendered only when they differ from the generated ones', () => {
    const level = parseLevel(text(replace(11, 'a = caja azul (caja-grande)', replace(10, '1 = zona azul (z1)')))).level;
    expect(level.boxes[0].id).toBe('caja-grande');
    expect(level.zones[0].id).toBe('z1');
    const rendered = renderLevel(level);
    expect(rendered).toContain('caja azul (caja-grande)');
    expect(rendered).not.toContain('(z1)');
    expect(parseLevel(rendered).level).toStrictEqual(level);
  });
});

describe('renderLevel', () => {
  it('is canonical: parse(render(level)) is the level again, and rendering that gives the same text', () => {
    for (const level of [BASE_LEVEL, STACKS_LEVEL, SYMBOLS_LEVEL]) {
      const once = renderLevel(level);
      expect(parseLevel(once).level).toStrictEqual(level);
      expect(renderLevel(parseLevel(once).level)).toBe(once);
      expect(formatLevel(once)).toBe(once);
    }
  });

  it('draws touching shelves of one kind with different characters, tall shelves with a legend letter', () => {
    const rendered = renderLevel(STACKS_LEVEL);
    expect(rendered).toContain('0 p##E.HH.p');
    expect(rendered).toContain('E = estantería 2 alturas');
    expect(rendered).toContain('H = estantería 3 alturas');
  });

  it('writes glyphs, one entry per character in level order, and a canonical header', () => {
    expect(renderLevel(SYMBOLS_LEVEL)).toBe(
      text([
        '# 30 · Símbolos',
        'id: simbolos',
        'limit: 1',
        'ventanas: oeste 1-2',
        '',
        '  01234567',
        '0 p.......',
        '1 .1.2.3.4',
        '2 ........',
        '3 ..a.b.c.',
        '4 .d.....<',
        '',
        '1 = zona azul         2 = zona ▲            3 = zona menta ●      4 = zona ✚',
        'a = caja azul         b = caja lavanda ▲    c = caja menta ●      d = caja coral ✚',
      ]),
    );
  });

  it('a plant whose variant is not its position gets a legend letter', () => {
    const level: LevelData = { ...BASE_LEVEL, decor: { ...BASE_LEVEL.decor, plants: [{ x: 0, z: 0, variant: 2 }] } };
    const rendered = renderLevel(level);
    expect(rendered).toContain('0 P....');
    expect(rendered).toContain('P = planta variante 2');
    expect(parseLevel(rendered).level).toStrictEqual(level);
  });

  it('a crossing order (a zone holding a later box) keeps every id and cell, the box order follows the legend', () => {
    const level = validateLevel({
      id: 'cruce',
      order: 1,
      name: 'Cruce',
      size: { width: 6, depth: 4 },
      forklift: { x: 2, z: 3, heading: 180 },
      boxes: [
        { id: 'b1', color: 'blue', x: 3, z: 1 },
        { id: 'b2', color: 'mint', x: 1, z: 1 },
      ],
      zones: [
        { id: 'z1', color: 'blue', x: 1, z: 1 },
        { id: 'z2', color: 'mint', x: 3, z: 1 },
      ],
      shelves: [],
    });
    const parsed = parseLevel(renderLevel(level)).level;
    const byId = (l: LevelData) => [...l.boxes].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(parsed)).toStrictEqual(byId(level));
    expect({ ...parsed, boxes: [] }).toStrictEqual({ ...level, boxes: [] });
    expect(renderLevel(parsed)).toBe(renderLevel(level));
  });
});

describe('parseLevel: errors say file:line:column and what to do (Spanish)', () => {
  it('title and header', () => {
    expectError('', 1, 1, /vacío/);
    expectError(replace(1, 'Base'), 1, 1, /la primera línea es el título/);
    expectError(BASE.filter((l) => l !== 'id: base'), 1, 1, /falta «id: …»/);
    expectError(replace(2, 'idd: base'), 2, 1, /clave desconocida «idd».*¿quisiste decir «id»\?/);
    expectError(insert(3, 'id: otra'), 3, 1, /«id» repetido \(ya está en la línea 2\)/);
    expectError(insert(3, 'limit: 0'), 3, 8, /limit es la altura máxima de pila/);
    expectError(insert(3, 'ventanas: norte 3-7'), 3, 11, /no cabe: el muro norte tiene las casillas 0-4/);
    expectError(insert(3, 'ventanas: norte 1, sur 2'), 3, 20, /muro norte u oeste/);
    expectError(insert(3, 'dificultad: extra>=2, sabor>=1'), 3, 23, /métrica desconocida «sabor»/);
    expectError(insert(3, 'rumbo: 90'), 9, 5, /la flecha «\^» no encaja con «rumbo: 90»: dibuja «>»/);
  });

  it('map', () => {
    expectError(replace(6, '1 .1..x'), 6, 7, /«x» no está en la leyenda/);
    expectError(replace(7, '2 ...a'), 7, 7, /esta fila tiene 4 casillas y la primera 5/);
    expectError(replace(6, '5 .1...'), 6, 1, /fila numerada 5: se esperaba 1/);
    expectError(replace(6, '.1...'), 6, 1, /a esta fila le falta su número \(1\)/);
    expectError(replace(4, ' 01234'), 4, 2, /regla de columnas no está alineada/);
    expectError(replace(4, '  0123'), 4, 3, /la regla de columnas debería ser «01234»/);
    expectError(replace(5, '0 p..●.'), 5, 6, /«●» no vale en el mapa/);
    expectError(replace(6, '1 .1 ..'), 6, 5, /fila de mapa con espacios/);
    expectError(replace(8, '3 .....'), 5, 3, /falta la carretilla/);
    expectError(replace(8, '3 ..^.>'), 8, 7, /más de una carretilla/);
    expectError(replace(6, '1 .1#..', replace(5, '0 p##..')), 5, 4, /la estantería «#» que empieza aquí no es un rectángulo/);
    expectError([...BASE, 'p....'], 12, 1, /fila de mapa suelta/);
  });

  it('legend', () => {
    expectError([...BASE, 'b = caja menta'], 12, 1, /«b» está en la leyenda pero no en el mapa/);
    expectError([...BASE, 'a = caja menta'], 12, 1, /«a» ya está en la leyenda \(línea 11\)/);
    expectError(replace(11, 'p = caja azul'), 11, 1, /«p» ya significa algo en el mapa/);
    expectError(replace(11, 'ab = caja azul'), 11, 1, /entrada de leyenda mal formada/);
    expectError(replace(11, 'a = caja azu'), 11, 10, /palabra desconocida «azu» en una caja.*¿quisiste decir «azul»\?/);
    expectError(replace(11, 'a = cajon azul'), 11, 5, /«cajon» no es un elemento.*¿quisiste decir «caja»\?/);
    expectError(replace(11, 'a = caja ▲'), 11, 5, /falta el color de la caja/);
    expectError(replace(10, '1 = zona'), 10, 5, /la zona no pide nada/);
    expectError(replace(10, '1 = zona azul pila menta,azul'), 10, 5, /la zona es azul pero su pila empieza por menta/);
    expectError(replace(10, '1 = zona pila azul,▲'), 10, 20, /la pila de una zona es solo de colores/);
    expectError(replace(10, '1 = zona azul a = caja azul', BASE.slice(0, 10)), 10, 17, /separadas por dos espacios o más/);
    expectError(replace(11, 'a = caja azul (caja-x)', replace(7, '2 ..aa.')), 11, 1, /lleva un id propio y está en 2 casillas/);
    expectError([...replace(11, 'a = caja azul (b2)', replace(7, '2 .ba..')), 'b = caja azul'], 11, 15, /id repetido «b2»: también es el de la caja «b» \(línea 12\)/);
  });

  it('level rules (validateLevel), placed where the author has to fix them', () => {
    expectError([...replace(7, '2 .b.a.'), 'b = caja menta'], 12, 1, /sobran cajas menta/);
    expectError([...replace(6, '1 .12..'), '2 = zona coral'], 12, 1, /faltan cajas coral/);
    expectError(replace(10, '1 = zona azul + caja azul', replace(7, '2 .....').slice(0, 10)), 1, 1, /empieza ya resuelto/);
    const pile = replace(11, 'a = pila azul,azul', replace(10, '1 = zona azul    2 = zona azul', replace(6, '1 .1.2.')));
    expectError(insert(3, 'limit: 1', pile), 8, 6, /aquí empieza una pila, pero limit es 1/);
    expect(parseLevel(text(pile)).level.stackLimit).toBe(3); // without «limit», a stacked start means stacking (3)
    expectError(replace(11, 'a = caja azul ●', replace(10, '1 = zona ▲')), 7, 6, /no hay reparto completo: la caja «a» de esta casilla siempre se queda sin zona/);
    expectError(insert(3, 'limit: 9'), 3, 8, /limit va de 1 a 3/);
  });
});

describe('difficulty targets (dificultad:)', () => {
  it('parses metrics, comparisons and numbers, with aliases', () => {
    expect(parseTargets('extra>=2, bloqueos >= 1,mínimo≤12, libre>40.5, trampas=1')).toEqual([
      { metric: 'extra', op: '>=', value: 2 },
      { metric: 'bloqueos', op: '>=', value: 1 },
      { metric: 'movimientos', op: '<=', value: 12 },
      { metric: 'libre', op: '>', value: 40.5 },
      { metric: 'trampas', op: '=', value: 1 },
    ]);
    expect(() => parseTargets('extra>>2')).toThrow(/objetivo mal escrito/);
    expect(() => parseTargets('extra>=2,')).toThrow(/objetivo vacío/);
  });

  it('a target holds only when the measured range proves it', () => {
    const exact = { lower: 5, upper: 5 };
    const bound = { lower: 5, upper: Infinity };
    const t = (op: '>=' | '<=' | '=' | '>' | '<', value: number) => ({ metric: 'movimientos' as const, op, value });
    expect([t('>=', 5), t('>', 4), t('<=', 5), t('<', 6), t('=', 5)].map((x) => targetHolds(x, exact))).toEqual([true, true, true, true, true]);
    expect([t('>=', 5), t('<=', 9), t('=', 5)].map((x) => targetHolds(x, bound))).toEqual([true, false, false]);
    expect(targetHolds(t('>=', 0), { lower: Number.NaN, upper: Number.NaN })).toBe(false);
    expect([exact, bound, { lower: 3, upper: 7 }].map(formatRange)).toEqual(['5', '≥ 5', '≥ 3 (≤ 7)']);
    // Refuted: the range already rules it out (a target neither proven nor refuted needs more search).
    const range = { lower: 3, upper: 7 };
    expect([t('>=', 8), t('>=', 5), t('<=', 2), t('<=', 5), t('=', 9), t('=', 5)].map((x) => targetRefuted(x, range))).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
  });
});

describe('level registry loader', () => {
  const json = { ...BASE_LEVEL, id: 'legacy', order: 2, name: 'Legacy' };

  it('loads .level and .json files together, sorted by order', () => {
    const sources = loadLevelSources({ './b.level': text(BASE) }, { './a.json': json });
    expect(sources.map((s) => [s.file, s.format, s.level.id])).toEqual([
      ['src/data/levels/b.level', 'level', 'base'],
      ['src/data/levels/a.json', 'json', 'legacy'],
    ]);
    expect(sources[1].level).toStrictEqual(validateLevel(json));
  });

  it('rejects a repeated id or order across both formats, and names the files', () => {
    expect(() => loadLevelSources({ './b.level': text(BASE) }, { './a.json': { ...json, id: 'base' } })).toThrow(
      'Nivel repetido: el id «base» está en src/data/levels/b.level y en src/data/levels/a.json',
    );
    expect(() => loadLevelSources({ './b.level': text(BASE) }, { './a.json': { ...json, order: 1 } })).toThrow(
      'Orden repetido: 1 está en src/data/levels/b.level y en src/data/levels/a.json',
    );
  });

  it('parse errors carry the path of the file', () => {
    expect(() => loadLevelSources({ './mal.level': text(replace(6, '1 .1..x')) }, {})).toThrow(/^src\/data\/levels\/mal\.level:6:7: /);
  });
});

describe('documentation examples stay true', () => {
  const lf = (text: string) => text.replace(/\r\n/g, '\n');
  /** Fenced code blocks of a Markdown file, without the indentation of their fence. */
  const codeBlocks = (markdown: string) =>
    [...markdown.matchAll(/^( *)```[^\n]*\n([\s\S]*?)^\1```/gm)].map((m) =>
      m[2]
        .split('\n')
        .map((line) => line.slice(m[1].length))
        .join('\n'),
    );

  it('docs/LEVELS.md shows the real level 23 file', () => {
    const block = codeBlocks(lf(levelsDoc)).find((b) => b.startsWith('# 23 · La muestra'));
    expect(block).toBe(lf(level23));
  });

  it('the README example is a valid level', () => {
    const block = codeBlocks(lf(readme)).find((b) => b.startsWith('# 25 · Mi nivel'));
    expect(block).toBeDefined();
    expect(parseLevel(block!).level).toMatchObject({ id: 'mi-nivel', order: 25, size: { width: 7, depth: 5 } });
  });
});
