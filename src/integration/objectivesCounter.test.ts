/**
 * Integration check (objectives counter × logic × autopilot): the autopilot (./autopilot.ts) plays level 3, the
 * Benchmark and the three-truck fixture to the end with the real GameState, read after every frame. The HUD's «Quedan
 * N» (logic/objectives) starts at every box still to place, moves by one only on a frame with a pick or a drop, never
 * goes back up where a placed box locks (levels with storage: there it is always the targets left), and reaches 0 on the
 * very frame the level completes, never before.
 */
import { describe, expect, it, vi } from 'vitest';
import { hasStorage } from '../core/storage';
import type { GameEvent, InputFrame, LevelData } from '../core/types';
import { parseLevel } from '../data/asciiLevel';
import { BENCHMARK_ID, LEVELS, getSpecialLevel } from '../data/levels';
import { GameState } from '../logic/GameState';
import { objectivesLeft } from '../logic/objectives';
import { autopilot } from './autopilot';
import threeTrucksText from '../data/levels/pruebas/tres-camiones.level?raw';

/** Every frame the simulation stepped since the last reset: the count after it, and what happened in it. */
const frames = vi.hoisted(() => [] as { left: number; targetsLeft: number; acted: boolean; completed: boolean }[]);

vi.mock('../logic/GameState', async (importOriginal) => {
  const real = await importOriginal<typeof import('../logic/GameState')>();
  const { objectivesLeft: count } = await import('../logic/objectives');
  /** The real simulation, its objectives counted after every step. */
  class RecordedGameState extends real.GameState {
    update(dt: number, input: InputFrame): GameEvent[] {
      const events = super.update(dt, input);
      const snap = this.getSnapshot();
      frames.push({
        left: count(snap),
        targetsLeft: snap.progress.total - snap.progress.satisfied,
        acted: events.some((e) => e.type === 'boxPicked' || e.type === 'boxDropped'),
        completed: snap.completed,
      });
      return events;
    }
  }
  return { ...real, GameState: RecordedGameState };
});

const threeTrucks = parseLevel(threeTrucksText, 'src/data/levels/pruebas/tres-camiones.level').level;

describe('the objectives counter over whole levels played with the real controls', () => {
  it.each([
    ['level 3', LEVELS.find((l) => l.order === 3)!, 3],
    ['the Benchmark', getSpecialLevel(BENCHMARK_ID)!, 12],
    ['the three-truck fixture', threeTrucks, null],
  ] as [string, LevelData, number | null][])('%s: from every box still to place down to 0 as it completes', (_, level, boxes) => {
    const fresh = new GameState(level).getSnapshot();
    const start = objectivesLeft(fresh);
    const storage = hasStorage(level);
    if (boxes !== null) expect(start).toBe(boxes);
    // With storage, the targets not yet satisfied (one box each; a box loaded on its destiny is already done).
    if (storage) expect(start).toBe(fresh.progress.total - fresh.progress.satisfied);
    frames.length = 0;
    const out = autopilot(level, 1 / 60);
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    expect(frames.length).toBeGreaterThan(100);

    let before = start;
    let down = 0;
    let up = 0;
    for (const frame of frames) {
      expect(frame.left).toBeGreaterThanOrEqual(0);
      if (storage) expect(frame.left).toBe(frame.targetsLeft);
      // 0 exactly from the completing frame on.
      expect(frame.left === 0).toBe(frame.completed);
      if (frame.left !== before) {
        expect(frame.acted).toBe(true);
        expect(Math.abs(frame.left - before)).toBe(1);
        if (frame.left < before) down++;
        else up++;
      }
      before = frame.left;
    }
    expect(before).toBe(0);
    expect(down - up).toBe(start);
    // A box put in its place there locks for good (docs/STORAGE.md rule 5): the count never goes back up.
    if (storage) expect(up).toBe(0);
  });
});
