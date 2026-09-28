/** Helpers shared by the logic tests (not used at runtime). */
import type { GameEvent, GameEventType, InputFrame, LevelData, Vec2 } from '../core/types';
import { validateLevel } from '../data/validateLevel';
import { GAME_CONFIG, type GameConfig } from '../config';
import type { GameState } from './GameState';

export const DT = 1 / 60;
export const IDLE: InputFrame = { move: { x: 0, z: 0 }, actionPressed: false };
export const ACTION: InputFrame = { move: { x: 0, z: 0 }, actionPressed: true };

/** Build a validated level; unspecified fields get small, neutral defaults (7×5, no obstacles). */
export function makeLevel(spec: Record<string, unknown>): LevelData {
  return validateLevel(
    {
      id: 'prueba',
      order: 1,
      name: 'Prueba',
      size: { width: 7, depth: 5 },
      shelves: [],
      decor: { plants: [], windows: [] },
      ...spec,
    },
    'test-level',
  );
}

export function withForklift(overrides: Partial<GameConfig['forklift']>): GameConfig {
  return { ...GAME_CONFIG, forklift: { ...GAME_CONFIG.forklift, ...overrides } };
}

export function move(x: number, z: number, actionPressed = false): InputFrame {
  const len = Math.hypot(x, z);
  return { move: len > 1 ? { x: x / len, z: z / len } : { x, z }, actionPressed };
}

/** Run `seconds` of simulation with a constant input; returns every event emitted. */
export function run(state: GameState, seconds: number, input: InputFrame = IDLE, dt = DT): GameEvent[] {
  const events: GameEvent[] = [];
  const frames = Math.round(seconds / dt);
  for (let i = 0; i < frames; i++) events.push(...state.update(dt, input));
  return events;
}

/** Step until `done()` holds (checked after each frame). Throws if it never happens within `maxSeconds`. */
export function runUntil(
  state: GameState,
  done: () => boolean,
  input: InputFrame,
  maxSeconds = 5,
  dt = DT,
): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < maxSeconds; t += dt) {
    events.push(...state.update(dt, input));
    if (done()) return events;
  }
  throw new Error('runUntil: condition never met');
}

export function press(state: GameState, dt = DT): GameEvent[] {
  return state.update(dt, ACTION);
}

export function types(events: readonly GameEvent[]): GameEventType[] {
  return events.map((e) => e.type);
}

export function forkPoint(state: GameState, reach = GAME_CONFIG.forklift.forkReach): Vec2 {
  const f = state.getSnapshot().forklift;
  return { x: f.pos.x + Math.sin(f.heading) * reach, z: f.pos.z + Math.cos(f.heading) * reach };
}

/** Deterministic pseudo-random generator (LCG) for fuzz tests. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
