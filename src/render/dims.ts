import type { GameConfig } from '../config';

/**
 * Visual dimensions of the diorama (world units, 1 = one cell).
 * Gameplay-relevant sizes (box footprint, fork reach, wheel radius) come from GameConfig instead,
 * so what the player sees always matches the collision shapes.
 */
export const DIORAMA = {
  slabThickness: 0.25,
  wallHeight: 2.2,
  wallThickness: 0.2,
  capHeight: 0.06,
  capOverhang: 0.03,
  baseboardHeight: 0.15,
  baseboardDepth: 0.035,
  windowBottom: 0.8,
  windowTop: 1.78,
  /** Gap between a window opening and its cell boundaries along the wall. */
  windowInset: 0.12,
  /** Tallest decor/actor height used when framing the camera with walls hidden. */
  contentHeight: 1.3,
} as const;

/** Fork top height (world y) at forkLift = 0 and forkLift = 1. */
export const FORK = { downY: 0.06, upY: 0.34 } as const;

/** Zone pad measurements (half extents, from the cell center). */
export const ZONE = {
  padHalf: 0.48,
  padHeight: 0.02,
  padRadius: 0.14,
} as const;

/**
 * Storage rack heights (docs/RACKS.md). Slot `n` of a column has its floor (the bottom of the box resting in it) at
 * `base + n·pitch` (rackSlotY). A slot is taller than a stack level (the box height, 0.64): at a rack the load rides
 * only `forkCarry` above the slot floor, so it clears the beam of the slot above while it goes in and out.
 */
export const RACK = {
  /** Top of the bottom deck: slot 0's floor. */
  base: 0.04,
  pitch: 0.74,
  /** Height of the cream beams: under every slot floor above the deck and on top of each column. */
  beam: 0.04,
  /** Fork top above the selected slot floor at a rack: empty (tines just over the beam) and under the load. */
  forkRest: 0.03,
  forkCarry: 0.045,
} as const;

/** World y of the floor of rack slot `level` (fractional levels interpolate: the forks between slots). */
export function rackSlotY(level: number): number {
  return RACK.base + level * RACK.pitch;
}

export interface BoxDims {
  /** Footprint side (config.box.size). */
  size: number;
  height: number;
  bevel: number;
}

export function boxDims(config: GameConfig): BoxDims {
  const size = config.box.size;
  return { size, height: size * 0.82, bevel: size * 0.075 };
}
