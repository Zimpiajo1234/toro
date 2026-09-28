import type { Rng } from '../types';
import { weightedIndex } from '../random';
import { pitchClass } from './harmony';
import { MELODY_RHYTHMS } from './patterns';

export interface NoteEvent {
  /** Bar-relative 16th step. */
  step: number;
  /** Length in steps. */
  duration: number;
  midi: number;
  /** 0‥1 */
  velocity: number;
}

export interface Phrase {
  notes: NoteEvent[];
  /** Rhythm + pitches; used to avoid ever repeating a recent phrase. */
  signature: string;
}

export interface PhraseRequest {
  rng: Rng;
  /** Ascending MIDI notes allowed over the current chord. */
  pool: readonly number[];
  /** Pitch classes of the current chord (strong beats land on them). */
  chordPcs: readonly number[];
  /** Last note of the previous phrase, to keep the line connected. */
  lastMidi: number | null;
}

/** Interval choices in pool steps, and their weights when moving with / against the phrase contour. */
const MOVES = [-3, -2, -1, 0, 1, 2, 3] as const;
const WITH_CONTOUR = [0.3, 1.2, 3, 0.5, 3, 1.4, 0.4];

/** Builds one sparse pentatonic phrase (one bar) as a gentle random walk over `pool`. */
export function generatePhrase(req: PhraseRequest): Phrase {
  const { rng, pool, chordPcs } = req;
  if (pool.length === 0) return { notes: [], signature: 'empty' };

  const rhythmIndex = Math.floor(rng() * MELODY_RHYTHMS.length) % MELODY_RHYTHMS.length;
  const rhythm = MELODY_RHYTHMS[rhythmIndex].slice();
  // Occasionally breathe: drop an inner note (never the first).
  if (rhythm.length > 2 && rng() < 0.2) rhythm.splice(1 + Math.floor(rng() * (rhythm.length - 1)), 1);

  const contour = rng() < 0.5 ? 1 : -1;
  const weights = contour > 0 ? WITH_CONTOUR : WITH_CONTOUR.slice().reverse();

  let idx =
    req.lastMidi === null
      ? Math.floor(pool.length / 2) + Math.floor(rng() * 5) - 2
      : nearestIndex(pool, req.lastMidi) + Math.floor(rng() * 3) - 1;
  idx = clampIndex(idx, pool.length);

  const notes: NoteEvent[] = [];
  for (let i = 0; i < rhythm.length; i++) {
    const [step, duration] = rhythm[i];
    if (i > 0) idx = reflect(idx + MOVES[weightedIndex(rng, weights)], pool.length);
    const strong = step % 8 === 0 || i === rhythm.length - 1;
    if (strong) idx = snapToChordTone(pool, idx, chordPcs);
    const accent = i === 0 ? 0.06 : i === rhythm.length - 1 ? -0.04 : 0;
    notes.push({ step, duration, midi: pool[idx], velocity: 0.4 + rng() * 0.2 + accent });
  }
  const signature = `${rhythm.map(([s, d]) => `${s}.${d}`).join(' ')}|${notes.map((n) => n.midi).join(' ')}`;
  return { notes, signature };
}

function nearestIndex(pool: readonly number[], midi: number): number {
  let best = 0;
  for (let i = 1; i < pool.length; i++) if (Math.abs(pool[i] - midi) < Math.abs(pool[best] - midi)) best = i;
  return best;
}

function clampIndex(i: number, len: number): number {
  return Math.max(0, Math.min(len - 1, i));
}

/** Bounces off the ends of the pool instead of sticking to them. */
function reflect(i: number, len: number): number {
  if (len <= 1) return 0;
  if (i < 0) return Math.min(len - 1, -i);
  if (i >= len) return Math.max(0, 2 * (len - 1) - i);
  return i;
}

function snapToChordTone(pool: readonly number[], idx: number, chordPcs: readonly number[]): number {
  for (const d of [0, 1, -1, 2, -2]) {
    const j = idx + d;
    if (j >= 0 && j < pool.length && chordPcs.includes(pitchClass(pool[j]))) return j;
  }
  return idx;
}
