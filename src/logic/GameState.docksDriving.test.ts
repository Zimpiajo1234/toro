import { describe, expect, it } from 'vitest';
import { trucksOf } from '../core/docks';
import { angleDelta, degToRad } from '../core/math';
import type { GameEvent, InputFrame } from '../core/types';
import { GAME_CONFIG } from '../config';
import { BENCHMARK_ID, getSpecialLevel } from '../data/levels';
import { GameState } from './GameState';

/*
 * Driving into the Benchmark's dock door the way a player does (docs/DOCKS.md «Barandillas»): the autopilot always
 * drives dead straight along a column's centre line, which is how a jam at the door went unnoticed. Here the rig comes
 * through the row behind the door, from a cell further back (its load just short of the guard rails' mouth), a little
 * off the column's centre line and a little crooked, and the player only holds W (vehicle controls: the heading assist
 * straightens small errors by itself), at 60 and 20 fps: carrying a box onto the bed, with empty tines to lift the box
 * on the bed, and backing out with S. Over the whole grid:
 * - nothing ever lands in (or is lifted from) a column other than the one of the door cell the body stands on;
 * - S always backs out freely: the rig moves back and the load leaves the door;
 * - lined up within 5° (what the assist straightens), whatever the offset, the load goes in straight, into the column
 *   it aimed at, in a normal time (ENTRY_SEC at most, most of them in about 1.3–1.5 s).
 * More crooked, the rig may stop before the door (a rail's end or a plant in the way), drift into the next column (and
 * land there, by the rule above), go in crooked or, with its load already in the door, jam: the guard rail holds the
 * body, the neighbouring column's shut span holds the load and the heading holds while the load is in the door, so W
 * gets it no further (S frees it). That is pending a design decision (docs/DOCKS.md «Barandillas»).
 */

const level = getSpecialLevel(BENCHMARK_ID)!;
const { width, depth } = level.size;
const { carriedBoxRadius, forkReach } = GAME_CONFIG.forklift;
const IDLE: InputFrame = { move: { x: 0, z: 0 }, actionPressed: false };
const ACTION: InputFrame = { move: { x: 0, z: 0 }, actionPressed: true };
const drive = (throttle: number): InputFrame => ({ move: { x: 0, z: 0 }, drive: { throttle, steer: 0 }, actionPressed: false });
const centreX = (x: number) => x + 0.5 - width / 2;
const centreZ = (z: number) => z + 0.5 - depth / 2;
const wallZ = -depth / 2;
const NORTH = Math.PI;

/** The door cell of each bed column: (1,0) and (2,0). */
const DOORS = trucksOf(level)[0].columns.map((_, column) => trucksOf(level)[0].x + column);
/** Lateral offsets (u, + = east) and heading errors (degrees, + = turned east) of the approach. */
const OFFSETS = [0, 0.05, -0.05, 0.1, -0.1, 0.2, -0.2, 0.3, -0.3];
const ERRORS = [0, 5, -5, 10, -10, 15, -15, 25, -25];
/** Lined up at least this well, the rig always goes in straight. */
const LINED_UP_DEG = 5;
/** The slowest entry lined up within LINED_UP_DEG (a load sliding round a rail's end), and the usual one (median). */
const ENTRY_SEC = 3;
const ENTRY_MEDIAN_SEC = 1.5;
/** Holding S this long always backs the rig out. */
const BACK_SEC = 2.5;

/** Set the forklift's pose (the snapshot is the state the controller moves), then let it settle. */
function place(state: GameState, x: number, z: number, heading: number, dt: number): void {
  const f = state.getSnapshot().forklift;
  f.pos.x = x;
  f.pos.z = z;
  f.heading = heading;
  f.speed = 0;
  hold(state, IDLE, 0.5, dt);
}

function hold(state: GameState, frame: InputFrame, seconds: number, dt: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) events.push(...state.update(dt, frame));
  return events;
}

/** Hold `frame` until the rig has stood still for 0.3 s (at most `max` s); `each` runs after every frame. */
function holdUntilStill(state: GameState, frame: InputFrame, dt: number, max: number, each: (t: number) => void): void {
  const f = state.getSnapshot().forklift;
  let still = 0;
  let [x, z] = [f.pos.x, f.pos.z];
  for (let t = dt; t <= max; t += dt) {
    state.update(dt, frame);
    each(t);
    still = Math.hypot(f.pos.x - x, f.pos.z - z) < 2e-4 ? still + dt : 0;
    [x, z] = [f.pos.x, f.pos.z];
    if (still >= 0.3) return;
  }
}

/** Lift the azul ✚ from the cell south of it, (6,2) facing north. */
function carrying(dt: number): GameState {
  const state = new GameState(level);
  place(state, centreX(6), centreZ(2), NORTH, dt);
  state.update(dt, ACTION);
  expect(state.getSnapshot().forklift.carrying).toBe('b7');
  hold(state, IDLE, 0.6, dt);
  return state;
}

/** A state with a box to lift from bed column `column`: its wrong load on column 0; the azul ✚ put on column 1. */
function withBedBox(column: number, dt: number): GameState {
  if (column === 0) return new GameState(level);
  const state = carrying(dt);
  place(state, centreX(DOORS[column]), centreZ(2), NORTH, dt);
  holdUntilStill(state, drive(1), dt, 4, () => {});
  expect(state.update(dt, ACTION).some((e) => e.type === 'boxDropped')).toBe(true);
  hold(state, drive(-1), 2, dt);
  hold(state, IDLE, 0.5, dt);
  return state;
}

type Outcome = 'in' | 'drift' | 'stop' | 'stuck';
interface Approach {
  outcome: Outcome;
  /** Seconds of W until the drop (or the lift) was offered. */
  entry: number;
  /** Heading error (degrees) when the rig came to rest. */
  crooked: number;
  /** Seconds of S until the rig was back out (Infinity: it never got out). */
  back: number;
}

/**
 * From the cell two rows behind the door cell of bed column `column`, `offset` off its centre line and `errorDeg`
 * crooked, hold W until the rig stands still; act if the hint offers the truck; then hold S. Carrying: `empty` false.
 */
function approach(column: number, offset: number, errorDeg: number, empty: boolean, dt: number): Approach {
  const state = empty ? withBedBox(column, dt) : carrying(dt);
  const snap = state.getSnapshot();
  const f = snap.forklift;
  place(state, centreX(DOORS[column]) + offset, centreZ(2), NORTH - degToRad(errorDeg), dt);
  const load = () => (f.carrying ? snap.boxes.find((b) => b.id === f.carrying)!.pos : null);
  /** How far the load's leading edge (the fork point, with empty tines) is past the wall line. */
  const past = () => {
    const l = load();
    return l ? wallZ - (l.z - carriedBoxRadius) : wallZ - (f.pos.z + Math.cos(f.heading) * forkReach);
  };
  const offered = () =>
    empty ? snap.boxes.find((b) => b.id === snap.hint.targetBoxId)?.slotId != null : snap.hint.storage?.skin === 'truck';
  let entry = Infinity;
  holdUntilStill(state, drive(1), dt, 6, (t) => {
    if (entry === Infinity && offered()) entry = t;
  });
  const crooked = Math.abs(angleDelta(f.heading, NORTH)) * (180 / Math.PI);
  const bodyDoor = Math.floor(f.pos.x + width / 2);
  let outcome: Outcome;
  if (offered()) {
    const events = state.update(dt, ACTION);
    const done = events.find((e) => e.type === 'boxDropped' || e.type === 'boxPicked') as { slotId?: string; fromSlotId?: string } | undefined;
    const id = done?.slotId ?? done?.fromSlotId;
    expect(id, 'acting on an offered truck column').toBeDefined();
    const at = Number(id!.split(':')[1]);
    // Only ever the column of the door cell the body stands on.
    expect(DOORS[at], `landed in column ${at} with the body on door cell ${bodyDoor}`).toBe(bodyDoor);
    outcome = at === column ? 'in' : 'drift';
  } else outcome = !empty && past() > 0.03 ? 'stuck' : 'stop';
  hold(state, IDLE, 0.3, dt);
  // S backs it out: the rig moves back and the load (if any) leaves the door.
  const z0 = f.pos.z;
  let back = Infinity;
  for (let t = dt; t <= BACK_SEC; t += dt) {
    state.update(dt, drive(-1));
    if (f.pos.z > z0 + 0.5 && (load() === null || past() < -0.1)) {
      back = t;
      break;
    }
  }
  return { outcome, entry, crooked, back };
}

describe('driving into the dock like a player: a little off, a little crooked, holding W', () => {
  it.each([
    ['60 fps, carrying', 1 / 60, false],
    ['20 fps, carrying', 1 / 20, false],
    ['60 fps, empty tines (lifting the box on the bed)', 1 / 60, true],
    ['20 fps, empty tines (lifting the box on the bed)', 1 / 20, true],
  ] as const)('%s: the right column only, S always backs out, lined up within 5° always straight in', (_, dt, empty) => {
    const entries: number[] = [];
    for (let column = 0; column < DOORS.length; column++) {
      for (const offset of OFFSETS) {
        for (const error of ERRORS) {
          const at = `column ${column + 1}, offset ${offset}, ${error}°`;
          const run = approach(column, offset, error, empty, dt);
          expect(run.back, `${at}: backing out`).toBeLessThanOrEqual(BACK_SEC);
          if (Math.abs(error) > LINED_UP_DEG) continue;
          expect(run.outcome, at).toBe('in');
          expect(run.crooked, `${at}: straight`).toBeLessThanOrEqual(2);
          expect(run.entry, `${at}: entry time`).toBeLessThanOrEqual(ENTRY_SEC);
          entries.push(run.entry);
        }
      }
    }
    entries.sort((a, b) => a - b);
    expect(entries[Math.floor(entries.length / 2)]).toBeLessThanOrEqual(ENTRY_MEDIAN_SEC);
  });
});
