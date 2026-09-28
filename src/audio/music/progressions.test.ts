import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../random';
import { QUALITIES } from './harmony';
import { pickNextProgression, pickRepeats, PROGRESSIONS } from './progressions';

describe('progressions', () => {
  it('have unique ids and one chord per bar in 4-bar phrases', () => {
    const ids = new Set(PROGRESSIONS.map((p) => p.id));
    expect(ids.size).toBe(PROGRESSIONS.length);
    for (const p of PROGRESSIONS) expect(p.chords).toHaveLength(4);
  });

  it('every chord has a 7th, 6th or extension (jazzy colour)', () => {
    for (const p of PROGRESSIONS) for (const c of p.chords) expect(QUALITIES[c.quality].tones.length).toBeGreaterThanOrEqual(4);
  });

  it('never repeats the current progression and reaches every one', () => {
    const rng = mulberry32(7);
    const seen = new Set<string>();
    let current: string | null = null;
    const recent: string[] = [];
    for (let i = 0; i < 400; i++) {
      const next = pickNextProgression(rng, 'playing', current, recent);
      expect(next.id).not.toBe(current);
      seen.add(next.id);
      current = next.id;
      recent.push(next.id);
      if (recent.length > 3) recent.shift();
    }
    expect(seen.size).toBe(PROGRESSIONS.length);
  });

  it('respects scene weights and falls back when a scene excludes all', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i++) expect(pickNextProgression(rng, 'title', null).weight.title).toBeGreaterThan(0);
    const only = [PROGRESSIONS[0]];
    expect(pickNextProgression(rng, 'playing', PROGRESSIONS[0].id, [], only)).toBe(PROGRESSIONS[0]);
  });

  it('loops a progression one to three times', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 200; i++) {
      const r = pickRepeats(rng);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(3);
    }
  });
});
