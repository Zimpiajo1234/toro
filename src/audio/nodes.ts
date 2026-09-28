/** Click-free AudioParam helpers and small node factories. */

/** Freezes a param at its current value at time `t`, dropping later automation. */
export function holdParam(param: AudioParam, t: number): void {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(t);
  } else {
    const v = param.value;
    param.cancelScheduledValues(t);
    param.setValueAtTime(v, t);
  }
}

/** Linear ramp from wherever the param is now to `value` over `duration` seconds. */
export function rampParam(param: AudioParam, value: number, now: number, duration: number): void {
  holdParam(param, now);
  param.linearRampToValueAtTime(value, now + Math.max(0.005, duration));
}

/** Exponential approach from the current value (never a jump). */
export function glideParam(param: AudioParam, value: number, now: number, timeConstant: number): void {
  holdParam(param, now);
  param.setTargetAtTime(value, now, Math.max(0.001, timeConstant));
}

export function gain(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/**
 * Value for `BiquadFilterNode.Q` from a linear (textbook) Q. Web Audio reads Q in dB for low-pass and
 * high-pass filters (resonance = 10^(Q/20)), so 0.707 → -3.01 dB (Butterworth, no bump) and 0.5 → -6.02 dB.
 * Band-pass, peaking, notch and all-pass read the linear value as is.
 */
export function biquadQ(type: BiquadFilterType, q: number): number {
  return type === 'lowpass' || type === 'highpass' ? 20 * Math.log10(Math.max(1e-4, q)) : q;
}

/** Biquad with a linear `q` (0.707 = flat Butterworth for low/high-pass; lower = softer knee). */
export function filter(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = biquadQ(type, q);
  return f;
}

export function osc(ctx: BaseAudioContext, type: OscillatorType, frequency: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = frequency;
  return o;
}

/** Stereo panner when available (it is everywhere modern); plain gain otherwise. */
export function panner(ctx: BaseAudioContext, pan: number): StereoPannerNode | GainNode {
  if (typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    return p;
  }
  return gain(ctx, 1);
}

export function disconnectAll(nodes: readonly AudioNode[]): void {
  for (const n of nodes) {
    try {
      n.disconnect();
    } catch {
      /* already disconnected */
    }
  }
}
