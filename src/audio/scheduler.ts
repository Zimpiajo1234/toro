/** Anything with an audio clock (an AudioContext, or a fake in tests). */
export interface Clock {
  readonly currentTime: number;
}

export interface SchedulerOptions {
  /** Length of one grid step, seconds. */
  stepSec: number;
  /** Timer period, ms. */
  intervalMs?: number;
  /** How far ahead of the clock steps are scheduled, seconds. */
  horizonSec?: number;
  /** Delay before the first step, seconds. */
  startDelaySec?: number;
}

/** Steps due later than this (after a main-thread stall) are skipped rather than played off the grid. */
const LATE_TOLERANCE_SEC = 0.02;

/**
 * Classic look-ahead scheduler ("A tale of two clocks"): a coarse JS timer wakes up every ~25 ms and
 * schedules every grid step that falls inside the next ~0.2 s of audio-clock time. When the clock is
 * frozen (suspended context) nothing is scheduled; after a main-thread stall steps already in the past
 * are skipped instead of being played late or in a burst.
 */
export class LookaheadScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private readonly intervalMs: number;
  private readonly horizonSec: number;
  private readonly startDelaySec: number;

  constructor(
    private readonly clock: Clock,
    private readonly onStep: (step: number, time: number) => void,
    private readonly options: SchedulerOptions,
  ) {
    this.intervalMs = options.intervalMs ?? 25;
    this.horizonSec = options.horizonSec ?? 0.2;
    this.startDelaySec = options.startDelaySec ?? 0.1;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Audio time of the next step that has not been scheduled yet. */
  get nextStepTime(): number {
    return this.nextTime;
  }

  start(): void {
    if (this.timer !== null) return;
    this.step = 0;
    this.nextTime = this.clock.currentTime + this.startDelaySec;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Audio time of the first step at or after `time` whose index is a multiple of `division`. */
  nextGridTime(division: number, time: number): number {
    const stepSec = this.options.stepSec;
    let s = this.step;
    let t = this.nextTime;
    while (t - stepSec >= time && s > 0) {
      t -= stepSec;
      s--;
    }
    while (t < time || s % division !== 0) {
      t += stepSec;
      s++;
    }
    return t;
  }

  /** Schedules due steps. Public so tests can drive it without timers. */
  tick(): void {
    const now = this.clock.currentTime;
    const stepSec = this.options.stepSec;
    const latest = now - LATE_TOLERANCE_SEC;
    if (this.nextTime < latest) {
      const missed = Math.ceil((latest - this.nextTime) / stepSec);
      this.step += missed;
      this.nextTime += missed * stepSec;
    }
    const until = now + this.horizonSec;
    while (this.nextTime < until) {
      this.onStep(this.step, this.nextTime);
      this.step++;
      this.nextTime += stepSec;
    }
  }
}
