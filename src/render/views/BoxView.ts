import { Euler, Group, Mesh, Quaternion, Vector3, type BufferGeometry, type MeshStandardMaterial, type Object3D } from 'three';
import type { BoxState, ColorId } from '../../core/types';
import { damp, easeInOutSine, easeOutBack, easeOutCubic } from '../../core/math';
import { GAME_CONFIG } from '../../config';
import { OneShot, bump } from '../tween';

type Phase = 'rest' | 'picking' | 'carried' | 'dropping';

/**
 * Seconds the drop glide takes (`box.dropLandSec`). Zones delay their celebration by this, and the audio
 * schedules the drop thump + chime at the same moment, so sight and sound land together with the box.
 */
export const DROP_GLIDE_SEC = GAME_CONFIG.box.dropLandSec;

const PICK_SEC = 0.3;
const PICK_HOP = 0.14;
const SETTLE_SEC = 0.36;
/** Pick-target cue: the only "you can act now" affordance, so it must read at play scale (still gentle). */
const HOVER_LIFT = 0.05;
const HOVER_GLOW = 0.16;
const CORRECT_GLOW = 0.1;
const WAVE_GLOW = 0.16;
const QUARTER = Math.PI / 2;
/** Larger turns (e.g. a triangle glyph aligning to its zone) finish calmly after landing. */
const MAX_GLIDE_TURN = 0.9;
const UP = new Vector3(0, 1, 0);

const _target = new Vector3();
const _targetQuat = new Quaternion();
const _euler = new Euler();

/**
 * One pickable box. The group carries the visual transform (damped, never teleports) and the
 * squash/stretch scale; the inner mesh carries the hover lift and the idle wobble.
 */
export class BoxView {
  readonly id: string;
  readonly color: ColorId;
  readonly group = new Group();
  private readonly mesh: Mesh;
  private phase: Phase;
  private readonly from = new Vector3();
  private readonly fromQuat = new Quaternion();
  private readonly restQuat = new Quaternion();
  private readonly pick = new OneShot(PICK_SEC);
  private readonly drop = new OneShot(DROP_GLIDE_SEC);
  private readonly settle = new OneShot(SETTLE_SEC);
  private readonly wobble = new OneShot(0.5);
  private readonly wave = new OneShot(0.8);
  private hover = 0;
  private correctGlow: number;
  private glideTurn = 1;

  constructor(
    state: BoxState,
    geometry: BufferGeometry,
    private readonly material: MeshStandardMaterial,
    /** Rotational symmetry of the lid glyph (see GLYPH_SYMMETRY). */
    private readonly glyphSymmetry: number,
  ) {
    this.id = state.id;
    this.color = state.color;
    this.mesh = new Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.group.userData.boxId = state.id;
    this.group.position.set(state.pos.x, 0, state.pos.z);
    this.phase = state.carried ? 'carried' : 'rest';
    this.correctGlow = state.correct ? 1 : 0;
  }

  /** actionIdle while carrying: a tiny, gentle side-to-side wobble. */
  playWobble(): void {
    this.wobble.start();
  }

  playWave(delay: number): void {
    this.wave.start(delay);
  }

  sync(state: BoxState, anchor: Object3D, isTarget: boolean, dt: number): void {
    if (state.carried && (this.phase === 'rest' || this.phase === 'dropping')) this.beginPick();
    else if (!state.carried && (this.phase === 'picking' || this.phase === 'carried')) this.beginDrop(state);

    const g = this.group;
    switch (this.phase) {
      case 'picking': {
        this.pick.step(dt);
        const e = easeInOutSine(this.pick.p);
        anchor.getWorldPosition(_target);
        anchor.getWorldQuaternion(_targetQuat);
        g.position.lerpVectors(this.from, _target, e);
        g.position.y += bump(this.pick.p) * PICK_HOP;
        g.quaternion.slerpQuaternions(this.fromQuat, _targetQuat, e);
        if (!this.pick.active) this.phase = 'carried';
        break;
      }
      case 'carried':
        anchor.getWorldPosition(g.position);
        anchor.getWorldQuaternion(g.quaternion);
        break;
      case 'dropping': {
        this.drop.step(dt);
        const p = this.drop.p;
        const e = easeOutCubic(p);
        g.position.x = this.from.x + (state.pos.x - this.from.x) * e;
        g.position.z = this.from.z + (state.pos.z - this.from.z) * e;
        g.position.y = this.from.y * (1 - p * p); // eases into the floor, then settles
        g.quaternion.slerpQuaternions(this.fromQuat, this.restQuat, e * this.glideTurn);
        if (!this.drop.active) {
          this.phase = 'rest';
          this.settle.start();
        }
        break;
      }
      case 'rest':
        g.position.x = damp(g.position.x, state.pos.x, 18, dt);
        g.position.z = damp(g.position.z, state.pos.z, 18, dt);
        g.position.y = damp(g.position.y, 0, 18, dt);
        g.quaternion.slerp(this.restQuat, 1 - Math.exp(-7 * dt));
        break;
    }

    this.applySettle(dt);
    this.applyHighlight(state, isTarget, dt);
  }

  private beginPick(): void {
    this.phase = 'picking';
    this.from.copy(this.group.position);
    this.fromQuat.copy(this.group.quaternion);
    this.pick.start();
    this.drop.stop();
    this.settle.stop();
    this.group.scale.set(1, 1, 1);
  }

  private beginDrop(state: BoxState): void {
    this.phase = 'dropping';
    this.from.copy(this.group.position);
    this.fromQuat.copy(this.group.quaternion);
    // Land square to the grid; on its own zone, turn so the lid glyph matches the zone glyph.
    const yaw = _euler.setFromQuaternion(this.group.quaternion, 'YXZ').y;
    const step = state.correct ? this.glyphSymmetry : QUARTER;
    this.restQuat.setFromAxisAngle(UP, Math.round(yaw / step) * step);
    const turn = this.fromQuat.angleTo(this.restQuat);
    this.glideTurn = turn > MAX_GLIDE_TURN ? MAX_GLIDE_TURN / turn : 1;
    this.drop.start();
  }

  /** Squash on landing, stretch, settle (easeOutBack, scale ≤ 1.08). */
  private applySettle(dt: number): void {
    if (!this.settle.step(dt)) return;
    const sy = 0.9 + 0.1 * easeOutBack(this.settle.p, 6.5);
    const sxz = 1 / Math.sqrt(sy);
    this.group.scale.set(sxz, sy, sxz);
  }

  private applyHighlight(state: BoxState, isTarget: boolean, dt: number): void {
    this.hover = damp(this.hover, isTarget && !state.carried ? 1 : 0, 10, dt);
    this.correctGlow = damp(this.correctGlow, state.correct ? 1 : 0, 3, dt);
    let yaw = 0;
    if (this.wobble.step(dt)) yaw = Math.sin(this.wobble.p * Math.PI * 5) * (1 - this.wobble.p) * 0.07;
    const wave = this.wave.step(dt) ? bump(this.wave.p) : 0;
    this.mesh.position.y = this.hover * HOVER_LIFT + wave * 0.02;
    this.mesh.rotation.y = yaw;
    this.material.emissiveIntensity = Math.max(this.hover * HOVER_GLOW, this.correctGlow * CORRECT_GLOW) + wave * WAVE_GLOW;
  }
}
