import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../core/types';
import { GAME_CONFIG } from '../config';
import { hasRacks } from '../core/racks';
import { BENCHMARK_ID, LEVELS, getSpecialLevel } from '../data/levels';
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
    states: [] as { level: { id: string }; inputs: { x: number; z: number; throttle: number; steer: number; action: boolean; forkStep: number }[] }[],
    /** Events the current simulation emits on its next update. */
    queue: [] as unknown[],
    /** Next GameRenderer construction throws (no WebGL context). */
    failRenderer: false,
    yaw: Math.PI / 4,
    /**
     * `hint.rack` of every simulation's snapshot (null = not facing a rack column). A fork step input moves its level
     * within the column, like the real one.
     */
    rack: null as { rackId: string; column: number; levels: number; level: number; slotId: string; ready: boolean } | null,
  };

  class FakeGameState {
    readonly level: { id: string };
    readonly inputs: { x: number; z: number; throttle: number; steer: number; action: boolean; forkStep: number }[] = [];
    private readonly snapshot = { forklift: { speed: 0, forkLift: 0 }, completed: false, hint: { rack: sim.rack } };
    constructor(level: { id: string }) {
      this.level = level;
      sim.states.push(this);
    }
    getSnapshot() {
      this.snapshot.hint.rack = sim.rack;
      return this.snapshot;
    }
    update(
      _dt: number,
      input: { move: { x: number; z: number }; drive?: { throttle: number; steer: number }; actionPressed: boolean; forkStep?: number },
    ) {
      this.inputs.push({
        x: input.move.x,
        z: input.move.z,
        throttle: input.drive?.throttle ?? 0,
        steer: input.drive?.steer ?? 0,
        action: input.actionPressed,
        forkStep: input.forkStep ?? 0,
      });
      const rack = sim.rack;
      if (rack && input.forkStep) rack.level = Math.max(0, Math.min(rack.levels - 1, rack.level + input.forkStep));
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
    forkClick() {}
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
  sim.rack = null;
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

  it('passes the fork level keys to the simulation while playing (F up, V down), never from the title', () => {
    const { game } = setup();
    press('KeyF', 'f');
    advance(1 / 60);
    expect(current().inputs.at(-1)!.forkStep).toBe(0); // title: the diorama gets no control
    release('KeyF', 'f');
    game.start(0);
    advance(1 / 60);
    press('KeyF', 'f');
    advance(1 / 60);
    expect(current().inputs.at(-1)!.forkStep).toBe(1);
    advance(1 / 60);
    expect(current().inputs.at(-1)!.forkStep).toBe(0); // an edge: one frame
    release('KeyF', 'f');
    press('KeyV', 'v');
    advance(1 / 60);
    expect(current().inputs.at(-1)!.forkStep).toBe(-1);
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

  it('the last level ends the game: nothing more unlocks, its card leads back to the title, "Continuar" stays on it', () => {
    const last = LEVELS.length - 1;
    const items = savedGame({
      rankings: Object.fromEntries(LEVELS.slice(0, last).map((l) => [l.id, [60_000]])),
      highestUnlocked: last,
      lastLevel: last,
      lastLevelId: LEVELS[last].id,
    });
    const { game, store } = setup();
    game.start();
    expect(store.get()).toMatchObject({ screen: 'playing', levelIndex: last });
    completeLevel(store);
    advance(GAME_CONFIG.flow.completeDelaySec + GAME_CONFIG.flow.confirmGraceSec + 0.1);
    expect(store.get()).toMatchObject({ screen: 'complete' });
    expect(store.get().result).toMatchObject({ isLast: true, practice: false });
    const saved = JSON.parse(items.get('toro.progress.v1')!) as Record<string, unknown>;
    expect(saved).toMatchObject({ highestUnlocked: last, lastLevel: last, lastLevelId: LEVELS[last].id });
    expect(Object.keys(saved.rankings as object)).toEqual(LEVELS.map((l) => l.id));

    game.nextLevel(); // "Volver al inicio"
    expect(store.get()).toMatchObject({ screen: 'title', levelIndex: last, canContinue: true });
    expect(current().level.id).toBe(LEVELS[last].id);
    expect(store.get().levels.every((l) => l.unlocked && l.bestMs !== null)).toBe(true);
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

/** A (fake) localStorage holding `saved` as the progress document; returns its items to read what was saved. */
function savedGame(saved: Record<string, unknown>): Map<string, string> {
  const items = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  });
  items.set('toro.progress.v1', JSON.stringify({ version: 1, settings: { muted: false, showTimer: true }, ...saved }));
  return items;
}

/** Ids of the 24-level game (levels 4–24 were removed on 2026-09-30 to be redone). */
const OLD_GAME_IDS = [
  ...LEVELS.slice(0, 3).map((l) => l.id),
  ...['pequeno-desorden', 'cruce-de-pasillos', 'un-toque-de-coral', 'estanterias-en-fila', 'una-cosa-lleva-a-otra'],
  ...['tarde-de-lavanda', 'mudanza-a-medias', 'pasillos-de-luz', 'el-gran-almacen', 'una-encima', 'primero-la-base'],
  ...['dos-pilas', 'al-reves', 'torre-de-tres', 'el-gran-apilado', 'lo-que-dice-la-tapa', 'color-o-forma'],
  ...['dos-sitios-posibles', 'justo-esa', 'la-muestra', 'el-gran-reparto'],
];

describe('Game "Continuar" with an older save', () => {
  it('leads a player who cleared the whole earlier game into the first new level', () => {
    // Written by a build one level shorter: every level cleared, the last one (then final) kept as "Continuar".
    const earlier = LEVELS.slice(0, -1);
    savedGame({
      rankings: Object.fromEntries(earlier.map((l) => [l.id, [60_000]])),
      highestUnlocked: earlier.length - 1,
      lastLevel: earlier.length - 1,
      lastLevelId: earlier[earlier.length - 1].id,
    });
    const index = earlier.length;
    const { game, store } = setup();
    expect(store.get()).toMatchObject({ screen: 'title', levelIndex: index, levelName: LEVELS[index].name, canContinue: true });
    game.start();
    expect(store.get()).toMatchObject({ screen: 'playing', levelIndex: index });
    expect(current().level.id).toBe(LEVELS[index].id);
  });

  it('a save from the 24-level game (levels 4–24 removed since) loads on the last level left, never past it', () => {
    // Everything cleared and open, "Continuar" on level 13 (gone): its times and indices point past the game.
    expect(OLD_GAME_IDS).toHaveLength(24);
    const items = savedGame({
      rankings: Object.fromEntries(OLD_GAME_IDS.map((id, i) => [id, [60_000 + i * 1000]])),
      highestUnlocked: 23,
      lastLevel: 12,
      lastLevelId: 'una-encima',
    });
    const saved = items.get('toro.progress.v1');
    const last = LEVELS.length - 1;
    const { game, store } = setup();
    expect(store.get()).toMatchObject({ screen: 'title', levelIndex: last, levelName: LEVELS[last].name, canContinue: true });
    expect(current().level.id).toBe(LEVELS[last].id);
    // The dots are the levels left: all open, with their own times (the removed ids are ignored).
    expect(store.get().levels.map((l) => [l.id, l.unlocked, l.bestMs])).toEqual(LEVELS.map((l, i) => [l.id, true, 60_000 + i * 1000]));
    game.start();
    expect(store.get()).toMatchObject({ screen: 'playing', levelIndex: last });
    expect(current().level.id).toBe(LEVELS[last].id);
    // Reading it changed nothing but the "Continuar" level, now one that exists.
    const after = JSON.parse(items.get('toro.progress.v1')!) as Record<string, unknown>;
    expect(after).toMatchObject({ ...JSON.parse(saved!), lastLevel: last, lastLevelId: LEVELS[last].id });
  });

  it('a save with only times of removed levels is a fresh start', () => {
    savedGame({ rankings: { 'la-muestra': [30_000], 'el-gran-reparto': [90_000] }, highestUnlocked: 0, lastLevel: 0, lastLevelId: null });
    const { store } = setup();
    expect(store.get()).toMatchObject({ screen: 'title', levelIndex: 0, canContinue: false });
    expect(store.get().levels.filter((l) => l.unlocked)).toHaveLength(1);
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


describe('Game: sorting by symbol', () => {
  it('tells audio how the zone of each drop matches (color bell, symbol wood, exact both)', () => {
    // No shipped level sorts by symbol today (levels 4–24 are being redone): the Benchmark's floor zones do.
    const handle = vi.spyOn(fakes.FakeAudio.prototype, 'handleEvent');
    const { game } = setup();
    game.toggleTestMode();
    game.startBenchmark();
    const benchmark = getSpecialLevel(BENCHMARK_ID)!;
    const zone = (color: string | undefined, symbol: string | undefined) =>
      benchmark.zones.find((z) => z.color === color && z.symbol === symbol)!.id;
    const dropOn = (zoneId: string | null): GameEvent => ({
      type: 'boxDropped',
      boxId: 'b1',
      cell: { x: 1, z: 1 },
      zoneId,
      level: 0,
      correct: zoneId !== null,
      recipeLength: zoneId ? 1 : 0,
      satisfiedCount: 1,
      total: 4,
    });
    handle.mockClear();
    emit(dropOn(zone('coral', undefined)), dropOn(zone(undefined, 'triangle')), dropOn(zone('blue', 'square')), dropOn(null));
    expect(handle.mock.calls.map((c) => (c as unknown[])[1])).toEqual(['color', 'symbol', 'exact', 'color']);
    // Classic levels ring the bell, as before.
    game.start(0);
    handle.mockClear();
    emit(dropOn(LEVELS[0].zones[0].id));
    expect(handle.mock.calls.map((c) => (c as unknown[])[1])).toEqual(['color']);
    handle.mockRestore();
  });

});

describe('Game: modo prueba', () => {
  const unlockedCount = (levels: { unlocked: boolean }[]) => levels.filter((l) => l.unlocked).length;
  /** A level still locked on a fresh save: only test mode opens it. */
  const LOCKED = LEVELS.length - 1;
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

  it('every level can be started, fresh', () => {
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

  it('PageDown reaches every level and stops at the last one', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    game.start(0);
    for (let i = 1; i < LEVELS.length; i++) {
      tap('PageDown', 'PageDown');
      expect(store.get()).toMatchObject({ screen: 'playing', levelIndex: i, levelName: LEVELS[i].name });
      expect(current().level.id).toBe(LEVELS[i].id);
    }
    const before = sim.states.length;
    tap('PageDown', 'PageDown');
    expect(store.get().levelIndex).toBe(LEVELS.length - 1); // the last level, not reloaded
    expect(sim.states).toHaveLength(before);
  });

  it('never changes unlock progress: a level opened only by test mode records no time and unlocks nothing', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    game.start(LOCKED);
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
    expect(store.get().levels[LOCKED].bestMs).toBeNull();
    expect(store.get().canContinue).toBe(false);
  });

  it('Esc → "Continuar" resumes a level only test mode opened, without saving it as the last level', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    game.start(LOCKED);
    const level = current();
    emit({ type: 'firstInput' });
    emit({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    tap('Escape', 'Escape');
    expect(store.get()).toMatchObject({ screen: 'title', levelIndex: LOCKED, canContinue: true });

    game.start();
    expect(current()).toBe(level); // same simulation, nothing reloaded
    expect(store.get()).toMatchObject({ screen: 'playing', levelIndex: LOCKED, levelName: LEVELS[LOCKED].name, timerStarted: true });
    expect(store.get().canContinue).toBe(false); // the saved progress is still a fresh save

    tap('Escape', 'Escape');
    tap('Enter', 'Enter'); // confirm on the title resumes too
    expect(current()).toBe(level);
    expect(store.get().levelIndex).toBe(LOCKED);
  });

  it('turning it off drops a suspended level it opened and shows the real "Continuar" level', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    game.start(LOCKED);
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

describe('Game: Benchmark (test mode special level)', () => {
  const benchmark = getSpecialLevel(BENCHMARK_ID)!;
  const unlockedCount = (levels: { unlocked: boolean }[]) => levels.filter((l) => l.unlocked).length;
  /** Real (fake) localStorage, so the tests can read exactly what was saved. */
  const withStorage = () => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    });
    return items;
  };
  /** The saved progress without the settings (test mode itself is a setting). */
  const progressOf = (items: Map<string, string>) => {
    const { settings: _settings, ...progress } = JSON.parse(items.get('toro.progress.v1') ?? '{}') as Record<string, unknown>;
    return progress;
  };
  /** A timed run to the end, then the completion card (still in its first moments). */
  const finish = () => {
    emit({ type: 'firstInput' });
    advance(0.5);
    emit({ type: 'levelComplete' });
    advance(GAME_CONFIG.flow.completeDelaySec + 0.1);
  };

  it('is a special level outside LEVELS, started only with test mode on, labelled by name', () => {
    expect(benchmark).toBeDefined();
    expect(LEVELS.some((l) => l.id === BENCHMARK_ID)).toBe(false);
    const { game, store } = setup();
    const before = sim.states.length;
    game.startBenchmark();
    expect(sim.states).toHaveLength(before);
    expect(store.get()).toMatchObject({ screen: 'title', benchmark: false });

    game.toggleTestMode();
    game.startBenchmark();
    expect(current().level).toBe(benchmark);
    expect(store.get()).toMatchObject({
      screen: 'playing',
      benchmark: true,
      levelName: benchmark.name,
      racks: true,
      elapsedMs: 0,
      timerStarted: false,
    });
  });

  it('saves nothing: no best time, no unlock, never the "Continuar" level, while the timer still runs', () => {
    const items = withStorage();
    const { game, store } = setup();
    game.toggleTestMode();
    const saved = progressOf(items);
    game.startBenchmark();
    finish();
    expect(store.get().screen).toBe('complete');
    expect(store.get().result).toMatchObject({ isNewBest: false, isLast: false, practice: true });
    expect(store.get().result!.timeMs).toBeGreaterThan(400);
    expect(progressOf(items)).toEqual(saved);

    game.toTitle();
    expect(progressOf(items)).toEqual(saved);
    expect(items.get('toro.progress.v1')).not.toContain(BENCHMARK_ID);
    expect(store.get()).toMatchObject({ screen: 'title', benchmark: false, levelIndex: 0, canContinue: false });
    game.toggleTestMode();
    expect(unlockedCount(store.get().levels)).toBe(1);
    expect(store.get().levels.every((l) => l.bestMs === null)).toBe(true);
  });

  it('R, the HUD restart and "Repetir" on its card reload the Benchmark', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    game.startBenchmark();
    const first = current();
    tap('KeyR', 'r');
    expect(current()).not.toBe(first);
    expect(current().level.id).toBe(BENCHMARK_ID);

    emit({ type: 'firstInput' });
    emit({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    const second = current();
    game.restart();
    expect(current()).not.toBe(second);
    expect(current().level.id).toBe(BENCHMARK_ID);
    expect(store.get()).toMatchObject({ screen: 'playing', benchmark: true, elapsedMs: 0, timerStarted: false });

    finish();
    advance(GAME_CONFIG.flow.confirmGraceSec);
    const before = sim.states.length;
    tap('KeyR', 'r');
    expect(sim.states).toHaveLength(before + 1);
    expect(current().level.id).toBe(BENCHMARK_ID);
    expect(store.get()).toMatchObject({ screen: 'playing', benchmark: true, result: null });
  });

  it('its card leads back to the title (confirm, Esc or the primary button), showing the real "Continuar" level', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    const leaves = [() => tap('Space', ' '), () => tap('Escape', 'Escape'), () => game.nextLevel()];
    for (const leave of leaves) {
      game.startBenchmark();
      finish();
      expect(store.get()).toMatchObject({ screen: 'complete', benchmark: true });
      advance(GAME_CONFIG.flow.confirmGraceSec);
      leave();
      expect(store.get()).toMatchObject({ screen: 'title', benchmark: false, levelIndex: 0, levelName: LEVELS[0].name });
      expect(current().level.id).toBe(LEVELS[0].id);
    }
  });

  it('level jumps ([ / ], PageUp / PageDown) do nothing there, not even held', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    game.startBenchmark();
    const level = current();
    tap('BracketRight', ']');
    tap('BracketLeft', '[');
    tap('PageDown', 'PageDown');
    tap('PageUp', 'PageUp');
    expect(current()).toBe(level);

    emit({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    press('PageDown', 'PageDown');
    advance(GAME_CONFIG.flow.restartHoldSec * 2);
    expect(store.get().restartHold).toBe(0);
    release('PageDown', 'PageDown');
    expect(current()).toBe(level);
    expect(store.get()).toMatchObject({ screen: 'playing', benchmark: true });
  });

  it('Esc keeps it behind the title: "Continuar" or the Benchmark button resume it; a level dot loads that level', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    game.startBenchmark();
    const level = current();
    emit({ type: 'firstInput' });
    emit({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    tap('Escape', 'Escape');
    expect(store.get()).toMatchObject({ screen: 'title', benchmark: true, canContinue: true });

    game.start();
    expect(current()).toBe(level); // same simulation, nothing reloaded
    expect(store.get()).toMatchObject({ screen: 'playing', benchmark: true, timerStarted: true });
    tap('Escape', 'Escape');
    game.startBenchmark();
    expect(current()).toBe(level);

    tap('Escape', 'Escape');
    game.start(0);
    expect(current()).not.toBe(level);
    expect(current().level.id).toBe(LEVELS[0].id);
    expect(store.get()).toMatchObject({ screen: 'playing', benchmark: false, levelIndex: 0 });
  });

  it('turning test mode off with the Benchmark behind the title drops it for the real "Continuar" level', () => {
    const { game, store } = setup();
    game.toggleTestMode();
    game.startBenchmark();
    emit({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    tap('Escape', 'Escape');
    game.toggleTestMode();
    expect(store.get()).toMatchObject({
      screen: 'title',
      testMode: false,
      benchmark: false,
      levelIndex: 0,
      levelName: LEVELS[0].name,
      canContinue: false,
    });
    expect(current().level.id).toBe(LEVELS[0].id);
    game.startBenchmark(); // without test mode (its button is gone) the action does nothing
    expect(store.get().screen).toBe('title');
    game.start();
    expect(current().level.id).toBe(LEVELS[0].id);
    expect(store.get()).toMatchObject({ screen: 'playing', benchmark: false });
  });
});

describe('Game: control hint', () => {
  const rackAt = (levels: number, level = 0) => ({ rackId: 'r1', column: 0, levels, level, slotId: `r1:0:${level}`, ready: false });
  const dropped: GameEvent = {
    type: 'boxDropped',
    boxId: 'b1',
    cell: { x: 1, z: 1 },
    zoneId: null,
    level: 0,
    correct: false,
    recipeLength: 0,
    satisfiedCount: 0,
    total: 1,
  };

  it('publishes the level on screen having racks (the fork row) and nothing ever takes the hint away while playing', () => {
    const click = vi.spyOn(fakes.FakeAudio.prototype, 'forkClick');
    const { game, store } = setup();
    game.start(0);
    advance(0.2);
    expect(store.get()).toMatchObject({ screen: 'playing', racks: hasRacks(LEVELS[0]) });
    game.toTitle();
    game.toggleTestMode();
    game.startBenchmark();
    advance(1 / 60);
    expect(store.get()).toMatchObject({ screen: 'playing', racks: true });

    // Not a fork step that takes effect, a drop, a restart or the next level of a session: the flag only follows
    // the level on screen (the hint itself shows whenever the screen is 'playing').
    sim.rack = rackAt(3, 2);
    advance(1 / 60);
    tap('KeyV', 'v');
    expect(click).toHaveBeenCalledExactlyOnceWith(1, -1);
    emit(dropped);
    expect(store.get()).toMatchObject({ screen: 'playing', racks: true });
    sim.rack = null;
    game.restart();
    advance(0.2);
    expect(store.get()).toMatchObject({ screen: 'playing', racks: true });

    // Esc keeps the Benchmark behind the title (still its level); another level brings its own flag.
    tap('Escape', 'Escape');
    expect(store.get()).toMatchObject({ screen: 'title', racks: true });
    game.start(1);
    expect(store.get()).toMatchObject({ screen: 'playing', racks: hasRacks(LEVELS[1]) });
    click.mockRestore();
  });
});
