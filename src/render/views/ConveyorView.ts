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
 * How a belt's button answers (H2, docs/CONVEYOR.md «Ajustes»), safe to tune: every press dips its cap BELT_BUTTON.dip
 * (down in `downSec`, back up in `upSec`); an accepted one also lights it in its own colour (its emissive, up to
 * `glowPeak` within `glowRise` s, faded out by `glowSec`). While the action would press it (hint.button) it glows
 * faintly (`aimGlow`, eased at `aimRate`), as a box under the forks does.
 */
export const BUTTON_FEEL = { downSec: 0.08, upSec: 0.24, glowRise: 0.06, glowSec: 0.75, glowPeak: 0.55, aimGlow: 0.14, aimRate: 10 } as const;

/**
 * A belt's button on screen (H2): its cap (a mesh of its own, standing on its post) dips on every press of the button
 * and glows briefly on an accepted one, following the belt's press counts (ConveyorState.presses / accepted): a level
 * loaded or restarted shows it at rest, nothing replays. Its material is its own (its emissive, the cap's colour).
 */
export class BeltButton {
  private presses = Number.NaN;
  private accepted = Number.NaN;
  /** Seconds since the last press and since the last accepted one (Infinity: none playing). */
  private sincePress = Infinity;
  private sinceAccepted = Infinity;
  private aim = 0;

  constructor(
    readonly cap: Mesh,
    private readonly material: MeshStandardMaterial,
    /** World y of the cap at rest: the top of its post. */
    private readonly restY: number,
  ) {}

  /** Every frame: its belt's press counts, whether the action presses it now (the hint aims at it). */
  sync(presses: number, accepted: number, aimed: boolean, dt: number): void {
    if (Number.isNaN(this.presses)) {
      this.presses = presses;
      this.accepted = accepted;
    }
    if (presses !== this.presses) {
      this.presses = presses;
      this.sincePress = 0;
    } else this.sincePress += dt;
    if (accepted !== this.accepted) {
      this.accepted = accepted;
      this.sinceAccepted = 0;
    } else this.sinceAccepted += dt;
    const F = BUTTON_FEEL;
    // The dip: down quickly, up gently.
    const t = this.sincePress;
    const dip = t < F.downSec ? easeOutCubic(t / F.downSec) : t < F.downSec + F.upSec ? 1 - easeInOutSine((t - F.downSec) / F.upSec) : 0;
    this.cap.position.y = this.restY - BELT_BUTTON.dip * dip;
    // The glow of an accepted press, over the faint one while aimed at.
    const g = this.sinceAccepted;
    const glow = g < F.glowRise ? g / F.glowRise : g < F.glowSec ? (1 - (g - F.glowRise) / (F.glowSec - F.glowRise)) ** 2 : 0;
    this.aim = damp(this.aim, aimed ? 1 : 0, F.aimRate, dt);
    if (this.aim < 1e-3) this.aim = 0;
    this.material.emissiveIntensity = Math.max(F.glowPeak * glow, F.aimGlow * this.aim);
  }
}
