import type { AudioScene, Rng } from '../types';
import { weightedIndex } from '../random';
import type { ChordSpec } from './harmony';

export interface Progression {
  id: string;
  /** One chord per bar. */
  chords: readonly ChordSpec[];
  /** Relative pick weight per scene (0 = never on that scene). */
  weight: Readonly<Record<AudioScene, number>>;
}

const c = (degree: number, quality: ChordSpec['quality']): ChordSpec => ({ degree, quality });

/** Jazzy major-key progressions with 7ths / 9ths. Degrees are semitones above the tonic. */
export const PROGRESSIONS: readonly Progression[] = [
  { id: 'IV-iii-ii-V', chords: [c(5, 'maj9'), c(4, 'm7'), c(2, 'm9'), c(7, 'sus13')], weight: { title: 3, playing: 3, complete: 0 } },
  { id: 'I-vi-IV-V', chords: [c(0, 'maj7'), c(9, 'm9'), c(5, 'maj9'), c(7, 'sus9')], weight: { title: 2, playing: 3, complete: 0 } },
  { id: 'ii-V-I-vi', chords: [c(2, 'm9'), c(7, 'sus13'), c(0, 'maj9'), c(9, 'm7')], weight: { title: 1, playing: 3, complete: 0 } },
  { id: 'I-iii-IV-iv', chords: [c(0, 'maj9'), c(4, 'm7'), c(5, 'maj7'), c(5, 'm6')], weight: { title: 1, playing: 2, complete: 0 } },
  { id: 'vi-IV-I-V', chords: [c(9, 'm9'), c(5, 'maj9'), c(0, 'six9'), c(7, 'sus9')], weight: { title: 1, playing: 2, complete: 0 } },
  { id: 'I-IV-float', chords: [c(0, 'maj9'), c(5, 'maj9'), c(0, 'six9'), c(5, 'maj7')], weight: { title: 3, playing: 1, complete: 0 } },
  { id: 'IV-I-ii-I', chords: [c(5, 'maj9'), c(0, 'six9'), c(2, 'm11'), c(0, 'maj9')], weight: { title: 2, playing: 1, complete: 0 } },
];

/** Warm, tonic-centred loop played after a level is completed. */
export const RESOLVE_PROGRESSION: Progression = {
  id: 'resolve',
  chords: [c(0, 'maj9'), c(5, 'maj9'), c(0, 'six9'), c(5, 'maj7')],
  weight: { title: 0, playing: 0, complete: 1 },
};

export const TONIC_CHORD: ChordSpec = c(0, 'maj9');

/**
 * Picks the next progression for `scene`: never the current one, recently played ones are less likely.
 * Falls back to any other progression if the scene weights exclude everything.
 */
export function pickNextProgression(
  rng: Rng,
  scene: AudioScene,
  currentId: string | null,
  recentIds: readonly string[] = [],
  pool: readonly Progression[] = PROGRESSIONS,
): Progression {
  const weights = pool.map((p) => {
    if (p.id === currentId) return 0;
    const base = p.weight[scene] > 0 ? p.weight[scene] : scene === 'complete' ? p.weight.title : 0;
    return recentIds.includes(p.id) ? base * 0.35 : base;
  });
  if (weights.every((w) => w <= 0)) {
    const others = pool.filter((p) => p.id !== currentId);
    return others.length > 0 ? others[Math.floor(rng() * others.length) % others.length] : pool[0];
  }
  return pool[weightedIndex(rng, weights)];
}

/** How many times a progression is looped before moving on (mostly twice: an 8-bar phrase). */
export function pickRepeats(rng: Rng): number {
  const r = rng();
  return r < 0.15 ? 1 : r > 0.88 ? 3 : 2;
}
