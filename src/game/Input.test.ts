import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input, PINCH_WHEEL_PX_PER_STOP, ZOOM_KEY_RATE, ZOOM_TAP_STOPS, type InputOptions } from './Input';
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
  metaKey?: boolean;
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
    metaKey: init.metaKey ?? false,
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

  it('reports T (timer) and N (move counter) as separate edges', () => {
    const { input, down } = setup();
    down({ code: 'KeyN', key: 'n' });
    const s = input.poll();
    expect([s.movesPressed, s.timerPressed, s.any]).toEqual([true, false, true]);
    expect(input.poll().movesPressed).toBe(false);
    down({ code: 'KeyT', key: 't' });
    const t = input.poll();
    expect([t.movesPressed, t.timerPressed]).toEqual([false, true]);
  });

  it('reports B (the reverse beeper on / off) as its own edge, once per press', () => {
    const { input, down, up } = setup();
    down({ code: 'KeyB', key: 'b' });
    const s = input.poll();
    expect([s.beepPressed, s.mutePressed, s.movesPressed, s.timerPressed, s.any]).toEqual([true, false, false, false, true]);
    expect(input.poll().beepPressed).toBe(false);
    down({ code: 'KeyB', key: 'b', repeat: true }); // held: never a second toggle
    expect(input.poll().beepPressed).toBe(false);
    up({ code: 'KeyB', key: 'b' });
    down({ code: '', key: 'B' }); // no code (autofill-style events): the character still works
    expect(input.poll().beepPressed).toBe(true);
    down({ code: 'KeyB', key: 'b', ctrlKey: true }); // a browser shortcut is left alone
    expect(input.poll().beepPressed).toBe(false);
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
  metaKey?: boolean;
  timeStamp?: number;
  target?: object;
}

function wheelEvent(init: WheelInit): Event {
  const ev = new Event('wheel', { cancelable: true });
  Object.assign(ev, {
    deltaY: init.deltaY,
    deltaX: 0,
    deltaMode: init.deltaMode ?? 0,
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
  });
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

  it('leaves the wheel alone off the playing screen (Ctrl + wheel too: the browser zoom), with ⌘ and over a text field', () => {
    let playing = false;
    const { input, win } = setup({ isGameplay: () => playing });
    const title = wheelEvent({ deltaY: -100 });
    win.dispatchEvent(title);
    expect(title.defaultPrevented).toBe(false);
    const browserZoom = wheelEvent({ deltaY: -100, ctrlKey: true });
    win.dispatchEvent(browserZoom);
    expect(browserZoom.defaultPrevented).toBe(false);
    const pinch = wheelEvent({ deltaY: -4, ctrlKey: true });
    win.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(false);
    const off = input.poll(1 / 60);
    expect([off.forkStep, off.zoom, off.zoomStep]).toEqual([0, 0, 0]);
    playing = true;
    const cmd = wheelEvent({ deltaY: -100, metaKey: true });
    win.dispatchEvent(cmd);
    expect(cmd.defaultPrevented).toBe(false);
    const field = wheelEvent({ deltaY: -100, ctrlKey: true, target: { tagName: 'INPUT', type: 'text' } });
    win.dispatchEvent(field);
    expect(field.defaultPrevented).toBe(false);
    const s = input.poll(1 / 60);
    expect([s.forkStep, s.zoom, s.zoomStep]).toEqual([0, 0, 0]);
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

describe('Input camera zoom', () => {
  it('+ / − (main row and numpad) give a small step on a tap; repeats add none', () => {
    const { input, down, up } = setup();
    for (const [code, key, sign] of [
      ['Equal', '=', 1],
      ['Equal', '+', 1], // Shift + = on US keyboards
      ['NumpadAdd', '+', 1],
      ['Minus', '-', -1],
      ['NumpadSubtract', '-', -1],
    ] as const) {
      const ev = down({ code, key });
      expect(ev.defaultPrevented).toBe(true);
      down({ code, key, repeat: true });
      up({ code, key });
      const s = input.poll(1 / 60);
      expect([s.zoomStep, s.zoom]).toEqual([sign * ZOOM_TAP_STOPS, 0]); // released: no held rate
      expect(s.any).toBe(true);
      const next = input.poll(1 / 60);
      expect([next.zoomStep, next.zoom]).toEqual([0, 0]);
    }
  });

  it('holding + / − zooms on at ZOOM_KEY_RATE stops per second; + and − together cancel', () => {
    const { input, down, up } = setup();
    down({ code: 'NumpadAdd', key: '+' });
    const first = input.poll(0.1);
    expect(first.zoomStep).toBeCloseTo(ZOOM_TAP_STOPS); // the tap's step, eased in by the camera…
    expect(first.zoom).toBeCloseTo(ZOOM_KEY_RATE * 0.1); // …and the held rate, followed as it goes
    down({ code: 'NumpadAdd', key: '+', repeat: true });
    const held = input.poll(0.5);
    expect([held.zoomStep, held.zoom]).toEqual([0, ZOOM_KEY_RATE * 0.5]);
    down({ code: 'Minus', key: '-' });
    const both = input.poll(0.5);
    expect([both.zoomStep, both.zoom]).toEqual([-ZOOM_TAP_STOPS, 0]); // the − tap; the held rates cancel
    up({ code: 'NumpadAdd', key: '+' });
    expect(input.poll(0.25).zoom).toBeCloseTo(-ZOOM_KEY_RATE * 0.25);
    up({ code: 'Minus', key: '-' });
    const idle = input.poll(1);
    expect([idle.zoom, idle.zoomStep, idle.any]).toEqual([0, 0, false]);
  });

  it('reads "+" / "-" by character on any layout: the Spanish "+" key (BracketRight) zooms, AltGr + it still jumps levels', () => {
    const { input, down, up } = setup();
    down({ code: 'BracketRight', key: '+' }); // Spanish / German "+"
    const plus = input.poll();
    expect([plus.zoomStep, plus.levelStep, plus.levelStepHeld]).toEqual([ZOOM_TAP_STOPS, 0, 0]);
    up({ code: 'BracketRight', key: '+' });
    down({ code: 'BracketRight', key: ']', altGraph: true }); // Spanish "]"
    const jump = input.poll();
    expect([jump.zoomStep, jump.zoom, jump.levelStep]).toEqual([0, 0, 1]);
    up({ code: 'BracketRight', key: ']' });
    down({ code: 'Slash', key: '-' }); // Spanish / German "-"
    expect(input.poll().zoomStep).toBeCloseTo(-ZOOM_TAP_STOPS);
    up({ code: 'Slash', key: '-' });
    down({ code: 'Digit6', key: '-' }); // AZERTY "-"
    expect(input.poll().zoomStep).toBeCloseTo(-ZOOM_TAP_STOPS);
  });

  it('leaves Ctrl / ⌘ + / − to the browser zoom', () => {
    const { input, down } = setup({ isGameplay: () => true });
    for (const init of [
      { code: 'Equal', key: '=', ctrlKey: true },
      { code: 'Minus', key: '-', ctrlKey: true },
      { code: 'NumpadAdd', key: '+', ctrlKey: true },
      { code: 'BracketRight', key: '+', ctrlKey: true },
      { code: 'Equal', key: '=', metaKey: true },
      { code: 'Minus', key: '-', metaKey: true },
    ]) {
      expect(down(init).defaultPrevented).toBe(false);
    }
    const s = input.poll(1);
    expect([s.zoom, s.zoomStep]).toEqual([0, 0]);
  });

  it('forgets held zoom keys and pending steps when the window loses focus', () => {
    const { input, down, win } = setup();
    down({ code: 'Equal', key: '=' });
    win.dispatchEvent(new Event('blur'));
    const s = input.poll(1);
    expect([s.zoom, s.zoomStep]).toEqual([0, 0]);
  });

  it('while playing, a trackpad pinch (Ctrl + wheel) follows the fingers and never steps the forks', () => {
    const { input, win } = setup({ isGameplay: () => true });
    const apart = wheelEvent({ deltaY: -10, ctrlKey: true, timeStamp: 10 });
    win.dispatchEvent(apart);
    expect(apart.defaultPrevented).toBe(true); // not the page's zoom
    win.dispatchEvent(wheelEvent({ deltaY: -5, ctrlKey: true, timeStamp: 26 }));
    const s = input.poll(1 / 60);
    expect(s.zoom).toBeCloseTo(15 / PINCH_WHEEL_PX_PER_STOP);
    expect(2 ** s.zoom).toBeCloseTo(Math.exp(15 / 100)); // Chromium's pinch scale for those deltas
    expect([s.zoomStep, s.forkStep]).toEqual([0, 0]); // it follows the fingers: not a step
    win.dispatchEvent(wheelEvent({ deltaY: 8, ctrlKey: true, timeStamp: 42 })); // fingers together: further
    expect(input.poll(1 / 60).zoom).toBeCloseTo(-8 / PINCH_WHEEL_PX_PER_STOP);
    // A long pinch never adds up to a fork step.
    for (let i = 0; i < 40; i++) win.dispatchEvent(wheelEvent({ deltaY: -10, ctrlKey: true, timeStamp: 100 + i * 16 }));
    expect(Array.from({ length: 3 }, () => input.poll(1 / 60).forkStep)).toEqual([0, 0, 0]);
  });

  it('while playing, a Ctrl + mouse wheel notch is one tap step (pixels or Firefox lines)', () => {
    const { input, win } = setup({ isGameplay: () => true });
    win.dispatchEvent(wheelEvent({ deltaY: -100, ctrlKey: true, timeStamp: 10 }));
    const notch = input.poll();
    expect([notch.zoomStep, notch.zoom]).toEqual([ZOOM_TAP_STOPS, 0]);
    win.dispatchEvent(wheelEvent({ deltaY: 3, deltaMode: 1, ctrlKey: true, timeStamp: 30 }));
    const s = input.poll();
    expect([s.zoomStep, s.zoom, s.forkStep]).toEqual([-ZOOM_TAP_STOPS, 0, 0]);
  });

  it('the plain wheel still steps the forks and never zooms', () => {
    const { input, win } = setup({ isGameplay: () => true });
    win.dispatchEvent(wheelEvent({ deltaY: -100, timeStamp: 10 }));
    const notch = input.poll(1 / 60);
    expect([notch.forkStep, notch.zoom, notch.zoomStep]).toEqual([1, 0, 0]);
    for (let i = 0; i < 12; i++) win.dispatchEvent(wheelEvent({ deltaY: 10, timeStamp: 300 + i * 16 }));
    const trackpad = input.poll(1 / 60);
    expect([trackpad.forkStep, trackpad.zoom]).toEqual([-1, 0]);
  });

  describe('touch pinch on the scene', () => {
    type Finger = [id: number, x: number, y: number];
    function touchSetup(playing: { value: boolean } = { value: true }) {
      const surface = new EventTarget();
      const env = setup({ isGameplay: () => playing.value, touchSurface: surface });
      const touch = (type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel', ...fingers: Finger[]) => {
        const ev = new Event(type, { cancelable: true });
        Object.assign(ev, { touches: fingers.map(([identifier, clientX, clientY]) => ({ identifier, clientX, clientY })) });
        surface.dispatchEvent(ev);
        return ev;
      };
      return { ...env, touch };
    }

    it('two fingers moving apart zoom in by the log of their span ratio, together zoom out; the page does not zoom', () => {
      const { input, touch } = touchSetup();
      expect(touch('touchstart', [0, 100, 100]).defaultPrevented).toBe(false);
      expect(touch('touchstart', [0, 100, 100], [1, 200, 100]).defaultPrevented).toBe(true);
      expect(input.poll().zoom).toBe(0); // a baseline, no jump
      expect(touch('touchmove', [0, 50, 100], [1, 250, 100]).defaultPrevented).toBe(true); // span 100 → 200
      expect(input.poll().zoom).toBeCloseTo(1);
      touch('touchmove', [0, 100, 100], [1, 200, 100]); // 200 → 100
      touch('touchmove', [0, 100, 100], [1, 100, 150]); // 100 → 50
      expect(input.poll().zoom).toBeCloseTo(-2);
    });

    it('leaves one finger alone', () => {
      const { input, touch } = touchSetup();
      expect(touch('touchstart', [0, 100, 100]).defaultPrevented).toBe(false);
      expect(touch('touchmove', [0, 300, 200]).defaultPrevented).toBe(false);
      expect(touch('touchend').defaultPrevented).toBe(false);
      expect(input.poll().zoom).toBe(0);
    });

    it('re-takes the baseline when a finger is added or lifted, so the view never jumps', () => {
      const { input, touch } = touchSetup();
      touch('touchstart', [0, 0, 0], [1, 100, 0]);
      touch('touchstart', [0, 0, 0], [1, 100, 0], [2, 500, 0]);
      touch('touchend', [1, 100, 0], [2, 500, 0]); // finger 0 lifted: 1 and 2 are the pinch now (span 400)
      expect(input.poll().zoom).toBe(0);
      touch('touchmove', [1, 100, 0], [2, 900, 0]); // 400 → 800
      expect(input.poll().zoom).toBeCloseTo(1);
      touch('touchend', [2, 900, 0]); // one finger left
      touch('touchstart', [2, 900, 0], [3, 950, 0]); // a new second finger: baseline 50
      touch('touchmove', [2, 900, 0], [3, 1000, 0]); // 50 → 100
      expect(input.poll().zoom).toBeCloseTo(1);
    });

    it('off the playing screen two fingers are left to the page, and nothing zooms', () => {
      const playing = { value: false };
      const { input, touch } = touchSetup(playing);
      expect(touch('touchstart', [0, 100, 100], [1, 200, 100]).defaultPrevented).toBe(false);
      expect(touch('touchmove', [0, 50, 100], [1, 250, 100]).defaultPrevented).toBe(false);
      expect(input.poll().zoom).toBe(0);
      playing.value = true; // the level starts mid-gesture: the next move only sets the baseline
      touch('touchmove', [0, 50, 100], [1, 250, 100]);
      expect(input.poll().zoom).toBe(0);
      touch('touchmove', [0, 0, 100], [1, 400, 100]); // 200 → 400
      expect(input.poll().zoom).toBeCloseTo(1);
    });

    it("sets the surface's touch-action while playing only (no browser pinch before a touch event could stop it)", () => {
      const playing = { value: false };
      const surface = Object.assign(new EventTarget(), { style: { touchAction: '' } });
      const { input } = setup({ isGameplay: () => playing.value, touchSurface: surface });
      input.poll();
      expect(surface.style.touchAction).toBe('');
      playing.value = true;
      input.poll();
      expect(surface.style.touchAction).toBe('pan-x pan-y'); // one-finger pans stay
      playing.value = false;
      input.poll();
      expect(surface.style.touchAction).toBe('');
      playing.value = true;
      input.poll();
      input.dispose();
      expect(surface.style.touchAction).toBe('');
    });

    it('stops listening to the surface after dispose', () => {
      const { input, touch } = touchSetup();
      input.dispose();
      expect(touch('touchstart', [0, 100, 100], [1, 200, 100]).defaultPrevented).toBe(false);
      touch('touchmove', [0, 50, 100], [1, 250, 100]);
      expect(input.poll().zoom).toBe(0);
    });
  });

  describe('Safari gesture events', () => {
    function gesture(win: EventTarget, type: 'gesturestart' | 'gesturechange' | 'gestureend', scale: number, timeStamp = 1000) {
      const ev = new Event(type, { cancelable: true });
      Object.assign(ev, { scale });
      Object.defineProperty(ev, 'timeStamp', { value: timeStamp });
      win.dispatchEvent(ev);
      return ev;
    }

    it('a trackpad pinch zooms by the change in scale while playing, and the page does not zoom', () => {
      const { input, win } = setup({ isGameplay: () => true });
      expect(gesture(win, 'gesturestart', 1).defaultPrevented).toBe(true);
      expect(gesture(win, 'gesturechange', 2).defaultPrevented).toBe(true);
      expect(input.poll().zoom).toBeCloseTo(1);
      gesture(win, 'gesturechange', 1);
      expect(input.poll().zoom).toBeCloseTo(-1);
      gesture(win, 'gestureend', 1);
      gesture(win, 'gesturechange', 4); // no gesture going on: nothing to compare with
      expect(input.poll().zoom).toBe(0);
    });

    it('off the playing screen gestures are left to the page', () => {
      const { input, win } = setup({ isGameplay: () => false });
      expect(gesture(win, 'gesturestart', 1).defaultPrevented).toBe(false);
      expect(gesture(win, 'gesturechange', 2).defaultPrevented).toBe(false);
      expect(input.poll().zoom).toBe(0);
    });

    it('never counts a pinch twice: with fingers on the scene (iOS) or right after a Ctrl + wheel pinch', () => {
      const surface = new EventTarget();
      const { input, win } = setup({ isGameplay: () => true, touchSurface: surface });
      const touches = new Event('touchstart', { cancelable: true });
      Object.assign(touches, { touches: [{ identifier: 0, clientX: 0, clientY: 0 }, { identifier: 1, clientX: 100, clientY: 0 }] });
      surface.dispatchEvent(touches);
      expect(gesture(win, 'gesturestart', 1).defaultPrevented).toBe(true); // still no page zoom
      gesture(win, 'gesturechange', 2);
      expect(input.poll().zoom).toBe(0); // the touches carry this pinch
      const lifted = new Event('touchend', { cancelable: true });
      Object.assign(lifted, { touches: [] });
      surface.dispatchEvent(lifted);
      gesture(win, 'gestureend', 2);

      win.dispatchEvent(wheelEvent({ deltaY: -10, ctrlKey: true, timeStamp: 5000 }));
      gesture(win, 'gesturestart', 1, 5010);
      gesture(win, 'gesturechange', 2, 5020);
      expect(input.poll().zoom).toBeCloseTo(10 / PINCH_WHEEL_PX_PER_STOP); // the wheel's share only
    });
  });

  it('while the page itself is still pinch-zoomed (a pinch over the title), pinches stay the browser\'s until it is back', () => {
    const surface = Object.assign(new EventTarget(), { style: { touchAction: '' } });
    const { input, win, down, up } = setup({ isGameplay: () => true, touchSurface: surface });
    const viewport = { scale: 2 };
    Object.assign(win, { visualViewport: viewport });
    input.poll(1 / 60);
    expect(surface.style.touchAction).toBe(''); // the browser may pinch the page back out
    const pinch = wheelEvent({ deltaY: 10, ctrlKey: true, timeStamp: 10 });
    win.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(false);
    const gesture = new Event('gesturechange', { cancelable: true });
    Object.assign(gesture, { scale: 0.5 });
    win.dispatchEvent(gesture);
    expect(gesture.defaultPrevented).toBe(false);
    const fingers = (type: string, span: number) => {
      const ev = new Event(type, { cancelable: true });
      Object.assign(ev, { touches: [{ identifier: 0, clientX: 0, clientY: 0 }, { identifier: 1, clientX: span, clientY: 0 }] });
      surface.dispatchEvent(ev);
      return ev;
    };
    expect(fingers('touchstart', 200).defaultPrevented).toBe(false);
    expect(fingers('touchmove', 100).defaultPrevented).toBe(false);
    // The rest of the game keeps working: the plain wheel still steps the forks, + / − still zoom the camera.
    const fork = wheelEvent({ deltaY: -100, timeStamp: 30 });
    win.dispatchEvent(fork);
    expect(fork.defaultPrevented).toBe(true);
    down({ code: 'Equal', key: '=' });
    const s = input.poll(1 / 60);
    expect(s.zoom).toBeCloseTo(ZOOM_KEY_RATE / 60); // no pinch share, only the held +
    expect([s.zoomStep, s.forkStep]).toEqual([ZOOM_TAP_STOPS, 1]);
    up({ code: 'Equal', key: '=' });

    viewport.scale = 1; // pinched back out: the camera takes pinches again
    input.poll(1 / 60);
    expect(surface.style.touchAction).toBe('pan-x pan-y');
    const again = wheelEvent({ deltaY: -10, ctrlKey: true, timeStamp: 500 });
    win.dispatchEvent(again);
    expect(again.defaultPrevented).toBe(true);
    expect(input.poll(1 / 60).zoom).toBeCloseTo(10 / PINCH_WHEEL_PX_PER_STOP);
    expect(fingers('touchstart', 100).defaultPrevented).toBe(true);
    fingers('touchmove', 200);
    expect(input.poll(1 / 60).zoom).toBeCloseTo(1);
  });

  it('the gamepad triggers give an analog rate: RT closer, LT further', () => {
    const frames = [triggers(0, 1), triggers(0.55, 0), triggers(0.05, 0.08)];
    let i = 0;
    const { input, down } = setup({ gamepads: () => [frames[Math.min(i++, frames.length - 1)]] });
    expect(input.poll(0.5).zoom).toBeCloseTo(ZOOM_KEY_RATE * 0.5);
    expect(input.poll(1).zoom).toBeCloseTo(-ZOOM_KEY_RATE * 0.5);
    const rest = input.poll(1); // resting triggers: inside the dead zone
    expect([rest.zoom, rest.any]).toEqual([0, false]);
    down({ code: 'Equal', key: '=' });
    expect(input.poll(0).zoomStep).toBeCloseTo(ZOOM_TAP_STOPS);
  });
});

/** A standard pad with only the triggers pulled (LT = button 6, RT = 7; analog `value`). */
function triggers(lt: number, rt: number): GamepadLike {
  return {
    index: 0,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, b) => {
      const value = b === 6 ? lt : b === 7 ? rt : 0;
      return { pressed: value > 0.5, value };
    }),
  };
}

function pad(...pressed: number[]): GamepadLike {
  return {
    index: 0,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, b) => ({ pressed: pressed.includes(b) })),
  };
}
