import { STORAGE_SKINS } from '../../core/storage';
import type { StorageSkin, StorageSupport } from '../../core/types';
import { rackSlotY } from '../dims';

/**
 * How the drawing stands a box and the forks at a level of a storage column, by the support of its skin (core/storage
 * STORAGE_SKINS[skin].support, docs/STORAGE.md «Soporte»), never by the skin itself: BoxView rests a stored box there,
 * ForkliftView counts its fork heights by it and LevelView previews a drop on it.
 */
export interface SupportLook {
  /**
   * Every level is a shelf of its own (a rack slot's): the forks count shelf heights and ride just over the chosen
   * shelf's floor, a box there hops and lifts less (the beam above is close), never dips with a stack and ghosts with
   * the piece holding it, and the drop outline floats on the shelf floor. Else the levels are a stack like the floor's
   * (a truck bed): stack heights, stack dips, stack ghosts.
   */
  readonly shelf: boolean;
  /** World y of the floor of `level` (fractional levels interpolate); `stackStep` = one stack level (the box height). */
  levelY(level: number, stackStep: number): number;
}

export const SUPPORT_LOOK: { readonly [S in StorageSupport]: SupportLook } = {
  /** Shelves (a rack): each level's floor at dims rackSlotY, taller than a stack level. */
  shelves: { shelf: true, levelY: (level) => rackSlotY(level) },
  /** A stack (a truck bed, level with the floor): the heights of a floor stack. */
  stack: { shelf: false, levelY: (level, stackStep) => level * stackStep },
};

/** The support of `skin` (its STORAGE_SKINS row). */
export function supportOf(skin: StorageSkin): StorageSupport {
  return STORAGE_SKINS[skin].support;
}
