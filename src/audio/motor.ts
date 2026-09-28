import { disconnectAll, filter, gain, glideParam, osc } from './nodes';

/** Parameter changes smaller than these are not sent (keeps the automation timeline tiny). */
const SPEED_EPSILON = 0.004;
const FORK_EPSILON = 0.01;

/**
 * Continuous electric-motor bed: two soft oscillators (plus a whisper of whine) through a low-pass
 * whose level, pitch and brightness follow the forklift speed, and a separate fork-servo tone.
 * Built once; `set()` is called every frame and allocates nothing.
 */
export class MotorSound {
  private readonly humA: OscillatorNode;
  private readonly humB: OscillatorNode;
  private readonly whine: OscillatorNode;
  private readonly humFilter: BiquadFilterNode;
  private readonly humGain: GainNode;
  private readonly servo: OscillatorNode;
  private readonly servoGain: GainNode;
  private readonly nodes: AudioNode[];
  private lastSpeed = -1;
  private lastFork = -1;

  constructor(private readonly ctx: BaseAudioContext, out: AudioNode) {
    this.humGain = gain(ctx, 0);
    this.humGain.connect(out);
    this.humFilter = filter(ctx, 'lowpass', 220, 0.6);
    this.humFilter.connect(this.humGain);

    this.humA = osc(ctx, 'triangle', 52);
    this.humA.connect(this.humFilter);
    this.humB = osc(ctx, 'sine', 104.4);
    const humBLevel = gain(ctx, 0.6);
    this.humB.connect(humBLevel);
    humBLevel.connect(this.humFilter);
    this.whine = osc(ctx, 'sine', 312);
    const whineLevel = gain(ctx, 0.08);
    this.whine.connect(whineLevel);
    whineLevel.connect(this.humFilter);

    this.servoGain = gain(ctx, 0);
    this.servoGain.connect(out);
    const servoFilter = filter(ctx, 'lowpass', 850, 0.7);
    servoFilter.connect(this.servoGain);
    this.servo = osc(ctx, 'triangle', 300);
    this.servo.connect(servoFilter);

    this.nodes = [this.humA, this.humB, this.whine, humBLevel, whineLevel, this.humFilter, this.humGain, this.servo, servoFilter, this.servoGain];
    const t = ctx.currentTime;
    for (const o of [this.humA, this.humB, this.whine, this.servo]) o.start(t);
  }

  /** speed01 / forkMotion01 in 0‥1. Smoothing is done by the audio thread (setTargetAtTime). */
  set(speed01: number, forkMotion01: number): void {
    const now = this.ctx.currentTime;
    const s = clamp01(speed01);
    if (Math.abs(s - this.lastSpeed) > SPEED_EPSILON || (s === 0 && this.lastSpeed !== 0)) {
      this.lastSpeed = s;
      const base = 52 + 44 * s;
      glideParam(this.humGain.gain, 0.15 * Math.pow(s, 0.9), now, s > 0 ? 0.12 : 0.22);
      glideParam(this.humA.frequency, base, now, 0.15);
      glideParam(this.humB.frequency, base * 2.008, now, 0.15);
      glideParam(this.whine.frequency, base * 6, now, 0.15);
      glideParam(this.humFilter.frequency, 220 + 520 * s, now, 0.15);
    }
    const f = clamp01(forkMotion01);
    if (Math.abs(f - this.lastFork) > FORK_EPSILON || (f === 0 && this.lastFork !== 0)) {
      this.lastFork = f;
      glideParam(this.servoGain.gain, 0.05 * f, now, f > 0 ? 0.06 : 0.12);
      glideParam(this.servo.frequency, 300 + 160 * f, now, 0.1);
    }
  }

  /** Fade to silence quickly (e.g. before suspending). */
  silence(): void {
    this.set(0, 0);
  }

  dispose(): void {
    for (const o of [this.humA, this.humB, this.whine, this.servo]) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    disconnectAll(this.nodes);
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0;
}
