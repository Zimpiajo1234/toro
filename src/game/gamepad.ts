import { applyRadialDeadzone, clampToUnit, type Axis2 } from './axes';

/** The subset of the DOM `Gamepad` we read (a real Gamepad is assignable to it). */
export interface GamepadLike {
  readonly index: number;
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
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
}

export const STICK_DEADZONE = 0.2;

// W3C "standard" mapping indices.
const BTN_A = 0;
const BTN_Y = 3;
const BTN_LB = 4;
const BTN_RB = 5;
const BTN_BACK = 8;
const BTN_START = 9;
const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;
/** Buttons with edge detection, in the order of the per-pad `prev` arrays. */
const EDGE_BUTTONS = [BTN_A, BTN_Y, BTN_LB, BTN_RB, BTN_BACK, BTN_START] as const;

function browserGamepads(): ArrayLike<GamepadLike | null> | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  return navigator.getGamepads();
}

function isPressed(pad: GamepadLike, index: number): boolean {
  const button = pad.buttons[index];
  return !!button && button.pressed;
}

/**
 * Reads standard-mapping gamepads: left stick (radial deadzone) and d-pad reported separately (they may map to
 * the floor differently), A / Y / LB / RB / Back / Start as edges.
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
  }
}
