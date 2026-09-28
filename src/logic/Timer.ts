/**
 * Play-time stopwatch driven by simulation dt (so it naturally pauses when the tab is hidden).
 * `reset()` returns to 0 and stops; `start()` resumes from the accumulated time.
 */
export class Timer {
  private accumulatedMs = 0;
  private isRunning = false;

  get elapsedMs(): number {
    return this.accumulatedMs;
  }

  get running(): boolean {
    return this.isRunning;
  }

  start(): void {
    this.isRunning = true;
  }

  stop(): void {
    this.isRunning = false;
  }

  reset(): void {
    this.accumulatedMs = 0;
    this.isRunning = false;
  }

  /** Accumulate `dt` seconds if running. Non-finite or negative dt is ignored. */
  tick(dt: number): void {
    if (this.isRunning && Number.isFinite(dt) && dt > 0) this.accumulatedMs += dt * 1000;
  }
}
