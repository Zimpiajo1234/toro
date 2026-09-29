import type { RackHint } from '../core/types';

/** What the watcher reads of `hint.rack`: the rack column faced and the slot level selected there. */
export type RackAt = Readonly<Pick<RackHint, 'rackId' | 'column' | 'level'>>;

/**
 * Levels with racks: turns the interaction hint's rack column and selected slot (docs/RACKS.md), seen once per frame,
 * into fork-step clicks. Only a step the player asked for (F / V, the wheel, pad X / B) that took effect at the same
 * rack column clicks: none at the top or bottom slot (the level stays), none away from a rack (no column), none when
 * the level changes by itself (arriving at a rack, sliding to a shorter column, leaving it).
 */
export class ForkStepWatcher {
  private rackId: string | null = null;
  private column = -1;
  private level = 0;

  /**
   * `rack` = snapshot.hint.rack after this frame's update, `requested` = that frame's InputFrame.forkStep. Returns the
   * step that took effect (+1 up, −1 down), else 0.
   */
  observe(rack: RackAt | null, requested: number): -1 | 0 | 1 {
    const moved = rack !== null && rack.rackId === this.rackId && rack.column === this.column ? rack.level - this.level : 0;
    if (rack) {
      this.rackId = rack.rackId;
      this.column = rack.column;
      this.level = rack.level;
    } else {
      this.reset();
    }
    if (moved === 0 || Math.sign(moved) !== Math.sign(requested)) return 0;
    return moved > 0 ? 1 : -1;
  }

  /** Forgets the last column: after a level (re)loads, its first frame never clicks. */
  reset(): void {
    this.rackId = null;
    this.column = -1;
    this.level = 0;
  }
}
