import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../core/types';
import { GAME_CONFIG } from '../config';
import { parseLevel } from '../data/asciiLevel';
import { BENCHMARK_ID, LEVELS, getSpecialLevel } from '../data/levels';
import { levelMinimum } from '../data/levels/minimums';
import { hasStorage } from '../core/storage';
import { createUIStore } from '../ui/uiState';
import { Game } from './Game';
import { ZOOM_KEY_RATE, ZOOM_TAP_STOPS } from './Input';

/**
 * Flow tests for the orchestrator with the real Input, ProgressStore (memory), levels and flow helpers.
 * Renderer and audio are stubs (no WebGL / Web Audio in Node); the simulation is a scripted stand-in so each
 * test can emit exactly the events it needs (boxPicked, levelComplete…).
 */
const fakes = vi.hoisted(() => {
  const sim = {
    /** Every simulation Game created, oldest first (a new one = the level was (re)loaded). */
    states: [] as {
      level: { id: string };
      inputs: { x: number; z: number; throttle: number; steer: number; action: boolean; forkStep: number }[];
      /** Scripts GameSnapshot.moves (box moves so far; a fresh simulation starts at 0). */
      setMoves(moves: number): void;
      /**
       * Scripts the boxes still to place (logic/objectives reads `left` single-box zones, none done); a fresh simulation
       * has one per zone of its level.
       */
      setObjectivesLeft(left: number): void;
    }[],
    /** Minimums a test overrides (by level id); every other id reads the real precomputed file. */
    minimums: new Map<string, { moves: number; exact: boolean } | null>(),
    /** The level test mode's special button starts instead of the real Benchmark (null: the real one). */
    special: null as unknown,
    /** Events the current simulation emits on its next update. */
    queue: [] as unknown[],
    /** Next GameRenderer construction throws (no WebGL context). */
    failRenderer: false,
    yaw: Math.PI / 4,
    /**
     * `hint.storage` of every simulation's snapshot (null = not at a storage column). A fork step input moves its level
     * within the column, like the real one at a rack.
     */
    storage: null as { unitId: string; skin: 'rack' | 'truck'; column: number; levels: number; level: number; slotId: string; ready: boolean } | null,
    /**
     * Every renderer zoom (zoomBy steps and zoomTrack stops alike), oldest first; the zoomBy steps alone; and how many
     * times resetZoom ran.
     */
    zooms: [] as number[],
    zoomSteps: [] as number[],
    zoomResets: 0,
    /** Every AudioEngine.setReverseBeep call (the «pitido» setting handed to audio), oldest first. */
    beepCalls: [] as boolean[],
    /** Every GameRenderer.setTargetHints call (the «pistas» setting handed to the renderer), oldest first. */
    hintCalls: [] as boolean[],
  };

  /** `left` single-box zones with nothing on them: the objectives counter reads `left`. */
  const targets = (left: number) => Array.from({ length: left }, () => ({ recipe: [null] }));

  class FakeGameState {
    readonly level: { id: string };
    readonly inputs: { x: number; z: number; throttle: number; steer: number; action: boolean; forkStep: number }[] = [];
    private readonly snapshot = {
      forklift: { speed: 0, forkLift: 0 },
      completed: false,
      hint: { storage: sim.storage },
      moves: 0,
      zones: targets(0),
      boxes: [] as { correct: boolean; zoneId: string | null }[],
      storageSlots: [] as { accepts: unknown; satisfied: boolean }[],
    };
    constructor(level: { id: string; zones?: readonly unknown[] }) {
      this.level = level;
      this.snapshot.zones = targets(level.zones?.length ?? 0);
      sim.states.push(this);
    }
    getSnapshot() {
      this.snapshot.hint.storage = sim.storage;
      return this.snapshot;
    }
    setMoves(moves: number) {
      this.snapshot.moves = moves;
    }
    setObjectivesLeft(left: number) {
      this.snapshot.zones = targets(left);
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
      const at = sim.storage;
      if (at && input.forkStep) at.level = Math.max(0, Math.min(at.levels - 1, at.level + input.forkStep));
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
    zoomBy(stops: number) {
      sim.zooms.push(stops);
      sim.zoomSteps.push(stops);
    }
    zoomTrack(stops: number) {
      sim.zooms.push(stops);
    }
    resetZoom() {
      sim.zoomResets++;
    }
    getCameraYaw() {
      return sim.yaw;
    }
    setIdleOrbit() {}
    setTargetHints(on: boolean) {
      sim.hintCalls.push(on);
    }
    dispose() {}
  }

  class FakeAudio {
    unlock() {
      return Promise.resolve();
    }
    uiClick() {}
    setMuted() {}
    setReverseBeep(enabled: boolean) {
      sim.beepCalls.push(enabled);
    }
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
vi.mock('../data/levels', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/levels')>();
  return {
    ...real,
    getSpecialLevel: (id: string) => (fakes.sim.special as ReturnType<typeof real.getSpecialLevel> | null) ?? real.getSpecialLevel(id),
  };
});
vi.mock('../data/levels/minimums', async (importOriginal) => {
  const real = await importOriginal<typeof import('../data/levels/minimums')>();
  return {
    ...real,
    levelMinimum: (id: string) => (fakes.sim.minimums.has(id) ? fakes.sim.minimums.get(id)! : real.levelMinimum(id)),
  };
});

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
  // The canvas host: Input listens to its touches (two-finger pinch zoom).
  game = new Game(new EventTarget() as unknown as HTMLElement, store);
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
  sim.storage = null;
  sim.minimums.clear();
  sim.special = null;
  sim.zooms.length = 0;
  sim.zoomSteps.length = 0;
  sim.zoomResets = 0;
  sim.beepCalls.length = 0;
  sim.hintCalls.length = 0;
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

describe('Game camera zoom', () => {
  const zoomed = () => sim.zooms.reduce((sum, stops) => sum + stops, 0);
  const wheel = (deltaY: number, ctrlKey: boolean) => {
    const ev = new Event('wheel', { cancelable: true });
    Object.assign(ev, { deltaY, deltaX: 0, deltaMode: 0, ctrlKey, metaKey: false });
    win.dispatchEvent(ev);
    return ev;
  };

  it('zooms with + / − while playing (a tap steps, holding goes on), never from the title', () => {
    const { game } = setup();
    tap('Equal', '=');
    advance(0.5);
    expect(sim.zooms).toEqual([]); // the title's idle orbit stays unzoomed
    game.start(0);
    advance(1 / 60);
    tap('NumpadAdd', '+');
    expect(zoomed()).toBeCloseTo(ZOOM_TAP_STOPS + ZOOM_KEY_RATE / 60);
    expect(sim.zoomSteps).toEqual([ZOOM_TAP_STOPS]); // the tap is a step the camera eases in; the held frame is tracked
    sim.zooms.length = 0;
    sim.zoomSteps.length = 0;
    press('Minus', '-');
    advance(0.5);
    release('Minus', '-');
    advance(0.5);
    expect(zoomed()).toBeCloseTo(-ZOOM_TAP_STOPS - ZOOM_KEY_RATE * 0.5, 1);
    expect(sim.zoomSteps).toEqual([-ZOOM_TAP_STOPS]); // holding on is followed as it goes, never a step
  });

  it('Ctrl + wheel while playing (a trackpad pinch) zooms, the plain wheel still steps the forks', () => {
    const { game } = setup();
    expect(wheel(-10, true).defaultPrevented).toBe(false); // title: the browser's own zoom
    game.start(0);
    advance(1 / 60);
    expect(wheel(-10, true).defaultPrevented).toBe(true);
    advance(1 / 60);
    expect(zoomed()).toBeGreaterThan(0);
    expect(sim.zoomSteps).toEqual([]); // a pinch follows the fingers
    expect(current().inputs.at(-1)!.forkStep).toBe(0);
    sim.zooms.length = 0;
    wheel(-100, false);
    advance(1 / 60);
    expect(current().inputs.at(-1)!.forkStep).toBe(1);
    expect(sim.zooms).toEqual([]);
  });

  it('resets the zoom on a level change and on the title, and keeps it across a restart of the same level', () => {
    const { game, store } = setup();
    game.start(0);
    expect(sim.zoomResets).toBe(1);
    game.restart();
    tap('KeyR', 'r');
    expect(sim.states).toHaveLength(4); // mount, start and two restarts
    expect(sim.zoomResets).toBe(1);
    tap('Escape', 'Escape');
    expect(store.get().screen).toBe('title');
    expect(sim.zoomResets).toBe(2);
    game.start(); // "Continuar"
    expect(sim.zoomResets).toBe(3);
    game.toTitle();
    game.toggleTestMode();
    game.startBenchmark();
    expect(sim.zoomResets).toBe(5);
    expect(store.get()).toMatchObject({ screen: 'playing', benchmark: true });
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

  it('B turns the reverse beeper off / on on the title, while playing and on the card, persisted; audio follows', () => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    });
    const savedBeep = () => (JSON.parse(items.get('toro.progress.v1') ?? '{}').settings ?? {}).reverseBeep;
    const first = setup();
    expect(first.store.get().reverseBeep).toBe(true); // on by default
    expect(sim.beepCalls).toEqual([true]); // the saved setting reaches audio at mount
    tap('KeyB', 'b'); // on the title
    expect(first.store.get().reverseBeep).toBe(false);
    expect(sim.beepCalls.at(-1)).toBe(false);
    expect(savedBeep()).toBe(false);
    first.game.start(0);
    tap('KeyB', 'b'); // while playing
    expect(first.store.get()).toMatchObject({ screen: 'playing', reverseBeep: true });
    expect(sim.beepCalls.at(-1)).toBe(true);
    expect(savedBeep()).toBe(true);
    // Its own setting: T and M leave it alone, and it leaves them alone.
    tap('KeyT', 't');
    tap('KeyM', 'm');
    expect(first.store.get()).toMatchObject({ reverseBeep: true, showTimer: false, muted: true, showMoves: true });
    tap('KeyB', 'b');
    expect(first.store.get()).toMatchObject({ reverseBeep: false, showTimer: false, muted: true });
    // On the completion card too, like T / N.
    emit({ type: 'firstInput' });
    emit({ type: 'levelComplete' });
    advance(GAME_CONFIG.flow.completeDelaySec + 0.1);
    expect(first.store.get().screen).toBe('complete');
    tap('KeyB', 'b');
    expect(first.store.get()).toMatchObject({ screen: 'complete', reverseBeep: true });
    first.game.toggleReverseBeep(); // the action itself (GameActions)
    expect(first.store.get().reverseBeep).toBe(false);
    expect(sim.beepCalls.slice(1)).toEqual([false, true, false, true, false]);
    first.game.dispose();

    sim.beepCalls.length = 0;
    const second = setup();
    expect(second.store.get()).toMatchObject({ reverseBeep: false, showTimer: false, muted: true });
    expect(sim.beepCalls).toEqual([false]);
  });

  it('a save from before the reverse beep toggle loads with the beep on', () => {
    savedGame({ rankings: {}, highestUnlocked: 0, lastLevel: 0 }); // settings: muted and showTimer only
    const { store } = setup();
    expect(store.get()).toMatchObject({ reverseBeep: true, muted: false, showTimer: true });
    expect(sim.beepCalls).toEqual([true]);
  });

  it('P turns the target hints on / off on the title, while playing and on the card, persisted; the renderer follows', () => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    });
    const savedHints = () => (JSON.parse(items.get('toro.progress.v1') ?? '{}').settings ?? {}).targetHints;
    const first = setup();
    expect(first.store.get().targetHints).toBe(false); // off by default: pure deduction
    expect(sim.hintCalls).toEqual([false]); // the saved setting reaches the renderer at mount
    tap('KeyP', 'p'); // on the title (the footer wording answers)
    expect(first.store.get()).toMatchObject({ screen: 'title', targetHints: true });
    expect(sim.hintCalls.at(-1)).toBe(true);
    expect(savedHints()).toBe(true);
    first.game.start(0);
    const loads = sim.states.length;
    tap('KeyP', 'p'); // while playing (the notice pill answers): the level on screen is kept, only its lights change
    expect(first.store.get()).toMatchObject({ screen: 'playing', targetHints: false });
    expect(sim.states).toHaveLength(loads);
    expect(sim.hintCalls.at(-1)).toBe(false);
    expect(savedHints()).toBe(false);
    // Its own setting: B, T and M leave it alone, and it leaves them alone.
    tap('KeyB', 'b');
    tap('KeyT', 't');
    tap('KeyM', 'm');
    expect(first.store.get()).toMatchObject({ targetHints: false, reverseBeep: false, showTimer: false, muted: true, showMoves: true });
    tap('KeyP', 'p');
    expect(first.store.get()).toMatchObject({ targetHints: true, reverseBeep: false, showTimer: false, muted: true });
    // On the completion card too, like B / T / N.
    emit({ type: 'firstInput' });
    emit({ type: 'levelComplete' });
    advance(GAME_CONFIG.flow.completeDelaySec + 0.1);
    expect(first.store.get().screen).toBe('complete');
    tap('KeyP', 'p');
    expect(first.store.get()).toMatchObject({ screen: 'complete', targetHints: false });
    first.game.toggleHints(); // the action itself (GameActions)
    expect(first.store.get().targetHints).toBe(true);
    expect(sim.hintCalls.slice(1)).toEqual([true, false, true, false, true]);
    first.game.dispose();

    sim.hintCalls.length = 0;
    const second = setup();
    expect(second.store.get()).toMatchObject({ targetHints: true, reverseBeep: false, muted: true });
    expect(sim.hintCalls).toEqual([true]);
  });

  it('a save from before the hints toggle loads with the hints off', () => {
    savedGame({ rankings: {}, highestUnlocked: 0, lastLevel: 0, settings: { muted: false, showTimer: true, reverseBeep: false } });
    const { store } = setup();
    expect(store.get()).toMatchObject({ targetHints: false, reverseBeep: false, muted: false });
    expect(sim.hintCalls).toEqual([false]);
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
      storage: true,
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
  const rackAt = (levels: number, level = 0) => ({ unitId: 'r1', skin: 'rack' as const, column: 0, levels, level, slotId: `r1:0:${level}`, ready: false });
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

  it('publishes the level on screen having storage (the fork row: the forks go by the keys at every unit); nothing takes the hint away while playing', () => {
    const click = vi.spyOn(fakes.FakeAudio.prototype, 'forkClick');
    const { game, store } = setup();
    game.start(0);
    advance(0.2);
    expect(store.get()).toMatchObject({ screen: 'playing', storage: hasStorage(LEVELS[0]) });
    game.toTitle();
    game.toggleTestMode();
    game.startBenchmark();
    advance(1 / 60);
    expect(store.get()).toMatchObject({ screen: 'playing', storage: true });

    // Not a fork step that takes effect, a drop, a restart or the next level of a session: the flag only follows
    // the level on screen (the hint itself shows whenever the screen is 'playing').
    sim.storage = rackAt(3, 2);
    advance(1 / 60);
    tap('KeyV', 'v');
    expect(click).toHaveBeenCalledExactlyOnceWith(1, -1);
    // At a truck too (docs/STORAGE.md rule 9): its forks go by the keys, a step that takes effect clicks the same way.
    sim.storage = { ...rackAt(2, 1), unitId: 't1', skin: 'truck', slotId: 't1:0:1' };
    advance(1 / 60);
    tap('KeyV', 'v');
    expect(click).toHaveBeenLastCalledWith(0, -1);
    expect(click).toHaveBeenCalledTimes(2);
    emit(dropped);
    expect(store.get()).toMatchObject({ screen: 'playing', storage: true });
    sim.storage = null;
    game.restart();
    advance(0.2);
    expect(store.get()).toMatchObject({ screen: 'playing', storage: true });

    // Esc keeps the Benchmark behind the title (still its level); another level brings its own flag.
    tap('Escape', 'Escape');
    expect(store.get()).toMatchObject({ screen: 'title', storage: true });
    game.start(1);
    expect(store.get()).toMatchObject({ screen: 'playing', storage: hasStorage(LEVELS[1]) });
    click.mockRestore();
  });

  it('a level with trucks only has the fork row too: a step at its truck clicks, and it restarts a paused clock', () => {
    // docs/STORAGE.md rule 9: the forks go by the keys at every unit, so storage of any skin brings the fork keys.
    const TRUCK_ONLY = parseLevel(
      ['# 101 · Solo camión', 'id: solo-camion', 'limit: 2', '', '  0123', '0 pTp.', '1 ....', '2 .a..', '3 .^..', '', 'a = caja azul', 'T = camión muelle norte: azul', ''].join(
        '\n',
      ),
    ).level;
    expect(hasStorage(TRUCK_ONLY)).toBe(true);
    const click = vi.spyOn(fakes.FakeAudio.prototype, 'forkClick');
    sim.special = TRUCK_ONLY;
    const { game, store } = setup();
    game.toggleTestMode();
    game.startBenchmark();
    advance(1 / 60);
    expect(current().level).toBe(TRUCK_ONLY);
    expect(store.get()).toMatchObject({ screen: 'playing', storage: true });
    sim.storage = { unitId: 't1', skin: 'truck', column: 0, levels: 2, level: 0, slotId: 't1:0:0', ready: false };
    advance(1 / 60);
    tap('KeyF', 'f');
    expect(click).toHaveBeenCalledExactlyOnceWith(1, 1);
    // Paused behind the title and resumed: a fork step is an input that restarts the clock there.
    emit({ type: 'firstInput' });
    advance(0.5);
    tap('Escape', 'Escape');
    game.start();
    const paused = store.get().elapsedMs;
    tap('KeyV', 'v');
    advance(1);
    expect(store.get().elapsedMs).toBeGreaterThan(paused + 800);
    expect(click).toHaveBeenLastCalledWith(0, -1);
    click.mockRestore();
  });
});

describe('Game: move counter', () => {
  const KEY = 'toro.progress.v1';
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
  const saved = (items: Map<string, string>) => JSON.parse(items.get(KEY) ?? '{}') as Record<string, unknown>;
  /** Plays the level on screen to its card in `moves` box moves (the count lands with the final drop). */
  const finishIn = (moves: number) => {
    emit({ type: 'firstInput' });
    advance(0.5);
    current().setMoves(moves);
    emit({ type: 'levelComplete' });
    advance(GAME_CONFIG.flow.completeDelaySec + 0.1);
  };

  it('publishes the simulation count; a new attempt starts over at 0, a resumed one keeps it', () => {
    const { game, store } = setup();
    game.start(0);
    expect(store.get()).toMatchObject({ moves: 0, finished: false });
    current().setMoves(2);
    advance(1 / 60);
    expect(store.get().moves).toBe(2);

    tap('Escape', 'Escape'); // suspended behind the title
    game.start();
    expect(store.get().moves).toBe(2);

    current().setMoves(3);
    advance(1 / 60);
    game.restart();
    expect(store.get().moves).toBe(0);
    current().setMoves(1);
    advance(1 / 60);
    game.toTitle();
    game.start(1);
    expect(store.get().moves).toBe(0);
  });

  it('publishes the precomputed minimum of the level on screen (the Benchmark too), never solving anything', () => {
    const { game, store } = setup();
    for (let i = 0; i < LEVELS.length; i++) {
      game.toTitle();
      game.toggleTestMode();
      game.start(i);
      expect(store.get().minMoves).toBe(levelMinimum(LEVELS[i].id));
      expect(store.get().minMoves).not.toBeNull();
      game.toTitle();
      game.toggleTestMode();
    }
    game.toggleTestMode();
    game.startBenchmark();
    expect(store.get().minMoves).toEqual(levelMinimum(BENCHMARK_ID));
    expect(store.get().minMoves).not.toBeNull();
  });

  it('a lower bound is shown unless moves.showLowerBound is off; an unknown minimum shows none', () => {
    const id = LEVELS[0].id;
    const bound = { moves: 9, exact: false };
    const setting = GAME_CONFIG.moves.showLowerBound;
    try {
      sim.minimums.set(id, bound);
      const { game, store } = setup();
      game.start(0);
      expect(store.get().minMoves).toEqual(bound);
      GAME_CONFIG.moves.showLowerBound = false;
      game.restart();
      expect(store.get().minMoves).toBeNull();
      sim.minimums.set(id, { moves: 9, exact: true });
      game.restart();
      expect(store.get().minMoves).toEqual({ moves: 9, exact: true });
      sim.minimums.set(id, null);
      game.restart();
      expect(store.get().minMoves).toBeNull();
    } finally {
      GAME_CONFIG.moves.showLowerBound = setting;
    }
  });

  it('N shows / hides it (shown by default), on the title and while playing, persisted like the timer', () => {
    const items = withStorage();
    const first = setup();
    expect(first.store.get().showMoves).toBe(true);
    tap('KeyN', 'n');
    expect(first.store.get().showMoves).toBe(false);
    expect((saved(items).settings as Record<string, unknown>).showMoves).toBe(false);
    first.game.start(0);
    tap('KeyN', 'n');
    expect(first.store.get().showMoves).toBe(true);
    // T is its own setting.
    tap('KeyT', 't');
    expect(first.store.get()).toMatchObject({ showMoves: true, showTimer: false });
    first.game.toggleMoves(); // the HUD pill's click
    first.game.dispose();

    const second = setup();
    expect(second.store.get()).toMatchObject({ showMoves: false, showTimer: false });
  });

  it('the card gets the moves and minimum; the first clear sets the record, only fewer moves beat it', () => {
    const items = withStorage();
    const { game, store } = setup();
    const id = LEVELS[0].id;
    const min = levelMinimum(id);
    game.start(0);
    finishIn(5);
    expect(store.get()).toMatchObject({ screen: 'complete', finished: true, moves: 5 });
    expect(store.get().result).toMatchObject({ moves: 5, bestMoves: 5, isNewBestMoves: false, minMoves: min, practice: false });
    expect(saved(items).bestMoves).toEqual({ [id]: 5 });

    game.restart();
    expect(store.get()).toMatchObject({ moves: 0, finished: false, result: null });
    finishIn(7);
    expect(store.get().result).toMatchObject({ moves: 7, bestMoves: 5, isNewBestMoves: false });

    game.restart();
    finishIn(4);
    expect(store.get().result).toMatchObject({ moves: 4, bestMoves: 4, isNewBestMoves: true });
    expect(saved(items).bestMoves).toEqual({ [id]: 4 });
    // Hiding the counter hides it, never stops the record.
    game.toggleMoves();
    game.restart();
    finishIn(3);
    expect(store.get().result).toMatchObject({ bestMoves: 3, isNewBestMoves: true });
  });

  it('the Benchmark saves no move record (nor any other); its card still gets its moves and minimum', () => {
    const items = withStorage();
    const { game, store } = setup();
    game.toggleTestMode();
    const before = { ...saved(items) };
    delete before.settings;
    game.startBenchmark();
    finishIn(16);
    expect(store.get().result).toMatchObject({
      moves: 16,
      bestMoves: null,
      isNewBestMoves: false,
      minMoves: levelMinimum(BENCHMARK_ID),
      practice: true,
    });
    const after = { ...saved(items) };
    delete after.settings;
    expect(after).toEqual(before);
    expect(items.get(KEY)).not.toContain(BENCHMARK_ID);
  });

  it('a level only test mode opened records no moves either', () => {
    const items = withStorage();
    const { game, store } = setup();
    game.toggleTestMode();
    game.start(LEVELS.length - 1);
    finishIn(6);
    expect(store.get().result).toMatchObject({ moves: 6, bestMoves: null, practice: true });
    expect(saved(items).bestMoves ?? {}).toEqual({});
  });

  it('a save from before the move counter loads fine: counter shown, no records, progress kept', () => {
    const items = withStorage();
    items.set(
      KEY,
      JSON.stringify({
        version: 1,
        rankings: { [LEVELS[0].id]: [40_000] },
        highestUnlocked: 1,
        lastLevel: 1,
        lastLevelId: LEVELS[1].id,
        settings: { muted: false, showTimer: true, testMode: false },
      }),
    );
    const { game, store } = setup();
    expect(store.get()).toMatchObject({ showMoves: true, canContinue: true, levelIndex: 1 });
    game.start(0);
    finishIn(4);
    // A first move record: nothing to beat yet, so no "✦ nuevo récord" on the card.
    expect(store.get().result).toMatchObject({ moves: 4, bestMoves: 4, isNewBestMoves: false });
    // The old time is still there, next to the new one.
    expect((saved(items).rankings as Record<string, number[]>)[LEVELS[0].id]).toContain(40_000);
  });
});

describe('Game: objectives counter', () => {
  const KEY = 'toro.progress.v1';
  const withStorage = () => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
      removeItem: (k: string) => void items.delete(k),
    });
    return items;
  };
  const savedSettings = (items: Map<string, string>) => (JSON.parse(items.get(KEY) ?? '{}').settings ?? {}) as Record<string, unknown>;
  const drop: GameEvent = { type: 'boxDropped', boxId: 'b1', cell: { x: 1, z: 1 }, zoneId: null, level: 0, correct: false, recipeLength: 0, satisfiedCount: 0, total: 2 };

  it('publishes the boxes still to place as a level loads, and again after a pick or a drop; a resumed level keeps them', () => {
    const { game, store } = setup();
    expect(store.get().objectivesLeft).toBe(LEVELS[0].zones.length); // the level behind the title
    game.start(1);
    expect(store.get().objectivesLeft).toBe(LEVELS[1].zones.length);
    expect(LEVELS[1].zones.length).toBe(2);
    // Only a pick or a drop changes the count: a quiet frame does not even read it.
    current().setObjectivesLeft(1);
    advance(0.5);
    expect(store.get().objectivesLeft).toBe(2);
    emit(drop);
    expect(store.get().objectivesLeft).toBe(1);
    current().setObjectivesLeft(2);
    emit({ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 });
    expect(store.get().objectivesLeft).toBe(2);
    current().setObjectivesLeft(1);
    emit(drop);

    tap('Escape', 'Escape'); // suspended behind the title, as it was
    expect(store.get().objectivesLeft).toBe(1);
    game.start();
    expect(store.get().objectivesLeft).toBe(1);
    game.restart(); // a fresh attempt: every box to place again
    expect(store.get().objectivesLeft).toBe(2);
    game.toTitle();
    game.start(2);
    expect(store.get().objectivesLeft).toBe(LEVELS[2].zones.length);
  });

  it('reaches 0 with the final drop, through the celebration and the card', () => {
    const { game, store } = setup();
    game.start(0);
    expect(store.get().objectivesLeft).toBe(1);
    emit({ type: 'firstInput' });
    current().setObjectivesLeft(0);
    emit({ ...drop, correct: true, recipeLength: 1, satisfiedCount: 1, total: 1 }, { type: 'levelComplete' });
    expect(store.get()).toMatchObject({ screen: 'playing', objectivesLeft: 0, finished: true });
    advance(GAME_CONFIG.flow.completeDelaySec + 0.1);
    expect(store.get()).toMatchObject({ screen: 'complete', objectivesLeft: 0 });
  });

  it('O shows / hides it (shown by default), on the title, while playing and on the card, persisted like the timer', () => {
    const items = withStorage();
    const first = setup();
    expect(first.store.get().showObjectives).toBe(true);
    tap('KeyO', 'o'); // on the title
    expect(first.store.get().showObjectives).toBe(false);
    expect(savedSettings(items).showObjectives).toBe(false);
    first.game.start(0);
    const loads = sim.states.length;
    tap('KeyO', 'o'); // while playing: the level on screen is kept
    expect(first.store.get()).toMatchObject({ screen: 'playing', showObjectives: true });
    expect(sim.states).toHaveLength(loads);
    expect(savedSettings(items).showObjectives).toBe(true);
    // Its own setting: T and N leave it alone, and it leaves them alone.
    tap('KeyT', 't');
    tap('KeyN', 'n');
    expect(first.store.get()).toMatchObject({ showObjectives: true, showTimer: false, showMoves: false });
    tap('KeyO', 'o');
    expect(first.store.get()).toMatchObject({ showObjectives: false, showTimer: false, showMoves: false });
    // On the completion card too, like T / N.
    emit({ type: 'firstInput' });
    emit({ type: 'levelComplete' });
    advance(GAME_CONFIG.flow.completeDelaySec + 0.1);
    expect(first.store.get().screen).toBe('complete');
    tap('KeyO', 'o');
    expect(first.store.get()).toMatchObject({ screen: 'complete', showObjectives: true });
    first.game.toggleObjectives(); // the HUD pill's click
    expect(first.store.get().showObjectives).toBe(false);
    first.game.dispose();

    const second = setup();
    expect(second.store.get()).toMatchObject({ showObjectives: false, showTimer: false, showMoves: false });
  });

  it('a save from before the objectives counter loads with it shown, everything else kept', () => {
    savedGame({ rankings: {}, highestUnlocked: 0, lastLevel: 0, settings: { muted: true, showTimer: false, showMoves: false } });
    const { store } = setup();
    expect(store.get()).toMatchObject({ showObjectives: true, muted: true, showTimer: false, showMoves: false });
  });
});
