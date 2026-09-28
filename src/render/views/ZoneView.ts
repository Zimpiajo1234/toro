import { Group, Mesh, type BufferGeometry, type MeshBasicMaterial, type MeshStandardMaterial } from 'three';
import type { ColorId, ZoneState } from '../../core/types';
import { damp, easeInOutSine, easeOutCubic, lerp } from '../../core/math';
import { ZONE } from '../dims';
import { OneShot, bump } from '../tween';

const GLOW_PEAK = 0.35;
const GLOW_REST = 0.15;
const RISE_SHARE = 0.3;
const RING_OPACITY = 0.5;
const RING_GROWTH = 0.45;
/** Halo opacity per unit of glow. */
const HALO_GAIN = 1.5;
/** Recipe step the carried box would fill: breathes with the pad (same rhythm), a bit brighter as it is small. */
const STEP_GLOW = 0.16;
const STEP_PULSE = 0.1;

export interface ZoneGeometries {
  pad: BufferGeometry;
  ring: BufferGeometry;
  halo: BufferGeometry;
}

/**
 * Delivery zone: glow rises and settles when satisfied (with one soft expanding ring), eases off
 * when released, breathes gently while a box of its color is being carried.
 */
export class ZoneView {
  readonly id: string;
  readonly color: ColorId;
  readonly group = new Group();
  private readonly pad: Mesh;
  private readonly ring: Mesh;
  private readonly halo: Mesh;
  private satisfied: boolean;
  /** Boxes on the pad last frame: a release with more boxes than before came from a box stacked on top. */
  private stackLength: number;
  /** Seconds the satisfied glow is still held after such a release (it eases off when that box lands). */
  private releaseHold = 0;
  private glow: number;
  private celebrateFrom = 0;
  private breathe = 0;
  private readonly celebrate = new OneShot(1.1);
  private readonly ringAnim = new OneShot(0.8);
  private readonly wave = new OneShot(0.75);
  /** Stack zones: glow material of each recipe step (bottom → top) and its breathe envelope. */
  private readonly stepMaterials: MeshStandardMaterial[] = [];
  private readonly stepBreathe: number[] = [];

  constructor(
    state: ZoneState,
    geometry: ZoneGeometries,
    private readonly padMaterial: MeshStandardMaterial,
    private readonly ringMaterial: MeshBasicMaterial,
    private readonly haloMaterial: MeshBasicMaterial,
    /** Delay before the celebration starts (lets the dropped box land first). */
    private readonly landDelay: number,
  ) {
    this.id = state.id;
    this.color = state.color;
    this.group.userData.zoneId = state.id;
    this.group.position.set(state.pos.x, 0, state.pos.z);
    this.pad = new Mesh(geometry.pad, padMaterial);
    this.pad.receiveShadow = true;
    this.ring = new Mesh(geometry.ring, ringMaterial);
    this.ring.position.y = ZONE.padHeight + 0.006;
    this.ring.visible = false;
    this.ring.renderOrder = 1;
    this.halo = new Mesh(geometry.halo, haloMaterial);
    this.halo.visible = false;
    this.group.add(this.halo, this.pad, this.ring);
    this.satisfied = state.satisfied;
    this.stackLength = state.stack.length;
    this.glow = state.satisfied ? GLOW_REST : 0;
    this.padMaterial.emissiveIntensity = this.glow;
  }

  playWave(delay: number): void {
    this.wave.start(delay);
  }

  /**
   * Stack zones: the recipe marker (cream base + one mesh per step, bottom → top, each with its own glow
   * material). While the carried box is the one the zone takes next, its step breathes with the pad.
   */
  addRecipe(base: Mesh, steps: readonly Mesh<BufferGeometry, MeshStandardMaterial>[]): void {
    this.group.add(base);
    for (const step of steps) {
      this.group.add(step);
      this.stepMaterials.push(step.material);
      this.stepBreathe.push(0);
      step.material.emissiveIntensity = 0;
    }
  }

  sync(state: ZoneState, carriedColor: ColorId | null, time: number, dt: number): void {
    if (state.satisfied !== this.satisfied) {
      this.satisfied = state.satisfied;
      if (this.satisfied) {
        this.celebrateFrom = this.glow;
        this.celebrate.start(this.landDelay);
        this.ringAnim.start(this.landDelay);
      } else {
        this.celebrate.stop();
        // Stacked on top: the zone lets go as that box lands (with the audio's release tick), not while it glides.
        this.releaseHold = state.stack.length > this.stackLength ? this.landDelay : 0;
      }
    }
    if (this.satisfied) this.releaseHold = 0;
    this.stackLength = state.stack.length;
    if (this.releaseHold > 0) this.releaseHold = Math.max(0, this.releaseHold - dt);

    if (this.celebrate.step(dt)) {
      const p = this.celebrate.p;
      this.glow =
        p < RISE_SHARE
          ? lerp(this.celebrateFrom, GLOW_PEAK, easeOutCubic(p / RISE_SHARE))
          : lerp(GLOW_PEAK, GLOW_REST, easeInOutSine((p - RISE_SHARE) / (1 - RISE_SHARE)));
    } else if (!this.celebrate.active && this.releaseHold <= 0) {
      this.glow = damp(this.glow, this.satisfied ? GLOW_REST : 0, this.satisfied ? 4 : 2.2, dt);
    }

    // Teach the goal without words: zones that take the carried color next breathe softly.
    const invite = carriedColor !== null && carriedColor === state.next ? 1 : 0;
    this.breathe = damp(this.breathe, invite, 3, dt);
    const breatheGlow = this.breathe * (0.1 + 0.07 * Math.sin(time * 2.3));
    // …and so does the recipe step that box would fill (its own envelope: no jump when the next step changes).
    const nextStep = invite ? state.stack.length : -1;
    for (let i = 0; i < this.stepMaterials.length; i++) {
      this.stepBreathe[i] = damp(this.stepBreathe[i], i === nextStep ? 1 : 0, 3, dt);
      this.stepMaterials[i].emissiveIntensity = this.stepBreathe[i] * (STEP_GLOW + STEP_PULSE * Math.sin(time * 2.3));
    }

    const wave = this.wave.step(dt) ? bump(this.wave.p) : 0;
    const glow = this.glow + breatheGlow + wave * 0.28;
    this.padMaterial.emissiveIntensity = glow;
    this.pad.position.y = wave * 0.012;
    this.haloMaterial.opacity = Math.min(0.7, glow * HALO_GAIN);
    this.halo.visible = this.haloMaterial.opacity > 0.01;

    if (this.ringAnim.step(dt)) {
      const p = this.ringAnim.p;
      const s = 1 + RING_GROWTH * easeOutCubic(p);
      this.ring.visible = p < 1;
      this.ring.scale.set(s, 1, s);
      this.ringMaterial.opacity = RING_OPACITY * (1 - p) * (1 - p);
    } else if (!this.ringAnim.active) {
      this.ring.visible = false;
    }
  }
}
