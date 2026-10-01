import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  SRGBColorSpace,
  Sphere,
  Vector3,
  type ColorRepresentation,
  type Material,
  type MeshBasicMaterial,
  type MeshStandardMaterial,
} from 'three';
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
 * How a belt's button answers (H2b, H2c; docs/CONVEYOR.md «Ajustes»), safe to tune. While the forklift stands on its
 * pad (hint.button: the action presses it now) the pad brightens a little in its own colour (its emissive, up to
 * `standGlow`) and a faint halo of that light shows round it (`standHalo`: it reads round the forklift), both eased at
 * `standRate`. An accepted press sinks the pad softly into the floor, BELT_BUTTON.dip (down in `downSec`, back up in
 * `upSec`), and lights it brightly (H2c, «que se ilumine mucho más»): the pad's emissive up to `litGlow` and its halo on
 * the floor up to `litHalo`, in the belt's identity colour `haloLift` lighter (its HSL lightness, as seen: the same hue
 * and saturation, a light of that colour), up within `litRise` s and held while the belt runs back, then faded out over
 * `litFade` s once the box rests on the input (eased in and out, no flicker). A refused press only flashes them, muted
 * (`refusedFlash` / `refusedHalo` more, gone by `refusedSec`).
 */
export const BUTTON_FEEL = {
  downSec: 0.1,
  upSec: 0.3,
  litRise: 0.2,
  litFade: 0.9,
  litGlow: 1.3,
  litHalo: 0.95,
  haloLift: 0.12,
  standGlow: 0.24,
  standHalo: 0.3,
  standRate: 10,
  refusedFlash: 0.1,
  refusedHalo: 0.12,
  refusedSec: 0.3,
} as const;

const HSL = { h: 0, s: 0, l: 0 };

/** The tone of a belt button's light on the floor (its halo): its belt's identity colour BUTTON_FEEL.haloLift lighter. */
export function buttonLightTone(identity: ColorRepresentation): Color {
  const tone = new Color(identity);
  tone.getHSL(HSL, SRGBColorSpace);
  return tone.setHSL(HSL.h, HSL.s, Math.min(1, HSL.l + BUTTON_FEEL.haloLift), SRGBColorSpace);
}

/**
 * A belt's button on screen (H2b, H2c): its pad (a mesh of its own on the floor, its back arrow a child of it) and the
 * halo of its light on the floor round it (its own overlay, not a child of the pad: it never dips). The pad brightens,
 * with a faint halo, while the forklift stands on it; it dips on an accepted press and stays lit, pad and halo, while its
 * belt runs back, fading out once the box rests on the input; a refused press only flashes it, muted. It follows the
 * belt's press counts (ConveyorState.presses / accepted) and its direction (running back: −1): a level loaded or
 * restarted shows it at rest, nothing replays. Its materials are its own (the pad's emissive, the halo's opacity).
 */
export class BeltButton {
  private presses = Number.NaN;
  private accepted = Number.NaN;
  /** Seconds since the last accepted press and since the last refused one (Infinity: none playing). */
  private sinceAccepted = Infinity;
  private sinceRefused = Infinity;
  private stand = 0;
  /** 0‥1, how lit (its belt running back), moved at a steady rate: up in litRise s, down in litFade s. */
  private lit = 0;

  constructor(
    readonly pad: Mesh,
    private readonly material: MeshStandardMaterial,
    readonly halo: Mesh,
    private readonly haloMaterial: MeshBasicMaterial,
  ) {}

  /**
   * Every frame: its belt's press counts, whether the belt runs back now (from an accepted press until the box rests on
   * the input) and whether the forklift stands on it (the hint names it).
   */
  sync(presses: number, accepted: number, back: boolean, standing: boolean, dt: number): void {
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
    // An accepted press: the dip, down quickly, up gently.
    const t = this.sinceAccepted;
    const dip = t < F.downSec ? easeOutCubic(t / F.downSec) : t < F.downSec + F.upSec ? 1 - easeInOutSine((t - F.downSec) / F.upSec) : 0;
    this.pad.position.y = dip > 0 ? -BELT_BUTTON.dip * dip : 0;
    // Lit while its belt runs back: the same steady pace at any frame rate, shown eased in and out.
    this.lit = back ? Math.min(1, this.lit + dt / F.litRise) : Math.max(0, this.lit - dt / F.litFade);
    const lit = easeInOutSine(this.lit);
    // A refused one: a short, muted flash over whatever it shows.
    const r = this.sinceRefused;
    const flash = r < F.refusedSec ? Math.sin((Math.PI * r) / F.refusedSec) : 0;
    this.stand = damp(this.stand, standing ? 1 : 0, F.standRate, dt);
    if (this.stand < 1e-3) this.stand = 0;
    this.material.emissiveIntensity = Math.max(F.litGlow * lit, F.standGlow * this.stand) + F.refusedFlash * flash;
    this.haloMaterial.opacity = Math.min(1, Math.max(F.litHalo * lit, F.standHalo * this.stand) + F.refusedHalo * flash);
    this.halo.visible = this.haloMaterial.opacity > 0.01;
  }
}
