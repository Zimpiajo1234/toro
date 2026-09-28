import type { Rng } from '../types';
import { range } from '../random';
import { midiToFreq } from '../music/harmony';
import { filter, gain, osc, panner } from '../nodes';
import { NoteVoice, VoicePool } from '../voices';

export interface PadOptions {
  /** Seconds to reach full level. */
  attack?: number;
  /** Release time constant, seconds (the tail lasts ≈ 5×). */
  release?: number;
  /** Scales the filter opening (1 = default warmth). */
  brightness?: number;
  /** Overall level multiplier. */
  level?: number;
  /**
   * Monophonic sub-bass: when set, the bass attacks quickly and hands over `bassOverlap` seconds before
   * the chord releases (the next bar line when consecutive pads overlap by that much), so neighbouring
   * roots never sound together. Unset, the bass tails off with the chord.
   */
  bassOverlap?: number;
}

/** Bass attack / hand-over release (τ) in monophonic mode: click-free at 65 Hz, no low-end dip. */
const BASS_HANDOVER_ATTACK = 0.2;
const BASS_HANDOVER_TAU = 0.12;

/**
 * Warm analog-style pad: per note a detuned saw + triangle pair, spread in stereo, through one
 * slowly-opening low-pass per chord; plus a soft sine sub-bass on the root.
 */
export class PadInstrument {
  private readonly pool: VoicePool;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly rng: Rng,
    maxChords = 4,
  ) {
    this.pool = new VoicePool(maxChords);
  }

  get activeVoices(): number {
    return this.pool.size;
  }

  /** Sustains `midis` from `t0` for `duration` seconds, then releases slowly. */
  play(midis: readonly number[], bass: number | null, t0: number, duration: number, velocity: number, options: PadOptions = {}): void {
    if (midis.length === 0 && bass === null) return;
    const { ctx, rng } = this;
    const start = Math.max(t0, ctx.currentTime);
    const attack = options.attack ?? range(rng, 1.2, 1.8);
    const releaseTau = options.release ?? 0.9;
    const releaseAt = start + Math.max(duration, 0.1);
    const attackEnd = Math.min(start + attack, releaseAt);
    const level = options.level ?? 1;
    const voice = new NoteVoice(ctx, this.out, this.pool);

    if (midis.length > 0) {
      const env = voice.node(gain(ctx, 0));
      env.connect(voice.output);
      const lp = voice.node(filter(ctx, 'lowpass', 380, 0.5));
      lp.connect(env);
      const open = (options.brightness ?? 1) * range(rng, 850, 1300);
      const openAt = Math.min(start + attack * 1.3, releaseAt);
      lp.frequency.setValueAtTime(380, start);
      lp.frequency.linearRampToValueAtTime(open, openAt);
      lp.frequency.setTargetAtTime(open * 0.72, openAt, 2.2);
      lp.frequency.setTargetAtTime(320, releaseAt, releaseTau * 1.4);

      const peak = 0.075 * velocity * level * Math.sqrt(4 / midis.length);
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(peak, attackEnd);
      env.gain.setTargetAtTime(0, releaseAt, releaseTau);

      for (const m of midis) {
        const f = midiToFreq(m);
        const pan = voice.node(panner(ctx, range(rng, -0.45, 0.45)));
        pan.connect(lp);
        const saw = voice.source(osc(ctx, 'sawtooth', f));
        saw.detune.value = range(rng, -9, -3);
        saw.connect(pan);
        const tri = voice.source(osc(ctx, 'triangle', f));
        tri.detune.value = range(rng, 3, 9);
        tri.connect(pan);
      }
    }

    if (bass !== null) {
      const f = midiToFreq(bass);
      const benv = voice.node(gain(ctx, 0));
      benv.connect(voice.output);
      const bpeak = 0.13 * velocity * level;
      const handover = options.bassOverlap;
      const bassPeakAt = Math.min(start + (handover === undefined ? 0.35 : BASS_HANDOVER_ATTACK), releaseAt);
      const bassReleaseAt = handover === undefined ? releaseAt : Math.max(bassPeakAt, releaseAt - handover);
      benv.gain.setValueAtTime(0, start);
      benv.gain.linearRampToValueAtTime(bpeak, bassPeakAt);
      benv.gain.setTargetAtTime(bpeak * 0.75, bassPeakAt, 1.2);
      benv.gain.setTargetAtTime(0, bassReleaseAt, handover === undefined ? Math.min(0.5, releaseTau) : BASS_HANDOVER_TAU);
      const sub = voice.source(osc(ctx, 'sine', f));
      sub.connect(benv);
      // A quiet second harmonic keeps the bass audible on small speakers.
      const h2 = voice.node(gain(ctx, 0.18));
      h2.connect(benv);
      const over = voice.source(osc(ctx, 'sine', f * 2));
      over.connect(h2);
    }

    voice.play(start, releaseAt + releaseTau * 6);
  }

  releaseAll(): void {
    this.pool.releaseAll(this.ctx.currentTime);
  }
}
