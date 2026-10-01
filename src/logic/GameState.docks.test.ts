import { describe, expect, it } from 'vitest';
import { angleDelta } from '../core/math';
import { cueFits, isDestined } from '../core/sorting';
import type { GameEvent, InputFrame } from '../core/types';
import { GAME_CONFIG } from '../config';
import { parseLevel } from '../data/asciiLevel';
import { LEVELS } from '../data/levels';
import { GameState } from './GameState';
import { DT, IDLE, press, run } from './testUtils';

/*
 * Loading docks (docs/DOCKS.md): a truck bed is solid for the body, loaded from the front only like a floor stack
 * (automatic fork height), bottom → top; a level is satisfied only with its destined box on satisfied levels, its box
 * then locked (never lifted) while the next level still loads on top; any other box there buzzes (wrongTarget).
 */

const level = (text: string) => parseLevel(`${text.trim()}\n`, 'prueba.level').level;
const input = (throttle = 0, forkStep: -1 | 0 | 1 = 0): InputFrame => ({ move: { x: 0, z: 0 }, drive: { throttle, steer: 0 }, actionPressed: false, forkStep });
const { bodyRadius, forkReach } = GAME_CONFIG.forklift;

/** Hold W / S (the rig stops by itself against the truck bed or a wall). */
const forward = (state: GameState, seconds = 1.6) => run(state, seconds, input(1));
const backward = (state: GameState, seconds = 1.2) => run(state, seconds, input(-1));

/** Turn in place (world-space move, as the stick does) until the forklift faces (dx, dz). */
function face(state: GameState, dx: number, dz: number): void {
  const heading = Math.atan2(dx, dz);
  for (let t = 0; t < 5 && Math.abs(angleDelta(state.getSnapshot().forklift.heading, heading)) > 0.005; t += DT)
    state.update(DT, { move: { x: dx * 0.08, z: dz * 0.08 }, actionPressed: false });
  run(state, 0.5, IDLE);
}

type Dropped = Extract<GameEvent, { type: 'boxDropped' }>;
type Picked = Extract<GameEvent, { type: 'boxPicked' }>;
const dropped = (events: readonly GameEvent[]) => events.find((e): e is Dropped => e.type === 'boxDropped');
const picked = (events: readonly GameEvent[]) => events.find((e): e is Picked => e.type === 'boxPicked');

/** World z of the bed's front face (a north dock: its bed is row 0). */
const bedFace = (depth: number) => 1 - depth / 2;

/**
 * A two-column truck against the north wall (columns at x = 1 and x = 2): «azul» under «▲», and «coral ◆». The
 * forklift faces its first column with azul ● on the cell ahead; menta ▲ waits east of it.
 */
const DOCK = level(`
# 1 · Muelle
id: muelle
limit: 2

  012345
0 .TT...
1 ......
2 .a....
3 .^b...
4 ....c.

a = caja azul ●     b = caja menta ▲     c = caja coral ◆
T = camión muelle norte: azul / ▲ | coral ◆
`);

/** The same truck; azul ▲ fits the «azul» level's cue, but its destiny is the «▲» level on top (a gentle trap). */
const TRAP = level(`
# 2 · Trampa en el camión
id: trampa-camion
limit: 2

  012345
0 .TT...
1 ......
2 .a....
3 .^b...
4 ....c.

a = caja azul ▲     b = caja azul ●     c = caja coral ◆
T = camión muelle norte: azul / ▲ | coral ◆
`);

/** The same truck; coral ◆ goes on the «azul» level by mistake, then the destined menta ▲ on top of it. */
const BASE = level(`
# 3 · Base equivocada
id: base-equivocada
limit: 2

  012345
0 .TT...
1 ......
2 .a....
3 .^b...
4 ....c.

a = caja coral ◆     b = caja menta ▲     c = caja azul ●
T = camión muelle norte: azul / ▲ | coral ◆
`);

/** A truck whose second column (1 level) starts full with a wrong box; a floor zone for it. Rows 0, 1 and 3 given. */
const FULL = (row0: string, row1: string, row3: string) =>
  level(`
# 4 · Columna llena
id: columna-llena
limit: 1

  01234
0 ${row0}
1 ${row1}
2 ..a.1
3 ${row3}
4 b....

1 = zona ▲
a = caja azul ●     b = caja coral ◆
T = camión muelle norte: azul | coral ◆ + caja menta ▲
`);

/** A box that starts on its destiny (satisfied, locked from the start); the level above it is next. */
const STARTED = level(`
# 5 · Ya cargado
id: ya-cargado
limit: 2

  0123
0 .T..
1 ....
2 .a..
3 .^..

a = caja menta ▲
T = camión muelle norte: azul + caja azul ● / ▲
`);

/** Carrying beside the truck, along its wall: its bed is never offered. */
const SIDE = level(`
# 6 · De lado
id: de-lado
limit: 1

  0123456
0 .TT..a<
1 .......
2 ...b...

a = caja azul ●     b = caja coral ◆
T = camión muelle norte: azul | coral ◆
`);

/** A truck-only level: its zones follow the target rules (a zone without its destined box buzzes). */
const ZONE = level(`
# 7 · Zona con camión
id: zona-camion
limit: 1

  01234
0 .T...
1 .....
2 .>a1.
3 ....b

1 = zona azul
a = caja menta ▲     b = caja azul ●
T = camión muelle norte: ▲
`);

describe('loading docks: snapshot', () => {
  it('lists every truck slot (column by column, bottom → top) and tags every box; levels without trucks have neither', () => {
    const snap = new GameState(DOCK).getSnapshot();
    expect(snap.truckSlots?.map((s) => s.id)).toEqual(['t1:0:0', 't1:0:1', 't1:1:0']);
    const [bottom, top, coral] = snap.truckSlots!;
    expect(bottom).toMatchObject({
      truckId: 't1',
      column: 0,
      level: 0,
      cell: { x: 1, z: 0 },
      front: { x: 1, z: 1 },
      wall: 'north',
      facing: 'south',
      accepts: { color: 'blue' },
      destined: { color: 'blue', symbol: 'circle' },
      occupiedBy: null,
      satisfied: false,
      loadable: true,
    });
    expect(top).toMatchObject({ level: 1, accepts: { symbol: 'triangle' }, destined: { color: 'mint', symbol: 'triangle' }, loadable: false });
    expect(coral).toMatchObject({ column: 1, cell: { x: 2, z: 0 }, accepts: { color: 'coral', symbol: 'diamond' }, loadable: true });
    expect(snap.progress).toEqual({ satisfied: 0, total: 3 });
    expect(snap.boxes.every((b) => b.truckSlotId === null && !b.locked)).toBe(true);
    expect(snap.hint.dropTruckSlotId).toBeNull();
    expect(snap.hint.rack).toBeNull();

    const plain = new GameState(LEVELS[0]).getSnapshot();
    expect(plain).not.toHaveProperty('truckSlots');
    expect(plain.hint).not.toHaveProperty('dropTruckSlotId');
    for (const box of plain.boxes) expect(box).not.toHaveProperty('truckSlotId');
  });

  it('a box that starts on its destined level is locked from the start; the level above is the next to load', () => {
    const state = new GameState(STARTED);
    const snap = state.getSnapshot();
    const loaded = snap.boxes.find((b) => b.color === 'blue')!;
    expect(loaded).toMatchObject({ cell: { x: 1, z: 0 }, level: 0, truckSlotId: 't1:0:0', correct: true, locked: true, zoneId: null, slotId: null });
    expect(snap.truckSlots!.map((s) => [s.satisfied, s.loadable])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(snap.progress).toEqual({ satisfied: 1, total: 2 });
  });
});

describe('loading docks: body, front and automatic fork height', () => {
  it('the bed is solid for the body; the load reaches over it and the box goes on the bed like on a floor cell', () => {
    const state = new GameState(DOCK);
    const snap = state.getSnapshot();
    expect(snap.hint.targetBoxId).toBe('b1');
    const events = [...press(state), ...run(state, 0.3)];
    expect(picked(events)).toEqual({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    forward(state);
    const f = snap.forklift;
    // Stopped by the bed, not by the wall: the body never enters row 0.
    expect(f.pos.z).toBeGreaterThanOrEqual(bedFace(DOCK.size.depth) + bodyRadius - 1e-3);
    expect(f.pos.z).toBeLessThan(bedFace(DOCK.size.depth) + bodyRadius + 0.05);
    // The fork point (and the load on it) stands over the bed cell.
    expect(f.pos.z - forkReach).toBeLessThan(bedFace(DOCK.size.depth));
    expect(snap.hint).toMatchObject({ dropCell: { x: 1, z: 0 }, dropLevel: 0, dropZoneId: null, dropTruckSlotId: 't1:0:0', rack: null });
    const drop = dropped(press(state))!;
    expect(drop).toEqual({
      type: 'boxDropped',
      boxId: 'b1',
      cell: { x: 1, z: 0 },
      zoneId: null,
      level: 0,
      correct: true,
      recipeLength: 1,
      satisfiedCount: 1,
      total: 3,
      truckSlotId: 't1:0:0',
    });
    expect(snap.boxes[0]).toMatchObject({ cell: { x: 1, z: 0 }, level: 0, carried: false, truckSlotId: 't1:0:0', correct: true, locked: true });
    expect(snap.truckSlots!.map((s) => [s.occupiedBy, s.satisfied, s.loadable])).toEqual([
      ['b1', true, false],
      [null, false, true],
      [null, false, true],
    ]);
  });

  it('a satisfied truck box is locked (the action idles), but the next level loads on top of it at the right height', () => {
    const state = new GameState(DOCK);
    const snap = state.getSnapshot();
    press(state);
    forward(state);
    press(state);
    run(state, 0.3);
    // Facing it with empty forks: nothing to lift, a gentle idle.
    expect(snap.hint.targetBoxId).toBeNull();
    expect(press(state)).toEqual([{ type: 'actionIdle', carrying: false }]);
    // Back to the aisle, lift menta ▲ and come back: the forks rise to level 1 by themselves.
    backward(state, 1.5);
    face(state, 1, 0);
    expect(snap.hint.targetBoxId).toBe('b2');
    press(state);
    face(state, 0, -1);
    const approach = forward(state, 2.5);
    expect(approach.some((e) => e.type === 'boxDropped')).toBe(false);
    expect(snap.hint).toMatchObject({ dropCell: { x: 1, z: 0 }, dropLevel: 1, dropTruckSlotId: 't1:0:1' });
    expect(snap.forklift.forkHeight).toBeCloseTo(1, 5);
    const events = press(state);
    expect(dropped(events)).toMatchObject({ boxId: 'b2', cell: { x: 1, z: 0 }, level: 1, correct: true, recipeLength: 1, satisfiedCount: 2, truckSlotId: 't1:0:1' });
    expect(dropped(events)).not.toHaveProperty('wrongTarget');
    expect(snap.boxes[1]).toMatchObject({ level: 1, truckSlotId: 't1:0:1', locked: true, correct: true });
    expect(snap.truckSlots![1]).toMatchObject({ occupiedBy: 'b2', satisfied: true, loadable: false });
    expect(snap.progress).toEqual({ satisfied: 2, total: 3 });
  });

  it('F / V do nothing at a truck: no slot selection, the fork height stays automatic', () => {
    const state = new GameState(DOCK);
    const snap = state.getSnapshot();
    press(state);
    forward(state);
    for (let i = 0; i < 3; i++) state.update(DT, input(0, 1));
    run(state, 0.5);
    expect(snap.hint.rack).toBeNull();
    expect(snap.forklift.forkHeight).toBe(0);
  });

  it('only from the front: carrying along the wall beside the truck, its bed is never the drop and its box is never lifted', () => {
    const state = new GameState(SIDE);
    const snap = state.getSnapshot();
    press(state);
    run(state, 0.3);
    forward(state, 2.5);
    // Stopped against the side of the bed (its east face), the fork point over it: still no truck drop.
    expect(snap.forklift.pos.x).toBeGreaterThanOrEqual(3 - SIDE.size.width / 2 + bodyRadius - 1e-3);
    expect(snap.hint.dropTruckSlotId).toBeNull();
    expect(snap.hint.dropCell === null || snap.hint.dropCell.z > 0 || snap.hint.dropCell.x > 2).toBe(true);
    const drop = dropped(press(state));
    if (drop) expect(drop).not.toHaveProperty('truckSlotId');
  });

  it('facing a full column carrying: no drop at all (never the floor beside the truck)', () => {
    const state = new GameState(FULL('.TT..', '.....', '..^..'));
    const snap = state.getSnapshot();
    press(state);
    forward(state);
    expect(snap.forklift.carrying).toBe('b1');
    expect(snap.hint.dropCell).toBeNull();
    expect(snap.hint.dropTruckSlotId).toBeNull();
    expect(press(state)).toEqual([{ type: 'actionIdle', carrying: true }]);
  });

  it('a wrong box on the truck is lifted from the front only (never from beside it)', () => {
    // Beside the full column, the fork point over its box: not a target.
    const side = new GameState(FULL('.TT<.', '.....', '.....'));
    expect(side.getSnapshot().hint.targetBoxId).toBeNull();
    expect(press(side)).toEqual([{ type: 'firstInput' }, { type: 'actionIdle', carrying: false }]);
    // From its front cell, facing the truck: its top box is the target.
    const front = new GameState(FULL('.TT..', '..^..', '.....'));
    const snap = front.getSnapshot();
    expect(snap.hint.targetBoxId).toBe('b3');
    const events = press(front);
    expect(picked(events)).toEqual({ type: 'boxPicked', boxId: 'b3', fromZoneId: null, level: 0, fromTruckSlotId: 't1:1:0' });
    expect(snap.boxes[2]).toMatchObject({ carried: true, cell: null, truckSlotId: null });
    expect(snap.truckSlots![1]).toMatchObject({ occupiedBy: null, loadable: true });
    expect(events.some((e) => e.type === 'zoneReleased')).toBe(false);
  });
});

describe('loading docks: satisfied, locked and wrong targets', () => {
  it('a box that fits the cue but is not its destiny stays dark, buzzes softly and can be taken back out', () => {
    const state = new GameState(TRAP);
    const snap = state.getSnapshot();
    press(state);
    forward(state);
    const drop = dropped(press(state))!;
    expect(drop).toMatchObject({ boxId: 'b1', truckSlotId: 't1:0:0', level: 0, zoneId: null, correct: false, recipeLength: 1, wrongTarget: true, satisfiedCount: 0 });
    const slot = snap.truckSlots![0];
    expect(cueFits(slot, snap.boxes[0])).toBe(true);
    expect(isDestined(slot, snap.boxes[0])).toBe(false);
    expect(slot).toMatchObject({ occupiedBy: 'b1', satisfied: false, loadable: false });
    expect(snap.truckSlots![1].loadable).toBe(false); // nothing loads right on a wrong base
    expect(snap.boxes[0]).toMatchObject({ locked: false, correct: false, truckSlotId: 't1:0:0' });
    run(state, 0.3);
    expect(snap.hint.targetBoxId).toBe('b1');
    const events = press(state);
    expect(picked(events)).toEqual({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0, fromTruckSlotId: 't1:0:0' });
    expect(snap.truckSlots![0]).toMatchObject({ occupiedBy: null, loadable: true });
  });

  it('the destined box on top of a wrong base does not satisfy its level: it buzzes and stays pickable', () => {
    const state = new GameState(BASE);
    const snap = state.getSnapshot();
    press(state);
    forward(state);
    expect(dropped(press(state))).toMatchObject({ boxId: 'b1', truckSlotId: 't1:0:0', correct: false, wrongTarget: true });
    backward(state, 1.5);
    face(state, 1, 0);
    press(state);
    face(state, 0, -1);
    forward(state, 2.5);
    expect(snap.hint).toMatchObject({ dropLevel: 1, dropTruckSlotId: 't1:0:1' });
    const drop = dropped(press(state))!;
    expect(drop).toMatchObject({ boxId: 'b2', truckSlotId: 't1:0:1', level: 1, correct: false, wrongTarget: true, satisfiedCount: 0 });
    // It is the level's destined kind, but the column is wrong from the bed up.
    expect(isDestined(snap.truckSlots![1], snap.boxes[1])).toBe(true);
    expect(snap.truckSlots![1].satisfied).toBe(false);
    expect(snap.boxes[1]).toMatchObject({ locked: false, correct: false });
    run(state, 0.5);
    expect(snap.hint.targetBoxId).toBe('b2');
    expect(picked(press(state))).toMatchObject({ boxId: 'b2', level: 1, fromTruckSlotId: 't1:0:1' });
  });

  it('the last truck level completes the level; a truck-only level treats its zones as targets (a wrong box buzzes)', () => {
    const state = new GameState(STARTED);
    const snap = state.getSnapshot();
    expect(snap.hint.targetBoxId).toBe('b1');
    press(state);
    forward(state);
    expect(snap.hint).toMatchObject({ dropLevel: 1, dropTruckSlotId: 't1:0:1' });
    const events = press(state);
    expect(dropped(events)).toMatchObject({ correct: true, satisfiedCount: 2, total: 2 });
    expect(events.at(-1)).toEqual({ type: 'levelComplete' });

    const zoned = new GameState(ZONE);
    press(zoned);
    run(zoned, 0.3);
    forward(zoned, 0.5);
    run(zoned, 0.5);
    expect(zoned.getSnapshot().hint.dropZoneId).toBe('z1');
    expect(dropped(press(zoned))).toMatchObject({ zoneId: 'z1', correct: false, wrongTarget: true });
    expect(zoned.getSnapshot().boxes[0]).not.toHaveProperty('slotId', 'z1');
  });
});
