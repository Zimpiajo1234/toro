import { Group, Mesh, Object3D, type Material } from 'three';
import type { ForkliftState } from '../../core/types';
import { TAU, clamp, damp, degToRad, lerp } from '../../core/math';
import { FORKLIFT_LAYOUT, type ForkliftGeometry } from '../builders/forklift';
import { FORK, RACK } from '../dims';
import { OneShot, bump } from '../tween';

const MAX_TILT = degToRad(3);
const PITCH_PER_ACCEL = 0.0075;
const BLINK_MIN = 4;
const BLINK_MAX = 8;
/** Visual easing of the stack height on top of logic's steady rate (1/s): soft starts and landings. */
const STACK_LIFT_LAMBDA = 7;
/**
 * At a rack the easing is a little tighter (still soft), so the load stays close to the slot level logic has reached
 * and slides in over its beam rather than through it.
 */
const RACK_LIFT_LAMBDA = 12;
/** How fast the forks switch between floor / stack heights and rack slot heights (1/s, exponential). */
const RACK_BLEND_LAMBDA = 6;
/** At a rack the body barely pitches, so the load stays level as it goes into a slot. */
const RACK_PITCH_SHARE = 0.3;
/** The inner mast stage rises this share of the extra carriage height (so the carriage always rides on it). */
const INNER_MAST_SHARE = 0.6;

export interface ForkliftMaterials {
  painted: Material;
  unlit: Material;
}

export interface ForkliftTuning {
  maxSpeed: number;
  wheelRadius: number;
  forkReach: number;
  /** World height of one stack level (box visual height). Optional: 0 = no stacking visuals. */
  stackStep?: number;
}

/** Scene graph + animation of the forklift. Reads ForkliftState, never mutates it. */
export class ForkliftView {
  readonly root = new Group();
  /** Fork point (carried box bottom-center) that rides with the carriage. */
  readonly anchor = new Object3D();

  private readonly chassis = new Group();
  private readonly carriage: Mesh;
  private readonly innerMast: Mesh;
  private stackLift = 0;
  /** 0 = floor / stack heights, 1 = rack slot heights (dims RACK), eased while the rig engages or leaves a rack. */
  private rackBlend = 0;
  private readonly eyes: Mesh;
  private readonly wheels: Mesh[] = [];
  private readonly rearPivots: Group[] = [];

  private pitch = 0;
  private roll = 0;
  private accel = 0;
  private prevSpeed: number;
  private steer = 0;
  private blinkIn = 0;
  private doubleBlink = false;
  private readonly blink = new OneShot(0.17);
  private readonly wobble = new OneShot(0.5);
  private readonly shrug = new OneShot(0.45);
  private readonly happy = new OneShot(1.1);

  constructor(
    geometry: ForkliftGeometry,
    materials: ForkliftMaterials,
    private readonly tuning: ForkliftTuning,
    initial: ForkliftState,
  ) {
    const L = FORKLIFT_LAYOUT;
    const body = new Mesh(geometry.chassis, materials.painted);
    body.castShadow = true;
    body.receiveShadow = true;
    this.carriage = new Mesh(geometry.carriage, materials.painted);
    this.carriage.castShadow = true;
    this.carriage.receiveShadow = true;
    this.anchor.position.set(0, 0, tuning.forkReach);
    this.carriage.add(this.anchor);
    this.innerMast = new Mesh(geometry.innerMast, materials.painted);
    this.innerMast.castShadow = true;
    this.innerMast.visible = false;
    this.eyes = new Mesh(geometry.eyes, materials.unlit);
    this.eyes.position.y = L.eyeY;
    this.chassis.add(body, this.innerMast, this.carriage, this.eyes);
    this.root.add(this.chassis);

    for (const [x, z, rear] of [
      [-L.trackHalf, L.frontAxleZ, false],
      [L.trackHalf, L.frontAxleZ, false],
      [-L.trackHalf, L.rearAxleZ, true],
      [L.trackHalf, L.rearAxleZ, true],
    ] as const) {
      const wheel = new Mesh(geometry.wheel, materials.painted);
      wheel.castShadow = true;
      this.wheels.push(wheel);
      if (rear) {
        const pivot = new Group();
        pivot.position.set(x, tuning.wheelRadius, z);
        pivot.add(wheel);
        this.rearPivots.push(pivot);
        this.root.add(pivot);
      } else {
        wheel.position.set(x, tuning.wheelRadius, z);
        this.root.add(wheel);
      }
    }

    this.prevSpeed = initial.speed;
    this.blinkIn = lerp(1.5, BLINK_MAX, Math.random());
    this.sync(initial, 0, 0);
  }

  /** actionIdle with nothing on the forks: a tiny shrug of the forks and a soft wobble. */
  playShrug(): void {
    this.shrug.start();
    this.wobble.start();
  }

  /** Level complete: a small contented bounce. */
  playHappy(delay = 0): void {
    this.happy.start(delay);
  }

  /**
   * `atRack`: the rig faces a storage rack column (hint.rack). There forkHeight counts slot levels (dims rackSlotY)
   * and the forks ride just over the selected slot floor, empty or under the load, so it clears the beam above.
   */
  sync(state: ForkliftState, dt: number, time: number, atRack = false): void {
    const { tuning } = this;
    const rackTarget = atRack ? 1 : 0;
    this.rackBlend = dt > 0 ? damp(this.rackBlend, rackTarget, RACK_BLEND_LAMBDA, dt) : rackTarget;
    if (Math.abs(this.rackBlend - rackTarget) < 1e-4) this.rackBlend = rackTarget;
    const blend = this.rackBlend;
    this.root.position.set(state.pos.x, 0, state.pos.z);
    this.root.rotation.y = state.heading;

    // Body pitch from (smoothed) acceleration, roll from turning at speed. Both ≤ 3°.
    if (dt > 0) {
      this.accel = damp(this.accel, (state.speed - this.prevSpeed) / dt, 6, dt);
      this.prevSpeed = state.speed;
    }
    const speed01 = clamp(Math.abs(state.speed) / tuning.maxSpeed, 0, 1);
    const maxPitch = MAX_TILT * lerp(1, RACK_PITCH_SHARE, blend);
    this.pitch = damp(this.pitch, clamp(-this.accel * PITCH_PER_ACCEL, -maxPitch, maxPitch), 8, dt);
    this.roll = damp(this.roll, clamp(state.steer * speed01, -1, 1) * MAX_TILT, 6, dt);
    let roll = this.roll;
    if (this.wobble.step(dt)) roll += Math.sin(this.wobble.p * Math.PI * 4) * (1 - this.wobble.p) * 0.03;
    this.chassis.rotation.set(this.pitch, 0, roll);

    // Idle "hum" breathing when parked, plus the happy bounce.
    let lift = Math.sin(time * 3.1) * 0.004 * (1 - speed01);
    if (this.happy.step(dt)) lift += Math.abs(Math.sin(this.happy.p * Math.PI * 2)) * (1 - this.happy.p) * 0.05;
    this.chassis.position.y = lift;

    // Stack height: discrete targets from logic, eased here so the carriage never starts or stops abruptly.
    const lambda = lerp(STACK_LIFT_LAMBDA, RACK_LIFT_LAMBDA, blend);
    this.stackLift = dt > 0 ? damp(this.stackLift, Math.max(0, state.forkHeight), lambda, dt) : Math.max(0, state.forkHeight);
    if (this.stackLift < 1e-4) this.stackLift = 0;
    const forkLift = clamp(state.forkLift, 0, 1);
    const floorY = lerp(FORK.downY, FORK.upY, forkLift);
    const stackY = floorY + this.stackLift * (tuning.stackStep ?? 0);
    const rackY = RACK.base + this.stackLift * RACK.pitch + lerp(RACK.forkRest, RACK.forkCarry, forkLift);
    let forkY = lerp(stackY, rackY, blend);
    const extra = Math.max(0, forkY - floorY);
    this.innerMast.visible = extra > 1e-3;
    this.innerMast.position.y = extra * INNER_MAST_SHARE;
    if (this.shrug.step(dt)) forkY += bump(this.shrug.p) * 0.035;
    this.carriage.position.y = forkY;

    const spin = state.wheelSpin % TAU;
    for (let i = 0; i < this.wheels.length; i++) this.wheels[i].rotation.x = spin;
    this.steer = damp(this.steer, clamp(state.steer, -1, 1), 10, dt);
    const steerAngle = -this.steer * FORKLIFT_LAYOUT.maxSteer;
    for (let i = 0; i < this.rearPivots.length; i++) this.rearPivots[i].rotation.y = steerAngle;

    this.updateBlink(dt);
  }

  private updateBlink(dt: number): void {
    this.blinkIn -= dt;
    if (this.blinkIn <= 0) {
      this.blink.start();
      // Now and then a quick double blink; otherwise wait 4–8 s.
      this.doubleBlink = !this.doubleBlink && Math.random() < 0.2;
      this.blinkIn = this.doubleBlink ? 0.26 : lerp(BLINK_MIN, BLINK_MAX, Math.random());
    }
    this.eyes.scale.y = this.blink.step(dt) ? 1 - 0.92 * bump(this.blink.p) : 1;
  }
}
