import { describe, expect, it } from 'vitest';
import {
  bassNote,
  buildChord,
  chimeNote,
  completionArpeggio,
  inPentatonic,
  lowestAtOrAbove,
  melodyPitchClasses,
  midiToFreq,
  nearestWithPc,
  noteName,
  notesInRange,
  padVoicing,
  pentatonicNote,
  pitchClass,
  QUALITIES,
  voiceChord,
  type ChordQuality,
} from './harmony';
import { PROGRESSIONS, RESOLVE_PROGRESSION } from './progressions';

const ALL_KEYS = Array.from({ length: 12 }, (_, i) => i);

describe('notes', () => {
  it('converts MIDI to frequency', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(60)).toBeCloseTo(261.626, 2);
    expect(midiToFreq(81)).toBeCloseTo(880, 6);
  });

  it('computes pitch classes and names', () => {
    expect(pitchClass(60)).toBe(0);
    expect(pitchClass(-1)).toBe(11);
    expect(pitchClass(77)).toBe(5);
    expect(noteName(60)).toBe('C4');
    expect(noteName(70)).toBe('Bb4');
  });

  it('finds notes by pitch class', () => {
    expect(lowestAtOrAbove(5, 60)).toBe(65);
    expect(lowestAtOrAbove(0, 60)).toBe(60);
    expect(nearestWithPc(0, 66)).toBe(60); // tie → down
    expect(nearestWithPc(0, 67)).toBe(72);
  });
});

describe('chords', () => {
  it('builds named chords in a key', () => {
    const c = buildChord(0, { degree: 5, quality: 'maj9' });
    expect(c.name).toBe('Fmaj9');
    expect(c.tones).toEqual([5, 9, 0, 4, 7]);
    expect(buildChord(0, { degree: 4, quality: 'm7' }).name).toBe('Em7');
    expect(buildChord(0, { degree: 2, quality: 'm9' }).name).toBe('Dm9');
    expect(buildChord(0, { degree: 7, quality: 'sus13' }).name).toBe('G13sus');
    expect(buildChord(5, { degree: 0, quality: 'six9' }).name).toBe('F6/9');
  });

  it('keeps every quality voicing inside its chord tones', () => {
    for (const q of Object.keys(QUALITIES) as ChordQuality[]) {
      const tones = QUALITIES[q].tones.map((i) => i % 12);
      for (const i of [...QUALITIES[q].pad, ...QUALITIES[q].keys]) expect(tones).toContain(i % 12);
      expect(QUALITIES[q].pad[0]).toBe(0);
    }
  });

  it('places bass and pad roots in their windows', () => {
    for (const key of ALL_KEYS) {
      const chord = buildChord(key, { degree: 0, quality: 'maj9' });
      const bass = bassNote(chord, 36);
      expect(bass).toBeGreaterThanOrEqual(36);
      expect(bass).toBeLessThanOrEqual(47);
      const pad = padVoicing(chord, 45);
      expect(pad[0]).toBeGreaterThanOrEqual(45);
      expect(pad[0]).toBeLessThanOrEqual(56);
      expect(pitchClass(pad[0])).toBe(chord.rootPc);
    }
  });
});

describe('voiceChord', () => {
  it('voices ascending notes inside the window with the requested pitch classes', () => {
    const pcs = [4, 7, 11, 2];
    const v = voiceChord(pcs, 55, 74, null);
    expect(v).toHaveLength(4);
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeGreaterThan(v[i - 1]);
    for (const m of v) {
      expect(m).toBeGreaterThanOrEqual(55);
      expect(m).toBeLessThanOrEqual(74);
    }
    expect(v.map(pitchClass).sort((a, b) => a - b)).toEqual([...pcs].sort((a, b) => a - b));
  });

  it('moves smoothly between chords (voice leading)', () => {
    let prev: number[] | null = null;
    for (const spec of PROGRESSIONS.flatMap((p) => p.chords)) {
      const chord = buildChord(5, spec);
      const pcs = QUALITIES[chord.quality].keys.map((i) => pitchClass(chord.rootPc + i));
      const v = voiceChord(pcs, 55, 74, prev);
      if (prev && prev.length === v.length) {
        const moved = v.reduce((s, m, i) => s + Math.abs(m - (prev as number[])[i]), 0);
        expect(moved / v.length).toBeLessThanOrEqual(5);
      }
      prev = v;
    }
  });

  it('falls back to folding tones into a narrow window', () => {
    const v = voiceChord([0, 4, 7, 11], 60, 64, null);
    for (const m of v) {
      expect(m).toBeGreaterThanOrEqual(60 - 12);
      expect(m).toBeLessThanOrEqual(64 + 12);
    }
    expect(voiceChord([], 50, 70, null)).toEqual([]);
  });
});

describe('scales and melody pools', () => {
  it('walks pentatonic degrees across octaves', () => {
    expect(pentatonicNote(60, 0)).toBe(60);
    expect(pentatonicNote(60, 3)).toBe(67);
    expect(pentatonicNote(60, 5)).toBe(72);
    expect(pentatonicNote(60, -1)).toBe(57);
    expect(pentatonicNote(60, -5)).toBe(48);
  });

  it('never leaves a chord without a melody pool, in any key', () => {
    const chords = [...PROGRESSIONS, RESOLVE_PROGRESSION].flatMap((p) => p.chords);
    for (const key of ALL_KEYS) {
      for (const spec of chords) {
        const chord = buildChord(key, spec);
        const pcs = melodyPitchClasses(key, chord);
        expect(pcs.length).toBeGreaterThanOrEqual(2);
        for (const pc of pcs) {
          expect(inPentatonic(key, pc)).toBe(true);
          const isChordTone = chord.tones.includes(pc);
          // Non-chord tones must not sit a half-step above a chord tone.
          if (!isChordTone) expect(chord.tones.includes(pitchClass(pc - 1))).toBe(false);
        }
        expect(notesInRange(pcs, 64, 84).length).toBeGreaterThan(3);
      }
    }
  });

  it('avoids the clashing tones over the borrowed iv chord', () => {
    // C major, Fm6 = F Ab C D: E (below the root) and A (above Ab) are avoided.
    const pcs = melodyPitchClasses(0, buildChord(0, { degree: 5, quality: 'm6' }));
    expect(pcs).not.toContain(4);
    expect(pcs).not.toContain(9);
    expect(pcs).toContain(0);
  });
});

describe('chimes', () => {
  it('climbs the pentatonic scale and resolves on the tonic', () => {
    for (const key of ALL_KEYS) {
      for (let total = 1; total <= 12; total++) {
        let prev = -Infinity;
        for (let n = 1; n <= total; n++) {
          const m = chimeNote(key, n, total);
          expect(inPentatonic(key, pitchClass(m))).toBe(true);
          expect(m).toBeGreaterThanOrEqual(prev);
          expect(m).toBeGreaterThanOrEqual(48);
          expect(m).toBeLessThanOrEqual(92);
          prev = m;
        }
        expect(pitchClass(chimeNote(key, total, total))).toBe(key);
      }
    }
  });

  it('keeps middle-zone chimes off the avoid notes of the sounding chord, never moving the final tonic', () => {
    const chords = [...PROGRESSIONS, RESOLVE_PROGRESSION].flatMap((p) => p.chords);
    for (const key of ALL_KEYS) {
      for (const spec of chords) {
        const chord = buildChord(key, spec);
        const safe = melodyPitchClasses(key, chord);
        for (let total = 1; total <= 12; total++) {
          for (let n = 1; n <= total; n++) {
            const m = chimeNote(key, n, total, chord);
            expect(inPentatonic(key, pitchClass(m))).toBe(true);
            expect(m).toBeGreaterThanOrEqual(48);
            expect(m).toBeLessThanOrEqual(92);
            if (n < total) {
              expect(safe).toContain(pitchClass(m));
              expect(m).toBeLessThan(chimeNote(key, total, total)); // the upper tonic stays reserved
            } else {
              expect(m).toBe(chimeNote(key, n, total));
            }
          }
        }
      }
    }
    // C major over Fm6 (F Ab C D): E steps down to D, A down to G.
    const fm6 = buildChord(0, { degree: 5, quality: 'm6' });
    expect(chimeNote(0, 2, 5, fm6)).toBe(74);
    expect(chimeNote(0, 4, 5, fm6)).toBe(79);
  });

  it('is robust to out-of-range counts', () => {
    expect(() => chimeNote(5, 0, 0)).not.toThrow();
    expect(chimeNote(5, 9, 3)).toBe(chimeNote(5, 3, 3));
  });

  it('builds a gentle ascending completion arpeggio on the tonic', () => {
    for (const key of ALL_KEYS) {
      const arp = completionArpeggio(key);
      expect(pitchClass(arp[0])).toBe(key);
      for (let i = 1; i < arp.length; i++) expect(arp[i]).toBeGreaterThan(arp[i - 1]);
      expect(arp[arp.length - 1]).toBeLessThanOrEqual(86);
    }
  });

  it('fits the completion arpeggio to the chord still sounding, always keeping its tonics', () => {
    const chords = [...PROGRESSIONS, RESOLVE_PROGRESSION].flatMap((p) => p.chords);
    for (const key of ALL_KEYS) {
      const plain = completionArpeggio(key);
      for (const spec of chords) {
        const chord = buildChord(key, spec);
        const arp = completionArpeggio(key, chord);
        const safe = melodyPitchClasses(key, chord);
        expect(arp[0]).toBe(plain[0]);
        expect(arp[arp.length - 1]).toBe(plain[plain.length - 1]);
        expect(arp.length).toBeGreaterThanOrEqual(4);
        for (let i = 1; i < arp.length; i++) expect(arp[i]).toBeGreaterThan(arp[i - 1]);
        for (const m of arp) if (pitchClass(m) !== key) expect(safe).toContain(pitchClass(m));
      }
    }
    // C major: over Fm6 the E would drop onto the D before it, so it is left out; over Em7 nothing changes.
    expect(completionArpeggio(0, buildChord(0, { degree: 5, quality: 'm6' }))).toEqual([60, 67, 74, 79, 84]);
    expect(completionArpeggio(0, buildChord(0, { degree: 4, quality: 'm7' }))).toEqual(completionArpeggio(0));
  });
});
