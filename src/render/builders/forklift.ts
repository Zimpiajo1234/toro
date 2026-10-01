import { BufferAttribute, BufferGeometry, CircleGeometry, Color, CylinderGeometry, SphereGeometry, TorusGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TAU, clamp } from '../../core/math';
import { TINES } from '../../core/types';
import type { Theme } from '../../themes/types';
import { PartList } from '../paint';

/**
 * The "toro": a compact, friendly forklift modelled facing +Z with its origin at the body collider
 * center on the floor. Split in rigid parts so the view can animate them independently:
 * chassis (tilts), carriage + forks (slides on the mast), wheels (spin / steer), eyes (blink), and the
 * reverse beacon's light (fades in and out, its beams turn).
 */
export const FORKLIFT_LAYOUT = {
  trackHalf: 0.28,
  frontAxleZ: 0.23,
  rearAxleZ: -0.25,
  wheelWidth: 0.11,
  mastZ: 0.4,
  eyeX: 0.26,
  eyeY: 0.78,
  eyeZ: 0.297,
  /** Maximum visual steer angle of the rear wheels (radians). */
  maxSteer: 0.38,
} as const;

/**
 * The reverse beacon (views/ForkliftView lights it while backing up): a slate base on the rear edge of the roof with a
 * small amber glass dome on it (part of the chassis). Its light is three pieces of its own: a lit shell over the glass,
 * two soft beams on opposite sides of it that turn round its axis, and a feathered glow on the floor behind the
 * forklift. Every value is safe to tune.
 */
export const BEACON = {
  /** Centre of the base along the rig: on the roof's flat top (it ends at z −0.325; the roof top is y 1.025). */
  z: -0.265,
  roofTop: 1.025,
  baseRadius: 0.056,
  baseHeight: 0.022,
  /** The glass: a short round wall, then a dome on it. */
  lensRadius: 0.047,
  lensWall: 0.034,
  /** The lit shell sits this far outside the glass (never z-fighting it). */
  lampGap: 0.004,
  /**
   * Each beam, level with the dome's base: from the lit shell out to `beamReach` (the roof is 0.58 wide), `beamRoot` wide
   * on each side of its axis at the lamp (it leaves the whole glass) and `beamTip` at its end.
   */
  beamReach: 0.6,
  beamRoot: 0.04,
  beamTip: 0.19,
  /** The floor glow: a feathered ellipse centred this far behind the body centre (the counterweight ends at ≈ −0.48). */
  glowZ: -0.64,
  glowHalfX: 0.5,
  glowHalfZ: 0.4,
  /** Its height: over the zone pads (0.02) and the dock plate (0.026), like the drop preview. */
  glowY: 0.028,
} as const;

/** Height of the beacon's light (the base of its dome): the lamp shell's and the beams' origin, chassis-local. */
export const BEACON_LIGHT_Y = BEACON.roofTop + BEACON.baseHeight + BEACON.lensWall;

export interface ForkliftGeometry {
  chassis: BufferGeometry;
  carriage: BufferGeometry;
  /** Telescoping inner mast stage: only shown while the forks reach up to a stack. */
  innerMast: BufferGeometry;
  wheel: BufferGeometry;
  eyes: BufferGeometry;
  /** The reverse beacon's lit shell over its glass (origin: the light, BEACON_LIGHT_Y over BEACON.z). */
  beaconLamp: BufferGeometry;
  /** Its two opposite beams, flat and facing up (origin: the light; +z and −z at rest). */
  beaconBeam: BufferGeometry;
  /** The glow on the floor behind the forklift, facing up (origin: its centre). */
  beaconGlow: BufferGeometry;
}

export interface ForkliftSizes {
  wheelRadius: number;
  /** Distance from the body center to the carried box center (config.forklift.forkReach). */
  forkReach: number;
  /** Carried box footprint (config.box.size). */
  boxSize: number;
}

export function buildForkliftGeometry(theme: Theme, sizes: ForkliftSizes): ForkliftGeometry {
  return {
    chassis: buildChassis(theme),
    carriage: buildCarriage(theme, sizes.forkReach + sizes.boxSize * TINES.tip),
    innerMast: buildInnerMast(theme),
    wheel: buildWheel(theme, sizes.wheelRadius),
    eyes: buildEyes(theme),
    beaconLamp: buildBeaconLamp(theme),
    beaconBeam: buildBeaconBeam(theme),
    beaconGlow: buildBeaconGlow(theme),
  };
}

function rounded(w: number, h: number, d: number, r: number): BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, 1, r);
}

function buildChassis(theme: Theme): BufferGeometry {
  const c = theme.forklift;
  const L = FORKLIFT_LAYOUT;
  const p = new PartList();

  // Undercarriage keeps the body visually grounded between the wheels.
  p.add(rounded(0.44, 0.09, 0.66, 0.03), c.wheel, { y: 0.1, z: -0.02 });
  // Body, rounded counterweight and a low hood.
  p.add(rounded(0.52, 0.27, 0.74, 0.07), c.body, { y: 0.235, z: -0.02 });
  p.add(rounded(0.57, 0.32, 0.21, 0.085), c.accent, { y: 0.27, z: -0.37 });
  p.add(rounded(0.46, 0.1, 0.17, 0.04), c.body, { y: 0.4, z: 0.25 });

  // Seat and tilted backrest.
  p.add(rounded(0.3, 0.07, 0.25, 0.03), c.seat, { y: 0.405, z: -0.1 });
  p.add(rounded(0.3, 0.25, 0.07, 0.03), c.seat, { y: 0.54, z: -0.235, rx: -0.16 });

  // Steering column + wheel.
  p.add(new CylinderGeometry(0.018, 0.018, 0.2, 6), c.mast, { y: 0.52, z: 0.16, rx: -0.55 });
  p.add(new TorusGeometry(0.066, 0.015, 4, 12), c.wheel, { y: 0.61, z: 0.11, rx: Math.PI / 2 - 0.55 });

  // Overhead guard: four slim posts and a soft roof.
  const post = (x: number, z: number, y0: number, y1: number) =>
    p.add(new CylinderGeometry(0.022, 0.022, y1 - y0, 6), c.accent, { x, y: (y0 + y1) / 2, z });
  for (const x of [-0.23, 0.23]) {
    post(x, 0.24, 0.36, 0.99);
    post(x, -0.3, 0.42, 0.99);
  }
  p.add(rounded(0.58, 0.05, 0.64, 0.025), c.body, { y: 1.0, z: -0.03 });

  // Reverse beacon on the roof's rear edge: slate base, amber glass (its light is buildBeacon*).
  const B = BEACON;
  const r = B.lensRadius;
  p.add(new CylinderGeometry(B.baseRadius - 0.004, B.baseRadius, B.baseHeight, 10), c.mast, { y: B.roofTop + B.baseHeight / 2, z: B.z });
  p.add(new CylinderGeometry(r, r, B.lensWall, 10, 1, true), c.beacon, { y: BEACON_LIGHT_Y - B.lensWall / 2, z: B.z });
  p.add(new SphereGeometry(r, 10, 3, 0, TAU, 0, Math.PI / 2), c.beacon, { y: BEACON_LIGHT_Y, z: B.z });

  // Mast: two rails and crossbars.
  for (const x of [-0.17, 0.17]) p.block(c.mast, x - 0.025, x + 0.025, 0.06, 1.07, L.mastZ - 0.03, L.mastZ + 0.03);
  p.block(c.mast, -0.2, 0.2, 1.02, 1.07, L.mastZ - 0.028, L.mastZ + 0.028);
  p.block(c.mast, -0.2, 0.2, 0.08, 0.13, L.mastZ - 0.028, L.mastZ + 0.028);

  // Headlight housings, clamped onto the front posts (the lamps live in the unlit "eyes" mesh).
  for (const x of [-L.eyeX, L.eyeX]) {
    p.add(new CylinderGeometry(0.064, 0.064, 0.05, 12), c.accent, { x, y: L.eyeY, z: L.eyeZ - 0.027, rx: Math.PI / 2 });
  }
  return p.build();
}

/** Inner mast stage (two slim rails + top bar) just in front of the outer rails, same footprint in y at rest. */
function buildInnerMast(theme: Theme): BufferGeometry {
  const c = theme.forklift;
  const z = FORKLIFT_LAYOUT.mastZ + 0.045;
  const p = new PartList();
  for (const x of [-0.13, 0.13]) p.block(c.mast, x - 0.02, x + 0.02, 0.12, 1.02, z - 0.015, z + 0.015);
  p.block(c.mast, -0.15, 0.15, 0.98, 1.02, z - 0.015, z + 0.015);
  return p.build();
}

/**
 * Backplate + two tines reaching to `tineEnd` (local z), where core/types TINES puts them (the logic's empty tines meet
 * a belt's table there). Local y = 0 is the fork top surface.
 */
function buildCarriage(theme: Theme, tineEnd: number): BufferGeometry {
  const c = theme.forklift;
  const p = new PartList();
  const half = TINES.width / 2;
  p.block(c.mast, -0.22, 0.22, -0.03, 0.2, 0.44, 0.472);
  for (const x of [-TINES.spread, TINES.spread]) {
    p.block(c.fork, x - half, x + half, -0.03, 0, 0.47, tineEnd);
    p.block(c.fork, x - half, x + half, -0.03, 0.14, 0.472, 0.5);
  }
  return p.build();
}

/** Low-segment tire with a pentagonal hub, axis along X, centered on the axle. */
function buildWheel(theme: Theme, radius: number): BufferGeometry {
  const c = theme.forklift;
  const w = FORKLIFT_LAYOUT.wheelWidth;
  const p = new PartList();
  p.add(new CylinderGeometry(radius, radius, w, 10), c.wheel, { rz: Math.PI / 2 });
  p.add(new CylinderGeometry(radius * 0.5, radius * 0.5, w + 0.008, 5), c.hub, { rz: Math.PI / 2 });
  return p.build();
}

/** Round headlight "eyes" with small pupils. Local origin at eye height, so scale.y blinks in place. */
function buildEyes(theme: Theme): BufferGeometry {
  const c = theme.forklift;
  const L = FORKLIFT_LAYOUT;
  const p = new PartList();
  for (const x of [-L.eyeX, L.eyeX]) {
    p.add(new CircleGeometry(0.05, 14), c.light, { x, z: L.eyeZ });
    p.add(new CircleGeometry(0.021, 10), c.wheel, { x: x * 0.97, y: -0.004, z: L.eyeZ + 0.002 });
  }
  return p.build();
}

/** The beacon lit: a shell just outside its glass (wall + dome), solid `beaconLight` (RGBA). Origin at the light. */
function buildBeaconLamp(theme: Theme): BufferGeometry {
  const B = BEACON;
  const r = B.lensRadius + B.lampGap;
  const p = new PartList(true);
  p.add(new CylinderGeometry(r, r, B.lensWall, 10, 1, true), theme.forklift.beaconLight, { y: -B.lensWall / 2 });
  p.add(new SphereGeometry(r, 10, 3, 0, TAU, 0, Math.PI / 2), theme.forklift.beaconLight);
  return p.build();
}

/** Radial and cross-beam stops of each beam (0 = at the lamp / on its axis, 1 = its tip / its edge). */
const BEAM_ALONG = [0, 0.18, 0.5, 1] as const;
const BEAM_ACROSS = [-1, -0.5, 0, 0.5, 1] as const;
/** Rings of the floor glow (0 = its centre, 1 = its rim) and its segments round. */
const GLOW_RINGS = [0.4, 0.75, 1] as const;
const GLOW_SEGMENTS = 20;

/**
 * Two soft beams on opposite sides of the lamp (+z and −z), flat in its plane and facing up: from the lit shell out to
 * `beamReach`, widening from `beamRoot` to `beamTip`, `beaconLight` with an alpha that fades toward the tip and toward
 * both edges (the view sets the peak with its material's opacity).
 */
function buildBeaconBeam(theme: Theme): BufferGeometry {
  const B = BEACON;
  const r0 = B.lensRadius + B.lampGap;
  const out = new FeatheredMesh(theme.forklift.beaconLight);
  for (const side of [1, -1]) {
    const at = (v: number, u: number) => {
      const along = r0 + (B.beamReach - r0) * v;
      const across = u * (B.beamRoot + (B.beamTip - B.beamRoot) * v);
      out.vertex(side * across, side * along, (1 - v * v) * (1 - u * u));
    };
    for (let i = 0; i + 1 < BEAM_ALONG.length; i++) {
      for (let j = 0; j + 1 < BEAM_ACROSS.length; j++) {
        const v0 = BEAM_ALONG[i], v1 = BEAM_ALONG[i + 1], u0 = BEAM_ACROSS[j], u1 = BEAM_ACROSS[j + 1];
        at(v0, u0); at(v1, u0); at(v1, u1);
        at(v0, u0); at(v1, u1); at(v0, u1);
      }
    }
  }
  return out.build();
}

/**
 * A feathered ellipse of `beaconLight` on the floor (half axes glowHalfX × glowHalfZ), facing up: alpha 1 at its centre
 * easing to 0 at its rim (the view sets the peak with its material's opacity).
 */
function buildBeaconGlow(theme: Theme): BufferGeometry {
  const B = BEACON;
  const out = new FeatheredMesh(theme.forklift.beaconLight);
  const at = (s: number, k: number) => {
    const a = (k / GLOW_SEGMENTS) * TAU;
    out.vertex(s * B.glowHalfX * Math.sin(a), s * B.glowHalfZ * Math.cos(a), Math.pow(1 - s * s, 1.5));
  };
  for (let k = 0; k < GLOW_SEGMENTS; k++) {
    at(0, k); at(GLOW_RINGS[0], k); at(GLOW_RINGS[0], k + 1);
    for (let i = 0; i + 1 < GLOW_RINGS.length; i++) {
      const s0 = GLOW_RINGS[i], s1 = GLOW_RINGS[i + 1];
      at(s0, k); at(s1, k); at(s1, k + 1);
      at(s0, k); at(s1, k + 1); at(s0, k + 1);
    }
  }
  return out.build();
}

/**
 * Flat triangles in the XZ plane (y = 0) with one colour and a per-vertex alpha (RGBA): the beams and the floor glow.
 * Vertices come in triangles, counter-clockwise seen from above (facing up, for front-face-only materials).
 */
class FeatheredMesh {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly color: Color;

  constructor(color: string) {
    this.color = new Color(color);
  }

  vertex(x: number, z: number, alpha: number): void {
    this.positions.push(x, 0, z);
    this.colors.push(this.color.r, this.color.g, this.color.b, clamp(alpha, 0, 1));
  }

  build(): BufferGeometry {
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geo.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 4));
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
}
