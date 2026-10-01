import { describe, expect, it } from 'vitest';
import type { GameEvent, InputFrame } from '../core/types';
import { parseLevel } from '../data/asciiLevel';
import { GameState } from './GameState';
import { DT, IDLE, makeLevel, move, press, run } from './testUtils';

/*
 * The move counter (GameSnapshot.moves): one per box picked up and put down somewhere else, the solver's «movimientos»
 * criterion; a box put back exactly where it was picked up (same cell and height, same rack slot) counts nothing.
 */

type Dropped = Extract<GameEvent, { type: 'boxDropped' }>;
type Picked = Extract<GameEvent, { type: 'boxPicked' }>;
const dropped = (events: readonly GameEvent[]) => events.find((e): e is Dropped => e.type === 'boxDropped');
const picked = (events: readonly GameEvent[]) => events.find((e): e is Picked => e.type === 'boxPicked');

/** Forklift at (1,2) facing +x, the box right ahead at (2,2), its zone far away (no zone magnet near the box). */
const ROW = makeLevel({
  forklift: { x: 1, z: 2, heading: 90 },
  boxes: [{ id: 'b', color: 'blue', x: 2, z: 2 }],
  zones: [{ id: 'z', color: 'blue', x: 6, z: 0 }],
});

describe('move counter', () => {
  it('starts at 0 on every fresh state (level load, restart)', () => {
    const state = new GameState(ROW);
    expect(state.getSnapshot().moves).toBe(0);
    press(state);
    run(state, 0.6, move(1, 0));
    press(state);
    expect(state.getSnapshot().moves).toBe(1);
    expect(new GameState(ROW).getSnapshot().moves).toBe(0);
  });

  it('a pick alone counts nothing; putting the box down somewhere else counts one, already on its boxDropped', () => {
    const state = new GameState(ROW);
    const snap = state.getSnapshot();
    expect(picked(press(state))).toMatchObject({ boxId: 'b' });
    expect(snap.moves).toBe(0);
    run(state, 0.6, move(1, 0));
    run(state, 1, IDLE);
    expect(snap.hint.dropCell).not.toEqual({ x: 2, z: 2 });
    expect(snap.moves).toBe(0);
    // Counted before the event is emitted: a consumer reading the snapshot on boxDropped sees the new count.
    let seen = -1;
    for (const e of press(state)) if (e.type === 'boxDropped') seen = snap.moves;
    expect(seen).toBe(1);
    expect(snap.moves).toBe(1);
  });

  it('putting a box back where it was picked up is no move, however often', () => {
    const state = new GameState(ROW);
    const snap = state.getSnapshot();
    for (let i = 0; i < 3; i++) {
      expect(picked(press(state))).toMatchObject({ boxId: 'b' });
      expect(dropped(press(state))).toMatchObject({ boxId: 'b', cell: { x: 2, z: 2 }, level: 0 });
      run(state, 0.2, IDLE);
    }
    expect(snap.moves).toBe(0);
    // A real move after them still counts one.
    press(state);
    run(state, 0.6, move(1, 0));
    run(state, 1, IDLE);
    press(state);
    expect(snap.moves).toBe(1);
  });

  it('stacks: the top box put back on its stack is no move; on the floor beside it, one', () => {
    const state = new GameState(
      makeLevel({
        forklift: { x: 1, z: 2, heading: 90 },
        boxes: [
          { id: 'a', color: 'blue', x: 2, z: 2 },
          { id: 'b', color: 'mint', x: 2, z: 2 },
        ],
        zones: [
          { id: 'za', color: 'blue', x: 6, z: 0 },
          { id: 'zb', color: 'mint', x: 6, z: 4 },
        ],
      }),
    );
    const snap = state.getSnapshot();
    run(state, 1, IDLE); // the forks rise to the top box
    expect(picked(press(state))).toMatchObject({ boxId: 'b', level: 1 });
    expect(dropped(press(state))).toMatchObject({ boxId: 'b', cell: { x: 2, z: 2 }, level: 1 });
    expect(snap.moves).toBe(0);
    run(state, 1, IDLE);
    expect(picked(press(state))).toMatchObject({ boxId: 'b', level: 1 });
    run(state, 0.6, move(0, 1));
    run(state, 1, IDLE);
    const drop = dropped(press(state));
    expect(drop).toBeDefined();
    expect(drop!.cell).not.toEqual({ x: 2, z: 2 });
    expect(snap.moves).toBe(1);
  });
});

describe('move counter: storage racks', () => {
  /** The mint box starts in the blue slot (bottom) of a rack facing south; its destiny is the slot right above. */
  const RACK = parseLevel(
    `
# 1 · Contador
id: contador-estanteria
limit: 1

  0123456
0 ...R...
1 .......
2 ...^...
3 .......
4 a......

a = caja azul
R = estantería frente sur: azul + caja menta / menta / libre
`.trim() + '\n',
    'prueba.level',
  ).level;
  const drive = (throttle: number, forkStep: -1 | 0 | 1 = 0): InputFrame => ({ move: { x: 0, z: 0 }, drive: { throttle, steer: 0 }, actionPressed: false, forkStep });

  it('back into the same slot is no move; into another slot of the same column (another level), one', () => {
    const state = new GameState(RACK);
    const snap = state.getSnapshot();
    run(state, 2, drive(1)); // up to the rack face, forks at the bottom slot
    expect(snap.hint.rack).toMatchObject({ level: 0 });
    expect(picked(press(state))).toMatchObject({ fromSlotId: 'r1:0:0', level: 0 });
    expect(dropped(press(state))).toMatchObject({ slotId: 'r1:0:0', level: 0 });
    expect(snap.moves).toBe(0);
    run(state, 0.3, IDLE);
    expect(picked(press(state))).toMatchObject({ fromSlotId: 'r1:0:0' });
    run(state, 1.2, drive(-1)); // straight out
    state.update(DT, drive(0, 1));
    run(state, 1.5, IDLE); // the forks climb to the middle slot
    expect(snap.hint.rack).toMatchObject({ level: 1 });
    run(state, 2, drive(1));
    expect(dropped(press(state))).toMatchObject({ slotId: 'r1:0:1', level: 1, correct: true });
    expect(snap.moves).toBe(1);
  });
});
