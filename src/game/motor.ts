import { clamp } from '../core/math';

/** Normalized drive speed 0‥1 for the motor hum. */
export function speed01(speed: number, maxSpeed: number): number {
  return maxSpeed > 0 ? clamp(Math.abs(speed) / maxSpeed, 0, 1) : 0;
}

/**
 * Normalized fork motion 0‥1 for the servo whine: |Δlift| / dt relative to the fastest the forks can move
 * (`forkLiftSpeed`, in lift units per second). A zero-length frame means no motion.
 */
export function forkMotion01(deltaLift: number, dt: number, forkLiftSpeed: number): number {
  if (dt <= 0 || forkLiftSpeed <= 0) return 0;
  return clamp(Math.abs(deltaLift) / dt / forkLiftSpeed, 0, 1);
}
