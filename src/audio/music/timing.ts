/** Musical grid shared by the composer (steps) and the player (seconds), on the song's tempo (core/tempo `BPM`). */

import { BPM } from '../../core/tempo';

export { BPM };
export const STEPS_PER_BEAT = 4;
export const STEPS_PER_BAR = 16;
/** Duration of one 16th-note step, seconds. */
export const STEP_SEC = 60 / BPM / STEPS_PER_BEAT;
export const BAR_SEC = STEP_SEC * STEPS_PER_BAR;
/** Lazy lo-fi swing: odd 16ths are late by this fraction of a step. */
export const SWING = 0.16;

/** Offset of a (bar-relative) step from the bar downbeat, including swing. */
export function stepOffsetSec(step: number): number {
  return step * STEP_SEC + (step % 2 === 1 ? SWING * STEP_SEC : 0);
}

/** MIDI windows per layer (kept low and warm; nothing piercing). */
export const RANGES = {
  bassLow: 36,
  padRootLow: 45,
  keys: { low: 55, high: 74 },
  melody: { low: 64, high: 84 },
  melodyGuitar: { low: 59, high: 79 },
  pluckRootLow: 50,
} as const;
