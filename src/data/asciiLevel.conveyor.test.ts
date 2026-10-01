import { describe, expect, it } from 'vitest';
import conveyorDoc from '../../docs/CONVEYOR.md?raw';
import { conveyorsOf } from '../core/conveyors';
import { storageOf } from '../core/storage';
import type { LevelData } from '../core/types';
import { LevelFormatError, formatLevel, parseLevel, parseLevelDraft, renderLevel } from './asciiLevel';

/*
 * Conveyor belts in the .level format (docs/CONVEYOR.md «Gramática»): «A = cinta entrada» (its input, «libre»),
 * «B = cinta final: pista» (its end exit) and «~ = cinta» (its cells), in one straight line on the map: the input just
 * past one end of the run, the end exit just past the other. A belt's id goes in parentheses on either end («cinta
 * entrada (c7)»); without one, c1, c2… by the order of their inputs. The input and the end exit are storage units of
 * skins beltIn and beltOut, both facing away from the belt.
 *
 * The grammar is tested on the draft (parseLevelDraft: before validateLevel); validateLevel's belt messages follow,
 * re-worded in Spanish by parseLevel at the place to fix.
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

function errorOf(run: () => unknown): LevelFormatError {
  try {
    run();
  } catch (e) {
    if (e instanceof LevelFormatError) return e;
    throw e;
  }
  throw new Error('expected a LevelFormatError');
}

/** A grammar or map error (the draft), at line:column of the text. */
function expectError(lines: readonly string[], line: number, column: number, reason: RegExp) {
  const e = errorOf(() => draftOf(lines));
  expect({ line: e.line, column: e.column, reason: e.reason }).toEqual({ line, column, reason: expect.stringMatching(reason) });
  expect(e.message).toBe(`x.level:${line}:${column}: ${e.reason}`);
}

/** A validateLevel error (parseLevel), at line:column of the text. */
function expectInvalid(lines: readonly string[], line: number, column: number, reason: RegExp) {
  const e = errorOf(() => parseLevel(text(lines), 'x.level'));
  expect({ line: e.line, column: e.column, reason: e.reason }).toEqual({ line, column, reason: expect.stringMatching(reason) });
}

/** The map cell x,z of these levels in error positions: rows from line 6, cells from column 3. */
const at = (x: number, z: number) => [6 + z, 3 + x] as const;

/** A belt along the west wall: input A (0,2) → one floor cell (0,1) → end exit B (0,0), asking for blue. */
const BASE = [
  '# 1 · Una cinta', //                                              1
  'id: una-cinta', //                                                2
  'limit: 1', //                                                     3
  '', //                                                             4
  '  0123456', //                                                    5
  '0 B......', //                                                    6
  '1 ~......', //                                                    7
  '2 A..a.1.', //                                                    8
  '3 ...^.b.', //                                                    9
  '', //                                                             10
  '1 = zona menta', //                                               11
  'a = caja azul ●          b = caja menta ▲', //                    12
  'A = cinta entrada        B = cinta final: azul    ~ = cinta', //  13
];
const LEGEND = 13;
const legend = (content: string) => replace(BASE, LEGEND, content);
/** The column of `part` in a line (1-based). */
const columnOf = (line: string, part: string, from = 0) => line.indexOf(part, from) + 1;

/** Two belts side by side (inputs A and D, end exits B and E), each with its box. */
const TWO = [
  '# 2 · Dos cintas',
  'id: dos-cintas',
  'limit: 1',
  '',
  '  0123456',
  '0 B....E.',
  '1 ~....~.',
  '2 A....Dc',
  '3 .a.^...',
  '',
  'a = caja azul ●     c = caja menta ▲',
  'A = cinta entrada   B = cinta final: azul   D = cinta entrada   E = cinta final: menta   ~ = cinta',
];

describe('conveyor belts in the .level format', () => {
  it('reads a belt: its input and end exit units (skins beltIn, beltOut: facing away from the belt) and its cells', () => {
    const level = levelOf(BASE);
    expect(storageOf(level)).toStrictEqual([
      { id: 'e1', skin: 'beltIn', x: 0, z: 2, w: 1, access: { kind: 'front', facing: 'south' }, columns: [[null]] },
      { id: 's1', skin: 'beltOut', x: 0, z: 0, w: 1, access: { kind: 'belt', facing: 'south' }, columns: [[{ color: 'blue' }]] },
    ]);
    // A floor belt is a table at level 1 (H1b): the grammar has no heights, its cells get it (and validateLevel gives
    // its two ends that base level).
    expect(conveyorsOf(level)).toStrictEqual([{ id: 'c1', input: 'e1', output: 's1', cells: [{ x: 0, z: 1, piece: 'suelo', height: 1 }] }]);
    // The level validates as written, and comes back as it is.
    const valid = parseLevel(text(BASE), 'x.level').level;
    expect(conveyorsOf(valid)).toEqual(conveyorsOf(level));
    expect(parseLevel(renderLevel(valid), 'x.level').level).toStrictEqual(valid);
    // «cinta suelo» is «cinta»; «libre» is a cue an end exit may give.
    expect(conveyorsOf(levelOf(legend('A = cinta entrada   B = cinta final: azul   ~ = cinta suelo')))).toEqual(conveyorsOf(level));
    expect(storageOf(levelOf(legend('A = cinta entrada   B = cinta final: libre   ~ = cinta')))[1].columns).toEqual([[null]]);
  });

  it('a longer belt, either way along a row: its cells listed from the input on, both ends facing away from it', () => {
    const map = (row: string) => [...BASE.slice(0, 5), '0 .......', `1 ${row}`, '2 ...a.1.', '3 ...^.b.', ...BASE.slice(9)];
    const east = levelOf(map('.A~~~B.'));
    expect(storageOf(east).map((u) => [u.id, u.x, u.z, u.access])).toEqual([
      ['e1', 1, 1, { kind: 'front', facing: 'west' }],
      ['s1', 5, 1, { kind: 'belt', facing: 'west' }],
    ]);
    expect(conveyorsOf(east)[0].cells.map((c) => [c.x, c.z])).toEqual([
      [2, 1],
      [3, 1],
      [4, 1],
    ]);
    const west = levelOf(map('.B~~~A.'));
    expect(storageOf(west).map((u) => [u.id, u.x, u.access])).toEqual([
      ['e1', 5, { kind: 'front', facing: 'east' }],
      ['s1', 1, { kind: 'belt', facing: 'east' }],
    ]);
    expect(conveyorsOf(west)[0].cells.map((c) => c.x)).toEqual([4, 3, 2]);
  });

  it('several belts: c1, c2… by the order of their inputs; an id in parentheses on either end names its belt', () => {
    const two = levelOf(TWO);
    expect(conveyorsOf(two).map((c) => [c.id, c.input, c.output])).toEqual([
      ['c1', 'e1', 's1'],
      ['c2', 'e2', 's2'],
    ]);
    expect(storageOf(two).map((u) => [u.id, u.x, u.columns])).toEqual([
      ['e1', 0, [[null]]],
      ['e2', 5, [[null]]],
      ['s1', 0, [[{ color: 'blue' }]]],
      ['s2', 5, [[{ color: 'mint' }]]],
    ]);
    // Two belts may share their legend entries: one belt each connected run.
    const shared = levelOf([...TWO.slice(0, 5), '0 B....B.', '1 ~....~.', '2 A....Ac', ...TWO.slice(8, 11), 'A = cinta entrada   B = cinta final: azul   ~ = cinta']);
    expect(conveyorsOf(shared).map((c) => [c.id, c.input, c.output, c.cells[0].x])).toEqual([
      ['c1', 'e1', 's1', 0],
      ['c2', 'e2', 's2', 5],
    ]);
    // An id on the input or on the end exit; the canonical form writes it on the input.
    const named = legend('A = cinta entrada   B = cinta final (c7): azul   ~ = cinta');
    expect(conveyorsOf(levelOf(named)).map((c) => c.id)).toEqual(['c7']);
    const canonical = formatLevel(text(named));
    expect(canonical.split('\n')).toContain('A = cinta entrada (c7)    B = cinta final: azul     ~ = cinta');
    expect(parseLevel(canonical).level).toStrictEqual(parseLevel(text(named)).level);
    expect(conveyorsOf(levelOf(legend('A = cinta entrada (c7)   B = cinta final (c7): azul   ~ = cinta'))).map((c) => c.id)).toEqual(['c7']);
    // The generated id is never written.
    expect(formatLevel(text(legend('A = cinta entrada (c1)   B = cinta final: azul   ~ = cinta')))).toBe(text(BASE));
  });

  it('the canonical form: «~» for every floor belt cell, the ends in their skin letters, «~ = cinta» after them; formatLevel is idempotent', () => {
    expect(formatLevel(text(BASE))).toBe(text(BASE));
    // Another belt character and other letters for its ends give the same level, written the canonical way.
    const other = [
      ...BASE.slice(0, 5),
      '0 X......',
      '1 -......',
      '2 Y..a.1.',
      ...BASE.slice(8, 12),
      'Y = cinta entrada   X = cinta final: azul   - = cinta',
    ];
    expect(formatLevel(text(other))).toBe(text(BASE));
    expect(parseLevel(text(other)).level).toStrictEqual(parseLevel(text(BASE)).level);
    const twice = formatLevel(text(TWO));
    expect(formatLevel(twice)).toBe(twice);
    expect(parseLevel(twice).level).toStrictEqual(parseLevel(text(TWO)).level);
  });

  it('docs/CONVEYOR.md: its example parses, validates and is canonical', () => {
    const blocks = [...conveyorDoc.replace(/\r\n/g, '\n').matchAll(/^```\n([\s\S]*?)^```/gm)].map((m) => m[1]);
    const example = blocks.find((b) => b.startsWith('# '));
    expect(example).toBeDefined();
    const level = parseLevel(example!).level;
    expect(conveyorsOf(level).length).toBeGreaterThan(0);
    expect(renderLevel(level)).toBe(example);
  });
});

describe('belt grammar errors (Spanish, file:line:column)', () => {
  it('an input asks for nothing; an end exit asks for one cue, after a colon; belts start empty', () => {
    const input = 'A = cinta entrada: azul   B = cinta final: azul   ~ = cinta';
    expectError(legend(input), LEGEND, columnOf(input, ':'), /^la entrada de la cinta no pide nada \(es «libre»\): se escribe «A = cinta entrada»$/);
    const box = 'A = cinta entrada + caja azul   B = cinta final: azul   ~ = cinta';
    expectError(legend(box), LEGEND, columnOf(box, '+'), /^«\+» sobra: la entrada se escribe «cinta entrada»/);
    const noColon = 'A = cinta entrada   B = cinta final   ~ = cinta';
    expectError(legend(noColon), LEGEND, columnOf(noColon, 'final'), /^después de «cinta final» van dos puntos y su pista/);
    const noCue = 'A = cinta entrada   B = cinta final:   ~ = cinta';
    expectError(legend(noCue), LEGEND, columnOf(noCue, ':'), /^falta la pista de la salida final de la cinta/);
    const two = 'A = cinta entrada   B = cinta final: azul / ■   ~ = cinta';
    expectError(legend(two), LEGEND, columnOf(two, '/'), /^la salida final de una cinta pide una sola pista$/);
    const loaded = 'A = cinta entrada   B = cinta final: azul + caja azul ●   ~ = cinta';
    expectError(legend(loaded), LEGEND, columnOf(loaded, '+'), /^la cinta empieza vacía/);
  });

  it('parts not built yet: side exits come later; an unknown word suggests the closest', () => {
    const side = 'A = cinta entrada   B = cinta final: azul   ~ = cinta   S = cinta salida';
    expectError(legend(side), LEGEND, columnOf(side, 'salida'), /^las salidas laterales de la cinta llegan en el siguiente hito/);
    const typo = 'A = cinta entrada   B = cinta final: azul   ~ = cinta rampaa';
    expectError(legend(typo), LEGEND, columnOf(typo, 'rampaa'), /^«rampaa» no es una pieza de cinta: .*rampa/);
    const button = 'A = cinta entrada   B = cinta final: azul   ~ = cinta   K = cinta botom';
    expectError(legend(button), LEGEND, columnOf(button, 'botom'), /^«botom» no es una pieza de cinta: .*¿quisiste decir «botón»\?$/);
  });

  it('a belt is one straight run with its input past one end and its end exit past the other, in line', () => {
    const map = (rows: readonly string[]) => [...BASE.slice(0, 5), ...rows, ...BASE.slice(9)];
    // Bent: the run is not a line.
    expectError(map(['0 B......', '1 ~~.....', '2 A~.a.1.', '3 ...^.b.']), ...at(0, 1), /^la cinta «~» que empieza aquí no es recta/);
    // No input, or no end exit, touching it.
    expectError(map(['0 B.....A', '1 ~......', '2 ...a.1.', '3 ...^.b.']), ...at(0, 1), /^la cinta «~» que empieza aquí no tiene entrada/);
    expectError(map(['0 ......B', '1 ~......', '2 A..a.1.', '3 ...^.b.']), ...at(0, 1), /^la cinta «~» que empieza aquí no tiene salida final/);
    expectError(map(['0 B......', '1 ~A.....', '2 A..a.1.', '3 ...^.b.']), ...at(0, 1), /^la cinta «~» que empieza aquí toca 2 entradas/);
    // An input beside a run, not at its end; an end exit not in line with it.
    expectError(map(['0 .B.....', '1 ~~.....', '2 A..a.1.', '3 ...^.b.']), ...at(0, 2), /^esta entrada de cinta va en línea con su cinta, pegada a uno de sus extremos/);
    expectError(map(['0 .......', '1 ~B.....', '2 A..a.1.', '3 ...^.b.']), ...at(1, 1), /^esta salida final de cinta va en línea con su cinta, pegada a su otro extremo/);
    // An end touching no belt.
    expectError(map(['0 B.....A', '1 ~......', '2 A..a.1.', '3 ...^.b.']), ...at(6, 0), /^esta entrada de cinta \(«A»\) no toca ninguna casilla de cinta/);
  });

  it('ids: one per belt, the same on both ends', () => {
    const differ = 'A = cinta entrada (c7)   B = cinta final (c8): azul   ~ = cinta';
    expectError(legend(differ), LEGEND, columnOf(differ, '(c8)'), /^la entrada y la salida final de una cinta llevan el mismo id: aquí «c8» y en su entrada «c7»/);
    // An id on an entry two belts use names neither.
    const shared = [...TWO.slice(0, 5), '0 B....B.', '1 ~....~.', '2 A....Ac', ...TWO.slice(8, 11), 'A = cinta entrada (c7)   B = cinta final: azul   ~ = cinta'];
    expectError(shared, 12, columnOf(shared[11], '(c7)'), /^«A» lleva un id de cinta y está en 2 cintas/);
    const twice = [...TWO.slice(0, 11), 'A = cinta entrada (c7)   B = cinta final: azul   D = cinta entrada (c7)   E = cinta final: menta   ~ = cinta'];
    expectError(twice, 12, columnOf(twice[11], '(c7)', 30), /^id de cinta repetido «c7»/);
  });
});

/**
 * BASE with the belt's button (H2) at (1,2), east of A: «o = cinta botón» (canonical: after «~ = cinta», in its
 * column).
 */
const WITH_BUTTON = [
  ...replace(BASE, 8, '2 Ao.a.1.').slice(0, LEGEND - 1),
  `A = cinta entrada        B = cinta final: azul    ~ = cinta${' '.repeat(16)}o = cinta botón`,
];

describe('a belt\'s button in the .level format (H2)', () => {
  it('reads a button: «cinta botón» on a cell of its own, the belt\'s (the only one: no id needed)', () => {
    const level = levelOf(WITH_BUTTON);
    expect(conveyorsOf(level)).toStrictEqual([{ id: 'c1', input: 'e1', output: 's1', cells: [{ x: 0, z: 1, piece: 'suelo', height: 1 }], button: { x: 1, z: 2 } }]);
    // It validates (an obstacle with a free side to be pressed from) and comes back as it is.
    const valid = parseLevel(text(WITH_BUTTON), 'x.level').level;
    expect(conveyorsOf(valid)[0].button).toEqual({ x: 1, z: 2 });
    expect(parseLevel(renderLevel(valid), 'x.level').level).toStrictEqual(valid);
    // «button», any letter, the id of its belt: the same level.
    const other = [...WITH_BUTTON.slice(0, LEGEND - 1), 'A = cinta entrada   B = cinta final: azul   ~ = cinta   k = cinta button (c1)'].map((l, i) => (i === 7 ? '2 Ak.a.1.' : l));
    expect(parseLevel(text(other), 'x.level').level).toStrictEqual(valid);
  });

  it('the canonical form writes it «o = cinta botón» after the belt\'s other pieces, its id only with several belts; formatLevel is idempotent', () => {
    const canonical = formatLevel(text(WITH_BUTTON));
    expect(canonical).toBe(text(WITH_BUTTON));
    const other = [...WITH_BUTTON.slice(0, LEGEND - 1), 'A = cinta entrada   B = cinta final: azul   ~ = cinta   k = cinta botón (c1)'].map((l, i) => (i === 7 ? '2 Ak.a.1.' : l));
    expect(formatLevel(text(other))).toBe(canonical);
    // Two belts: each button names its belt.
    const two = [...TWO.slice(0, 7), '2 A...oDc', ...TWO.slice(8, 11), 'A = cinta entrada   B = cinta final: azul   D = cinta entrada   E = cinta final: menta   ~ = cinta   o = cinta botón (c2)'];
    const level = parseLevel(text(two), 'x.level').level;
    expect(conveyorsOf(level).map((c) => [c.id, c.button])).toEqual([
      ['c1', undefined],
      ['c2', { x: 4, z: 2 }],
    ]);
    const written = formatLevel(text(two));
    expect(written).toMatch(/o = cinta botón \(c2\)\n$/);
    expect(formatLevel(written)).toBe(written);
    expect(parseLevel(written).level).toStrictEqual(level);
  });

  it('errors: several belts and no id, an id no belt has, two buttons for one belt, a button with no belt, words after it', () => {
    const twoBelts = [...TWO.slice(0, 7), '2 A...oDc', ...TWO.slice(8, 11), 'A = cinta entrada   B = cinta final: azul   D = cinta entrada   E = cinta final: menta   ~ = cinta   o = cinta botón'];
    expectError(twoBelts, 12, columnOf(twoBelts[11], 'o = '), /^hay 2 cintas: el botón lleva el id de la suya, p\. ej\. «o = cinta botón \(c1\)»$/);
    const unknown = [...WITH_BUTTON.slice(0, LEGEND - 1), 'A = cinta entrada   B = cinta final: azul   ~ = cinta   o = cinta botón (c9)'];
    expectError(unknown, LEGEND, columnOf(unknown[LEGEND - 1], '(c9)'), /^ninguna cinta lleva el id «c9»: el botón lleva el id de su cinta \(aquí «c1»\)$/);
    const twice = WITH_BUTTON.map((l, i) => (i === 8 ? '3 o..^.b.' : l));
    expectError(twice, ...at(0, 3), /^la cinta «c1» ya lleva un botón \(en la 1,2\): una cinta lleva uno como mucho$/);
    const alone = ['# 1 · Sin cinta', 'id: sin-cinta', 'limit: 1', '', '  012', '0 o..', '1 a1^', '2 ...', '', '1 = zona azul', 'a = caja azul', 'o = cinta botón'];
    expectError(alone, 12, 1, /^el botón «o» no tiene cinta: un botón va con su cinta/);
    const extra = [...WITH_BUTTON.slice(0, LEGEND - 1), 'A = cinta entrada   B = cinta final: azul   ~ = cinta   o = cinta botón azul'];
    expectError(extra, LEGEND, columnOf(extra[LEGEND - 1], 'azul', columnOf(extra[LEGEND - 1], 'botón')), /^«azul» sobra: el botón de una cinta se escribe «cinta botón»/);
  });

  it('validateLevel, in Spanish at the button: it needs a free floor cell beside it to be pressed from', () => {
    // Shut in: the wall north, A west, plants east and south.
    const shut = [...BASE.slice(0, 5), '0 Bop....', '1 ~p.....', '2 A..a.1.', '3 ...^.b.', '', ...BASE.slice(10, 12), 'A = cinta entrada        B = cinta final: azul    ~ = cinta    o = cinta botón'];
    expectInvalid(shut, ...at(1, 0), /^el botón de la cinta se pulsa de frente desde una casilla de suelo a su lado, y no le queda ninguna libre/);
  });
});

describe('validateLevel belt messages, in Spanish at the place to fix', () => {
  it('a ramp or ceiling piece: not built yet (the data already names it), at its legend entry', () => {
    for (const [piece, words] of [
      ['rampa', 'en rampa'],
      ['techo', 'de techo'],
    ]) {
      const line = `A = cinta entrada   B = cinta final: azul   ~ = cinta ${piece}`;
      expect(conveyorsOf(levelOf(legend(line)))[0].cells[0].piece).toBe(piece);
      expectInvalid(legend(line), LEGEND, columnOf(line, '~'), new RegExp(`^la cinta ${words} llega más adelante: por ahora solo se construye la cinta de suelo`));
    }
  });

  it('an input with no room in front: at the input', () => {
    expectInvalid(replace(BASE, 9, '3 p..^.b.'), ...at(0, 2), /^la entrada de cinta «A» se carga por delante, por el lado contrario a su cinta, y esa casilla \(la 0,3\) es una pared/);
    // Against a wall: its front is outside.
    const south = [...BASE.slice(0, 5), '0 A......', '1 ~......', '2 B..a.1.', ...BASE.slice(8)];
    expectInvalid(south, ...at(0, 0), /^la entrada de cinta «A» se carga por delante.*\(la 0,-1\)/);
  });

  it('one box per target, counting the end exits with a cue; the assignment, naming the end exit', () => {
    expectInvalid(replace(replace(BASE, 9, '3 ...^.bc'), 12, 'a = caja azul ●     b = caja menta ▲     c = caja coral ◆'), 1, 1, /hay 3 cajas para 1 zonas, 0 huecos con pista, 0 niveles de camión con pista y 1 salidas de cinta con pista/);
    expectInvalid(legend('A = cinta entrada   B = cinta final: coral   ~ = cinta'), ...at(3, 2), /^no hay reparto completo: la caja «a» de esta casilla siempre se queda sin zona, hueco ni salida de cinta que la acepte$/);
    const shared = [...TWO.slice(0, 5), '0 B....B.', '1 ~....~.', '2 A....Ac', TWO[8], '', 'a = caja azul ●     c = caja azul ■', 'A = cinta entrada   B = cinta final: azul   ~ = cinta'];
    expectInvalid(shared, ...at(0, 0), /^hay más de un reparto: la salida final de cinta «B» puede llevar la caja azul ● o la azul ■/);
  });
});
