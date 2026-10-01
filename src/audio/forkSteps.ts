import type { StorageHint } from '../core/types';

/** What the watcher reads of `hint.storage`: the storage column worked at and the level chosen there. */
export type StorageAt = Readonly<Pick<StorageHint, 'unitId' | 'column' | 'level'>>;

/**
 * Levels with storage (Game: core/storage hasStorage; the forks go by the keys at every unit, docs/STORAGE.md rule 9):
 * turns the interaction hint's storage column and chosen level, seen once per frame, into fork-step clicks, at a rack
 * or a truck alike. Only a step the player asked for (F / V, the wheel, pad X / B) that took effect at the same column
 * clicks: none at the top or bottom level (the level stays), none refused (a load that would sink into the boxes of a
 * truck bed), none away from a unit (no column), none when the level changes by itself (arriving at a unit, sliding
 * to a shorter column, leaving it).
 */
export class ForkStepWatcher {
  private unitId: string | null = null;
  private column = -1;
  private level = 0;

  /**
   * `at` = snapshot.hint.storage after this frame's update, `requested` = that frame's InputFrame.forkStep. Returns the
   * step that took effect (+1 up, −1 down), else 0.
   */
  observe(at: StorageAt | null, requested: number): -1 | 0 | 1 {
    const moved = at !== null && at.unitId === this.unitId && at.column === this.column ? at.level - this.level : 0;
    if (at) {
      this.unitId = at.unitId;
      this.column = at.column;
      this.level = at.level;
    } else {
      this.reset();
    }
    if (moved === 0 || Math.sign(moved) !== Math.sign(requested)) return 0;
    return moved > 0 ? 1 : -1;
  }

  /** Forgets the last column: after a level (re)loads, its first frame never clicks. */
  reset(): void {
    this.unitId = null;
    this.column = -1;
    this.level = 0;
  }
}
