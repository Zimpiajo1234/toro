import { describe, expect, it } from 'vitest';
import { angleDelta } from '../core/math';
import type { GameEvent, InputFrame } from '../core/types';
import { cueFits, isDestined } from '../core/sorting';
import { storageOf } from '../core/storage';
import { GAME_CONFIG } from '../config';
import { parseLevel } from '../data/asciiLevel';
import { LEVELS } from '../data/levels';
import { GameState, LOAD_PASS_CLEARANCE } from './GameState';
import { forkRiseRate } from './forkRise';
import { DT, IDLE, makeLevel, press, rng, run, runUntil, types } from './testUtils';

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
    const rack = state.getSnapshot().hint.storage;
    if (!rack) throw new Error('not at a rack');
    if (rack.level === target) break;
    events.push(...state.update(DT, fork(rack.level < target ? 1 : -1)));
  }
  expect(state.getSnapshot().hint.storage?.level).toBe(target);
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

/** The forklift one cell from the front of a rack (facing south, row 0), its front cell free: nothing to lift there. */
const AT_RACK = level(`
# 1 · Ante la estantería
id: ante
limit: 1

  0123456
0 ...R...
1 .......
2 ...^...
3 .......
4 .a...b.

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
    expect(snap.storageSlots.map((s) => s.id)).toEqual(['r1:0:0', 'r1:0:1', 'r1:1:0', 'r1:1:1']);
    const [bottom, top, other, free] = snap.storageSlots;
    expect(bottom).toMatchObject({ unitId: 'r1', skin: 'rack', column: 0, level: 0, cell: { x: 6, z: 1 }, front: { x: 5, z: 1 }, facing: 'west' });
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
    expect(snap.hint.storage).toBeNull();
  });

  it('keeps levels without racks as before: no slots, no destinies, fork steps do nothing (not even firstInput)', () => {
    const plain = makeLevel({ forklift: { x: 1, z: 2, heading: 90 }, boxes: [{ id: 'b', color: 'blue', x: 3, z: 2 }], zones: [{ id: 'z', color: 'blue', x: 5, z: 2 }] });
    const state = new GameState(plain);
    const snap = state.getSnapshot();
    expect(snap.storageSlots).toEqual([]);
    expect(snap.zones[0].destined).toBeNull();
    expect(snap.boxes[0].slotId).toBeNull();
    expect(run(state, 0.5, fork(1))).toEqual([]);
    expect(snap.forklift.forkHeight).toBe(0);
    expect(snap.hint.storage).toBeNull();
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
    const state = new GameState(AT_RACK);
    const snap = state.getSnapshot();
    // One cell from the front cell, facing the rack (nothing to lift on it): engaged at the bottom slot at once.
    expect(snap.hint.storage).toMatchObject({ unitId: 'r1', skin: 'rack', column: 0, levels: 3, level: 0, slotId: 'r1:0:0' });
    state.update(DT, fork(-1));
    expect(snap.hint.storage!.level).toBe(0); // clamped at the bottom
    state.update(DT, fork(1));
    expect(snap.hint.storage).toMatchObject({ level: 1, slotId: 'r1:0:1' });
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
    expect(snap.hint.storage!.level).toBe(2); // clamped at the top (3 slots)
    run(state, 1.5, IDLE);
    expect(snap.forklift.forkHeight).toBe(2);
    state.update(DT, fork(-1));
    run(state, 1.5, IDLE);
    expect(snap.forklift.forkHeight).toBe(1);
  });

  it('away from racks the forks stay automatic: fork steps are ignored (though they start the clock)', () => {
    const state = new GameState(RACK_BASIC);
    const snap = state.getSnapshot();
    expect(snap.hint.storage).toBeNull(); // (3,4) is too far from the rack face
    expect(types(run(state, 0.5, fork(1)))).toEqual(['firstInput']);
    expect(snap.forklift.forkHeight).toBe(0);
    expect(snap.hint.storage).toBeNull();
  });

  it('leaving the rack resets the selection and the forks come down; a small wobble keeps it', () => {
    const state = new GameState(FRONT);
    const snap = state.getSnapshot();
    press(state);
    selectLevel(state, 2);
    run(state, 0.12, input(0, 1)); // a slight turn in place
    run(state, 0.3, IDLE);
    expect(snap.hint.storage?.level).toBe(2);
    expect(snap.forklift.forkHeight).toBe(2);
    backward(state, 2);
    run(state, 2, IDLE);
    expect(snap.hint.storage).toBeNull();
    expect(snap.forklift.forkHeight).toBe(0);
  });
});

describe('storage racks: loading a slot', () => {
  it('its destined box lights a slot: a correct drop into the selected (bottom) slot', () => {
    const state = new GameState(FRONT);
    const snap = state.getSnapshot();
    press(state);
    forward(state, 2);
    expect(snap.hint.storage).toMatchObject({ level: 0, slotId: 'r1:0:0', ready: true });
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
        skin: 'rack',
      },
    ]);
    expect(snap.boxes[0]).toMatchObject({ carried: false, cell: { x: 3, z: 0 }, level: 0, slotId: 'r1:0:0', zoneId: null, correct: true });
    expect(snap.storageSlots[0]).toMatchObject({ occupiedBy: 'b1', satisfied: true });
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
    expect(snap.hint.storage).toMatchObject({ level: 0, ready: false });
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
    expect(snap.hint.storage).toMatchObject({ level: 1, slotId: 'r1:0:1', ready: true });
    // Blue in the mint slot: it is stored there, the slot stays neutral.
    const drop = press(state).find((e) => e.type === 'boxDropped');
    expect(drop).toMatchObject({ slotId: 'r1:0:1', level: 1, correct: false, satisfiedCount: 0, total: 2, zoneId: null });
    expect(snap.storageSlots[1]).toMatchObject({ occupiedBy: 'b1', satisfied: false });
  });

  it('with the load at the face nothing is dropped while the forks travel to another slot: no preview, never the floor', () => {
    const state = new GameState(TAKEN);
    const snap = state.getSnapshot();
    press(state);
    forward(state, 1.5); // level 0 holds the mint box: the load rests against the face
    expect(snap.hint.dropCell).toBeNull();
    state.update(DT, fork(1));
    let frames = 0;
    while (snap.forklift.forkHeight < 1 - LOAD_PASS_CLEARANCE) {
      expect(snap.hint.dropCell).toBeNull();
      expect(snap.hint.storage).toMatchObject({ level: 1, ready: false });
      expect(types(press(state))).toEqual(['actionIdle']);
      frames++;
    }
    expect(frames).toBeGreaterThan(3);
    expect(snap.forklift.carrying).toBe('b1');
    // At the level: the preview goes straight to the slot.
    for (let t = 0; t < 1 && !snap.hint.dropCell; t += DT) state.update(DT, IDLE);
    expect(snap.hint).toMatchObject({ dropCell: { x: 3, z: 0 }, dropLevel: 1 });
    expect(snap.hint.storage).toMatchObject({ level: 1, ready: true });
  });

  it('facing a column, a box can still be parked on one standing on its front cell (the forks over that stack)', () => {
    const park = level(`
# 9 · Aparcar delante
id: aparcar-delante
limit: 2

  0123456
0 ...R...
1 ...a...
2 ...b...
3 ...^...
4 .......

a = caja azul       b = caja menta
R = estantería frente sur: azul / menta
`);
    const state = new GameState(park);
    const snap = state.getSnapshot();
    press(state); // the mint box, in front of the blue one
    run(state, 0.3, IDLE);
    forward(state, 2); // the load passes over the blue box and rests against the rack face
    expect(snap.hint.storage).toMatchObject({ level: 0, ready: false });
    expect(snap.forklift.forkHeight).toBe(1);
    expect(snap.hint).toMatchObject({ dropCell: { x: 3, z: 1 }, dropLevel: 1 });
    const drop = press(state).find((e) => e.type === 'boxDropped');
    expect(drop).toMatchObject({ boxId: 'b2', cell: { x: 3, z: 1 }, level: 1, zoneId: null });
    expect(drop).not.toHaveProperty('slotId');
  });

  it('a box that fits the cue but is not the destined one leaves the slot neutral (rule 5)', () => {
    const state = new GameState(DECOY);
    const snap = state.getSnapshot();
    const [lower, upper] = snap.storageSlots;
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
    expect(snap.storageSlots[0].occupiedBy).toBeNull();
    expect(snap.storageSlots[1].satisfied).toBe(true);
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
    for (let t = 0; t < 3 && !snap.hint.storage; t += DT) state.update(DT, input(0.5));
    expect(snap.hint.storage).toMatchObject({ level: 0 });
    selectLevel(state, 1);
    forward(state, 3);
    const events = press(state);
    expect(types(events)).toEqual(['boxDropped', 'levelComplete']);
    expect(events[0]).toMatchObject({ slotId: 'r1:0:1', correct: true, satisfiedCount: 2, total: 2 });
    expect(snap.completed).toBe(true);
    expect(snap.hint.storage).toBeNull();
  });
});

describe('storage racks: unloading a slot', () => {
  it('picks the box at the selected level only once the forks stand there (a box stored in a slot that is not its own)', () => {
    const state = new GameState(FRONT);
    const snap = state.getSnapshot();
    press(state);
    selectLevel(state, 1);
    forward(state, 2);
    press(state); // blue into the mint slot: stored, dark, still free
    run(state, 0.3, IDLE);
    expect(snap.hint.targetBoxId).toBe('b1');
    expect(snap.hint.storage).toMatchObject({ level: 1, ready: true });
    // Level 0 is empty: nothing to pick there.
    selectLevel(state, 0);
    expect(snap.hint.targetBoxId).toBeNull();
    expect(snap.hint.storage).toMatchObject({ level: 0, ready: false });
    expect(types(press(state))).toEqual(['actionIdle']);
    // Back to level 1: no target while the forks are still down, then the blue box again.
    state.update(DT, fork(1));
    expect(snap.hint.targetBoxId).toBeNull();
    run(state, 1, IDLE);
    expect(snap.hint.targetBoxId).toBe('b1');
    expect(press(state)).toEqual([{ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 1, fromSlotId: 'r1:0:1', skin: 'rack' }]);
    expect(snap.storageSlots[1]).toMatchObject({ occupiedBy: null, satisfied: false });
    expect(snap.boxes[0]).toMatchObject({ carried: true, cell: null, slotId: null, locked: false });
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
    expect(snap.hint.storage!.level).toBe(2);
    run(state, 0.4, IDLE);
    backward(state, 1.2);
    const face = faceZ(FRONT.size.depth);
    expect(snap.boxes[0].pos.z).toBeGreaterThan(face + carriedBoxRadius - 0.02);
    const out = snap.forklift.heading;
    run(state, 0.6, input(0, 1));
    expect(Math.abs(angleDelta(out, snap.forklift.heading))).toBeGreaterThan(0.3);
  });
});

describe('storage racks: a fork step at the opening never jolts the rig', () => {
  /** Per-frame body displacement (u) along z over `seconds` with a constant input (the rig faces the rack, z). */
  function steps(state: GameState, seconds: number, frame: InputFrame): number[] {
    const out: number[] = [];
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const z = state.getSnapshot().forklift.pos.z;
      state.update(DT, frame);
      out.push(Math.abs(state.getSnapshot().forklift.pos.z - z));
    }
    return out;
  }
  const face = faceZ(FRONT.size.depth);
  /** Fork point depth past the rack face (FRONT: the rig faces north, into the rack). */
  const depthOf = (state: GameState) => face - (state.getSnapshot().forklift.pos.z - GAME_CONFIG.forklift.forkReach);

  it.each([-0.445, -0.43])('the load only just into the open slot (fork point at %s): a step eases it back out', (depth) => {
    const state = new GameState(FRONT);
    const snap = state.getSnapshot();
    press(state);
    selectLevel(state, 1); // empty: the column opens for the load
    for (let t = 0; t < 5 && depthOf(state) < depth; t += DT) state.update(DT, input(0.1));
    run(state, 0.3, IDLE);
    expect(depthOf(state)).toBeGreaterThan(-carriedBoxRadius); // the load collider reaches into the cell
    const z = snap.forklift.pos.z;
    const moves = [...steps(state, DT, fork(1)), ...steps(state, 1, IDLE)];
    expect(snap.hint.storage!.level).toBe(2); // not inside yet: the step is taken
    for (const d of moves) expect(d).toBeLessThan(0.01);
    // Eased out of the closed column (then parked at its face: the rig was idle).
    expect(snap.forklift.pos.z - z).toBeGreaterThan(0.01);
    expect(depthOf(state)).toBeLessThanOrEqual(-carriedBoxRadius + 1e-6);
  });

  it.each([-0.1, -0.2])('backing slowly out of a slot (throttle %s) pressing V all along: no pop as the column closes', (throttle) => {
    const state = new GameState(FRONT);
    const snap = state.getSnapshot();
    press(state);
    selectLevel(state, 1);
    forward(state, 2); // the load goes into the middle slot
    expect(depthOf(state)).toBeGreaterThan(0);
    for (let t = 0; t < 5 && depthOf(state) > -0.3; t += DT) state.update(DT, input(-0.4));
    const moves: number[] = [];
    for (let t = 0; t < 6 && depthOf(state) > -0.55; t += DT) moves.push(...steps(state, DT, input(throttle, 0, -1)));
    expect(moves.length).toBeGreaterThan(10);
    for (const d of moves) expect(d).toBeLessThan(0.01);
    expect(snap.hint.storage!.level).toBe(0); // the step is taken once the load is no longer inside
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
    expect(snap.hint.storage).toBeNull();
    run(state, 0.3, fork(1));
    expect(snap.forklift.forkHeight).toBe(0);
    const drop = press(state).find((e) => e.type === 'boxDropped');
    expect(drop).toBeDefined();
    expect(drop).not.toHaveProperty('slotId');
    expect(drop).not.toMatchObject({ cell: { x: 4, z: 2 } });
    expect(snap.storageSlots.map((s) => s.occupiedBy)).toEqual(['b2', null]);
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
    expect(snap.hint.storage).toBeNull();
    expect(snap.hint.targetBoxId).toBeNull();
    expect(types(press(state))).toEqual(['actionIdle']);
    run(state, 0.3, fork(1));
    expect(snap.forklift.forkHeight).toBe(0);
    expect(snap.storageSlots[0].occupiedBy).toBe('b2');
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
    expect(snap.hint.storage).toMatchObject({ level: 0, ready: true });
    expect(snap.hint.targetBoxId).toBe('b2');
    expect(press(state)).toEqual([{ type: 'boxPicked', boxId: 'b2', fromZoneId: null, level: 0, fromSlotId: 'r1:0:0', skin: 'rack' }]);
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
    expect(snap.storageSlots.map((s) => s.satisfied)).toEqual([false, false, false]);
  });

  it('a stack parked on a column front cell is lifted as off the racks: forks at its top box, no slot selected', () => {
    const parked = level(`
# 9 · Pila delante
id: pila-delante
limit: 2

  0123456
0 ...R...
1 ...a...
2 ...^...
3 .......
4 .b.....

a = pila menta,azul
b = caja coral
R = estantería frente sur: azul / menta / coral
`);
    const state = new GameState(parked);
    const snap = state.getSnapshot();
    run(state, 0.5, IDLE);
    // Facing the rack one cell back, but what the action lifts is the stack's top box: the forks go to its level.
    expect(snap.hint.targetBoxId).toBe('b2');
    expect(snap.hint.storage).toBeNull();
    expect(snap.forklift.forkHeight).toBe(1);
    // No slot is selected there, so F / V do nothing.
    run(state, 0.3, fork(1));
    expect(snap.hint.storage).toBeNull();
    expect(snap.forklift.forkHeight).toBe(1);
    expect(press(state)).toEqual([{ type: 'boxPicked', boxId: 'b2', fromZoneId: null, level: 1 }]);
    // Carrying at the rack: its bottom slot is selected again, the load held over what is left of the stack.
    expect(snap.hint.storage).toMatchObject({ level: 0 });
    run(state, 0.3, IDLE);
    expect(snap.forklift.forkHeight).toBe(1);
  });
});

describe('storage racks: a destined box locks, a wrong target says so', () => {
  type Dropped = Extract<GameEvent, { type: 'boxDropped' }>;
  const dropOf = (events: readonly GameEvent[]) => events.find((e): e is Dropped => e.type === 'boxDropped');

  /**
   * A «any blue» zone in front of the rack: blue ▲ fits it (a trap, its destiny is the rack slot), blue ● is its box.
   * `front` = the one right in front of the forklift.
   */
  const zoneTrap = (front: 'azul ▲' | 'azul ●') =>
    level(`
# 7 · Zona trampa
id: zona-trampa
limit: 1

  0123456
0 ...R...
1 .......
2 ...1...
3 ...a...
4 ...^.c.

1 = zona azul
a = caja ${front}
c = caja ${front === 'azul ▲' ? 'azul ●' : 'azul ▲'}
R = estantería frente sur: azul ▲
`);

  /** Blue ● starts locked on its zone (its destiny); the mint box to carry toward it (limit 2: stacking allowed). */
  const ON_TOP = level(`
# 9 · Encima no
id: encima-no
limit: 2

  0123456
0 ...R...
1 .......
2 ...1...
3 ...a...
4 ...^...

1 = zona azul + caja azul ●
a = caja menta
R = estantería frente sur: menta
`);

  it('its destined box locks in its slot: no longer a pick target, the action there is a gentle actionIdle', () => {
    const state = new GameState(FRONT);
    const snap = state.getSnapshot();
    expect(snap.boxes.map((b) => b.locked)).toEqual([false, false]);
    press(state);
    forward(state, 2);
    const drop = dropOf(press(state))!;
    expect(drop).toMatchObject({ slotId: 'r1:0:0', correct: true });
    expect(drop).not.toHaveProperty('wrongTarget');
    expect(snap.boxes[0]).toMatchObject({ slotId: 'r1:0:0', correct: true, locked: true });
    run(state, 0.3, IDLE);
    expect(snap.hint.targetBoxId).toBeNull();
    expect(snap.hint.storage).toMatchObject({ level: 0, slotId: 'r1:0:0', ready: false });
    for (let i = 0; i < 3; i++) expect(press(state)).toEqual([{ type: 'actionIdle', carrying: false }]);
    run(state, 0.5, input(0.3)); // pushing on changes nothing
    expect(snap.hint.targetBoxId).toBeNull();
    expect(types(press(state))).toEqual(['actionIdle']);
    expect(snap.storageSlots[0]).toMatchObject({ occupiedBy: 'b1', satisfied: true });
    expect(snap.boxes[0]).toMatchObject({ carried: false, locked: true });
    expect(snap.forklift.carrying).toBeNull();
    // The other slots of the column still work: nothing but that box is locked.
    selectLevel(state, 1);
    expect(snap.hint.storage).toMatchObject({ level: 1, ready: false });
  });

  it('a box that starts on its destiny starts locked; any other box starts free', () => {
    const snap = new GameState(ON_TOP).getSnapshot();
    const [mint, blue] = [snap.boxes.find((b) => b.color === 'mint')!, snap.boxes.find((b) => b.color === 'blue')!];
    expect(blue).toMatchObject({ zoneId: snap.zones[0].id, correct: true, locked: true });
    expect(mint.locked).toBe(false);
    // A trap in a slot (fits the cue, not its destiny) and a box in a slot it does not fit are free.
    const rack = new GameState(RACK_COLUMNS).getSnapshot();
    expect(rack.boxes.every((b) => !b.locked)).toBe(true);
  });

  it('a cued slot that gets the wrong box says so (wrongTarget) and the box stays free to pick up again', () => {
    const state = new GameState(TAKEN);
    const snap = state.getSnapshot();
    press(state);
    selectLevel(state, 1);
    forward(state, 1.5);
    const drop = dropOf(press(state))!;
    expect(drop).toMatchObject({ slotId: 'r1:0:1', correct: false, recipeLength: 1, wrongTarget: true });
    expect(snap.boxes[0]).toMatchObject({ slotId: 'r1:0:1', correct: false, locked: false });
    run(state, 0.3, IDLE);
    expect(snap.hint.targetBoxId).toBe('b1');
    expect(press(state)[0]).toMatchObject({ type: 'boxPicked', boxId: 'b1', fromSlotId: 'r1:0:1' });
  });

  it('a trap box that fits the cue is a wrong target too; a «libre» slot never is', () => {
    const decoy = new GameState(DECOY);
    press(decoy); // mint ▲ into the ▲ slot: fits, not its destiny
    forward(decoy, 2);
    expect(dropOf(press(decoy))).toMatchObject({ slotId: 'r1:0:0', correct: false, wrongTarget: true });
    expect(decoy.getSnapshot().boxes.find((b) => b.color === 'mint')!.locked).toBe(false);
    const free = new GameState(FRONT);
    press(free);
    selectLevel(free, 2);
    forward(free, 2);
    const drop = dropOf(press(free))!;
    expect(drop).toMatchObject({ slotId: 'r1:0:2', recipeLength: 0, correct: false });
    expect(drop).not.toHaveProperty('wrongTarget');
    expect(free.getSnapshot().boxes[0].locked).toBe(false);
  });

  it('plain floor in a level with racks is never a wrong target', () => {
    const state = new GameState(FRONT);
    press(state);
    const drop = dropOf(press(state))!; // parked on the rack's front cell (the load is not at the face)
    expect(drop).toMatchObject({ cell: { x: 3, z: 1 }, zoneId: null, correct: false, recipeLength: 0 });
    expect(drop).not.toHaveProperty('wrongTarget');
    expect(drop).not.toHaveProperty('slotId');
  });

  it('a floor zone that gets a box fitting its cue but not its destiny is a wrong target; its own box locks there', () => {
    const state = new GameState(zoneTrap('azul ▲'));
    const snap = state.getSnapshot();
    const zone = snap.zones[0];
    press(state); // blue ▲, right in front
    expect(snap.forklift.carrying).toBe('b1');
    runUntil(state, () => snap.hint.dropZoneId === zone.id, input(0.3));
    const wrong = dropOf(press(state))!;
    expect(wrong).toMatchObject({ boxId: 'b1', zoneId: zone.id, correct: false, recipeLength: 1, wrongTarget: true });
    expect(snap.boxes[0]).toMatchObject({ zoneId: zone.id, correct: false, locked: false });
    // Still free: it comes off again (and nothing is released: the zone never lit).
    runUntil(state, () => snap.hint.targetBoxId === 'b1', input(0.3));
    expect(press(state)).toEqual([{ type: 'boxPicked', boxId: 'b1', fromZoneId: zone.id, level: 0 }]);
    // Its destined box, blue ●, the same way: it locks there.
    const other = new GameState(zoneTrap('azul ●'));
    const s2 = other.getSnapshot();
    press(other);
    expect(s2.forklift.carrying).toBe('b1');
    runUntil(other, () => s2.hint.dropZoneId === zone.id, input(0.3));
    const right = dropOf(press(other))!;
    expect(right).toMatchObject({ boxId: 'b1', zoneId: zone.id, correct: true, satisfiedCount: 1 });
    expect(right).not.toHaveProperty('wrongTarget');
    expect(s2.boxes[0]).toMatchObject({ zoneId: zone.id, correct: true, locked: true });
    run(other, 0.5, input(0.3));
    expect(s2.hint.targetBoxId).toBeNull();
    expect(press(other)).toEqual([{ type: 'actionIdle', carrying: false }]);
  });

  it('a locked box on a zone is never picked: the same approach that lifts a free box there gives actionIdle', () => {
    /** Blue ● (destined, locked) or blue ▲ (a trap, free) on the «any blue» zone, the forklift driving up to it. */
    const zoneWith = (box: string) =>
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

1 = zona azul + caja ${box}
c = caja ${box === 'azul ▲' ? 'azul ●' : 'azul ▲'}
R = estantería frente sur: azul ▲
`);
    const free = new GameState(zoneWith('azul ▲'));
    const locked = new GameState(zoneWith('azul ●'));
    expect(free.getSnapshot().boxes[0].locked).toBe(false);
    expect(locked.getSnapshot().boxes[0].locked).toBe(true);
    let frames = 0;
    while (free.getSnapshot().hint.targetBoxId !== 'b1' && frames < 300) {
      free.update(DT, input(0.3));
      frames++;
    }
    expect(free.getSnapshot().hint.targetBoxId).toBe('b1');
    for (let i = 0; i < frames; i++) locked.update(DT, input(0.3));
    const snap = locked.getSnapshot();
    expect(snap.forklift.pos).toEqual(free.getSnapshot().forklift.pos);
    expect(snap.hint.targetBoxId).toBeNull();
    expect(press(locked)).toEqual([{ type: 'actionIdle', carrying: false }]);
    expect(types(press(free))).toEqual(['boxPicked']);
    expect(snap.boxes[0]).toMatchObject({ carried: false, locked: true, zoneId: snap.zones[0].id });
    expect(snap.zones[0].satisfied).toBe(true);
  });

  it('nothing is dropped or stacked on a locked box: the load meets it like a full stack, the forks stay down', () => {
    const state = new GameState(ON_TOP);
    const snap = state.getSnapshot();
    const blue = snap.boxes.find((b) => b.color === 'blue')!;
    press(state); // the mint box
    expect(snap.forklift.carrying).toBe('b2');
    const heights: number[] = [];
    for (let t = 0; t < 2; t += DT) {
      state.update(DT, input(0.6));
      heights.push(snap.forklift.forkHeight);
      expect(snap.hint.dropCell).not.toEqual({ x: 3, z: 2 });
    }
    expect(Math.max(...heights)).toBe(0);
    // The load rests against the blue box (collider radius + half a box away) instead of passing over it.
    const load = snap.boxes.find((b) => b.carried)!;
    expect(load.pos.z - blue.pos.z).toBeGreaterThanOrEqual(carriedBoxRadius + GAME_CONFIG.box.size / 2 - 0.01);
    const drop = dropOf(press(state));
    expect(drop?.cell).not.toEqual({ x: 3, z: 2 });
    expect(snap.zones[0]).toMatchObject({ stack: [blue.id], satisfied: true });
    expect(blue).toMatchObject({ level: 0, locked: true });
  });

  it('lifting a wrong box off a zone leaves its destined box there locked, without a jolt under the load', () => {
    const stacked = makeLevel({
      size: { width: 7, depth: 7 },
      forklift: { x: 3, z: 3, heading: 180 },
      stackLimit: 2,
      racks: [{ id: 'r1', x: 3, z: 0, w: 1, facing: 'south', columns: [[{ color: 'mint' }]] }],
      zones: [{ id: 'z', color: 'blue', x: 3, z: 2 }],
      boxes: [
        { id: 'blue', color: 'blue', x: 3, z: 2 },
        { id: 'mint', color: 'mint', x: 3, z: 2 },
      ],
    });
    const state = new GameState(stacked);
    const snap = state.getSnapshot();
    const blue = snap.boxes[0];
    expect(blue).toMatchObject({ correct: true, locked: false });
    expect(snap.zones[0].satisfied).toBe(false);
    run(state, 0.8, IDLE); // the forks rise to the mint box on top
    expect(snap.hint.targetBoxId).toBe('mint');
    expect(types(press(state))).toEqual(['firstInput', 'boxPicked', 'zoneRestored']);
    expect(blue.locked).toBe(true);
    // The load was just lifted off it: it stays over it (forks held up, no push-out) until it backs away.
    const pos = { ...snap.forklift.pos };
    run(state, 0.3, IDLE);
    expect(snap.forklift.forkHeight).toBe(1);
    expect(snap.forklift.pos).toEqual(pos);
    expect(snap.hint.dropCell).not.toEqual({ x: 3, z: 2 });
    run(state, 2.5, input(-1));
    run(state, 1.5, IDLE);
    expect(snap.boxes[1].pos.z - blue.pos.z).toBeGreaterThan(carriedBoxRadius + GAME_CONFIG.box.size / 2 + 0.1); // clear of it
    expect(snap.forklift.forkHeight).toBe(0);
    // Coming back, the load meets it like a full stack.
    run(state, 2, input(0.6));
    expect(snap.forklift.forkHeight).toBe(0);
    expect(snap.hint.dropCell).not.toEqual({ x: 3, z: 2 });
  });
});

describe('levels without racks: no lock, no wrong target (as before)', () => {
  /** Classic: a blue box right in front, a mint zone just past it, the blue zone further away. */
  const CLASSIC = () =>
    makeLevel({
      forklift: { x: 2, z: 2, heading: 90 },
      boxes: [
        { id: 'b', color: 'blue', x: 3, z: 2 },
        { id: 'm', color: 'mint', x: 0, z: 0 },
      ],
      zones: [
        { id: 'zm', color: 'mint', x: 4, z: 2 },
        { id: 'zb', color: 'blue', x: 6, z: 4 },
      ],
    });

  it('a box dropped on a zone of another colour: the very same event as ever, and the box stays free', () => {
    const state = new GameState(CLASSIC());
    const snap = state.getSnapshot();
    press(state);
    expect(snap.forklift.carrying).toBe('b');
    runUntil(state, () => snap.hint.dropZoneId === 'zm', input(0.3));
    expect(press(state)).toEqual([
      { type: 'boxDropped', boxId: 'b', cell: { x: 4, z: 2 }, zoneId: 'zm', level: 0, correct: false, recipeLength: 1, satisfiedCount: 0, total: 2 },
    ]);
    expect(snap.boxes[0]).toMatchObject({ zoneId: 'zm', correct: false, locked: false });
    // A satisfied zone does not lock its box either: it can be lifted off again, as always.
    const done = new GameState(
      makeLevel({
        forklift: { x: 2, z: 2, heading: 90 },
        boxes: [
          { id: 'b', color: 'blue', x: 3, z: 2 },
          { id: 'm', color: 'mint', x: 0, z: 0 },
        ],
        zones: [
          { id: 'zb', color: 'blue', x: 3, z: 2 },
          { id: 'zm', color: 'mint', x: 6, z: 4 },
        ],
      }),
    );
    expect(done.getSnapshot().zones[0].satisfied).toBe(true);
    expect(done.getSnapshot().boxes[0]).toMatchObject({ correct: true, locked: false });
    expect(press(done)).toEqual([
      { type: 'firstInput' },
      { type: 'boxPicked', boxId: 'b', fromZoneId: 'zb', level: 0 },
      { type: 'zoneReleased', zoneId: 'zb', boxId: 'b' },
    ]);
  });

  it('never locks a box nor flags a wrong target under random play (classic, stacking, sorting and levels 1–3)', () => {
    const stacking = makeLevel({
      forklift: { x: 2, z: 2, heading: 90 },
      stackLimit: 3,
      boxes: [
        { id: 'a', color: 'mint', x: 3, z: 2 },
        { id: 'b', color: 'blue', x: 3, z: 2 },
        { id: 'c', color: 'coral', x: 4, z: 1 },
      ],
      zones: [
        { id: 'z', color: 'blue', recipe: ['blue', 'mint'], x: 4, z: 3 },
        { id: 'y', color: 'coral', x: 5, z: 2 },
      ],
    });
    const sorting = makeLevel({
      forklift: { x: 2, z: 2, heading: 90 },
      boxes: [
        { id: 'a', color: 'blue', symbol: 'triangle', x: 3, z: 2 },
        { id: 'b', color: 'mint', symbol: 'circle', x: 4, z: 1 },
      ],
      zones: [
        { id: 't', symbol: 'triangle', x: 4, z: 3 },
        { id: 'm', color: 'mint', x: 5, z: 2 },
      ],
    });
    let drops = 0;
    for (const lvl of [CLASSIC(), stacking, sorting, ...LEVELS.filter((l) => !storageOf(l).some((unit) => unit.skin === 'rack'))]) {
      const r = rng(lvl.boxes.length * 31 + lvl.zones.length);
      const state = new GameState(lvl);
      for (let i = 0; i < 1500; i++) {
        const events = state.update(r() < 0.1 ? 1 / 20 : DT, input(r() * 2 - 1, r() * 2 - 1, r() < 0.03 ? 1 : 0, r() < 0.05));
        for (const e of events) {
          expect(e).not.toHaveProperty('wrongTarget');
          if (e.type === 'boxDropped') drops++;
        }
        for (const b of state.getSnapshot().boxes) expect(b.locked).toBe(false);
      }
    }
    expect(drops).toBeGreaterThan(0);
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
    const state = new GameState(AT_RACK);
    state.update(DT, { ...IDLE, forkStep: 3 as unknown as 1 });
    state.update(DT, { ...IDLE, forkStep: Number.NaN as unknown as 1 });
    expect(state.getSnapshot().hint.storage?.level).toBe(0);
  });
});
