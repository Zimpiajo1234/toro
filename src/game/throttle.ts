/**
 * Rate-limits publishing the play timer to the UI store. The timer is driven by simulation dt, so
 * "moved at least `stepMs`" is the same as "at most every `stepMs` of play" (~10 Hz for 100 ms).
 * A value that goes backwards (reset / restart) is always let through.
 */
export class ElapsedThrottle {
  private readonly stepMs: number;
  private lastMs = 0;

  constructor(stepMs = 100) {
    this.stepMs = stepMs;
  }

  /** True when `ms` should be pushed; the value is then remembered as published. */
  shouldPublish(ms: number): boolean {
    if (ms === this.lastMs) return false;
    if (ms < this.lastMs || ms - this.lastMs >= this.stepMs) {
      this.lastMs = ms;
      return true;
    }
    return false;
  }

  /** Record a value that was published out of band (the final time on stop, or 0 on reset). */
  markPublished(ms: number): void {
    this.lastMs = ms;
  }
}
