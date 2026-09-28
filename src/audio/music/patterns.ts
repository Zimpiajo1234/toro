/** Rhythm vocabularies for the generative layers (positions are 16th steps inside a 4/4 bar). */

export interface KeysHit {
  step: number;
  /** Length in steps before the damper lifts. */
  duration: number;
  /** Only the upper two notes of the voicing (a light re-touch). */
  partial: boolean;
}

/** Single, unhurried chord hits. */
export const KEYS_CALM: readonly (readonly KeysHit[])[] = [
  [{ step: 0, duration: 15, partial: false }],
  [{ step: 2, duration: 13, partial: false }],
  [{ step: 0, duration: 10, partial: false }, { step: 12, duration: 4, partial: true }],
];

/** A little more motion, still sparse. */
export const KEYS_BUSY: readonly (readonly KeysHit[])[] = [
  [{ step: 0, duration: 8, partial: false }, { step: 10, duration: 6, partial: true }],
  [{ step: 0, duration: 6, partial: false }, { step: 6, duration: 4, partial: true }, { step: 11, duration: 5, partial: true }],
  [{ step: 2, duration: 6, partial: false }, { step: 8, duration: 8, partial: false }],
  [{ step: 0, duration: 7, partial: false }, { step: 7, duration: 3, partial: true }, { step: 14, duration: 2, partial: true }],
];

/** Melody rhythms: [step, duration] pairs. */
export const MELODY_RHYTHMS: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 6], [6, 2], [8, 8]],
  [[2, 4], [6, 4], [10, 6]],
  [[0, 3], [3, 3], [6, 10]],
  [[4, 4], [8, 2], [10, 2], [12, 4]],
  [[0, 8], [10, 6]],
  [[2, 2], [4, 2], [6, 6], [12, 4]],
  [[0, 4], [6, 2], [8, 4], [14, 2]],
  [[8, 4], [12, 4]],
  [[1, 3], [4, 4], [10, 6]],
  [[0, 2], [2, 2], [4, 8], [13, 3]],
];

/** Guitar arpeggio step patterns (one note per entry, ascending through the voicing). */
export const PLUCK_PATTERNS: readonly (readonly number[])[] = [
  [0, 2, 4, 6],
  [0, 3, 6, 10],
  [8, 10, 12, 14],
  [4, 7, 10],
  [0, 4, 8, 12],
  [2, 5, 8, 11, 14],
];

/** Slow, open arpeggio used on the resolving tonic bar. */
export const PLUCK_RESOLVE: readonly number[] = [0, 2, 4, 6, 8, 11];
