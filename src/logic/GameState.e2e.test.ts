import { describe, expect, it } from 'vitest';
import type { GameEvent, InputFrame } from '../core/types';
import { GameState } from './GameState';
import { IDLE, makeLevel, move, types } from './testUtils';
import { Timer } from './Timer';

/** Same layout as the first level: one box two cells ahead, its zone two cells further. */
const firstLevel = () =>
  makeLevel({
    size: { width: 7, depth: 5 },
    forklift: { x: 1, z: 2, heading: 90 },
    boxes: [{ id: 'b1', color: 'blue', x: 3, z: 2 }],
    zones: [{ id: 'z1', color: 'blue', x: 5, z: 2 }],
    decor: { plants: [{ x: 0, z: 0 }], windows: [{ wall: 'north', at: 2, width: 3 }] },
  });

/** Minimal stand-in for Game: timer starts on firstInput, ticks with dt, stops on levelComplete. */
class Session {
  readonly state = new GameState(firstLevel());
  readonly timer = new Timer();
  readonly log: GameEvent[] = [];
  constructor(readonly dt: number) {}

  step(input: InputFrame): GameEvent[] {
    const events = this.state.update(this.dt, input);
    for (const e of events) {
      if (e.type === 'firstInput') this.timer.start();
      if (e.type === 'levelComplete') this.timer.stop();
    }
    this.timer.tick(this.dt);
    this.log.push(...events);
    return events;
  }

  until(done: () => boolean, input: InputFrame, maxSeconds = 5): void {
    for (let t = 0; t < maxSeconds; t += this.dt) {
      this.step(input);
      if (done()) return;
    }
    throw new Error('scripted step never finished');
  }
}

describe.each([1 / 60, 1 / 30, 1 / 20])('end-to-end at dt = %f', (dt) => {
  it('drive to the box, pick, drive to the zone, drop → levelComplete', () => {
    const s = new Session(dt);
    const snap = s.state.getSnapshot();
    const east = move(1, 0);

    // Idle frames: nothing happens, the timer has not started.
    for (let i = 0; i < 10; i++) expect(s.step(IDLE)).toEqual([]);
    expect(s.timer.running).toBe(false);
    expect(snap.hint.targetBoxId).toBeNull();

    // Drive until the box is highlighted, release, coast to rest, pick it up.
    s.until(() => snap.hint.targetBoxId === 'b1', east);
    expect(s.timer.running).toBe(true);
    s.until(() => snap.forklift.speed === 0, IDLE);
    expect(snap.hint.targetBoxId).toBe('b1');
    expect(s.step({ ...IDLE, actionPressed: true })).toEqual([{ type: 'boxPicked', boxId: 'b1', fromZoneId: null, level: 0 }]);

    // Drive toward the zone until the drop preview sits on it, and drop while still rolling.
    s.until(() => snap.hint.dropZoneId === 'z1', east);
    expect(snap.forklift.speed).toBeGreaterThan(0);
    expect(snap.forklift.forkLift).toBeGreaterThan(0.5);
    const done = s.step(move(1, 0, true));
    expect(done).toEqual([
      { type: 'boxDropped', boxId: 'b1', cell: { x: 5, z: 2 }, zoneId: 'z1', level: 0, correct: true, recipeLength: 1, satisfiedCount: 1, total: 1 },
      { type: 'levelComplete' },
    ]);
    expect(snap.completed).toBe(true);
    expect(snap.progress).toEqual({ satisfied: 1, total: 1 });
    const finalMs = s.timer.elapsedMs;
    expect(finalMs).toBeGreaterThan(300);
    expect(finalMs).toBeLessThan(5000);

    // Afterwards: input ignored, the forklift coasts to rest, no more events, timer frozen.
    let prevSpeed = snap.forklift.speed;
    for (let t = 0; t < 2; t += dt) {
      expect(s.step(move(1, 0, true))).toEqual([]);
      expect(snap.forklift.speed).toBeLessThanOrEqual(prevSpeed);
      prevSpeed = snap.forklift.speed;
    }
    expect(snap.forklift.speed).toBe(0);
    expect(snap.forklift.forkLift).toBe(0);
    expect(s.timer.elapsedMs).toBe(finalMs);
    expect(types(s.log)).toEqual(['firstInput', 'boxPicked', 'boxDropped', 'levelComplete']);
  });
});

describe('end-to-end determinism', () => {
  it('replays identically for the same input sequence', () => {
    const script = (state: GameState) => {
      const inputs: InputFrame[] = [];
      for (let i = 0; i < 40; i++) inputs.push(move(1, 0));
      inputs.push({ ...IDLE, actionPressed: true });
      for (let i = 0; i < 50; i++) inputs.push(move(0.7, 0.7));
      inputs.push(move(0, -1, true));
      for (let i = 0; i < 60; i++) inputs.push(move(1, -0.2));
      return inputs.map((input) => types(state.update(1 / 60, input)).join(','));
    };
    const a = new GameState(firstLevel());
    const b = new GameState(firstLevel());
    expect(script(a)).toEqual(script(b));
    expect(a.getSnapshot()).toEqual(b.getSnapshot());
  });
});
