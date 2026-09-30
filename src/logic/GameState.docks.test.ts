import { describe, expect, it } from 'vitest';
import { angleDelta, degToRad, wrapAngle } from '../core/math';
import { cueFits, isDestined } from '../core/sorting';
import type { GameEvent, InputFrame } from '../core/types';
import { GAME_CONFIG } from '../config';
import { parseLevel } from '../data/asciiLevel';
import { LEVELS } from '../data/levels';
import { GameState, TRUCK_FACE_ANGLE, TRUCK_REACH } from './GameState';
import { DOOR_JAMB, PLANT_SIZE, pointRectDistance } from './collision';
import { DT, IDLE, forkPoint, press, run, runUntil } from './testUtils';

/*
 * Loading docks (docs/DOCKS.md): the truck waits outside, its rear against the wall at the dock door. The door cells
 * are floor; the forklift stands on one facing the wall and loads the bed column beyond it through the door like a
 * floor stack (automatic fork height), bottom → top. Its body stops at the wall line; only the forks and the load go
 * through the door, straight in and out. A level is satisfied only with its destined box on satisfied levels, its box
 * then locked (never lifted) while the next level still loads on top; any other box there buzzes (wrongTarget).
 */

const level = (text: string) => parseLevel(`${text.trim()}\n`, 'prueba.level').level;
const input = (throttle = 0, steer = 0, forkStep: -1 | 0 | 1 = 0): InputFrame => ({ move: { x: 0, z: 0 }, drive: { throttle, steer }, actionPressed: false, forkStep });
const { bodyRadius, carriedBoxRadius } = GAME_CONFIG.forklift;

/** Hold W / S (the rig stops by itself against the wall at the door). */
const forward = (state: GameState, seconds = 2.5, dt = DT) => run(state, seconds, input(1), dt);
/** Hold S until the body centre is back at world z ≥ `z` (a north dock: away from the wall), then let it settle. */
function backTo(state: GameState, z: number, dt = DT): GameEvent[] {
  const events = runUntil(state, () => state.getSnapshot().forklift.pos.z >= z, input(-1), 6, dt);
  return [...events, ...run(state, 0.6, IDLE, dt)];
}

/**
 * Put the forklift on `cell`'s centre facing `headingDeg` (0 = +z, 90 = east, 270 = west), then let it settle: a pose
 * between the guard rails on a door cell, which a door closed at its sides only lets it reach by backing in.
 */
function put(state: GameState, cell: { x: number; z: number }, headingDeg: number, dt = DT): void {
  const snap = state.getSnapshot();
  const { width, depth } = snap.level.size;
  snap.forklift.pos.x = cell.x + 0.5 - width / 2;
  snap.forklift.pos.z = cell.z + 0.5 - depth / 2;
  snap.forklift.heading = wrapAngle(degToRad(headingDeg));
  run(state, 0.5, IDLE, dt);
}

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

/** A rig pinned against a wall (or a shut door) may press its load this far into it (the push-out tolerance). */
const SQUEEZE = 0.02;
/** World z of the north wall line (a north dock's bed lies beyond it, z < wall). */
const wallZ = (depth: number) => -depth / 2;
/** World z of the centre of map row `z`. */
const rowZ = (z: number, depth: number) => z + 0.5 - depth / 2;

/**
 * A two-column truck outside the north wall (door cells (1,0) and (2,0), bed columns at z = -1): «azul» under «▲», and
 * «coral ◆». The forklift faces the first door cell with azul ● on the cell ahead; menta ▲ waits east of it.
 */
const DOCK = level(`
# 1 · Muelle
id: muelle
limit: 2

  012345
0 pTTp..
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
0 pTTp..
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
0 pTTp..
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
0 pTp.
1 ....
2 .a..
3 .^..

a = caja menta ▲
T = camión muelle norte: azul + caja azul ● / ▲
`);

/**
 * A door closed at its sides: carrying along the wall toward it, the plant beside it (behind its guard rail) stops the
 * rig and the bed is never offered.
 */
const SIDE = level(`
# 6 · De lado
id: de-lado
limit: 1

  0123456
0 pTTp.a<
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
0 pTp..
1 .....
2 .>a1.
3 ....b

1 = zona azul
a = caja menta ▲     b = caja azul ●
T = camión muelle norte: ▲
`);

/** A west dock (door cells (0,1) and (0,2), bed columns at x = -1), its second column loaded with a wrong box. */
const WEST = level(`
# 8 · Muelle oeste
id: muelle-oeste
limit: 1

  01234
0 p....
1 T.a<.
2 T....
3 p.b.1

1 = zona ▲
a = caja azul ●     b = caja coral ◆
T = camión muelle oeste: azul | coral ◆ + caja menta ▲
`);

/**
 * A door three cells wide, (2,0)–(4,0), with a plant right behind its first door cell: column 0 has no straight way
 * in (the solver finds no plan for it). The forklift starts in the corner, facing azul ●.
 */
const WIDE = level(`
# 9 · Puerta de tres
id: puerta-de-tres
limit: 1

  0123456
0 vpTTTp.
1 a.p....
2 .......
3 ....b.c

a = caja azul ●     b = caja coral ◆     c = caja menta ▲
T = camión muelle norte: azul | coral | menta
`);

describe('loading docks: snapshot', () => {
  it('lists every truck slot (column by column, bottom → top) with its bed cell outside and its door cell inside', () => {
    const snap = new GameState(DOCK).getSnapshot();
    expect(snap.truckSlots?.map((s) => s.id)).toEqual(['t1:0:0', 't1:0:1', 't1:1:0']);
    const [bottom, top, coral] = snap.truckSlots!;
    expect(bottom).toMatchObject({
      truckId: 't1',
      column: 0,
      level: 0,
      cell: { x: 1, z: -1 },
      front: { x: 1, z: 0 },
      wall: 'north',
      facing: 'south',
      pos: { x: 1.5 - DOCK.size.width / 2, z: -0.5 - DOCK.size.depth / 2 },
      accepts: { color: 'blue' },
      destined: { color: 'blue', symbol: 'circle' },
      occupiedBy: null,
      satisfied: false,
      loadable: true,
    });
    expect(top).toMatchObject({ level: 1, accepts: { symbol: 'triangle' }, destined: { color: 'mint', symbol: 'triangle' }, loadable: false });
    expect(coral).toMatchObject({ column: 1, cell: { x: 2, z: -1 }, front: { x: 2, z: 0 }, accepts: { color: 'coral', symbol: 'diamond' }, loadable: true });
    expect(snap.progress).toEqual({ satisfied: 0, total: 3 });
    expect(snap.boxes.every((b) => b.truckSlotId === null && !b.locked)).toBe(true);
    expect(snap.hint.dropTruckSlotId).toBeNull();
    expect(snap.hint.rack).toBeNull();

    const plain = new GameState(LEVELS[0]).getSnapshot();
    expect(plain).not.toHaveProperty('truckSlots');
    expect(plain.hint).not.toHaveProperty('dropTruckSlotId');
    for (const box of plain.boxes) expect(box).not.toHaveProperty('truckSlotId');
  });

  it('a box that starts on its destined level (outside, on the bed) is locked from the start; the level above is next', () => {
    const state = new GameState(STARTED);
    const snap = state.getSnapshot();
    const loaded = snap.boxes.find((b) => b.color === 'blue')!;
    expect(loaded).toMatchObject({ cell: { x: 1, z: -1 }, level: 0, truckSlotId: 't1:0:0', correct: true, locked: true, zoneId: null, slotId: null });
    expect(loaded.pos).toEqual({ x: 1.5 - STARTED.size.width / 2, z: wallZ(STARTED.size.depth) - 0.5 });
    expect(snap.truckSlots!.map((s) => [s.satisfied, s.loadable])).toEqual([
      [true, false],
      [false, true],
    ]);
    expect(snap.progress).toEqual({ satisfied: 1, total: 2 });
  });

  it('a west dock: bed columns at x = -1, a box loaded there at the start sits on its column', () => {
    const snap = new GameState(WEST).getSnapshot();
    expect(snap.truckSlots!.map((s) => [s.cell, s.front, s.facing])).toEqual([
      [{ x: -1, z: 1 }, { x: 0, z: 1 }, 'east'],
      [{ x: -1, z: 2 }, { x: 0, z: 2 }, 'east'],
    ]);
    const mint = snap.boxes.find((b) => b.color === 'mint')!;
    expect(mint).toMatchObject({ cell: { x: -1, z: 2 }, level: 0, truckSlotId: 't1:1:0', correct: false, locked: false });
    expect(mint.pos).toEqual({ x: -0.5 - WEST.size.width / 2, z: 2.5 - WEST.size.depth / 2 });
    expect(snap.truckSlots![1]).toMatchObject({ occupiedBy: mint.id, satisfied: false, loadable: false });
  });
});

describe('loading docks: the door, the wall and the automatic fork height', () => {
  it('the body stops at the wall line; the load goes through the door onto the bed and the box lands there', () => {
    const state = new GameState(DOCK);
    const snap = state.getSnapshot();
    expect(snap.hint.targetBoxId).toBe('b1');
    const events = [...press(state), ...run(state, 0.3)];
    expect(picked(events)).toEqual({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    forward(state);
    const f = snap.forklift;
    const wall = wallZ(DOCK.size.depth);
    // Stopped by the wall, on the door cell: the body never passes the wall line.
    expect(f.pos.z).toBeGreaterThanOrEqual(wall + bodyRadius - 1e-3);
    expect(f.pos.z).toBeLessThan(wall + bodyRadius + 0.02);
    expect(f.pos.x).toBeCloseTo(1.5 - DOCK.size.width / 2, 2);
    // The fork point, and the load on it, stand on the bed beyond the door.
    expect(wall - forkPoint(state).z).toBeGreaterThan(TRUCK_REACH);
    expect(snap.boxes[0].pos.z + carriedBoxRadius).toBeLessThan(wall + 0.05);
    expect(snap.hint).toMatchObject({ dropCell: { x: 1, z: -1 }, dropLevel: 0, dropZoneId: null, dropTruckSlotId: 't1:0:0', rack: null });
    const drop = dropped(press(state))!;
    expect(drop).toEqual({
      type: 'boxDropped',
      boxId: 'b1',
      cell: { x: 1, z: -1 },
      zoneId: null,
      level: 0,
      correct: true,
      recipeLength: 1,
      satisfiedCount: 1,
      total: 3,
      truckSlotId: 't1:0:0',
    });
    expect(snap.boxes[0]).toMatchObject({ cell: { x: 1, z: -1 }, level: 0, carried: false, truckSlotId: 't1:0:0', correct: true, locked: true });
    // It lands at the bed's centre, right under the forks (no jump through anything).
    expect(snap.boxes[0].pos).toEqual({ x: 1.5 - DOCK.size.width / 2, z: wall - 0.5 });
    expect(snap.truckSlots!.map((s) => [s.occupiedBy, s.satisfied, s.loadable])).toEqual([
      ['b1', true, false],
      [null, false, true],
      [null, false, true],
    ]);
  });

  it('with the load in the doorway short of the bed nothing can be dropped, and the heading holds until it is out', () => {
    const state = new GameState(DOCK);
    const snap = state.getSnapshot();
    press(state);
    run(state, 0.3);
    const wall = wallZ(DOCK.size.depth);
    // Creep until the load is well into the door, the fork point still short of TRUCK_REACH past the wall line.
    runUntil(state, () => snap.boxes[0].pos.z - carriedBoxRadius < wall - 0.15, input(0.25), 6);
    run(state, 0.6, IDLE);
    expect(wall - forkPoint(state).z).toBeLessThan(TRUCK_REACH);
    expect(snap.hint.dropCell).toBeNull();
    expect(snap.hint.dropTruckSlotId).toBeNull();
    expect(press(state)).toEqual([{ type: 'actionIdle', carrying: true }]);
    // Straight in or out only: steering does nothing, nor does a sideways move vector.
    const heading = snap.forklift.heading;
    run(state, 0.8, input(0, 1));
    run(state, 0.5, { move: { x: 1, z: 0 }, actionPressed: false });
    expect(snap.forklift.heading).toBe(heading);
    forward(state, 1.5);
    expect(snap.forklift.heading).toBe(heading);
    expect(snap.hint.dropTruckSlotId).toBe('t1:0:0');
    // Backing out, the heading is free again once the load has left the door.
    backTo(state, rowZ(1, DOCK.size.depth) + 0.3);
    expect(snap.boxes[0].pos.z - carriedBoxRadius).toBeGreaterThan(wall - 0.05);
    const out = snap.forklift.heading;
    run(state, 0.6, input(0, 1));
    expect(Math.abs(angleDelta(out, snap.forklift.heading))).toBeGreaterThan(0.3);
  });

  it('a satisfied truck box is locked (the action idles), but the next level loads on top of it at the right height', () => {
    const state = new GameState(DOCK);
    const snap = state.getSnapshot();
    press(state);
    forward(state);
    press(state);
    run(state, 0.3);
    // Facing it with empty forks through the door: nothing to lift, a gentle idle.
    expect(snap.hint.targetBoxId).toBeNull();
    expect(press(state)).toEqual([{ type: 'actionIdle', carrying: false }]);
    // Back to the aisle, lift menta ▲ and come back: the forks rise to level 1 by themselves.
    backTo(state, rowZ(3, DOCK.size.depth) - 0.15);
    face(state, 1, 0);
    expect(snap.hint.targetBoxId).toBe('b2');
    press(state);
    face(state, 0, -1);
    const approach = forward(state, 3);
    expect(approach.some((e) => e.type === 'boxDropped')).toBe(false);
    expect(snap.hint).toMatchObject({ dropCell: { x: 1, z: -1 }, dropLevel: 1, dropTruckSlotId: 't1:0:1' });
    expect(snap.forklift.forkHeight).toBeCloseTo(1, 5);
    const events = press(state);
    expect(dropped(events)).toMatchObject({ boxId: 'b2', cell: { x: 1, z: -1 }, level: 1, correct: true, recipeLength: 1, satisfiedCount: 2, truckSlotId: 't1:0:1' });
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
    for (let i = 0; i < 3; i++) state.update(DT, input(0, 0, 1));
    run(state, 0.5);
    expect(snap.hint.rack).toBeNull();
    expect(snap.forklift.forkHeight).toBe(0);
  });

  it('never from the side: the plant beside the door, behind its guard rail, stops a load carried along the wall', () => {
    const state = new GameState(SIDE);
    const snap = state.getSnapshot();
    press(state);
    run(state, 0.3);
    const seen: (string | null | undefined)[] = [];
    for (let i = 0; i < Math.round(6 / DT); i++) {
      state.update(DT, input(0.6));
      seen.push(snap.hint.dropTruckSlotId);
    }
    // Along row 0 up to the plant at (3,0): the load stops against it, never over a door cell, never the bed.
    const plantEast = 3 + 0.5 + PLANT_SIZE / 2 - SIDE.size.width / 2;
    expect(snap.boxes[0].pos.x - carriedBoxRadius).toBeGreaterThan(plantEast - SQUEEZE);
    expect(snap.boxes[0].pos.x - carriedBoxRadius).toBeLessThan(plantEast + 0.05);
    expect(seen.every((id) => id === null)).toBe(true);
    const drop = dropped(press(state))!;
    expect(drop).not.toHaveProperty('truckSlotId');
    expect(drop.cell.x).toBeGreaterThanOrEqual(4);
  });

  it('turning on a door cell with a load: the door stays shut like the wall until the rig faces the column in front of it', () => {
    const state = new GameState(SIDE);
    const snap = state.getSnapshot();
    press(state);
    run(state, 0.3);
    // Between the rails on the door cell (2,0), facing west along the wall with the load over the other one, (1,0).
    put(state, { x: 2, z: 0 }, 270);
    const west = snap.forklift.heading;
    const north = Math.PI;
    const load = snap.boxes[0].pos;
    // Stick north: the load meets the door like the wall beside it and the rig eases back as it turns; the load only
    // goes in once the rig faces the truck, and from then on the heading holds (it never turns with the load in).
    const past = () => wallZ(SIDE.size.depth) - (load.z - carriedBoxRadius);
    for (let i = 0; i < Math.round(2.5 / DT); i++) {
      const [heading, was] = [snap.forklift.heading, past()];
      state.update(DT, { move: { x: 0, z: -0.3 }, actionPressed: false });
      if (past() > SQUEEZE) expect(Math.abs(angleDelta(snap.forklift.heading, north))).toBeLessThanOrEqual(TRUCK_FACE_ANGLE);
      if (was > 0.05) expect(snap.forklift.heading).toBe(heading);
    }
    run(state, 0.5, IDLE);
    expect(Math.abs(angleDelta(west, snap.forklift.heading))).toBeGreaterThan(Math.PI / 3);
    expect(Math.abs(angleDelta(snap.forklift.heading, north))).toBeLessThanOrEqual(TRUCK_FACE_ANGLE);
    // It went in facing the truck, through the door of (2,0) only: never into the shut span of (1,0) beside it.
    expect(past()).toBeGreaterThan(0.05);
    const shut = { x0: 1 - SIDE.size.width / 2, z0: wallZ(SIDE.size.depth) - 1 };
    expect(pointRectDistance(load.x, load.z, shut.x0, shut.z0, shut.x0 + 1, shut.z0 + 1)).toBeGreaterThanOrEqual(carriedBoxRadius - SQUEEZE);
    // Swung in that crooked (the heading holds with the load in the door) it rubs the shut span beside it while the
    // guard rail holds the body: W may take it no further (docs/DOCKS.md «Barandillas», pending: a door that
    // straightens the rig), never into another column. S always backs it out; lined up with its door cell again, it
    // goes straight in, into the column of the door cell the body stands on, (2,0): never the one it swung over.
    forward(state, 1.5);
    expect([null, 't1:1:0']).toContain(snap.hint.dropTruckSlotId);
    backTo(state, rowZ(1, SIDE.size.depth) + 0.2);
    expect(past()).toBeLessThan(-0.05);
    put(state, { x: 2, z: 1 }, 180);
    forward(state, 3);
    expect(Math.floor(snap.forklift.pos.x + SIDE.size.width / 2)).toBe(2);
    expect(snap.hint.dropTruckSlotId).toBe('t1:1:0');
    expect(dropped(press(state))).toMatchObject({ truckSlotId: 't1:1:0', cell: { x: 2, z: -1 }, wrongTarget: true });
  });

  it.each([
    ['60 fps', 1 / 60],
    ['20 fps', 1 / 20],
  ] as const)('%s: a wide door takes a load only straight into the column in front of the body, never swung in on a door cell', (_, dt) => {
    const state = new GameState(WIDE);
    const snap = state.getSnapshot();
    const { width, depth } = WIDE.size;
    const north = Math.PI;
    const load = snap.boxes[0].pos;
    const cellX = (x: number) => Math.floor(x + width / 2);
    const past = () => wallZ(depth) - (load.z - carriedBoxRadius);
    /** Hold `frame` for `seconds`, checking every step: in a door only facing the truck, in line, then straight. */
    const hold = (frame: InputFrame, seconds: number) => {
      const events: GameEvent[] = [];
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        const [heading, was] = [snap.forklift.heading, past()];
        events.push(...state.update(dt, frame));
        if (past() > SQUEEZE) {
          expect(Math.abs(angleDelta(snap.forklift.heading, north))).toBeLessThanOrEqual(TRUCK_FACE_ANGLE);
          expect(cellX(load.x)).toBe(cellX(snap.forklift.pos.x));
        }
        if (was > 0.05) expect(snap.forklift.heading).toBe(heading);
      }
      return events;
    };
    const stick = (x: number, z: number): InputFrame => ({ move: { x, z }, actionPressed: false });
    /** Turn in place with the stick (as `face` does) until the forklift faces (dx, dz). */
    const turnTo = (dx: number, dz: number) => {
      const heading = Math.atan2(dx, dz);
      for (let t = 0; t < 5 && Math.abs(angleDelta(snap.forklift.heading, heading)) > 0.005; t += dt) hold(stick(dx * 0.08, dz * 0.08), dt);
      hold(IDLE, 0.5);
    };
    press(state, dt);
    hold(IDLE, 0.3);
    expect(snap.forklift.carrying).toBe('b1');
    // Between the rails on the first door cell (2,0), facing east along the wall with the load over the middle one.
    put(state, { x: 2, z: 0 }, 90, dt);
    expect(cellX(snap.forklift.pos.x)).toBe(2);
    // Turning left toward the truck there: the load meets the shut door like the wall and the rig eases back, but the
    // plant behind (2,1) stops it: the turn is refused, column 0 never opens (no straight way in, as the solver says).
    hold(input(0, 1), 2.5);
    expect(past()).toBeLessThanOrEqual(SQUEEZE);
    expect(Math.abs(angleDelta(snap.forklift.heading, north))).toBeGreaterThan(TRUCK_FACE_ANGLE);
    // Back east and on to the middle door cell (3,0), the load over the last one; turning toward the truck there, the
    // rig eases back into (3,1) and faces the middle column: only it opens, whatever the load swung over.
    turnTo(1, 0);
    runUntil(state, () => cellX(snap.forklift.pos.x - 0.5) >= 3, input(0.4), 6, dt);
    hold(IDLE, 0.8);
    expect(cellX(snap.forklift.pos.x)).toBe(3);
    hold(stick(0, -0.3), 2.5);
    expect(Math.abs(angleDelta(snap.forklift.heading, north))).toBeLessThanOrEqual(TRUCK_FACE_ANGLE);
    const events = hold(input(1), 3);
    expect(events.some((e) => e.type === 'boxDropped')).toBe(false);
    expect(cellX(snap.forklift.pos.x)).toBe(3);
    expect(snap.hint.dropTruckSlotId).toBe('t1:1:0');
    const at = load.x;
    const drop = dropped(press(state, dt))!;
    expect(drop).toMatchObject({ truckSlotId: 't1:1:0', cell: { x: 3, z: -1 }, wrongTarget: true });
    // Straight under the forks: the bed's centre is where the load already was (no sideways hop).
    expect(Math.abs(snap.boxes[0].pos.x - at)).toBeLessThan(0.06);
  });

  it('facing a full column carrying: the load stops at its box in the doorway, and nothing can be dropped', () => {
    const state = new GameState(FULL('pTTp.', '.....', '..^..'));
    const snap = state.getSnapshot();
    press(state);
    forward(state);
    expect(snap.forklift.carrying).toBe('b1');
    // The load rests against the wrong box on the bed (level 0, a full column): it never passes over it.
    const full = snap.boxes.find((b) => b.id === 'b3')!;
    expect(full.pos.z + GAME_CONFIG.box.size / 2 + carriedBoxRadius - snap.boxes[0].pos.z).toBeLessThan(0.01);
    expect(snap.hint.dropCell).toBeNull();
    expect(snap.hint.dropTruckSlotId).toBeNull();
    expect(press(state)).toEqual([{ type: 'actionIdle', carrying: true }]);
  });

  it('a wrong box on the truck is lifted from its door cell only, with the forks through the door', () => {
    // Beside the full column, on the next door cell facing along the wall: not a target.
    const side = new GameState(FULL('pTTp.', '.....', '..^..'));
    put(side, { x: 1, z: 0 }, 90);
    expect(side.getSnapshot().hint.targetBoxId).toBeNull();
    expect(press(side)).toEqual([{ type: 'firstInput' }, { type: 'actionIdle', carrying: false }]);
    // Facing the wall from behind its door cell: the forks are not through yet.
    const front = new GameState(FULL('pTTp.', '..^..', '.....'));
    const snap = front.getSnapshot();
    expect(snap.hint.targetBoxId).toBeNull();
    // Up to the wall on the door cell: its top box is the target.
    forward(front, 2);
    expect(snap.hint.targetBoxId).toBe('b3');
    const events = press(front);
    expect(picked(events)).toEqual({ type: 'boxPicked', boxId: 'b3', fromZoneId: null, level: 0, fromTruckSlotId: 't1:1:0' });
    expect(snap.boxes[2]).toMatchObject({ carried: true, cell: null, truckSlotId: null });
    expect(snap.truckSlots![1]).toMatchObject({ occupiedBy: null, loadable: true });
    expect(events.some((e) => e.type === 'zoneReleased')).toBe(false);
    // It backs straight out with it (the heading holds while the load is in the door).
    const heading = snap.forklift.heading;
    run(front, 0.8, input(-0.5, 1));
    expect(snap.forklift.heading).toBe(heading);
  });

  it.each([
    ['60 fps', 1 / 60],
    ['20 fps', 1 / 20],
  ] as const)('%s: in through the door and back out with a load, never through a jamb, never snagging', (_, dt) => {
    const state = new GameState(DOCK);
    const snap = state.getSnapshot();
    press(state, dt);
    run(state, 0.3, IDLE, dt);
    const wall = wallZ(DOCK.size.depth);
    // The wall on either side of the door, up to its jambs.
    const beside = [
      { minX: -DOCK.size.width, maxX: 1 - DOCK.size.width / 2 + DOOR_JAMB },
      { minX: 3 - DOCK.size.width / 2 - DOOR_JAMB, maxX: DOCK.size.width },
    ];
    const load = snap.boxes[0].pos;
    const check = () => {
      // The load never overlaps the wall beside the door (nor its jambs), and the body never crosses the wall line.
      for (const w of beside) expect(pointRectDistance(load.x, load.z, w.minX, wall - 2, w.maxX, wall)).toBeGreaterThanOrEqual(carriedBoxRadius - 1e-4);
      expect(snap.forklift.pos.z - bodyRadius).toBeGreaterThanOrEqual(wall - 1e-6);
    };
    // In, pushing a little sideways all along (heading assist off: a slight steer).
    for (let i = 0; i < Math.round(2.5 / dt); i++) {
      state.update(dt, input(1, i < 0.4 / dt ? 0.15 : 0));
      check();
    }
    expect(snap.hint.dropTruckSlotId).toBe('t1:0:0');
    // Out again, in reverse, without catching on the jambs: it keeps moving until the load is back in the room.
    let t = 0;
    while (load.z - carriedBoxRadius < wall + 0.05) {
      const z = snap.forklift.pos.z;
      state.update(dt, input(-1));
      check();
      t += dt;
      if (t > 0.6) expect(snap.forklift.pos.z - z).toBeGreaterThan(0.2 * dt);
      expect(t).toBeLessThan(4);
    }
  });

  it('a west dock: loaded through its door facing west, the body stopped at the west wall', () => {
    const state = new GameState(WEST);
    const snap = state.getSnapshot();
    expect(snap.hint.targetBoxId).toBe('b1');
    press(state);
    run(state, 0.3);
    forward(state);
    expect(snap.forklift.pos.x).toBeGreaterThanOrEqual(-WEST.size.width / 2 + bodyRadius - 1e-3);
    expect(snap.forklift.pos.x).toBeLessThan(-WEST.size.width / 2 + bodyRadius + 0.02);
    expect(-WEST.size.width / 2 - forkPoint(state).x).toBeGreaterThan(TRUCK_REACH);
    expect(snap.hint).toMatchObject({ dropCell: { x: -1, z: 1 }, dropTruckSlotId: 't1:0:0' });
    expect(dropped(press(state))).toMatchObject({ boxId: 'b1', cell: { x: -1, z: 1 }, level: 0, correct: true, truckSlotId: 't1:0:0' });
    expect(snap.boxes[0].pos).toEqual({ x: -0.5 - WEST.size.width / 2, z: 1.5 - WEST.size.depth / 2 });
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
    backTo(state, rowZ(3, BASE.size.depth) - 0.15);
    face(state, 1, 0);
    press(state);
    face(state, 0, -1);
    forward(state, 3);
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
    forward(state, 3);
    expect(snap.hint).toMatchObject({ dropLevel: 1, dropTruckSlotId: 't1:0:1' });
    const events = press(state);
    expect(dropped(events)).toMatchObject({ correct: true, satisfiedCount: 2, total: 2 });
    expect(events.at(-1)).toEqual({ type: 'levelComplete' });

    const zoned = new GameState(ZONE);
    press(zoned);
    run(zoned, 0.3);
    run(zoned, 0.5, input(1));
    run(zoned, 0.5);
    expect(zoned.getSnapshot().hint.dropZoneId).toBe('z1');
    expect(dropped(press(zoned))).toMatchObject({ zoneId: 'z1', correct: false, wrongTarget: true });
    expect(zoned.getSnapshot().boxes[0]).not.toHaveProperty('slotId', 'z1');
  });
});
