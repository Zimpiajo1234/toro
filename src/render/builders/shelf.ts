import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { LevelData, LevelShelf } from '../../core/types';
import type { Theme } from '../../themes/types';
import type { PartList } from '../paint';
import { pick, range, type Rng } from '../random';

const INSET = 0.07;
const POST = 0.06;
const BOARD = 0.045;
const FIRST_BOARD_Y = 0.08;
const TIER_GAP = 0.52;
const MAX_POST_SPAN = 2;

/**
 * Open light-wood shelving over its cell rectangle, with neatly stacked neutral kraft boxes.
 * Stored boxes never use functional colors, so they can't be mistaken for pickable boxes.
 */
export function addShelf(parts: PartList, shelf: LevelShelf, level: LevelData, theme: Theme, rng: Rng): void {
  const hw = level.size.width / 2;
  const hd = level.size.depth / 2;
  const x0 = shelf.x - hw + INSET;
  const x1 = shelf.x + shelf.w - hw - INSET;
  const z0 = shelf.z - hd + INSET;
  const z1 = shelf.z + shelf.d - hd - INSET;
  const tiers = Math.max(1, shelf.tiers ?? 2);
  const boardY = (k: number) => FIRST_BOARD_Y + k * TIER_GAP;
  const postTop = boardY(tiers - 1) + BOARD + 0.05;

  // Posts at the corners and at least every MAX_POST_SPAN cells along each side.
  const xs = spread(x0 + POST / 2, x1 - POST / 2, Math.ceil(shelf.w / MAX_POST_SPAN));
  const zs = spread(z0 + POST / 2, z1 - POST / 2, Math.ceil(shelf.d / MAX_POST_SPAN));
  for (const px of xs) {
    for (const pz of zs) {
      const onEdge = px === xs[0] || px === xs[xs.length - 1] || pz === zs[0] || pz === zs[zs.length - 1];
      if (!onEdge) continue;
      parts.block(theme.shelf.frame, px - POST / 2, px + POST / 2, 0, postTop, pz - POST / 2, pz + POST / 2);
    }
  }

  for (let k = 0; k < tiers; k++) {
    const y = boardY(k);
    parts.block(theme.shelf.board, x0, x1, y, y + BOARD, z0, z1);
    const maxH = k === tiers - 1 ? 0.36 : TIER_GAP - BOARD - 0.1;
    addStoredBoxes(parts, shelf, level, theme, rng, y + BOARD, maxH);
  }
}

/** Evenly spaced positions from a to b inclusive (segments ≥ 1). */
function spread(a: number, b: number, segments: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= segments; i++) out.push(a + ((b - a) * i) / segments);
  return out;
}

function addStoredBoxes(
  parts: PartList,
  shelf: LevelShelf,
  level: LevelData,
  theme: Theme,
  rng: Rng,
  baseY: number,
  maxH: number,
): void {
  const hw = level.size.width / 2;
  const hd = level.size.depth / 2;
  const alongX = shelf.w >= shelf.d;
  for (let cx = 0; cx < shelf.w; cx++) {
    for (let cz = 0; cz < shelf.d; cz++) {
      if (rng() < 0.18) continue; // leave a few gaps: tidy, not packed
      const centerX = shelf.x + cx + 0.5 - hw;
      const centerZ = shelf.z + cz + 0.5 - hd;
      const count = rng() < 0.45 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        const w = count === 2 ? range(rng, 0.3, 0.38) : range(rng, 0.42, 0.56);
        const d = range(rng, 0.36, 0.56);
        const h = range(rng, Math.min(0.2, maxH), maxH);
        const offset = count === 2 ? (i === 0 ? -0.21 : 0.21) : range(rng, -0.08, 0.08);
        const bx = alongX ? centerX + offset : centerX;
        const bz = alongX ? centerZ : centerZ + offset;
        const geo = new RoundedBoxGeometry(alongX ? w : d, h, alongX ? d : w, 1, 0.022);
        parts.add(geo, pick(rng, theme.shelf.storedBoxes), { x: bx, y: baseY + h / 2, z: bz, ry: range(rng, -0.05, 0.05) });
      }
    }
  }
}
