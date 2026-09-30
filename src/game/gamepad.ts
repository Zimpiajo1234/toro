import { applyRadialDeadzone, clampToUnit, type Axis2 } from './axes';

/** The subset of the DOM `Gamepad` we read (a real Gamepad is assignable to it). */
export interface GamepadLike {
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  /** `value` is the analog pull (0 … 1) of the triggers; digital buttons report 0 / 1, or leave it out. */
  readonly buttons: readonly { readonly pressed: boolean; readonly value?: number }[];
}

export type GamepadSource = () => ArrayLike<GamepadLike | null> | null | undefined;

/** Per-poll gamepad contribution, already combined across every connected pad. */
export interface GamepadFrame {
  /** Left stick (analog, radial deadzone), screen space: x right, y up. Length ≤ 1. */
  stickX: number;
  stickY: number;
  /** D-pad (digital, like the keyboard), screen space. Diagonals normalized. */
  dpadX: number;
  dpadY: number;
  actionPressed: boolean;
  rotateCamera: -1 | 0 | 1;
  confirmPressed: boolean;
  /** Edge: Back / View (mirrors the HUD ↺). */
  restartPressed: boolean;
  /** Back / View is held (hold-to-restart once there is work to lose). */
  restartHeld: boolean;
  /** Edge: Y. Game only honours it as "Repetir" on the completion card, never mid-play. */
  retryPressed: boolean;
  /** Edge: X = fork one slot up (+1), B = one slot down (−1), in front of a storage rack (docs/RACKS.md). */
  forkStep: -1 | 0 | 1;
  /**
   * Analog camera zoom, −1 … 1 (+ = closer): RT pulls in, LT pulls out, each past TRIGGER_DEADZONE and rescaled so a
   * light touch starts from 0. A rate, not a step: Input turns it into zoom stops per second.
   */
  zoom: number;
}

export const STICK_DEADZONE = 0.2;
/** A trigger resting slightly pulled (worn springs, noisy pads) must not creep the camera. */
export const TRIGGER_DEADZONE = 0.1;

// W3C "standard" mapping indices.
const BTN_A = 0;
const BTN_B = 1;
const BTN_X = 2;
const BTN_Y = 3;
const BTN_LB = 4;
const BTN_RB = 5;
const BTN_LT = 6;
const BTN_RT = 7;
const BTN_BACK = 8;
const BTN_START = 9;
const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;
/** Buttons with edge detection, in the order of the per-pad `prev` arrays. */
const EDGE_BUTTONS = [BTN_A, BTN_Y, BTN_LB, BTN_RB, BTN_BACK, BTN_START, BTN_X, BTN_B] as const;

function browserGamepads(): ArrayLike<GamepadLike | null> | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  return navigator.getGamepads();
}

function isPressed(pad: GamepadLike, index: number): boolean {
  const button = pad.buttons[index];
  return !!button && button.pressed;
}

/** Analog pull of a trigger past the dead zone, rescaled to 0 … 1 (a pad without `value` reads its pressed state). */
function triggerPull(pad: GamepadLike, index: number, deadzone: number): number {
  const button = pad.buttons[index];
  if (!button) return 0;
  const raw = typeof button.value === 'number' && Number.isFinite(button.value) ? button.value : button.pressed ? 1 : 0;
  const pull = Math.min(1, Math.abs(raw));
  return pull <= deadzone ? 0 : (pull - deadzone) / (1 - deadzone);
}

/**
 * Reads standard-mapping gamepads: left stick (radial deadzone) and d-pad reported separately (they may map to
 * the floor differently), A / Y / LB / RB / Back / Start / X / B as edges, LT / RT as the analog camera zoom.
 */
export class GamepadReader {
  private readonly source: GamepadSource;
  private readonly deadzone: number;
  /** Previous pressed state of EDGE_BUTTONS, per pad index. */
  private readonly prev = new Map<number, boolean[]>();
  private readonly padStick: Axis2 = { x: 0, y: 0 };
  private readonly stick: Axis2 = { x: 0, y: 0 };
  private readonly dpad: Axis2 = { x: 0, y: 0 };
  private readonly frame: GamepadFrame = {
    stickX: 0,
    stickY: 0,
    dpadX: 0,
    dpadY: 0,
    actionPressed: false,
    rotateCamera: 0,
    confirmPressed: false,
    restartPressed: false,
    restartHeld: false,
    retryPressed: false,
    forkStep: 0,
    zoom: 0,
  };

  constructor(source: GamepadSource = browserGamepads, deadzone = STICK_DEADZONE) {
    this.source = source;
    this.deadzone = deadzone;
  }

  /** Sample once per frame. The returned object is reused between calls. */
  read(): GamepadFrame {
    const f = this.frame;
    f.actionPressed = false;
    f.rotateCamera = 0;
    f.confirmPressed = false;
    f.restartPressed = false;
    f.restartHeld = false;
    f.retryPressed = false;
    f.forkStep = 0;
    f.zoom = 0;
    this.stick.x = this.stick.y = 0;
    this.dpad.x = this.dpad.y = 0;

    let pads: ArrayLike<GamepadLike | null> | null | undefined = null;
    try {
      pads = this.source();
    } catch {
      pads = null; // e.g. blocked by a permissions policy
    }
    if (pads) {
      for (let i = 0; i < pads.length; i++) {
        const pad = pads[i];
        if (pad && pad.connected && pad.mapping === 'standard') this.readPad(pad);
      }
    }

    clampToUnit(this.stick);
    clampToUnit(this.dpad);
    f.stickX = this.stick.x;
    f.stickY = this.stick.y;
    f.dpadX = this.dpad.x;
    f.dpadY = this.dpad.y;
    f.zoom = Math.max(-1, Math.min(1, f.zoom));
    return f;
  }

  private readPad(pad: GamepadLike): void {
    // Screen "up" is positive; the stick's Y axis points down.
    applyRadialDeadzone(pad.axes[0] ?? 0, -(pad.axes[1] ?? 0), this.deadzone, this.padStick);
    this.stick.x += this.padStick.x;
    this.stick.y += this.padStick.y;
    this.dpad.x += (isPressed(pad, DPAD_RIGHT) ? 1 : 0) - (isPressed(pad, DPAD_LEFT) ? 1 : 0);
    this.dpad.y += (isPressed(pad, DPAD_UP) ? 1 : 0) - (isPressed(pad, DPAD_DOWN) ? 1 : 0);
    if (isPressed(pad, BTN_BACK)) this.frame.restartHeld = true;
    this.frame.zoom += triggerPull(pad, BTN_RT, TRIGGER_DEADZONE) - triggerPull(pad, BTN_LT, TRIGGER_DEADZONE);

    let prev = this.prev.get(pad.index);
    if (!prev) {
      prev = EDGE_BUTTONS.map(() => false);
      this.prev.set(pad.index, prev);
    }
    for (let b = 0; b < EDGE_BUTTONS.length; b++) {
      const button = EDGE_BUTTONS[b];
      const down = isPressed(pad, button);
      if (down && !prev[b]) this.onPress(button);
      prev[b] = down;
    }
  }

  private onPress(button: number): void {
    const f = this.frame;
    if (button === BTN_A) f.actionPressed = true;
    else if (button === BTN_Y) f.retryPressed = true;
    else if (button === BTN_LB) f.rotateCamera = -1;
    else if (button === BTN_RB) f.rotateCamera = 1;
    else if (button === BTN_BACK) f.restartPressed = true;
    else if (button === BTN_START) f.confirmPressed = true;
    else if (button === BTN_X) f.forkStep = 1;
    else if (button === BTN_B) f.forkStep = -1;
  }
}
