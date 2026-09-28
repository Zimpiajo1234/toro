import type { Vec2 } from '../core/types';

/**
 * How a screen-space direction becomes a floor direction (gameConfig `controls`):
 * - 'screen' → continuous, camera-relative: "up" drives straight up the screen.
 * - 'grid'   → each key drives along a floor axis: its screen direction turned 45° clockwise, recomputed from
 *              the current camera yaw. With the 45° diorama camera W runs along a row of tiles (screen up-right)
 *              instead of diagonally across them; two keys combine to the diagonal between their axes.
 * - 'vehicle' → relative to the forklift itself, whatever the camera: W / ↑ forward, S / ↓ reverse, A / ← turn
 *              left, D / → turn right. Produces `InputFrame.drive` (throttle / steer) instead of a floor direction.
 */
export type MoveMapping = 'grid' | 'screen' | 'vehicle';

export interface ControlMappings {
  /** Keyboard (WASD / arrows) and gamepad d-pad: digital input. */
  keyboard: MoveMapping;
  /** Gamepad left stick: analog input. */
  stick: MoveMapping;
}

/** Validates a mapping read from JSON; anything unknown falls back to `fallback`. */
export function parseMoveMapping(value: unknown, fallback: MoveMapping): MoveMapping {
  return value === 'grid' || value === 'screen' || value === 'vehicle' ? value : fallback;
}

/**
 * Maps screen-space input to a world-space move vector for the current camera yaw ψ
 * (the camera sits in direction (sin ψ, cos ψ) from the warehouse, see "World conventions"):
 *   forward = (-sin ψ, -cos ψ), right = (cos ψ, -sin ψ), move = right · moveX + forward · moveY.
 * The result is clamped to length 1 and written into `out` (no allocation).
 */
export function screenToWorld(moveX: number, moveY: number, yaw: number, out: Vec2): Vec2 {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  let x = c * moveX - s * moveY;
  let z = -s * moveX - c * moveY;
  const lenSq = x * x + z * z;
  if (lenSq > 1) {
    const inv = 1 / Math.sqrt(lenSq);
    x *= inv;
    z *= inv;
  }
  out.x = x;
  out.z = z;
  return out;
}

/** A grid direction this close to a world axis (relative to its length) is floating-point drift: snap it. */
const AXIS_SNAP_TOLERANCE = 1e-6;

/**
 * `screenToWorld` with a mapping. 'grid' first turns the screen vector 45° clockwise (up → up-right,
 * right → down-right), then snaps single-axis input (one key) exactly onto the world axis it lands on, so a
 * held key drives dead straight along the tiles. During an eased camera turn the direction follows the view
 * smoothly and lands on the axis when the turn settles.
 */
export function mapToWorld(moveX: number, moveY: number, yaw: number, mapping: MoveMapping, out: Vec2): Vec2 {
  if (mapping === 'vehicle') {
    // Vehicle input is not a floor direction: it goes through `inputToDrive` instead.
    out.x = 0;
    out.z = 0;
    return out;
  }
  if (mapping !== 'grid') return screenToWorld(moveX, moveY, yaw, out);
  screenToWorld((moveX + moveY) * Math.SQRT1_2, (moveY - moveX) * Math.SQRT1_2, yaw, out);
  if ((moveX === 0) !== (moveY === 0)) snapToWorldAxis(out);
  return out;
}

function snapToWorldAxis(v: Vec2): void {
  const ax = Math.abs(v.x);
  const az = Math.abs(v.z);
  const len = Math.sqrt(v.x * v.x + v.z * v.z);
  const tolerance = len * AXIS_SNAP_TOLERANCE;
  if (ax >= az) {
    if (az <= tolerance) {
      v.x = Math.sign(v.x) * len;
      v.z = 0;
    }
  } else if (ax <= tolerance) {
    v.z = Math.sign(v.z) * len;
    v.x = 0;
  }
}

/** Screen-space movement split by source, as sampled by Input. */
export interface MoveSources {
  /** Digital: keyboard + d-pad. */
  keyX: number;
  keyY: number;
  /** Analog: left stick. */
  stickX: number;
  stickY: number;
}

const stickWorld: Vec2 = { x: 0, z: 0 };

/**
 * World-space move for the simulation: digital and analog input each mapped with their own setting, summed,
 * and clamped to length 1 (the same result as before for 'screen' / 'screen'). Writes into `out`.
 */
export function inputToWorld(input: MoveSources, yaw: number, mappings: ControlMappings, out: Vec2): Vec2 {
  mapToWorld(input.keyX, input.keyY, yaw, mappings.keyboard, out);
  mapToWorld(input.stickX, input.stickY, yaw, mappings.stick, stickWorld);
  out.x += stickWorld.x;
  out.z += stickWorld.z;
  const lenSq = out.x * out.x + out.z * out.z;
  if (lenSq > 1) {
    const inv = 1 / Math.sqrt(lenSq);
    out.x *= inv;
    out.z *= inv;
  }
  return out;
}

/** Vehicle-relative control handed to the simulation (`InputFrame.drive`). */
export interface DriveInput {
  /** −1 … 1: forward (W / ↑ / stick up) or reverse. */
  throttle: number;
  /** −1 … 1: +1 turns left (A / ←), −1 turns right (D / →). */
  steer: number;
}

/**
 * Throttle / steer from every source whose mapping is 'vehicle' (camera-independent). Digital keys give full
 * throttle / steer even when pressed together (W + A = drive forward while turning left); the stick is analog.
 * Summed and clamped to −1 … 1. Writes into `out`.
 */
export function inputToDrive(input: MoveSources, mappings: ControlMappings, out: DriveInput): DriveInput {
  let throttle = 0;
  let steer = 0;
  if (mappings.keyboard === 'vehicle') {
    throttle += Math.sign(input.keyY);
    steer -= Math.sign(input.keyX);
  }
  if (mappings.stick === 'vehicle') {
    throttle += input.stickY;
    steer -= input.stickX;
  }
  out.throttle = Math.max(-1, Math.min(1, throttle));
  out.steer = Math.max(-1, Math.min(1, steer));
  return out;
}
