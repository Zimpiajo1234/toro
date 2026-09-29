import type { Rng } from './types';
import { range, vary } from './random';
import { filter, gain, osc, panner } from './nodes';
import { NoteVoice, VoicePool } from './voices';
import { BellInstrument } from './instruments/bell';
import { PadInstrument } from './instruments/pad';
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
 * Soft, tactile sound effects. Every sound is built from two primitives (filtered noise hit, enveloped
 * tone) plus the bell and a pad for the level-complete swell. Nothing is harsh, nothing sounds "wrong".
 */
export class SfxPlayer {
  private readonly pool: VoicePool;
  private readonly bell: BellInstrument;
  private readonly swell: PadInstrument;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly noise: AudioBuffer,
    private readonly rng: Rng,
  ) {
    this.pool = new VoicePool(28);
    this.bell = new BellInstrument(ctx, out, rng, 14);
    this.swell = new PadInstrument(ctx, out, rng, 2);
  }

  voiceCount(): number {
    return this.pool.size + this.bell.activeVoices + this.swell.activeVoices;
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
    const servo = vary(r, 210 * lift, VARIANCE);
    const glide = 0.3 * (1 + 0.25 * Math.max(0, level));
    this.toneHit(t + 0.03, { type: 'triangle', freq: servo, freqEnd: servo * 1.42, glideSec: glide, peak: vary(r, 0.045, VARIANCE), attack: 0.06, hold: 0.18, tau: 0.07, lowpass: 900 });
  }

  /**
   * Felt thump; a correct drop adds a warm chime at `chimeMidi`. The sub body is backed by its second
   * harmonic and a short felt layer around 600 Hz, so the drop reads as clearly on laptop speakers as
   * on headphones (where the sub alone would boom).
   */
  drop(t: number, chimeMidi: number | null, final = false, level = 0, stackNotes: readonly number[] | null = null): void {
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
    this.chime(t + range(r, 0.04, 0.06), chimeMidi, final, stackNotes);
  }

  /**
   * A zone's warm chime at `t` (after a correct drop's knock, or on its own when lifting a wrong top box leaves the
   * zone satisfied again). A completed stack first climbs through one soft note per box into it.
   */
  chime(t: number, chimeMidi: number, final = false, stackNotes: readonly number[] | null = null): void {
    const r = this.rng;
    let at = t;
    if (stackNotes && stackNotes.length > 1) {
      for (let i = 0; i < stackNotes.length - 1; i++) {
        this.bell.strike(stackNotes[i], at, vary(r, 0.42 + 0.06 * i, VARIANCE), { decay: 1.1 });
        at += STACK_NOTE_GAP;
      }
    }
    this.bell.strike(chimeMidi, at, vary(r, 0.75, VARIANCE));
    // The last zone adds a soft second strike a fourth below (the chord's fifth) for a fuller resolve.
    if (final) this.bell.strike(chimeMidi - 5, at + 0.09, vary(r, 0.4, VARIANCE), { decay: 1.3 });
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
    this.swell.releaseAll();
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
