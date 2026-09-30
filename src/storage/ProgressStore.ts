import { LEVELS } from '../data/levels';
import {
  createEmptyProgress,
  insertTime,
  isValidIndex,
  isValidMoves,
  isValidTime,
  parseProgress,
  serializeProgress,
  type ProgressModel,
  type Settings,
} from './progressData';

export type { Settings } from './progressData';

/** localStorage key of the progress document (Game listens for other tabs writing it). */
export const PROGRESS_STORAGE_KEY = 'toro.progress.v1';

export interface RecordResult {
  bestMs: number;
  isNewBest: boolean;
  previousBestMs: number | null;
  /** 1-based position of this time in the local ranking (top N). 0 if outside. */
  rank: number;
}

/** What `recordMoves` reports: the level's fewest moves after this attempt. */
export interface MovesRecordResult {
  /** Fewest moves now on record (null only when nothing valid was ever recorded). */
  bestMoves: number | null;
  /** Strictly fewer moves than the previous record, or the first record. */
  isNewBest: boolean;
  previousBestMoves: number | null;
}

/** Ids of the game's levels in play order. */
function defaultLevelIds(): string[] {
  return LEVELS.map((level) => level.id);
}

/** localStorage if the environment exposes a usable one (reading it can throw in sandboxed frames). */
function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Local persistence (best times, local ranking, fewest moves, unlocked levels, settings).
 * Must never throw: storage may be unavailable (private mode) — fall back to memory.
 *
 * Everything lives in one versioned JSON document under `key`; every change is written through, and a failed
 * write keeps working from memory for the session.
 *
 * Several tabs may share that document. Before each read or change the store re-reads storage and adopts the
 * stored document if another tab has saved since (read-modify-write); a change then applies only its own
 * delta on top. A tab left open for days therefore never erases progress made in a newer one.
 *
 * Callers talk in level indices, but levels are resolved by id against `levelIds` (the current play order):
 * inserting a warehouse mid-sequence never re-locks a level nor moves "Continuar" to another one.
 *
 * A save written by a longer game (levels removed since, e.g. levels 4–24 on 2026-09-30) reads within the current
 * levels: indices past the last level read as the last one, and times of ids no longer in `levelIds` are ignored
 * (kept in the document untouched, never counted as progress). Reading never rewrites the document.
 *
 * @param storage `undefined` = use `localStorage` when available; `null` = memory only.
 * @param levelIds Level ids in play order (default: the game's level list).
 */
export class ProgressStore {
  private readonly storage: Storage | null;
  private readonly key: string;
  private readonly levelIds: readonly string[];
  private data: ProgressModel = createEmptyProgress();
  /** Raw document last read from or written to storage; anything else there means another tab saved. */
  private snapshot: string | null = null;

  constructor(storage?: Storage | null, key = PROGRESS_STORAGE_KEY, levelIds: readonly string[] = defaultLevelIds()) {
    this.storage = storage === undefined ? browserStorage() : storage;
    this.key = key;
    this.levelIds = levelIds.slice();
    this.sync();
  }

  getBest(levelId: string): number | null {
    this.sync();
    return this.data.rankings.get(levelId)?.[0] ?? null;
  }

  /**
   * Records a finished attempt. Invalid times (NaN, ∞, ≤ 0) are ignored: nothing is stored and the
   * result reports the existing best (0 if none) with rank 0.
   */
  record(levelId: string, ms: number): RecordResult {
    this.sync();
    const current = this.data.rankings.get(levelId) ?? [];
    const previousBestMs = current.length > 0 ? current[0] : null;
    if (!isValidTime(ms)) return { bestMs: previousBestMs ?? 0, isNewBest: false, previousBestMs, rank: 0 };

    const { ranking, rank } = insertTime(current, ms);
    if (rank > 0) {
      this.data.rankings.set(levelId, ranking);
      this.save();
    }
    return {
      bestMs: ranking[0],
      isNewBest: previousBestMs === null || ms < previousBestMs,
      previousBestMs,
      rank,
    };
  }

  /** Fewest box moves a level was finished in (the move counter's record), or null. */
  getBestMoves(levelId: string): number | null {
    this.sync();
    return this.data.bestMoves.get(levelId) ?? null;
  }

  /**
   * Records the move count of a finished attempt; it replaces the record only when strictly fewer. Invalid counts
   * (not a non-negative integer) are ignored. A move record is never progress: only times (`record`) unlock levels,
   * so Game records moves exactly where it records times (never for the Benchmark or a level only test mode opened).
   */
  recordMoves(levelId: string, moves: number): MovesRecordResult {
    this.sync();
    const previousBestMoves = this.data.bestMoves.get(levelId) ?? null;
    if (!isValidMoves(moves)) return { bestMoves: previousBestMoves, isNewBest: false, previousBestMoves };
    const isNewBest = previousBestMoves === null || moves < previousBestMoves;
    if (isNewBest) {
      this.data.bestMoves.set(levelId, moves);
      this.save();
    }
    return { bestMoves: isNewBest ? moves : previousBestMoves, isNewBest, previousBestMoves };
  }

  /** Ascending list of the best times (ms) for a level, max 5. */
  getRanking(levelId: string): number[] {
    this.sync();
    return this.data.rankings.get(levelId)?.slice() ?? [];
  }

  /**
   * Highest unlocked level index: the one after the furthest completed level (a completed level always has a
   * ranking), or the saved index when that is higher (older saves). Never locks anything back, and never points past
   * the last level (a save from a game with more levels).
   */
  getHighestUnlocked(): number {
    this.sync();
    const last = this.lastIndex();
    let highest = this.data.highestUnlocked;
    this.levelIds.forEach((id, index) => {
      if (this.data.rankings.has(id)) highest = Math.max(highest, Math.min(index + 1, last));
    });
    return Math.min(highest, last);
  }

  /** Unlocks every level up to `index` (never locks anything back). */
  unlock(index: number): void {
    this.sync();
    if (!isValidIndex(index) || index <= this.data.highestUnlocked) return;
    this.data.highestUnlocked = index;
    this.save();
  }

  /**
   * Index of the level "Continuar" leads to: the saved level id in the current order, else the saved index (never past
   * the last level).
   */
  getLastLevel(): number {
    this.sync();
    const { lastLevelId, lastLevel } = this.data;
    const index = lastLevelId === null ? -1 : this.levelIds.indexOf(lastLevelId);
    return index >= 0 ? index : Math.min(lastLevel, this.lastIndex());
  }

  setLastLevel(index: number): void {
    this.sync();
    if (!isValidIndex(index)) return;
    const id = this.levelIds[index] ?? null;
    if (index === this.data.lastLevel && id === this.data.lastLevelId) return;
    this.data.lastLevel = index;
    this.data.lastLevelId = id;
    this.save();
  }

  /**
   * True once the player has played beyond a fresh start (title shows "Continuar"). Times of levels no longer in the
   * game do not count.
   */
  hasProgress(): boolean {
    // The getters re-read storage first.
    if (this.getHighestUnlocked() > 0 || this.getLastLevel() > 0) return true;
    return this.levelIds.some((id) => this.data.rankings.has(id));
  }

  getSettings(): Settings {
    this.sync();
    return { ...this.data.settings };
  }

  setSettings(patch: Partial<Settings>): void {
    this.sync();
    const settings = this.data.settings;
    let changed = false;
    if (typeof patch.muted === 'boolean' && patch.muted !== settings.muted) {
      settings.muted = patch.muted;
      changed = true;
    }
    if (typeof patch.showTimer === 'boolean' && patch.showTimer !== settings.showTimer) {
      settings.showTimer = patch.showTimer;
      changed = true;
    }
    if (typeof patch.showMoves === 'boolean' && patch.showMoves !== settings.showMoves) {
      settings.showMoves = patch.showMoves;
      changed = true;
    }
    if (typeof patch.testMode === 'boolean' && patch.testMode !== settings.testMode) {
      settings.testMode = patch.testMode;
      changed = true;
    }
    if (changed) this.save();
  }

  /** Index of the last level (0 with no levels at all). */
  private lastIndex(): number {
    return Math.max(0, this.levelIds.length - 1);
  }

  /**
   * Adopts the stored document when it differs from the one this store last read or wrote (another tab
   * saved). Unreadable storage keeps the memory copy, and so does a failed write of ours: the stored
   * document is then unchanged, so memory (which is ahead of it) stays.
   */
  private sync(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.key);
      if (raw === this.snapshot) return;
      this.data = parseProgress(raw);
      this.snapshot = raw;
    } catch {
      // Sandboxed frame / blocked site data: keep playing from memory.
    }
  }

  private save(): void {
    if (!this.storage) return;
    const raw = serializeProgress(this.data);
    try {
      this.storage.setItem(this.key, raw);
      this.snapshot = raw;
    } catch {
      // Quota / private mode: keep playing from memory.
    }
  }
}
