import { describe, expect, it, vi } from 'vitest';
import { LevelFormatError, parseLevel } from './asciiLevel';

/*
 * The English messages validateLevel gives for trucks (docs/DOCKS.md «Validación»), re-worded in Spanish by parseLevel
 * at the place to fix. validateLevel is replaced here by one that throws the message under test, so this pins the
 * contract on the parser's side whatever validateLevel does today.
 */

const thrown = vi.hoisted(() => ({ message: '' }));
vi.mock('./validateLevel', () => ({
  validateLevel: (_raw: unknown, source: string) => {
    throw new Error(`[${source}] ${thrown.message}`);
  },
}));

const LINES = [
  '# 1 · Un camión', //                                             1
  'id: un-camion', //                                               2
  'limit: 2', //                                                    3
  'ventanas: norte 2-3', //                                         4
  '', //                                                            5
  '  0123456', //                                                   6
  '0 ..TT...', //                                                   7
  '1 .......', //                                                   8
  '2 .a...b.', //                                                   9
  '3 ...^...', //                                                   10
  '', //                                                            11
  'a = caja azul ▲     b = caja coral ◆', //                        12
  'T = camión muelle norte: azul / ▲ | coral ◆ + caja menta ▲', //  13
];

function explained(message: string): { line: number; column: number; reason: string } {
  thrown.message = message;
  try {
    parseLevel(`${LINES.join('\n')}\n`, 'x.level');
  } catch (e) {
    if (!(e instanceof LevelFormatError)) throw e;
    return { line: e.line, column: e.column, reason: e.reason };
  }
  throw new Error('expected a LevelFormatError');
}

describe('validateLevel truck messages, in Spanish at the place to fix', () => {
  it('a truck wider than 3 columns: points at the truck', () => {
    expect(explained('trucks[0] has 4 columns, more than 3: its dock door is 1 to 3 cells wide')).toEqual({
      line: 7,
      column: 5,
      reason: expect.stringMatching(/^el camión «T» tiene 4 columnas y lleva como mucho 3: su puerta mide de 1 a 3 casillas; quítale columnas o usa dos camiones$/),
    });
  });

  it('a column taller than the stack limit', () => {
    expect(explained('trucks[0].columns[0] has 2 levels, more than stackLimit 1')).toEqual({
      line: 7,
      column: 5,
      reason: expect.stringMatching(/esta columna del camión «T» tiene 2 niveles y limit es 1/),
    });
  });

  it('a window on the dock door: points at «ventanas»', () => {
    expect(explained('decor.windows[0] overlaps the dock door of trucks[0]')).toEqual({
      line: 4,
      column: 11,
      reason: expect.stringMatching(/una ventana choca con la puerta del muelle del camión «T»/),
    });
  });

  it('no static obstacle beside the door (its guard rail stands there), or another door there: points at that cell', () => {
    expect(explained('trucks[0] needs a static obstacle beside its dock door at 1,0 (a plant, a shelf or a rack): its guard rail stands there')).toEqual({
      line: 7,
      column: 4,
      reason: expect.stringMatching(
        /^junto a la puerta del camión «T» va una barandilla naranja \(sale sola, no se escribe\) y esta casilla, detrás de ella a lo largo del muro, tiene que ser un obstáculo fijo: pon una planta «p» \(o una estantería\)$/,
      ),
    });
    expect(
      explained('trucks[0] needs a static obstacle beside its dock door at 4,0 for its guard rail, but that is the dock door of trucks[1]: leave a cell with an obstacle between two dock doors'),
    ).toEqual({ line: 7, column: 7, reason: expect.stringMatching(/^dos puertas de muelle no van pegadas: .*deja entre las dos una casilla con una planta «p»$/) });
  });

  it('a truck box with nothing below it: points at the box', () => {
    expect(explained('box "b3" is on trucks[0] column 1 at level 1 with no box below it')).toEqual({
      line: 7,
      column: 6,
      reason: expect.stringMatching(/no tiene nada debajo/),
    });
  });

  it('one box per target, counting truck levels', () => {
    expect(explained('a level with storage racks or trucks needs one box per target (3 boxes, 0 zones, 0 slots with a cue, 3 truck levels)')).toEqual({
      line: 1,
      column: 1,
      reason: expect.stringMatching(/hay 3 cajas para 0 zonas, 0 huecos con pista y 3 niveles de camión/),
    });
  });

  it('assignments: none, or more than one on a truck level', () => {
    expect(explained('more than one complete assignment: trucks[0].columns[0][1] may take blue/triangle or mint/triangle')).toEqual({
      line: 7,
      column: 5,
      reason: expect.stringMatching(/^hay más de un reparto: el nivel de arriba de la columna 1 del camión «T» puede llevar la caja azul ▲ o la menta ▲/),
    });
    expect(explained('no complete assignment exists: box "b1" is always left without a zone or slot')).toEqual({
      line: 9,
      column: 4,
      reason: expect.stringMatching(/sin zona, hueco ni nivel de camión que la acepte/),
    });
  });
});
