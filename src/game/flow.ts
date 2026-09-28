import type { LevelData } from '../core/types';
import type { LevelSummary } from '../ui/uiState';

/** Persisted progress needed to decide where "Empezar / Continuar" goes. */
export interface SavedProgress {
  lastLevel: number;
  highestUnlocked: number;
  hasProgress: boolean;
}

function clampIndex(i: number, levelCount: number): number {
  const max = Math.max(0, levelCount - 1);
  const n = Math.floor(i);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
}

/**
 * Level to load for `start(requested)`. An explicit numeric request wins (clamped to the level range; the UI
 * only offers unlocked levels). Otherwise: the last played level, or the highest unlocked one for a fresh save,
 * never beyond what is unlocked. Non-numeric requests (e.g. a click event passed straight through) are ignored.
 */
export function resolveStartLevel(requested: number | undefined, saved: SavedProgress, levelCount: number): number {
  if (typeof requested === 'number' && Number.isFinite(requested)) return clampIndex(requested, levelCount);
  const unlocked = Math.max(0, saved.highestUnlocked);
  const preferred = saved.hasProgress ? Math.min(saved.lastLevel, unlocked) : unlocked;
  return clampIndex(preferred, levelCount);
}

/** After finishing `index`, "Continuar" should pick up at the next level (or stay on the last one). */
export function continueIndexAfter(index: number, levelCount: number): number {
  return clampIndex(index + 1, levelCount);
}

/** The control hint shows on the first `hintLevels` levels until the player has dropped a box once. */
export function shouldShowHint(index: number, hintLevels: number, dropDone: boolean): boolean {
  return index < hintLevels && !dropDone;
}

export function buildLevelSummaries(
  levels: readonly LevelData[],
  getBest: (levelId: string) => number | null,
  highestUnlocked: number,
): LevelSummary[] {
  return levels.map((level, index) => ({
    index,
    id: level.id,
    name: level.name,
    bestMs: getBest(level.id),
    unlocked: index === 0 || index <= highestUnlocked,
  }));
}

/** One-shot delay driven by accumulated frame dt (pauses with the loop, unlike setTimeout). */
export class Countdown {
  private remaining = -1;

  get active(): boolean {
    return this.remaining >= 0;
  }

  /** Seconds left while active, 0 otherwise. */
  get secondsLeft(): number {
    return Math.max(0, this.remaining);
  }

  arm(seconds: number): void {
    this.remaining = Math.max(0, seconds);
  }

  cancel(): void {
    this.remaining = -1;
  }

  /** Advance by `dt` seconds. Returns true exactly once, on the tick the delay runs out. */
  tick(dt: number): boolean {
    if (this.remaining < 0) return false;
    this.remaining -= dt;
    if (this.remaining > 0) return false;
    this.remaining = -1;
    return true;
  }
}
