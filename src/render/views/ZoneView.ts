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
  private glow: number;
  private celebrateFrom = 0;
  private breathe = 0;
  private readonly celebrate = new OneShot(1.1);
  private readonly ringAnim = new OneShot(0.8);
  private readonly wave = new OneShot(0.75);

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
    this.glow = state.satisfied ? GLOW_REST : 0;
    this.padMaterial.emissiveIntensity = this.glow;
  }

  playWave(delay: number): void {
    this.wave.start(delay);
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
      }
    }

    if (this.celebrate.step(dt)) {
      const p = this.celebrate.p;
      this.glow =
        p < RISE_SHARE
          ? lerp(this.celebrateFrom, GLOW_PEAK, easeOutCubic(p / RISE_SHARE))
          : lerp(GLOW_PEAK, GLOW_REST, easeInOutSine((p - RISE_SHARE) / (1 - RISE_SHARE)));
    } else if (!this.celebrate.active) {
      this.glow = damp(this.glow, this.satisfied ? GLOW_REST : 0, this.satisfied ? 4 : 2.2, dt);
    }

    // Teach the goal without words: free zones of the carried color breathe softly.
    const invite = carriedColor === this.color && state.occupiedBy === null ? 1 : 0;
    this.breathe = damp(this.breathe, invite, 3, dt);
    const breatheGlow = this.breathe * (0.1 + 0.07 * Math.sin(time * 2.3));

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
