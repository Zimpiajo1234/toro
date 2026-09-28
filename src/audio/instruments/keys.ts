import type { Rng } from '../types';
import { range, vary } from '../random';
import { midiToFreq } from '../music/harmony';
import { disconnectAll, filter, gain, osc, panner } from '../nodes';
import { NoteVoice, VoicePool } from '../voices';

export interface KeysNoteOptions {
  /** Scales FM index and tine level (1 = default, melody uses a touch more). */
  brightness?: number;
  /** Level multiplier (single melody notes sit a little forward of the comping chords). */
  level?: number;
}

/** Persistent strip shared by every keys voice: soft low-pass and a slow Rhodes-style auto-pan. */
export interface KeysChannel {
  input: AudioNode;
  dispose(): void;
}

export function createKeysChannel(ctx: BaseAudioContext, out: AudioNode): KeysChannel {
  const lp = filter(ctx, 'lowpass', 3000, 0.5);
  const pan = panner(ctx, 0);
  lp.connect(pan);
  pan.connect(out);
  const nodes: AudioNode[] = [lp, pan];
  let lfo: OscillatorNode | null = null;
  if ('pan' in pan) {
    lfo = osc(ctx, 'sine', 0.85);
    const depth = gain(ctx, 0.22);
    lfo.connect(depth);
    depth.connect(pan.pan);
    lfo.start();
    nodes.push(lfo, depth);
  }
  return {
    input: lp,
    dispose() {
      try {
        lfo?.stop();
      } catch {
        /* already stopped */
      }
      disconnectAll(nodes);
    },
  };
}

/**
 * Electric-piano-ish keys: a sine carrier with a 1:1 FM modulator whose index decays after the
 * strike (warm "bark" → mellow tone), plus a faint two-octave tine that fades within ~0.1 s.
 */
export class KeysInstrument {
  private readonly pool: VoicePool;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly rng: Rng,
    maxVoices = 18,
  ) {
    this.pool = new VoicePool(maxVoices);
  }

  get activeVoices(): number {
    return this.pool.size;
  }

  /** Rolls a chord upward with `strumSec` between notes and a little velocity variance. */
  playChord(midis: readonly number[], t0: number, duration: number, velocity: number, strumSec = 0.015, options: KeysNoteOptions = {}): void {
    let t = t0;
    for (let i = 0; i < midis.length; i++) {
      this.playNote(midis[i], t, Math.max(0.15, duration - (t - t0)), vary(this.rng, velocity, 0.12), options);
      t += strumSec * range(this.rng, 0.7, 1.3);
    }
  }

  playNote(midi: number, t0: number, duration: number, velocity: number, options: KeysNoteOptions = {}): void {
    const { ctx, rng } = this;
    const start = Math.max(t0, ctx.currentTime);
    const f = midiToFreq(midi);
    const v = Math.max(0.05, Math.min(1, velocity));
    const bright = options.brightness ?? 1;
    const releaseAt = start + Math.max(0.1, duration);
    // Higher notes decay a little faster, like a real tine.
    const decayTau = 1.1 * Math.pow(261.6 / f, 0.35);
    const peak = 0.24 * Math.pow(v, 1.4) * (options.level ?? 1);

    const voice = new NoteVoice(ctx, this.out, this.pool);
    const amp = voice.node(gain(ctx, 0));
    amp.connect(voice.output);
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(peak, start + 0.006);
    amp.gain.setTargetAtTime(peak * 0.28, start + 0.006, decayTau);
    amp.gain.setTargetAtTime(0, releaseAt, 0.18);

    const carrier = voice.source(osc(ctx, 'sine', f));
    carrier.detune.value = range(rng, -3, 3);
    carrier.connect(amp);

    const mod = voice.source(osc(ctx, 'sine', f));
    mod.detune.value = range(rng, 2, 6);
    const modDepth = voice.node(gain(ctx, 0));
    const index = (0.5 + 1.5 * v) * bright;
    modDepth.gain.setValueAtTime(0, start);
    modDepth.gain.linearRampToValueAtTime(index * f, start + 0.004);
    modDepth.gain.setTargetAtTime(0.22 * f * bright, start + 0.004, 0.28);
    mod.connect(modDepth);
    modDepth.connect(carrier.frequency);

    const tine = voice.source(osc(ctx, 'sine', f * 4));
    const tineEnv = voice.node(gain(ctx, 0));
    const tinePeak = 0.22 * v * bright * (f > 700 ? 0.5 : 1);
    tineEnv.gain.setValueAtTime(0, start);
    tineEnv.gain.linearRampToValueAtTime(tinePeak, start + 0.003);
    tineEnv.gain.setTargetAtTime(0, start + 0.003, 0.045);
    tine.connect(tineEnv);
    tineEnv.connect(amp);

    voice.play(start, releaseAt + 1.1);
  }

  releaseAll(): void {
    this.pool.releaseAll(this.ctx.currentTime);
  }
}
