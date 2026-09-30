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

/**
 * Screen bands covered by overlay pieces that stay over the scene (HUD pills, control hint), in CSS px from each
 * canvas edge — the unit of setAspect(). The fit frames the level in the rest of the canvas.
 */
export interface ViewInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** A critically damped spring, stepped exactly for any dt: it starts and settles gently and never overshoots from rest. */
class Spring {
  value = 0;
  private velocity = 0;

  step(target: number, omega: number, dt: number): void {
    if (dt <= 0) return;
    const offset = this.value - target;
    const decay = Math.exp(-omega * dt);
    const k = (this.velocity + omega * offset) * dt;
    this.velocity = (this.velocity - omega * k) * decay;
    this.value = target + (offset + k) * decay;
  }

  snap(target: number): void {
    this.value = target;
    this.velocity = 0;
  }
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
 * Overlay bands ease in and out (a new hint row, the HUD arriving, a resize) on a critically damped spring: ≈ 95 %
 * there in 0.95 s, about as long as the hint takes to fade in. Title → play (both bands at once, 1280×800) peaks at
 * ≈ 0.7 % zoom per frame.
 */
const INSET_OMEGA = 5;
/** Overlays never reserve more than this share of the canvas height (or width): they squeeze the level, never hide it. */
const MAX_RESERVED = 0.5;
const band = (px: number): number => (Number.isFinite(px) && px > 0 ? px : 0);

/**
 * Orthographic diorama camera. Yaw ψ follows docs/ARCHITECTURE.md: the camera sits in horizontal
 * direction (sin ψ, cos ψ) from its target. Pitch is fixed. Every frame the frustum is fitted to the
 * FitBoxes for the current yaw and aspect, so the whole warehouse stays visible at any angle, without
 * breathing in and out while it turns (see place()). The fit uses the canvas minus the overlay bands (setInsets):
 * the frustum still covers the whole canvas, off-center so the level sits in the free area.
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
  /** Canvas size in CSS px (0 until known), the unit of the insets. */
  private width = 0;
  private height = 0;
  private fitBoxes: readonly FitBox[] = [];
  /** Overlay bands asked for (px), and the eased share of the canvas each one takes. */
  private readonly insets: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private readonly insetTop = new Spring();
  private readonly insetRight = new Spring();
  private readonly insetBottom = new Spring();
  private readonly insetLeft = new Spring();

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

  /** Canvas size in CSS px. */
  setAspect(width: number, height: number): void {
    if (!(width > 0 && height > 0)) return;
    this.aspect = width / height;
    this.width = width;
    this.height = height;
  }

  /**
   * Overlay bands to keep the level clear of (CSS px from each canvas edge). The frame eases to them (no zoom jumps),
   * or jumps right there with `immediate` (nothing framed on screen yet). Call on change, not every frame.
   */
  setInsets(insets: ViewInsets, immediate = false): void {
    const own = this.insets;
    own.top = band(insets.top);
    own.right = band(insets.right);
    own.bottom = band(insets.bottom);
    own.left = band(insets.left);
    if (immediate) this.stepInsets(0, true);
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
    this.stepInsets(dt, false);
    this.place();
  }

  /** Ease each overlay band's share of the canvas toward the one asked for (or `snap` there). Allocation-free. */
  private stepInsets(dt: number, snap: boolean): void {
    const { top, right, bottom, left } = this.insets;
    const w = this.width;
    const h = this.height;
    let t = h > 0 ? top / h : 0;
    let b = h > 0 ? bottom / h : 0;
    let l = w > 0 ? left / w : 0;
    let r = w > 0 ? right / w : 0;
    const vertical = t + b;
    if (vertical > MAX_RESERVED) {
      t *= MAX_RESERVED / vertical;
      b *= MAX_RESERVED / vertical;
    }
    const horizontal = l + r;
    if (horizontal > MAX_RESERVED) {
      l *= MAX_RESERVED / horizontal;
      r *= MAX_RESERVED / horizontal;
    }
    if (snap) {
      this.insetTop.snap(t);
      this.insetRight.snap(r);
      this.insetBottom.snap(b);
      this.insetLeft.snap(l);
      return;
    }
    this.insetTop.step(t, INSET_OMEGA, dt);
    this.insetRight.step(r, INSET_OMEGA, dt);
    this.insetBottom.step(b, INSET_OMEGA, dt);
    this.insetLeft.step(l, INSET_OMEGA, dt);
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
   * All of it frames the free area (the canvas minus the overlay bands): the frustum then widens to the whole canvas,
   * off-center, so the level's center lands on the free area's center.
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

    const t = this.insetTop.value;
    const r = this.insetRight.value;
    const b = this.insetBottom.value;
    const l = this.insetLeft.value;
    const freeW = 1 - l - r;
    const freeH = 1 - t - b;
    const aspect = (this.aspect * freeW) / freeH;
    let halfW = Math.max(live.halfW, floor.halfW) * this.padding;
    let halfH = Math.max(live.halfH, floor.halfH) * this.padding;
    if (halfW / halfH > aspect) halfH = halfW / aspect;
    else halfW = halfH * aspect;
    // Half extents of the whole canvas at that scale.
    halfW /= freeW;
    halfH /= freeH;

    this.orient(yaw);
    const cam = this.camera;
    this.target.copy(this.right).multiplyScalar(live.centerX).addScaledVector(this.up, live.centerY);
    cam.position.copy(this.target).addScaledVector(this.back, DISTANCE);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    cam.left = -halfW * (1 + l - r);
    cam.right = halfW * (1 - l + r);
    cam.top = halfH * (1 + t - b);
    cam.bottom = -halfH * (1 - t + b);
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
