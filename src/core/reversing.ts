import { clamp } from './math';

/**
 * "The forklift is backing up": the one signal the reverse beeper (audio/beeper.ts) and the beacon on the roof
 * (render/views/ForkliftView.ts) both follow, so the "tin" and the light switch on and off on the same frames. Logic
 * latches it every step into `ForkliftState.reversing`; Game hands that to the audio, the render reads it from the
 * snapshot, and neither the «pitido» setting (B) nor mute (M) touches it.
 *
 * A latch with hysteresis on the signed normalised drive speed (speed / maxSpeed, −1‥1, negative = in reverse; the
 * reverse gear tops out near −0.52): a nudge back counts, stopping or crossing over to drive forward ends it, and speed
 * noise around one threshold never flickers it. Both values are safe to tune (the beeper's tests pin the feel).
 */
export const REVERSING = {
  /** Starts once the forklift backs up faster than this (≈ 0.09 u/s, ≈ 0.08 s after S from rest): a nudge counts. */
  onSpeed: 0.04,
  /** Ends once reversing slows below this (≈ 0.035 u/s), i.e. stopped, or crossing over to drive forward. */
  offSpeed: 0.015,
} as const;

/**
 * Signed normalised drive speed −1‥1 (speed / maxSpeed, clamped; 0 without a top speed), what the latch reads: the
 * value Game hands MotorSound (sign(speed) · game/motor speed01).
 */
export function signedSpeed01(speed: number, maxSpeed: number): number {
  return maxSpeed > 0 && Number.isFinite(speed) ? clamp(speed / maxSpeed, -1, 1) : 0;
}

/** The latch after one frame: `was` = its last state, `speed` = this frame's signed normalised speed (non-finite = 0). */
export function nextReversing(was: boolean, speed: number): boolean {
  const s = Number.isFinite(speed) ? speed : 0;
  return was ? s <= -REVERSING.offSpeed : s < -REVERSING.onSpeed;
}
