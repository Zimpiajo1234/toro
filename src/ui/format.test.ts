import { describe, expect, it } from 'vitest';
import { formatClock, formatPrecise } from './format';

describe('formatClock', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [1000, '0:01'],
    [42_900, '0:42'],
    [59_999, '0:59'],
    [60_000, '1:00'],
    [61_000, '1:01'],
    [605_000, '10:05'],
    [3_600_000, '60:00'],
    [4_502_000, '75:02'],
  ])('%d ms → %s', (ms, text) => {
    expect(formatClock(ms)).toBe(text);
  });

  it('treats negative and non-finite values as zero', () => {
    for (const bad of [-1, -60_000, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatClock(bad)).toBe('0:00');
    }
  });
});

describe('formatPrecise', () => {
  it.each([
    [0, '0:00.0'],
    [99, '0:00.0'],
    [100, '0:00.1'],
    [38_950, '0:38.9'],
    [42_300, '0:42.3'],
    [42_399, '0:42.3'],
    [59_999, '0:59.9'],
    [60_000, '1:00.0'],
    [600_000, '10:00.0'],
    [659_950, '10:59.9'],
    [3_599_999, '59:59.9'],
    [3_600_000, '60:00.0'],
  ])('%d ms → %s', (ms, text) => {
    expect(formatPrecise(ms)).toBe(text);
  });

  it('is not fooled by float noise from accumulated deltas', () => {
    expect(formatPrecise(4299.999999999)).toBe('0:04.3');
    expect(formatClock(59_999.9999999)).toBe('1:00');
  });

  it('treats negative and non-finite values as zero', () => {
    for (const bad of [-100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatPrecise(bad)).toBe('0:00.0');
    }
  });
});
