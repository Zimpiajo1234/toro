/** Allocation-free animation helpers used by the views. Easing curves live in core/math. */

/**
 * A one-shot timeline with an optional start delay. `p` is the progress 0…1 of the current run.
 * Typical use: `if (anim.step(dt)) apply(anim.p)`.
 */
export class OneShot {
  p = 0;
  private elapsed = 0;
  private running = false;

  constructor(readonly duration: number) {}

  /** (Re)start the timeline. A positive delay postpones progress. */
  start(delay = 0): void {
    this.elapsed = -delay;
    this.running = true;
    this.p = 0;
  }

  stop(): void {
    this.running = false;
  }

  /** True from start() until the end (including while delayed). */
  get active(): boolean {
    return this.running;
  }

  /** Advance time. Returns true while progressing (past the delay), including the final frame at p = 1. */
  step(dt: number): boolean {
    if (!this.running) return false;
    this.elapsed += dt;
    if (this.elapsed < 0) return false;
    this.p = Math.min(1, this.elapsed / this.duration);
    if (this.p >= 1) this.running = false;
    return true;
  }
}

/** sin(πp): 0 → 1 → 0 bump over p ∈ [0, 1]. */
export function bump(p: number): number {
  return Math.sin(Math.PI * p);
}

/**
 * Cubic Hermite from p0 (with slope m0, in units per whole segment) to p1 (arriving with zero slope).
 * With m0 = 0 this is the classic smoothstep ease-in-out; a non-zero m0 keeps velocity continuous
 * when a tween is retargeted mid-flight.
 */
export function hermite(p0: number, p1: number, m0: number, s: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1;
}

/** d/ds of hermite(). Divide by the segment duration to get a per-second velocity. */
export function hermiteSlope(p0: number, p1: number, m0: number, s: number): number {
  const s2 = s * s;
  return (6 * s2 - 6 * s) * p0 + (3 * s2 - 4 * s + 1) * m0 + (-6 * s2 + 6 * s) * p1;
}
