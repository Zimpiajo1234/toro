import { describe, expect, it } from 'vitest';
import { BEEPER, beepFrequency, ReverseBeeper } from './beeper';
import { CLUNK, DRIVE, FORK, MotorSound, ROLL } from './motor';
import { midiToFreq } from './music/harmony';
import { FakeAudioContext, FakeBufferSource, FakeGain, FakeOscillator, type FakeParam } from './testing/fakeAudio';

const FRAME = 1 / 60;

/** Last setTargetAtTime value of a param (what it is gliding to). */
const target = (p: AudioParam | FakeParam): number | undefined =>
  (p as unknown as FakeParam).events.filter((e) => e.kind === 'target').at(-1)?.value;

/** The MotorSound's own nodes (private fields, read for the test only). */
interface MotorInternals {
  drive: FakeOscillator[];
  driveGain: FakeGain;
  driveFilter: { frequency: FakeParam };
  rollGain: FakeGain;
  seamDepth: FakeGain;
  pump: FakeOscillator;
  pumpGain: FakeGain;
  hissGain: FakeGain;
  clunkGain: FakeGain;
  knockGain: FakeGain;
  clunkTone: FakeOscillator;
  beeper: { env: FakeGain; tone: FakeOscillator };
}

function setup(beepHz?: number) {
  const ctx = new FakeAudioContext();
  const out = ctx.createGain();
  const noise = ctx.createBuffer(1, 8000, 8000) as unknown as AudioBuffer;
  const motor = new MotorSound(ctx.asContext(), out as unknown as AudioNode, noise, beepHz);
  const parts = motor as unknown as MotorInternals;
  /** Runs `frames` frames of the given input on the fake audio clock. */
  const run = (frames: number, speed: number, fork = 0, height = 0) => {
    for (let i = 0; i < frames; i++) {
      ctx.currentTime += FRAME;
      motor.set(speed, fork, height);
    }
  };
  return { ctx, out, motor, parts, run };
}

/** Clunk strikes so far: the attack targets of its tone envelope. */
const clunks = (parts: MotorInternals) => parts.clunkGain.gain.events.filter((e) => e.kind === 'target' && e.value > 0);

describe('MotorSound: electric drive', () => {
  it('is completely silent at a standstill: no idle hum, no roll', () => {
    const { parts, run } = setup();
    run(10, 0);
    expect(parts.driveGain.gain.value).toBe(0);
    expect(parts.rollGain.gain.value).toBe(0);
    run(30, 1);
    run(30, 0);
    expect(target(parts.driveGain.gain)).toBe(0);
    expect(target(parts.rollGain.gain)).toBe(0);
    expect(target(parts.seamDepth.gain)).toBe(0); // the tile-joint swell goes with it: never a wobble at rest
  });

  it('whines higher and louder with speed, and brighter: an electric motor, pure sines, no combustion rumble', () => {
    const { parts, run } = setup();
    const at = (speed: number) => {
      run(2, speed);
      return {
        pitch: target(parts.drive[0].frequency)!,
        level: target(parts.driveGain.gain)!,
        roll: target(parts.rollGain.gain)!,
        cutoff: target(parts.driveFilter.frequency)!,
      };
    };
    const crawl = at(0.1);
    const half = at(0.5);
    const full = at(1);
    expect(half.pitch).toBeGreaterThan(crawl.pitch);
    expect(full.pitch).toBeGreaterThan(half.pitch);
    expect(half.level).toBeGreaterThan(crawl.level);
    expect(full.level).toBeGreaterThan(half.level);
    expect(full.roll).toBeGreaterThan(half.roll);
    expect(full.cutoff).toBeGreaterThan(crawl.cutoff);
    expect(full.pitch).toBeCloseTo(DRIVE.topHz, 9);
    expect(full.level).toBeCloseTo(DRIVE.level, 9);
    // Every drive partial is a sine, and even a crawl sits well above an engine's idle rumble (the old 52 Hz hum).
    for (const o of parts.drive) expect(o.type).toBe('sine');
    expect(DRIVE.lowHz).toBeGreaterThanOrEqual(150);
    expect(Math.min(...DRIVE.partials.map(([ratio]) => ratio))).toBe(1);
    // Calm: the whine stays below the low-pass knee region where it would turn shrill.
    expect(DRIVE.topHz * Math.max(...DRIVE.partials.map(([ratio]) => ratio))).toBeLessThan(2000);
  });

  it('reverse whines like forward at the same |speed| (the beeper is what tells them apart)', () => {
    const a = setup();
    a.run(3, 0.4);
    const b = setup();
    b.run(3, -0.4);
    expect(target(b.parts.drive[0].frequency)).toBeCloseTo(target(a.parts.drive[0].frequency)!, 9);
    expect(target(b.parts.driveGain.gain)).toBeCloseTo(target(a.parts.driveGain.gain)!, 9);
  });

  it('tolerates junk input and never sends a parameter it already sent', () => {
    const { parts, run, motor } = setup();
    motor.set(Number.NaN, Number.NaN, Number.NaN);
    motor.set(Infinity, -Infinity, -3);
    run(1, 0.5);
    const events = parts.driveGain.gain.events.length;
    run(20, 0.5); // cruising: no new automation at all
    expect(parts.driveGain.gain.events.length).toBe(events);
    expect(ROLL.seamDepth).toBeLessThanOrEqual(1); // the swell never pulls the roll below silence
  });
});

describe('MotorSound: forks', () => {
  it('whirs the pump going up, a little higher per level; goes down softer, lower and with a light hiss', () => {
    const { parts, run } = setup();
    run(3, 0, 1, 0);
    const upFloor = { pitch: target(parts.pump.frequency)!, level: target(parts.pumpGain.gain)!, hiss: target(parts.hissGain.gain)! };
    expect(upFloor.pitch).toBeCloseTo(FORK.upHz, 9);
    expect(upFloor.level).toBeCloseTo(FORK.upLevel, 9);
    expect(upFloor.hiss).toBe(0);
    run(3, 0, 1, 2);
    expect(target(parts.pump.frequency)).toBeCloseTo(FORK.upHz * (1 + 2 * FORK.perLevel), 9);

    run(3, 0, -1, 1);
    const down = { pitch: target(parts.pump.frequency)!, level: target(parts.pumpGain.gain)!, hiss: target(parts.hissGain.gain)! };
    expect(down.pitch).toBeLessThan(upFloor.pitch);
    expect(down.level).toBeLessThan(upFloor.level);
    expect(down.hiss).toBeGreaterThan(0);
    expect(down.hiss).toBeLessThan(upFloor.level); // light

    // A slow move is still heard (curve < 1), a stop fades out.
    run(3, 0, 0.25, 0);
    expect(target(parts.pumpGain.gain)!).toBeGreaterThan(FORK.upLevel * 0.25);
    run(3, 0, 0, 0);
    expect(target(parts.pumpGain.gain)).toBe(0);
    expect(target(parts.hissGain.gain)).toBe(0);
  });

  it('clunks softly once at the end of a real travel, a touch deeper arriving at the bottom', () => {
    const { parts, run } = setup();
    run(20, 0, 1, 0); // ≈ 0.33 s up
    expect(clunks(parts)).toHaveLength(0); // never while moving
    run(1, 0, 0, 1);
    expect(clunks(parts)).toHaveLength(1);
    const upPitch = parts.clunkTone.frequency.events.find((e) => e.kind === 'set')!.value;
    run(5, 0, 0, 1);
    expect(clunks(parts)).toHaveLength(1); // once per stop

    run(30, 0, -1, 0);
    run(1, 0, 0, 0);
    expect(clunks(parts)).toHaveLength(2);
    const downPitch = parts.clunkTone.frequency.events.filter((e) => e.kind === 'set').at(-1)!.value;
    expect(downPitch).toBeLessThan(upPitch);
    // Tiny and soft: a short decay and a level near the pump's.
    for (const e of parts.clunkGain.gain.events.filter((ev) => ev.kind === 'target' && ev.value === 0)) expect(e.tau!).toBeLessThan(0.08);
    expect(CLUNK.toneLevel).toBeLessThanOrEqual(0.25);
    expect(CLUNK.knockLevel).toBeLessThan(CLUNK.toneLevel);
  });

  it('never clunks after a nudge, twice in quick succession, or while a pick / drop is being marked', () => {
    const { ctx, parts, run, motor } = setup();
    run(3, 0, 1, 0); // 0.05 s: a nudge
    run(1, 0, 0, 0);
    expect(clunks(parts)).toHaveLength(0);
    // Hovering between the thresholds neither starts nor ends a travel.
    run(20, 0, (FORK.movingAt + FORK.stillAt) / 2, 0);
    expect(clunks(parts)).toHaveLength(0);

    motor.hushClunk(ctx.currentTime + CLUNK.hushSec);
    run(20, 0, 1, 0);
    run(1, 0, 0, 0);
    expect(clunks(parts)).toHaveLength(0); // the carry lift after a pickup: the knock already said it
    run(Math.ceil(CLUNK.hushSec / FRAME), 0, 0, 0);
    run(20, 0, -1, 0);
    run(1, 0, 0, 0);
    expect(clunks(parts)).toHaveLength(1);
    run(10, 0, 1, 0); // back up at once, 0.17 s later
    run(1, 0, 0, 0);
    expect(clunks(parts)).toHaveLength(1); // within the gap: no second clunk
  });
});

describe('ReverseBeeper', () => {
  /** Beep onsets scheduled so far (attack targets of the envelope). */
  const onsets = (env: FakeGain) => env.gain.events.filter((e) => e.kind === 'target' && e.value === BEEPER.level).map((e) => e.time);

  it('beeps on a steady on / off rhythm while reversing, starting as reversing starts', () => {
    const { ctx, parts, run } = setup();
    run(10, 0.6); // driving forward: never a beep
    expect(onsets(parts.beeper.env)).toHaveLength(0);
    const start = ctx.currentTime;
    run(1, -0.2);
    const first = onsets(parts.beeper.env);
    expect(first).toHaveLength(1);
    expect(first[0]).toBeCloseTo(start + FRAME + BEEPER.startDelaySec, 9);
    run(Math.round(3 / FRAME), -0.4); // 3 s of reversing
    const times = onsets(parts.beeper.env);
    expect(times.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeCloseTo(BEEPER.periodSec, 9);
    // Each beep ends well before the next: "beep… beep… beep", never a continuous tone.
    const releases = parts.beeper.env.gain.events.filter((e) => e.kind === 'target' && e.value === 0).map((e) => e.time);
    expect(releases).toHaveLength(times.length);
    for (let i = 0; i < times.length; i++) {
      expect(releases[i]).toBeGreaterThan(times[i]);
      const heard = releases[i] + 3 * BEEPER.releaseTau - times[i];
      expect(heard).toBeLessThan(BEEPER.periodSec * 0.6);
    }
    // Scheduled only a little ahead of the clock.
    expect(Math.max(...times)).toBeLessThanOrEqual(ctx.currentTime + BEEPER.lookaheadSec + 1e-9);
  });

  it('stops when the forklift stops or drives forward, fading softly and dropping the queued beeps', () => {
    const { ctx, parts, run, motor } = setup();
    run(60, -0.4);
    expect(motor.reversing).toBe(true);
    run(10, -BEEPER.offSpeed * 2); // slowing but still backing up: keeps beeping
    expect(motor.reversing).toBe(true);
    const beeps = onsets(parts.beeper.env).length;
    const at = ctx.currentTime + FRAME;
    run(1, 0);
    expect(motor.reversing).toBe(false);
    const events = parts.beeper.env.gain.events;
    let hold = events.length - 1;
    while (hold >= 0 && events[hold].kind !== 'hold') hold--;
    expect(events[hold].time).toBeCloseTo(at, 9); // everything after now is dropped…
    expect(events[hold + 1]).toMatchObject({ kind: 'target', value: 0 }); // …and it fades from where it is
    run(120, 0);
    run(60, 0.8);
    expect(onsets(parts.beeper.env)).toHaveLength(beeps);
    // Backing up again starts a fresh rhythm.
    run(1, -0.3);
    expect(onsets(parts.beeper.env)).toHaveLength(beeps + 1);
  });

  it('crossing from forward to reverse starts beeping only once it really moves backwards', () => {
    const { parts, run } = setup();
    run(5, 0.02);
    run(5, -BEEPER.onSpeed / 2); // creeping back, below the start threshold
    expect(onsets(parts.beeper.env)).toHaveLength(0);
    run(1, -BEEPER.onSpeed * 1.5);
    expect(onsets(parts.beeper.env)).toHaveLength(1);
  });

  it('is a soft, round, filtered tone tuned to the song: the tonic of its key, far under a real alarm', () => {
    for (const pc of [0, 2, 3, 5, 7]) {
      const hz = beepFrequency(pc);
      expect(hz).toBeCloseTo(midiToFreq(BEEPER.tonicMidi + pc), 9);
      expect(hz).toBeGreaterThan(500);
      expect(hz).toBeLessThan(1000);
    }
    expect(beepFrequency(14)).toBeCloseTo(beepFrequency(2), 9);
    expect(beepFrequency(Number.NaN)).toBeCloseTo(beepFrequency(0), 9);
    const { parts } = setup(beepFrequency(5));
    expect(parts.beeper.tone.frequency.value).toBeCloseTo(beepFrequency(5), 9);
    expect(parts.beeper.tone.type).toBe('sine');
    expect(BEEPER.lowpassHz).toBeLessThanOrEqual(2000);
    expect(BEEPER.attackTau).toBeGreaterThanOrEqual(0.005); // never a hard click on
    expect(BEEPER.level).toBeLessThan(DRIVE.level * 1.5);
  });

  it('never schedules into the past after a long frame, and does nothing once disposed', () => {
    const ctx = new FakeAudioContext();
    const beeper = new ReverseBeeper(ctx.asContext(), ctx.createGain() as unknown as AudioNode);
    const env = (beeper as unknown as { env: FakeGain }).env;
    beeper.update(-0.5);
    ctx.currentTime += 5; // a stalled tab
    beeper.update(-0.5);
    const times = onsets(env);
    expect(times.at(-1)).toBeGreaterThanOrEqual(5);
    expect(times.filter((t) => t > 0.2 && t < 5)).toHaveLength(0);
    beeper.dispose();
    expect(ctx.ofKind(FakeOscillator).every((o) => o.stoppedAt !== null)).toBe(true);
  });
});

describe('MotorSound lifecycle', () => {
  it('allocates nothing per frame: every node is built once', () => {
    const { ctx, run, motor } = setup();
    const built = ctx.nodes.length;
    for (let i = 0; i < 20; i++) {
      run(15, i % 2 ? 0.9 : -0.45, i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0, i % 4);
      motor.hushClunk(ctx.currentTime + (i % 5 === 0 ? 1 : 0));
    }
    motor.silence();
    expect(ctx.nodes.length).toBe(built);
  });

  it('silence() fades everything, beeper included, without a clunk; dispose stops every source', () => {
    const { ctx, parts, run, motor } = setup();
    run(30, -0.4, 1, 1);
    const before = clunks(parts).length;
    motor.silence();
    expect(motor.reversing).toBe(false);
    expect(target(parts.driveGain.gain)).toBe(0);
    expect(target(parts.pumpGain.gain)).toBe(0);
    expect(clunks(parts)).toHaveLength(before);
    motor.dispose();
    for (const o of ctx.ofKind(FakeOscillator)) expect(o.stoppedAt).not.toBeNull();
    for (const s of ctx.ofKind(FakeBufferSource)) expect(s.stoppedAt).not.toBeNull();
  });

  it('makes its own noise when built without the shared buffer (dev tools)', () => {
    const ctx = new FakeAudioContext();
    const motor = new MotorSound(ctx.asContext(), ctx.createGain() as unknown as AudioNode);
    const [src] = ctx.ofKind(FakeBufferSource);
    expect(src.buffer).not.toBeNull();
    expect(src.loop).toBe(true);
    motor.set(0.5, 0.5, 1);
    motor.dispose();
  });
});
