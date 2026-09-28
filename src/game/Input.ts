import { clampToUnit, type Axis2 } from './axes';
import { blurTarget, classifyFocusTarget } from './focus';
import { GamepadReader, type GamepadSource } from './gamepad';
import { isMoveBinding, keyId, resolveKey, type KeyBinding, type MoveBinding } from './keyBindings';

/** Screen-space input sampled once per frame. */
export interface InputSample {
  /**
   * Digital direction (WASD / arrows + gamepad d-pad), -1 … 1: x right (D / →), y "up the screen" (W / ↑).
   * Diagonals are normalized. Mapped to the floor with `controls.keyboardMapping`.
   */
  keyX: number;
  keyY: number;
  /** Analog left stick after the deadzone, same axes, length ≤ 1. Mapped with `controls.stickMapping`. */
  stickX: number;
  stickY: number;
  /** Edge-triggered: pick up / drop (Space, gamepad A). */
  actionPressed: boolean;
  /** Edge-triggered camera rotation: Q = -1, E = +1 (gamepad shoulders). */
  rotateCamera: -1 | 0 | 1;
  /** Edge-triggered: R, gamepad Back. */
  restartPressed: boolean;
  /** R or gamepad Back is currently held (hold-to-restart). */
  restartHeld: boolean;
  /** Edge-triggered: gamepad Y ("Repetir" on the completion card only). */
  retryPressed: boolean;
  /** Edge-triggered: M. */
  mutePressed: boolean;
  /** Edge-triggered: T (show / hide the optional timer). */
  timerPressed: boolean;
  /** Edge-triggered: Enter, gamepad Start (continue on completion card). */
  confirmPressed: boolean;
  /** Edge-triggered: Escape (back to the title). */
  backPressed: boolean;
  /** True if any input happened this frame. */
  any: boolean;
}

export interface InputOptions {
  /**
   * Called synchronously inside keydown / pointerdown handlers, i.e. while the browser still counts it as a
   * user gesture (the rAF loop that reads `poll()` is not). Game uses it to unlock audio.
   */
  onGesture?: () => void;
  /** Gamepad source; defaults to `navigator.getGamepads`. */
  gamepads?: GamepadSource;
  /**
   * True while the player drives the forklift (the playing screen). Then Space always belongs to the game, even
   * on a focused button. Otherwise (title, completion card) Space / Enter on a focused button are never taken
   * from it. Defaults to never.
   */
  isGameplay?: () => boolean;
  /**
   * True while Space / Enter must not activate a focused button at all (the completion card's first moments,
   * so a press meant for the forklift cannot skip it). Defaults to never.
   */
  buttonKeysLocked?: () => boolean;
}

const DIRECTION: Record<MoveBinding, number> = { up: 0, down: 1, left: 2, right: 3 };
const never = () => false;

/** Space / Enter: the keys a focused button activates on. */
function isActivationKey(binding: KeyBinding): boolean {
  return binding === 'action' || binding === 'confirm';
}

/**
 * Keyboard (WASD + arrows, both at once) + gamepad (standard mapping).
 *
 * Focus rules: keys typed into text fields are never game keys. Space / Enter on a focused overlay button
 * belong to the button (native activation, no game action) — this is what makes the overlay's autofocused
 * primary buttons work. During gameplay (`isGameplay`) the game reclaims them, blurring the button: Space
 * always (it is the pick-up key, so a stray Tab or mouse focus on "Reiniciar" never restarts the level), Enter
 * once the player used any game key after that element got focus (so Enter still activates a Tab-focused HUD
 * button). Only the first press of a key may activate a button: repeats of a held key never do, and neither
 * does the release of a press the game took.
 */
export class Input {
  private readonly target: Window;
  private readonly onGesture: (() => void) | undefined;
  private readonly isGameplay: () => boolean;
  private readonly buttonKeysLocked: () => boolean;
  private readonly gamepad: GamepadReader;
  /** Held movement keys: key id → direction, so W and ↑ can overlap and release independently. */
  private readonly held = new Map<string, number>();
  /** Number of held keys per direction (up, down, left, right). */
  private readonly heldCount = [0, 0, 0, 0];
  /** Held restart keys (R by code or character). */
  private readonly restartKeys = new Set<string>();
  /** Space / Enter presses the game took (or swallowed): their keyup must not click a button focused since. */
  private readonly claimedKeys = new Set<string>();
  private actionEdge = false;
  private rotateEdge: -1 | 0 | 1 = 0;
  private restartEdge = false;
  private muteEdge = false;
  private timerEdge = false;
  private confirmEdge = false;
  private backEdge = false;
  /** A game key was pressed during gameplay since focus last moved: Enter goes back to the game too. */
  private drivenSinceFocus = false;
  private disposed = false;
  private readonly keys: Axis2 = { x: 0, y: 0 };
  private readonly sample: InputSample = {
    keyX: 0,
    keyY: 0,
    stickX: 0,
    stickY: 0,
    actionPressed: false,
    rotateCamera: 0,
    restartPressed: false,
    restartHeld: false,
    retryPressed: false,
    mutePressed: false,
    timerPressed: false,
    confirmPressed: false,
    backPressed: false,
    any: false,
  };

  constructor(target: Window = window, options: InputOptions = {}) {
    this.target = target;
    this.onGesture = options.onGesture;
    this.isGameplay = options.isGameplay ?? never;
    this.buttonKeysLocked = options.buttonKeysLocked ?? never;
    this.gamepad = new GamepadReader(options.gamepads);
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.releaseAll);
    target.addEventListener('pointerdown', this.onPointerDown, true);
    target.addEventListener('focusin', this.onFocusIn, true);
    target.document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /** Sample keyboard + gamepads and consume edge flags. The returned object is reused between calls. */
  poll(): InputSample {
    const s = this.sample;
    if (this.disposed) {
      s.keyX = s.keyY = s.stickX = s.stickY = 0;
      s.actionPressed = s.restartPressed = s.restartHeld = s.retryPressed = false;
      s.mutePressed = s.timerPressed = s.confirmPressed = s.backPressed = s.any = false;
      s.rotateCamera = 0;
      return s;
    }

    const c = this.heldCount;
    let kx = (c[DIRECTION.right] > 0 ? 1 : 0) - (c[DIRECTION.left] > 0 ? 1 : 0);
    let ky = (c[DIRECTION.up] > 0 ? 1 : 0) - (c[DIRECTION.down] > 0 ? 1 : 0);
    if (kx !== 0 && ky !== 0) {
      kx *= Math.SQRT1_2;
      ky *= Math.SQRT1_2;
    }
    const pad = this.gamepad.read();
    this.keys.x = kx + pad.dpadX;
    this.keys.y = ky + pad.dpadY;
    clampToUnit(this.keys);

    s.keyX = this.keys.x;
    s.keyY = this.keys.y;
    s.stickX = pad.stickX;
    s.stickY = pad.stickY;
    s.actionPressed = this.actionEdge || pad.actionPressed;
    s.rotateCamera = this.rotateEdge !== 0 ? this.rotateEdge : pad.rotateCamera;
    s.restartPressed = this.restartEdge || pad.restartPressed;
    s.restartHeld = this.restartKeys.size > 0 || pad.restartHeld;
    s.retryPressed = pad.retryPressed;
    s.mutePressed = this.muteEdge;
    s.timerPressed = this.timerEdge;
    s.confirmPressed = this.confirmEdge || pad.confirmPressed;
    s.backPressed = this.backEdge;
    s.any =
      s.keyX !== 0 ||
      s.keyY !== 0 ||
      s.stickX !== 0 ||
      s.stickY !== 0 ||
      s.actionPressed ||
      s.rotateCamera !== 0 ||
      s.restartPressed ||
      s.restartHeld ||
      s.retryPressed ||
      s.mutePressed ||
      s.timerPressed ||
      s.confirmPressed ||
      s.backPressed;
    this.clearEdges();
    return s;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.releaseAll);
    this.target.removeEventListener('pointerdown', this.onPointerDown, true);
    this.target.removeEventListener('focusin', this.onFocusIn, true);
    this.target.document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.releaseAll();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing) return;
    const focus = classifyFocusTarget(e.target);
    if (focus === 'text') return;
    if (!e.repeat) this.onGesture?.();
    // Leave browser / OS shortcuts alone (Ctrl+R, Cmd+M, Alt+←…).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const binding = resolveKey(e.code, e.key);
    if (binding === null) return;
    const id = keyId(e.code, e.key);
    const gameplay = this.isGameplay();

    if (isActivationKey(binding)) {
      if (focus === 'button') {
        // Only a first press may activate a button: a held Enter must not click whatever gets focus next.
        if (e.repeat || this.buttonKeysLocked()) {
          e.preventDefault();
          this.claimedKeys.add(id);
          return;
        }
        const reclaim = gameplay && (binding === 'action' || this.drivenSinceFocus);
        if (!reclaim) return; // native activation, no game action
        blurTarget(e.target);
      }
      this.claimedKeys.add(id);
    } else if (gameplay) {
      this.drivenSinceFocus = true;
    }
    e.preventDefault(); // arrows / Space must not scroll the page

    if (isMoveBinding(binding)) {
      // Repeats are accepted here: they re-sync a key held while the window gained focus.
      this.press(id, DIRECTION[binding]);
      return;
    }
    if (binding === 'restart') this.restartKeys.add(id); // held state, re-synced by repeats too
    if (e.repeat) return;
    switch (binding) {
      case 'action':
        this.actionEdge = true;
        break;
      case 'rotateLeft':
        this.rotateEdge = -1;
        break;
      case 'rotateRight':
        this.rotateEdge = 1;
        break;
      case 'restart':
        this.restartEdge = true;
        break;
      case 'mute':
        this.muteEdge = true;
        break;
      case 'timer':
        this.timerEdge = true;
        break;
      case 'confirm':
        this.confirmEdge = true;
        break;
      case 'back':
        this.backEdge = true;
        break;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    // macOS drops keyup events of keys released while ⌘ is held.
    if (e.key === 'Meta') {
      this.releaseAll();
      return;
    }
    const id = keyId(e.code, e.key);
    // Space activates buttons on keyup: a press the game took must not finish as a click on a button that got
    // focus in between (e.g. the completion card appearing while Space is held).
    if (this.claimedKeys.delete(id)) e.preventDefault();
    this.restartKeys.delete(id);
    const dir = this.held.get(id);
    if (dir === undefined) return;
    this.held.delete(id);
    this.heldCount[dir]--;
  };

  private readonly onPointerDown = (): void => {
    this.onGesture?.();
  };

  /** Any new focus (Tab, click, the overlay's autofocus) hands Space / Enter back to that element. */
  private readonly onFocusIn = (): void => {
    this.drivenSinceFocus = false;
  };

  private readonly onVisibilityChange = (): void => {
    if (this.target.document.visibilityState === 'hidden') this.releaseAll();
  };

  /** Forget every held key and pending edge (window blur, tab hidden, dispose). */
  private readonly releaseAll = (): void => {
    this.held.clear();
    this.heldCount.fill(0);
    this.restartKeys.clear();
    this.claimedKeys.clear();
    this.clearEdges();
  };

  private press(id: string, dir: number): void {
    if (this.held.has(id)) return;
    this.held.set(id, dir);
    this.heldCount[dir]++;
  }

  private clearEdges(): void {
    this.actionEdge = false;
    this.rotateEdge = 0;
    this.restartEdge = false;
    this.muteEdge = false;
    this.timerEdge = false;
    this.confirmEdge = false;
    this.backEdge = false;
  }
}
