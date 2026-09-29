import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../core/types';
import { GAME_CONFIG } from '../config';
import { LEVELS } from '../data/levels';
import { createUIStore } from '../ui/uiState';
import { Game } from './Game';

/**
 * Flow tests for the orchestrator with the real Input, ProgressStore (memory), levels and flow helpers.
 * Renderer and audio are stubs (no WebGL / Web Audio in Node); the simulation is a scripted stand-in so each
 * test can emit exactly the events it needs (boxPicked, levelComplete…).
 */
const fakes = vi.hoisted(() => {
  const sim = {
    /** Every simulation Game created, oldest first (a new one = the level was (re)loaded). */
    states: [] as { level: { id: string }; inputs: { x: number; z: number; throttle: number; steer: number; action: boolean }[] }[],
    /** Events the current simulation emits on its next update. */
    queue: [] as unknown[],
    /** Next GameRenderer construction throws (no WebGL context). */
    failRenderer: false,
    yaw: Math.PI / 4,
  };

  class FakeGameState {
    readonly level: { id: string };
    readonly inputs: { x: number; z: number; throttle: number; steer: number; action: boolean }[] = [];
    private readonly snapshot = { forklift: { speed: 0, forkLift: 0 }, completed: false };
    constructor(level: { id: string }) {
      this.level = level;
      sim.states.push(this);
    }
    getSnapshot() {
      return this.snapshot;
    }
    update(_dt: number, input: { move: { x: number; z: number }; drive?: { throttle: number; steer: number }; actionPressed: boolean }) {
      this.inputs.push({
        x: input.move.x,
        z: input.move.z,
        throttle: input.drive?.throttle ?? 0,
        steer: input.drive?.steer ?? 0,
        action: input.actionPressed,
      });
      if (sim.states[sim.states.length - 1] !== this) return [];
      const events = sim.queue.splice(0) as { type: string }[];
      if (events.some((e) => e.type === 'levelComplete')) this.snapshot.completed = true;
      return events;
    }
  }

  class FakeRenderer {
    constructor() {
      if (sim.failRenderer) throw new Error('THREE.WebGLRenderer: Error creating WebGL context.');
    }
    loadLevel() {}
    update() {}
    handleEvent() {}
    rotateCamera() {}
    getCameraYaw() {
      return sim.yaw;
    }
    setIdleOrbit() {}
    dispose() {}
  }

  class FakeAudio {
    unlock() {
      return Promise.resolve();
    }
    uiClick() {}
    setMuted() {}
    setScene() {}
    setMotor() {}
    handleEvent() {}
    dispose() {}
  }

  return { sim, FakeGameState, FakeRenderer, FakeAudio };
});

vi.mock('../logic/GameState', () => ({ GameState: fakes.FakeGameState }));
vi.mock('../render/GameRenderer', () => ({ GameRenderer: fakes.FakeRenderer }));
vi.mock('../audio/AudioEngine', () => ({ AudioEngine: fakes.FakeAudio }));

const { sim } = fakes;
const FRAME_MS = 1000 / 60;

function fakeWindow() {
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  return Object.assign(new EventTarget(), { document });
}

function keyEvent(type: 'keydown' | 'keyup', code: string, key: string, target?: object): Event {
  const ev = new Event(type, { cancelable: true });
  Object.assign(ev, { code, key, repeat: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false });
  if (target) Object.defineProperty(ev, 'target', { value: target });
  return ev;
}

let win: ReturnType<typeof fakeWindow>;
let rafCallback: FrameRequestCallback | null;
let now: number;
let game: Game | null;

function setup() {
  const store = createUIStore();
  game = new Game({} as HTMLElement, store);
  game.mount();
  return { game, store };
}

/** Run frames at 60 Hz for `seconds` (at least one frame). */
function advance(seconds: number): void {
  const frames = Math.max(1, Math.round(seconds * 60));
  for (let i = 0; i < frames; i++) {
    now += FRAME_MS;
    const cb = rafCallback;
    rafCallback = null;
    cb?.(now);
  }
}

const press = (code: string, key: string, target?: object) => win.dispatchEvent(keyEvent('keydown', code, key, target));
const release = (code: string, key: string) => win.dispatchEvent(keyEvent('keyup', code, key));
const tap = (code: string, key: string) => {
  press(code, key);
  advance(1 / 60);
  release(code, key);
};
const emit = (...events: GameEvent[]) => {
  sim.queue.push(...events);
  advance(1 / 60);
};
const current = () => sim.states[sim.states.length - 1];

beforeEach(() => {
  sim.states.length = 0;
  sim.queue.length = 0;
  sim.failRenderer = false;
  sim.yaw = Math.PI / 4;
  win = fakeWindow();
  rafCallback = null;
  now = 1000;
  vi.stubGlobal('window', win);
  vi.stubGlobal('localStorage', undefined); // ProgressStore falls back to memory
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallback = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafCallback = null;
  });
});

afterEach(() => {
  game?.dispose();
  game = null;
  vi.unstubAllGlobals();
});

describe('Game input mapping', () => {
  it('drives the forklift itself with the keyboard (vehicle mapping): W / S throttle, A / D steer', () => {
    expect(GAME_CONFIG.controls.keyboardMapping).toBe('vehicle');
    const { game } = setup();
    game.start(0);
    press('KeyW', 'w');
    advance(1 / 60);
    const w = current().inputs.at(-1)!;
    expect(w).toMatchObject({ x: 0, z: 0, throttle: 1, steer: 0 });
    press('KeyA', 'a');
    advance(1 / 60);
    // Both keys at once: full throttle while turning left (no diagonal normalization for vehicle input).
    expect(current().inputs.at(-1)!).toMatchObject({ throttle: 1, steer: 1 });
    release('KeyW', 'w');
    release('KeyA', 'a');
    press('KeyS', 's');
    press('KeyD', 'd');
    advance(1 / 60);
    expect(current().inputs.at(-1)!).toMatchObject({ x: 0, z: 0, throttle: -1, steer: -1 });
  });

  it('treats Space on a stray-focused HUD button as a pick-up during play', () => {
    const { game, store } = setup();
    game.start(0);
    const button = { tagName: 'BUTTON', getAttribute: () => null, blur: vi.fn() };
    win.dispatchEvent(new Event('focusin'));
    press('KeyQ', 'q', button);
    press('Space', ' ', button);
    advance(1 / 60);
    expect(current().inputs.at(-1)!.action).toBe(true);
    expect(button.blur).toHaveBeenCalled();
    expect(sim.states).toHaveLength(2); // mount + start: no restart
    expect(store.get().screen).toBe('playing');
  });
});

describe('Game restart guard', () => {
  it('restarts on R at once while nothing has been moved', () => {
    const { game } = setup();
    game.start(0);
    tap('KeyR', 'r');
    expect(sim.states).toHaveLength(3);
  });

  it('needs R held for restartHoldSec once a box was picked; releasing early cancels', () => {
    const { game, store } = setup();
    game.start(0);
    emit({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    const before = sim.states.length;

    tap('KeyR', 'r'); // a slip next to E
    advance(1);
    expect(sim.states).toHaveLength(before);

    press('KeyR', 'r');
    advance(GAME_CONFIG.flow.restartHoldSec * 0.6);
    expect(sim.states).toHaveLength(before);
    advance(GAME_CONFIG.flow.restartHoldSec * 0.6);
    expect(sim.states).toHaveLength(before + 1);
    release('KeyR', 'r');
    expect(store.get().screen).toBe('playing');

    // The fresh level has nothing to lose again: instant.
    tap('KeyR', 'r');
    expect(sim.states).toHaveLength(before + 2);
  });

  it('publishes the hold progress for the HUD fill, and clears it on release', () => {
    const { game, store } = setup();
    game.start(0);
    emit({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    press('KeyR', 'r');
    advance(GAME_CONFIG.flow.restartHoldSec * 0.5);
    const mid = store.get().restartHold;
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    release('KeyR', 'r');
    advance(1 / 60);
    expect(store.get().restartHold).toBe(0);
  });

  it('keeps the HUD restart a single click', () => {
    const { game } = setup();
    game.start(0);
    emit({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    const before = sim.states.length;
    game.restart();
    expect(sim.states).toHaveLength(before + 1);
  });
});

describe('Game completion', () => {
  function completeLevel(store: ReturnType<typeof createUIStore>) {
    emit({ type: 'firstInput' });
    advance(0.5);
    emit({ type: 'levelComplete' });
    expect(store.get().screen).toBe('playing'); // the completion delay is running
  }

  it('ignores R, Esc and the HUD restart during the completion delay, then shows the card', () => {
    const { game, store } = setup();
    game.start(0);
    completeLevel(store);
    const before = sim.states.length;
    tap('KeyR', 'r');
    tap('Escape', 'Escape');
    game.restart();
    game.toTitle();
    expect(sim.states).toHaveLength(before);
    expect(store.get().screen).toBe('playing');
    advance(GAME_CONFIG.flow.completeDelaySec);
    expect(store.get().screen).toBe('complete');
    expect(store.get().result).not.toBeNull();
  });

  it('does not let a stray press skip the card in its first moments', () => {
    const { game, store } = setup();
    game.start(0);
    completeLevel(store);
    advance(GAME_CONFIG.flow.completeDelaySec + 2 / 60);
    expect(store.get().screen).toBe('complete');

    tap('Space', ' ');
    tap('Enter', 'Enter');
    tap('KeyR', 'r');
    expect(store.get().screen).toBe('complete');
    const button = { tagName: 'BUTTON', getAttribute: () => null, blur: vi.fn() };
    expect(press('Enter', 'Enter', button)).toBe(false); // autofocused "Siguiente almacén" is not activated
    release('Enter', 'Enter');

    advance(GAME_CONFIG.flow.confirmGraceSec);
    tap('Space', ' ');
    expect(store.get().screen).toBe('playing');
    expect(store.get().levelIndex).toBe(1);
  });

  it('R on the card repeats the level at once', () => {
    const { game, store } = setup();
    game.start(0);
    emit({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    completeLevel(store);
    advance(GAME_CONFIG.flow.completeDelaySec + GAME_CONFIG.flow.confirmGraceSec + 0.1);
    const before = sim.states.length;
    tap('KeyR', 'r');
    expect(sim.states).toHaveLength(before + 1);
    expect(store.get().screen).toBe('playing');
    expect(store.get().levelIndex).toBe(0);
  });

  it('Esc on the card goes to the title, pointing "Continuar" at the next level', () => {
    const { game, store } = setup();
    game.start(0);
    completeLevel(store);
    advance(GAME_CONFIG.flow.completeDelaySec + GAME_CONFIG.flow.confirmGraceSec + 0.1);
    tap('Escape', 'Escape');
    expect(store.get().screen).toBe('title');
    expect(store.get().levelIndex).toBe(1);
    expect(current().level.id).toBe(LEVELS[1].id);
  });
});

describe('Game "Continuar" with an older save', () => {
  it('leads a player who cleared the whole earlier game into the first new level', () => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    });
    // Written by the 12-level build: every level cleared, the last one (then final) kept as "Continuar".
    const classic = LEVELS.slice(0, 12);
    items.set(
      'toro.progress.v1',
      JSON.stringify({
        version: 1,
        rankings: Object.fromEntries(classic.map((l) => [l.id, [60_000]])),
        highestUnlocked: 11,
        lastLevel: 11,
        lastLevelId: classic[11].id,
        settings: { muted: false, showTimer: true },
      }),
    );
    const { game, store } = setup();
    expect(store.get()).toMatchObject({ screen: 'title', levelIndex: 12, levelName: LEVELS[12].name, canContinue: true });
    game.start();
    expect(store.get()).toMatchObject({ screen: 'playing', levelIndex: 12 });
    expect(current().level.id).toBe(LEVELS[12].id);
  });
});

describe('Game back to title', () => {
  it('Esc mid-level keeps the arrangement and the paused time; "Continuar" resumes it', () => {
    const { game, store } = setup();
    game.start(0);
    const level = current();
    emit({ type: 'firstInput' });
    emit({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    advance(1);
    tap('Escape', 'Escape');
    expect(store.get().screen).toBe('title');
    expect(store.get().canContinue).toBe(true);
    expect(store.get().levelIndex).toBe(0);
    const paused = store.get().elapsedMs;
    expect(paused).toBeGreaterThan(900);

    advance(3); // on the title: the clock does not run
    game.start();
    expect(current()).toBe(level); // same simulation, nothing reloaded
    expect(store.get().screen).toBe('playing');
    expect(store.get().timerStarted).toBe(true);
    expect(store.get().elapsedMs).toBe(paused);

    advance(1); // the clock waits for the player's first input
    expect(store.get().elapsedMs).toBe(paused);
    press('KeyW', 'w');
    advance(1);
    expect(store.get().elapsedMs).toBeGreaterThan(paused + 800);

    // Work is still at stake after resuming: R needs a hold.
    release('KeyW', 'w');
    tap('KeyR', 'r');
    expect(current()).toBe(level);
  });

  it('keeps the paused clock waiting across Esc → Continuar → Esc before any input', () => {
    const { game, store } = setup();
    game.start(0);
    emit({ type: 'firstInput' });
    advance(1);
    tap('Escape', 'Escape');
    game.start();
    tap('Escape', 'Escape'); // straight back out, the clock never restarted
    game.start();
    const paused = store.get().elapsedMs;
    press('KeyW', 'w');
    advance(1);
    expect(store.get().elapsedMs).toBeGreaterThan(paused + 800);
  });

  it('picking another level from the title loads it fresh', () => {
    const { game, store } = setup();
    game.start(0);
    tap('Escape', 'Escape');
    const before = sim.states.length;
    game.start(1);
    expect(sim.states).toHaveLength(before + 1);
    expect(current().level.id).toBe(LEVELS[1].id);
    expect(store.get().elapsedMs).toBe(0);
    expect(store.get().timerStarted).toBe(false);
  });

  it('confirm on the title (Space / Enter on the page) resumes too', () => {
    const { game, store } = setup();
    game.start(0);
    const level = current();
    tap('Escape', 'Escape');
    tap('Enter', 'Enter');
    expect(store.get().screen).toBe('playing');
    expect(current()).toBe(level);
  });
});

describe('Game settings keys and other tabs', () => {
  it('T shows / hides the timer (persisted setting)', () => {
    const { game, store } = setup();
    game.start(0);
    const shown = store.get().showTimer;
    tap('KeyT', 't');
    expect(store.get().showTimer).toBe(!shown);
    tap('KeyT', 't');
    expect(store.get().showTimer).toBe(shown);
  });

  it('refreshes the title summaries when another tab writes the progress key', () => {
    const { store } = setup();
    expect(store.get().screen).toBe('title');
    store.set({ levels: [], canContinue: true });
    win.dispatchEvent(Object.assign(new Event('storage'), { key: 'unrelated' }));
    expect(store.get().levels).toHaveLength(0);
    win.dispatchEvent(Object.assign(new Event('storage'), { key: 'toro.progress.v1' }));
    expect(store.get().levels).toHaveLength(LEVELS.length);
  });
});

describe('Game without WebGL', () => {
  it('does not throw from mount, shows the unsupported card; actions stay inert', () => {
    sim.failRenderer = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { game, store } = setup();
    expect(warn).toHaveBeenCalledOnce();
    expect(rafCallback).toBeNull();
    expect(store.get().screen).toBe('unsupported');
    expect(() => game.start(0)).not.toThrow();
    expect(store.get().screen).toBe('unsupported');
    expect(sim.states).toHaveLength(0);
    warn.mockRestore();
  });
});


describe('Game: modo prueba', () => {
  const unlockedCount = (levels: { unlocked: boolean }[]) => levels.filter((l) => l.unlocked).length;
  const completeLevel = () => {
    emit({ type: 'levelComplete' });
    advance(GAME_CONFIG.flow.completeDelaySec + 0.1);
  };

  it('opens every level dot while on, and turning it off shows the real locked state again', () => {
    const { game, store } = setup();
    expect(store.get().testMode).toBe(false);
    expect(unlockedCount(store.get().levels)).toBe(1);
    game.toggleTestMode();
    expect(store.get().testMode).toBe(true);
    expect(unlockedCount(store.get().levels)).toBe(LEVELS.length);
    game.toggleTestMode();
    expect(store.get().testMode).toBe(false);
    expect(unlockedCount(store.get().levels)).toBe(1);
  });

  it('U toggles it on the title only', () => {
    const { game, store } = setup();
    tap('KeyU', 'u');
    expect(store.get().testMode).toBe(true);
    game.start(0);
    tap('KeyU', 'u');
    expect(store.get().testMode).toBe(true);
  });

  it('every level (including the stacking chapter) can be started, fresh', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    for (let i = 0; i < LEVELS.length; i++) {
      game.toTitle();
      game.start(i);
      expect(store.get()).toMatchObject({ screen: 'playing', levelIndex: i, levelName: LEVELS[i].name });
      expect(current().level.id).toBe(LEVELS[i].id);
    }
  });

  it('[ / ] (and PageUp / PageDown) jump levels while playing, only in test mode', () => {
    const { game, store } = setup();
    game.start(0);
    tap('BracketRight', ']');
    expect(store.get().levelIndex).toBe(0);

    game.toTitle();
    game.toggleTestMode();
    game.start(0);
    const before = sim.states.length;
    tap('BracketRight', ']');
    expect(store.get().levelIndex).toBe(1);
    expect(sim.states.length).toBe(before + 1); // a fresh level
    expect(store.get()).toMatchObject({ elapsedMs: 0, timerStarted: false });
    tap('PageDown', 'PageDown');
    expect(store.get().levelIndex).toBe(2);
    tap('BracketLeft', '[');
    tap('PageUp', 'PageUp');
    tap('PageUp', 'PageUp');
    expect(store.get().levelIndex).toBe(0); // clamped at the first level
  });

  it('never changes unlock progress: a level opened only by test mode records no time and unlocks nothing', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    game.start(5);
    emit({ type: 'firstInput' }); // a real, recordable time
    advance(0.5);
    completeLevel();
    expect(store.get().screen).toBe('complete');
    expect(store.get().result?.timeMs).toBeGreaterThan(0);
    expect(store.get().result?.isNewBest).toBe(false);
    expect(store.get().result?.practice).toBe(true); // the card says the time is not kept
    game.toTitle();
    expect(store.get().levelIndex).toBe(0); // "Continuar" still leads to the real last level
    game.toggleTestMode();
    expect(unlockedCount(store.get().levels)).toBe(1);
    expect(store.get().levels[5].bestMs).toBeNull();
    expect(store.get().canContinue).toBe(false);
  });

  it('Esc → "Continuar" resumes a level only test mode opened, without saving it as the last level', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    game.start(5);
    const level = current();
    emit({ type: 'firstInput' });
    emit({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    tap('Escape', 'Escape');
    expect(store.get()).toMatchObject({ screen: 'title', levelIndex: 5, canContinue: true });

    game.start();
    expect(current()).toBe(level); // same simulation, nothing reloaded
    expect(store.get()).toMatchObject({ screen: 'playing', levelIndex: 5, levelName: LEVELS[5].name, timerStarted: true });
    expect(store.get().canContinue).toBe(false); // the saved progress is still a fresh save

    tap('Escape', 'Escape');
    tap('Enter', 'Enter'); // confirm on the title resumes too
    expect(current()).toBe(level);
    expect(store.get().levelIndex).toBe(5);
  });

  it('turning it off drops a suspended level it opened and shows the real "Continuar" level', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    game.start(5);
    emit({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    tap('Escape', 'Escape');
    game.toggleTestMode();
    expect(store.get()).toMatchObject({ screen: 'title', testMode: false, levelIndex: 0, levelName: LEVELS[0].name, canContinue: false });
    expect(current().level.id).toBe(LEVELS[0].id);
    game.start();
    expect(store.get()).toMatchObject({ screen: 'playing', levelIndex: 0 });
    expect(current().level.id).toBe(LEVELS[0].id);
  });

  it('turning it off keeps a suspended level that is genuinely open', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    game.start(0);
    const level = current();
    tap('Escape', 'Escape');
    game.toggleTestMode();
    expect(store.get()).toMatchObject({ testMode: false, levelIndex: 0, canContinue: true });
    game.start();
    expect(current()).toBe(level);
  });

  it('a level jump needs a hold once a box was picked (shown on the ↺ fill); releasing early cancels', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    game.start(0);
    emit({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    const level = current();

    tap('BracketRight', ']'); // a slip next to Enter
    advance(1);
    expect(current()).toBe(level);
    expect(store.get().restartHold).toBe(0);

    press('PageDown', 'PageDown');
    advance(GAME_CONFIG.flow.restartHoldSec * 0.5);
    expect(current()).toBe(level);
    expect(store.get().restartHold).toBeGreaterThan(0.3);
    release('PageDown', 'PageDown');
    advance(1 / 60);
    expect(store.get().restartHold).toBe(0);
    advance(GAME_CONFIG.flow.restartHoldSec);
    expect(current()).toBe(level);

    press('PageDown', 'PageDown');
    advance(GAME_CONFIG.flow.restartHoldSec * 1.2);
    expect(store.get().levelIndex).toBe(1);
    expect(current().level.id).toBe(LEVELS[1].id);
    release('PageDown', 'PageDown');
    advance(1 / 60);
    expect(store.get().restartHold).toBe(0);

    // The fresh level has nothing to lose: instant again.
    tap('BracketLeft', '[');
    expect(store.get().levelIndex).toBe(0);
  });

  it('a genuinely open level still records its best time and unlocks the next one', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    game.start(0);
    emit({ type: 'firstInput' }); // starts the timer
    advance(0.5);
    completeLevel();
    expect(store.get().result?.practice).toBe(false);
    game.toTitle();
    expect(store.get().levels[0].bestMs).not.toBeNull();
    game.toggleTestMode();
    expect(unlockedCount(store.get().levels)).toBe(2);
  });

  it('persists the setting', () => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    });
    const first = setup();
    first.game.toggleTestMode();
    first.game.dispose();
    const second = setup();
    expect(second.store.get().testMode).toBe(true);
    expect(unlockedCount(second.store.get().levels)).toBe(LEVELS.length);
  });
});
