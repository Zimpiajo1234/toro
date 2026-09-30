import { disconnectAll, gain, holdParam, osc } from './nodes';
import { midiToFreq } from './music/harmony';
import { BPM } from './music/timing';

/**
 * The forklift's back-up alarm, the classic "beep… beep… beep" (every value here is safe to tune by ear). Speeds are
 * the signed, normalised drive speed MotorSound receives (−1‥1, negative = in reverse; reverse tops out near −0.52).
 * `level` is on the bus the beeper plays into: AudioEngine routes it to the SFX bus (not the quiet motor bus), so it
 * carries over the music and the drive whine the way a pick-up or a drop does, and never louder than them.
 */
export const BEEPER = {
  /** Starts once the forklift backs up faster than this (≈ 0.09 u/s, ≈ 0.08 s after S from rest): a nudge beeps. */
  onSpeed: 0.04,
  /** Stops once reversing slows below this (≈ 0.035 u/s), i.e. stopped, or crossing over to drive forward. */
  offSpeed: 0.015,
  /** One beep per beat of the music (70 BPM → 0.857 s): the steady alarm rhythm, in time with the song. */
  periodSec: 60 / BPM,
  /** How long each beep sounds: about half the period, the rest is silence ("beep… beep…", never a drone). */
  onSec: 0.42,
  /** The first beep follows the start of reversing this closely. */
  startDelaySec: 0.02,
  /** Beeps are scheduled on the audio clock this far ahead of the frame (never late on a slow frame). */
  lookaheadSec: 0.12,
  /**
   * Peak level of the tone on its bus (SFX). Measured offline through the whole mix: ≈ 6 LU over the music (and far
   * over it in its own band), ≈ 4 dB under a box pick-up or drop over 100 ms and ≈ 13 dB under their peaks.
   */
  level: 0.1,
  /** Attack / release time constants: a clean alarm edge, yet no click (≈ 25 ms in, ≈ 50 ms out). */
  attackTau: 0.008,
  releaseTau: 0.016,
  /**
   * A little third harmonic (odd, like the square-ish tone of a real alarm) makes it read as an electronic beep; kept
   * this low (≈ −16 dB) the tone stays round, never buzzy or shrill.
   */
  harmonic: 0.16,
  /**
   * Pitch: the song's tonic or fifth, whichever octave of them lies nearest this (a real back-up alarm sounds at
   * ≈ 1.1 kHz). With the composer's keys (F, E♭, D, G, C) the beep sits at 1047–1245 Hz, just above the melody, and
   * always in key.
   */
  targetHz: 1100,
} as const;

/** Scale degrees (semitones over the tonic) the beep may take: the tonic and the fifth, consonant over any chord. */
const BEEP_DEGREES = [0, 7] as const;

/** Frequency of the reverse beep for a key (`keyPc` = pitch class of its tonic, 0 = C). */
export function beepFrequency(keyPc: number): number {
  const pc = Number.isFinite(keyPc) ? ((Math.round(keyPc) % 12) + 12) % 12 : 0;
  const target = 69 + 12 * Math.log2(BEEPER.targetHz / 440);
  let best = 0;
  let bestGap = Infinity;
  for (const degree of BEEP_DEGREES) {
    const note = (pc + degree) % 12;
    const midi = note + 12 * Math.round((target - note) / 12);
    const gap = Math.abs(midi - target);
    if (gap < bestGap) {
      best = midi;
      bestGap = gap;
    }
  }
  return midiToFreq(best);
}

/**
 * The forklift's back-up beeper: "beep… beep… beep" while it moves in reverse, silent otherwise. A sine and a little of
 * its third harmonic (phase-locked: they start together), gated by a single envelope whose beeps are scheduled on the
 * audio clock a little ahead of each frame. Built once; `update()` runs every frame and allocates nothing.
 */
export class ReverseBeeper {
  private readonly tone: OscillatorNode;
  private readonly overtone: OscillatorNode;
  private readonly env: GainNode;
  private readonly nodes: AudioNode[];
  private active = false;
  /** Audio time of the next beep to schedule while active. */
  private nextAt = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    frequency = beepFrequency(0),
  ) {
    this.env = gain(ctx, 0);
    this.env.connect(out);
    this.tone = osc(ctx, 'sine', frequency);
    this.tone.connect(this.env);
    this.overtone = osc(ctx, 'sine', frequency * 3);
    const overtoneLevel = gain(ctx, BEEPER.harmonic);
    this.overtone.connect(overtoneLevel);
    overtoneLevel.connect(this.env);
    this.nodes = [this.tone, this.overtone, overtoneLevel, this.env];
    const t = ctx.currentTime;
    this.tone.start(t);
    this.overtone.start(t);
  }

  /** Whether it is beeping (reversing). */
  get beeping(): boolean {
    return this.active;
  }

  /** `speed` = signed normalised drive speed (negative = reverse), once per frame. */
  update(speed: number): void {
    const s = Number.isFinite(speed) ? speed : 0;
    const now = this.ctx.currentTime;
    if (!this.active) {
      if (s >= -BEEPER.onSpeed) return;
      this.active = true;
      this.nextAt = now + BEEPER.startDelaySec;
    } else if (s > -BEEPER.offSpeed) {
      this.stop();
      return;
    }
    // A long frame (or a context that just woke up) never schedules into the past: pick the rhythm up from now.
    if (this.nextAt < now) this.nextAt = now;
    while (this.nextAt <= now + BEEPER.lookaheadSec) {
      this.beep(this.nextAt);
      this.nextAt += BEEPER.periodSec;
    }
  }

  /** Stops at once with a short soft fade (a beep cut short never clicks); the beeps already queued are dropped. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    const now = this.ctx.currentTime;
    holdParam(this.env.gain, now);
    this.env.gain.setTargetAtTime(0, now, BEEPER.releaseTau);
  }

  dispose(): void {
    for (const o of [this.tone, this.overtone]) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    disconnectAll(this.nodes);
  }

  /** One beep at `t`: exponential approaches in and out, so it never jumps whatever the envelope is doing. */
  private beep(t: number): void {
    const g = this.env.gain;
    g.setTargetAtTime(BEEPER.level, t, BEEPER.attackTau);
    g.setTargetAtTime(0, t + BEEPER.onSec - 2 * BEEPER.releaseTau, BEEPER.releaseTau);
  }
}
