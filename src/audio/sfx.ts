import type { MatchKind } from '../core/sorting';
import type { Rng } from './types';
import { range, vary } from './random';
import { filter, gain, osc, panner } from './nodes';
import { NoteVoice, VoicePool } from './voices';
import { BellInstrument } from './instruments/bell';
import { PadInstrument } from './instruments/pad';
import { WoodInstrument } from './instruments/wood';
import { BAR_SEC } from './music/timing';

interface NoiseHit {
  type: BiquadFilterType;
  freq: number;
  q: number;
  peak: number;
  attack: number;
  tau: number;
  pan?: number;
}

interface ToneHit {
  type: OscillatorType;
  freq: number;
  /** Optional glide target (exponential) reached after `glideSec`. */
  freqEnd?: number;
  glideSec?: number;
  peak: number;
  attack: number;
  /** Seconds to hold before decaying (servo-like sustains). */
  hold?: number;
  tau: number;
  lowpass?: number;
}

/** Non-musical SFX vary pitch and gain by ±5 %; musical ones only by a few cents. */
const VARIANCE = 0.05;
/** Per stack level: knocks and servo rise by this share (a box on a box sounds lighter, never shrill). */
export const LEVEL_PITCH = 0.12;
/** Gap between the notes of a completed stack's figure (s): it pushes that drop's chime back by (n − 1) gaps. */
export const STACK_NOTE_GAP = 0.085;
/**
 * Strike levels of a zone's chime per kind of match: a lone bell or wood, or both softer for an exact match. `final`
 * = the last zone's second strike a fourth below (on the bell when the match rings one, else on the wood). Balanced
 * offline (dev/audio-preview) so no kind peaks above the classic color bell: the wood's attack is a touch sharper.
 */
export const CHIME_LEVELS: Readonly<Record<MatchKind, { bell: number; wood: number; final: number }>> = {
  color: { bell: 0.75, wood: 0, final: 0.4 },
  symbol: { bell: 0, wood: 0.64, final: 0.36 },
  exact: { bell: 0.4, wood: 0.38, final: 0.3 },
};
/**
 * [ratio, relative level, decay factor] — a damped painted-steel beam (storage racks): its two lowest free-bar modes.
 * Inharmonic, so the "toc" reads as metal and never as a note (the success chime stays the only pitched sound).
 */
export const BEAM_MODES: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [2.76, 0.45, 0.5],
];
/** Low-pass over the beam modes: warm, never a clang. */
export const BEAM_LOWPASS_HZ = 2400;
/**
 * The wrong-target buzz (levels with racks): its hum starts here and sags to WRONG_BUZZ_SAG of it. Low, yet still in
 * the range laptop speakers reproduce (a sub-only "no" would vanish on them).
 */
export const WRONG_BUZZ_HZ = 185;
export const WRONG_BUZZ_SAG = 0.86;
/** Its partner sits this ratio above the hum: ≈ 10 Hz of slow beating, the soft "bzz" (a flutter, never a rasp). */
export const WRONG_BUZZ_DETUNE = 1.055;
/** Warm low-pass over the buzz: no bright partials, a muffled "no" behind a closed door. */
export const WRONG_BUZZ_LOWPASS_HZ = 620;

/**
 * Soft, tactile sound effects. Every sound is built from two primitives (filtered noise hit, enveloped
 * tone) plus the bell, the wooden marimba and a pad for the level-complete swell. Nothing is harsh; the only "no" is
 * the soft, muffled wrong-target buzz of the levels with racks (wrongBuzz).
 */
export class SfxPlayer {
  private readonly pool: VoicePool;
  private readonly bell: BellInstrument;
  private readonly wood: WoodInstrument;
  private readonly swell: PadInstrument;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly noise: AudioBuffer,
    private readonly rng: Rng,
  ) {
    this.pool = new VoicePool(28);
    this.bell = new BellInstrument(ctx, out, rng, 14);
    this.wood = new WoodInstrument(ctx, out, noise, rng, 8);
    this.swell = new PadInstrument(ctx, out, rng, 2);
  }

  voiceCount(): number {
    return this.pool.size + this.bell.activeVoices + this.wood.activeVoices + this.swell.activeVoices;
  }

  /**
   * Light wooden knock + a soft servo glide as the forks take the box. `level` = stack height it was lifted from:
   * higher up, the knock and servo sit a little higher and the servo glides a little longer.
   */
  pickup(t: number, level = 0): void {
    const r = this.rng;
    const lift = 1 + LEVEL_PITCH * Math.max(0, level);
    this.noiseHit(t, { type: 'bandpass', freq: vary(r, 1150 * lift, VARIANCE), q: 3.2, peak: vary(r, 0.5, VARIANCE), attack: 0.002, tau: 0.018 });
    this.toneHit(t, { type: 'sine', freq: vary(r, 196, VARIANCE), freqEnd: vary(r, 150, VARIANCE), glideSec: 0.06, peak: vary(r, 0.34, VARIANCE), attack: 0.003, tau: 0.05 });
    this.servoLift(t + 0.03, level);
  }

  /**
   * The forks lifting a box out of a rack slot at `level`: a softer knock of the tines, the box easing off the painted
   * beam (a faint beam tone and a brief slide) and the same servo glide as any pickup. Neutral: taking a box out,
   * even the destined one, never sounds like a mistake.
   */
  slotLift(t: number, level = 0): void {
    const r = this.rng;
    const k = 1 + LEVEL_PITCH * Math.max(0, level);
    this.noiseHit(t, { type: 'bandpass', freq: vary(r, 1050 * k, VARIANCE), q: 2.6, peak: vary(r, 0.3, VARIANCE), attack: 0.002, tau: 0.016 });
    this.beam(t + 0.02, vary(r, 500 * k, VARIANCE), vary(r, 0.035, VARIANCE));
    this.noiseHit(t + 0.03, { type: 'bandpass', freq: vary(r, 820 * k, VARIANCE), q: 1.4, peak: vary(r, 0.07, VARIANCE), attack: 0.03, tau: 0.05 });
    this.servoLift(t + 0.03, level);
  }

  /**
   * Felt thump; a correct drop adds a warm chime at `chimeMidi` in the timbre of its `match` (see chime()). The sub
   * body is backed by its second harmonic and a short felt layer around 600 Hz, so the drop reads as clearly on
   * laptop speakers as on headphones (where the sub alone would boom).
   */
  drop(
    t: number,
    chimeMidi: number | null,
    final = false,
    level = 0,
    stackNotes: readonly number[] | null = null,
    match: MatchKind = 'color',
  ): void {
    const r = this.rng;
    if (level <= 0) {
      this.toneHit(t, { type: 'sine', freq: vary(r, 118, VARIANCE), freqEnd: vary(r, 62, VARIANCE), glideSec: 0.12, peak: vary(r, 0.3, VARIANCE), attack: 0.004, tau: 0.09, lowpass: 400 });
      this.toneHit(t, { type: 'sine', freq: vary(r, 236, VARIANCE), freqEnd: vary(r, 124, VARIANCE), glideSec: 0.12, peak: vary(r, 0.2, VARIANCE), attack: 0.004, tau: 0.07 });
      this.noiseHit(t, { type: 'lowpass', freq: vary(r, 380, VARIANCE), q: 0.6, peak: vary(r, 0.3, VARIANCE), attack: 0.003, tau: 0.04 });
      this.noiseHit(t, { type: 'bandpass', freq: vary(r, 600, VARIANCE), q: 1, peak: vary(r, 0.3, VARIANCE), attack: 0.003, tau: 0.04 });
    } else {
      // Box on a box: a lighter wooden "toc", a little higher per level; less sub (nothing hits the floor).
      const k = 1 + LEVEL_PITCH * level;
      this.toneHit(t, { type: 'sine', freq: vary(r, 150 * k, VARIANCE), freqEnd: vary(r, 92 * k, VARIANCE), glideSec: 0.08, peak: vary(r, 0.2, VARIANCE), attack: 0.004, tau: 0.06, lowpass: 520 });
      this.toneHit(t, { type: 'sine', freq: vary(r, 300 * k, VARIANCE), freqEnd: vary(r, 180 * k, VARIANCE), glideSec: 0.08, peak: vary(r, 0.16, VARIANCE), attack: 0.003, tau: 0.05 });
      this.noiseHit(t, { type: 'bandpass', freq: vary(r, 760 * k, VARIANCE), q: 1.4, peak: vary(r, 0.28, VARIANCE), attack: 0.002, tau: 0.03 });
      this.noiseHit(t, { type: 'lowpass', freq: vary(r, 480 * k, VARIANCE), q: 0.6, peak: vary(r, 0.16, VARIANCE), attack: 0.003, tau: 0.03 });
    }
    if (chimeMidi === null) return;
    this.chime(t + range(r, 0.04, 0.06), chimeMidi, final, stackNotes, match);
  }

  /**
   * A box settling into a rack slot at `level`, at `t` (as it lands): a soft, muted metallic "toc" (the box's felt body
   * on the painted beam, then the beam's two damped modes), a little higher per level, no floor sub. Pass `chimeMidi`
   * only when the slot now holds its destined box: it adds the chime in the timbre of the cue's `match` (see
   * chime()). A box that merely fits the cue settles with the same neutral toc and nothing else.
   */
  slotDrop(t: number, chimeMidi: number | null, final = false, level = 0, match: MatchKind = 'color'): void {
    const r = this.rng;
    const k = 1 + LEVEL_PITCH * Math.max(0, level);
    this.toneHit(t, { type: 'sine', freq: vary(r, 165 * k, VARIANCE), freqEnd: vary(r, 104 * k, VARIANCE), glideSec: 0.07, peak: vary(r, 0.18, VARIANCE), attack: 0.004, tau: 0.055, lowpass: 520 });
    this.noiseHit(t, { type: 'bandpass', freq: vary(r, 680 * k, VARIANCE), q: 1.3, peak: vary(r, 0.22, VARIANCE), attack: 0.002, tau: 0.03 });
    this.noiseHit(t, { type: 'lowpass', freq: vary(r, 450 * k, VARIANCE), q: 0.6, peak: vary(r, 0.14, VARIANCE), attack: 0.003, tau: 0.03 });
    this.beam(t + 0.004, vary(r, 470 * k, VARIANCE), vary(r, 0.075, VARIANCE));
    if (chimeMidi === null) return;
    this.chime(t + range(r, 0.04, 0.06), chimeMidi, final, null, match);
  }

  /**
   * Soft detent click as the forks step one rack slot (F / V, the wheel, pad X / B): a tiny muffled latch, a little
   * higher per `level` (the slot just selected) and a hair brighter going up (`direction` +1) than down. About half a
   * UI click: it confirms the step without competing with the servo or the music.
   */
  forkClick(t: number, level: number, direction: 1 | -1): void {
    const r = this.rng;
    const k = (1 + LEVEL_PITCH * Math.max(0, level)) * (direction > 0 ? 1.04 : 0.96);
    this.noiseHit(t, { type: 'bandpass', freq: vary(r, 1250 * k, VARIANCE), q: 3.5, peak: vary(r, 0.1, VARIANCE), attack: 0.0015, tau: 0.007 });
    this.toneHit(t, { type: 'sine', freq: vary(r, 520 * k, VARIANCE), freqEnd: vary(r, 470 * k, VARIANCE), glideSec: 0.03, peak: vary(r, 0.04, VARIANCE), attack: 0.002, tau: 0.018 });
  }

  /**
   * Levels with racks: a box set down on a target that is not its destiny (a floor zone, or a slot with a cue, even
   * one it fits), at `t` (just after its landing thump / toc). A soft, low, muffled "nuh": a warm triangle hum and a
   * quieter sawtooth a few hertz above it beating against it (the gentle buzz), both sagging a little in pitch under
   * a warm low-pass, ≈ 0.2 s. Says "not here" without alarm: no bright partials, no second hit, far softer than the
   * drop itself (and well under the music).
   */
  wrongBuzz(t: number): void {
    const r = this.rng;
    const hum = vary(r, WRONG_BUZZ_HZ, VARIANCE);
    const beat = hum * WRONG_BUZZ_DETUNE;
    const lowpass = WRONG_BUZZ_LOWPASS_HZ;
    this.toneHit(t, { type: 'triangle', freq: hum, freqEnd: hum * WRONG_BUZZ_SAG, glideSec: 0.18, peak: vary(r, 0.05, VARIANCE), attack: 0.014, hold: 0.1, tau: 0.03, lowpass });
    this.toneHit(t, { type: 'sawtooth', freq: beat, freqEnd: beat * WRONG_BUZZ_SAG, glideSec: 0.18, peak: vary(r, 0.022, VARIANCE), attack: 0.02, hold: 0.09, tau: 0.03, lowpass });
  }

  /**
   * A zone's chime at `t` (after a correct drop's knock, or on its own when lifting a wrong top box leaves the zone
   * satisfied again). Its timbre says how the zone matched: by color the warm bell, by symbol a soft wooden marimba,
   * an exact box both at once, each softer (CHIME_LEVELS). A completed stack first climbs through one soft note per
   * box into it (stack zones are color-only).
   */
  chime(t: number, chimeMidi: number, final = false, stackNotes: readonly number[] | null = null, match: MatchKind = 'color'): void {
    const r = this.rng;
    let at = t;
    if (stackNotes && stackNotes.length > 1) {
      for (let i = 0; i < stackNotes.length - 1; i++) {
        this.bell.strike(stackNotes[i], at, vary(r, 0.42 + 0.06 * i, VARIANCE), { decay: 1.1 });
        at += STACK_NOTE_GAP;
      }
    }
    const levels = CHIME_LEVELS[match] ?? CHIME_LEVELS.color;
    if (levels.bell > 0) this.bell.strike(chimeMidi, at, vary(r, levels.bell, VARIANCE));
    if (levels.wood > 0) this.wood.strike(chimeMidi, at, vary(r, levels.wood, VARIANCE));
    // The last zone adds a soft second strike a fourth below (the chord's fifth) for a fuller resolve.
    if (!final) return;
    if (levels.bell > 0) this.bell.strike(chimeMidi - 5, at + 0.09, vary(r, levels.final, VARIANCE), { decay: 1.3 });
    else this.wood.strike(chimeMidi - 5, at + 0.09, vary(r, levels.final, VARIANCE), { decay: 1.3 });
  }

  /** Barely-audible neutral tick (zone released, nothing to do). */
  tick(t: number, kind: 'release' | 'idle'): void {
    const r = this.rng;
    if (kind === 'release') {
      this.noiseHit(t, { type: 'bandpass', freq: vary(r, 2300, VARIANCE), q: 5, peak: vary(r, 0.09, VARIANCE), attack: 0.0015, tau: 0.008 });
      this.toneHit(t, { type: 'sine', freq: vary(r, 740, VARIANCE), peak: vary(r, 0.03, VARIANCE), attack: 0.002, tau: 0.02 });
    } else {
      this.toneHit(t, { type: 'sine', freq: vary(r, 420, VARIANCE), freqEnd: vary(r, 380, VARIANCE), glideSec: 0.04, peak: vary(r, 0.07, VARIANCE), attack: 0.003, tau: 0.03 });
      this.noiseHit(t, { type: 'bandpass', freq: vary(r, 1400, VARIANCE), q: 2, peak: vary(r, 0.05, VARIANCE), attack: 0.002, tau: 0.01 });
    }
  }

  /** Tiny soft wooden tap for UI buttons. */
  uiClick(t: number): void {
    const r = this.rng;
    this.noiseHit(t, { type: 'bandpass', freq: vary(r, 1900, VARIANCE), q: 5, peak: vary(r, 0.2, VARIANCE), attack: 0.0015, tau: 0.01 });
    this.toneHit(t, { type: 'sine', freq: vary(r, 640, VARIANCE), peak: vary(r, 0.08, VARIANCE), attack: 0.002, tau: 0.02 });
  }

  /**
   * Gentle ascending arpeggio from `t`, and a warm pad swell from `swellAt` (the downbeat where the music
   * resolves) held for `swellSec`. Its sub-bass hands over exactly when the swell releases, so it never
   * sounds against the music's next root.
   */
  levelComplete(t: number, arpeggio: readonly number[], swellAt: number, swellMidis: readonly number[], bass: number | null, swellSec = BAR_SEC): void {
    const r = this.rng;
    let at = t;
    arpeggio.forEach((m, i) => {
      const v = 0.62 - i * 0.05;
      this.bell.strike(m, at, vary(r, v, VARIANCE), { decay: 1.5 + i * 0.12, pan: -0.3 + (0.6 * i) / Math.max(1, arpeggio.length - 1) });
      at += range(r, 0.115, 0.14);
    });
    this.swell.play(swellMidis, bass, swellAt, swellSec, 0.9, { attack: 1.4, release: 1.3, brightness: 1.15, level: 0.9, bassOverlap: 0 });
  }

  releaseAll(): void {
    const now = this.ctx.currentTime;
    this.pool.releaseAll(now);
    this.bell.releaseAll();
    this.wood.releaseAll();
    this.swell.releaseAll();
  }

  /** Soft servo glide as the forks lift a load (`level` = height it leaves: a little higher and longer up a stack). */
  private servoLift(t: number, level: number): void {
    const r = this.rng;
    const servo = vary(r, 210 * (1 + LEVEL_PITCH * Math.max(0, level)), VARIANCE);
    const glide = 0.3 * (1 + 0.25 * Math.max(0, level));
    this.toneHit(t, { type: 'triangle', freq: servo, freqEnd: servo * 1.42, glideSec: glide, peak: vary(r, 0.045, VARIANCE), attack: 0.06, hold: 0.18, tau: 0.07, lowpass: 900 });
  }

  /** A damped painted-steel beam at `base` Hz (BEAM_MODES): short sine modes under a warm low-pass. */
  private beam(t: number, base: number, peak: number): void {
    for (const [ratio, level, decay] of BEAM_MODES) {
      this.toneHit(t, { type: 'sine', freq: base * ratio, peak: peak * level, attack: 0.002, tau: 0.07 * decay, lowpass: BEAM_LOWPASS_HZ });
    }
  }

  private noiseHit(t0: number, p: NoiseHit): void {
    const ctx = this.ctx;
    const start = Math.max(t0, ctx.currentTime);
    const voice = new NoteVoice(ctx, this.out, this.pool);
    const env = voice.node(gain(ctx, 0));
    env.connect(voice.output);
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(p.peak, start + p.attack);
    env.gain.setTargetAtTime(0, start + p.attack, p.tau);
    const pan = voice.node(panner(ctx, p.pan ?? range(this.rng, -0.12, 0.12)));
    pan.connect(env);
    const f = voice.node(filter(ctx, p.type, p.freq, p.q));
    f.connect(pan);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    voice.bufferSource(src, range(this.rng, 0, Math.max(0, this.noise.duration - 0.5))).connect(f);
    voice.play(start, start + p.attack + p.tau * 7);
  }

  private toneHit(t0: number, p: ToneHit): void {
    const ctx = this.ctx;
    const start = Math.max(t0, ctx.currentTime);
    const hold = p.hold ?? 0;
    const voice = new NoteVoice(ctx, this.out, this.pool);
    const env = voice.node(gain(ctx, 0));
    env.connect(voice.output);
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(p.peak, start + p.attack);
    env.gain.setTargetAtTime(0, start + p.attack + hold, p.tau);
    let head: AudioNode = env;
    if (p.lowpass !== undefined) {
      const lp = voice.node(filter(ctx, 'lowpass', p.lowpass, 0.5));
      lp.connect(env);
      head = lp;
    }
    const o = voice.source(osc(ctx, p.type, p.freq));
    if (p.freqEnd !== undefined) {
      o.frequency.setValueAtTime(p.freq, start);
      o.frequency.exponentialRampToValueAtTime(Math.max(20, p.freqEnd), start + (p.glideSec ?? 0.1));
    }
    o.connect(head);
    voice.play(start, start + p.attack + hold + p.tau * 7);
  }
}
