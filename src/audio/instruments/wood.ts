import type { Rng } from '../types';
import { range, vary } from '../random';
import { midiToFreq } from '../music/harmony';
import { filter, gain, osc, panner } from '../nodes';
import { NoteVoice, VoicePool } from '../voices';

export interface WoodOptions {
  /** Scales every decay (1 = default ≈ 0.3 s body at G4). */
  decay?: number;
  pan?: number;
}

/**
 * [ratio, relative level, decay factor] — a soft-mallet marimba bar: the fundamental, the bar's tuned two-octave
 * partial (a touch flat, which is what makes it sound wooden) and a faint third one, all short.
 */
export const WOOD_PARTIALS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [3.93, 0.16, 0.2],
  [9.2, 0.02, 0.06],
];
/** Low-pass over the whole strike: warm, never clicky. */
export const WOOD_LOWPASS_HZ = 2600;

/**
 * Soft wooden marimba / block strike: sine partials that die away quickly plus a tiny felt-mallet knock (filtered
 * noise). Tuned like the bell (a few cents of variance only) so it sits in the music's key; variation comes from
 * level, decay and pan. Rings when a zone accepts a box by its symbol.
 */
export class WoodInstrument {
  private readonly pool: VoicePool;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly noise: AudioBuffer,
    private readonly rng: Rng,
    maxVoices = 10,
  ) {
    this.pool = new VoicePool(maxVoices);
  }

  get activeVoices(): number {
    return this.pool.size;
  }

  strike(midi: number, t0: number, velocity: number, options: WoodOptions = {}): void {
    const { ctx, rng } = this;
    const start = Math.max(t0, ctx.currentTime);
    const f = midiToFreq(midi);
    const v = Math.max(0.05, Math.min(1, velocity));
    // Higher bars ring a little shorter, like real ones.
    const decay = (options.decay ?? 1) * vary(rng, 0.3, 0.08) * Math.pow(392 / f, 0.3);

    const voice = new NoteVoice(ctx, this.out, this.pool);
    const lp = voice.node(filter(ctx, 'lowpass', vary(rng, WOOD_LOWPASS_HZ, 0.05), 0.5));
    const pan = voice.node(panner(ctx, options.pan ?? range(rng, -0.25, 0.25)));
    lp.connect(pan);
    pan.connect(voice.output);

    for (const [ratio, level, decayFactor] of WOOD_PARTIALS) {
      const pf = f * ratio;
      if (pf > 9000) continue;
      const o = voice.source(osc(ctx, 'sine', pf));
      o.detune.value = range(rng, -3, 3);
      const env = voice.node(gain(ctx, 0));
      const peak = 0.26 * v * level * vary(rng, 1, 0.1);
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(peak, start + 0.002);
      env.gain.setTargetAtTime(0, start + 0.002, Math.max(0.008, decay * decayFactor));
      o.connect(env);
      env.connect(lp);
    }

    // The felt mallet touching the bar: a very short, soft knock around the bar's second octave.
    const knock = voice.node(filter(ctx, 'bandpass', Math.min(2200, Math.max(700, f * 2.2)), 1.4));
    const knockEnv = voice.node(gain(ctx, 0));
    knockEnv.gain.setValueAtTime(0, start);
    knockEnv.gain.linearRampToValueAtTime(0.06 * v, start + 0.0015);
    knockEnv.gain.setTargetAtTime(0, start + 0.0015, 0.007);
    knock.connect(knockEnv);
    knockEnv.connect(lp);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    voice.bufferSource(src, range(rng, 0, Math.max(0, this.noise.duration - 0.5))).connect(knock);

    voice.play(start, start + decay * 7 + 0.05);
  }

  releaseAll(): void {
    this.pool.releaseAll(this.ctx.currentTime);
  }
}
