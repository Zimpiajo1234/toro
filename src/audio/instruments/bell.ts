import type { Rng } from '../types';
import { range, vary } from '../random';
import { midiToFreq } from '../music/harmony';
import { filter, gain, osc, panner } from '../nodes';
import { NoteVoice, VoicePool } from '../voices';

export interface BellOptions {
  /** Scales every decay (1 = default ≈ 0.6 s body). */
  decay?: number;
  pan?: number;
}

/** [ratio, relative level, decay factor] — soft marimba / felt-bell partials. */
const PARTIALS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [2, 0.22, 0.5],
  [3.98, 0.14, 0.13],
  [9.2, 0.03, 0.03],
];

/**
 * Warm bell / marimba strike. Pitch variance is kept to a few cents so it stays in tune with the
 * music; variation comes from level, partial balance, decay and pan instead.
 */
export class BellInstrument {
  private readonly pool: VoicePool;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly rng: Rng,
    maxVoices = 12,
  ) {
    this.pool = new VoicePool(maxVoices);
  }

  get activeVoices(): number {
    return this.pool.size;
  }

  strike(midi: number, t0: number, velocity: number, options: BellOptions = {}): void {
    const { ctx, rng } = this;
    const start = Math.max(t0, ctx.currentTime);
    const f = midiToFreq(midi);
    const v = Math.max(0.05, Math.min(1, velocity));
    const decay = (options.decay ?? 1) * vary(rng, 0.62, 0.08);

    const voice = new NoteVoice(ctx, this.out, this.pool);
    const lp = voice.node(filter(ctx, 'lowpass', vary(rng, 4200, 0.06), 0.4));
    const pan = voice.node(panner(ctx, options.pan ?? range(rng, -0.25, 0.25)));
    lp.connect(pan);
    pan.connect(voice.output);

    for (const [ratio, level, decayFactor] of PARTIALS) {
      const pf = f * ratio;
      if (pf > 9000) continue;
      const o = voice.source(osc(ctx, 'sine', pf));
      o.detune.value = range(rng, -2.5, 2.5);
      const env = voice.node(gain(ctx, 0));
      const peak = 0.2 * v * level * vary(rng, 1, 0.12);
      const tau = Math.max(0.01, decay * decayFactor);
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(peak, start + 0.003);
      env.gain.setTargetAtTime(0, start + 0.003, tau);
      o.connect(env);
      env.connect(lp);
    }
    voice.play(start, start + decay * 7 + 0.05);
  }

  releaseAll(): void {
    this.pool.releaseAll(this.ctx.currentTime);
  }
}
