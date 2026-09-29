import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input, type InputOptions } from './Input';
import type { GamepadLike } from './gamepad';

/** Minimal window + document built on Node's EventTarget (tests run without a DOM). */
function fakeWindow() {
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const win = Object.assign(new EventTarget(), { document });
  return { win, document, asWindow: win as unknown as Window };
}

interface KeyInit {
  code?: string;
  key?: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  /** AltGr held: Windows reports it as Ctrl+Alt, with `getModifierState('AltGraph')` true. */
  altGraph?: boolean;
  /** Pretend the event was dispatched on this element (e.g. a focused button). */
  target?: object;
}

function key(type: 'keydown' | 'keyup', init: KeyInit): Event {
  const ev = new Event(type, { cancelable: true });
  Object.assign(ev, {
    code: init.code ?? '',
    key: init.key ?? '',
    repeat: init.repeat ?? false,
    ctrlKey: init.ctrlKey ?? init.altGraph ?? false,
    metaKey: false,
    altKey: init.altKey ?? init.altGraph ?? false,
    isComposing: false,
    getModifierState: (k: string) => k === 'AltGraph' && init.altGraph === true,
  });
  if (init.target) Object.defineProperty(ev, 'target', { value: init.target });
  return ev;
}

const inputs: Input[] = [];
function setup(options: InputOptions = {}) {
  const env = fakeWindow();
  const input = new Input(env.asWindow, { gamepads: () => [], ...options });
  inputs.push(input);
  const down = (init: KeyInit) => {
    const ev = key('keydown', init);
    env.win.dispatchEvent(ev);
    return ev;
  };
  const up = (init: KeyInit) => env.win.dispatchEvent(key('keyup', init));
  return { ...env, input, down, up };
}

afterEach(() => {
  inputs.splice(0).forEach((i) => i.dispose());
});

describe('Input keyboard', () => {
  it('moves with WASD and arrows, normalizing diagonals', () => {
    const { input, down } = setup();
    down({ code: 'KeyW', key: 'w' });
    down({ code: 'ArrowRight', key: 'ArrowRight' });
    const s = input.poll();
    expect(s.keyX).toBeCloseTo(Math.SQRT1_2);
    expect(s.keyY).toBeCloseTo(Math.SQRT1_2);
    expect([s.stickX, s.stickY]).toEqual([0, 0]);
    expect(s.any).toBe(true);
  });

  it('lets W and ↑ overlap: releasing one keeps moving', () => {
    const { input, down, up } = setup();
    down({ code: 'KeyW', key: 'w' });
    down({ code: 'ArrowUp', key: 'ArrowUp' });
    up({ code: 'KeyW', key: 'w' });
    expect(input.poll().keyY).toBe(1);
    up({ code: 'ArrowUp', key: 'ArrowUp' });
    expect(input.poll().keyY).toBe(0);
  });

  it('cancels opposite directions', () => {
    const { input, down } = setup();
    down({ code: 'KeyA', key: 'a' });
    down({ code: 'KeyD', key: 'd' });
    expect(input.poll().keyX).toBe(0);
  });

  it('reports command keys once per press and resets them after poll', () => {
    const { input, down } = setup();
    down({ code: 'Space', key: ' ' });
    down({ code: 'KeyE', key: 'e' });
    down({ code: 'KeyR', key: 'r' });
    down({ code: 'KeyM', key: 'm' });
    down({ code: 'Enter', key: 'Enter' });
    down({ code: 'Escape', key: 'Escape' });
    const s = input.poll();
    expect([s.actionPressed, s.rotateCamera, s.restartPressed, s.mutePressed, s.confirmPressed, s.backPressed]).toEqual([
      true,
      1,
      true,
      true,
      true,
      true,
    ]);
    const next = input.poll();
    expect([next.actionPressed, next.rotateCamera, next.restartPressed, next.mutePressed, next.confirmPressed, next.backPressed]).toEqual([
      false,
      0,
      false,
      false,
      false,
      false,
    ]);
  });

  it('tracks R as held until released (hold-to-restart), re-synced by repeats', () => {
    const { input, down, up, win } = setup();
    down({ code: 'KeyR', key: 'r' });
    expect(input.poll().restartHeld).toBe(true);
    const held = input.poll();
    expect([held.restartPressed, held.restartHeld]).toEqual([false, true]);
    up({ code: 'KeyR', key: 'r' });
    expect(input.poll().restartHeld).toBe(false);
    down({ code: 'KeyR', key: 'r' });
    win.dispatchEvent(new Event('blur'));
    down({ code: 'KeyR', key: 'r', repeat: true }); // still held when the window comes back
    const back = input.poll();
    expect([back.restartPressed, back.restartHeld]).toEqual([false, true]);
    up({ code: 'KeyR', key: 'r' });
    expect(input.poll().any).toBe(false);
  });

  it('ignores key repeat for edges', () => {
    const { input, down } = setup();
    down({ code: 'Space', key: ' ', repeat: true });
    expect(input.poll().actionPressed).toBe(false);
  });

  it('prevents page scrolling for arrows and Space', () => {
    const { down } = setup();
    expect(down({ code: 'ArrowDown', key: 'ArrowDown' }).defaultPrevented).toBe(true);
    expect(down({ code: 'Space', key: ' ', repeat: true }).defaultPrevented).toBe(true);
    expect(down({ code: 'KeyX', key: 'x' }).defaultPrevented).toBe(false);
  });

  it('leaves browser shortcuts alone', () => {
    const { input, down } = setup();
    const ev = down({ code: 'KeyR', key: 'r', ctrlKey: true });
    expect(ev.defaultPrevented).toBe(false);
    expect(input.poll().restartPressed).toBe(false);
  });

  it('accepts AltGr for the level-jump keys only ([ / ] on Spanish, German and most ISO layouts)', () => {
    const { input, down } = setup();
    down({ code: 'BracketRight', key: ']', altGraph: true }); // Spanish: AltGr + the "+" key
    expect(input.poll().levelStep).toBe(1);
    down({ code: 'Digit8', key: '[', altGraph: true }); // German: AltGr + 8
    expect(input.poll().levelStep).toBe(-1);
    down({ code: 'BracketLeft', key: '[', ctrlKey: true, altKey: true }); // a real Ctrl+Alt shortcut
    expect(input.poll().levelStep).toBe(0);
    const r = down({ code: 'KeyR', key: 'r', altGraph: true }); // every other key keeps leaving AltGr alone
    expect(r.defaultPrevented).toBe(false);
    expect(input.poll().restartPressed).toBe(false);
  });

  it('tracks level-jump keys as held until released (hold-to-jump), the latest press winning', () => {
    const { input, down, up, win } = setup();
    down({ code: 'PageDown', key: 'PageDown' });
    const first = input.poll();
    expect([first.levelStep, first.levelStepHeld]).toEqual([1, 1]);
    const held = input.poll();
    expect([held.levelStep, held.levelStepHeld, held.any]).toEqual([0, 1, true]);
    down({ code: 'BracketLeft', key: '[' });
    expect(input.poll().levelStepHeld).toBe(-1);
    up({ code: 'BracketLeft', key: '[' });
    expect(input.poll().levelStepHeld).toBe(1);
    up({ code: 'PageDown', key: 'PageDown' });
    expect(input.poll().levelStepHeld).toBe(0);
    down({ code: 'PageUp', key: 'PageUp' });
    win.dispatchEvent(new Event('blur'));
    expect(input.poll().levelStepHeld).toBe(0);
  });

  it('releases every key on window blur and when the tab is hidden', () => {
    const { input, down, win, document } = setup();
    down({ code: 'KeyW', key: 'w' });
    win.dispatchEvent(new Event('blur'));
    expect(input.poll().keyY).toBe(0);
    down({ code: 'KeyS', key: 's' });
    document.visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(input.poll().keyY).toBe(0);
  });

  it('ignores every key typed into a text field', () => {
    const { input, down } = setup();
    const field = { tagName: 'INPUT', type: 'text', getAttribute: () => null };
    const ev = down({ code: 'Space', key: ' ', target: field });
    down({ code: 'KeyW', key: 'w', target: field });
    expect(ev.defaultPrevented).toBe(false);
    const s = input.poll();
    expect(s.actionPressed).toBe(false);
    expect(s.keyY).toBe(0);
  });

  it('leaves Space / Enter to a focused button (e.g. the autofocused primary button)', () => {
    const { input, down, win } = setup();
    const button = { tagName: 'BUTTON', getAttribute: () => null, blur: vi.fn() };
    win.dispatchEvent(new Event('focusin'));
    const space = down({ code: 'Space', key: ' ', target: button });
    const enter = down({ code: 'Enter', key: 'Enter', target: button });
    expect(space.defaultPrevented).toBe(false);
    expect(enter.defaultPrevented).toBe(false);
    const s = input.poll();
    expect(s.actionPressed).toBe(false);
    expect(s.confirmPressed).toBe(false);
    expect(button.blur).not.toHaveBeenCalled();
  });

  it('during gameplay Space always belongs to the game, even on a stray Tab / mouse focus (Tab, Q, Space)', () => {
    const { input, down, win } = setup({ isGameplay: () => true });
    const button = { tagName: 'BUTTON', getAttribute: () => null, blur: vi.fn() };
    win.dispatchEvent(new Event('focusin')); // Tab lands on "Reiniciar nivel"
    down({ code: 'KeyQ', key: 'q', target: button });
    const ev = down({ code: 'Space', key: ' ', target: button });
    expect(ev.defaultPrevented).toBe(true);
    expect(button.blur).toHaveBeenCalledOnce();
    expect(input.poll().actionPressed).toBe(true);

    win.dispatchEvent(new Event('focusin')); // mouse press left focus behind, nothing else pressed since
    expect(down({ code: 'Space', key: ' ', target: button }).defaultPrevented).toBe(true);
    expect(input.poll().actionPressed).toBe(true);
  });

  it('during gameplay Enter activates a freshly focused button until any game key is used', () => {
    const { input, down, win } = setup({ isGameplay: () => true });
    const button = { tagName: 'BUTTON', getAttribute: () => null, blur: vi.fn() };
    win.dispatchEvent(new Event('focusin'));
    expect(down({ code: 'Enter', key: 'Enter', target: button }).defaultPrevented).toBe(false); // keyboard user
    expect(input.poll().confirmPressed).toBe(false);
    for (const code of ['KeyE', 'KeyM', 'KeyR', 'KeyW']) {
      win.dispatchEvent(new Event('focusin'));
      down({ code, key: code.slice(3).toLowerCase(), target: button });
      expect(down({ code: 'Enter', key: 'Enter', target: button }).defaultPrevented).toBe(true);
      expect(input.poll().confirmPressed).toBe(true);
    }
    expect(button.blur).toHaveBeenCalledTimes(4);
  });

  it('off gameplay never takes Space / Enter from a focused button (level dot, "Repetir")', () => {
    const { input, down, win } = setup({ isGameplay: () => false });
    const button = { tagName: 'BUTTON', getAttribute: () => null, blur: vi.fn() };
    win.dispatchEvent(new Event('focusin'));
    down({ code: 'ArrowRight', key: 'ArrowRight', target: button });
    down({ code: 'KeyQ', key: 'q', target: button });
    const enter = down({ code: 'Enter', key: 'Enter', target: button });
    const space = down({ code: 'Space', key: ' ', target: button });
    expect([enter.defaultPrevented, space.defaultPrevented]).toEqual([false, false]);
    const s = input.poll();
    expect([s.confirmPressed, s.actionPressed]).toEqual([false, false]);
    expect(button.blur).not.toHaveBeenCalled();
  });

  it('hands Space / Enter back to a button that gains focus after driving', () => {
    const { input, down, win } = setup({ isGameplay: () => true });
    const button = { tagName: 'BUTTON', getAttribute: () => null, blur: vi.fn() };
    down({ code: 'KeyW', key: 'w' });
    win.dispatchEvent(new Event('focusin')); // e.g. Tab after driving
    down({ code: 'Enter', key: 'Enter', target: button });
    expect(input.poll().confirmPressed).toBe(false);
    expect(button.blur).not.toHaveBeenCalled();
  });

  it('never lets a held key repeat activate a button (held Enter on the last card must not also start a level)', () => {
    const { input, down, win } = setup();
    const button = { tagName: 'BUTTON', getAttribute: () => null, blur: vi.fn() };
    expect(down({ code: 'Enter', key: 'Enter', target: button }).defaultPrevented).toBe(false); // "Volver al inicio"
    win.dispatchEvent(new Event('focusin')); // title autofocuses "Continuar"
    expect(down({ code: 'Enter', key: 'Enter', target: button, repeat: true }).defaultPrevented).toBe(true);
    expect(down({ code: 'Space', key: ' ', target: button, repeat: true }).defaultPrevented).toBe(true);
    const s = input.poll();
    expect([s.confirmPressed, s.actionPressed]).toEqual([false, false]);
  });

  it('swallows Space / Enter on a button while button keys are locked (completion card grace)', () => {
    let locked = true;
    const { input, down, up } = setup({ buttonKeysLocked: () => locked });
    const button = { tagName: 'BUTTON', getAttribute: () => null, blur: vi.fn() };
    expect(down({ code: 'Enter', key: 'Enter', target: button }).defaultPrevented).toBe(true);
    expect(down({ code: 'Space', key: ' ', target: button }).defaultPrevented).toBe(true);
    locked = false;
    expect(up({ code: 'Space', key: ' ', target: button })).toBe(false); // keyup cancelled: no late click
    const s = input.poll();
    expect([s.confirmPressed, s.actionPressed]).toEqual([false, false]);
    expect(down({ code: 'Enter', key: 'Enter', target: button }).defaultPrevented).toBe(false);
  });

  it('a press the game took never finishes as a click on a button focused before its release', () => {
    const { input, down, up } = setup();
    const button = { tagName: 'BUTTON', getAttribute: () => null, blur: vi.fn() };
    down({ code: 'Space', key: ' ' }); // on the page: a game action
    expect(input.poll().actionPressed).toBe(true);
    expect(up({ code: 'Space', key: ' ', target: button })).toBe(false); // the card's button got focus meanwhile
    down({ code: 'Space', key: ' ', target: button }); // a real press on the button
    expect(up({ code: 'Space', key: ' ', target: button })).toBe(true); // is left to activate it
  });

  it('reports user gestures synchronously (audio unlock) and stops listening after dispose', () => {
    const onGesture = vi.fn();
    const { input, down, win } = setup({ onGesture });
    down({ code: 'Enter', key: 'Enter' });
    win.dispatchEvent(new Event('pointerdown'));
    down({ code: 'KeyW', key: 'w', repeat: true });
    expect(onGesture).toHaveBeenCalledTimes(2);
    input.dispose();
    input.dispose(); // idempotent
    down({ code: 'Space', key: ' ' });
    expect(onGesture).toHaveBeenCalledTimes(2);
    expect(input.poll().actionPressed).toBe(false);
  });
});

describe('Input gamepad', () => {
  const pad = (axes: number[], pressed: number[]): GamepadLike => ({
    index: 0,
    connected: true,
    mapping: 'standard',
    axes,
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
  });

  it('reports keyboard + d-pad as digital input and the stick separately', () => {
    const { input, down } = setup({ gamepads: () => [pad([1, 0], [0, 15])] }); // stick right, A, d-pad right
    down({ code: 'KeyW', key: 'w' });
    const s = input.poll();
    expect(s.keyX).toBeCloseTo(Math.SQRT1_2); // W + d-pad right, clamped to length 1
    expect(s.keyY).toBeCloseTo(Math.SQRT1_2);
    expect(s.stickX).toBeCloseTo(1);
    expect(s.stickY).toBe(0);
    expect(s.actionPressed).toBe(true);
    expect(input.poll().actionPressed).toBe(false);
  });

  it('maps Back to restart (edge + held) and Y to retry', () => {
    const frames = [pad([0, 0], [8, 3]), pad([0, 0], [8]), pad([0, 0], [])];
    let i = 0;
    const { input } = setup({ gamepads: () => [frames[Math.min(i++, frames.length - 1)]] });
    const first = input.poll();
    expect([first.restartPressed, first.restartHeld, first.retryPressed]).toEqual([true, true, true]);
    const second = input.poll();
    expect([second.restartPressed, second.restartHeld, second.retryPressed]).toEqual([false, true, false]);
    expect(input.poll().restartHeld).toBe(false);
  });
});

interface WheelInit {
  deltaY: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  timeStamp?: number;
  target?: object;
}

function wheelEvent(init: WheelInit): Event {
  const ev = new Event('wheel', { cancelable: true });
  Object.assign(ev, { deltaY: init.deltaY, deltaX: 0, deltaMode: init.deltaMode ?? 0, ctrlKey: init.ctrlKey ?? false, metaKey: false });
  Object.defineProperty(ev, 'timeStamp', { value: init.timeStamp ?? 0 });
  if (init.target) Object.defineProperty(ev, 'target', { value: init.target });
  return ev;
}

describe('Input fork levels (docs/RACKS.md)', () => {
  const steps = (input: Input, frames: number) => Array.from({ length: frames }, () => input.poll().forkStep);

  it('F / V step one slot up / down on the press (repeats ignored)', () => {
    const { input, down, up } = setup();
    down({ code: 'KeyF', key: 'f' });
    const s = input.poll();
    expect(s.forkStep).toBe(1);
    expect(s.any).toBe(true);
    down({ code: 'KeyF', key: 'f', repeat: true });
    expect(input.poll().forkStep).toBe(0);
    up({ code: 'KeyF', key: 'f' });
    down({ code: 'KeyV', key: 'v' });
    expect(steps(input, 2)).toEqual([-1, 0]);
  });

  it('several presses in one frame come out one per frame (two at most), opposite ones cancel', () => {
    const { input, down, up } = setup();
    for (let i = 0; i < 3; i++) {
      down({ code: 'KeyF', key: 'f' });
      up({ code: 'KeyF', key: 'f' });
    }
    expect(steps(input, 4)).toEqual([1, 1, 0, 0]);
    down({ code: 'KeyF', key: 'f' });
    down({ code: 'KeyV', key: 'v' });
    expect(steps(input, 2)).toEqual([0, 0]);
  });

  it('while playing, one mouse wheel notch is one slot however large its delta (up = up), and the page does not scroll', () => {
    const { input, win } = setup({ isGameplay: () => true });
    const up = wheelEvent({ deltaY: -100, timeStamp: 10 });
    win.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(input.poll().forkStep).toBe(1);
    win.dispatchEvent(wheelEvent({ deltaY: 360, timeStamp: 20 }));
    expect(steps(input, 2)).toEqual([-1, 0]);
    // Firefox reports lines: 3 lines = one notch.
    win.dispatchEvent(wheelEvent({ deltaY: 3, deltaMode: 1, timeStamp: 30 }));
    expect(input.poll().forkStep).toBe(-1);
    // Three quick notches: three slots (queued two at most).
    for (const t of [40, 41, 42]) win.dispatchEvent(wheelEvent({ deltaY: -120, timeStamp: t }));
    expect(steps(input, 3)).toEqual([1, 1, 0]);
  });

  it('trackpad deltas add up to one slot per WHEEL_TRACKPAD_PX; a pause or a change of direction forgets the rest', () => {
    const { input, win } = setup({ isGameplay: () => true });
    const small = (deltaY: number, timeStamp: number) => win.dispatchEvent(wheelEvent({ deltaY, timeStamp }));
    for (let i = 0; i < 11; i++) small(-10, i * 16);
    expect(input.poll().forkStep).toBe(0); // 110 px so far
    small(-10, 11 * 16);
    expect(input.poll().forkStep).toBe(1); // 120 px
    for (let i = 0; i < 8; i++) small(-10, 300 + i * 16);
    small(-10, 900); // after a pause: the 80 px before it are gone
    expect(input.poll().forkStep).toBe(0);
    for (let i = 0; i < 10; i++) small(-10, 920 + i * 16); // 110 px up…
    expect(input.poll().forkStep).toBe(0);
    small(10, 1200); // …then the other way: starts again from 0
    for (let i = 0; i < 10; i++) small(10, 1210 + i * 16);
    expect(input.poll().forkStep).toBe(0);
    small(10, 1400);
    expect(input.poll().forkStep).toBe(-1);
  });

  it('leaves the wheel alone off the playing screen, with Ctrl (zoom / pinch) and over a text field', () => {
    let playing = false;
    const { input, win } = setup({ isGameplay: () => playing });
    const title = wheelEvent({ deltaY: -100 });
    win.dispatchEvent(title);
    expect(title.defaultPrevented).toBe(false);
    expect(input.poll().forkStep).toBe(0);
    playing = true;
    const zoom = wheelEvent({ deltaY: -100, ctrlKey: true });
    win.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(false);
    const field = wheelEvent({ deltaY: -100, target: { tagName: 'INPUT', type: 'text' } });
    win.dispatchEvent(field);
    expect(field.defaultPrevented).toBe(false);
    expect(input.poll().forkStep).toBe(0);
  });

  it('forgets pending steps when the window loses focus, and stops listening after dispose', () => {
    const { input, win, down } = setup({ isGameplay: () => true });
    down({ code: 'KeyF', key: 'f' });
    win.dispatchEvent(new Event('blur'));
    expect(input.poll().forkStep).toBe(0);
    input.dispose();
    const late = wheelEvent({ deltaY: -100 });
    win.dispatchEvent(late);
    expect(late.defaultPrevented).toBe(false);
    expect(input.poll().forkStep).toBe(0);
  });

  it('merges gamepad X / B with the keys (keys and wheel first)', () => {
    const frames: GamepadLike[][] = [[pad(2)], [pad()], [pad(1)]];
    let i = 0;
    const { input, down } = setup({ gamepads: () => frames[Math.min(i++, frames.length - 1)] });
    expect(input.poll().forkStep).toBe(1); // X
    down({ code: 'KeyV', key: 'v' });
    expect(input.poll().forkStep).toBe(-1); // V
    expect(input.poll().forkStep).toBe(-1); // B
  });
});

function pad(...pressed: number[]): GamepadLike {
  return {
    index: 0,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, b) => ({ pressed: pressed.includes(b) })),
  };
}
