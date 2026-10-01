import { describe, expect, it } from 'vitest';
import { GamepadReader, TRIGGER_DEADZONE, type GamepadLike } from './gamepad';

function pad(opts: { index?: number; axes?: number[]; pressed?: number[]; mapping?: string; connected?: boolean } = {}): GamepadLike {
  const pressed = new Set(opts.pressed ?? []);
  return {
    index: opts.index ?? 0,
    connected: opts.connected ?? true,
    mapping: opts.mapping ?? 'standard',
    axes: opts.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.has(i) })),
  };
}

function readerWith(frames: (GamepadLike | null)[][]) {
  let i = 0;
  return new GamepadReader(() => frames[Math.min(i++, frames.length - 1)]);
}

describe('GamepadReader', () => {
  it('reads the left stick with deadzone, screen-up positive', () => {
    const reader = readerWith([[pad({ axes: [0.1, 0.1] })], [pad({ axes: [0, -1] })]]);
    const f1 = reader.read();
    expect(f1.stickX).toBe(0);
    expect(f1.stickY).toBe(0);
    const f2 = reader.read();
    expect(f2.stickY).toBeCloseTo(1);
    expect([f2.dpadX, f2.dpadY]).toEqual([0, 0]);
  });

  it('reports the d-pad as digital input apart from the stick, diagonals normalized', () => {
    const reader = readerWith([[pad({ pressed: [12, 15], axes: [-1, 0] })]]); // up + right, stick left
    const f = reader.read();
    expect(Math.hypot(f.dpadX, f.dpadY)).toBeCloseTo(1);
    expect(f.dpadX).toBeCloseTo(f.dpadY);
    expect(f.dpadX).toBeGreaterThan(0);
    expect(f.stickX).toBeCloseTo(-1);
  });

  it('combines several pads, clamping each source to length 1', () => {
    const reader = readerWith([[pad({ index: 0, axes: [1, 0], pressed: [14] }), pad({ index: 1, axes: [1, 0], pressed: [14] })]]);
    const f = reader.read();
    expect(f.stickX).toBeCloseTo(1);
    expect(f.dpadX).toBeCloseTo(-1);
  });

  it('reports A / LB / RB / Start only on the press edge', () => {
    const held = pad({ pressed: [0, 5, 9] });
    const reader = readerWith([[held], [held], [pad()], [pad({ pressed: [4] })]]);
    const first = reader.read();
    expect(first.actionPressed).toBe(true);
    expect(first.rotateCamera).toBe(1);
    expect(first.confirmPressed).toBe(true);
    const second = reader.read();
    expect(second.actionPressed).toBe(false);
    expect(second.rotateCamera).toBe(0);
    expect(second.confirmPressed).toBe(false);
    reader.read();
    expect(reader.read().rotateCamera).toBe(-1);
  });

  it('reports Back as restart (edge and held) and Y as retry', () => {
    const back = pad({ pressed: [8, 3] });
    const reader = readerWith([[back], [pad({ pressed: [8] })], [pad()]]);
    const first = reader.read();
    expect([first.restartPressed, first.restartHeld, first.retryPressed]).toEqual([true, true, true]);
    const second = reader.read();
    expect([second.restartPressed, second.restartHeld, second.retryPressed]).toEqual([false, true, false]);
    const third = reader.read();
    expect([third.restartPressed, third.restartHeld]).toEqual([false, false]);
  });

  it('tracks edges per pad', () => {
    const reader = readerWith([
      [pad({ index: 0, pressed: [0] }), null],
      [pad({ index: 0, pressed: [0] }), pad({ index: 1, pressed: [0] })],
    ]);
    expect(reader.read().actionPressed).toBe(true);
    expect(reader.read().actionPressed).toBe(true); // second pad's own first press
  });

  it('ignores disconnected / non-standard pads and a missing or throwing API', () => {
    const ignored = readerWith([[pad({ mapping: '', axes: [1, 0], pressed: [15] }), pad({ connected: false, axes: [1, 0] })]]).read();
    expect([ignored.stickX, ignored.dpadX]).toEqual([0, 0]);
    expect(new GamepadReader(() => null).read().stickX).toBe(0);
    const throwing = new GamepadReader(() => {
      throw new Error('blocked');
    });
    expect(throwing.read().actionPressed).toBe(false);
  });
});

/** A standard pad with LT (button 6) / RT (7) pulled this far; `value` left out = a pad that only reports `pressed`. */
function triggers(lt: number, rt: number, opts: { index?: number; noValue?: boolean } = {}): GamepadLike {
  return {
    ...pad({ index: opts.index }),
    buttons: Array.from({ length: 17 }, (_, i) => {
      const value = i === 6 ? lt : i === 7 ? rt : 0;
      return opts.noValue ? { pressed: value > 0.5 } : { pressed: value > 0.5, value };
    }),
  };
}

describe('GamepadReader: camera zoom triggers', () => {
  it('reads RT as closer and LT as further, analog, past a small dead zone rescaled from 0', () => {
    const reader = readerWith([
      [triggers(0, 1)],
      [triggers(1, 0)],
      [triggers(0, 0.55)],
      [triggers(TRIGGER_DEADZONE * 0.5, TRIGGER_DEADZONE)],
      [triggers(0.4, 0.4)],
    ]);
    expect(reader.read().zoom).toBeCloseTo(1);
    expect(reader.read().zoom).toBeCloseTo(-1);
    expect(reader.read().zoom).toBeCloseTo((0.55 - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE));
    expect(reader.read().zoom).toBe(0); // resting triggers do not creep the camera
    expect(reader.read().zoom).toBeCloseTo(0); // both pulled: they cancel
  });

  it('combines pads (clamped to ±1), reads a pad without analog values by its pressed state, and fires no edges', () => {
    const both = readerWith([[triggers(0, 1, { index: 0 }), triggers(0, 1, { index: 1 })]]).read();
    expect(both.zoom).toBe(1);
    const digital = readerWith([[triggers(1, 0, { noValue: true })]]).read();
    expect(digital.zoom).toBe(-1);
    expect([digital.rotateCamera, digital.forkStep, digital.actionPressed]).toEqual([0, 0, false]);
    expect(readerWith([[pad()]]).read().zoom).toBe(0);
  });
});

describe('GamepadReader: fork levels (docs/RACKS.md)', () => {
  it('reports X as one slot up and B as one slot down, only on the press edge', () => {
    const reader = readerWith([[pad({ pressed: [2] })], [pad({ pressed: [2] })], [pad()], [pad({ pressed: [1] })], [pad({ pressed: [1, 2] })]]);
    expect(reader.read().forkStep).toBe(1);
    expect(reader.read().forkStep).toBe(0); // held
    expect(reader.read().forkStep).toBe(0);
    expect(reader.read().forkStep).toBe(-1);
    expect(reader.read().forkStep).toBe(1); // X pressed now, B still held
  });
});
