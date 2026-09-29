/**
 * Pure music theory helpers: notes, chords, voicings, scales. No Web Audio here (unit-tested).
 * Pitches are MIDI numbers (69 = A4 = 440 Hz); pitch classes are 0‥11 with 0 = C.
 */

export const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

/** Major pentatonic scale degrees (semitones above the tonic). */
export const PENTATONIC_MAJOR = [0, 2, 4, 7, 9] as const;

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

export function noteName(midi: number): string {
  return `${NOTE_NAMES[pitchClass(midi)]}${Math.floor(Math.round(midi) / 12) - 1}`;
}

export type ChordQuality = 'maj7' | 'maj9' | 'six9' | 'm7' | 'm9' | 'm11' | 'sus9' | 'sus13' | 'dom9' | 'm6';

interface QualityDef {
  /** Suffix used in chord names ("Fmaj9"). */
  suffix: string;
  /** Every chord tone, semitones above the root. */
  tones: readonly number[];
  /** Open, warm pad stack (root at the bottom). */
  pad: readonly number[];
  /** Sparse keys voicing (mostly rootless), re-voiced with voice leading. */
  keys: readonly number[];
}

export const QUALITIES: Readonly<Record<ChordQuality, QualityDef>> = {
  maj7: { suffix: 'maj7', tones: [0, 4, 7, 11], pad: [0, 7, 11, 16], keys: [4, 7, 11] },
  maj9: { suffix: 'maj9', tones: [0, 4, 7, 11, 14], pad: [0, 11, 14, 16], keys: [4, 7, 11, 14] },
  six9: { suffix: '6/9', tones: [0, 4, 7, 9, 14], pad: [0, 9, 14, 16], keys: [4, 9, 14, 7] },
  m7: { suffix: 'm7', tones: [0, 3, 7, 10], pad: [0, 7, 10, 15], keys: [3, 7, 10] },
  m9: { suffix: 'm9', tones: [0, 3, 7, 10, 14], pad: [0, 10, 14, 15], keys: [3, 7, 10, 14] },
  m11: { suffix: 'm11', tones: [0, 3, 7, 10, 14, 17], pad: [0, 10, 15, 17], keys: [3, 10, 14, 17] },
  sus9: { suffix: '9sus', tones: [0, 5, 7, 10, 14], pad: [0, 7, 10, 14], keys: [5, 10, 14, 7] },
  sus13: { suffix: '13sus', tones: [0, 5, 10, 14, 21], pad: [0, 10, 14, 21], keys: [5, 10, 14, 21] },
  dom9: { suffix: '9', tones: [0, 4, 7, 10, 14], pad: [0, 10, 14, 16], keys: [4, 10, 14, 7] },
  m6: { suffix: 'm6', tones: [0, 3, 7, 9], pad: [0, 7, 9, 15], keys: [3, 7, 9] },
};

/** A chord relative to the key: `degree` = semitones from the tonic to the chord root. */
export interface ChordSpec {
  degree: number;
  quality: ChordQuality;
}

/** A chord resolved in a concrete key. */
export interface Chord {
  rootPc: number;
  quality: ChordQuality;
  /** Pitch classes of every chord tone, root first. */
  tones: number[];
  name: string;
}

export function buildChord(keyPc: number, spec: ChordSpec): Chord {
  const rootPc = pitchClass(keyPc + spec.degree);
  const def = QUALITIES[spec.quality];
  return {
    rootPc,
    quality: spec.quality,
    tones: def.tones.map((i) => pitchClass(rootPc + i)),
    name: `${NOTE_NAMES[rootPc]}${def.suffix}`,
  };
}

/** Lowest MIDI note with pitch class `pc` that is ≥ `low`. */
export function lowestAtOrAbove(pc: number, low: number): number {
  return low + ((pitchClass(pc) - pitchClass(low) + 12) % 12);
}

/** MIDI note with pitch class `pc` nearest to `target` (ties resolve downward). */
export function nearestWithPc(pc: number, target: number): number {
  const up = lowestAtOrAbove(pc, target);
  const down = up - 12;
  return up - target < target - down ? up : down;
}

/** Bass root: the chord root inside [low, low + 11]. */
export function bassNote(chord: Chord, low = 36): number {
  return lowestAtOrAbove(chord.rootPc, low);
}

/** Open pad stack with the root placed inside [rootLow, rootLow + 11]. */
export function padVoicing(chord: Chord, rootLow = 45): number[] {
  const root = lowestAtOrAbove(chord.rootPc, rootLow);
  return QUALITIES[chord.quality].pad.map((i) => root + i);
}

/** Keys voicing intervals for a chord (semitones above the root). */
export function keysIntervals(chord: Chord): readonly number[] {
  return QUALITIES[chord.quality].keys;
}

/**
 * Voices pitch classes ascending inside [low, high], choosing the inversion closest to `previous`
 * (smooth voice leading) or, without a previous voicing, the one centred in the window.
 */
export function voiceChord(pcs: readonly number[], low: number, high: number, previous: readonly number[] | null): number[] {
  const n = pcs.length;
  if (n === 0) return [];
  let best: number[] | null = null;
  let bestCost = Infinity;
  const center = (low + high) / 2;
  for (let r = 0; r < n; r++) {
    for (let lift = 0; lift < 24; lift += 12) {
      const cand: number[] = [];
      let prev = lowestAtOrAbove(pcs[r % n], low) + lift - 1;
      for (let i = 0; i < n; i++) {
        const note = lowestAtOrAbove(pcs[(r + i) % n], prev + 1);
        cand.push(note);
        prev = note;
      }
      if (cand[n - 1] > high) continue;
      const cost = voicingCost(cand, previous, center);
      if (cost < bestCost) {
        bestCost = cost;
        best = cand;
      }
    }
  }
  if (best) return best;
  // Window too narrow for a stacked voicing: fold each tone into range instead.
  return pcs.map((pc) => nearestWithPc(pc, center)).map((m) => clampByOctave(m, low, high)).sort((a, b) => a - b);
}

function voicingCost(cand: readonly number[], previous: readonly number[] | null, center: number): number {
  const mean = cand.reduce((s, v) => s + v, 0) / cand.length;
  if (!previous || previous.length === 0) return Math.abs(mean - center);
  if (previous.length === cand.length) {
    let cost = 0;
    for (let i = 0; i < cand.length; i++) cost += Math.abs(cand[i] - previous[i]);
    return cost;
  }
  const prevMean = previous.reduce((s, v) => s + v, 0) / previous.length;
  return Math.abs(mean - prevMean) * cand.length;
}

function clampByOctave(m: number, low: number, high: number): number {
  while (m < low) m += 12;
  while (m > high) m -= 12;
  return m;
}

/** True when `pc` is a major-pentatonic tone of the key. */
export function inPentatonic(keyPc: number, pc: number): boolean {
  const rel = pitchClass(pc - keyPc);
  return (PENTATONIC_MAJOR as readonly number[]).includes(rel);
}

/**
 * Pitch classes safe for the melody over `chord`: pentatonic tones that are chord tones, or that are
 * neither a half-step above a chord tone nor a half-step below the root (classic "avoid notes").
 */
export function melodyPitchClasses(keyPc: number, chord: Chord): number[] {
  const out: number[] = [];
  for (const deg of PENTATONIC_MAJOR) {
    const pc = pitchClass(keyPc + deg);
    const isChordTone = chord.tones.includes(pc);
    const halfStepAbove = chord.tones.includes(pitchClass(pc - 1));
    const belowRoot = pitchClass(chord.rootPc - 1) === pc;
    if (isChordTone || (!halfStepAbove && !belowRoot)) out.push(pc);
  }
  if (out.length > 0) return out;
  return chord.tones.filter((pc) => inPentatonic(keyPc, pc));
}

/** Ascending MIDI notes in [low, high] whose pitch class is in `pcs`. */
export function notesInRange(pcs: readonly number[], low: number, high: number): number[] {
  const out: number[] = [];
  for (let m = low; m <= high; m++) if (pcs.includes(pitchClass(m))) out.push(m);
  return out;
}

/**
 * MIDI note of a (possibly negative) pentatonic degree, counted from `tonicMidi`.
 * Degree 5 is the octave above, degree -1 the 6th degree below.
 */
export function pentatonicNote(tonicMidi: number, degree: number): number {
  const len = PENTATONIC_MAJOR.length;
  const octave = Math.floor(degree / len);
  const idx = degree - octave * len;
  return tonicMidi + octave * 12 + PENTATONIC_MAJOR[idx];
}

/**
 * Short rising figure for a completed stack zone: `n` pentatonic notes (one per box, bottom → top) ending on
 * the zone's chime (see chimeNote), so the stack "climbs" into the same note a single zone would ring.
 * Without a chord the notes are consecutive scale degrees. With the sounding `chord`, a lower degree that is an
 * avoid note over it is skipped (the figure walks down to the next safe one), so the climb never clashes.
 * n ≤ 1 is just the chime.
 */
export function stackArpeggio(keyPc: number, satisfiedCount: number, total: number, n: number, chord?: Chord): number[] {
  const top = chimeNote(keyPc, satisfiedCount, total, chord);
  const tonic = lowestAtOrAbove(keyPc, 67);
  let degree = -12;
  while (degree < 12 && pentatonicNote(tonic, degree) < top) degree++;
  const count = Math.max(1, Math.round(n));
  const safe = chord ? melodyPitchClasses(keyPc, chord) : null;
  const isSafe = (d: number) => !safe || safe.includes(pitchClass(pentatonicNote(tonic, d)));
  const notes = [top];
  let d = degree;
  for (let k = 1; k < count; k++) {
    // Bounded walk: every chord leaves at least two safe pentatonic tones, so it never runs far.
    d--;
    while (!isSafe(d) && d > degree - 10) d--;
    notes.unshift(pentatonicNote(tonic, d));
  }
  return notes;
}

/**
 * Chime for the n-th satisfied zone: climbs the key's pentatonic scale one step per zone so that the
 * final zone always lands on the upper tonic (a small, satisfying resolution). With the sounding `chord`,
 * a middle-zone degree that is an avoid note over it steps down to the nearest safe one (a repeated pitch
 * is fine); the final tonic is never moved.
 */
export function chimeNote(keyPc: number, satisfiedCount: number, total: number, chord?: Chord): number {
  const tonic = lowestAtOrAbove(keyPc, 67); // tonic between G4 and F#5
  const t = Math.max(1, Math.round(total));
  const c = Math.min(Math.max(1, Math.round(satisfiedCount)), t);
  const degree = Math.max(-6, 5 - (t - c));
  const note = pentatonicNote(tonic, degree);
  if (!chord || c >= t) return note;
  const safe = melodyPitchClasses(keyPc, chord);
  const isSafe = (d: number) => safe.includes(pitchClass(pentatonicNote(tonic, d)));
  // Down first (keeps the climb gentle), then up — but never onto the upper tonic reserved for the last zone.
  for (let d = degree; d >= -6; d--) if (isSafe(d)) return pentatonicNote(tonic, d);
  for (let d = degree + 1; d < 5; d++) if (isSafe(d)) return pentatonicNote(tonic, d);
  return note;
}

/**
 * Gentle open arpeggio on the tonic (1 5 9 3 5 8) used when a level completes. With the chord still
 * sounding under it, any non-tonic note that is an avoid note over that chord drops to the nearest
 * lower safe tone (and is left out if that would repeat the previous note); the tonics always stay.
 */
export function completionArpeggio(keyPc: number, over?: Chord): number[] {
  const base = lowestAtOrAbove(keyPc, 50);
  const notes = [0, 7, 14, 16, 19, 24].map((i) => base + i);
  if (!over) return notes;
  const safe = melodyPitchClasses(keyPc, over);
  const out: number[] = [];
  for (const m of notes) {
    let n = m;
    if (pitchClass(n) !== pitchClass(keyPc)) {
      while (n > base && !safe.includes(pitchClass(n))) n--;
    }
    if (out.length === 0 || n > out[out.length - 1]) out.push(n);
  }
  return out;
}
