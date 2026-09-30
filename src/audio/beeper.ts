import { REVERSING, nextReversing } from '../core/reversing';
import { disconnectAll, gain, holdParam, osc } from './nodes';
import { midiToFreq } from './music/harmony';
import { BPM } from './music/timing';

/**
 * The forklift's reverse beeper: a sweet, soft "tin… tin… tin", like a small felt-struck bell or a kalimba tine (every
 * value here is safe to tune by ear). Speeds are the signed, normalised drive speed MotorSound receives (−1‥1,
 * negative = in reverse; reverse tops out near −0.52). `level` is on the bus the beeper plays into: AudioEngine routes
 * it to the SFX bus (not the quiet motor bus, where it vanished), where it sits at about the music's own level, told
 * apart by its pitch and its bell-like tone, and always under a box pick-up or drop.
 */
export const BEEPER = {
  /**
   * Starts once the forklift backs up faster than this (≈ 0.09 u/s, ≈ 0.08 s after S from rest): a nudge beeps. Both
   * thresholds are the shared reversing latch's (core/reversing `REVERSING`, tuned there), which the roof beacon
   * follows too.
   */
  onSpeed: REVERSING.onSpeed,
  /** Stops once reversing slows below this (≈ 0.035 u/s), i.e. stopped, or crossing over to drive forward. */
  offSpeed: REVERSING.offSpeed,
  /** One beep per beat of the music (70 BPM → 0.857 s): the steady back-up rhythm, in time with the song. */
  periodSec: 60 / BPM,
  /** The first beep follows the start of reversing this closely. */
  startDelaySec: 0.02,
  /** Beeps are scheduled on the audio clock this far ahead of the frame (never late on a slow frame). */
  lookaheadSec: 0.12,
  /**
   * Peak of each beep on its bus (SFX). Measured offline through the whole mix (48 kHz, K-weighted; dev/audioPreview
   * `toroLevels()`), with the composer's five keys: its loudest 100 ms −31.2‥−31.6 LUFS, the music's own mean
   * (−31.4‥−31.9), ≈ 6 dB under the old back-up alarm (−25.2), ≈ 9 dB under a box pick-up (−22.2) and ≈ 11 dB under
   * a floor drop (−20.6); its peak ≈ 13 dB under theirs. In its own third-octave band it stands ≈ 12–14 dB over the
   * music there: soft, yet easy to pick out.
   */
  level: 0.08,
  /**
   * A quick, soft strike: the level is approached with this time constant (≈ 95 % after 3 τ = 15 ms), then the beep
   * decays at once. A felt mallet, never a click or a hard edge.
   */
  attackTau: 0.005,
  /**
   * The natural decay of each beep (τ): it rings for ≈ 0.3 s ("tin…", −26 dB after 3 τ) and has died away (≈ −70 dB)
   * long before the next beat. Nothing sustained: a chime, never an alarm tone.
   */
  decayTau: 0.1,
  /**
   * A faint octave over the tone (relative level, ≈ −16 dB) that fades much faster than it (its own τ, under the beep's
   * envelope: ≈ 38 ms together): the soft glassy "t" of the strike. An octave, never an odd harmonic (no buzz).
   */
  octave: 0.16,
  octaveDecayTau: 0.06,
  /** A beep cut short (the forklift stops, or the player turns the beeper off) fades out with this τ (≈ 0.1 s). */
  releaseTau: 0.025,
  /**
   * Pitch: the song's tonic or fifth, whichever octave of them lies nearest this (F♯5). With the composer's keys (F,
   * E♭, D, G, C) the beep sits at 622–880 Hz, in the middle of the melody's range: sweet, never piercing, and always
   * in key.
   */
  targetHz: 740,
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
 * The forklift's back-up beeper: "tin… tin… tin" while it moves in reverse, silent otherwise, and silent altogether
 * while the player has turned it off (`setEnabled`, the «pitido» setting). A sine and a faint octave (phase-locked:
 * they start together), each beep a soft strike that decays on its own, scheduled on the audio clock a little ahead
 * of each frame. The octave's own faster envelope sits under the beep's, so one envelope gates the whole sound. Built
 * once; `update()` runs every frame and allocates nothing.
 */
export class ReverseBeeper {
  private readonly tone: OscillatorNode;
  private readonly octave: OscillatorNode;
  /** The beep's envelope: every strike, and the fade when it stops. */
  private readonly env: GainNode;
  /** The octave's relative envelope (under `env`): the same strikes, a faster decay. */
  private readonly octaveEnv: GainNode;
  private readonly nodes: AudioNode[];
  private active = false;
  private on = true;
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
    this.octave = osc(ctx, 'sine', frequency * 2);
    this.octaveEnv = gain(ctx, 0);
    this.octave.connect(this.octaveEnv);
    this.octaveEnv.connect(this.env);
    this.nodes = [this.tone, this.octave, this.octaveEnv, this.env];
    const t = ctx.currentTime;
    this.tone.start(t);
    this.octave.start(t);
  }

  /** Whether it is beeping (reversing, with the beeper on). */
  get beeping(): boolean {
    return this.active;
  }

  /** Whether the beeper may sound at all (the player's «pitido» setting; on by default). */
  get enabled(): boolean {
    return this.on;
  }

  /**
   * Turns the beeper on / off. Off, it stays silent even in reverse, and a beep sounding fades out at once (the soft
   * `stop()` fade). Back on while reversing, the next `update()` starts a fresh rhythm.
   */
  setEnabled(enabled: boolean): void {
    if (enabled === this.on) return;
    this.on = enabled;
    if (!enabled) this.stop();
  }

  /**
   * Once per frame. `speed` = signed normalised drive speed (negative = reverse). `reversing` = this frame's shared
   * reversing latch (`ForkliftState.reversing`, as Game passes it), so the beeps start and stop on the frames the roof
   * beacon does; omitted, the beeper runs that same latch (core/reversing) on `speed` itself.
   */
  update(speed: number, reversing?: boolean): void {
    if (!this.on) return;
    const now = this.ctx.currentTime;
    const back = reversing ?? nextReversing(this.active, speed);
    if (!this.active) {
      if (!back) return;
      this.active = true;
      this.nextAt = now + BEEPER.startDelaySec;
    } else if (!back) {
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
    fadeOut(this.env.gain, now);
    fadeOut(this.octaveEnv.gain, now);
  }

  dispose(): void {
    for (const o of [this.tone, this.octave]) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    disconnectAll(this.nodes);
  }

  /** One beep at `t`: the tone's strike and the octave's shorter one (exponential approaches: never a jump). */
  private beep(t: number): void {
    strike(this.env.gain, BEEPER.level, t, BEEPER.decayTau);
    strike(this.octaveEnv.gain, BEEPER.octave, t, BEEPER.octaveDecayTau);
  }
}

/** A soft strike on a persistent gain at `t`: a quick approach to `peak`, then the natural decay toward silence. */
function strike(param: AudioParam, peak: number, t: number, decayTau: number): void {
  param.setTargetAtTime(peak, t, BEEPER.attackTau);
  param.setTargetAtTime(0, t + 3 * BEEPER.attackTau, decayTau);
}

/** From wherever the envelope is at `now` down to silence, dropping every strike queued after it. */
function fadeOut(param: AudioParam, now: number): void {
  holdParam(param, now);
  param.setTargetAtTime(0, now, BEEPER.releaseTau);
}
