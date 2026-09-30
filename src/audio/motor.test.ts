import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import type { ForkliftState } from '../core/types';
import { speed01 } from '../game/motor';
import type { CollisionWorld } from '../logic/collision';
import { ForkliftController } from '../logic/forklift';
import { BEEPER, beepFrequency, ReverseBeeper } from './beeper';
import { CLUNK, DRIVE, FORK, MotorSound, ROLL } from './motor';
import { midiToFreq } from './music/harmony';
import { FakeAudioContext, FakeBufferSource, FakeGain, FakeOscillator, type FakeParam, type ParamEvent } from './testing/fakeAudio';

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
  beeper: { env: FakeGain; octaveEnv: FakeGain; tone: FakeOscillator; octave: FakeOscillator };
}

function setup(beepHz?: number, beepOut?: FakeGain) {
  const ctx = new FakeAudioContext();
  const out = ctx.createGain();
  const noise = ctx.createBuffer(1, 8000, 8000) as unknown as AudioBuffer;
  const motor = new MotorSound(ctx.asContext(), out as unknown as AudioNode, noise, beepHz, beepOut as unknown as AudioNode | undefined);
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

/**
 * Value at `t` of a gain driven only by setTargetAtTime (how the beeper strikes and decays): each target starts from
 * wherever the previous one had got to. The events are in time order; a hold (a stop) ends the curve.
 */
function targetCurve(events: readonly ParamEvent[], t: number): number {
  let v = 0;
  let from = 0;
  let goal = 0;
  let tau = 1;
  for (const e of events) {
    if (e.kind !== 'target' || e.time > t) break;
    v = goal + (v - goal) * Math.exp(-(e.time - from) / tau);
    from = e.time;
    goal = e.value;
    tau = e.tau ?? 1;
  }
  return goal + (v - goal) * Math.exp(-(t - from) / tau);
}

/** The back-up alarm this beep replaces (01eb8bc, "too industrial"): a sine held at 0.1 with a 3rd harmonic at 0.16. */
const OLD_ALARM = { level: 0.1, harmonic: 0.16 } as const;

describe('ReverseBeeper', () => {
  /** Beep onsets scheduled so far (attack targets of the envelope). */
  const onsets = (env: FakeGain) => env.gain.events.filter((e) => e.kind === 'target' && e.value === BEEPER.level).map((e) => e.time);

  it('beeps once per beat while reversing, starting as reversing starts; each beep a strike that decays on its own', () => {
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
    // Each strike is followed at once by its natural decay: nothing is held (a chime, never a sustained alarm tone).
    const decays = parts.beeper.env.gain.events.filter((e) => e.kind === 'target' && e.value === 0);
    expect(decays).toHaveLength(times.length);
    for (let i = 0; i < times.length; i++) {
      expect(decays[i].time).toBeCloseTo(times[i] + 3 * BEEPER.attackTau, 9);
      expect(decays[i].tau).toBe(BEEPER.decayTau);
    }
    // The octave strikes with every beep and fades faster.
    const octave = parts.beeper.octaveEnv.gain.events.filter((e) => e.kind === 'target');
    expect(octave.filter((e) => e.value === BEEPER.octave).map((e) => e.time)).toEqual(times);
    for (const e of octave.filter((ev) => ev.value === 0)) expect(e.tau).toBe(BEEPER.octaveDecayTau);
    // Scheduled only a little ahead of the clock.
    expect(Math.max(...times)).toBeLessThanOrEqual(ctx.currentTime + BEEPER.lookaheadSec + 1e-9);
  });

  it('is a soft "tin": a quick gentle rise, ≈ 0.3 s of ring, silent long before the next beat, 5–8 dB under the old alarm', () => {
    const { parts, run } = setup();
    run(1, -0.4); // one beep (the next is beyond the lookahead)
    const [t0] = onsets(parts.beeper.env);
    const env = parts.beeper.env.gain.events;
    const oct = parts.beeper.octaveEnv.gain.events;
    const at = (s: number) => targetCurve(env, t0 + s);
    // No jump at the onset (no click), the peak within ≈ 15 ms, then only decay.
    expect(at(0)).toBe(0);
    expect(at(0.001)).toBeLessThan(0.25 * BEEPER.level);
    expect(3 * BEEPER.attackTau).toBeLessThanOrEqual(0.02);
    const peak = at(3 * BEEPER.attackTau);
    expect(peak).toBeGreaterThan(0.9 * BEEPER.level);
    for (let s = 0.03; s < BEEPER.periodSec; s += 0.01) expect(at(s)).toBeLessThan(at(s - 0.01));
    // It rings ≈ 0.3 s (down 26 dB, to 1/20, between 0.2 and 0.4 s) and is ≈ 60 dB down before the next beat.
    let ring = 0;
    while (at(ring) > peak / 20 || ring < 3 * BEEPER.attackTau) ring += 0.001;
    expect(ring).toBeGreaterThan(0.2);
    expect(ring).toBeLessThan(0.4);
    expect(at(BEEPER.periodSec - 0.001) / peak).toBeLessThan(1e-3);
    // The octave is the brief glassy "t" of the strike: under a quarter of its own peak after 0.1 s.
    const octaveAt = (s: number) => targetCurve(oct, t0 + s);
    expect(octaveAt(0.1)).toBeLessThan(0.25 * octaveAt(3 * BEEPER.attackTau));
    // Its loudest 100 ms carry 5–8 dB less than the old alarm's (tone and harmonic held through them). Rendered
    // offline and K-weighted (dev/audioPreview toroLevels()) that is ≈ 6 dB: −31.5 against −25.2 LUFS.
    const power = (s: number) => {
      const a = at(s);
      const o = a * octaveAt(s);
      return (a * a + o * o) / 2;
    };
    let loudest = 0;
    for (let from = -0.02; from <= 0.05; from += 0.005) {
      let energy = 0;
      for (let s = from; s < from + 0.1; s += 1e-4) energy += power(s) * 1e-4;
      loudest = Math.max(loudest, energy);
    }
    const old = ((OLD_ALARM.level ** 2 + (OLD_ALARM.level * OLD_ALARM.harmonic) ** 2) / 2) * 0.1;
    const db = 10 * Math.log10(loudest / old);
    expect(db).toBeGreaterThan(-8);
    expect(db).toBeLessThan(-5);
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
    expect(events[hold + 1]).toMatchObject({ kind: 'target', value: 0, tau: BEEPER.releaseTau }); // …and it fades from where it is
    // The octave goes with it.
    expect(parts.beeper.octaveEnv.gain.events.slice(-2)).toMatchObject([
      { kind: 'hold', time: at },
      { kind: 'target', value: 0, tau: BEEPER.releaseTau },
    ]);
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

  it('is a sweet, round tone always in key: the tonic or fifth nearest F♯5, a sine with a faint octave, nothing odd', () => {
    for (let pc = 0; pc < 12; pc++) {
      const hz = beepFrequency(pc);
      expect(hz).toBeGreaterThan(600);
      expect(hz).toBeLessThan(900);
      const midi = Math.round(69 + 12 * Math.log2(hz / 440));
      expect(midiToFreq(midi)).toBeCloseTo(hz, 9); // an exact note of the key…
      expect([0, 7]).toContain((((midi - pc) % 12) + 12) % 12); // …its tonic or its fifth, consonant over any chord
    }
    // The composer's keys (F, E♭, D, G, C): F5, E♭5, A5, G5, G5, in the middle of the melody's range, never piercing.
    expect([5, 3, 2, 7, 0].map((pc) => Math.round(beepFrequency(pc)))).toEqual([698, 622, 880, 784, 784]);
    expect(beepFrequency(14)).toBeCloseTo(beepFrequency(2), 9);
    expect(beepFrequency(Number.NaN)).toBeCloseTo(beepFrequency(0), 9);

    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    const hz = beepFrequency(5);
    const beeper = new ReverseBeeper(ctx.asContext(), out as unknown as AudioNode, hz);
    const { tone, octave, env, octaveEnv } = beeper as unknown as MotorInternals['beeper'];
    // Exactly two sines, phase-locked (they start together): the tone and its octave. No odd harmonic, no buzz.
    const oscillators = ctx.ofKind(FakeOscillator);
    expect(oscillators.map((o) => o.type)).toEqual(['sine', 'sine']);
    expect(oscillators.map((o) => o.frequency.value / hz)).toEqual([1, 2]);
    expect(tone.frequency.value).toBeCloseTo(hz, 9);
    expect(octave.startedAt).toBe(tone.startedAt);
    // The octave rides under the beep's own envelope (one gate for the whole sound), faint, and fades faster.
    expect(tone.outputs).toEqual([env]);
    expect(octave.outputs).toEqual([octaveEnv]);
    expect(octaveEnv.outputs).toEqual([env]);
    expect(env.outputs).toEqual([out]);
    expect(BEEPER.octave).toBeGreaterThan(0);
    expect(BEEPER.octave).toBeLessThanOrEqual(0.25);
    expect(BEEPER.octaveDecayTau).toBeLessThan(BEEPER.decayTau);
    expect(BEEPER.attackTau).toBeGreaterThanOrEqual(0.002); // quick, yet never a click on…
    expect(BEEPER.releaseTau).toBeGreaterThanOrEqual(0.01); // …or off
  });

  it('plays where MotorSound sends it (AudioEngine: the SFX bus), at the level balanced offline', () => {
    const ctx = new FakeAudioContext();
    const sfx = ctx.createGain();
    const routed = setup(undefined, sfx);
    expect(routed.parts.beeper.env.outputs).toEqual([sfx]);
    expect(routed.parts.driveGain.outputs).toEqual([routed.out]); // the drive whine stays on the motor bus
    const plain = setup();
    expect(plain.parts.beeper.env.outputs).toEqual([plain.out]);
    // Rendered offline through the whole graph (48 kHz, K-weighted: dev/audioPreview toroLevels()), level 0.08 on the
    // SFX bus measures −31.2‥−31.6 LUFS over its loudest 100 ms with the composer's keys: the music's own mean
    // (−31.4‥−31.9), ≈ 6 dB under the old alarm (−25.2), ≈ 9 dB under a pick-up (−22.2) and ≈ 11 dB under a floor
    // drop (−20.6).
    expect(BEEPER.level).toBeGreaterThanOrEqual(0.06);
    expect(BEEPER.level).toBeLessThanOrEqual(0.1);
  });

  it('turned off (the «pitido» setting) it is silent in reverse, a beep sounding fading out at once; back on, it beeps', () => {
    const { ctx, parts, run, motor } = setup();
    run(30, -0.4);
    expect(motor.reversing).toBe(true);
    const beeps = onsets(parts.beeper.env).length;
    const at = ctx.currentTime;
    motor.setReverseBeep(false);
    expect(motor.reversing).toBe(false);
    // The soft stop: held where it is (the queued beeps dropped), then faded out, the octave too.
    for (const env of [parts.beeper.env, parts.beeper.octaveEnv]) {
      expect(env.gain.events.slice(-2)).toMatchObject([
        { kind: 'hold', time: at },
        { kind: 'target', value: 0, time: at, tau: BEEPER.releaseTau },
      ]);
    }
    const events = parts.beeper.env.gain.events.length;
    run(Math.round(3 / FRAME), -0.4); // still backing up: silence, and no automation at all
    expect(parts.beeper.env.gain.events).toHaveLength(events);
    expect(motor.reversing).toBe(false);
    motor.setReverseBeep(false); // off again: nothing new
    expect(parts.beeper.env.gain.events).toHaveLength(events);

    // Back on while reversing: a fresh rhythm from the next frame.
    motor.setReverseBeep(true);
    const from = ctx.currentTime;
    run(1, -0.4);
    expect(motor.reversing).toBe(true);
    const times = onsets(parts.beeper.env);
    expect(times).toHaveLength(beeps + 1);
    expect(times.at(-1)).toBeCloseTo(from + FRAME + BEEPER.startDelaySec, 9);
  });

  it('turned off while parked, backing up stays silent (nothing to fade, nothing scheduled)', () => {
    const { parts, run, motor } = setup();
    motor.setReverseBeep(false);
    run(120, -0.4);
    expect(parts.beeper.env.gain.events).toHaveLength(0);
    expect(parts.beeper.octaveEnv.gain.events).toHaveLength(0);
    expect(motor.reversing).toBe(false);
    // The rest of the forklift is unaffected: reversing still whines.
    expect(target(parts.driveGain.gain)).toBeGreaterThan(0);
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

describe('ReverseBeeper with the real drive (vehicle controls)', () => {
  /** Onsets of the beeps scheduled so far. */
  const onsets = (parts: MotorInternals) =>
    parts.beeper.env.gain.events.filter((e) => e.kind === 'target' && e.value === BEEPER.level).map((e) => e.time);

  /** The rig on open floor, fed to MotorSound the way Game does: stepDrive, then sign(speed) · speed01 per frame. */
  function drive() {
    const m = setup();
    const cfg = GAME_CONFIG.forklift;
    const state: ForkliftState = { pos: { x: 0, z: 0 }, heading: 0, speed: 0, forkLift: 0, forkHeight: 0, carrying: null, wheelSpin: 0, steer: 0 };
    const rig = new ForkliftController(state, { resolve: () => 0 } as unknown as CollisionWorld, cfg);
    /** Holds `throttle` (W = 1, S = −1, none = 0) for `sec` seconds; returns the audio time it started. */
    const hold = (sec: number, throttle: number) => {
      const from = m.ctx.currentTime;
      for (let i = 0; i < Math.round(sec / FRAME); i++) {
        m.ctx.currentTime += FRAME;
        rig.stepDrive(FRAME, throttle, 0);
        m.motor.set(Math.sign(state.speed) * speed01(state.speed, cfg.maxSpeed), 0, 0);
      }
      return from;
    };
    return { ...m, state, rig, hold };
  }

  it('S from rest beeps within 0.2 s; releasing S stops it as the rig comes to rest', () => {
    const { parts, motor, state, hold } = drive();
    hold(0.5, 0);
    const pressed = hold(2, -1);
    expect(state.speed).toBeLessThan(0);
    const beeps = onsets(parts);
    expect(beeps.length).toBeGreaterThanOrEqual(3);
    expect(beeps[0] - pressed).toBeGreaterThan(0);
    expect(beeps[0] - pressed).toBeLessThan(0.2);
    expect(motor.reversing).toBe(true);

    const released = hold(0.7, 0); // coasting back from full reverse speed: at rest well within this
    expect(motor.reversing).toBe(false);
    expect(Math.abs(state.speed)).toBeLessThan(0.05);
    const before = onsets(parts).length;
    hold(2, 0);
    expect(onsets(parts)).toHaveLength(before); // parked: silent
    expect(Math.max(...onsets(parts))).toBeLessThan(released + 0.7);
  });

  it('switching from S to W stops the beeps as it stops rolling back; W alone never beeps', () => {
    const { parts, motor, state, hold } = drive();
    hold(1.5, 1); // W from rest
    expect(onsets(parts)).toHaveLength(0);
    hold(1.5, -1); // brakes, then backs up
    expect(motor.reversing).toBe(true);
    const switched = hold(0.7, 1);
    expect(motor.reversing).toBe(false);
    const last = Math.max(...onsets(parts));
    expect(last).toBeLessThan(switched + 0.7);
    hold(2, 1);
    expect(state.speed).toBeGreaterThan(0);
    expect(Math.max(...onsets(parts))).toBe(last); // driving forward: never a beep
  });

  it('backing out of a rack slot (heading locked, carrying a box) beeps like any reverse', () => {
    const { parts, motor, rig, hold } = drive();
    rig.attachLoad(GAME_CONFIG.forklift.carriedBoxRadius);
    rig.setHeadingLock(true);
    const pressed = hold(1, -1);
    expect(motor.reversing).toBe(true);
    expect(onsets(parts)[0] - pressed).toBeLessThan(0.2);
  });
});

describe('MotorSound lifecycle', () => {
  it('allocates nothing per frame: every node is built once', () => {
    const { ctx, run, motor } = setup();
    const built = ctx.nodes.length;
    for (let i = 0; i < 20; i++) {
      run(15, i % 2 ? 0.9 : -0.45, i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0, i % 4);
      motor.hushClunk(ctx.currentTime + (i % 5 === 0 ? 1 : 0));
      motor.setReverseBeep(i % 4 !== 1); // the «pitido» toggle builds nothing either
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
