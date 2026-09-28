import type { Rng } from '../types';
import { range, vary } from '../random';
import { filter, gain, osc, panner } from '../nodes';
import { NoteVoice, VoicePool } from '../voices';

/** Ultra-soft brushed hat and felt kick, kept far back in the mix. */
export class BrushKit {
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

  /** Brush on a snare/hat: filtered noise with a soft swish attack. */
  hat(t0: number, velocity: number): void {
    const { ctx, rng } = this;
    const start = Math.max(t0, ctx.currentTime);
    const v = Math.max(0, Math.min(1, velocity));
    const swish = rng() < 0.3;
    const attack = swish ? 0.018 : 0.004;
    const tau = swish ? 0.07 : vary(rng, 0.035, 0.2);
    const peak = vary(rng, 0.14, 0.1) * v;

    const voice = new NoteVoice(ctx, this.out, this.pool);
    const env = voice.node(gain(ctx, 0));
    env.connect(voice.output);
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + attack);
    env.gain.setTargetAtTime(0, start + attack, tau);

    const pan = voice.node(panner(ctx, range(rng, -0.3, 0.3)));
    pan.connect(env);
    const hp = voice.node(filter(ctx, 'highpass', vary(rng, swish ? 3800 : 6200, 0.08), 0.5));
    hp.connect(pan);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    voice.bufferSource(src, range(rng, 0, Math.max(0, this.noise.duration - 0.5))).connect(hp);
    voice.play(start, start + attack + tau * 7);
  }

  /** Round, felt-muffled kick (a falling sine) — more heartbeat than drum. */
  kick(t0: number, velocity: number): void {
    const { ctx, rng } = this;
    const start = Math.max(t0, ctx.currentTime);
    const v = Math.max(0, Math.min(1, velocity));
    const voice = new NoteVoice(ctx, this.out, this.pool);
    const lp = voice.node(filter(ctx, 'lowpass', 180, 0.5));
    lp.connect(voice.output);
    const env = voice.node(gain(ctx, 0));
    env.connect(lp);
    const peak = vary(rng, 0.15, 0.06) * v;
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(peak, start + 0.006);
    env.gain.setTargetAtTime(0, start + 0.006, 0.13);
    const f0 = vary(rng, 92, 0.04);
    const body = voice.source(osc(ctx, 'sine', f0));
    body.frequency.setValueAtTime(f0, start);
    body.frequency.exponentialRampToValueAtTime(46, start + 0.16);
    body.connect(env);
    voice.play(start, start + 1);
  }

  releaseAll(): void {
    this.pool.releaseAll(this.ctx.currentTime);
  }
}
