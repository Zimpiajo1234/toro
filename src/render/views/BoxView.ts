import { Euler, Group, Mesh, Quaternion, Vector3, type BufferGeometry, type MeshStandardMaterial, type Object3D } from 'three';
import type { BoxState, ColorId } from '../../core/types';
import { damp, easeInOutSine, easeOutBack, easeOutCubic } from '../../core/math';
import { GAME_CONFIG } from '../../config';
import { rackSlotY } from '../dims';
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
/**
 * Inside a rack slot the beam of the slot above is close (dims RACK): the pick target lifts less and the pick hop is
 * a small one, so the box never touches it. The glow still reads.
 */
const SLOT_HOVER_LIFT = 0.03;
const SLOT_PICK_HOP = 0.02;
const HOVER_GLOW = 0.16;
const CORRECT_GLOW = 0.1;
const WAVE_GLOW = 0.16;
/**
 * A box landing on a stack: the whole stack (the new box included) dips together by this share of one level
 * and recovers, much softer than the landing squash. An offset, never a scale, so stacked boxes keep touching.
 */
const STACK_SETTLE_SEC = 0.42;
const STACK_SETTLE_DEPTH = 0.035;
/**
 * Landing up on a stack from lower forks: rise over the first LIFT_SHARE of the glide (all but done by
 * SLIDE_FROM), then slide on top with an ease-in-out (no sudden start), so the box never passes through the
 * box below. The glide still lands at DROP_GLIDE_SEC.
 */
const LIFT_SHARE = 0.45;
const SLIDE_FROM = 0.4;
/** Opacity of an upper stacked box while it hides something the player needs to see (colors stay readable). */
const GHOST_OPACITY = 0.55;
const GHOST_RATE = 6;
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
  private readonly stackSettle = new OneShot(STACK_SETTLE_SEC);
  /** Current stack dip 0…1 (bump of stackSettle), applied as a downward offset of the inner mesh. */
  private stackDip = 0;
  /** Whether the current wave also bobs the box (off inside a stack, where boxes must keep touching). */
  private waveBob = true;
  private opacity = 1;
  private hover = 0;
  private correctGlow: number;
  private glideTurn = 1;
  /** Resting in a rack slot (last seen while not carried): sets the hover lift and the next pick hop. */
  private inSlot: boolean;

  constructor(
    state: BoxState,
    geometry: BufferGeometry,
    private readonly material: MeshStandardMaterial,
    /** Rotational symmetry of the lid glyph (see GLYPH_SYMMETRY). */
    private readonly glyphSymmetry: number,
    /** Height of one stack level (the box's visual height); resting y = level · stackStep. */
    private readonly stackStep = 0,
    /** Stack levels only: the material may fade (ghost) while the box hides the forklift. */
    ghostable = false,
  ) {
    if (ghostable) {
      // Always transparent (opacity 1 while solid) so fading never switches shader programs mid-game.
      material.transparent = true;
    }
    this.id = state.id;
    this.color = state.color;
    this.mesh = new Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    this.group.userData.boxId = state.id;
    this.inSlot = state.slotId !== null;
    this.group.position.set(state.pos.x, this.restY(state), state.pos.z);
    this.phase = state.carried ? 'carried' : 'rest';
    this.correctGlow = state.correct ? 1 : 0;
  }

  /** actionIdle while carrying: a tiny, gentle side-to-side wobble. */
  playWobble(): void {
    this.wobble.start();
  }

  /** Glow pulse (and a tiny bob when `bob`; boxes in a stack only glow, so no seam opens between them). */
  playWave(delay: number, bob = true): void {
    this.wave.start(delay);
    this.waveBob = bob;
  }

  /**
   * A box just landed on this box's stack (or this box landed on one): a slight, slow dip and recover once it
   * lands. Every box of the stack plays it with the same delay, so they move as one.
   */
  playStackSettle(delay: number): void {
    this.stackSettle.start(delay);
  }

  /** Fade toward the ghost (true) or back to solid. Only has an effect on ghostable boxes. */
  setGhost(ghost: boolean, dt: number): void {
    if (!this.material.transparent) return;
    this.opacity = damp(this.opacity, ghost ? GHOST_OPACITY : 1, GHOST_RATE, dt);
    if (!ghost && this.opacity > 0.995) this.opacity = 1;
    this.material.opacity = this.opacity;
    this.material.depthWrite = this.opacity >= 1;
  }

  sync(state: BoxState, anchor: Object3D, isTarget: boolean, dt: number): void {
    if (state.carried && (this.phase === 'rest' || this.phase === 'dropping')) this.beginPick();
    else if (!state.carried && (this.phase === 'picking' || this.phase === 'carried')) this.beginDrop(state);

    if (!state.carried) this.inSlot = state.slotId !== null;

    const g = this.group;
    switch (this.phase) {
      case 'picking': {
        this.pick.step(dt);
        const e = easeInOutSine(this.pick.p);
        anchor.getWorldPosition(_target);
        anchor.getWorldQuaternion(_targetQuat);
        g.position.lerpVectors(this.from, _target, e);
        g.position.y += bump(this.pick.p) * (this.inSlot ? SLOT_PICK_HOP : PICK_HOP);
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
        const restY = this.restY(state);
        let e: number;
        if (restY > this.from.y + 1e-3) {
          // Landing up on a stack from lower forks: lift first, then slide (and turn) on top.
          e = easeInOutSine(Math.max(0, (p - SLIDE_FROM) / (1 - SLIDE_FROM)));
          g.position.y = this.from.y + (restY - this.from.y) * easeOutCubic(Math.min(1, p / LIFT_SHARE));
        } else {
          e = easeOutCubic(p);
          g.position.y = restY + (this.from.y - restY) * (1 - p * p); // eases onto the floor / the stack, then settles
        }
        g.position.x = this.from.x + (state.pos.x - this.from.x) * e;
        g.position.z = this.from.z + (state.pos.z - this.from.z) * e;
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
        g.position.y = damp(g.position.y, this.restY(state), 18, dt);
        g.quaternion.slerp(this.restQuat, 1 - Math.exp(-7 * dt));
        break;
    }

    this.applySettle(dt);
    this.applyHighlight(state, isTarget, dt);
  }

  /** Resting height: its stack level, or the floor of its rack slot. */
  private restY(state: BoxState): number {
    return state.slotId !== null ? rackSlotY(state.level) : state.level * this.stackStep;
  }

  private beginPick(): void {
    this.phase = 'picking';
    this.from.copy(this.group.position);
    this.fromQuat.copy(this.group.quaternion);
    this.pick.start();
    this.drop.stop();
    this.settle.stop();
    // A running stack dip plays out (it is a tiny offset): stopping it would snap the box up.
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

  /** Squash on landing, stretch, settle (easeOutBack, scale ≤ 1.08); the stack dip runs alongside. */
  private applySettle(dt: number): void {
    this.stackDip = this.stackSettle.step(dt) ? bump(this.stackSettle.p) : 0;
    if (this.settle.step(dt)) {
      const sy = 0.9 + 0.1 * easeOutBack(this.settle.p, 6.5);
      const sxz = 1 / Math.sqrt(sy);
      this.group.scale.set(sxz, sy, sxz);
    }
  }

  private applyHighlight(state: BoxState, isTarget: boolean, dt: number): void {
    this.hover = damp(this.hover, isTarget && !state.carried ? 1 : 0, 10, dt);
    this.correctGlow = damp(this.correctGlow, state.correct ? 1 : 0, 3, dt);
    let yaw = 0;
    if (this.wobble.step(dt)) yaw = Math.sin(this.wobble.p * Math.PI * 5) * (1 - this.wobble.p) * 0.07;
    const wave = this.wave.step(dt) ? bump(this.wave.p) : 0;
    const bob = this.waveBob ? wave * 0.02 : 0;
    this.mesh.position.y = this.hover * (this.inSlot ? SLOT_HOVER_LIFT : HOVER_LIFT) + bob - STACK_SETTLE_DEPTH * this.stackStep * this.stackDip;
    this.mesh.rotation.y = yaw;
    this.material.emissiveIntensity = Math.max(this.hover * HOVER_GLOW, this.correctGlow * CORRECT_GLOW) + wave * WAVE_GLOW;
  }
}
