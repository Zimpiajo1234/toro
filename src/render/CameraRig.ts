import { OrthographicCamera, Vector3 } from 'three';
import type { GameConfig } from '../config';
import { TAU, clamp, damp, degToRad, lerp } from '../core/math';
import { hermite, hermiteSlope } from './tween';

/** An axis-aligned volume the camera keeps in frame. `heightScale` shrinks max.y (walls sinking). */
export interface FitBox {
  min: Vector3;
  max: Vector3;
  heightScale: number;
}

/** Projected half extents and center of the fit boxes for one yaw (view-plane units). */
interface Fit {
  halfW: number;
  halfH: number;
  centerX: number;
  centerY: number;
}

const newFit = (): Fit => ({ halfW: 0, halfH: 0, centerX: 0, centerY: 0 });

function blendFits(a: Fit, b: Fit, t: number, out: Fit): Fit {
  out.halfW = lerp(a.halfW, b.halfW, t);
  out.halfH = lerp(a.halfH, b.halfH, t);
  return out;
}

const QUARTER = Math.PI / 2;
/** Idle orbit: one full turn every four minutes. */
const ORBIT_SPEED = TAU / 240;
const DISTANCE = 60;

/**
 * Orthographic diorama camera. Yaw ψ follows docs/ARCHITECTURE.md: the camera sits in horizontal
 * direction (sin ψ, cos ψ) from its target. Pitch is fixed. Every frame the frustum is fitted to the
 * FitBoxes for the current yaw and aspect, so the whole warehouse stays visible at any angle, without
 * breathing in and out while it turns (see place()).
 */
export class CameraRig {
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, DISTANCE * 2.5);

  private readonly pitch: number;
  private readonly padding: number;
  private readonly rotateDuration: number;
  private readonly canonicalYaw: number;

  /** Tweened yaw (Q/E rotation, settle after orbit). */
  private base: number;
  private tweenFrom = 0;
  private tweenTo = 0;
  private tweenSlope = 0;
  private tweenT = 1;
  private tweenDuration = 1;

  private orbitEnabled = false;
  private orbitVelocity = 0;
  private orbitOffset = 0;

  private aspect = 1;
  private fitBoxes: readonly FitBox[] = [];

  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly back = new Vector3();
  private readonly corner = new Vector3();
  private readonly target = new Vector3();
  /** Scratch fits (no per-frame allocations): live yaw, minimum framing, its two anchors. */
  private readonly liveFit: Fit = newFit();
  private readonly floorFit: Fit = newFit();
  private readonly fromFit: Fit = newFit();
  private readonly toFit: Fit = newFit();
  private readonly scratchFit: Fit = newFit();

  constructor(cameraConfig: GameConfig['camera']) {
    this.pitch = degToRad(cameraConfig.pitchDeg);
    this.padding = cameraConfig.padding;
    this.rotateDuration = Math.max(0.05, cameraConfig.rotateDurationSec);
    this.canonicalYaw = degToRad(cameraConfig.yawDeg);
    this.base = this.canonicalYaw;
    this.place();
  }

  /** Current animated yaw (radians). */
  get yaw(): number {
    return this.base + this.orbitOffset;
  }

  setAspect(width: number, height: number): void {
    if (width > 0 && height > 0) this.aspect = width / height;
  }

  setFitBoxes(boxes: readonly FitBox[]): void {
    this.fitBoxes = boxes;
  }

  /** Rotate by 90°. direction 1 = clockwise seen from above (yaw decreases), -1 = counter-clockwise. */
  rotate(direction: -1 | 1): void {
    const goal = (this.tweenT < 1 ? this.tweenTo : this.base) - direction * QUARTER;
    this.startTween(this.base, this.baseVelocity(), goal, this.rotateDuration);
  }

  setIdleOrbit(enabled: boolean): void {
    if (enabled === this.orbitEnabled) return;
    this.orbitEnabled = enabled;
    if (enabled) return;
    // Fold the drift into the tweened yaw and glide to the nearest canonical angle, keeping velocity.
    const current = this.yaw;
    const velocity = this.baseVelocity() + this.orbitVelocity;
    this.base = current;
    this.orbitOffset = 0;
    this.orbitVelocity = 0;
    const steps = Math.round((current + velocity * 0.4 - this.canonicalYaw) / QUARTER);
    this.startTween(current, velocity, this.canonicalYaw + steps * QUARTER, this.rotateDuration * 1.6);
  }

  update(dt: number): void {
    this.orbitVelocity = damp(this.orbitVelocity, this.orbitEnabled ? ORBIT_SPEED : 0, 0.8, dt);
    this.orbitOffset += this.orbitVelocity * dt;
    if (this.tweenT < 1) {
      this.tweenT = Math.min(1, this.tweenT + dt / this.tweenDuration);
      this.base = hermite(this.tweenFrom, this.tweenTo, this.tweenSlope, this.tweenT);
    } else if (Math.abs(this.base) > TAU * 4) {
      this.base %= TAU; // keep numbers small over very long sessions
    }
    if (Math.abs(this.orbitOffset) > TAU * 4) this.orbitOffset %= TAU;
    this.place();
  }

  private startTween(from: number, velocity: number, to: number, duration: number): void {
    this.tweenFrom = from;
    this.tweenTo = to;
    this.tweenDuration = duration;
    this.tweenSlope = velocity * duration;
    this.tweenT = 0;
  }

  private baseVelocity(): number {
    if (this.tweenT >= 1) return 0;
    return hermiteSlope(this.tweenFrom, this.tweenTo, this.tweenSlope, this.tweenT) / this.tweenDuration;
  }

  /**
   * Orient the camera for the current yaw and fit the frustum to the fit boxes.
   * A warehouse projects narrower near axis-aligned yaws than on the diagonals, so fitting at the live
   * yaw alone would zoom in and back out on every turn. Instead the frame never gets tighter than a
   * blend of the framings at the two anchor yaws around the current one (the tween's ends, or the
   * canonical diagonals while orbiting / at rest), while the live fit still guarantees containment.
   */
  private place(): void {
    const yaw = this.yaw;
    const live = this.measure(yaw, this.liveFit);
    const floor = this.floorFit;
    if (this.tweenT < 1) {
      const span = this.tweenTo - this.tweenFrom;
      const t = Math.abs(span) > 1e-9 ? clamp((yaw - this.tweenFrom) / span, 0, 1) : 1;
      blendFits(this.restFit(this.tweenFrom, this.fromFit), this.restFit(this.tweenTo, this.toFit), t, floor);
    } else {
      this.diagonalFit(yaw, floor);
    }

    let halfW = Math.max(live.halfW, floor.halfW) * this.padding;
    let halfH = Math.max(live.halfH, floor.halfH) * this.padding;
    if (halfW / halfH > this.aspect) halfH = halfW / this.aspect;
    else halfW = halfH * this.aspect;

    this.orient(yaw);
    const cam = this.camera;
    this.target.copy(this.right).multiplyScalar(live.centerX).addScaledVector(this.up, live.centerY);
    cam.position.copy(this.target).addScaledVector(this.back, DISTANCE);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    cam.left = -halfW;
    cam.right = halfW;
    cam.top = halfH;
    cam.bottom = -halfH;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }

  /** Framing a view at rest (or orbiting) would use at `yaw`: never tighter than its diagonal blend. */
  private restFit(yaw: number, out: Fit): Fit {
    const { halfW, halfH } = this.measure(yaw, out);
    this.diagonalFit(yaw, out);
    out.halfW = Math.max(out.halfW, halfW);
    out.halfH = Math.max(out.halfH, halfH);
    return out;
  }

  /** Linear blend (by angle) of the fits at the canonical yaws 45° + k·90° on either side of `yaw`. */
  private diagonalFit(yaw: number, out: Fit): Fit {
    const k = Math.floor((yaw - this.canonicalYaw) / QUARTER);
    const a = this.canonicalYaw + k * QUARTER;
    const t = clamp((yaw - a) / QUARTER, 0, 1);
    const { halfW, halfH } = this.measure(a, this.scratchFit);
    const next = this.measure(a + QUARTER, this.scratchFit);
    out.halfW = lerp(halfW, next.halfW, t);
    out.halfH = lerp(halfH, next.halfH, t);
    return out;
  }

  private orient(yaw: number): void {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    this.back.set(cp * sy, sp, cp * cy);
    this.right.set(cy, 0, -sy);
    this.up.set(-sp * sy, cp, -sp * cy);
  }

  /** Half extents (unpadded) and center of the fit boxes projected on the view plane at `yaw`. */
  private measure(yaw: number, out: Fit): Fit {
    this.orient(yaw);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let b = 0; b < this.fitBoxes.length; b++) {
      const box = this.fitBoxes[b];
      const top = Math.max(box.min.y, box.max.y * box.heightScale);
      for (let i = 0; i < 8; i++) {
        this.corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? top : box.min.y, i & 4 ? box.max.z : box.min.z);
        const x = this.corner.dot(this.right);
        const y = this.corner.dot(this.up);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (minX > maxX) {
      minX = minY = -5;
      maxX = maxY = 5;
    }
    out.halfW = (maxX - minX) / 2;
    out.halfH = (maxY - minY) / 2;
    out.centerX = (minX + maxX) / 2;
    out.centerY = (minY + maxY) / 2;
    return out;
  }
}
