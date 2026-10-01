import { BufferAttribute, BufferGeometry, Mesh, Sphere, Vector3, type Material, type MeshStandardMaterial } from 'three';
import { damp, easeInOutSine, easeOutCubic } from '../../core/math';
import type { Placement } from '../paint';
import { BELT, BELT_BUTTON } from '../builders/conveyor';

/**
 * The white stripes across a conveyor belt's band (docs/CONVEYOR.md): thin bands that slide along it with its surface,
 * only while it runs (so the box and the stripes move as one: the motion reads at a glance), clipped at both ends of
 * the band. One small geometry per belt whose vertices move in place: `sync(travel)` places them for the distance the
 * surface has moved (ConveyorState.travel, signed: while the belt runs back, H2, they slide backwards); nothing is
 * allocated per frame.
 */
export class BeltStripes {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly positions: Float32Array;
  private readonly count: number;
  private readonly cos: number;
  private readonly sin: number;
  private travel = Number.NaN;

  constructor(
    material: Material,
    /** Belt-local → world (builders/conveyor beltPlacement): its input's centre, the yaw along it, its cells. */
    private readonly placement: Placement & { cells: number },
    /** World y of the band's surface (the table top: builders/conveyor beltTopY). */
    private readonly top: number,
  ) {
    const length = placement.cells;
    this.count = Math.ceil(length / BELT.stripe.period) + 1;
    this.positions = new Float32Array(this.count * 18);
    const normals = new Float32Array(this.count * 18);
    for (let i = 0; i < normals.length; i += 3) normals[i + 1] = 1;
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    const ry = placement.ry ?? 0;
    this.cos = Math.cos(ry);
    this.sin = Math.sin(ry);
    // The stripes always stay on the band: a fixed bound around it, never recomputed.
    const mid = 0.5 + length / 2;
    const centre = new Vector3((placement.x ?? 0) + this.sin * mid, top, (placement.z ?? 0) + this.cos * mid);
    this.geometry.boundingSphere = new Sphere(centre, length / 2 + 1);
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.receiveShadow = true;
    this.mesh.userData.beltStripes = true;
    this.sync(0);
  }

  /** Where the stripes stand once the surface has moved `travel` cells (they only move when it changes). */
  sync(travel: number): void {
    if (travel === this.travel) return;
    this.travel = travel;
    const { period, width, lift } = BELT.stripe;
    const z0 = 0.5;
    const z1 = this.placement.cells + 0.5;
    const offset = ((travel % period) + period) % period;
    const half = BELT.band;
    const y = this.top + lift;
    for (let k = 0; k < this.count; k++) {
      const start = z0 + offset + (k - 1) * period;
      const a = Math.min(z1, Math.max(z0, start));
      const b = Math.min(z1, Math.max(z0, start + width));
      // Two triangles facing up (counter-clockwise seen from above), turned onto the belt.
      const o = k * 18;
      this.put(o, -half, y, a);
      this.put(o + 3, -half, y, b);
      this.put(o + 6, half, y, b);
      this.put(o + 9, -half, y, a);
      this.put(o + 12, half, y, b);
      this.put(o + 15, half, y, a);
    }
    (this.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  /** Writes belt-local (x, y, z) at `o`, in world space. */
  private put(o: number, x: number, y: number, z: number): void {
    const p = this.positions;
    p[o] = (this.placement.x ?? 0) + this.cos * x + this.sin * z;
    p[o + 1] = y;
    p[o + 2] = (this.placement.z ?? 0) - this.sin * x + this.cos * z;
  }
}

/**
 * How a belt's button answers (H2b, docs/CONVEYOR.md «Ajustes»), safe to tune: while the forklift stands on its pad
 * (hint.button: the action presses it now) the pad brightens a little in its own colour (its emissive, up to
 * `standGlow`, eased at `standRate`); an accepted press lights it (up to `glowPeak` within `glowRise` s, faded out by
 * `glowSec`) and sinks it softly into the floor, BELT_BUTTON.dip (down in `downSec`, back up in `upSec`); a refused one
 * only flashes it, muted (`refusedFlash` more, gone by `refusedSec`).
 */
export const BUTTON_FEEL = {
  downSec: 0.1,
  upSec: 0.3,
  glowRise: 0.06,
  glowSec: 0.75,
  glowPeak: 0.55,
  standGlow: 0.24,
  standRate: 10,
  refusedFlash: 0.1,
  refusedSec: 0.3,
} as const;

/**
 * A belt's button on screen (H2b): its pad (a mesh of its own on the floor, its back arrow a child of it) brightens
 * while the forklift stands on it, glows and dips on an accepted press and flashes, muted, on a refused one, following
 * the belt's press counts (ConveyorState.presses / accepted): a level loaded or restarted shows it at rest, nothing
 * replays. Its material is its own (its emissive, the pad's colour).
 */
export class BeltButton {
  private presses = Number.NaN;
  private accepted = Number.NaN;
  /** Seconds since the last accepted press and since the last refused one (Infinity: none playing). */
  private sinceAccepted = Infinity;
  private sinceRefused = Infinity;
  private stand = 0;

  constructor(
    readonly pad: Mesh,
    private readonly material: MeshStandardMaterial,
  ) {}

  /** Every frame: its belt's press counts, whether the forklift stands on it now (the hint names it). */
  sync(presses: number, accepted: number, standing: boolean, dt: number): void {
    if (Number.isNaN(this.presses)) {
      this.presses = presses;
      this.accepted = accepted;
    }
    const refused = presses - accepted !== this.presses - this.accepted;
    if (accepted !== this.accepted) this.sinceAccepted = 0;
    else this.sinceAccepted += dt;
    if (refused) this.sinceRefused = 0;
    else this.sinceRefused += dt;
    this.presses = presses;
    this.accepted = accepted;
    const F = BUTTON_FEEL;
    // An accepted press: the dip, down quickly, up gently, and the glow.
    const t = this.sinceAccepted;
    const dip = t < F.downSec ? easeOutCubic(t / F.downSec) : t < F.downSec + F.upSec ? 1 - easeInOutSine((t - F.downSec) / F.upSec) : 0;
    this.pad.position.y = dip > 0 ? -BELT_BUTTON.dip * dip : 0;
    const glow = t < F.glowRise ? t / F.glowRise : t < F.glowSec ? (1 - (t - F.glowRise) / (F.glowSec - F.glowRise)) ** 2 : 0;
    // A refused one: a short, muted flash over whatever it shows.
    const r = this.sinceRefused;
    const flash = r < F.refusedSec ? Math.sin((Math.PI * r) / F.refusedSec) : 0;
    this.stand = damp(this.stand, standing ? 1 : 0, F.standRate, dt);
    if (this.stand < 1e-3) this.stand = 0;
    this.material.emissiveIntensity = Math.max(F.glowPeak * glow, F.standGlow * this.stand) + F.refusedFlash * flash;
  }
}
