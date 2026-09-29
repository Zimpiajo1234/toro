/**
 * Integration check (racks × logic × controls): the autopilot (./autopilot.ts) plays small storage rack levels
 * (docs/RACKS.md) with the real GameState and the real controls — fork levels with InputFrame.forkStep (one press per
 * slot, like F / V), loads driven in straight and backed out in reverse — at 60 fps and at Game's worst dt (1/20).
 */
import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../core/types';
import { parseLevel } from '../data/asciiLevel';
import { LevelGrid, misplacedCount } from '../data/levels/solver';
import { GameState } from '../logic/GameState';
import { autopilot, liveStacks } from './autopilot';

const level = (text: string) => parseLevel(`${text.trim()}\n`, 'prueba.level').level;

/** Two boxes on the floor for a one-column rack: blue at the bottom, mint in the middle, a «libre» top. */
const BASIC = level(`
# 1 · Primera estantería
id: estanteria-basica
limit: 1

  0123456
0 ...R...
1 .......
2 .a...b.
3 .......
4 ...^...
5 p......

a = caja azul       b = caja menta
R = estantería frente sur: azul / menta / libre
`);

/** A two-column rack facing west with symbol cues, a floor zone and blue ● starting in the ▲ slot. */
const COLUMNS = level(`
# 2 · Dos columnas
id: estanteria-dos-columnas
limit: 1

  01234567
0 ........
1 ......R.
2 ......R.
3 .1......
4 ..a.b...
5 ....^...
6 ...c....

1 = zona ■
a = caja azul ▲        b = caja menta ▲       c = caja amarillo ■
R = estantería frente oeste: azul ● / ▲ + caja azul ● | menta ▲ / libre
`);

/** Two boxes swapped in one column (a «libre» slot on top to park one) and a floor stack to undo onto two zones. */
const SWAP = level(`
# 3 · Cambio en la estantería
id: estanteria-cambio
limit: 3

  012345678
0 ....R....
1 .........
2 .1.......
3 .........
4 .a...2...
5 .........
6 ....^....

1 = zona coral            2 = zona lavanda
a = pila lavanda,coral
R = estantería frente sur: menta + caja azul / azul + caja menta / libre
`);

/** Both slots take a ▲: the mint ▲ fits the bottom one, but its destiny is the exact «menta ▲» above it. */
const DECOY = level(`
# 4 · Encaja pero no brilla
id: encaja
limit: 1

  0123456
0 ...R...
1 .......
2 .a.....
3 .......
4 ...^.b.

a = caja menta ▲       b = caja azul ▲
R = estantería frente sur: ▲ / menta ▲
`);

type Dropped = Extract<GameEvent, { type: 'boxDropped' }>;
const drops = (events: readonly GameEvent[]) => events.filter((e): e is Dropped => e.type === 'boxDropped');

describe('rack levels are playable with the real controls', () => {
  for (const [label, dt] of [
    ['60 fps', 1 / 60],
    ['20 fps (Game dt clamp)', 1 / 20],
  ] as const) {
    it.each([BASIC, COLUMNS, SWAP, DECOY].map((l) => [l.id, l] as const))(`${label}: %s`, (_, lvl) => {
      const out = autopilot(lvl, dt);
      expect(out.note).toBe('');
      expect(out.solved).toBe(true);
      const grid = new LevelGrid(lvl);
      expect(out.moves).toBeGreaterThanOrEqual(misplacedCount(grid, liveStacks(grid, new GameState(lvl).getSnapshot()), lvl.boxes.length));
      // Slots were loaded, some above the bottom one (the forks stepped up with forkStep), and the level completed.
      const inSlots = drops(out.events).filter((d) => d.slotId !== undefined);
      expect(inSlots.length).toBeGreaterThan(0);
      expect(inSlots.every((d) => d.zoneId === null && d.recipeLength <= 1)).toBe(true);
      expect(out.events.filter((e) => e.type === 'levelComplete')).toHaveLength(1);
      for (const e of out.events) if (e.type === 'boxDropped' || e.type === 'boxPicked') expect(Number.isFinite(e.level)).toBe(true);
      // A box put on its destiny is locked: never picked up again.
      for (const d of drops(out.events).filter((x) => x.correct)) {
        const after = out.events.slice(out.events.indexOf(d) + 1);
        expect(after.some((e) => e.type === 'boxPicked' && e.boxId === d.boxId), d.boxId).toBe(false);
      }
    });
  }

  it('the rack levels use upper slots and take boxes out of slots', () => {
    const out = autopilot(COLUMNS, 1 / 60);
    expect(drops(out.events).some((d) => d.slotId !== undefined && d.level > 0)).toBe(true);
    expect(out.events.some((e) => e.type === 'boxPicked' && e.fromSlotId !== undefined)).toBe(true);
  });

  it.each([
    ['60 fps', 1 / 60],
    ['20 fps', 1 / 20],
  ] as const)('%s: recovers from a cue that fits but is not the destiny (the slot stays dark, the box moves on)', (_, dt) => {
    const grid = new LevelGrid(DECOY);
    const mint = DECOY.boxes.find((b) => b.color === 'mint')!;
    const out = autopilot(DECOY, dt, [{ from: grid.index(mint.x, mint.z), drop: grid.cellCount + 0 }]);
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    const all = drops(out.events);
    expect(all[0]).toMatchObject({ boxId: mint.id, slotId: 'r1:0:0', correct: false, wrongTarget: true });
    expect(all.filter((d) => d.boxId === mint.id).at(-1)).toMatchObject({ slotId: 'r1:0:1', correct: true });
    expect(out.moves).toBeGreaterThanOrEqual(DECOY.boxes.length + 1);
  });
});
