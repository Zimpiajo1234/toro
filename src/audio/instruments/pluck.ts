import type { Rng } from '../types';
import { centsToRatio, range } from '../random';
import { midiToFreq } from '../music/harmony';
import { renderKarplusStrong } from '../dsp/karplusStrong';
import { disconnectAll, filter, gain, panner } from '../nodes';
import { NoteVoice, VoicePool } from '../voices';

export interface PluckOptions {
  /** Scales the low-pass opening (1 = default). */
  tone?: number;
  /** Fixed pan instead of a random one. */
  pan?: number;
  level?: number;
}

/**
 * Soft ambient guitar: Karplus–Strong strings pre-rendered once per pitch (LRU cache) and played
 * through a small body resonance. Each pluck gets its own detune, tone, pan and level.
 */
export class PluckInstrument {
  private readonly pool: VoicePool;
  private readonly cache = new Map<number, AudioBuffer>();
  private readonly body: BiquadFilterNode;
  private readonly air: BiquadFilterNode;

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    private readonly rng: Rng,
    maxVoices = 10,
    private readonly maxCache = 32,
  ) {
    this.pool = new VoicePool(maxVoices);
    // Persistent strip: a gentle wooden body bump and a high cut.
    this.body = filter(ctx, 'peaking', 210, 0.9);
    this.body.gain.value = 3;
    this.air = filter(ctx, 'highpass', 70, 0.6);
    this.body.connect(this.air);
    this.air.connect(out);
  }

  get activeVoices(): number {
    return this.pool.size;
  }

  play(midi: number, t0: number, velocity: number, options: PluckOptions = {}): void {
    const { ctx, rng } = this;
    const start = Math.max(t0, ctx.currentTime);
    const v = Math.max(0.05, Math.min(1, velocity));
    const buffer = this.buffer(midi);
    const rate = centsToRatio(range(rng, -5, 5));

    const voice = new NoteVoice(ctx, this.body, this.pool);
    const amp = voice.node(gain(ctx, 0));
    amp.connect(voice.output);
    const peak = 1.1 * Math.pow(v, 1.2) * (options.level ?? 1);
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(peak, start + 0.004);

    const pan = voice.node(panner(ctx, options.pan ?? range(rng, -0.4, 0.4)));
    pan.connect(amp);
    const lp = voice.node(filter(ctx, 'lowpass', (options.tone ?? 1) * range(rng, 1700, 2700) * (0.7 + 0.3 * v), 0.6));
    lp.connect(pan);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    voice.bufferSource(src, 0).connect(lp);
    voice.play(start, start + buffer.duration / rate + 0.05);
  }

  /** Pre-renders the given pitches so the first plucks cost nothing at play time. */
  warm(midis: readonly number[]): void {
    for (const m of midis) this.buffer(m);
  }

  releaseAll(): void {
    this.pool.releaseAll(this.ctx.currentTime);
  }

  dispose(): void {
    this.releaseAll();
    disconnectAll([this.body, this.air]);
    this.cache.clear();
  }

  private buffer(midi: number): AudioBuffer {
    const key = Math.round(midi);
    const cached = this.cache.get(key);
    if (cached) {
      // Refresh LRU order.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const sr = this.ctx.sampleRate;
    const t60 = Math.max(0.9, Math.min(1.9, 1.9 - (key - 48) * 0.03));
    const data = renderKarplusStrong(sr, midiToFreq(key), this.rng, { t60, brightness: 0.42, position: 0.17 });
    const buffer = this.ctx.createBuffer(1, data.length, sr);
    buffer.getChannelData(0).set(data);
    this.cache.set(key, buffer);
    if (this.cache.size > this.maxCache) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return buffer;
  }
}
