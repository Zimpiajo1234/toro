import { Group, Mesh, type BufferGeometry, type Color, type MeshBasicMaterial } from 'three';
import { easeInOutSine, easeOutCubic, lerp } from '../../core/math';
import { OneShot, bump } from '../tween';

/*
 * Levels with storage racks (docs/RACKS.md): a zone or a cued slot lights only with its destined box, and that box is
 * then done and fixed (BoxState.locked). The sequence, from the moment the box lands (the drop glide, DROP_GLIDE_SEC):
 * the target's glow flashes intense and a small burst plays (a soft ring and a few sparkles in the box colour), the
 * glow eases to a soft steady level, then the box eases to a deeper tone of its colour (views/BoxView). While a box is
 * carried, the targets whose cue fits it glow much more than in the levels without racks: a clear, calm pulse.
 */

/** Target glow once it holds its destined box (the zones' rest level, as always). */
export const TARGET_REST = 0.15;
/** Peak of the flash when the destined box lands: intense, still a pastel light (emissive in the target's glow tone). */
export const FLASH_PEAK = 0.8;
/** The whole flash: a quick rise, then a calm ease down to TARGET_REST. */
export const FLASH_SEC = 0.85;
/** Share of FLASH_SEC spent rising to the peak. */
export const FLASH_RISE_SHARE = 0.14;
/** The box starts to deepen once the flash has settled; it takes this long. */
export const LOCK_SEC = 0.6;
/** The burst (ring + sparkles). */
export const BURST_SEC = 0.65;
/**
 * Strong invitation while carrying (glow = INVITE_BASE + INVITE_PULSE · sin): about four times the soft breathing of
 * the levels without racks (0.1 ± 0.07), readable at a glance, at the same calm rhythm.
 */
export const INVITE_BASE = 0.4;
export const INVITE_PULSE = 0.16;
export const INVITE_RATE = 2.3;
/** The quiet swap hint keeps its old strength under the strong invitation: SWAP_INVITE (0.32) × 0.17 / 0.56. */
export const RACK_SWAP_INVITE = 0.1;

/**
 * Flash envelope at progress `p` of FLASH_SEC: 0 → 1 (quick, ease out) → 0 (calm ease in-out). Glow during the flash:
 * lerp(rest, FLASH_PEAK, envelope), rising from wherever the glow was.
 */
export function flashEnvelope(p: number): number {
  return p < FLASH_RISE_SHARE ? easeOutCubic(p / FLASH_RISE_SHARE) : 1 - easeInOutSine((p - FLASH_RISE_SHARE) / (1 - FLASH_RISE_SHARE));
}

/** Glow of a flashing target at progress `p`, rising from `from` (its glow when the box landed) and settling at rest. */
export function flashGlow(p: number, from: number): number {
  return p < FLASH_RISE_SHARE ? lerp(from, FLASH_PEAK, flashEnvelope(p)) : lerp(TARGET_REST, FLASH_PEAK, flashEnvelope(p));
}

const SPARKLES = 7;
/** Sparkle size (the shared octahedron's radius is 1: scaled down) and its vertical stretch (a small diamond glint). */
const SPARKLE_SIZE = 0.05;
const SPARKLE_STRETCH = 1.6;
/** Ring: opacity at start and how much it grows. */
const RING_OPACITY = 0.9;
const RING_GROWTH = 0.3;
/** Box height the floor sparkles start around (a resting box is ≈ 0.64 tall). */
const FLOOR_Y0 = 0.42;
const FLOOR_RISE = 0.34;
const FLOOR_R0 = 0.3;
const FLOOR_R1 = 0.56;
/** Slot sparkles: around the slot opening on its front face (slot-local), spreading out and toward the viewer. */
const SLOT_RX = [0.25, 0.62] as const;
const SLOT_RY = [0.16, 0.46] as const;
const SLOT_OUT = [0.54, 0.72] as const;

/** Where a burst plays: over a zone pad (floor), or on the front face of a rack slot. */
export type BurstMode = 'floor' | 'slot';

/**
 * A small success burst, pooled by LevelView (levels with racks): a soft rounded ring (on a slot's front face; a zone
 * has its own floor ring) and a few sparkles in the box colour that spread, twinkle and fade over BURST_SEC. Hidden
 * while idle; everything is built once (no allocation while it plays).
 */
export class SuccessBurst {
  readonly group = new Group();
  private readonly ring: Mesh;
  private readonly sparkles: Mesh[] = [];
  private readonly anim = new OneShot(BURST_SEC);
  private mode: BurstMode = 'floor';
  /** Slot opening half extents (slot mode: the ring hugs the opening and grows). */
  private halfW = 0.47;
  private halfH = 0.35;

  constructor(
    ringGeometry: BufferGeometry,
    private readonly ringMaterial: MeshBasicMaterial,
    sparkleGeometry: BufferGeometry,
    private readonly sparkleMaterial: MeshBasicMaterial,
  ) {
    this.group.userData.successBurst = true;
    this.group.visible = false;
    this.ring = new Mesh(ringGeometry, ringMaterial);
    // The outline lies in XZ: stood up, it faces slot-local +z (the rack's front).
    this.ring.rotation.x = Math.PI / 2;
    this.ring.renderOrder = 3;
    this.group.add(this.ring);
    for (let i = 0; i < SPARKLES; i++) {
      const s = new Mesh(sparkleGeometry, sparkleMaterial);
      s.renderOrder = 3;
      this.sparkles.push(s);
      this.group.add(s);
    }
  }

  /** Playing (or waiting for its delay). */
  get active(): boolean {
    return this.anim.active;
  }

  /**
   * Play at (x, y, z) after `delay` s: `floor` = y is the floor under a zone; `slot` = y is the slot floor, `yaw` turns
   * slot-local +z to the rack's front (builders/rack outwardYaw), `halfW` / `halfH` = half the slot opening.
   * `color` = the box's sparkle tone (copied).
   */
  play(mode: BurstMode, x: number, y: number, z: number, yaw: number, color: Color, delay: number, halfW = 0.47, halfH = 0.35): void {
    this.mode = mode;
    this.halfW = halfW;
    this.halfH = halfH;
    this.group.position.set(x, y, z);
    this.group.rotation.y = mode === 'slot' ? yaw : 0;
    this.sparkleMaterial.color.copy(color);
    this.ringMaterial.color.copy(color);
    this.ring.visible = mode === 'slot';
    this.anim.start(delay);
    this.apply(0);
    this.group.visible = false;
  }

  stop(): void {
    this.anim.stop();
    this.group.visible = false;
  }

  update(dt: number): void {
    if (!this.anim.active) {
      this.group.visible = false;
      return;
    }
    if (!this.anim.step(dt)) return; // still waiting for the box to land
    const p = this.anim.p;
    this.group.visible = p < 1;
    this.apply(p);
  }

  private apply(p: number): void {
    const out = easeOutCubic(p);
    const fade = 1 - p * p;
    this.sparkleMaterial.opacity = fade;
    for (let i = 0; i < this.sparkles.length; i++) {
      const s = this.sparkles[i];
      // Evenly around, each a little later than the one before, so they twinkle rather than pop together.
      const a = (i / SPARKLES) * Math.PI * 2 + 0.35;
      const lag = (i % 3) * 0.08;
      const q = Math.max(0, Math.min(1, (p - lag) / (1 - lag)));
      const k = easeOutCubic(q);
      if (this.mode === 'floor') {
        const r = FLOOR_R0 + (FLOOR_R1 - FLOOR_R0) * k;
        s.position.set(Math.cos(a) * r, FLOOR_Y0 + (i % 2) * 0.1 + FLOOR_RISE * k, Math.sin(a) * r);
      } else {
        const rx = SLOT_RX[0] + (SLOT_RX[1] - SLOT_RX[0]) * k;
        const ry = SLOT_RY[0] + (SLOT_RY[1] - SLOT_RY[0]) * k;
        s.position.set(Math.cos(a) * rx, this.halfH + Math.sin(a) * ry, SLOT_OUT[0] + (SLOT_OUT[1] - SLOT_OUT[0]) * k);
      }
      const size = SPARKLE_SIZE * bump(q) * (i % 2 === 0 ? 1 : 0.75);
      s.scale.set(size, size * SPARKLE_STRETCH, size);
      s.rotation.y = a + out;
      s.visible = size > 1e-4;
    }
    if (this.mode === 'slot') {
      const g = 1 + RING_GROWTH * out;
      // Outline half extent is 0.5 (buildOutlineGeometry): scaled to the opening, then grown.
      this.ring.scale.set(2 * this.halfW * g, 1, 2 * this.halfH * g);
      this.ring.position.set(0, this.halfH, 0.52);
      this.ringMaterial.opacity = RING_OPACITY * fade * (1 - p);
    }
  }
}
