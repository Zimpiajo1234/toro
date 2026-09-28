import { describe, expect, it } from 'vitest';
import { MessagePicker, POSITIVE_MESSAGES } from './messages';

/** Deterministic pseudo-random sequence for tests. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('MessagePicker', () => {
  it('offers exactly the five positive phrases from the spec', () => {
    expect(POSITIVE_MESSAGES).toEqual([
      'Buen trabajo',
      'Almacén organizado',
      'Perfectamente colocado',
      'Todo en su sitio',
      '¡Qué orden tan agradable!',
    ]);
  });

  it('never repeats the same message twice in a row', () => {
    const picker = new MessagePicker(POSITIVE_MESSAGES, lcg(7));
    let prev = picker.next();
    for (let i = 0; i < 500; i++) {
      const next = picker.next();
      expect(next).not.toBe(prev);
      expect(POSITIVE_MESSAGES).toContain(next);
      prev = next;
    }
  });

  it('never repeats even with an rng stuck at the extremes', () => {
    for (const value of [0, 0.999999, 1]) {
      const picker = new MessagePicker(POSITIVE_MESSAGES, () => value);
      let prev = picker.next();
      for (let i = 0; i < 20; i++) {
        const next = picker.next();
        expect(next).not.toBe(prev);
        prev = next;
      }
    }
  });

  it('eventually uses every message', () => {
    const picker = new MessagePicker(POSITIVE_MESSAGES, lcg(42));
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(picker.next());
    expect(seen.size).toBe(POSITIVE_MESSAGES.length);
  });

  it('handles degenerate lists', () => {
    expect(new MessagePicker([]).next()).toBe('');
    const single = new MessagePicker(['Hola']);
    expect(single.next()).toBe('Hola');
    expect(single.next()).toBe('Hola');
  });
});
