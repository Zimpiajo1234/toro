import { angleDelta, approach, clamp, damp, degToRad, TAU, wrapAngle } from '../core/math';
import { nextReversing, signedSpeed01 } from '../core/reversing';
import type { ForkliftState, Vec2 } from '../core/types';
import type { GameConfig } from '../config';
import type { CollisionWorld } from './collision';

export type ForkliftTuning = GameConfig['forklift'];

/** Move input shorter than this counts as "no input" (also the threshold for `firstInput`). */
export const MOVE_EPSILON = 1e-3;

// Internal integration / smoothing constants. Feel is tuned in gameConfig.json; these keep it well-behaved.
/** Longest dt accepted per update (s). The caller already clamps to 1/20; this is only a safety net. */
const MAX_DT = 0.1;
/** Sub-steps per simulated second: at maxSpeed a collider moves ~0.03 u per slice, far below any radius. */
const SUBSTEP_RATE = 120;
/** Within this gap (u/s) from its target, speed eases in instead of stopping or topping out abruptly. */
const SPEED_EASE_BAND = 0.8;
/** Fraction of acceleration / deceleration still applied at the very end of the ease band. */
const SPEED_EASE_MIN = 0.25;
/** Pulling away from rest: acceleration ramps up over this speed range (u/s) so starts are soft, not a jolt. */
const SPEED_START_BAND = 0.6;
/** Fraction of acceleration available at a standstill (grows to 1 across SPEED_START_BAND). */
const SPEED_START_MIN = 0.3;
/** How quickly leftover rotation dies out once the keys / stick are released (1/s). */
const TURN_RELEASE_LAMBDA = 18;
/** Vehicle control: how quickly the turn stops once A / D is released (1/s) — a short, soft settle, no drift. */
const DRIVE_TURN_RELEASE_LAMBDA = 24;
/** Vehicle control: how gently a heading within `headingAssistDeg` of a tile axis eases onto it while driving (1/s). */
const HEADING_ASSIST_LAMBDA = 3;
const QUARTER_TURN = Math.PI / 2;
/** Reversing faster than this (u/s) mirrors the visual steer (a turn in place keeps the forward convention). */
const REVERSE_STEER_SPEED = 0.05;
/** Heading error (rad) at which the visual steer saturates at ±1. */
const STEER_FULL_ANGLE = 0.6;
/** Responsiveness of the visual steer value. */
const STEER_LAMBDA = 10;
/** Growth speed (u/s) of the load collider after a pick-up in a tight spot, so it nudges instead of popping. */
const LOAD_SETTLE_SPEED = 1.5;
/** Distance of the look-ahead probe used to measure how blocked the path ahead is. */
const PROBE_DISTANCE = 0.05;
/** Forward progress ratio (1 = free) at or above which driving is not slowed; 0.5 ≈ sliding along a wall at 45°. */
const FREE_PROGRESS = 0.5;
/** Unresolvable overlap (u) above which a rotation is refused for that sub-step (e.g. turning a load in a 1-cell lane). */
const WEDGE_TOLERANCE = 0.01;
/** Geometry-only block factor below which the forklift is pushing head-on into something. */
const HEAD_ON_BLOCK = 0.05;
/**
 * Pushing head-on counts only while the rig has (almost) stopped: realized speed below this fraction of `speed`.
 * A rig still slipping round a corner keeps its momentum, so it slides off instead of catching.
 */
const HEAD_ON_SLIP = 0.1;
/** Deceleration multiplier while pushing head-on: speed / motor settle in ~0.25 s instead of revving in place. */
const HEAD_ON_BRAKE = 2.5;
/** A turn refused for this long (s) while pinned looks for a way round the other side. */
const DETOUR_DELAY = 0.08;
/** Below this realized speed (u/s) a refused turn counts as pinned (not merely sliding past an obstacle). */
const PINNED_SPEED = 0.15;
/** Rotation (rad) the other way that must fit before a detour is tried, so tight lanes do not wobble both ways. */
const DETOUR_PROBE_ANGLE = 0.5;
/** A target heading change (rad) larger than this is a new intent: any detour ends. */
const DETOUR_RESET_ANGLE = 0.3;

/**
 * Speed approach shaped like an S-curve: acceleration ramps up when pulling away from rest and eases out inside
 * the last band before the target, so neither starting nor stopping feels like a jolt.
 */
export function approachSpeed(speed: number, target: number, acceleration: number, deceleration: number, dt: number): number {
  const gap = Math.abs(target - speed);
  if (gap === 0) return target;
  if (target * speed < 0) {
    // Reversing direction (W ↔ S): come to a stop first, with the same eased landing as releasing the key; the
    // next step then pulls away with the soft start ramp — no clunk at the crossover.
    const stop = Math.abs(speed);
    const landing = stop >= SPEED_EASE_BAND ? 1 : SPEED_EASE_MIN + (1 - SPEED_EASE_MIN) * (stop / SPEED_EASE_BAND);
    return approach(speed, 0, deceleration * landing * dt);
  }
  const speedingUp = Math.abs(target) > Math.abs(speed);
  const rate = speedingUp ? acceleration : deceleration;
  let ease = gap >= SPEED_EASE_BAND ? 1 : SPEED_EASE_MIN + (1 - SPEED_EASE_MIN) * (gap / SPEED_EASE_BAND);
  if (speedingUp) ease *= SPEED_START_MIN + (1 - SPEED_START_MIN) * Math.min(1, Math.abs(speed) / SPEED_START_BAND);
  return approach(speed, target, rate * ease * dt);
}

/**
 * Forklift kinematics, sub-stepped with collision push-out. Two control styles share the speed curve, turn
 * inertia and collisions: `step` (camera-relative world-space move vector: the forklift turns to face it) and
 * `stepDrive` (vehicle-relative: throttle forward / reverse, steer left / right). Mutates the ForkliftState it
 * was given.
 */
export class ForkliftController {
  private readonly state: ForkliftState;
  private readonly world: CollisionWorld;
  private readonly tuning: ForkliftTuning;
  private carrying = false;
  /** Current radius of the carried-box collider (0 when empty; eases up to carriedBoxRadius). */
  private loadRadius = 0;
  /** 0‥1 speed multiplier from the look-ahead probe: 0 when driving head-on into an obstacle. */
  private blockFactor = 1;
  /** Current turning speed (rad/s). Heading has inertia: it eases into and out of turns. */
  private angularVelocity = 0;
  /** Penetration left after the last sub-step (non-zero only when wedged). */
  private residual = 0;
  /** Forced turn direction (±1) while going the long way round a blocked turn; 0 = shortest way. */
  private detour = 0;
  /** A detour was already tried for the current intent (never flip back and forth). */
  private detourUsed = false;
  /** Target heading the current detour was started for. */
  private detourTarget = 0;
  /** How long (s) the turn has been refused in a row. */
  private refusedTime = 0;
  /** Distance actually covered per second in the last sub-step (after collisions). */
  private realizedSpeed = 0;
  /** The last sub-step's rotation did not fit and was undone. */
  private lastTurnRefused = false;
  /** Vehicle control: eased turn rate (rad/s) of the heading assist. */
  private assistRate = 0;
  /** Vehicle control: turn rate actually applied last sub-step (steering + assist), for the visual steer. */
  private driveRate = 0;
  /** The carried load is inside a storage opening (a rack slot, a dock door): the heading holds (straight in or out). */
  private headingLocked = false;
  private readonly probe: Vec2 = { x: 0, z: 0 };

  constructor(state: ForkliftState, world: CollisionWorld, tuning: ForkliftTuning) {
    this.state = state;
    this.world = world;
    this.tuning = tuning;
  }

  /** Start carrying. The load collider starts at `freeSpace` (clearance at the fork point) and eases to full. */
  attachLoad(freeSpace: number): void {
    this.carrying = true;
    this.loadRadius = clamp(freeSpace, 0, this.tuning.carriedBoxRadius);
    this.endDetour(); // the rig changed shape: the shortest turn may fit now (or no longer)
  }

  detachLoad(): void {
    this.carrying = false;
    this.loadRadius = 0;
    this.endDetour();
  }

  /**
   * Storage (docs/STORAGE.md «Acceso», rumbo fijo): while the carried load is inside a storage opening (a rack slot, a
   * dock door) the heading holds, so the rig goes in and out straight; steering does nothing and a move vector drives
   * along the heading (pulling away from the unit backs out, like S). GameState sets it every frame.
   */
  setHeadingLock(locked: boolean): void {
    if (locked && !this.headingLocked) {
      this.angularVelocity = 0;
      this.assistRate = 0;
      this.endDetour();
    }
    this.headingLocked = locked;
  }

  /** Where the forks hold a box: pos + forward * forkReach. Writes into `out`. */
  forkPoint(out: Vec2): Vec2 {
    const s = this.state;
    out.x = s.pos.x + Math.sin(s.heading) * this.tuning.forkReach;
    out.z = s.pos.z + Math.cos(s.heading) * this.tuning.forkReach;
    return out;
  }

  /** Advance `dt` seconds toward the world-space move vector (length 0‥1; longer is clamped). */
  step(dt: number, moveX: number, moveZ: number): void {
    const s = this.state;
    if (!Number.isFinite(moveX)) moveX = 0;
    if (!Number.isFinite(moveZ)) moveZ = 0;
    if (this.headingLocked) {
      // In a rack column: only straight in or out, as much as the move vector points along the heading.
      this.stepDrive(dt, clamp(moveX * Math.sin(s.heading) + moveZ * Math.cos(s.heading), -1, 1), 0);
      return;
    }
    const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
    const hasMove = length > MOVE_EPSILON;
    const magnitude = hasMove ? Math.min(1, length) : 0;
    const target = hasMove ? Math.atan2(moveX, moveZ) : s.heading;
    const total = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_DT) : 0;
    this.assistRate = 0; // the heading assist belongs to vehicle control only
    const newIntent = !hasMove || Math.abs(angleDelta(this.detourTarget, target)) > DETOUR_RESET_ANGLE;
    if (newIntent && (this.detour !== 0 || this.detourUsed)) this.endDetour();

    if (total > 0) {
      const count = Math.max(1, Math.ceil(total * SUBSTEP_RATE - 1e-6));
      const sub = total / count;
      for (let i = 0; i < count; i++) this.substep(sub, hasMove, target, magnitude);
      const error = hasMove ? this.turnError(target) : 0;
      s.steer = damp(s.steer, clamp(error / STEER_FULL_ANGLE, -1, 1), STEER_LAMBDA, total);
    }
    this.blockFactor = this.measureBlockFactor(s.speed < 0 ? -1 : 1);
    this.latchReversing();
  }

  /**
   * Advance `dt` seconds with vehicle-relative control: `throttle` −1‥1 (W forward / S reverse, up to maxSpeed /
   * reverseSpeed), `steer` −1‥1 (A = +1 turns left, heading increases; D = −1 turns right). Turning builds up at
   * turnAcceleration to driveTurnRate and settles softly on release; it also works standing still.
   */
  stepDrive(dt: number, throttle: number, steer: number): void {
    const s = this.state;
    throttle = Number.isFinite(throttle) ? clamp(throttle, -1, 1) : 0;
    steer = Number.isFinite(steer) ? clamp(steer, -1, 1) : 0;
    const total = Number.isFinite(dt) && dt > 0 ? Math.min(dt, MAX_DT) : 0;
    if (this.detour !== 0 || this.detourUsed) this.endDetour();

    if (total > 0) {
      const count = Math.max(1, Math.ceil(total * SUBSTEP_RATE - 1e-6));
      const sub = total / count;
      for (let i = 0; i < count; i++) this.substepDrive(sub, throttle, steer);
      const rate = this.tuning.driveTurnRate;
      // Rear-steered rig: turning the same way in reverse needs the opposite wheel angle (and leans the other way).
      const travel = s.speed < -REVERSE_STEER_SPEED ? -1 : 1;
      s.steer = damp(s.steer, rate > 0 ? clamp(this.driveRate / rate, -1, 1) * travel : 0, STEER_LAMBDA, total);
    }
    this.blockFactor = this.measureBlockFactor(throttle < 0 || (throttle === 0 && s.speed < 0) ? -1 : 1);
    this.latchReversing();
  }

  /**
   * The shared reversing latch (core/reversing) on the speed this step ended with: `ForkliftState.reversing`, what the
   * reverse beeper and the roof beacon follow. Every call, a zero-length one too (the latch holds on the same speed).
   */
  private latchReversing(): void {
    const s = this.state;
    s.reversing = nextReversing(s.reversing === true, signedSpeed01(s.speed, this.tuning.maxSpeed));
  }

  private substep(dt: number, hasMove: boolean, target: number, magnitude: number): void {
    const s = this.state;
    const t = this.tuning;
    const prevHeading = s.heading;
    const prevX = s.pos.x;
    const prevZ = s.pos.z;

    this.turn(dt, hasMove, target);

    // Turn mostly in place: no drive while facing away from the desired direction.
    const alignment = hasMove ? Math.max(0, Math.cos(angleDelta(s.heading, target))) : 0;
    this.drive(dt, t.maxSpeed * alignment * magnitude * this.blockFactor);
    const residual = this.advanceOrKeepHeading(dt, prevHeading, prevX, prevZ);
    if (hasMove) this.trackPinned(this.lastTurnRefused && Math.hypot(s.pos.x - prevX, s.pos.z - prevZ) < PINNED_SPEED * dt, dt, target);
    this.finishSubstep(dt, residual, prevX, prevZ);
  }

  private substepDrive(dt: number, throttle: number, steer: number): void {
    const s = this.state;
    const t = this.tuning;
    const prevHeading = s.heading;
    const prevX = s.pos.x;
    const prevZ = s.pos.z;

    this.turnDrive(dt, throttle, steer);
    const top = throttle >= 0 ? t.maxSpeed : t.reverseSpeed;
    this.drive(dt, throttle * top * this.blockFactor);
    const residual = this.advanceOrKeepHeading(dt, prevHeading, prevX, prevZ);
    this.finishSubstep(dt, residual, prevX, prevZ);
  }

  /** Ease speed toward `targetSpeed` (signed). Stopped dead against something, it settles quickly instead of revving. */
  private drive(dt: number, targetSpeed: number): void {
    const s = this.state;
    const t = this.tuning;
    const headOn = this.blockFactor < HEAD_ON_BLOCK && this.realizedSpeed < HEAD_ON_SLIP * Math.abs(s.speed);
    const deceleration = headOn ? t.deceleration * HEAD_ON_BRAKE : t.deceleration;
    s.speed = approachSpeed(s.speed, targetSpeed, t.acceleration, deceleration, dt);
  }

  /**
   * Turn + drive with the current load size, then push out. If the new orientation cannot fit (squeezed between
   * two obstacles) keep the old one and only drive. Growing the load is a separate move (finishSubstep), so a load
   * that cannot grow yet never cancels the turn that would free it. Returns the residual penetration.
   */
  private advanceOrKeepHeading(dt: number, prevHeading: number, prevX: number, prevZ: number): number {
    const s = this.state;
    let residual = this.advance(dt);
    this.lastTurnRefused = s.heading !== prevHeading && residual > WEDGE_TOLERANCE && residual > this.residual;
    if (this.lastTurnRefused) {
      s.heading = prevHeading;
      this.angularVelocity = 0;
      this.assistRate = 0;
      s.pos.x = prevX;
      s.pos.z = prevZ;
      residual = this.advance(dt);
    }
    return residual;
  }

  /** Grow the load collider where it fits, then roll the wheels with the ground actually covered. */
  private finishSubstep(dt: number, residual: number, prevX: number, prevZ: number): void {
    const s = this.state;
    const t = this.tuning;
    if (this.carrying && this.loadRadius < t.carriedBoxRadius) residual = this.growLoad(dt, residual);
    this.residual = residual;
    // Wheels roll with the ground actually covered (not the commanded speed), so they never spin in place.
    const dx = s.pos.x - prevX;
    const dz = s.pos.z - prevZ;
    this.realizedSpeed = Math.sqrt(dx * dx + dz * dz) / dt;
    s.wheelSpin += (dx * Math.sin(s.heading) + dz * Math.cos(s.heading)) / t.wheelRadius;
  }

  /** Try one growth step of the load collider; keeps the old size (and position) if the bigger one cannot fit. */
  private growLoad(dt: number, residual: number): number {
    const s = this.state;
    const t = this.tuning;
    const prevLoad = this.loadRadius;
    const x = s.pos.x;
    const z = s.pos.z;
    this.loadRadius = Math.min(t.carriedBoxRadius, prevLoad + LOAD_SETTLE_SPEED * dt);
    const grown = this.world.resolve(s.pos, Math.sin(s.heading), Math.cos(s.heading), t.bodyRadius, t.forkReach, this.loadRadius);
    if (grown > WEDGE_TOLERANCE && grown > residual) {
      this.loadRadius = prevLoad;
      s.pos.x = x;
      s.pos.z = z;
      return residual;
    }
    return grown;
  }

  /**
   * A turn refused for DETOUR_DELAY while the rig is pinned (e.g. body against a box, forks in a corner) tries the
   * long way round, once per intent, if turning that way has room. Tight lanes (both ways blocked) keep holding
   * still; a turn refused while the rig slides on is left alone (it frees itself).
   */
  private trackPinned(pinned: boolean, dt: number, target: number): void {
    if (!pinned) {
      this.refusedTime = 0;
      return;
    }
    this.refusedTime += dt;
    if (this.refusedTime < DETOUR_DELAY || this.detour !== 0 || this.detourUsed) return;
    this.refusedTime = 0;
    const side = -Math.sign(angleDelta(this.state.heading, target));
    if (side === 0 || !this.fitsTurned(side * DETOUR_PROBE_ANGLE)) return;
    this.detour = side;
    this.detourUsed = true;
    this.detourTarget = target;
  }

  private endDetour(): void {
    this.detour = 0;
    this.detourUsed = false;
    this.refusedTime = 0;
  }

  /** Static check: would the rig fit (after push-out) turned `angle` rad from the current pose? */
  private fitsTurned(angle: number): boolean {
    const s = this.state;
    const t = this.tuning;
    const h = s.heading + angle;
    const p = this.probe;
    p.x = s.pos.x;
    p.z = s.pos.z;
    return this.world.resolve(p, Math.sin(h), Math.cos(h), t.bodyRadius, t.forkReach, this.loadRadius) <= WEDGE_TOLERANCE;
  }

  /** Signed heading error toward `target`: the shortest way, or the long way round during a detour. */
  private turnError(target: number): number {
    const error = angleDelta(this.state.heading, target);
    return this.detour !== 0 && error !== 0 && Math.sign(error) !== this.detour ? error + this.detour * TAU : error;
  }

  /**
   * Turn toward `target` with a trapezoidal profile: angular speed builds up at `turnAcceleration`, cruises at
   * `turnRate`, and slows early enough (v = sqrt(2·a·error)) to land on the target heading without overshoot.
   */
  private turn(dt: number, hasMove: boolean, target: number): void {
    const s = this.state;
    const t = this.tuning;
    if (!hasMove) {
      this.angularVelocity = damp(this.angularVelocity, 0, TURN_RELEASE_LAMBDA, dt);
      s.heading = wrapAngle(s.heading + this.angularVelocity * dt);
      return;
    }
    const error = this.turnError(target);
    const desired = Math.sign(error) * Math.min(t.turnRate, Math.sqrt(2 * t.turnAcceleration * Math.abs(error)));
    this.angularVelocity = approach(this.angularVelocity, desired, t.turnAcceleration * dt);
    const step = this.angularVelocity * dt;
    if (Math.abs(step) >= Math.abs(error) && Math.sign(step) === Math.sign(error)) {
      s.heading = wrapAngle(target);
      this.angularVelocity = 0;
      if (this.detour !== 0) this.endDetour();
    } else {
      s.heading = wrapAngle(s.heading + step);
    }
  }

  /**
   * Vehicle steering: angular speed eases toward `steer · driveTurnRate` at turnAcceleration and settles softly on
   * release. While driving without steering, a heading within `headingAssistDeg` of a tile axis eases onto it,
   * so straight runs line up with the rows of tiles, boxes and zones without fiddly corrections.
   */
  private turnDrive(dt: number, throttle: number, steer: number): void {
    const s = this.state;
    const t = this.tuning;
    if (this.headingLocked) {
      this.angularVelocity = 0;
      this.assistRate = 0;
      this.driveRate = 0;
      return;
    }
    if (steer !== 0) this.angularVelocity = approach(this.angularVelocity, steer * t.driveTurnRate, t.turnAcceleration * dt);
    else this.angularVelocity = damp(this.angularVelocity, 0, DRIVE_TURN_RELEASE_LAMBDA, dt);
    // The assist is its own eased turn rate, proportional to speed: it never rotates a parked or pinned rig and
    // never steps in abruptly at the edge of the band.
    let assistTarget = 0;
    if (steer === 0 && throttle !== 0 && t.headingAssistDeg > 0) {
      const axis = Math.round(s.heading / QUARTER_TURN) * QUARTER_TURN;
      const error = angleDelta(s.heading, axis);
      const top = s.speed >= 0 ? t.maxSpeed : t.reverseSpeed;
      if (Math.abs(error) < degToRad(t.headingAssistDeg) && top > 0) {
        assistTarget = HEADING_ASSIST_LAMBDA * error * Math.min(1, Math.abs(s.speed) / top);
      }
    }
    this.assistRate = approach(this.assistRate, assistTarget, t.turnAcceleration * dt);
    // Combine without stacking: the same way, the faster one wins; opposite ways, they cancel out.
    const w = this.angularVelocity;
    const a = this.assistRate;
    this.driveRate = w * a > 0 ? Math.sign(w) * Math.max(Math.abs(w), Math.abs(a)) : w + a;
    s.heading = wrapAngle(s.heading + this.driveRate * dt);
  }

  /** Integrate position along the heading, then push out of obstacles. Returns residual penetration. */
  private advance(dt: number): number {
    const s = this.state;
    const t = this.tuning;
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    s.pos.x += fx * s.speed * dt;
    s.pos.z += fz * s.speed * dt;
    return this.world.resolve(s.pos, fx, fz, t.bodyRadius, t.forkReach, this.loadRadius);
  }

  /**
   * How freely the forklift can move straight ahead (direction 1) or back (−1) (probe + push-out): 1 in the open
   * or sliding along a wall at ≤ 45°, easing to 0 when pushing head-on. Keeps wheels / motor from spinning against
   * a wall, without ever slowing a slide (the factor depends on geometry only, not on the current speed).
   */
  private measureBlockFactor(direction: 1 | -1): number {
    const s = this.state;
    const t = this.tuning;
    const fx = Math.sin(s.heading);
    const fz = Math.cos(s.heading);
    const mx = fx * direction;
    const mz = fz * direction;
    const p = this.probe;
    p.x = s.pos.x + mx * PROBE_DISTANCE;
    p.z = s.pos.z + mz * PROBE_DISTANCE;
    this.world.resolve(p, fx, fz, t.bodyRadius, t.forkReach, this.loadRadius);
    const progress = ((p.x - s.pos.x) * mx + (p.z - s.pos.z) * mz) / PROBE_DISTANCE;
    const k = clamp(progress / FREE_PROGRESS, 0, 1);
    return k * k * (3 - 2 * k);
  }
}
