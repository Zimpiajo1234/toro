import { PlaneGeometry } from 'three';
import type { LevelData } from '../../core/types';
import type { Theme } from '../../themes/types';
import { DIORAMA } from '../dims';
import type { PartList } from '../paint';

const TILE_Y = 0.0012;
const SEAM_Y = 0.0018;
const SEAM_WIDTH = 0.018;

/**
 * Floor slab with a thin visible edge, faint alternating tiles and hairline seams between cells.
 * Everything lands in one painted part list (receives shadows, casts none).
 */
export function addFloor(parts: PartList, level: LevelData, theme: Theme): void {
  const { width: w, depth: d } = level.size;
  const hw = w / 2;
  const hd = d / 2;

  // Slab body: its top sits a hair below y = 0 so the top plane owns the surface.
  parts.block(theme.floor.edge, -hw, hw, -DIORAMA.slabThickness, -0.001, -hd, hd);
  parts.add(new PlaneGeometry(w, d), theme.floor.base, { rx: -Math.PI / 2 });

  // Alternating tiles (checkerboard, very low contrast).
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      if ((x + z) % 2 === 0) continue;
      parts.add(new PlaneGeometry(1, 1), theme.floor.alt, { x: x + 0.5 - hw, y: TILE_Y, z: z + 0.5 - hd, rx: -Math.PI / 2 });
    }
  }

  // Hairline seams on interior cell boundaries.
  for (let x = 1; x < w; x++) {
    parts.add(new PlaneGeometry(SEAM_WIDTH, d), theme.floor.line, { x: x - hw, y: SEAM_Y, rx: -Math.PI / 2 });
  }
  for (let z = 1; z < d; z++) {
    parts.add(new PlaneGeometry(w, SEAM_WIDTH), theme.floor.line, { z: z - hd, y: SEAM_Y, rx: -Math.PI / 2 });
  }
}
