/** Dev-only 14 × 11 stress level for the render preview (draw calls, every color, both walls). */
import type { LevelData } from '../src/core/types';
import { validateLevel } from '../src/data/validateLevel';

/** 14 × 11 stress level: every color, shelves, plants, windows on both walls. */
export const BIG_LEVEL: LevelData = validateLevel(
  {
    id: 'dev-grande',
    order: 999,
    name: 'Prueba grande',
    size: { width: 14, depth: 11 },
    forklift: { x: 6, z: 6, heading: 0 },
    boxes: [
      { id: 'b1', color: 'blue', x: 2, z: 8 },
      { id: 'b2', color: 'mint', x: 4, z: 5 },
      { id: 'b3', color: 'yellow', x: 9, z: 8 },
      { id: 'b4', color: 'coral', x: 11, z: 4 },
      { id: 'b5', color: 'lavender', x: 7, z: 3 },
      { id: 'b6', color: 'blue', x: 12, z: 9 },
      { id: 'b7', color: 'mint', x: 1, z: 3 },
      { id: 'b8', color: 'yellow', x: 5, z: 9 },
    ],
    zones: [
      { id: 'z1', color: 'blue', x: 12, z: 1 },
      { id: 'z2', color: 'mint', x: 10, z: 1 },
      { id: 'z3', color: 'yellow', x: 8, z: 1 },
      { id: 'z4', color: 'coral', x: 1, z: 9 },
      { id: 'z5', color: 'lavender', x: 3, z: 9 },
      { id: 'z6', color: 'blue', x: 12, z: 7 },
      { id: 'z7', color: 'mint', x: 4, z: 5 },
      { id: 'z8', color: 'yellow', x: 6, z: 1 },
    ],
    shelves: [
      { x: 2, z: 0, w: 3, d: 1 },
      { x: 0, z: 5, w: 1, d: 3, tiers: 3 },
      { x: 7, z: 5, w: 3, d: 1 },
      { x: 13, z: 3, w: 1, d: 2 },
    ],
    decor: {
      plants: [
        { x: 13, z: 0 },
        { x: 0, z: 10, variant: 1 },
        { x: 13, z: 10, variant: 2 },
        { x: 6, z: 7, variant: 0 },
      ],
      windows: [
        { wall: 'north', at: 5, width: 2 },
        { wall: 'north', at: 9, width: 3 },
        { wall: 'west', at: 1, width: 2 },
      ],
    },
  },
  'dev-grande',
);

