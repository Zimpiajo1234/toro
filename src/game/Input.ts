import { GAME_CONFIG } from '../config';
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
  /** Edge-triggered: N (show / hide the optional move counter). */
  movesPressed: boolean;
  /** Edge-triggered: B (turn the reverse beeper on / off). */
  beepPressed: boolean;
  /** Edge-triggered: P (turn the optional target hints on / off). */
  hintsPressed: boolean;
  /** Edge-triggered: Enter, gamepad Start (continue on completion card). */
  confirmPressed: boolean;
  /** Edge-triggered: Escape (back to the title). */
  backPressed: boolean;
  /** Edge-triggered level jump for "Modo prueba": [ / PageUp = -1, ] / PageDown = +1. */
  levelStep: -1 | 0 | 1;
  /** Level-jump key currently held (the latest pressed wins), same signs as `levelStep` (hold-to-jump). */
  levelStepHeld: -1 | 0 | 1;
  /** Edge-triggered: U (toggle "Modo prueba" on the title). */
  testModePressed: boolean;
  /**
   * One slot level up (+1: F, mouse wheel up, gamepad X) or down (−1: V, wheel down, gamepad B) this frame. Several
   * presses in one frame come out one per frame. Only acts in front of a storage rack (docs/RACKS.md).
   */
  forkStep: -1 | 0 | 1;
  /**
   * Camera zoom that follows the input as it moves, this frame, in stops (log2 of the scale change): + = closer, +1 =
   * twice as close. Held + / − and the gamepad triggers (RT in, LT out) give a rate, ZOOM_KEY_RATE stops per second ×
   * poll's `dt`; pinches (trackpad Ctrl + wheel, two fingers on `touchSurface`, Safari's gesture events) arrive as they
   * happened since the last poll. Game hands it to the renderer's zoomTrack while playing (the view stops with it).
   */
  zoom: number;
  /**
   * Camera zoom steps this frame, same units: a + / − tap (ZOOM_TAP_STOPS on the key press; holding on then adds to
   * `zoom`) and a Ctrl + mouse wheel notch. Game hands it to the renderer's zoomBy while playing (eased in).
   */
  zoomStep: number;
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
  /**
   * The element under the scene (the canvas host): two fingers on it while playing pinch the camera zoom, and the page's
   * own pinch-zoom is prevented there (its `touch-action` while playing, and the touch events), unless the page is
   * still pinch-zoomed (then pinches stay the browser's, to bring it back). One-finger pans are left alone. Without it
   * there is no touch pinch.
   */
  touchSurface?: EventTarget;
}

const DIRECTION: Record<MoveBinding, number> = { up: 0, down: 1, left: 2, right: 3 };
const never = () => false;

/** Mouse wheel → fork levels. A single event this large (px) is one notch of a mouse wheel: one slot, never more. */
export const WHEEL_NOTCH_PX = 50;
/** Smaller deltas (trackpads, smooth scrolling) add up: one slot per this many px in one direction. */
export const WHEEL_TRACKPAD_PX = 120;
/** A pause this long (ms) between wheel events forgets a partial trackpad sum. */
export const WHEEL_IDLE_MS = 200;
/** WheelEvent.deltaMode line / page units in px. */
const WHEEL_LINE_PX = 40;
const WHEEL_PAGE_PX = 800;
/** Fork steps queued at most (a column has 3 slots: two steps reach any of them). */
const MAX_FORK_STEPS = 2;
/**
 * Held + / − (or a trigger fully pulled): zoom stops per second, calm (default 1: the whole ~1.3-stop range in about
 * 1.3 s). Tunable as `camera.zoomRate`.
 */
export const ZOOM_KEY_RATE = GAME_CONFIG.camera.zoomRate;
/** One tap of + / −, or one Ctrl + mouse wheel notch: a small step (default 0.25 stops ≈ ×1.19; `camera.zoomStep`). */
export const ZOOM_TAP_STOPS = GAME_CONFIG.camera.zoomStep;
/**
 * Ctrl + wheel px (a trackpad pinch) per zoom stop: Chromium's pinch convention (scale = e^(−deltaY / 100)), so the
 * view follows the fingers.
 */
export const PINCH_WHEEL_PX_PER_STOP = 100 * Math.LN2;
/** Zoom stops handed out in one frame at most (a burst of pinch events; the camera clamps its own range anyway). */
const MAX_ZOOM_STOPS = 2;
/** Two fingers closer than this (px) give no reliable ratio. */
const PINCH_MIN_SPAN_PX = 8;
/** `touchSurface`'s touch-action while playing: one-finger pans stay, the browser's pinch / double-tap zoom do not. */
const PLAYING_TOUCH_ACTION = 'pan-x pan-y';
/**
 * The page itself counts as pinch-zoomed past this `visualViewport.scale` (a pinch over the title or the card zooms
 * the visual viewport, which Ctrl + 0 does not undo): until it is back, pinches while playing stay the browser's.
 */
const PAGE_ZOOMED_SCALE = 1.01;
/** Touch events the pinch listens to on `touchSurface`. */
const TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;
/** Safari's non-standard trackpad / touch pinch events (`scale` = the span ratio since gesturestart). */
const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;

function levelStepOf(binding: KeyBinding): -1 | 0 | 1 {
  return binding === 'prevLevel' ? -1 : binding === 'nextLevel' ? 1 : 0;
}

function zoomOf(binding: KeyBinding): -1 | 0 | 1 {
  return binding === 'zoomIn' ? 1 : binding === 'zoomOut' ? -1 : 0;
}

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
  private readonly touchSurface: EventTarget | undefined;
  private readonly gamepad: GamepadReader;
  /** Held movement keys: key id → direction, so W and ↑ can overlap and release independently. */
  private readonly held = new Map<string, number>();
  /** Number of held keys per direction (up, down, left, right). */
  private readonly heldCount = [0, 0, 0, 0];
  /** Held restart keys (R by code or character). */
  private readonly restartKeys = new Set<string>();
  /** Held level-jump keys: key id → step, in press order. */
  private readonly levelStepKeys = new Map<string, -1 | 1>();
  /** Held zoom keys: key id → direction (+1 closer). */
  private readonly zoomKeys = new Map<string, -1 | 1>();
  /** Space / Enter presses the game took (or swallowed): their keyup must not click a button focused since. */
  private readonly claimedKeys = new Set<string>();
  private actionEdge = false;
  private rotateEdge: -1 | 0 | 1 = 0;
  private restartEdge = false;
  private muteEdge = false;
  private timerEdge = false;
  private movesEdge = false;
  private beepEdge = false;
  private hintsEdge = false;
  private confirmEdge = false;
  private backEdge = false;
  private levelStepEdge: -1 | 0 | 1 = 0;
  private testModeEdge = false;
  /** Fork level steps not handed out yet (keys and wheel), signed; poll() gives one per frame. */
  private forkSteps = 0;
  /** Trackpad-style wheel deltas summed toward one step (px, signed), and when the last wheel event came (ms). */
  private wheelSum = 0;
  private wheelAt = -Infinity;
  /** Zoom stops not handed out yet, signed: steps (key taps, wheel notches) and pinches; poll() gives them all. */
  private zoomSteps = 0;
  private zoomPinched = 0;
  /** When the last Ctrl + wheel pinch came (ms): Safari gesture events that close would be the same pinch twice. */
  private pinchWheelAt = -Infinity;
  /** Touches down on `touchSurface`, as its last touch event listed them. */
  private touchesDown = 0;
  /** The two fingers of a touch pinch and their last span (px); a span of 0 = no pinch baseline yet. */
  private pinchA = -1;
  private pinchB = -1;
  private pinchSpan = 0;
  /** Safari gesture `scale` last seen, 0 = no gesture going on. */
  private gestureScale = 0;
  /** `touchSurface` carries PLAYING_TOUCH_ACTION (set while playing and the page is not pinch-zoomed, synced by poll()). */
  private touchActionSet = false;
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
    movesPressed: false,
    beepPressed: false,
    hintsPressed: false,
    confirmPressed: false,
    backPressed: false,
    levelStep: 0,
    levelStepHeld: 0,
    testModePressed: false,
    forkStep: 0,
    zoom: 0,
    zoomStep: 0,
    any: false,
  };

  constructor(target: Window = window, options: InputOptions = {}) {
    this.target = target;
    this.onGesture = options.onGesture;
    this.isGameplay = options.isGameplay ?? never;
    this.buttonKeysLocked = options.buttonKeysLocked ?? never;
    this.touchSurface = options.touchSurface;
    this.gamepad = new GamepadReader(options.gamepads);
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.releaseAll);
    target.addEventListener('pointerdown', this.onPointerDown, true);
    target.addEventListener('focusin', this.onFocusIn, true);
    // Not passive: while playing, the wheel belongs to the forks (the page must not scroll).
    target.addEventListener('wheel', this.onWheel, { passive: false });
    for (const type of GESTURE_EVENTS) target.addEventListener(type, this.onGestureEvent);
    // Not passive either: while playing, two fingers on the scene pinch the camera, not the page.
    for (const type of TOUCH_EVENTS) this.touchSurface?.addEventListener(type, this.onTouch as EventListener, { passive: false });
    target.document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  /**
   * Sample keyboard + gamepads and consume edge flags. `dt` (s, the frame about to be simulated) turns held zoom rates
   * into this frame's `zoom`. The returned object is reused between calls.
   */
  poll(dt = 0): InputSample {
    const s = this.sample;
    if (this.disposed) {
      s.keyX = s.keyY = s.stickX = s.stickY = s.zoom = s.zoomStep = 0;
      s.actionPressed = s.restartPressed = s.restartHeld = s.retryPressed = false;
      s.mutePressed = s.timerPressed = s.movesPressed = s.confirmPressed = s.backPressed = s.any = false;
      s.beepPressed = s.hintsPressed = s.testModePressed = false;
      s.rotateCamera = 0;
      s.levelStep = s.levelStepHeld = 0;
      s.forkStep = 0;
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
    s.movesPressed = this.movesEdge;
    s.beepPressed = this.beepEdge;
    s.hintsPressed = this.hintsEdge;
    s.confirmPressed = this.confirmEdge || pad.confirmPressed;
    s.backPressed = this.backEdge;
    s.levelStep = this.levelStepEdge;
    s.levelStepHeld = this.heldLevelStep();
    s.testModePressed = this.testModeEdge;
    if (this.forkSteps !== 0) {
      s.forkStep = this.forkSteps > 0 ? 1 : -1;
      this.forkSteps -= s.forkStep;
    } else {
      s.forkStep = pad.forkStep;
    }
    this.syncTouchAction();
    const zoomRate = Math.max(-1, Math.min(1, this.heldZoom() + pad.zoom));
    const seconds = Number.isFinite(dt) && dt > 0 ? dt : 0;
    const zoom = this.zoomPinched + zoomRate * ZOOM_KEY_RATE * seconds;
    s.zoom = Math.max(-MAX_ZOOM_STOPS, Math.min(MAX_ZOOM_STOPS, zoom));
    s.zoomStep = this.zoomSteps;
    this.zoomPinched = this.zoomSteps = 0;
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
      s.movesPressed ||
      s.beepPressed ||
      s.hintsPressed ||
      s.confirmPressed ||
      s.backPressed ||
      s.levelStep !== 0 ||
      s.levelStepHeld !== 0 ||
      s.testModePressed ||
      s.forkStep !== 0 ||
      s.zoom !== 0 ||
      s.zoomStep !== 0;
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
    this.target.removeEventListener('wheel', this.onWheel);
    for (const type of GESTURE_EVENTS) this.target.removeEventListener(type, this.onGestureEvent);
    for (const type of TOUCH_EVENTS) this.touchSurface?.removeEventListener(type, this.onTouch as EventListener);
    this.target.document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.setTouchAction(false);
    this.releaseAll();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing) return;
    const focus = classifyFocusTarget(e.target);
    if (focus === 'text') return;
    if (!e.repeat) this.onGesture?.();
    const binding = resolveKey(e.code, e.key);
    // Leave browser / OS shortcuts alone (Ctrl+R, Cmd+M, Alt+←…). AltGr (Ctrl+Alt on Windows) is what types [ / ]
    // on Spanish, German and most ISO layouts, so the level-jump keys alone still accept it.
    const altGrStep = binding !== null && levelStepOf(binding) !== 0 && e.getModifierState?.('AltGraph') === true;
    if ((e.ctrlKey || e.metaKey || e.altKey) && !altGrStep) return;
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
    const step = levelStepOf(binding);
    if (step !== 0) this.levelStepKeys.set(id, step); // held state (hold-to-jump), re-synced by repeats too
    const zoom = zoomOf(binding);
    if (zoom !== 0) this.zoomKeys.set(id, zoom); // held state (continuous zoom), re-synced by repeats too
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
      case 'moves':
        this.movesEdge = true;
        break;
      case 'beep':
        this.beepEdge = true;
        break;
      case 'hints':
        this.hintsEdge = true;
        break;
      case 'confirm':
        this.confirmEdge = true;
        break;
      case 'back':
        this.backEdge = true;
        break;
      case 'prevLevel':
        this.levelStepEdge = -1;
        break;
      case 'nextLevel':
        this.levelStepEdge = 1;
        break;
      case 'testMode':
        this.testModeEdge = true;
        break;
      case 'forkUp':
        this.queueForkStep(1);
        break;
      case 'forkDown':
        this.queueForkStep(-1);
        break;
      case 'zoomIn':
        this.addZoom(ZOOM_TAP_STOPS, true); // the tap's step; holding on zooms at ZOOM_KEY_RATE
        break;
      case 'zoomOut':
        this.addZoom(-ZOOM_TAP_STOPS, true);
        break;
    }
  };

  /**
   * Mouse wheel → fork levels while playing (docs/RACKS.md): one notch of a mouse wheel = one slot (up = +1), however
   * large its delta; smaller trackpad deltas add up to one slot per WHEEL_TRACKPAD_PX. Ctrl + wheel while playing is
   * the camera zoom instead: a trackpad pinch (browsers send it as Ctrl + wheel) follows the fingers, a Ctrl + mouse
   * wheel notch is one tap step. Off the playing screen, over a text field or with ⌘ the wheel is left alone (the
   * browser's own zoom), and so is Ctrl + wheel while the page is still pinch-zoomed (the pinch that brings it back).
   */
  private readonly onWheel = (e: WheelEvent): void => {
    if (e.defaultPrevented || e.metaKey || !this.isGameplay()) return;
    if (classifyFocusTarget(e.target) === 'text') return;
    if (e.ctrlKey && this.pageZoomed()) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
    const delta = (Number.isFinite(e.deltaY) ? e.deltaY : 0) * unit;
    if (delta === 0) return;
    const now = Number.isFinite(e.timeStamp) ? e.timeStamp : 0;
    if (e.ctrlKey) {
      // Pinching out (fingers apart) scrolls "up" (deltaY < 0): closer. Never a fork step.
      this.pinchWheelAt = now;
      if (Math.abs(delta) >= WHEEL_NOTCH_PX) this.addZoom(-Math.sign(delta) * ZOOM_TAP_STOPS, true);
      else this.addZoom(-delta / PINCH_WHEEL_PX_PER_STOP, false);
      return;
    }
    const quiet = now - this.wheelAt > WHEEL_IDLE_MS;
    this.wheelAt = now;
    const step: -1 | 1 = delta < 0 ? 1 : -1;
    if (Math.abs(delta) >= WHEEL_NOTCH_PX) {
      this.wheelSum = 0;
      this.queueForkStep(step);
      return;
    }
    if (quiet || Math.sign(this.wheelSum) === -Math.sign(delta)) this.wheelSum = 0;
    this.wheelSum += delta;
    if (Math.abs(this.wheelSum) >= WHEEL_TRACKPAD_PX) {
      this.wheelSum = 0;
      this.queueForkStep(step);
    }
  };

  private queueForkStep(step: -1 | 1): void {
    this.forkSteps = Math.max(-MAX_FORK_STEPS, Math.min(MAX_FORK_STEPS, this.forkSteps + step));
  }

  /** Queue zoom stops for the next poll(): a `step` (key tap, wheel notch) or a pinch's share. */
  private addZoom(stops: number, step: boolean): void {
    if (!Number.isFinite(stops)) return;
    const clampStops = (v: number) => Math.max(-MAX_ZOOM_STOPS, Math.min(MAX_ZOOM_STOPS, v));
    if (step) this.zoomSteps = clampStops(this.zoomSteps + stops);
    else this.zoomPinched = clampStops(this.zoomPinched + stops);
  }

  /**
   * The page itself is pinch-zoomed (`visualViewport.scale`, e.g. after a pinch over the title): while it is, pinches
   * stay the browser's even while playing, so the player can pinch it back to 1 before the camera takes them again.
   */
  private pageZoomed(): boolean {
    const scale = this.target.visualViewport?.scale;
    return typeof scale === 'number' && scale > PAGE_ZOOMED_SCALE;
  }

  /**
   * Two fingers on the scene while playing: the log of how much their span changed is the zoom (apart = closer), and
   * the page must not pinch-zoom meanwhile. One finger, any touch off the playing screen, or a pinch while the page is
   * still pinch-zoomed (see pageZoomed) is left alone. A finger added or lifted re-takes the baseline, so the view
   * never jumps.
   */
  private readonly onTouch = (e: TouchEvent): void => {
    const touches = e.touches;
    this.touchesDown = touches ? touches.length : 0;
    if (this.touchesDown < 2 || !this.isGameplay() || this.pageZoomed()) {
      this.pinchSpan = 0;
      return;
    }
    const moving = e.type === 'touchmove';
    if ((moving || e.type === 'touchstart') && e.cancelable) e.preventDefault();
    const a = touches[0];
    const b = touches[1];
    const span = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const sameFingers = a.identifier === this.pinchA && b.identifier === this.pinchB;
    if (moving && sameFingers && this.pinchSpan > 0 && span >= PINCH_MIN_SPAN_PX) this.addZoom(Math.log2(span / this.pinchSpan), false);
    this.pinchA = a.identifier;
    this.pinchB = b.identifier;
    this.pinchSpan = span >= PINCH_MIN_SPAN_PX ? span : 0;
  };

  /**
   * The browser picks what a touch may do (pan, pinch-zoom…) from `touch-action` before any touch event reaches the
   * page, so a preventDefault alone can come too late: while playing the scene gets PLAYING_TOUCH_ACTION. Off the
   * playing screen it is left as the page styles it (the page may pinch-zoom over the title), and so while the page is
   * still pinch-zoomed (see pageZoomed), so a pinch on the scene can bring it back.
   */
  private syncTouchAction(): void {
    const capture = this.isGameplay() && !this.pageZoomed();
    if (capture !== this.touchActionSet) this.setTouchAction(capture);
  }

  private setTouchAction(capture: boolean): void {
    const style = (this.touchSurface as { style?: { touchAction?: string } } | undefined)?.style;
    if (!style || capture === this.touchActionSet) return;
    this.touchActionSet = capture;
    style.touchAction = capture ? PLAYING_TOUCH_ACTION : '';
  }

  /**
   * Safari sends pinches as gesturestart / gesturechange / gestureend (`scale` since the start) instead of Ctrl + wheel.
   * While playing the page must not zoom (unless it is still pinch-zoomed, see pageZoomed); a trackpad pinch (no finger
   * on the scene: touch pinches are read from the touches themselves) zooms the camera by the change in scale.
   */
  private readonly onGestureEvent = (e: Event): void => {
    const scale = (e as Event & { scale?: unknown }).scale;
    const ours = this.isGameplay() && !this.pageZoomed();
    if (!ours || typeof scale !== 'number' || !(scale > 0) || classifyFocusTarget(e.target) === 'text') {
      this.gestureScale = 0;
      return;
    }
    e.preventDefault();
    const now = Number.isFinite(e.timeStamp) ? e.timeStamp : 0;
    const trackpad = this.touchesDown === 0 && now - this.pinchWheelAt > WHEEL_IDLE_MS;
    if (e.type === 'gesturechange' && this.gestureScale > 0 && trackpad) this.addZoom(Math.log2(scale / this.gestureScale), false);
    this.gestureScale = e.type === 'gestureend' ? 0 : scale;
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
    this.levelStepKeys.delete(id);
    this.zoomKeys.delete(id);
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
    this.levelStepKeys.clear();
    this.zoomKeys.clear();
    this.claimedKeys.clear();
    this.forkSteps = 0;
    this.wheelSum = 0;
    this.zoomSteps = 0;
    this.zoomPinched = 0;
    this.pinchSpan = 0;
    this.gestureScale = 0;
    this.clearEdges();
  };

  private press(id: string, dir: number): void {
    if (this.held.has(id)) return;
    this.held.set(id, dir);
    this.heldCount[dir]++;
  }

  /** Direction of the held zoom keys (+ and − together cancel), 0 when none is held. */
  private heldZoom(): -1 | 0 | 1 {
    if (this.zoomKeys.size === 0) return 0; // the usual frame: no iterator
    let sum = 0;
    for (const dir of this.zoomKeys.values()) sum += dir;
    return sum > 0 ? 1 : sum < 0 ? -1 : 0;
  }

  /** Step of the most recently pressed level-jump key still held, 0 when none is. */
  private heldLevelStep(): -1 | 0 | 1 {
    if (this.levelStepKeys.size === 0) return 0; // the usual frame: no iterator
    let step: -1 | 0 | 1 = 0;
    for (const held of this.levelStepKeys.values()) step = held;
    return step;
  }

  private clearEdges(): void {
    this.actionEdge = false;
    this.rotateEdge = 0;
    this.restartEdge = false;
    this.muteEdge = false;
    this.timerEdge = false;
    this.movesEdge = false;
    this.beepEdge = false;
    this.hintsEdge = false;
    this.confirmEdge = false;
    this.backEdge = false;
    this.levelStepEdge = 0;
    this.testModeEdge = false;
  }
}
