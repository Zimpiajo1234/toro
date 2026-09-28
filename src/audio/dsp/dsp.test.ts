import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../random';
import { renderKarplusStrong } from './karplusStrong';
import { fillNoise, renderImpulse } from './impulse';

const SR = 48000;

function rms(data: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Fundamental period via autocorrelation (search within ±20 % of the expected lag). */
function estimatePeriod(data: Float32Array, expected: number, from: number, len: number): number {
  let bestLag = 0;
  let best = -Infinity;
  const lo = Math.floor(expected * 0.8);
  const hi = Math.ceil(expected * 1.2);
  for (let lag = lo; lag <= hi; lag++) {
    let s = 0;
    for (let i = from; i < from + len; i++) s += data[i] * data[i + lag];
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  // Parabolic interpolation for sub-sample accuracy.
  const corr = (lag: number) => {
    let s = 0;
    for (let i = from; i < from + len; i++) s += data[i] * data[i + lag];
    return s;
  };
  const a = corr(bestLag - 1);
  const b = corr(bestLag);
  const c = corr(bestLag + 1);
  const denom = a - 2 * b + c;
  return denom === 0 ? bestLag : bestLag + (0.5 * (a - c)) / denom;
}

describe('renderKarplusStrong', () => {
  it('is finite, bounded and normalised', () => {
    const out = renderKarplusStrong(SR, 220, mulberry32(1));
    let peak = 0;
    for (const v of out) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeLessThanOrEqual(0.9001);
    expect(peak).toBeGreaterThan(0.5);
  });

  it('decays like a plucked string and fades to silence at the end', () => {
    const out = renderKarplusStrong(SR, 196, mulberry32(2), { t60: 1.2 });
    const early = rms(out, 0, Math.floor(SR * 0.1));
    const late = rms(out, Math.floor(SR * 1.0), Math.floor(SR * 1.1));
    expect(late).toBeLessThan(early * 0.1);
    expect(Math.abs(out[out.length - 1])).toBeLessThan(1e-3);
  });

  it('is in tune (fractional delay compensation)', () => {
    for (const freq of [110, 196, 329.63, 523.25]) {
      const out = renderKarplusStrong(SR, freq, mulberry32(3), { t60: 1.8 });
      const expected = SR / freq;
      const period = estimatePeriod(out, expected, Math.floor(SR * 0.05), 4096);
      const cents = 1200 * Math.log2(expected / period);
      expect(Math.abs(cents)).toBeLessThan(8);
    }
  });
});

describe('renderImpulse', () => {
  it('renders a decaying stereo tail with a pre-delay', () => {
    const [l, r] = renderImpulse(SR, mulberry32(4), { seconds: 1.5, preDelaySec: 0.01 });
    expect(l.length).toBe(Math.floor(SR * 1.5));
    expect(r.length).toBe(l.length);
    expect(l[0]).toBe(0);
    const head = rms(l, Math.floor(SR * 0.02), Math.floor(SR * 0.2));
    const tail = rms(l, Math.floor(SR * 1.2), Math.floor(SR * 1.45));
    expect(tail).toBeLessThan(head * 0.1);
    for (const v of r) expect(Number.isFinite(v)).toBe(true);
    expect(l).not.toEqual(r);
  });

  it('fills white noise in [-1, 1)', () => {
    const n = fillNoise(new Float32Array(1000), mulberry32(5));
    for (const v of n) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
  });
});
