import { describe, expect, it } from 'vitest';
import { angleDelta, degToRad } from '../core/math';
import type { InputFrame, LevelData } from '../core/types';
import { GAME_CONFIG } from '../config';
import { GameState } from './GameState';
import { DT, makeLevel, rng } from './testUtils';

const F = GAME_CONFIG.forklift;

/** Vehicle-relative input: throttle −1‥1 (W / S), steer −1‥1 (A = +1 left, D = −1 right). */
function drive(throttle: number, steer: number, actionPressed = false): InputFrame {
  return { move: { x: 0, z: 0 }, drive: { throttle, steer }, actionPressed };
}

function hold(state: GameState, seconds: number, input: InputFrame, dt = DT): void {
  for (let t = 0; t < seconds - 1e-9; t += dt) state.update(dt, input);
}

/** 9×7 open floor: cell (x, z) center = (x - 4, z - 3). */
function openLevel(forklift: { x: number; z: number; heading: number }, extra: Record<string, unknown> = {}): LevelData {
  return makeLevel({
    size: { width: 9, depth: 7 },
    forklift,
    boxes: [{ id: 'b', color: 'blue', x: 0, z: 0 }],
    zones: [{ id: 'z', color: 'blue', x: 8, z: 6 }],
    ...extra,
  });
}

describe('GameState — vehicle controls (W / S / A / D)', () => {
  it('W drives forward along the heading, whatever the camera', () => {
    const state = new GameState(openLevel({ x: 4, z: 3, heading: 90 }));
    const f = state.getSnapshot().forklift;
    hold(state, 2, drive(1, 0));
    expect(f.heading).toBeCloseTo(Math.PI / 2, 9);
    expect(f.pos.x).toBeGreaterThan(2.0);
    expect(f.pos.z).toBeCloseTo(0, 9);
    expect(f.speed).toBeCloseTo(F.maxSpeed, 6);
    expect(f.wheelSpin).toBeGreaterThan(0);
  });

  it('S reverses gently (up to reverseSpeed), wheels rolling backwards', () => {
    const state = new GameState(openLevel({ x: 6, z: 3, heading: 90 }));
    const f = state.getSnapshot().forklift;
    hold(state, 2, drive(-1, 0));
    expect(f.speed).toBeCloseTo(-F.reverseSpeed, 6);
    expect(f.pos.x).toBeLessThan(0.5);
    expect(f.heading).toBeCloseTo(Math.PI / 2, 9);
    expect(f.wheelSpin).toBeLessThan(0);
  });

  it('switching from W to S brakes through zero first, never jumping', () => {
    const state = new GameState(openLevel({ x: 0, z: 3, heading: 90 }));
    const f = state.getSnapshot().forklift;
    hold(state, 2, drive(1, 0));
    let prev = f.speed;
    for (let i = 0; i < 180; i++) {
      state.update(DT, drive(-1, 0));
      expect(f.speed).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - f.speed).toBeLessThanOrEqual(F.deceleration * DT + 1e-9);
      prev = f.speed;
    }
    expect(f.speed).toBeLessThan(0);
  });

  it('A turns left (heading increases) and D turns right, even standing still', () => {
    const left = new GameState(openLevel({ x: 4, z: 3, heading: 0 }));
    hold(left, 0.5, drive(0, 1));
    const l = left.getSnapshot().forklift;
    expect(l.heading).toBeGreaterThan(0.3);
    expect(Math.hypot(l.pos.x, l.pos.z)).toBeLessThan(1e-9);
    expect(l.steer).toBeGreaterThan(0.5); // positive steer = heading increasing (render convention)

    const right = new GameState(openLevel({ x: 4, z: 3, heading: 0 }));
    hold(right, 0.5, drive(0, -1));
    expect(right.getSnapshot().forklift.heading).toBeLessThan(-0.3);
  });

  it('turning eases in and never exceeds driveTurnRate', () => {
    const state = new GameState(openLevel({ x: 4, z: 3, heading: 0 }));
    const f = state.getSnapshot().forklift;
    let prevHeading = f.heading;
    let prevRate = 0;
    for (let i = 0; i < 90; i++) {
      state.update(DT, drive(0, 1));
      const rate = angleDelta(prevHeading, f.heading) / DT;
      expect(rate).toBeLessThanOrEqual(F.driveTurnRate + 1e-6);
      expect(rate - prevRate).toBeLessThanOrEqual(F.turnAcceleration * DT + 1e-6); // no jolt
      prevHeading = f.heading;
      prevRate = rate;
    }
    expect(prevRate).toBeCloseTo(F.driveTurnRate, 3);
  });

  it('releasing A settles the turn softly with only a little drift', () => {
    const state = new GameState(openLevel({ x: 4, z: 3, heading: 0 }));
    const f = state.getSnapshot().forklift;
    hold(state, 1, drive(0, 1));
    const released = f.heading;
    hold(state, 1, drive(0, 0));
    const drift = Math.abs(angleDelta(released, f.heading));
    expect(drift).toBeGreaterThan(0); // eases out, no instant stop
    expect(drift).toBeLessThan(degToRad(8));
    const settled = f.heading;
    hold(state, 0.5, drive(0, 0));
    expect(f.heading).toBeCloseTo(settled, 6);
  });

  it('driving straight eases a heading a few degrees off a tile axis onto it', () => {
    const state = new GameState(openLevel({ x: 1, z: 3, heading: 90 + 5 }));
    const f = state.getSnapshot().forklift;
    hold(state, 2, drive(1, 0));
    expect(Math.abs(angleDelta(f.heading, Math.PI / 2))).toBeLessThan(degToRad(0.5));
  });

  it('leaves deliberate diagonals alone (outside headingAssistDeg)', () => {
    const state = new GameState(openLevel({ x: 1, z: 1, heading: 90 - 30 }));
    const f = state.getSnapshot().forklift;
    hold(state, 1, drive(1, 0));
    expect(f.heading).toBeCloseTo(degToRad(60), 6);
  });

  it('does not rotate on its own while parked', () => {
    const state = new GameState(openLevel({ x: 4, z: 3, heading: 95 }));
    hold(state, 1, drive(0, 0));
    expect(state.getSnapshot().forklift.heading).toBeCloseTo(degToRad(95), 9);
  });

  it('reversing into a wall stops cleanly without tunnelling or revving', () => {
    const state = new GameState(openLevel({ x: 2, z: 3, heading: 90 }));
    const f = state.getSnapshot().forklift;
    hold(state, 3, drive(-1, 0), 1 / 20);
    expect(f.pos.x).toBeCloseTo(-4.5 + F.bodyRadius, 4);
    expect(Math.abs(f.speed)).toBeLessThan(0.05);
  });

  it('picks up with W + Space and keeps the box on the forks while reversing', () => {
    const state = new GameState(
      makeLevel({
        forklift: { x: 1, z: 2, heading: 90 },
        boxes: [{ id: 'b', color: 'blue', x: 3, z: 2 }],
        zones: [{ id: 'z', color: 'blue', x: 5, z: 4 }],
      }),
    );
    const snap = state.getSnapshot();
    let frames = 0;
    while (!snap.hint.targetBoxId && frames++ < 300) state.update(DT, drive(1, 0));
    state.update(DT, drive(0, 0, true));
    expect(snap.forklift.carrying).toBe('b');
    hold(state, 1, drive(-1, 0));
    const box = snap.boxes[0];
    const fx = snap.forklift.pos.x + Math.sin(snap.forklift.heading) * F.forkReach;
    expect(box.pos.x).toBeCloseTo(fx, 6);
    expect(snap.forklift.speed).toBeLessThan(0);
  });

  it('stays finite and inside the warehouse under random vehicle input (fuzz)', () => {
    const random = rng(7);
    const state = new GameState(openLevel({ x: 4, z: 3, heading: 0 }, { shelves: [{ x: 2, z: 2, w: 2, d: 1 }] }));
    const f = state.getSnapshot().forklift;
    let throttle = 0;
    let steer = 0;
    for (let i = 0; i < 3000; i++) {
      if (i % 20 === 0) {
        throttle = Math.round(random() * 2 - 1);
        steer = Math.round(random() * 2 - 1);
      }
      state.update(1 / 30 + random() * (1 / 20 - 1 / 30), drive(throttle, steer, i % 97 === 0));
      expect(Number.isFinite(f.pos.x) && Number.isFinite(f.pos.z) && Number.isFinite(f.heading)).toBe(true);
      expect(Math.abs(f.pos.x)).toBeLessThanOrEqual(4.5 - F.bodyRadius + 1e-6);
      expect(Math.abs(f.pos.z)).toBeLessThanOrEqual(3.5 - F.bodyRadius + 1e-6);
    }
  });

  it('flipping W ↔ S is as soft as a plain stop (no clunk at the crossover)', () => {
    /** Largest per-frame change of acceleration while `input` runs for `seconds` after 2 s of full throttle. */
    const peakJerk = (input: InputFrame, from: InputFrame, x: number) => {
      const state = new GameState(openLevel({ x, z: 3, heading: 90 }));
      const f = state.getSnapshot().forklift;
      hold(state, 2, from);
      let prevSpeed = f.speed;
      let prevAccel = 0;
      let peak = 0;
      for (let i = 0; i < 120; i++) {
        state.update(DT, input);
        const accel = (f.speed - prevSpeed) / DT;
        if (i > 0) peak = Math.max(peak, Math.abs(accel - prevAccel));
        prevSpeed = f.speed;
        prevAccel = accel;
      }
      return peak;
    };
    const plainStop = peakJerk(drive(0, 0), drive(1, 0), 0);
    expect(peakJerk(drive(-1, 0), drive(1, 0), 0)).toBeLessThanOrEqual(plainStop + 1e-6);
    expect(peakJerk(drive(1, 0), drive(-1, 0), 6)).toBeLessThanOrEqual(plainStop + 1e-6);
  });

  it('mirrors the visual steer in reverse (rear-steered rig), keeps it for a turn in place', () => {
    const forward = new GameState(openLevel({ x: 2, z: 3, heading: 90 }));
    hold(forward, 0.8, drive(1, 1));
    expect(forward.getSnapshot().forklift.steer).toBeGreaterThan(0.5);
    const reverse = new GameState(openLevel({ x: 6, z: 3, heading: 90 }));
    hold(reverse, 0.8, drive(-1, 1));
    expect(reverse.getSnapshot().forklift.speed).toBeLessThan(0);
    expect(reverse.getSnapshot().forklift.steer).toBeLessThan(-0.5);
  });

  it('releasing A while parked settles as softly as releasing it while driving', () => {
    const drift = (throttle: number) => {
      const state = new GameState(openLevel({ x: 1, z: 1, heading: 45 }));
      const f = state.getSnapshot().forklift;
      hold(state, 1, drive(throttle, 1));
      const released = f.heading;
      hold(state, 1, drive(throttle, 0));
      return Math.abs(angleDelta(released, f.heading));
    };
    expect(drift(0)).toBeLessThan(degToRad(6));
    expect(Math.abs(drift(0) - drift(1))).toBeLessThan(degToRad(1));
  });

  it('the heading assist never turns a pinned rig and eases in without a jolt', () => {
    // W held head-on into the east wall, 7° off the axis: no rotation while pinned.
    const pinned = new GameState(openLevel({ x: 7, z: 3, heading: 90 + 7 }));
    const p = pinned.getSnapshot().forklift;
    hold(pinned, 2, drive(1, 0));
    const before = p.heading;
    hold(pinned, 1, drive(1, 0));
    expect(Math.abs(angleDelta(before, p.heading))).toBeLessThan(degToRad(0.5));
    // From rest, just inside the band: the turn rate builds up no faster than steering does.
    const eased = new GameState(openLevel({ x: 1, z: 3, heading: 90 + 7.9 }));
    const f = eased.getSnapshot().forklift;
    let prevHeading = f.heading;
    let prevRate = 0;
    for (let i = 0; i < 120; i++) {
      eased.update(DT, drive(1, 0));
      const rate = angleDelta(prevHeading, f.heading) / DT;
      expect(Math.abs(rate - prevRate)).toBeLessThanOrEqual(F.turnAcceleration * DT + 1e-6);
      prevHeading = f.heading;
      prevRate = rate;
    }
    expect(Math.abs(angleDelta(f.heading, Math.PI / 2))).toBeLessThan(degToRad(1.5));
  });

  it('first vehicle input counts as the first input (starts the timer)', () => {
    const state = new GameState(openLevel({ x: 4, z: 3, heading: 0 }));
    expect(state.update(DT, drive(0, 1))).toEqual([{ type: 'firstInput' }]);
  });
});
