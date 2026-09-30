import { disconnectAll, filter, gain, holdParam, osc } from './nodes';
import { midiToFreq } from './music/harmony';
import { BPM } from './music/timing';

/**
 * The reverse alarm, softened for a cozy game (every value here is safe to tune by ear). Speeds are the signed,
 * normalised drive speed MotorSound receives (−1‥1, negative = in reverse; reverse tops out near −0.5).
 */
export const BEEPER = {
  /** Starts once the forklift backs up faster than this (≈ 0.09 u/s): a nudge of S already beeps. */
  onSpeed: 0.04,
  /** Stops once reversing slows below this (≈ 0.035 u/s), i.e. stopped, or crossing over to drive forward. */
  offSpeed: 0.015,
  /** One beep per beat of the music (70 BPM → 0.857 s): the classic "beep… beep… beep", in time with the song. */
  periodSec: 60 / BPM,
  /** How long each beep sounds (the rest of the period is silence). */
  onSec: 0.34,
  /** The first beep follows the start of reversing this closely. */
  startDelaySec: 0.03,
  /** Beeps are scheduled on the audio clock this far ahead of the frame (never late on a slow frame). */
  lookaheadSec: 0.12,
  /** Peak level on the motor bus (under the music; the drive whine is about as loud at full speed). */
  level: 0.085,
  /** Soft attack / release time constants: a round "boop", never a square-edged alarm. */
  attackTau: 0.012,
  releaseTau: 0.028,
  /** A faint second harmonic gives it body; the warm low-pass keeps it from ever piercing. */
  harmonic: 0.14,
  lowpassHz: 1500,
  /**
   * Pitch: the music's tonic in this octave (C5 = 72). With the composer's keys (F, E♭, D, G, C) the beep sits at
   * 523–784 Hz, well under a real back-up alarm (≈ 1.1 kHz), and it never clashes with the song.
   */
  tonicMidi: 72,
} as const;

/** Frequency of the reverse beep for a key (`keyPc` = pitch class of its tonic, 0 = C). */
export function beepFrequency(keyPc: number): number {
  const pc = Number.isFinite(keyPc) ? ((Math.round(keyPc) % 12) + 12) % 12 : 0;
  return midiToFreq(BEEPER.tonicMidi + pc);
}

/**
 * The forklift's back-up beeper: "beep… beep… beep" while it moves in reverse, silent otherwise. One sine (plus a faint
 * harmonic) under a warm low-pass, gated by a single envelope whose beeps are scheduled on the audio clock a little
 * ahead of each frame. Built once; `update()` runs every frame and allocates nothing.
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
    const lowpass = filter(ctx, 'lowpass', BEEPER.lowpassHz, 0.5);
    lowpass.connect(this.env);
    this.tone = osc(ctx, 'sine', frequency);
    this.tone.connect(lowpass);
    this.overtone = osc(ctx, 'sine', frequency * 2);
    const overtoneLevel = gain(ctx, BEEPER.harmonic);
    this.overtone.connect(overtoneLevel);
    overtoneLevel.connect(lowpass);
    this.nodes = [this.tone, this.overtone, overtoneLevel, lowpass, this.env];
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
