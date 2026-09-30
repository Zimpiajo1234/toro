import { OrthographicCamera, Vector3 } from 'three';
import type { GameConfig } from '../config';
import { TAU, clamp, damp, degToRad, lerp } from '../core/math';
import { hermite, hermiteSlope } from './tween';

/**
 * An axis-aligned volume the camera keeps in frame, whole and static: nothing animated reaches the fit. A back wall is
 * framed at full height even while it is sunk (the camera behind it): it then stands on the camera's side of the room,
 * where its top never reaches the edge of the frame, so the framing at rest is the same and never moves as it sinks
 * or rises.
 */
export interface FitBox {
  readonly min: Vector3;
  readonly max: Vector3;
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

  /** Move the value by `delta` along with its target: the offset and velocity between them stay as they were. */
  shift(delta: number): void {
    this.value += delta;
  }

  /**
   * Land exactly on `target` once within `epsilon` of it and moving less than that in a tenth of a second (an exact
   * rest, not an endless tail).
   */
  settle(target: number, epsilon: number): void {
    if (Math.abs(this.value - target) < epsilon && Math.abs(this.velocity) * 0.1 < epsilon) this.snap(target);
  }
}

/**
 * A value gliding to a goal on a cubic ease-in-out over a set time: a gentle start and an exact stop (no tail).
 * Retargeted mid-way it keeps its velocity. Asked again for the goal it already has, it changes nothing.
 */
class Glide {
  value = 0;
  private from = 0;
  private goal = 0;
  /** hermite()'s start slope (per whole glide): the velocity kept from a glide retargeted mid-way. */
  private slope = 0;
  private t = 1;
  private duration = 1;

  glideTo(goal: number, duration: number): void {
    if (goal === this.goal) return;
    const velocity = this.t < 1 ? hermiteSlope(this.from, this.goal, this.slope, this.t) / this.duration : 0;
    this.from = this.value;
    this.goal = goal;
    this.duration = duration;
    this.slope = velocity * duration;
    this.t = 0;
  }

  snap(goal: number): void {
    if (goal === this.goal) return;
    this.value = this.from = this.goal = goal;
    this.slope = 0;
    this.t = 1;
  }

  step(dt: number): void {
    if (this.t >= 1 || !(dt > 0)) return;
    this.t = Math.min(1, this.t + dt / this.duration);
    this.value = hermite(this.from, this.goal, this.slope, this.t);
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
/**
 * Leaving the idle orbit (a level starting from the title), the camera glides to the nearest canonical yaw over this
 * many Q/E turn durations (1.44 s), and the overlay bands that arrive with the level glide in over the same time: one
 * calm motion that ends exactly. Title → play (both bands at once, 1280×800) peaks at ≈ 0.5 % zoom per frame.
 */
const ORBIT_GLIDE = 1.6;
const DISTANCE = 60;
/** Overlays never reserve more than this share of the canvas height (or width): they squeeze the level, never hide it. */
const MAX_RESERVED = 0.5;
const band = (px: number): number => (Number.isFinite(px) && px > 0 ? px : 0);

/** A critically damped spring gets ≈ 95 % of the way through a step in ω·t ≈ 4.74 ((1 + ωt)·e^(−ωt) = 0.05). */
const SETTLE_95 = 4.74;
const omegaFor = (sec: number): number => SETTLE_95 / Math.max(0.05, Number.isFinite(sec) ? sec : 1);
/**
 * The eased zoom (log2) lands exactly on its goal within this (0.007 %, far below a pixel): zooming fully out is exactly
 * the full view again.
 */
const ZOOM_REST = 1e-4;
/**
 * Tracked zoom pours in on a first-order ease, ≈ 95 % of it within `camera.zoomTrackSec` (e^−3 ≈ 5 %): a held rate
 * then trails by rate × zoomTrackSec / 3 (≈ 0.05 stops at the default 1 stop / s and 0.15 s), which is all the view
 * moves on once the input stops.
 */
const trackTauFor = (sec: number): number => Math.max(0.01, Number.isFinite(sec) ? sec : 0.15) / 3;
/** Height of the followed point: the forklift's body, not the floor under its wheels. */
export const FOLLOW_HEIGHT = 0.5;
/**
 * The eased followed point lands exactly on the forklift within this (0.1 mm, far below a pixel) once it has stopped:
 * a zoomed view at rest stays exactly still.
 */
const FOLLOW_REST = 1e-4;
/**
 * The zoomed framing glides to a stop at the level's edge over this last share of the visible half extent (a smooth
 * brake, C¹, never past the edge) instead of stopping dead there.
 */
const EDGE_SOFTNESS = 0.2;

/**
 * `offset` limited to ±`bound`: unchanged up to `soft` short of it, then easing in exponentially (slope 1 at the knee,
 * so no kink) and never reaching past it.
 */
function softClamp(offset: number, bound: number, soft: number): number {
  if (!(bound > 0)) return 0;
  const k = Math.min(bound, soft);
  const knee = bound - k;
  const a = Math.abs(offset);
  if (a <= knee) return offset;
  const out = k > 0 ? bound - k * Math.exp((knee - a) / k) : bound;
  return offset < 0 ? -out : out;
}

/**
 * Orthographic diorama camera. Yaw ψ follows docs/ARCHITECTURE.md: the camera sits in horizontal
 * direction (sin ψ, cos ψ) from its target. Pitch is fixed. Every frame the frustum is fitted to the
 * FitBoxes for the current yaw and aspect, so the whole warehouse stays visible at any angle, without
 * breathing in and out while it turns (see place()). The fit uses the canvas minus the overlay bands (setInsets):
 * the frustum still covers the whole canvas, off-center so the level sits in the free area.
 *
 * The camera never reframes on its own: the framing is a pure function of the yaw (Q/E turns, the title's orbit and
 * its glide into a level), the canvas size, the overlay bands (taken when a level starts and on a resize) and the
 * player zoom with its followed point. The fit boxes are static, so nothing animated in the scene (walls sinking,
 * forks rising, a truck) ever moves it, and every ease lands exactly: at rest the camera is bit-identical frame to frame.
 *
 * Player zoom (zoomBy / zoomTrack / resetZoom) is a factor on top of that fit: 1 = the full view (exactly the fit
 * above, and the floor: never further out), up to `camera.zoomMax`. A step (zoomBy: a key tap, a wheel notch) eases on
 * a critically damped spring (`zoomEaseSec`; a return to the full view on the slower `zoomResetSec`), so it never
 * overshoots a goal; a step against one still easing in starts from what is on screen. Zoom that follows the input as
 * it moves (zoomTrack: held keys, triggers, pinches) moves the view and that goal together over `zoomTrackSec`, so the
 * view stops when the input does instead of catching up with a goal that ran ahead. As it grows, the framing target blends
 * from the level's center to the followed point (the forklift, eased by `zoomFollowSec`), clamped so the visible free
 * area stays over the (padded) level at rest, and inside what the full view shows mid-turn. Q/E turns pivot around that
 * target; the idle orbit is always unzoomed.
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
  /** The tween under way is the glide out of the idle orbit (a level starting from the title). */
  private orbitGlide = false;

  private aspect = 1;
  /** Canvas size in CSS px (0 until known), the unit of the insets. */
  private width = 0;
  private height = 0;
  private fitBoxes: readonly FitBox[] = [];
  /** Overlay bands the frame keeps clear (CSS px): taken at once, or gliding in with the title's orbit (setInsets). */
  private readonly insetTop = new Glide();
  private readonly insetRight = new Glide();
  private readonly insetBottom = new Glide();
  private readonly insetLeft = new Glide();

  /** Player zoom, in log2 "stops" (0 = the full view): the goal asked for and the eased value shown. */
  private readonly zoomMax: number;
  private readonly zoomMaxLog: number;
  private readonly zoomOmega: number;
  /** Slower ease of a return to the full view (a reset, the title), so a long way out stays as calm as a tap. */
  private readonly zoomResetOmega: number;
  private zoomResetting = false;
  private zoomGoal = 0;
  private readonly zoomLog = new Spring();
  /** Tracked zoom (zoomTrack) not in the view yet, in stops, and the time constant it pours in with (s). */
  private zoomPending = 0;
  private readonly zoomTrackTau: number;
  /** The followed point on the floor (world x, z): asked for, and eased. */
  private readonly followOmega: number;
  private followGoalX = 0;
  private followGoalZ = 0;
  private hasFollow = false;
  private readonly followX = new Spring();
  private readonly followZ = new Spring();

  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly back = new Vector3();
  private readonly corner = new Vector3();
  private readonly target = new Vector3();
  private readonly followPoint = new Vector3();
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
    this.zoomMax = Number.isFinite(cameraConfig.zoomMax) ? Math.max(1, cameraConfig.zoomMax) : 1;
    this.zoomMaxLog = Math.log2(this.zoomMax);
    this.zoomOmega = omegaFor(cameraConfig.zoomEaseSec);
    this.zoomResetOmega = omegaFor(cameraConfig.zoomResetSec);
    this.zoomTrackTau = trackTauFor(cameraConfig.zoomTrackSec);
    this.followOmega = omegaFor(cameraConfig.zoomFollowSec);
    this.place();
  }

  /** Current animated yaw (radians). */
  get yaw(): number {
    return this.base + this.orbitOffset;
  }

  /** Current (eased) player zoom: 1 = the full view, up to `camera.zoomMax`. */
  get zoom(): number {
    return Math.pow(2, clamp(this.zoomLog.value, 0, this.zoomMaxLog));
  }

  /** The zoom the eased one is heading to (tracked zoom not poured in yet included). */
  get zoomTarget(): number {
    return Math.pow(2, clamp(this.zoomGoal + this.zoomPending, 0, this.zoomMaxLog));
  }

  /**
   * Zoom by a step of `deltaLog2` stops (+ = closer, 1 = twice as close; a key tap, a wheel notch), kept within
   * 1 … `camera.zoomMax`. The view eases there. A step against an ease still under way (a − tap while a + one is
   * easing in) starts from what is on screen, so it never ends up the other way. Ignored during the idle orbit (the
   * title stays unzoomed).
   */
  zoomBy(deltaLog2: number): void {
    if (this.orbitEnabled || !Number.isFinite(deltaLog2) || deltaLog2 === 0) return;
    // Against the ease under way (its goal on the other side of what is on screen): drop the rest of it.
    const shown = this.zoomLog.value;
    if ((this.zoomGoal - shown) * deltaLog2 < 0) this.zoomGoal = clamp(shown, 0, this.zoomMaxLog);
    this.zoomGoal = clamp(this.zoomGoal + deltaLog2, 0, this.zoomMaxLog);
    this.zoomResetting = false;
  }

  /**
   * Zoom by `deltaLog2` stops that follow the input as it moves (held + / −, the triggers' rate × dt, a pinch): the view
   * and its goal take it together over `camera.zoomTrackSec`, so the view stops (≈ 0.05 stops after a held key) when
   * the input does. Same range and idle-orbit rule as zoomBy.
   */
  zoomTrack(deltaLog2: number): void {
    if (this.orbitEnabled || !Number.isFinite(deltaLog2) || deltaLog2 === 0) return;
    this.zoomPending = clamp(this.zoomPending + deltaLog2, -this.zoomMaxLog, this.zoomMaxLog);
  }

  /**
   * Back to the full view: eased (on the slower `camera.zoomResetSec`), or at once with `immediate` (nothing zoomed on
   * screen to ease from).
   */
  resetZoom(immediate = false): void {
    this.zoomGoal = 0;
    this.zoomPending = 0;
    this.zoomResetting = true;
    if (immediate) this.zoomLog.snap(0);
  }

  /** Land the eased zoom on its goal at once (a cut, such as a freshly built level): no ease left to play. */
  settleZoom(): void {
    this.zoomGoal = clamp(this.zoomGoal + this.zoomPending, 0, this.zoomMaxLog);
    this.zoomPending = 0;
    this.zoomLog.snap(this.zoomGoal);
  }

  /**
   * The point on the floor (world x, z) a zoomed-in view follows: the forklift. Call every frame; the view glides after
   * it (`camera.zoomFollowSec`), or jumps right there with `immediate` (and on the first call).
   */
  setFollow(x: number, z: number, immediate = false): void {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    this.followGoalX = x;
    this.followGoalZ = z;
    if (immediate || !this.hasFollow) {
      this.followX.snap(x);
      this.followZ.snap(z);
    }
    this.hasFollow = true;
  }

  /** Canvas size in CSS px. */
  setAspect(width: number, height: number): void {
    if (!(width > 0 && height > 0)) return;
    this.aspect = width / height;
    this.width = width;
    this.height = height;
  }

  /**
   * Overlay bands to keep the level clear of (CSS px from each canvas edge), as the overlay reports them: when a level
   * starts, on a resize and for the title (ui/reservedAreas.ts), never on its own mid-level. With the title's idle
   * orbit, or while the camera glides out of it into a level, the frame glides to them with that motion; anywhere else
   * (a new level, a resize) it takes them at once, and so it does with `immediate`. The bands already in force, asked
   * for again, change nothing.
   */
  setInsets(insets: ViewInsets, immediate = false): void {
    const glide = !immediate && (this.orbitEnabled || this.orbitGlide);
    this.takeInset(this.insetTop, insets.top, glide);
    this.takeInset(this.insetRight, insets.right, glide);
    this.takeInset(this.insetBottom, insets.bottom, glide);
    this.takeInset(this.insetLeft, insets.left, glide);
  }

  setFitBoxes(boxes: readonly FitBox[]): void {
    this.fitBoxes = boxes;
  }

  /** Rotate by 90°. direction 1 = clockwise seen from above (yaw decreases), -1 = counter-clockwise. */
  rotate(direction: -1 | 1): void {
    const goal = (this.tweenT < 1 ? this.tweenTo : this.base) - direction * QUARTER;
    this.orbitGlide = false; // a turn of the player's own now
    this.startTween(this.base, this.baseVelocity(), goal, this.rotateDuration);
  }

  setIdleOrbit(enabled: boolean): void {
    if (enabled === this.orbitEnabled) return;
    this.orbitEnabled = enabled;
    if (enabled) {
      this.orbitGlide = false;
      this.resetZoom(); // the title's orbit is always the whole diorama: ease back out
      return;
    }
    // Fold the drift into the tweened yaw and glide to the nearest canonical angle, keeping velocity.
    const current = this.yaw;
    const velocity = this.baseVelocity() + this.orbitVelocity;
    this.base = current;
    this.orbitOffset = 0;
    this.orbitVelocity = 0;
    const steps = Math.round((current + velocity * 0.4 - this.canonicalYaw) / QUARTER);
    this.orbitGlide = true;
    this.startTween(current, velocity, this.canonicalYaw + steps * QUARTER, this.rotateDuration * ORBIT_GLIDE);
  }

  update(dt: number): void {
    this.orbitVelocity = damp(this.orbitVelocity, this.orbitEnabled ? ORBIT_SPEED : 0, 0.8, dt);
    this.orbitOffset += this.orbitVelocity * dt;
    if (this.tweenT < 1) {
      this.tweenT = Math.min(1, this.tweenT + dt / this.tweenDuration);
      this.base = hermite(this.tweenFrom, this.tweenTo, this.tweenSlope, this.tweenT);
      if (this.tweenT >= 1) this.orbitGlide = false;
    }
    if (Math.abs(this.orbitOffset) > TAU * 4) this.orbitOffset %= TAU; // only while orbiting (0 otherwise)
    this.insetTop.step(dt);
    this.insetRight.step(dt);
    this.insetBottom.step(dt);
    this.insetLeft.step(dt);
    this.pourZoom(dt);
    this.zoomLog.step(this.zoomGoal, this.zoomResetting ? this.zoomResetOmega : this.zoomOmega, dt);
    this.zoomLog.settle(this.zoomGoal, ZOOM_REST);
    this.followX.step(this.followGoalX, this.followOmega, dt);
    this.followZ.step(this.followGoalZ, this.followOmega, dt);
    this.followX.settle(this.followGoalX, FOLLOW_REST);
    this.followZ.settle(this.followGoalZ, FOLLOW_REST);
    this.place();
  }

  /**
   * Pour this frame's share of the tracked zoom into the view and its goal together: a step still easing in keeps its
   * offset, and ends where it would have plus what was poured (the shown zoom stays clamped to the range meanwhile).
   * What a limit stops is dropped, so holding on at zoomMax (or 1) stores nothing for later.
   */
  private pourZoom(dt: number): void {
    const pending = this.zoomPending;
    if (pending === 0 || !(dt > 0)) return;
    const pour = Math.abs(pending) < ZOOM_REST ? pending : -pending * Math.expm1(-dt / this.zoomTrackTau);
    this.zoomPending -= pour;
    const asked = this.zoomGoal + pour;
    const goal = clamp(asked, 0, this.zoomMaxLog);
    if (goal !== asked) this.zoomPending = 0;
    const moved = goal - this.zoomGoal;
    if (moved === 0) return;
    this.zoomGoal = goal;
    this.zoomLog.shift(moved);
    this.zoomResetting = false;
  }

  private takeInset(inset: Glide, px: number, glide: boolean): void {
    if (glide) inset.glideTo(band(px), this.rotateDuration * ORBIT_GLIDE);
    else inset.snap(band(px));
  }

  private startTween(from: number, velocity: number, to: number, duration: number): void {
    // Keep numbers small over very long sessions: whole turns come off every angle at once, here as the camera starts to
    // move anyway (never at rest, where the rounding would still show in the last bits of the matrices).
    const turns = Math.abs(from) > TAU * 4 ? Math.round(from / TAU) * TAU : 0;
    this.base -= turns;
    this.tweenFrom = from - turns;
    this.tweenTo = to - turns;
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
   * off-center, so the level's center lands on the free area's center. The player zoom then narrows that free area and
   * moves its center toward the followed point (see the class comment); at zoom 1 none of that runs.
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

    // Each band's share of the canvas.
    const w = this.width;
    const h = this.height;
    let t = h > 0 ? band(this.insetTop.value) / h : 0;
    let b = h > 0 ? band(this.insetBottom.value) / h : 0;
    let l = w > 0 ? band(this.insetLeft.value) / w : 0;
    let r = w > 0 ? band(this.insetRight.value) / w : 0;
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
    const freeW = 1 - l - r;
    const freeH = 1 - t - b;
    const aspect = (this.aspect * freeW) / freeH;
    const levelW = Math.max(live.halfW, floor.halfW) * this.padding;
    const levelH = Math.max(live.halfH, floor.halfH) * this.padding;
    let halfW = levelW;
    let halfH = levelH;
    if (halfW / halfH > aspect) halfH = halfW / aspect;
    else halfW = halfH * aspect;

    this.orient(yaw);
    let centerX = live.centerX;
    let centerY = live.centerY;
    const zoom = this.zoom;
    if (zoom > 1) {
      // The free area shrinks by the zoom; its center blends toward the followed point, kept where the free area
      // stays over the padded level (on an axis where the level is the smaller, it stays centred). The level's extent
      // is the one framed at zoom 1: the live one at rest; mid-turn the smooth anchor blend, never narrower, so the
      // view does not sway as the live extent pinches at the square-on yaw (it never shows more than zoom 1 would).
      halfW /= zoom;
      halfH /= zoom;
      const blend = this.followBlend(zoom);
      const p = this.followPoint.set(this.followX.value, FOLLOW_HEIGHT, this.followZ.value);
      const dx = blend * (p.dot(this.right) - centerX);
      const dy = blend * (p.dot(this.up) - centerY);
      centerX += softClamp(dx, levelW - halfW, halfW * EDGE_SOFTNESS);
      centerY += softClamp(dy, levelH - halfH, halfH * EDGE_SOFTNESS);
    }
    // Half extents of the whole canvas at that scale.
    halfW /= freeW;
    halfH /= freeH;

    const cam = this.camera;
    this.target.copy(this.right).multiplyScalar(centerX).addScaledVector(this.up, centerY);
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

  /**
   * How far the framing target has moved from the level's center to the followed point at `zoom`: 0 at the full
   * view, 1 at zoomMax, smoothstepped over the share of the view already zoomed away (1 − 1/zoom).
   */
  private followBlend(zoom: number): number {
    if (!(this.zoomMax > 1)) return 0;
    const u = clamp((1 - 1 / zoom) / (1 - 1 / this.zoomMax), 0, 1);
    return u * u * (3 - 2 * u);
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
      for (let i = 0; i < 8; i++) {
        this.corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
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
