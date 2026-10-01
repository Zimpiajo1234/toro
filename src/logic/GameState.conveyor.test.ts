import { describe, expect, it } from 'vitest';
import { angleDelta } from '../core/math';
import type { GameEvent, InputFrame } from '../core/types';
import { parseLevel } from '../data/asciiLevel';
import { CONVEYOR, ConveyorSystem, type ConveyorHost } from './conveyor';
import { GameState } from './GameState';
import { LevelGrid } from './grid';
import { objectivesLeft } from './objectives';
import { IDLE, press, run, types } from './testUtils';

/*
 * Conveyor belts (docs/CONVEYOR.md, H1): a box set down on a belt's input (a «libre» slot at floor level, loaded from
 * the front like a rack slot) rests there a moment, then rides the belt into its end exit, which the forklift never
 * works. One box at a time: while it settles or rides, the input holds it out of reach; with the end exit full a box
 * set down on the input stays there (soft buzz, pickable again). At the end exit its destined box satisfies the slot and
 * locks; any other box there buzzes. The drop on the input is the move; the ride counts none, and a box on its way
 * still counts in «Quedan N». Deterministic at 60 and 20 fps.
 */

const level = (text: string) => parseLevel(`${text.trim()}\n`, 'prueba.level').level;
const input = (throttle = 0, steer = 0): InputFrame => ({ move: { x: 0, z: 0 }, drive: { throttle, steer }, actionPressed: false });

/**
 * A belt from the input A (3,2) north to its end exit B (3,0), «azul», plants each side of B. The forklift faces A with
 * blue ● on A's front cell; mint ▲ waits behind it, for the zone.
 */
const LINE = (exit = 'azul', zone = 'menta') =>
  level(`
# 1 · Cinta
id: cinta
limit: 1

  0123456
0 ..pBp..
1 ...~...
2 ...A...
3 ...a...
4 ...^...
5 ...b.1.
6 .......

1 = zona ${zone}
a = caja azul ●     b = caja menta ▲
A = cinta entrada   B = cinta final: ${exit}   ~ = cinta
`);

type Dropped = Extract<GameEvent, { type: 'boxDropped' }>;
type Delivered = Extract<GameEvent, { type: 'beltDelivered' }>;
const dropped = (events: readonly GameEvent[]) => events.find((e): e is Dropped => e.type === 'boxDropped');
const delivered = (events: readonly GameEvent[]) => events.find((e): e is Delivered => e.type === 'beltDelivered');

/** Hold W / S for `seconds` (the rig stops by itself with its load in the input). */
const forward = (state: GameState, seconds: number, dt: number) => run(state, seconds, input(1), dt);
const backward = (state: GameState, seconds: number, dt: number) => run(state, seconds, input(-1), dt);

/** Turn in place (world-space move, as the stick does) until the forklift faces (dx, dz). */
function face(state: GameState, dx: number, dz: number, dt: number): void {
  const heading = Math.atan2(dx, dz);
  for (let t = 0; t < 5 && Math.abs(angleDelta(state.getSnapshot().forklift.heading, heading)) > 0.005; t += dt)
    state.update(dt, { move: { x: dx * 0.08, z: dz * 0.08 }, actionPressed: false });
  run(state, 0.5, IDLE, dt);
}

/** Pick blue ● off A's front cell and set it down on the input: the events of the drop. */
function loadInput(state: GameState, dt: number): GameEvent[] {
  press(state, dt);
  expect(state.getSnapshot().forklift.carrying).toBe('b1');
  forward(state, 2, dt);
  expect(state.getSnapshot().hint.storage).toMatchObject({ level: 0, slotId: 'e1:0:0', skin: 'beltIn', ready: true });
  return press(state, dt);
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

describe.each([
  ['60 fps', 1 / 60],
  ['20 fps', 1 / 20],
] as const)('a conveyor belt in the game state (%s)', (_, dt) => {
  it('a box set down on the input settles, then rides into the end exit, which it lights and locks: the drop is the move', () => {
    const state = new GameState(LINE());
    const snap = state.getSnapshot();
    expect(snap.conveyors).toEqual([{ id: 'c1', phase: 'idle', boxId: null, progress: 0, running: false, travel: 0 }]);
    expect(objectivesLeft(snap)).toBe(2);
    const drop = dropped(loadInput(state, dt));
    expect(drop).toEqual({
      type: 'boxDropped',
      boxId: 'b1',
      cell: { x: 3, z: 2 },
      zoneId: null,
      level: 0,
      correct: false,
      recipeLength: 0,
      satisfiedCount: 0,
      total: 2,
      slotId: 'e1:0:0',
      skin: 'beltIn',
    }); // a belt's input is «libre»: never a wrong target
    expect(snap.moves).toBe(1);
    expect(snap.conveyors[0]).toMatchObject({ phase: 'settling', boxId: 'b1', running: false });
    // On its way it is out of reach: facing the input, the forks at its level, nothing to lift.
    expect(snap.hint.targetBoxId).toBeNull();
    expect(types(press(state, dt))).toEqual(['actionIdle']);

    const box = snap.boxes[0];
    const startZ = box.pos.z;
    const frames = framesUntil(
      state,
      dt,
      (events) => events.some((e) => e.type === 'beltDelivered'),
      () => ({ z: box.pos.z, x: box.pos.x, phase: snap.conveyors[0].phase, travel: snap.conveyors[0].travel, left: objectivesLeft(snap), picked: snap.hint.targetBoxId }),
    );
    const startedAt = frames.find((f) => f.events.some((e) => e.type === 'beltStarted'))!;
    const started = startedAt.events.find((e) => e.type === 'beltStarted')!;
    const runSec = 2 / CONVEYOR.speed + CONVEYOR.rampSec; // its path: the input's centre, one belt cell, the end exit's
    expect(started).toEqual({ type: 'beltStarted', conveyorId: 'c1', boxId: 'b1', runSec: expect.closeTo(runSec, 9), rampSec: CONVEYOR.rampSec });
    // It settles first, then runs: each within a frame of its time, whatever the frame rate (the frame of the drop and
    // the press after it count too).
    const since = (t: number) => t + 2 * dt;
    expect(since(startedAt.t) - CONVEYOR.settleSec).toBeGreaterThanOrEqual(-1e-9);
    expect(since(startedAt.t) - CONVEYOR.settleSec).toBeLessThan(dt + 1e-9);
    const end = frames.at(-1)!;
    expect(since(end.t) - CONVEYOR.settleSec - runSec).toBeGreaterThanOrEqual(-1e-9);
    expect(since(end.t) - CONVEYOR.settleSec - runSec).toBeLessThan(dt + 1e-9);
    // The belt's surface moves only while it runs; the box goes straight north, never back, from A to B.
    const values = frames.map((f) => f.value);
    for (const f of frames.filter((f) => f.t < startedAt.t)) expect([f.value.z, f.value.travel, f.value.phase]).toEqual([startZ, 0, 'settling']);
    const zs = [startZ, ...values.map((v) => v.z)];
    zs.slice(1).forEach((z, i) => expect(z).toBeLessThanOrEqual(zs[i] + 1e-12));
    for (const v of values) expect(v.x).toBeCloseTo(box.pos.x, 12);
    expect(startZ - box.pos.z).toBeCloseTo(2, 9);
    // A soft start and a soft stop: never faster than the belt, slow at both ends.
    const steps = zs.slice(1).map((z, i) => zs[i] - z);
    for (const s of steps) expect(s).toBeLessThanOrEqual(CONVEYOR.speed * dt + 1e-9);
    const moving = steps.filter((s) => s > 0);
    expect(moving[0]).toBeLessThan(0.5 * CONVEYOR.speed * dt);
    expect(moving.at(-1)!).toBeLessThan(0.5 * CONVEYOR.speed * dt);
    expect(Math.max(...moving)).toBeGreaterThan(0.95 * CONVEYOR.speed * dt);
    // Still counted in «Quedan N» on its way, still out of reach.
    expect(values.slice(0, -1).every((v) => v.left === 2 && v.picked === null)).toBe(true);
    // In the end exit: satisfied and locked for good, the input free again; the ride is no move.
    expect(delivered(end.events)).toEqual({
      type: 'beltDelivered',
      conveyorId: 'c1',
      boxId: 'b1',
      slotId: 's1:0:0',
      skin: 'beltOut',
      correct: true,
      recipeLength: 1,
      satisfiedCount: 1,
      total: 2,
    });
    expect(box).toMatchObject({ carried: false, cell: { x: 3, z: 0 }, level: 0, slotId: 's1:0:0', correct: true, locked: true });
    const exit = snap.storageSlots.find((s) => s.id === 's1:0:0')!;
    expect(box.pos.x).toBe(exit.pos.x);
    expect(box.pos.z).toBe(exit.pos.z);
    expect(exit).toMatchObject({ occupiedBy: 'b1', satisfied: true });
    expect(snap.storageSlots.find((s) => s.id === 'e1:0:0')).toMatchObject({ occupiedBy: null });
    expect(snap.conveyors[0]).toMatchObject({ phase: 'idle', boxId: null, running: false, travel: expect.closeTo(2, 9) });
    expect([snap.moves, objectivesLeft(snap), snap.progress.satisfied]).toEqual([1, 1, 1]);
    // It stays there: the belt idle, its surface still.
    run(state, 2, IDLE, dt);
    expect(snap.conveyors[0].travel).toBeCloseTo(2, 9);
    expect(box.slotId).toBe('s1:0:0');
  });

  it('one box at a time: with the end exit full a box set down on the input stays there, buzzes softly and is picked again', () => {
    const state = new GameState(LINE());
    const snap = state.getSnapshot();
    loadInput(state, dt);
    framesUntil(state, dt, (events) => events.some((e) => e.type === 'beltDelivered'), () => null);
    // Mint ▲ from behind, onto the input.
    backward(state, 1, dt);
    face(state, 0, 1, dt);
    press(state, dt);
    expect(snap.forklift.carrying).toBe('b2');
    face(state, 0, -1, dt);
    forward(state, 2.5, dt);
    const events = press(state, dt);
    expect(dropped(events)).toMatchObject({ boxId: 'b2', slotId: 'e1:0:0', skin: 'beltIn', correct: false });
    expect(events.find((e) => e.type === 'beltBlocked')).toEqual({ type: 'beltBlocked', conveyorId: 'c1', boxId: 'b2' });
    expect(snap.moves).toBe(2);
    // The belt never starts; the box rests on the input and nothing changes there.
    const after = run(state, CONVEYOR.settleSec + 4, IDLE, dt);
    expect(after.some((e) => e.type === 'beltStarted' || e.type === 'beltDelivered')).toBe(false);
    expect(snap.conveyors[0]).toMatchObject({ phase: 'idle', boxId: null, travel: expect.closeTo(2, 9) });
    expect(snap.boxes[1]).toMatchObject({ slotId: 'e1:0:0', cell: { x: 3, z: 2 }, locked: false });
    expect(objectivesLeft(snap)).toBe(1);
    // Pickable again, from the input as from a slot.
    expect(snap.hint.targetBoxId).toBe('b2');
    expect(press(state, dt)).toEqual([{ type: 'boxPicked', boxId: 'b2', fromZoneId: null, level: 0, fromSlotId: 'e1:0:0', skin: 'beltIn' }]);
  });

  it('a box that is not the end exit\'s destiny buzzes when it gets there and stays (only the button, later, brings it back)', () => {
    // «menta» at the end of the belt: blue ● is the zone's.
    const state = new GameState(LINE('menta', 'azul'));
    const snap = state.getSnapshot();
    expect(dropped(loadInput(state, dt))).not.toHaveProperty('wrongTarget');
    const frames = framesUntil(state, dt, (events) => events.some((e) => e.type === 'beltDelivered'), () => null);
    expect(delivered(frames.at(-1)!.events)).toEqual({
      type: 'beltDelivered',
      conveyorId: 'c1',
      boxId: 'b1',
      slotId: 's1:0:0',
      skin: 'beltOut',
      correct: false,
      recipeLength: 1,
      satisfiedCount: 0,
      total: 2,
      wrongTarget: true,
    });
    expect(snap.boxes[0]).toMatchObject({ slotId: 's1:0:0', correct: false, locked: false });
    expect([snap.moves, objectivesLeft(snap)]).toEqual([1, 2]);
    // The forklift never works the end exit: its box is never a pick target, and stays there.
    backward(state, 1, dt);
    run(state, 1, IDLE, dt);
    expect(snap.hint.targetBoxId).toBeNull();
    expect(snap.boxes[0].slotId).toBe('s1:0:0');
  });
});

describe('ConveyorSystem (logic/conveyor.ts)', () => {
  const lineLevel = LINE();
  /** A fresh belt and boxes as the snapshot holds them; host calls recorded. */
  function belt() {
    const calls: string[] = [];
    const host: ConveyorHost = { started: (b) => calls.push(`started ${b}`), arrived: (b, box) => calls.push(`arrived ${b} ${box}`) };
    const system = new ConveyorSystem(lineLevel, new LevelGrid(lineLevel));
    const boxes = structuredClone(new GameState(lineLevel).getSnapshot().boxes);
    return { system, boxes, calls, host };
  }
  /** Runs a loaded belt at `dt` until it hands its box over: when it started and arrived, and the box z at time `at`. */
  function ride(dt: number, at = 1) {
    const { system, boxes, calls, host } = belt();
    system.load(0, 0, 'b1');
    let startedAt = -1;
    let arrivedAt = -1;
    let zAt = Number.NaN;
    for (let frame = 1; arrivedAt < 0 && frame < 10_000; frame++) {
      system.update(dt, boxes, host);
      const t = frame * dt;
      if (startedAt < 0 && calls.includes('started 0')) startedAt = t;
      if (calls.includes('arrived 0 0')) arrivedAt = t;
      if (Math.abs(t - at) < 1e-9) zAt = boxes[0].pos.z;
    }
    return { startedAt, arrivedAt, zAt, calls, system };
  }

  it('one host call each: started once settled, arrived at the end exit; then idle', () => {
    const { calls, system } = ride(1 / 60);
    expect(calls).toEqual(['started 0', 'arrived 0 0']);
    expect(system.states[0]).toEqual({ id: 'c1', phase: 'idle', boxId: null, progress: 0, running: false, travel: expect.closeTo(2, 9) });
    expect(system.boxOn(0)).toBe(-1);
  });

  it('deterministic: the same curve at 60, 20 and 7 fps, arriving within a frame of settleSec + runSec', () => {
    const runSec = 2 / CONVEYOR.speed + CONVEYOR.rampSec;
    const runs = [1 / 60, 1 / 20, 1 / 7].map((dt) => ({ dt, ...ride(dt) }));
    for (const r of runs) {
      expect(r.system.runSecOf(0)).toBeCloseTo(runSec, 12);
      expect(r.startedAt - CONVEYOR.settleSec).toBeGreaterThanOrEqual(-1e-9);
      expect(r.startedAt - CONVEYOR.settleSec).toBeLessThan(r.dt + 1e-9);
      expect(r.arrivedAt - CONVEYOR.settleSec - runSec).toBeGreaterThanOrEqual(-1e-9);
      expect(r.arrivedAt - CONVEYOR.settleSec - runSec).toBeLessThan(r.dt + 1e-9);
    }
    // At t = 1 s (a frame boundary at 60 and 20 fps) the box is at the same point of the run.
    expect(runs[0].zAt).toBeCloseTo(runs[1].zAt, 9);
  });

  it('does nothing without a box, or with dt ≤ 0', () => {
    const { system, boxes, calls, host } = belt();
    const before = structuredClone(boxes);
    for (const dt of [1 / 60, 0, -1, Number.NaN]) system.update(dt, boxes, host);
    system.load(0, 0, 'b1');
    for (const dt of [0, -1, Number.NaN]) system.update(dt, boxes, host);
    expect(calls).toEqual([]);
    expect(boxes).toEqual(before);
    expect(system.states[0]).toMatchObject({ phase: 'settling', travel: 0 });
  });
});
