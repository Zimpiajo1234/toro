import { describe, expect, it } from 'vitest';
import { angleDelta, degToRad } from '../core/math';
import type { LevelData, Vec2 } from '../core/types';
import { GAME_CONFIG } from '../config';
import { BOX_SETTLE_SPEED, circleRectContact, CollisionWorld, createContact } from './collision';
import { GameState } from './GameState';
import { DROP_BODY_TOLERANCE_TIGHT_SPOT } from './interaction';
import { DT, forkPoint, IDLE, makeLevel, move, press, rng, run, runUntil, types } from './testUtils';

const F = GAME_CONFIG.forklift;

/** 9×7 open floor: cell (x, z) center = (x - 4, z - 3). Box parked in the NW corner, zone in the SE. */
function openLevel(forklift: { x: number; z: number; heading: number }, extra: Record<string, unknown> = {}): LevelData {
  return makeLevel({
    size: { width: 9, depth: 7 },
    forklift,
    boxes: [{ id: 'b', color: 'blue', x: 0, z: 0 }],
    zones: [{ id: 'z', color: 'blue', x: 8, z: 6 }],
    ...extra,
  });
}

describe('GameState — construction', () => {
  it('places the forklift, boxes and zones from the level', () => {
    const level = makeLevel({
      forklift: { x: 1, z: 2, heading: 90 },
      boxes: [
        { id: 'on', color: 'blue', x: 5, z: 2 },
        { id: 'off', color: 'mint', x: 3, z: 1 },
      ],
      zones: [
        { id: 'zb', color: 'blue', x: 5, z: 2 },
        { id: 'zm', color: 'mint', x: 3, z: 3 },
      ],
    });
    const snap = new GameState(level).getSnapshot();
    expect(snap.forklift.pos).toEqual({ x: -2, z: 0 });
    expect(snap.forklift.heading).toBeCloseTo(Math.PI / 2, 12);
    expect(snap.forklift).toMatchObject({ speed: 0, forkLift: 0, carrying: null, wheelSpin: 0, steer: 0 });
    expect(snap.boxes[0]).toMatchObject({ pos: { x: 2, z: 0 }, cell: { x: 5, z: 2 }, zoneId: 'zb', correct: true, carried: false, kind: 'standard' });
    expect(snap.boxes[1]).toMatchObject({ pos: { x: 0, z: -1 }, zoneId: null, correct: false });
    expect(snap.zones[0]).toMatchObject({ occupiedBy: 'on', satisfied: true, pos: { x: 2, z: 0 } });
    expect(snap.zones[1]).toMatchObject({ occupiedBy: null, satisfied: false });
    expect(snap.progress).toEqual({ satisfied: 1, total: 2 });
    expect(snap.completed).toBe(false);
  });

  it('returns the same snapshot object every call', () => {
    const state = new GameState(openLevel({ x: 4, z: 3, heading: 0 }));
    const a = state.getSnapshot();
    state.update(DT, move(1, 0));
    expect(state.getSnapshot()).toBe(a);
  });

  it('quiet frames return an empty event list', () => {
    const state = new GameState(openLevel({ x: 4, z: 3, heading: 0 }));
    expect(state.update(DT, IDLE)).toEqual([]);
  });
});

describe('GameState — driving', () => {
  it('drives straight, reaching max speed, with wheels matching distance', () => {
    const state = new GameState(openLevel({ x: 4, z: 3, heading: 90 }));
    const f = state.getSnapshot().forklift;
    run(state, 2, move(1, 0));
    expect(f.heading).toBeCloseTo(Math.PI / 2, 9);
    expect(f.pos.z).toBeCloseTo(0, 9);
    // Soft start: well short of full-speed distance, but clearly under way.
    expect(f.pos.x).toBeGreaterThan(F.maxSpeed * 2 * 0.55);
    expect(f.pos.x).toBeLessThan(F.maxSpeed * 2 * 0.85);
    expect(f.speed).toBeCloseTo(F.maxSpeed, 6);
    expect(f.wheelSpin * F.wheelRadius).toBeCloseTo(f.pos.x, 6);
  });

  it('accelerates gradually from rest', () => {
    const state = new GameState(openLevel({ x: 4, z: 3, heading: 90 }));
    const f = state.getSnapshot().forklift;
    state.update(DT, move(1, 0));
    expect(f.speed).toBeGreaterThan(0);
    expect(f.speed).toBeLessThanOrEqual(F.acceleration * DT + 1e-9);
  });

  it('scales speed with analog input length', () => {
    const state = new GameState(openLevel({ x: 4, z: 3, heading: 90 }));
    run(state, 2, move(0.5, 0));
    expect(state.getSnapshot().forklift.speed).toBeCloseTo(F.maxSpeed * 0.5, 6);
  });

  it('coasts gently to a stop when input is released', () => {
    const state = new GameState(openLevel({ x: 0, z: 3, heading: 90 }));
    const f = state.getSnapshot().forklift;
    run(state, 2, move(1, 0));
    expect(f.speed).toBeCloseTo(F.maxSpeed, 6);
    const releasedAt = f.pos.x;
    state.update(DT, IDLE);
    expect(f.speed).toBeGreaterThan(F.maxSpeed * 0.8); // no instant halt
    let prev = f.speed;
    let frames = 1;
    while (f.speed > 0 && frames < 120) {
      state.update(DT, IDLE);
      expect(f.speed).toBeLessThan(prev);
      prev = f.speed;
      frames++;
    }
    expect(f.speed).toBe(0);
    expect(frames * DT).toBeGreaterThan(0.4);
    expect(frames * DT).toBeLessThan(1.1);
    expect(f.pos.x - releasedAt).toBeGreaterThan(0.4);
    expect(f.pos.x - releasedAt).toBeLessThan(1.2);
    expect(f.heading).toBeCloseTo(Math.PI / 2, 9);
  });

  it('turns smoothly toward the input without overshoot, mostly in place', () => {
    const state = new GameState(openLevel({ x: 4, z: 3, heading: 90 }));
    const f = state.getSnapshot().forklift;
    let prevError = angleDelta(f.heading, 0);
    let minSteer = 0;
    let movedWhileFacingAway = 0;
    for (let i = 0; i < 60; i++) {
      state.update(DT, move(0, 1));
      const error = angleDelta(f.heading, 0);
      expect(error).toBeLessThanOrEqual(0); // same side: never overshoots past the target
      expect(Math.abs(error)).toBeLessThanOrEqual(Math.abs(prevError) + 1e-12);
      if (Math.abs(prevError) > Math.PI / 2) movedWhileFacingAway = Math.hypot(f.pos.x, f.pos.z);
      prevError = error;
      minSteer = Math.min(minSteer, f.steer);
      expect(Math.abs(f.steer)).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(prevError)).toBeLessThan(0.01);
    expect(movedWhileFacingAway).toBeLessThan(0.01);
    expect(minSteer).toBeLessThan(-0.4); // heading decreasing → negative steer
    expect(f.pos.z).toBeGreaterThan(0.5); // then drives toward +Z
    run(state, 1, move(0, 1));
    expect(Math.abs(f.steer)).toBeLessThan(0.05);
  });

  it('does a U-turn without oscillating', () => {
    const state = new GameState(openLevel({ x: 4, z: 3, heading: 90 }));
    const f = state.getSnapshot().forklift;
    state.update(DT, move(-1, 0));
    const side = Math.sign(angleDelta(f.heading, -Math.PI / 2));
    let prev = Math.abs(angleDelta(f.heading, -Math.PI / 2));
    for (let i = 0; i < 90; i++) {
      state.update(DT, move(-1, 0));
      const error = angleDelta(f.heading, -Math.PI / 2);
      if (Math.abs(error) > 1e-9) expect(Math.sign(error)).toBe(side);
      expect(Math.abs(error)).toBeLessThanOrEqual(prev + 1e-12);
      prev = Math.abs(error);
    }
    expect(prev).toBeLessThan(1e-3);
    expect(f.pos.x).toBeLessThan(-0.5);
  });

  it('is frame-rate independent for turning and driving', () => {
    const positions = [1 / 120, 1 / 60, 1 / 20].map((dt) => {
      const state = new GameState(openLevel({ x: 4, z: 3, heading: 90 }));
      run(state, 0.6, move(0, 1), dt);
      const f = state.getSnapshot().forklift;
      return { x: f.pos.x, z: f.pos.z, h: f.heading };
    });
    for (const p of positions) {
      expect(p.x).toBeCloseTo(positions[0].x, 1);
      expect(p.z).toBeCloseTo(positions[0].z, 1);
      expect(p.h).toBeCloseTo(positions[0].h, 2);
    }
  });
});

describe('GameState — collisions', () => {
  it('slides along a wall when driving diagonally into it', () => {
    const state = new GameState(openLevel({ x: 4, z: 1, heading: 180 }));
    const f = state.getSnapshot().forklift;
    run(state, 1.8, move(1, -1));
    expect(f.pos.z).toBeCloseTo(-3.5 + F.bodyRadius, 4);
    const x0 = f.pos.x;
    const spin0 = f.wheelSpin;
    run(state, 0.3, move(1, -1));
    const slideSpeed = (f.pos.x - x0) / 0.3;
    expect(slideSpeed).toBeGreaterThan(0.6 * F.maxSpeed * Math.SQRT1_2);
    expect(f.pos.z).toBeCloseTo(-3.5 + F.bodyRadius, 4);
    // Wheels roll with the ground actually covered along the heading (135 deg), not with the commanded speed.
    expect((f.wheelSpin - spin0) * F.wheelRadius).toBeCloseTo((f.pos.x - x0) * Math.SQRT1_2, 6);
  });

  it('stops without jitter when pushing head-on into a wall; wheels and motor settle promptly', () => {
    const state = new GameState(openLevel({ x: 6, z: 3, heading: 90 }));
    const f = state.getSnapshot().forklift;
    const wall = 4.5 - F.bodyRadius;
    runUntil(state, () => f.pos.x >= wall - 1e-5, move(1, 0));
    expect(f.speed).toBeGreaterThan(1); // arrives with momentum
    const spin = f.wheelSpin;
    let settle = 0;
    while (f.speed >= 0.05 && settle < 2) {
      state.update(DT, move(1, 0));
      settle += DT;
    }
    // A soft bump, not a long spin-down: speed (and the motor hum) settles in ~0.25 s instead of revving in place.
    expect(settle).toBeLessThan(0.35);
    expect(settle).toBeGreaterThan(0.1);
    run(state, 1, move(1, 0));
    expect(Math.abs(f.pos.x - wall)).toBeLessThan(1e-4);
    expect(f.speed).toBeLessThan(0.05);
    // The wheels never spin in place against the wall.
    expect(Math.abs(f.wheelSpin - spin)).toBeLessThan(1e-3);
  });

  it('never gets stuck in a corner', () => {
    const state = new GameState(openLevel({ x: 6, z: 1, heading: 135 }));
    const f = state.getSnapshot().forklift;
    run(state, 3.5, move(1, -1));
    expect(f.pos.x).toBeCloseTo(4.5 - F.bodyRadius, 4);
    expect(f.pos.z).toBeCloseTo(-3.5 + F.bodyRadius, 4);
    // Held into the corner: at rest, no jitter.
    const before = { ...f.pos };
    run(state, 0.5, move(1, -1));
    expect(Math.hypot(f.pos.x - before.x, f.pos.z - before.z)).toBeLessThan(1e-4);
    expect(f.speed).toBeLessThan(0.05);
    // Any direction away frees it.
    run(state, 2, move(-1, 0));
    expect(f.pos.x).toBeLessThan(2.5);
    run(state, 2, move(0, 1));
    expect(f.pos.z).toBeGreaterThan(-1.5);
  });

  it('slides along a row of shelves past the seam and around the far corner', () => {
    // Shelves cover cells x 1‥6 on row z = 1 → world x ∈ [-3.5, 2.5], z ∈ [-2.5, -1.5]; seam at x = -0.5.
    const state = new GameState(
      openLevel(
        { x: 0, z: 2, heading: 90 },
        { shelves: [{ x: 1, z: 1, w: 3, d: 1 }, { x: 4, z: 1, w: 3, d: 1 }] },
      ),
    );
    const f = state.getSnapshot().forklift;
    let prevX = f.pos.x;
    let crossedSeamOnFace = false;
    let wentAround = false;
    for (let i = 0; i < 720; i++) {
      state.update(DT, move(1, -1));
      expect(f.pos.x).toBeGreaterThanOrEqual(prevX - 1e-9);
      prevX = f.pos.x;
      if (f.pos.x > 0 && f.pos.x < 2 && Math.abs(f.pos.z - (-1.5 + F.bodyRadius)) < 1e-3) crossedSeamOnFace = true;
      if (f.pos.z < -1.8) wentAround = true; // past the shelf end (x > 2.5 + r), heading north
    }
    expect(crossedSeamOnFace).toBe(true);
    expect(wentAround).toBe(true);
  });

  it('never tunnels through a plant at max speed with dt = 1/20', () => {
    // 12×3 runway; plant at cell (6,1) → collider x ∈ [0.2, 0.8].
    const level = makeLevel({
      size: { width: 12, depth: 3 },
      forklift: { x: 0, z: 1, heading: 90 },
      boxes: [{ id: 'b', color: 'blue', x: 11, z: 0 }],
      zones: [{ id: 'z', color: 'blue', x: 11, z: 2 }],
      decor: { plants: [{ x: 6, z: 1 }], windows: [] },
    });
    const state = new GameState(level);
    const f = state.getSnapshot().forklift;
    let reachedMax = false;
    for (let i = 0; i < 80; i++) {
      state.update(1 / 20, move(1, 0));
      if (f.speed >= F.maxSpeed - 1e-6) reachedMax = true;
      expect(f.pos.x + F.bodyRadius).toBeLessThanOrEqual(0.2 + 1e-4);
    }
    expect(reachedMax).toBe(true);
    expect(f.pos.x).toBeCloseTo(0.2 - F.bodyRadius, 4);
  });

  it('never tunnels a carried box through a resting box with dt = 1/20', () => {
    const level = makeLevel({
      size: { width: 12, depth: 3 },
      forklift: { x: 0, z: 1, heading: 90 },
      boxes: [
        { id: 'carry', color: 'blue', x: 1, z: 1 },
        { id: 'wall', color: 'mint', x: 8, z: 1 },
      ],
      zones: [
        { id: 'zb', color: 'blue', x: 11, z: 0 },
        { id: 'zm', color: 'mint', x: 11, z: 2 },
      ],
    });
    const state = new GameState(level);
    expect(press(state, 1 / 20).map((e) => e.type)).toContain('boxPicked');
    const snap = state.getSnapshot();
    const wallFace = 2.5 - GAME_CONFIG.box.size / 2;
    for (let i = 0; i < 80; i++) {
      state.update(1 / 20, move(1, 0));
      const fork = forkPoint(state);
      expect(fork.x + F.carriedBoxRadius).toBeLessThanOrEqual(wallFace + 1e-4);
      expect(snap.boxes[0].pos.x).toBeCloseTo(fork.x, 9);
    }
    expect(forkPoint(state).x).toBeCloseTo(wallFace - F.carriedBoxRadius, 4);
  });

  it('refuses to rotate a load that cannot fit in a 1-cell lane', () => {
    // Lane z = 1 between two full shelf rows; world z ∈ [-0.5, 0.5].
    const level = makeLevel({
      size: { width: 6, depth: 3 },
      forklift: { x: 0, z: 1, heading: 90 },
      boxes: [{ id: 'b', color: 'blue', x: 1, z: 1 }],
      zones: [{ id: 'z', color: 'blue', x: 5, z: 1 }],
      shelves: [
        { x: 0, z: 0, w: 6, d: 1 },
        { x: 0, z: 2, w: 6, d: 1 },
      ],
    });
    const state = new GameState(level);
    press(state);
    const f = state.getSnapshot().forklift;
    const c = createContact();
    for (let i = 0; i < 90; i++) {
      state.update(DT, move(0, 1));
      expect(Math.abs(angleDelta(f.heading, Math.PI / 2))).toBeLessThan(0.2);
      const fork = forkPoint(state);
      for (const [x, z, r] of [
        [f.pos.x, f.pos.z, F.bodyRadius],
        [fork.x, fork.z, F.carriedBoxRadius],
      ]) {
        expect(circleRectContact(x, z, r, -3, -1.5, 3, -0.5, c)).toBeLessThan(0.02);
        expect(circleRectContact(x, z, r, -3, 0.5, 3, 1.5, c)).toBeLessThan(0.02);
      }
    }
  });

  it('stays finite and out of obstacles under random input (fuzz)', () => {
    const level = makeLevel({
      size: { width: 10, depth: 8 },
      forklift: { x: 1, z: 1, heading: 0 },
      boxes: [
        { id: 'b1', color: 'blue', x: 3, z: 3 },
        { id: 'b2', color: 'mint', x: 6, z: 2 },
        { id: 'b3', color: 'yellow', x: 7, z: 6 },
      ],
      zones: [
        { id: 'z1', color: 'blue', x: 8, z: 1 },
        { id: 'z2', color: 'mint', x: 2, z: 6 },
        { id: 'z3', color: 'yellow', x: 5, z: 5 },
      ],
      shelves: [
        { x: 4, z: 0, w: 1, d: 3 },
        { x: 0, z: 4, w: 3, d: 1 },
        { x: 7, z: 4, w: 2, d: 1 },
      ],
      decor: { plants: [{ x: 9, z: 7 }, { x: 0, z: 7 }, { x: 5, z: 7 }], windows: [] },
    });
    const statics = [
      ...level.shelves.map((s) => [s.x - 5, s.z - 4, s.x + s.w - 5, s.z + s.d - 4]),
      ...level.decor.plants.map((p) => [p.x - 4.8, p.z - 3.8, p.x - 4.2, p.z - 3.2]),
    ];
    const c = createContact();
    for (const seed of [1, 7, 42]) {
      const random = rng(seed);
      const state = new GameState(level);
      const snap = state.getSnapshot();
      const f = snap.forklift;
      const world = CollisionWorld.fromLevel(level, GAME_CONFIG.box.size);
      world.setBoxes(snap.boxes);
      const droppedAt = new Map<string, number>();
      let time = 0;
      let carriedFor = 0;
      let mx = 0;
      let mz = 0;
      for (let i = 0; i < 3000; i++) {
        if (random() < 0.05) {
          const a = random() * Math.PI * 2;
          const idle = random() < 0.15;
          mx = idle ? 0 : Math.sin(a);
          mz = idle ? 0 : Math.cos(a);
        }
        const dt = 0.002 + random() * (1 / 20 - 0.002);
        const events = state.update(dt, { move: { x: mx, z: mz }, actionPressed: random() < 0.03 });
        time += dt;
        for (const e of events) if (e.type === 'boxDropped') droppedAt.set(e.boxId, time);
        carriedFor = f.carrying ? carriedFor + dt : 0;
        // Once settled after a pick-up, the load collider is back at full size wherever the rig is.
        if (carriedFor > 1.5) {
          const fork = forkPoint(state);
          expect(world.clearance(fork.x, fork.z)).toBeGreaterThan(F.carriedBoxRadius - 0.02);
        }

        for (const v of [f.pos.x, f.pos.z, f.heading, f.speed, f.steer, f.wheelSpin, f.forkLift])
          expect(Number.isFinite(v)).toBe(true);
        expect(f.speed).toBeGreaterThanOrEqual(0);
        expect(f.speed).toBeLessThanOrEqual(F.maxSpeed + 1e-9);
        expect(Math.abs(f.pos.x)).toBeLessThanOrEqual(5 - F.bodyRadius + 0.02);
        expect(Math.abs(f.pos.z)).toBeLessThanOrEqual(4 - F.bodyRadius + 0.02);
        for (const [a, b, cc, d] of statics) expect(circleRectContact(f.pos.x, f.pos.z, F.bodyRadius, a, b, cc, d, c)).toBeLessThan(0.02);
        for (const box of snap.boxes) {
          expect(Number.isFinite(box.pos.x) && Number.isFinite(box.pos.z)).toBe(true);
          if (box.carried) continue;
          const h = GAME_CONFIG.box.size / 2;
          // A just-dropped box may still overlap the body a little while the body eases out of it.
          const since = time - (droppedAt.get(box.id) ?? -Infinity);
          const settling = Math.max(0, DROP_BODY_TOLERANCE_TIGHT_SPOT - BOX_SETTLE_SPEED * since);
          const overlap = circleRectContact(f.pos.x, f.pos.z, F.bodyRadius, box.pos.x - h, box.pos.z - h, box.pos.x + h, box.pos.z + h, c);
          expect(overlap).toBeLessThan(0.02 + settling);
        }
        const drop = snap.hint.dropCell;
        if (drop) {
          expect(snap.boxes.some((b) => !b.carried && b.cell?.x === drop.x && b.cell?.z === drop.z)).toBe(false);
          expect(level.shelves.some((s) => drop.x >= s.x && drop.x < s.x + s.w && drop.z >= s.z && drop.z < s.z + s.d)).toBe(false);
          expect(level.decor.plants.some((p) => p.x === drop.x && p.z === drop.z)).toBe(false);
        }
      }
    }
  });

  it('survives non-finite input and dt', () => {
    const state = new GameState(openLevel({ x: 4, z: 3, heading: 0 }));
    const f = state.getSnapshot().forklift;
    state.update(Number.NaN, move(1, 0));
    state.update(DT, { move: { x: Number.NaN, z: Number.POSITIVE_INFINITY }, actionPressed: false });
    state.update(Number.POSITIVE_INFINITY, { move: { x: 1e308, z: -1e308 }, actionPressed: true });
    state.update(-1, move(1, 1));
    for (const v of [f.pos.x, f.pos.z, f.heading, f.speed, f.steer, f.wheelSpin, f.forkLift]) expect(Number.isFinite(v)).toBe(true);
  });
});

/** Level 6 layout with its first box moved into the free SE corner: row z = 7 is a snug dead-end strip above b4. */
const pinnedL6 = () =>
  makeLevel({
    size: { width: 11, depth: 8 },
    forklift: { x: 5, z: 3, heading: 0 },
    boxes: [
      { id: 'b1', color: 'coral', x: 10, z: 7 },
      { id: 'b2', color: 'yellow', x: 4, z: 6 },
      { id: 'b3', color: 'mint', x: 7, z: 6 },
      { id: 'b4', color: 'coral', x: 9, z: 6 },
      { id: 'b5', color: 'blue', x: 6, z: 7 },
    ],
    zones: [
      { id: 'z1', color: 'blue', x: 3, z: 1 },
      { id: 'z2', color: 'mint', x: 4, z: 1 },
      { id: 'z3', color: 'yellow', x: 5, z: 1 },
      { id: 'z4', color: 'coral', x: 6, z: 1 },
      { id: 'z5', color: 'coral', x: 7, z: 1 },
    ],
    shelves: [
      { x: 1, z: 4, w: 3, d: 1 },
      { x: 7, z: 4, w: 3, d: 1 },
    ],
    decor: { plants: [{ x: 0, z: 0 }, { x: 10, z: 0 }], windows: [] },
  });

/** Level 2 layout with its blue box moved against the south wall, right beside the mint box. */
const pinnedL2 = () =>
  makeLevel({
    size: { width: 8, depth: 6 },
    forklift: { x: 1, z: 2, heading: 90 },
    boxes: [
      { id: 'b1', color: 'blue', x: 2, z: 5 },
      { id: 'b2', color: 'mint', x: 3, z: 4 },
    ],
    zones: [
      { id: 'z1', color: 'mint', x: 6, z: 1 },
      { id: 'z2', color: 'blue', x: 6, z: 4 },
    ],
    decor: { plants: [{ x: 0, z: 0 }, { x: 0, z: 5 }], windows: [] },
  });

/** Put the forklift at an exact pose (body touching a box behind, forks near a wall) and lift the box ahead. */
function pickPinned(level: LevelData, pos: Vec2, headingDeg: number) {
  const state = new GameState(level);
  const snap = state.getSnapshot();
  snap.forklift.pos.x = pos.x;
  snap.forklift.pos.z = pos.z;
  snap.forklift.heading = degToRad(headingDeg);
  expect(types(press(state))).toContain('boxPicked');
  const world = CollisionWorld.fromLevel(level, GAME_CONFIG.box.size);
  world.setBoxes(snap.boxes);
  // Picked in a tight spot: the load collider starts small (it cannot be full size here).
  const fork = forkPoint(state);
  expect(world.clearance(fork.x, fork.z)).toBeLessThan(F.carriedBoxRadius - 0.02);
  return { state, f: snap.forklift, world };
}

const DIRECTIONS = [0, 45, 90, 135, 180, 225, 270, 315];

describe('GameState - tight spots with a load', () => {
  it('never freezes after a pick in a tight spot: every direction turns, the load grows to full size (level 6 corner)', () => {
    const start = { x: 4.38, z: 3.31 };
    for (const deg of DIRECTIONS) {
      const { state, f, world } = pickPinned(pinnedL6(), start, 64);
      const target = degToRad(deg);
      run(state, 3, move(Math.sin(target), Math.cos(target)));
      expect(Math.abs(angleDelta(f.heading, degToRad(64)))).toBeGreaterThan(0.3); // it turned (was stuck at 64 deg)
      const fork = forkPoint(state);
      expect(world.clearance(fork.x, fork.z)).toBeGreaterThan(F.carriedBoxRadius - 0.011); // full-size load, no poking
      // Toward the open side it reaches the heading (and drives off where the floor is free).
      if (deg >= 90 && deg <= 270) expect(Math.abs(angleDelta(f.heading, target))).toBeLessThan(1e-3);
      if (deg >= 180 && deg <= 270) expect(Math.hypot(f.pos.x - start.x, f.pos.z - start.z)).toBeGreaterThan(0.5);
    }
  });

  it('never freezes after a pick in a tight spot (level 2, against the south wall)', () => {
    const start = { x: -0.446, z: 2.31 };
    for (const deg of DIRECTIONS) {
      const { state, f, world } = pickPinned(pinnedL2(), start, -73);
      const target = degToRad(deg);
      run(state, 3, move(Math.sin(target), Math.cos(target)));
      expect(Math.abs(angleDelta(f.heading, target))).toBeLessThan(1e-3);
      const fork = forkPoint(state);
      expect(world.clearance(fork.x, fork.z)).toBeGreaterThan(F.carriedBoxRadius - 0.011);
    }
  });

  it('a turn refused only while sliding past an obstacle still goes the short way', () => {
    // Toward 225 deg: the short way (+161 deg) is blocked for a moment while the rig slides up the free column.
    const { state, f } = pickPinned(pinnedL6(), { x: 4.38, z: 3.31 }, 64);
    const target = degToRad(225);
    let turned = 0;
    for (let i = 0; i < 180; i++) {
      const before = f.heading;
      state.update(DT, move(Math.sin(target), Math.cos(target)));
      turned += angleDelta(before, f.heading);
    }
    expect(Math.abs(angleDelta(f.heading, target))).toBeLessThan(1e-3);
    expect(turned).toBeCloseTo(angleDelta(degToRad(64), target), 6);
  });
});
