import { describe, expect, it } from 'vitest';
import { angleDelta } from '../core/math';
import type { GameEvent, InputFrame } from '../core/types';
import { parseLevel } from '../data/asciiLevel';
import { CONVEYOR, ConveyorSystem, buttonRefusal, type ConveyorHost } from './conveyor';
import { GameState } from './GameState';
import { LevelGrid } from './grid';
import { objectivesLeft } from './objectives';
import { IDLE, press, run, types } from './testUtils';

/*
 * A conveyor belt's button (docs/CONVEYOR.md, H2): a mushroom cap on a post on a cell of its own, next to the belt's
 * input. Facing it (as a rack column is faced to pick from it), the action presses it, the forks empty or carrying, and
 * nothing is picked or dropped meanwhile. Accepted only with the belt at rest, its input's slot empty, nothing of the
 * forklift in it and a box to bring back (one that reached an exit without being locked there: the last one first):
 * the belt runs in reverse, the same eased ride mirrored, and the box rests on the input again, pickable at its level.
 * Otherwise nothing moves (a soft «no»). The press and the ride back count no move, «Quedan N» stays as it was and a
 * return never completes the level. Deterministic at 60 and 20 fps.
 */

const level = (text: string) => parseLevel(`${text.trim()}\n`, 'prueba.level').level;
const input = (throttle = 0, steer = 0, forkStep: -1 | 0 | 1 = 0): InputFrame => ({ move: { x: 0, z: 0 }, drive: { throttle, steer }, actionPressed: false, forkStep });

/**
 * A belt from its input A (3,2) north to its end exit B (3,0), «menta» (menta ▲'s), its button «o» at (2,2), west of A.
 * The forklift faces A with azul ● (the azul zone's) on A's front cell: sent down the belt, it is a wrong box at B.
 */
const BUTTON_TEXT = `
# 1 · Cinta con botón
id: cinta-boton
limit: 1

  0123456
0 ..pBp..
1 ...~...
2 ..oA...
3 ...a...
4 ...^...
5 ...b.1.
6 .......

1 = zona azul
a = caja azul ●     b = caja menta ▲
A = cinta entrada   B = cinta final: menta   ~ = cinta   o = cinta botón
`;
const BUTTON = level(BUTTON_TEXT);

type Pressed = Extract<GameEvent, { type: 'beltButton' }>;
type Returned = Extract<GameEvent, { type: 'beltReturned' }>;
const pressed = (events: readonly GameEvent[]) => events.find((e): e is Pressed => e.type === 'beltButton');
const returned = (events: readonly GameEvent[]) => events.find((e): e is Returned => e.type === 'beltReturned');

/** World centre of map cell (x, z) of the BUTTON level (7 × 7). */
const centre = (x: number, z: number) => ({ x: x + 0.5 - 3.5, z: z + 0.5 - 3.5 });

/**
 * One press of F (+1) or V (−1), then the forks left to reach the level chosen, and one frame more (as in
 * GameState.conveyor.test).
 */
function forkTo(state: GameState, step: -1 | 1, dt: number): GameEvent[] {
  const events = [...state.update(dt, input(0, 0, step))];
  const target = state.getSnapshot().hint.storage?.level ?? 0;
  for (let t = 0; t < 3 && state.getSnapshot().forklift.forkHeight !== target; t += dt) events.push(...state.update(dt, IDLE));
  events.push(...state.update(dt, IDLE));
  return events;
}

/** Turn in place (world-space move, as the stick does) until the forklift faces (dx, dz). */
function face(state: GameState, dx: number, dz: number, dt: number): void {
  const heading = Math.atan2(dx, dz);
  for (let t = 0; t < 5 && Math.abs(angleDelta(state.getSnapshot().forklift.heading, heading)) > 0.005; t += dt)
    state.update(dt, { move: { x: dx * 0.08, z: dz * 0.08 }, actionPressed: false });
  run(state, 0.5, IDLE, dt);
}

/** Drive (world-space moves, easing off near it) until the forklift's centre stands on cell (x, z)'s, then stop. */
function goTo(state: GameState, x: number, z: number, dt: number): void {
  const p = centre(x, z);
  for (let t = 0; t < 10; t += dt) {
    const f = state.getSnapshot().forklift.pos;
    const dx = p.x - f.x;
    const dz = p.z - f.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.04) break;
    const mag = Math.max(0.12, Math.min(1, dist / 0.9));
    state.update(dt, { move: { x: (dx / dist) * mag, z: (dz / dist) * mag }, actionPressed: false });
  }
  run(state, 0.6, IDLE, dt);
}

/** Every frame until `done` (at most `maxSec`): the time after each frame, its events, and what `sample` reads then. */
function framesUntil<T>(state: GameState, dt: number, done: (events: GameEvent[]) => boolean, sample: () => T, maxSec = 10) {
  const frames: { t: number; events: GameEvent[]; value: T }[] = [];
  for (let t = dt; t < maxSec; t += dt) {
    const events = state.update(dt, IDLE);
    frames.push({ t, events, value: sample() });
    if (done(events)) return frames;
  }
  throw new Error('framesUntil: never done');
}

/** Azul ● picked off A's front cell, F at the table, set down on A: its ride to B (a wrong box there) waited out. */
function sendAzulToB(state: GameState, dt: number): GameEvent[] {
  press(state, dt);
  run(state, 2, input(1), dt);
  forkTo(state, 1, dt);
  const events = [...press(state, dt)];
  events.push(...framesUntil(state, dt, (e) => e.some((x) => x.type === 'beltDelivered'), () => null).flatMap((f) => f.events));
  return events;
}

/** Back out of A to its front's back (S), the forks down there (V), then to (2,4) facing the button, north. */
function toTheButton(state: GameState, dt: number): void {
  run(state, 1, input(-1), dt);
  forkTo(state, -1, dt);
  goTo(state, 2, 4, dt);
  face(state, 0, -1, dt);
}

describe.each([
  ['60 fps', 1 / 60],
  ['20 fps', 1 / 20],
] as const)('a conveyor belt\'s button in the game state (%s)', (_, dt) => {
  it('a wrong box at B comes back: the belt runs back, the box rests on A again, pickable at level 1; no move, «Quedan N» as it was', () => {
    const state = new GameState(BUTTON);
    const snap = state.getSnapshot();
    expect(snap.hint.button).toBeNull();
    const sent = sendAzulToB(state, dt);
    expect(sent.find((e) => e.type === 'beltDelivered')).toMatchObject({ boxId: 'b1', slotId: 's1:0:1', correct: false, wrongTarget: true });
    const box = snap.boxes[0];
    expect(box).toMatchObject({ slotId: 's1:0:1', locked: false });
    expect([snap.moves, objectivesLeft(snap), snap.progress.satisfied]).toEqual([1, 2, 0]);
    toTheButton(state, dt);
    // Facing it, within reach: the action presses it (the hint names its belt), nothing would be picked or dropped.
    expect(snap.hint).toMatchObject({ button: 'c1', targetBoxId: null, dropCell: null });
    const travel = snap.conveyors[0].travel;
    const events = press(state, dt);
    expect(events).toEqual([{ type: 'beltButton', conveyorId: 'c1', accepted: true, boxId: 'b1', fromSlotId: 's1:0:1' }]);
    // At once in A's slot (sealed: out of reach while it rides back), from where it rests, B empty; no move.
    expect(box).toMatchObject({ slotId: 'e1:0:1', cell: { x: 3, z: 2 }, level: 1, correct: false, locked: false });
    expect(box.pos).toEqual(centre(3, 0));
    expect(snap.storageSlots.find((s) => s.id === 's1:0:1')?.occupiedBy).toBeNull();
    expect(snap.storageSlots.find((s) => s.id === 'e1:0:1')?.occupiedBy).toBe('b1');
    expect(snap.conveyors[0]).toMatchObject({ phase: 'settling', boxId: 'b1', direction: -1, progress: 1, running: false, presses: 1, accepted: 1 });
    expect([snap.moves, objectivesLeft(snap), snap.progress.satisfied]).toEqual([1, 2, 0]);
    const frames = framesUntil(
      state,
      dt,
      (e) => e.some((x) => x.type === 'beltReturned'),
      () => ({ z: box.pos.z, x: box.pos.x, travel: snap.conveyors[0].travel, phase: snap.conveyors[0].phase, left: objectivesLeft(snap), picked: snap.hint.targetBoxId }),
    );
    // It starts back once the cap is up (pressSec), the hum's run as long as the ride out; it arrives within a frame.
    const startedAt = frames.find((f) => f.events.some((e) => e.type === 'beltStarted'))!;
    const runSec = 2 / CONVEYOR.speed + CONVEYOR.rampSec;
    expect(startedAt.events.find((e) => e.type === 'beltStarted')).toEqual({ type: 'beltStarted', conveyorId: 'c1', boxId: 'b1', runSec: expect.closeTo(runSec, 9), rampSec: CONVEYOR.rampSec, reverse: true });
    const since = (t: number) => t + dt; // the press frame counts too
    expect(since(startedAt.t) - CONVEYOR.pressSec).toBeGreaterThanOrEqual(-1e-9);
    expect(since(startedAt.t) - CONVEYOR.pressSec).toBeLessThan(dt + 1e-9);
    const end = frames.at(-1)!;
    expect(since(end.t) - CONVEYOR.pressSec - runSec).toBeGreaterThanOrEqual(-1e-9);
    expect(since(end.t) - CONVEYOR.pressSec - runSec).toBeLessThan(dt + 1e-9);
    // South, straight, never back north, from B to A; its surface (the stripes) going back by the same 2 cells.
    const zs = [centre(3, 0).z, ...frames.map((f) => f.value.z)];
    zs.slice(1).forEach((z, i) => expect(z).toBeGreaterThanOrEqual(zs[i] - 1e-12));
    for (const f of frames) expect(f.value.x).toBeCloseTo(centre(3, 0).x, 12);
    const travels = [travel, ...frames.map((f) => f.value.travel)];
    travels.slice(1).forEach((v, i) => expect(v).toBeLessThanOrEqual(travels[i] + 1e-12));
    expect(travel - snap.conveyors[0].travel).toBeCloseTo(2, 9);
    // Soft at both ends, never faster than the belt.
    const steps = zs.slice(1).map((z, i) => z - zs[i]);
    for (const s of steps) expect(s).toBeLessThanOrEqual(CONVEYOR.speed * dt + 1e-9);
    const moving = steps.filter((s) => s > 0);
    expect(moving[0]).toBeLessThan(0.5 * CONVEYOR.speed * dt);
    expect(moving.at(-1)!).toBeLessThan(0.5 * CONVEYOR.speed * dt);
    // Out of reach on its way, «Quedan N» never changing, no completion.
    expect(frames.every((f) => f.value.left === 2 && f.value.picked === null)).toBe(true);
    expect(frames.flatMap((f) => types(f.events))).not.toContain('levelComplete');
    expect(returned(end.events)).toEqual({ type: 'beltReturned', conveyorId: 'c1', boxId: 'b1', slotId: 'e1:0:1', skin: 'beltIn', level: 1 });
    expect(box.pos).toEqual(centre(3, 2));
    expect(snap.conveyors[0]).toMatchObject({ phase: 'idle', boxId: null, direction: 1, running: false, progress: 0 });
    expect([snap.moves, objectivesLeft(snap), snap.progress.satisfied, snap.completed]).toEqual([1, 2, 0, false]);
    // It stays on A (the belt only loads on a drop), and is picked back at level 1, as any box waiting there.
    run(state, 2, IDLE, dt);
    expect(box.slotId).toBe('e1:0:1');
    goTo(state, 3, 4, dt);
    face(state, 0, -1, dt);
    forkTo(state, 1, dt);
    for (let t = 0; t < 3 && snap.hint.targetBoxId !== 'b1'; t += dt) state.update(dt, input(0.3));
    expect(press(state, dt)).toEqual([{ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 1, fromSlotId: 'e1:0:1', skin: 'beltIn' }]);
    expect(snap.moves).toBe(1);
  });

  it('refused, nothing moves: nothing to bring back, the belt busy (running back), A taken', () => {
    const state = new GameState(BUTTON);
    const snap = state.getSnapshot();
    const refusal = () => {
      const e = pressed(press(state, dt));
      return e && !e.accepted ? e.reason : e ? 'accepted' : 'none';
    };
    // Nothing at B yet.
    goTo(state, 2, 4, dt);
    face(state, 0, -1, dt);
    expect(snap.hint.button).toBe('c1');
    expect(refusal()).toBe('nothing');
    expect(snap.conveyors[0]).toMatchObject({ phase: 'idle', presses: 1, accepted: 0 });
    // Azul ● sent to B (a wrong box there), then brought back: pressed again while it rides back, the belt is busy.
    goTo(state, 3, 4, dt);
    face(state, 0, -1, dt);
    sendAzulToB(state, dt);
    toTheButton(state, dt);
    expect(refusal()).toBe('accepted');
    expect(refusal()).toBe('busy');
    framesUntil(state, dt, (e) => e.some((x) => x.type === 'beltReturned'), () => null);
    // Back on A, it takes A's slot: pressed again, A is taken (and there is nothing more to bring back anyway).
    expect(refusal()).toBe('input');
    // Picked off A and set down on A again with B empty: it rides to B once more (no move: where it was picked).
    run(state, 0.5, input(-1), dt);
    goTo(state, 3, 4, dt);
    face(state, 0, -1, dt);
    forkTo(state, 1, dt);
    for (let t = 0; t < 3 && snap.hint.targetBoxId !== 'b1'; t += dt) state.update(dt, input(0.3));
    press(state, dt);
    expect(snap.forklift.carrying).toBe('b1');
    expect(types(press(state, dt))).toEqual(['boxDropped']);
    expect(snap.moves).toBe(1);
    framesUntil(state, dt, (e) => e.some((x) => x.type === 'beltDelivered'), () => null);
    // Menta ▲ set down on A with B full: it stays there, and A taken refuses the press.
    run(state, 1, input(-1), dt);
    forkTo(state, -1, dt);
    face(state, 0, 1, dt);
    press(state, dt);
    expect(snap.forklift.carrying).toBe('b2');
    face(state, 0, -1, dt);
    run(state, 2.5, input(1), dt);
    forkTo(state, 1, dt);
    expect(types(press(state, dt))).toEqual(['boxDropped', 'beltBlocked']);
    toTheButton(state, dt);
    expect(refusal()).toBe('input');
    // No refusal moved a box or counted a move; every press counted for the cap.
    expect(snap.boxes.map((b) => b.slotId)).toEqual(['s1:0:1', 'e1:0:1']);
    expect(snap.moves).toBe(2);
    expect(snap.conveyors[0]).toMatchObject({ phase: 'idle', presses: 5, accepted: 1 });
  });

  it('busy while a box rides out to B, too', () => {
    // The button west of the cell behind A's front: faced right after backing out of A.
    const state = new GameState(level(BUTTON_TEXT.replace('2 ..oA...', '2 ...A...').replace('4 ...^...', '4 ..o^...')));
    const snap = state.getSnapshot();
    press(state, dt);
    run(state, 2, input(1), dt);
    forkTo(state, 1, dt);
    expect(types(press(state, dt))).toEqual(['boxDropped']);
    run(state, 0.6, input(-1), dt);
    forkTo(state, -1, dt);
    face(state, -1, 0, dt);
    expect(snap.hint.button).toBe('c1');
    expect(snap.conveyors[0].phase).not.toBe('idle');
    expect(pressed(press(state, dt))).toEqual({ type: 'beltButton', conveyorId: 'c1', accepted: false, reason: 'busy' });
    // The ride goes on as if nothing happened.
    const delivered = framesUntil(state, dt, (e) => e.some((x) => x.type === 'beltDelivered'), () => null).at(-1)!;
    expect(delivered.events.find((e) => e.type === 'beltDelivered')).toMatchObject({ boxId: 'b1', wrongTarget: true });
  });

  it('a box locked at B (its destined one) never comes back: nothing to bring back', () => {
    // «azul» at the end of the belt: azul ● is its destined box, and locks there.
    const state = new GameState(level(BUTTON_TEXT.replace('cinta final: menta', 'cinta final: azul').replace('1 = zona azul', '1 = zona menta')));
    const snap = state.getSnapshot();
    const sent = sendAzulToB(state, dt);
    expect(sent.find((e) => e.type === 'beltDelivered')).toMatchObject({ boxId: 'b1', correct: true });
    expect(snap.boxes[0].locked).toBe(true);
    toTheButton(state, dt);
    expect(pressed(press(state, dt))).toEqual({ type: 'beltButton', conveyorId: 'c1', accepted: false, reason: 'nothing' });
    expect(snap.boxes[0]).toMatchObject({ slotId: 's1:0:1', locked: true });
  });

  it('the press needs the forklift facing the button within reach, from any free side; carrying too', () => {
    const state = new GameState(BUTTON);
    const snap = state.getSnapshot();
    // Carrying a box, facing it, the action presses it (it never drops the box beside it).
    press(state, dt);
    expect(snap.forklift.carrying).toBe('b1');
    run(state, 0.8, input(-1), dt);
    goTo(state, 2, 4, dt);
    face(state, 0, -1, dt);
    expect(snap.hint).toMatchObject({ button: 'c1', dropCell: null });
    expect(pressed(press(state, dt))).toMatchObject({ accepted: false, reason: 'nothing' });
    expect(snap.forklift.carrying).toBe('b1');
    face(state, 1, 0, dt);
    expect(types(press(state, dt))).toEqual(['boxDropped']);
    // Two cells off, facing it: out of reach (the action is the forklift's own: nothing in front, a soft idle).
    goTo(state, 2, 5, dt);
    face(state, 0, -1, dt);
    expect(snap.hint.button).toBeNull();
    expect(types(press(state, dt))).toEqual(['actionIdle']);
    // One cell off, turned away (west): not aimed either.
    goTo(state, 2, 4, dt);
    face(state, -1, 0, dt);
    expect(snap.hint.button).toBeNull();
    // From its west side, facing east; from its north side, facing south.
    goTo(state, 1, 4, dt);
    goTo(state, 1, 2, dt);
    face(state, 1, 0, dt);
    expect(snap.hint.button).toBe('c1');
    goTo(state, 1, 1, dt);
    goTo(state, 2, 1, dt);
    face(state, 0, 1, dt);
    expect(snap.hint.button).toBe('c1');
    expect(pressed(press(state, dt))).toMatchObject({ accepted: false, reason: 'nothing' });
    expect(snap.conveyors[0]).toMatchObject({ presses: 2, accepted: 0 });
  });
});

describe('the button\'s rules (logic/conveyor.ts buttonRefusal): the first that applies, in order', () => {
  const at = { busy: false, inputTaken: false, forksInInput: false, returnable: 1 };
  it('accepted only with the belt at rest, its input empty, nothing of the forklift in it and a box to bring back', () => {
    expect(buttonRefusal(at)).toBeNull();
    expect(buttonRefusal({ ...at, returnable: 0 })).toBe('nothing');
    expect(buttonRefusal({ ...at, forksInInput: true })).toBe('forks');
    expect(buttonRefusal({ ...at, inputTaken: true })).toBe('input');
    expect(buttonRefusal({ ...at, busy: true })).toBe('busy');
    expect(buttonRefusal({ busy: true, inputTaken: true, forksInInput: true, returnable: 0 })).toBe('busy');
    expect(buttonRefusal({ ...at, inputTaken: true, forksInInput: true, returnable: 0 })).toBe('input');
    expect(buttonRefusal({ ...at, forksInInput: true, returnable: 0 })).toBe('forks');
  });
});

describe('ConveyorSystem running back (logic/conveyor.ts)', () => {
  /** A fresh belt of the BUTTON level, the boxes as the snapshot holds them; host calls recorded. */
  function belt() {
    const calls: string[] = [];
    const host: ConveyorHost = {
      started: (b) => calls.push(`started ${b}`),
      arrived: (b, box) => calls.push(`arrived ${b} ${box}`),
      returned: (b, box) => calls.push(`returned ${b} ${box}`),
    };
    const system = new ConveyorSystem(BUTTON, new LevelGrid(BUTTON));
    const boxes = structuredClone(new GameState(BUTTON).getSnapshot().boxes);
    return { system, boxes, calls, host };
  }

  it('keeps the boxes that may come back in the order they arrived: the last one first (LIFO)', () => {
    const { system } = belt();
    expect([system.returnableCount(0), system.takeLast(0)]).toEqual([0, -1]);
    system.keep(0, 4);
    system.keep(0, 7);
    system.keep(0, 2);
    expect(system.returnableCount(0)).toBe(3);
    expect([system.takeLast(0), system.takeLast(0), system.takeLast(0), system.takeLast(0)]).toEqual([2, 7, 4, -1]);
  });

  it('a run back: settling for pressSec, then the ride mirrored from the end exit to the input; one host call each, then at rest', () => {
    const runs = [1 / 60, 1 / 20, 1 / 7].map((dt) => {
      const { system, boxes, calls, host } = belt();
      boxes[0].pos = { ...centre(3, 0) };
      system.reverse(0, 0, 'b1');
      expect(system.states[0]).toMatchObject({ phase: 'settling', boxId: 'b1', direction: -1, progress: 1, travel: 0 });
      expect(system.isIdle(0)).toBe(false);
      let startedAt = -1;
      let returnedAt = -1;
      let zAt = Number.NaN;
      for (let frame = 1; returnedAt < 0 && frame < 10_000; frame++) {
        system.update(dt, boxes, host);
        const t = frame * dt;
        if (startedAt < 0 && calls.includes('started 0')) startedAt = t;
        if (calls.includes('returned 0 0')) returnedAt = t;
        if (Math.abs(t - 1) < 1e-9) zAt = boxes[0].pos.z;
        if (system.states[0].running) expect(system.states[0].direction).toBe(-1);
      }
      expect(calls).toEqual(['started 0', 'returned 0 0']);
      expect(system.states[0]).toEqual({ id: 'c1', phase: 'idle', boxId: null, progress: 0, running: false, direction: 1, travel: expect.closeTo(-2, 9), presses: 0, accepted: 0 });
      expect(system.isIdle(0)).toBe(true);
      expect(boxes[0].pos.z).toBeCloseTo(centre(3, 2).z, 12);
      return { dt, startedAt, returnedAt, zAt, runSec: system.runSecOf(0) };
    });
    for (const r of runs) {
      expect(r.startedAt - CONVEYOR.pressSec).toBeGreaterThanOrEqual(-1e-9);
      expect(r.startedAt - CONVEYOR.pressSec).toBeLessThan(r.dt + 1e-9);
      expect(r.returnedAt - CONVEYOR.pressSec - r.runSec).toBeGreaterThanOrEqual(-1e-9);
      expect(r.returnedAt - CONVEYOR.pressSec - r.runSec).toBeLessThan(r.dt + 1e-9);
    }
    // At t = 1 s (a frame boundary at 60 and 20 fps) the box is at the same point of the run back.
    expect(runs[0].zAt).toBeCloseTo(runs[1].zAt, 9);
  });

  it('the press counts follow every press, and the accepted ones', () => {
    const { system } = belt();
    system.pressed(0, false);
    system.pressed(0, true);
    system.pressed(0, false);
    expect(system.states[0]).toMatchObject({ presses: 3, accepted: 1 });
  });
});
