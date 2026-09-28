import { CircleGeometry, CylinderGeometry, TorusGeometry, type BufferGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Theme } from '../../themes/types';
import { PartList } from '../paint';

/**
 * The "toro": a compact, friendly forklift modelled facing +Z with its origin at the body collider
 * center on the floor. Split in rigid parts so the view can animate them independently:
 * chassis (tilts), carriage + forks (slides on the mast), wheels (spin / steer), eyes (blink).
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

export interface ForkliftGeometry {
  chassis: BufferGeometry;
  carriage: BufferGeometry;
  wheel: BufferGeometry;
  eyes: BufferGeometry;
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
    carriage: buildCarriage(theme, sizes.forkReach + sizes.boxSize * 0.38),
    wheel: buildWheel(theme, sizes.wheelRadius),
    eyes: buildEyes(theme),
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

/** Backplate + two tines reaching to `tineEnd` (local z). Local y = 0 is the fork top surface. */
function buildCarriage(theme: Theme, tineEnd: number): BufferGeometry {
  const c = theme.forklift;
  const p = new PartList();
  p.block(c.mast, -0.22, 0.22, -0.03, 0.2, 0.44, 0.472);
  for (const x of [-0.15, 0.15]) {
    p.block(c.fork, x - 0.038, x + 0.038, -0.03, 0, 0.47, tineEnd);
    p.block(c.fork, x - 0.038, x + 0.038, -0.03, 0.14, 0.472, 0.5);
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
