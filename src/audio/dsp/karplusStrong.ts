import type { Rng } from '../types';

export interface PluckRenderOptions {
  /** Seconds for the note to decay by 60 dB. */
  t60?: number;
  /** 0‥1: low-pass on the noise burst (lower = softer, nylon-like). */
  brightness?: number;
  /** 0‥0.5: pluck position along the string (comb on the excitation). */
  position?: number;
  /** Buffer length, seconds (a short fade-out is applied at the end). */
  duration?: number;
}

/**
 * Karplus–Strong plucked string, rendered offline into a mono buffer (peak-normalised to 0.9).
 * The loop uses the classic two-tap average plus a first-order all-pass for exact fractional tuning.
 */
export function renderKarplusStrong(sampleRate: number, freq: number, rng: Rng, options: PluckRenderOptions = {}): Float32Array {
  const t60 = options.t60 ?? 1.4;
  const brightness = options.brightness ?? 0.5;
  const position = options.position ?? 0.18;
  const duration = options.duration ?? Math.min(2.2, t60 + 0.3);
  const length = Math.max(1, Math.floor(sampleRate * duration));
  const out = new Float32Array(length);

  // The averaging filter adds half a sample of delay; the all-pass supplies the fractional remainder.
  const period = sampleRate / freq;
  const delay = Math.max(2, Math.floor(period - 0.5));
  const frac = Math.max(0.01, Math.min(0.99, period - 0.5 - delay));
  const apCoef = (1 - frac) / (1 + frac);
  // Loop gain per period for the requested decay time.
  const loopGain = Math.min(0.9995, Math.pow(0.001, 1 / (freq * t60)));

  // Excitation: low-passed noise burst with a pluck-position comb, DC removed.
  const line = new Float32Array(delay);
  let lp = 0;
  const a = 0.08 + 0.9 * Math.max(0, Math.min(1, brightness));
  for (let i = 0; i < delay; i++) {
    lp += a * (rng() * 2 - 1 - lp);
    line[i] = lp;
  }
  const combTap = Math.max(1, Math.floor(delay * position));
  for (let i = delay - 1; i >= combTap; i--) line[i] -= line[i - combTap];
  let mean = 0;
  for (let i = 0; i < delay; i++) mean += line[i];
  mean /= delay;
  for (let i = 0; i < delay; i++) line[i] -= mean;

  let idx = 0;
  let prev = 0;
  let apIn = 0;
  let apOut = 0;
  let dcIn = 0;
  let dcOut = 0;
  let peak = 1e-9;
  for (let n = 0; n < length; n++) {
    const cur = line[idx];
    const avg = loopGain * 0.5 * (cur + prev);
    prev = cur;
    const ap = apCoef * avg + apIn - apCoef * apOut;
    apIn = avg;
    apOut = ap;
    line[idx] = ap;
    idx = idx + 1 === delay ? 0 : idx + 1;
    // Gentle DC blocker on the output.
    dcOut = cur - dcIn + 0.995 * dcOut;
    dcIn = cur;
    out[n] = dcOut;
    const mag = dcOut < 0 ? -dcOut : dcOut;
    if (mag > peak) peak = mag;
  }

  const gain = 0.9 / peak;
  const fadeStart = Math.floor(length * 0.85);
  for (let n = 0; n < length; n++) {
    const fade = n < fadeStart ? 1 : 1 - (n - fadeStart) / (length - fadeStart);
    out[n] *= gain * fade;
  }
  return out;
}
