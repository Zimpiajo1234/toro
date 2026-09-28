import type { Rng } from '../types';

export interface ImpulseOptions {
  seconds?: number;
  /** Envelope curvature: higher = shorter, drier tail. */
  decay?: number;
  preDelaySec?: number;
  /** One-pole low-pass amount that grows along the tail (warm, dark reverb). 0‥1 */
  damping?: number;
}

/**
 * Stereo impulse response for a small warm room: decaying noise that darkens over time.
 * Rendered procedurally so the game ships no audio files.
 */
export function renderImpulse(sampleRate: number, rng: Rng, options: ImpulseOptions = {}): [Float32Array, Float32Array] {
  const seconds = options.seconds ?? 2.2;
  const decay = options.decay ?? 3.2;
  const preDelay = Math.floor((options.preDelaySec ?? 0.012) * sampleRate);
  const damping = options.damping ?? 0.85;
  const length = Math.max(preDelay + 1, Math.floor(seconds * sampleRate));
  const channels: [Float32Array, Float32Array] = [new Float32Array(length), new Float32Array(length)];
  for (const data of channels) {
    let lp = 0;
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / (length - preDelay);
      const env = Math.pow(1 - t, decay);
      // Coefficient falls from ~1 (bright early reflections) to (1 - damping) (dark tail).
      const k = 1 - damping * Math.sqrt(t);
      lp += k * (rng() * 2 - 1 - lp);
      data[i] = lp * env;
    }
  }
  return channels;
}

/** Fills `out` with white noise in [-1, 1). */
export function fillNoise(out: Float32Array, rng: Rng): Float32Array {
  for (let i = 0; i < out.length; i++) out[i] = rng() * 2 - 1;
  return out;
}
