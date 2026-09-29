import { describe, expect, it } from 'vitest';
import { angleDelta } from '../core/math';
import type { GameEvent, InputFrame } from '../core/types';
import { cueFits, isDestined } from '../core/sorting';
import { GAME_CONFIG } from '../config';
import { parseLevel } from '../data/asciiLevel';
import { GameState, LOAD_PASS_CLEARANCE } from './GameState';
import { forkRiseRate } from './forkRise';
import { DT, IDLE, makeLevel, press, rng, run, types } from './testUtils';

/*
 * Storage racks (docs/RACKS.md): solid cells, access only from the front, discrete fork levels chosen with forkStep,
 * pick / drop per slot, a slot (or zone) lights only with its destined box, slots independent, out in reverse.
 */

const level = (text: string) => parseLevel(`${text.trim()}\n`, 'prueba.level').level;
const input = (throttle = 0, steer = 0, forkStep: -1 | 0 | 1 = 0, actionPressed = false): InputFrame => ({
  move: { x: 0, z: 0 },
  drive: { throttle, steer },
  actionPressed,
  forkStep,
});
const fork = (step: -1 | 1): InputFrame => input(0, 0, step);
const { bodyRadius, carriedBoxRadius } = GAME_CONFIG.forklift;

/** Press F / V until slot `target` is selected, then let the forks arrive there; returns the events. */
function selectLevel(state: GameState, target: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < 10; i++) {
    const rack = state.getSnapshot().hint.rack;
    if (!rack) throw new Error('not at a rack');
    if (rack.level === target) break;
    events.push(...state.update(DT, fork(rack.level < target ? 1 : -1)));
  }
  expect(state.getSnapshot().hint.rack?.level).toBe(target);
  for (let t = 0; t < 3 && state.getSnapshot().forklift.forkHeight !== target; t += DT) events.push(...state.update(DT, IDLE));
  expect(state.getSnapshot().forklift.forkHeight).toBe(target);
  return events;
}

/** Turn in place (world-space move, as the stick does) until the forklift faces (dx, dz). */
function face(state: GameState, dx: number, dz: number): void {
  const heading = Math.atan2(dx, dz);
  for (let t = 0; t < 5 && Math.abs(angleDelta(state.getSnapshot().forklift.heading, heading)) > 0.005; t += DT)
    state.update(DT, { move: { x: dx * 0.08, z: dz * 0.08 }, actionPressed: false });
  run(state, 0.5, IDLE);
}

/** Hold W / S for `seconds` (the rig stops by itself against the rack or a wall). */
const forward = (state: GameState, seconds = 1.5) => run(state, seconds, input(1));
const backward = (state: GameState, seconds = 1.5) => run(state, seconds, input(-1));

/** World z of the front face of a rack standing on row 0 (a rack facing south against the north wall). */
const faceZ = (depth: number) => 1 - depth / 2;

/** One rack against the north wall, front to the south: blue at the bottom, mint in the middle, a «libre» top. */
const RACK_BASIC = level(`
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

/**
 * A two-column rack facing west with symbol cues, a floor zone and a box that starts in a slot it does not belong to
 * (blue ● in the ▲ slot); mint ▲ fits the ▲ slot's cue too, but its destiny is the exact «menta ▲» slot.
 */
const RACK_COLUMNS = level(`
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
const RACK_SWAP = level(`
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

/** The forklift one cell from the front of a rack (facing south, row 0), a blue box on the front cell to pick first. */
const FRONT = level(`
# 1 · Frente
id: frente
limit: 1

  0123456
0 ...R...
1 ...a...
2 ...^...
3 .......
4 .b.....

a = caja azul       b = caja menta
R = estantería frente sur: azul / menta / libre
`);

/** Both cues of the column take a ▲, but each box has one destiny: blue ▲ below, mint ▲ above. */
const DECOY = level(`
# 2 · Encaja pero no brilla
id: encaja
limit: 1

  0123456
0 ...R...
1 ...a...
2 ...^...
3 .......
4 .b.....

a = caja menta ▲       b = caja azul ▲
R = estantería frente sur: ▲ / menta ▲
`);

/** The mint box starts in the blue slot (the bottom one), so the bottom slot is taken. */
const TAKEN = level(`
# 3 · Ocupado
id: ocupado
limit: 1

  0123456
0 ...R...
1 ...a...
2 ...^...
3 .......
4 .......

a = caja azul
R = estantería frente sur: azul + caja menta / menta / libre
`);

describe('storage racks: snapshot and contracts', () => {
  it('lists every slot rack by rack, column by column, bottom → top, with cue, destiny and front', () => {
    const snap = new GameState(RACK_COLUMNS).getSnapshot();
    expect(snap.slots.map((s) => s.id)).toEqual(['r1:0:0', 'r1:0:1', 'r1:1:0', 'r1:1:1']);
    const [bottom, top, other, free] = snap.slots;
    expect(bottom).toMatchObject({ rackId: 'r1', column: 0, level: 0, cell: { x: 6, z: 1 }, front: { x: 5, z: 1 }, facing: 'west' });
    expect(bottom.accepts).toEqual({ color: 'blue', symbol: 'circle' });
    expect(top.accepts).toEqual({ symbol: 'triangle' });
    expect(other.cell).toEqual({ x: 6, z: 2 });
    // The unique solution: blue ● below, blue ▲ in the ▲ slot, mint ▲ in the exact one; the «libre» slot has no destiny.
    expect(bottom.destined).toEqual({ color: 'blue', symbol: 'circle' });
    expect(top.destined).toEqual({ color: 'blue', symbol: 'triangle' });
    expect(other.destined).toEqual({ color: 'mint', symbol: 'triangle' });
    expect(free).toMatchObject({ accepts: null, destined: null, occupiedBy: null, satisfied: false });
    // Blue ● starts in the ▲ slot: it rests there (cell = rack cell, level = slot), not its destiny.
    const blueCircle = snap.boxes.find((b) => b.color === 'blue' && b.symbol === 'circle')!;
    expect(blueCircle).toMatchObject({ cell: { x: 6, z: 1 }, level: 1, slotId: 'r1:0:1', zoneId: null, correct: false });
    expect(top).toMatchObject({ occupiedBy: blueCircle.id, satisfied: false });
    // Targets: the ■ zone and the three slots with a cue.
    expect(snap.progress).toEqual({ satisfied: 0, total: 4 });
    expect(snap.zones[0].destined).toEqual({ color: 'yellow', symbol: 'square' });
    expect(snap.hint.rack).toBeNull();
  });

  it('keeps levels without racks as before: no slots, no destinies, fork steps do nothing (not even firstInput)', () => {
    const plain = makeLevel({ forklift: { x: 1, z: 2, heading: 90 }, boxes: [{ id: 'b', color: 'blue', x: 3, z: 2 }], zones: [{ id: 'z', color: 'blue', x: 5, z: 2 }] });
    const state = new GameState(plain);
    const snap = state.getSnapshot();
    expect(snap.slots).toEqual([]);
    expect(snap.zones[0].destined).toBeNull();
    expect(snap.boxes[0].slotId).toBeNull();
    expect(run(state, 0.5, fork(1))).toEqual([]);
    expect(snap.forklift.forkHeight).toBe(0);
    expect(snap.hint.rack).toBeNull();
  });

  it('rack cells are solid for the body: driving into the rack stops at its face', () => {
    const state = new GameState(RACK_BASIC);
    run(state, 4, input(1)); // from (3,4) straight north into the rack at (3,0)
    const f = state.getSnapshot().forklift;
    const face = faceZ(RACK_BASIC.size.depth);
    expect(f.pos.z).toBeGreaterThanOrEqual(face + bodyRadius - 1e-6);
    expect(f.pos.z).toBeLessThan(face + bodyRadius + 0.05);
  });
});

describe('storage racks: fork levels', () => {
  it('in front of a rack F / V select a slot level (clamped), and the forks ease there at the climb rate', () => {
    const state = new GameState(FRONT);
    const snap = state.getSnapshot();
    // One cell from the front cell, facing the rack: engaged at the bottom slot at once.
    expect(snap.hint.rack).toMatchObject({ rackId: 'r1', column: 0, levels: 3, level: 0, slotId: 'r1:0:0' });
    state.update(DT, fork(-1));
    expect(snap.hint.rack!.level).toBe(0); // clamped at the bottom
    state.update(DT, fork(1));
    expect(snap.hint.rack).toMatchObject({ level: 1, slotId: 'r1:0:1' });
    // The climb is continuous, never overshoots, and takes about 1 / forkRiseRate.
    const heights: number[] = [];
    for (let i = 0; i < 60; i++) {
      state.update(DT, IDLE);
      heights.push(snap.forklift.forkHeight);
    }
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThanOrEqual(heights[i - 1]);
    expect(Math.max(...heights)).toBe(1);
    const frames = heights.findIndex((h) => h === 1) + 2;
    expect(frames * DT).toBeCloseTo(1 / forkRiseRate(GAME_CONFIG, 1), 1);
    state.update(DT, fork(1));
    state.update(DT, fork(1));
    expect(snap.hint.rack!.level).toBe(2); // clamped at the top (3 slots)
    run(state, 1.5, IDLE);
    expect(snap.forklift.forkHeight).toBe(2);
    state.update(DT, fork(-1));
    run(state, 1.5, IDLE);
    expect(snap.forklift.forkHeight).toBe(1);
  });

  it('away from racks the forks stay automatic: fork steps are ignored (though they start the clock)', () => {
    const state = new GameState(RACK_BASIC);
    const snap = state.getSnapshot();
    expect(snap.hint.rack).toBeNull(); // (3,4) is too far from the rack face
    expect(types(run(state, 0.5, fork(1)))).toEqual(['firstInput']);
    expect(snap.forklift.forkHeight).toBe(0);
    expect(snap.hint.rack).toBeNull();
  });

  it('leaving the rack resets the selection and the forks come down; a small wobble keeps it', () => {
    const state = new GameState(FRONT);
    const snap = state.getSnapshot();
    press(state);
    selectLevel(state, 2);
    run(state, 0.12, input(0, 1)); // a slight turn in place
    run(state, 0.3, IDLE);
    expect(snap.hint.rack?.level).toBe(2);
    expect(snap.forklift.forkHeight).toBe(2);
    backward(state, 2);
    run(state, 2, IDLE);
    expect(snap.hint.rack).toBeNull();
    expect(snap.forklift.forkHeight).toBe(0);
  });
});

describe('storage racks: loading a slot', () => {
  it('its destined box lights a slot: a correct drop into the selected (bottom) slot', () => {
    const state = new GameState(FRONT);
    const snap = state.getSnapshot();
    press(state);
    forward(state, 2);
    expect(snap.hint.rack).toMatchObject({ level: 0, slotId: 'r1:0:0', ready: true });
    expect(snap.hint).toMatchObject({ dropCell: { x: 3, z: 0 }, dropLevel: 0, dropZoneId: null });
    const events = press(state);
    expect(events).toEqual([
      {
        type: 'boxDropped',
        boxId: 'b1',
        cell: { x: 3, z: 0 },
        zoneId: null,
        level: 0,
        correct: true,
        recipeLength: 1,
        satisfiedCount: 1,
        total: 2,
        slotId: 'r1:0:0',
      },
    ]);
    expect(snap.boxes[0]).toMatchObject({ carried: false, cell: { x: 3, z: 0 }, level: 0, slotId: 'r1:0:0', zoneId: null, correct: true });
    expect(snap.slots[0]).toMatchObject({ occupiedBy: 'b1', satisfied: true });
    expect(snap.forklift.carrying).toBeNull();
  });

  it('the load stays out at an occupied slot and while the forks rise, goes in at the level, drops into that slot', () => {
    const state = new GameState(TAKEN);
    const snap = state.getSnapshot();
    const face = faceZ(TAKEN.size.depth);
    press(state);
    // Level 0 holds the mint box: its column stays closed, the load rests against the face.
    forward(state, 1.5);
    const load = () => snap.boxes.find((b) => b.carried)!;
    expect(load().pos.z).toBeGreaterThan(face + carriedBoxRadius - 0.02);
    expect(snap.hint.rack).toMatchObject({ level: 0, ready: false });
    expect(snap.hint.dropCell).toBeNull();
    expect(types(press(state))).toEqual(['actionIdle']);
    // Level 1 is free: while the forks climb (below the slot) the load still cannot go in, then it slides in.
    state.update(DT, input(1, 0, 1));
    const rising: number[] = [];
    while (snap.forklift.forkHeight < 1 - LOAD_PASS_CLEARANCE - 0.05) {
      state.update(DT, input(1));
      rising.push(load().pos.z);
    }
    expect(rising.length).toBeGreaterThan(3);
    for (const z of rising) expect(z).toBeGreaterThan(face + carriedBoxRadius - 0.02);
    forward(state, 1.5);
    expect(snap.forklift.forkHeight).toBe(1);
    expect(load().pos.z).toBeLessThan(face - 0.3);
    expect(snap.forklift.pos.z).toBeGreaterThanOrEqual(face + bodyRadius - 1e-6);
    expect(snap.hint.rack).toMatchObject({ level: 1, slotId: 'r1:0:1', ready: true });
    // Blue in the mint slot: it is stored there, the slot stays neutral.
    const drop = press(state).find((e) => e.type === 'boxDropped');
    expect(drop).toMatchObject({ slotId: 'r1:0:1', level: 1, correct: false, satisfiedCount: 0, total: 2, zoneId: null });
    expect(snap.slots[1]).toMatchObject({ occupiedBy: 'b1', satisfied: false });
  });

  it('a box that fits the cue but is not the destined one leaves the slot neutral (rule 5)', () => {
    const state = new GameState(DECOY);
    const snap = state.getSnapshot();
    const [lower, upper] = snap.slots;
    const mint = snap.boxes.find((b) => b.color === 'mint')!;
    expect(cueFits(lower, mint)).toBe(true); // the ▲ cue takes a mint ▲ …
    expect(isDestined(lower, mint)).toBe(false); // … but its destiny is the blue ▲
    expect(isDestined(upper, mint)).toBe(true);
    press(state);
    forward(state, 2);
    const events = press(state);
    expect(events.find((e) => e.type === 'boxDropped')).toMatchObject({ slotId: lower.id, correct: false, satisfiedCount: 0 });
    expect(lower).toMatchObject({ occupiedBy: mint.id, satisfied: false });
    expect(mint.correct).toBe(false);
  });

  it('slots are independent: the top one can be filled before the one below it', () => {
    const state = new GameState(DECOY);
    const snap = state.getSnapshot();
    press(state); // mint ▲
    selectLevel(state, 1);
    forward(state, 2);
    expect(press(state).find((e) => e.type === 'boxDropped')).toMatchObject({ slotId: 'r1:0:1', level: 1, correct: true, satisfiedCount: 1, total: 2 });
    expect(snap.slots[0].occupiedBy).toBeNull();
    expect(snap.slots[1].satisfied).toBe(true);
  });

  it('completes the level once every zone and slot with a cue holds its destined box', () => {
    const both = level(`
# 8 · Las dos
id: las-dos
limit: 1

  0123456
0 ...R...
1 ...a...
2 ...^...
3 .......
4 ...b...

a = caja azul       b = caja menta
R = estantería frente sur: azul / menta / libre
`);
    const state = new GameState(both);
    const snap = state.getSnapshot();
    press(state);
    forward(state, 2);
    expect(press(state)[0]).toMatchObject({ type: 'boxDropped', slotId: 'r1:0:0', correct: true, satisfiedCount: 1 });
    // Straight back out, turn round, fetch the mint box, turn round again.
    backward(state, 1);
    face(state, 0, 1);
    for (let t = 0; t < 3 && snap.hint.targetBoxId !== 'b2'; t += DT) state.update(DT, input(0.3));
    press(state);
    expect(snap.forklift.carrying).toBe('b2');
    face(state, 0, -1);
    // Drive toward the rack until it engages (the fork point near its face), pick the level, drive the load in.
    for (let t = 0; t < 3 && !snap.hint.rack; t += DT) state.update(DT, input(0.5));
    expect(snap.hint.rack).toMatchObject({ level: 0 });
    selectLevel(state, 1);
    forward(state, 3);
    const events = press(state);
    expect(types(events)).toEqual(['boxDropped', 'levelComplete']);
    expect(events[0]).toMatchObject({ slotId: 'r1:0:1', correct: true, satisfiedCount: 2, total: 2 });
    expect(snap.completed).toBe(true);
    expect(snap.hint.rack).toBeNull();
  });
});

describe('storage racks: unloading a slot', () => {
  it('picks the box at the selected level only once the forks stand there; lifting a lit slot releases it', () => {
    const state = new GameState(FRONT);
    const snap = state.getSnapshot();
    press(state);
    forward(state, 2);
    press(state); // blue into the blue slot: lit
    run(state, 0.3, IDLE);
    expect(snap.hint.targetBoxId).toBe('b1');
    expect(snap.hint.rack).toMatchObject({ level: 0, ready: true });
    // Level 1 is empty: nothing to pick there.
    selectLevel(state, 1);
    expect(snap.hint.targetBoxId).toBeNull();
    expect(snap.hint.rack).toMatchObject({ level: 1, ready: false });
    expect(types(press(state))).toEqual(['actionIdle']);
    // Back to level 0: no target while the forks are still up, then the blue box again.
    state.update(DT, fork(-1));
    expect(snap.hint.targetBoxId).toBeNull();
    run(state, 1, IDLE);
    expect(snap.hint.targetBoxId).toBe('b1');
    expect(press(state)).toEqual([
      { type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0, fromSlotId: 'r1:0:0' },
      { type: 'zoneReleased', zoneId: null, boxId: 'b1', slotId: 'r1:0:0' },
    ]);
    expect(snap.slots[0]).toMatchObject({ occupiedBy: null, satisfied: false });
    expect(snap.boxes[0]).toMatchObject({ carried: true, cell: null, slotId: null });
    expect(snap.progress.satisfied).toBe(0);
  });

  it('a box lifted out of a slot backs straight out: no turning while the load is inside, the level locked', () => {
    const state = new GameState(FRONT);
    const snap = state.getSnapshot();
    press(state);
    selectLevel(state, 2);
    forward(state, 2);
    expect(press(state).find((e) => e.type === 'boxDropped')).toMatchObject({ slotId: 'r1:0:2', recipeLength: 0, correct: false });
    run(state, 0.3, IDLE);
    expect(press(state)[0]).toMatchObject({ type: 'boxPicked', fromSlotId: 'r1:0:2', level: 2 });
    const heading = snap.forklift.heading;
    run(state, 1, input(0, 1));
    expect(snap.forklift.heading).toBe(heading);
    // A move vector sideways does not swing it either: it only drives along the heading (here: nowhere).
    run(state, 0.5, { move: { x: 1, z: 0 }, actionPressed: false });
    expect(snap.forklift.heading).toBe(heading);
    // The selected level cannot change while the load is in the slot (it would pass through a shelf board).
    state.update(DT, fork(-1));
    expect(snap.hint.rack!.level).toBe(2);
    run(state, 0.4, IDLE);
    backward(state, 1.2);
    const face = faceZ(FRONT.size.depth);
    expect(snap.boxes[0].pos.z).toBeGreaterThan(face + carriedBoxRadius - 0.02);
    const out = snap.forklift.heading;
    run(state, 0.6, input(0, 1));
    expect(Math.abs(angleDelta(out, snap.forklift.heading))).toBeGreaterThan(0.3);
  });
});

describe('storage racks: only from the front', () => {
  it('from its side: never engaged, fork steps ignored, and a carried box lands on the floor', () => {
    const side = level(`
# 4 · De lado
id: de-lado
limit: 1

  012345678
0 .........
1 .........
2 ....R.a<.
3 .........
4 .........

a = caja azul
R = estantería frente sur: azul + caja menta / menta
`);
    const state = new GameState(side);
    const snap = state.getSnapshot();
    press(state); // the blue box at (6,2), facing west toward the rack's east side
    expect(snap.forklift.carrying).toBe('b1');
    forward(state, 2);
    expect(snap.forklift.pos.x).toBeGreaterThan(1 - side.size.width / 2 + 4 + carriedBoxRadius + GAME_CONFIG.forklift.forkReach - 0.05);
    expect(snap.hint.rack).toBeNull();
    run(state, 0.3, fork(1));
    expect(snap.forklift.forkHeight).toBe(0);
    const drop = press(state).find((e) => e.type === 'boxDropped');
    expect(drop).toBeDefined();
    expect(drop).not.toHaveProperty('slotId');
    expect(drop).not.toMatchObject({ cell: { x: 4, z: 2 } });
    expect(snap.slots.map((s) => s.occupiedBy)).toEqual(['b2', null]);
  });

  it('from its back: never engaged and its boxes cannot be picked', () => {
    const back = level(`
# 5 · Por detrás
id: por-detras
limit: 1

  012345678
0 .........
1 ....v....
2 ....R.a..
3 .........
4 .........

a = caja azul
R = estantería frente sur: azul + caja menta / menta
`);
    const state = new GameState(back);
    const snap = state.getSnapshot();
    forward(state, 2); // south into the rack's back
    expect(snap.hint.rack).toBeNull();
    expect(snap.hint.targetBoxId).toBeNull();
    expect(types(press(state))).toEqual(['actionIdle']);
    run(state, 0.3, fork(1));
    expect(snap.forklift.forkHeight).toBe(0);
    expect(snap.slots[0].occupiedBy).toBe('b2');
  });

  it('from its front: the mint box in the blue slot can be taken out', () => {
    const front = level(`
# 6 · Por delante
id: por-delante
limit: 1

  012345678
0 .........
1 ....R.a..
2 .........
3 ....^....
4 .........

a = caja azul
R = estantería frente sur: azul + caja menta / menta
`);
    const state = new GameState(front);
    const snap = state.getSnapshot();
    forward(state, 2);
    expect(snap.hint.rack).toMatchObject({ level: 0, ready: true });
    expect(snap.hint.targetBoxId).toBe('b2');
    expect(press(state)).toEqual([{ type: 'boxPicked', boxId: 'b2', fromZoneId: null, level: 0, fromSlotId: 'r1:0:0' }]);
  });
});

describe('storage racks: floor zones and stacks in a level with racks', () => {
  /** «any blue» zone, but the ▲ slot needs the blue ▲: the zone's destiny is the blue ●. */
  const zoneLevel = (onZone: 'a' | 'b') =>
    level(`
# 7 · Zona con destino
id: zona-destino
limit: 1

  0123456
0 ...R...
1 .......
2 ...1...
3 .......
4 ...^.c.

1 = zona azul + caja ${onZone === 'a' ? 'azul ▲' : 'azul ●'}
c = caja ${onZone === 'a' ? 'azul ●' : 'azul ▲'}
R = estantería frente sur: azul ▲
`);

  it('a floor zone also lights only with its destined box', () => {
    const wrong = new GameState(zoneLevel('a')).getSnapshot();
    expect(wrong.zones[0].destined).toEqual({ color: 'blue', symbol: 'circle' });
    expect(cueFits(wrong.zones[0], wrong.boxes[0])).toBe(true);
    expect(wrong.zones[0]).toMatchObject({ satisfied: false, occupiedBy: wrong.boxes[0].id });
    expect(wrong.boxes[0].correct).toBe(false);
    expect(wrong.progress).toEqual({ satisfied: 0, total: 2 });
    const right = new GameState(zoneLevel('b')).getSnapshot();
    expect(right.zones[0]).toMatchObject({ satisfied: true });
    expect(right.boxes[0].correct).toBe(true);
    expect(right.progress).toEqual({ satisfied: 1, total: 2 });
  });

  it('floor stacks only park: a stacked start rests as a stack and no zone takes it as a recipe', () => {
    const snap = new GameState(RACK_SWAP).getSnapshot();
    expect(snap.level.stackLimit).toBe(3);
    const lavender = snap.boxes.find((b) => b.color === 'lavender')!;
    const coral = snap.boxes.find((b) => b.color === 'coral')!;
    expect([lavender.level, coral.level]).toEqual([0, 1]);
    expect(snap.zones.every((z) => z.recipe.length === 1)).toBe(true);
    expect(snap.zones.map((z) => z.satisfied)).toEqual([false, false]);
    expect(snap.slots.map((s) => s.satisfied)).toEqual([false, false, false]);
  });
});

describe('storage racks: robustness', () => {
  it('stays finite and deterministic under random input, fork steps and actions included', () => {
    for (const lvl of [RACK_BASIC, RACK_COLUMNS, RACK_SWAP, FRONT, TAKEN]) {
      const trace = (seed: number) => {
        const r = rng(seed);
        const state = new GameState(lvl);
        const out: number[] = [];
        for (let i = 0; i < 1200; i++) {
          const k = r();
          const frame = input(r() * 2 - 1, r() * 2 - 1, k < 0.05 ? 1 : k < 0.1 ? -1 : 0, r() < 0.03);
          state.update(r() < 0.1 ? 1 / 20 : DT, frame);
          const f = state.getSnapshot().forklift;
          for (const v of [f.pos.x, f.pos.z, f.heading, f.speed, f.forkHeight]) expect(Number.isFinite(v)).toBe(true);
          out.push(f.pos.x, f.pos.z, f.forkHeight);
        }
        for (const b of state.getSnapshot().boxes) expect(Number.isFinite(b.pos.x) && Number.isFinite(b.pos.z)).toBe(true);
        return out;
      };
      expect(trace(7)).toEqual(trace(7));
    }
  });

  it('ignores a malformed forkStep', () => {
    const state = new GameState(FRONT);
    state.update(DT, { ...IDLE, forkStep: 3 as unknown as 1 });
    state.update(DT, { ...IDLE, forkStep: Number.NaN as unknown as 1 });
    expect(state.getSnapshot().hint.rack?.level).toBe(0);
  });
});
