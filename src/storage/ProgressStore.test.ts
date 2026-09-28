import { describe, expect, it } from 'vitest';
import { ProgressStore } from './ProgressStore';
import { insertTime, parseProgress, PROGRESS_VERSION } from './progressData';

const KEY = 'toro.test';
/** Level order used by the id-aware tests. */
const IDS = ['a', 'b', 'c', 'd', 'e'];

/** Minimal in-memory Storage (the test environment has no DOM). */
class FakeStorage implements Storage {
  private readonly items = new Map<string, string>();
  writes = 0;
  get length(): number {
    return this.items.size;
  }
  clear(): void {
    this.items.clear();
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
  setItem(key: string, value: string): void {
    this.writes++;
    this.items.set(key, value);
  }
}

/** Storage that reads fine but refuses every write (quota exceeded). */
class FullStorage extends FakeStorage {
  override setItem(): void {
    throw new Error('QuotaExceededError');
  }
}

/** Storage whose every access throws (Safari private mode, blocked cookies, quota…). */
class ThrowingStorage extends FakeStorage {
  override getItem(): string | null {
    throw new Error('SecurityError');
  }
  override setItem(): void {
    throw new Error('QuotaExceededError');
  }
}

describe('ProgressStore — times', () => {
  it('starts empty', () => {
    const p = new ProgressStore(new FakeStorage(), KEY);
    expect(p.getBest('a')).toBeNull();
    expect(p.getRanking('a')).toEqual([]);
    expect(p.hasProgress()).toBe(false);
  });

  it('first record is a new best at rank 1', () => {
    const p = new ProgressStore(new FakeStorage(), KEY);
    expect(p.record('a', 42_300)).toEqual({ bestMs: 42_300, isNewBest: true, previousBestMs: null, rank: 1 });
    expect(p.getBest('a')).toBe(42_300);
    expect(p.hasProgress()).toBe(true);
  });

  it('keeps the best and reports slower times without replacing it', () => {
    const p = new ProgressStore(new FakeStorage(), KEY);
    p.record('a', 40_000);
    expect(p.record('a', 45_000)).toEqual({ bestMs: 40_000, isNewBest: false, previousBestMs: 40_000, rank: 2 });
    expect(p.record('a', 30_000)).toEqual({ bestMs: 30_000, isNewBest: true, previousBestMs: 40_000, rank: 1 });
    expect(p.getBest('a')).toBe(30_000);
  });

  it('an equal time is not a new best and ranks after the existing one', () => {
    const p = new ProgressStore(new FakeStorage(), KEY);
    p.record('a', 40_000);
    const r = p.record('a', 40_000);
    expect(r.isNewBest).toBe(false);
    expect(r.rank).toBe(2);
  });

  it('keeps an ascending top-5 per level and reports rank 0 outside it', () => {
    const p = new ProgressStore(new FakeStorage(), KEY);
    for (const t of [50, 20, 40, 10, 30]) p.record('a', t * 1000);
    expect(p.getRanking('a')).toEqual([10_000, 20_000, 30_000, 40_000, 50_000]);
    expect(p.record('a', 60_000).rank).toBe(0);
    expect(p.record('a', 25_000).rank).toBe(3);
    expect(p.getRanking('a')).toEqual([10_000, 20_000, 25_000, 30_000, 40_000]);
  });

  it('tracks levels independently', () => {
    const p = new ProgressStore(new FakeStorage(), KEY);
    p.record('a', 10_000);
    p.record('b', 20_000);
    expect(p.getBest('a')).toBe(10_000);
    expect(p.getBest('b')).toBe(20_000);
  });

  it('ignores invalid times', () => {
    const storage = new FakeStorage();
    const p = new ProgressStore(storage, KEY);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -5, 0]) {
      expect(p.record('a', bad)).toEqual({ bestMs: 0, isNewBest: false, previousBestMs: null, rank: 0 });
    }
    expect(storage.writes).toBe(0);
    p.record('a', 12_000);
    expect(p.record('a', Number.NaN)).toEqual({ bestMs: 12_000, isNewBest: false, previousBestMs: 12_000, rank: 0 });
    expect(p.getRanking('a')).toEqual([12_000]);
  });

  it('getRanking returns a copy', () => {
    const p = new ProgressStore(new FakeStorage(), KEY);
    p.record('a', 10_000);
    p.getRanking('a').push(1);
    expect(p.getRanking('a')).toEqual([10_000]);
  });
});

describe('ProgressStore — levels & settings', () => {
  it('unlock only moves forward and ignores invalid indices', () => {
    const p = new ProgressStore(new FakeStorage(), KEY);
    expect(p.getHighestUnlocked()).toBe(0);
    p.unlock(2);
    p.unlock(1);
    p.unlock(-1);
    p.unlock(1.5);
    expect(p.getHighestUnlocked()).toBe(2);
    expect(p.hasProgress()).toBe(true);
  });

  it('stores the last level', () => {
    const p = new ProgressStore(new FakeStorage(), KEY);
    p.setLastLevel(3);
    p.setLastLevel(Number.NaN);
    expect(p.getLastLevel()).toBe(3);
    expect(p.hasProgress()).toBe(true);
  });

  it('merges settings and returns copies', () => {
    const p = new ProgressStore(new FakeStorage(), KEY);
    expect(p.getSettings()).toEqual({ muted: false, showTimer: true, testMode: false });
    p.setSettings({ muted: true });
    p.getSettings().showTimer = false;
    expect(p.getSettings()).toEqual({ muted: true, showTimer: true, testMode: false });
    p.setSettings({ showTimer: false });
    expect(p.getSettings()).toEqual({ muted: true, showTimer: false, testMode: false });
  });

  it('only writes when something changes', () => {
    const storage = new FakeStorage();
    const p = new ProgressStore(storage, KEY, IDS);
    p.setSettings({ muted: false });
    p.unlock(0);
    expect(storage.writes).toBe(0);
    p.setLastLevel(1);
    p.setLastLevel(1);
    p.unlock(1);
    p.unlock(1);
    expect(storage.writes).toBe(2);
  });
});

describe('ProgressStore — persistence', () => {
  it('round-trips through storage under one versioned key', () => {
    const storage = new FakeStorage();
    const a = new ProgressStore(storage, KEY);
    a.record('lvl-1', 31_000);
    a.record('lvl-1', 29_500);
    a.unlock(1);
    a.setLastLevel(1);
    a.setSettings({ muted: true, showTimer: false });

    expect(storage.length).toBe(1);
    expect(JSON.parse(storage.getItem(KEY) ?? '{}').version).toBe(PROGRESS_VERSION);

    const b = new ProgressStore(storage, KEY);
    expect(b.getRanking('lvl-1')).toEqual([29_500, 31_000]);
    expect(b.getHighestUnlocked()).toBe(1);
    expect(b.getLastLevel()).toBe(1);
    expect(b.getSettings()).toEqual({ muted: true, showTimer: false, testMode: false });
  });

  it('falls back to fresh progress on corrupt JSON or another version', () => {
    for (const bad of ['{nope', '[]', 'null', JSON.stringify({ version: 99, highestUnlocked: 4 })]) {
      const storage = new FakeStorage();
      storage.setItem(KEY, bad);
      const p = new ProgressStore(storage, KEY);
      expect(p.hasProgress()).toBe(false);
      expect(p.getSettings()).toEqual({ muted: false, showTimer: true, testMode: false });
    }
  });

  it('sanitizes invalid fields', () => {
    const p = parseProgress(
      JSON.stringify({
        version: PROGRESS_VERSION,
        rankings: { a: [3000, 'x', null, -1, 1000, 2000, 7000, 6000, 5000, 4000], b: 'oops', c: [] },
        highestUnlocked: -3,
        lastLevel: 2.5,
        settings: { muted: 'yes', showTimer: false },
      }),
    );
    expect(p.rankings.get('a')).toEqual([1000, 2000, 3000, 4000, 5000]);
    expect(p.rankings.has('b')).toBe(false);
    expect(p.rankings.has('c')).toBe(false);
    expect(p.highestUnlocked).toBe(0);
    expect(p.lastLevel).toBe(0);
    expect(p.settings).toEqual({ muted: false, showTimer: false, testMode: false });
  });

  it('never throws when storage throws, and keeps working in memory', () => {
    const p = new ProgressStore(new ThrowingStorage(), KEY);
    expect(p.record('a', 10_000).isNewBest).toBe(true);
    p.unlock(3);
    p.setLastLevel(2);
    p.setSettings({ muted: true });
    expect(p.getBest('a')).toBe(10_000);
    expect(p.getHighestUnlocked()).toBe(3);
    expect(p.getLastLevel()).toBe(2);
    expect(p.getSettings().muted).toBe(true);
  });

  it('works with no storage at all', () => {
    const p = new ProgressStore(null, KEY);
    p.record('a', 5_000);
    expect(p.getRanking('a')).toEqual([5_000]);
  });
});

describe('ProgressStore — levels by id', () => {
  it('unlocks the level after the furthest completed one', () => {
    const p = new ProgressStore(new FakeStorage(), KEY, IDS);
    p.record('b', 20_000);
    expect(p.getHighestUnlocked()).toBe(2);
    p.record('e', 50_000);
    expect(p.getHighestUnlocked()).toBe(4); // never beyond the last level
  });

  it('a level inserted mid-sequence re-locks nothing and keeps "Continuar" on the same level', () => {
    const storage = new FakeStorage();
    const before = new ProgressStore(storage, KEY, ['a', 'b', 'c', 'd']);
    before.record('a', 10_000);
    before.unlock(1);
    before.record('b', 20_000);
    before.unlock(2);
    before.setLastLevel(2); // 'c'

    const after = new ProgressStore(storage, KEY, ['a', 'new', 'b', 'c', 'd']);
    expect(after.getHighestUnlocked()).toBe(3); // 'c' is still open
    expect(after.getLastLevel()).toBe(3); // still 'c'
  });

  it('falls back to saved indices for older saves and unknown ids', () => {
    const storage = new FakeStorage();
    storage.setItem(KEY, JSON.stringify({ version: PROGRESS_VERSION, highestUnlocked: 3, lastLevel: 2, rankings: {} }));
    const p = new ProgressStore(storage, KEY, IDS);
    expect(p.getHighestUnlocked()).toBe(3);
    expect(p.getLastLevel()).toBe(2);

    storage.setItem(KEY, JSON.stringify({ version: PROGRESS_VERSION, lastLevel: 1, lastLevelId: 'gone', rankings: {} }));
    expect(p.getLastLevel()).toBe(1);
    expect(parseProgress(storage.getItem(KEY)).lastLevelId).toBe('gone');
  });
});

describe('ProgressStore — several tabs', () => {
  it('a stale tab never erases unlocks or times saved by another tab', () => {
    const storage = new FakeStorage();
    const older = new ProgressStore(storage, KEY, IDS);
    const newer = new ProgressStore(storage, KEY, IDS);
    newer.record('c', 30_000);
    newer.unlock(4);
    newer.record('d', 40_000);

    older.record('a', 10_000);
    older.setLastLevel(1);

    const reopened = new ProgressStore(storage, KEY, IDS);
    expect(reopened.getHighestUnlocked()).toBe(4);
    expect(reopened.getBest('c')).toBe(30_000);
    expect(reopened.getBest('d')).toBe(40_000);
    expect(reopened.getBest('a')).toBe(10_000);
    expect(reopened.getLastLevel()).toBe(1);
  });

  it('adds only its own time to a shared ranking (no duplicates)', () => {
    const storage = new FakeStorage();
    const first = new ProgressStore(storage, KEY, IDS);
    first.record('a', 10_000);
    const second = new ProgressStore(storage, KEY, IDS);
    first.record('a', 12_000);
    second.record('a', 11_000);
    expect(new ProgressStore(storage, KEY, IDS).getRanking('a')).toEqual([10_000, 11_000, 12_000]);
  });

  it('reads see what another tab saved; a settings change keeps the other setting', () => {
    const storage = new FakeStorage();
    const a = new ProgressStore(storage, KEY, IDS);
    const b = new ProgressStore(storage, KEY, IDS);
    a.record('b', 20_000);
    a.setSettings({ showTimer: false });
    expect(b.getBest('b')).toBe(20_000);
    expect(b.getHighestUnlocked()).toBe(2);
    b.setSettings({ muted: true });
    expect(new ProgressStore(storage, KEY, IDS).getSettings()).toEqual({ muted: true, showTimer: false, testMode: false });
  });

  it('keeps unsaved changes in memory when writes fail', () => {
    const storage = new FullStorage();
    const p = new ProgressStore(storage, KEY, IDS);
    p.record('a', 10_000);
    p.unlock(1);
    p.setSettings({ muted: true });
    expect(p.getBest('a')).toBe(10_000);
    expect(p.getHighestUnlocked()).toBe(1);
    expect(p.getSettings().muted).toBe(true);
  });
});

describe('insertTime', () => {
  it('does not mutate its input', () => {
    const src = [1, 2, 3];
    const { ranking, rank } = insertTime(src, 2.5);
    expect(src).toEqual([1, 2, 3]);
    expect(ranking).toEqual([1, 2, 2.5, 3]);
    expect(rank).toBe(3);
  });
});

describe('ProgressStore: modo prueba setting', () => {
  it('defaults to off, persists, and tolerates saves written before the field existed', () => {
    const storage = new FakeStorage();
    const a = new ProgressStore(storage, KEY, IDS);
    expect(a.getSettings().testMode).toBe(false);
    a.setSettings({ testMode: true });
    expect(new ProgressStore(storage, KEY, IDS).getSettings()).toEqual({ muted: false, showTimer: true, testMode: true });

    const old = new FakeStorage();
    old.setItem(KEY, JSON.stringify({ version: PROGRESS_VERSION, rankings: { a: [1000] }, highestUnlocked: 1, lastLevel: 1, settings: { muted: true, showTimer: false } }));
    const migrated = new ProgressStore(old, KEY, IDS);
    expect(migrated.getSettings()).toEqual({ muted: true, showTimer: false, testMode: false });
    expect(migrated.getHighestUnlocked()).toBe(1);
    expect(parseProgress(JSON.stringify({ version: PROGRESS_VERSION, settings: { testMode: 'yes' } })).settings.testMode).toBe(false);
  });

  it('toggling it never touches unlock progress', () => {
    const storage = new FakeStorage();
    const p = new ProgressStore(storage, KEY, IDS);
    p.unlock(2);
    p.setSettings({ testMode: true });
    p.setSettings({ testMode: false });
    expect(p.getHighestUnlocked()).toBe(2);
  });
});
