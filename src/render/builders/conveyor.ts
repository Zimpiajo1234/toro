import type { BufferGeometry } from 'three';
import { FACING_X, FACING_Z } from '../../core/racks';
import { cellToWorld, type Facing, type LevelConveyor, type LevelData, type LevelStorage } from '../../core/types';
import type { Theme } from '../../themes/types';
import { RACK } from '../dims';
import { PartList, type Placement } from '../paint';
import { extrudedShapeGeometry, roundedRectShape } from '../shapes';
import { buildCueFace, buildGlowFrameGeometry, type CueDims, type CueLook, type GlowFrameDims } from './rack';

/*
 * Conveyor belt (docs/CONVEYOR.md): a piece clearly apart from the rest of the furniture, clear and minimalist. A low
 * flat band of soft graphite rubber between two fine light rails (Theme.conveyor), its faint stripes sliding only
 * while it runs (views/ConveyorView); no rollers, no posts, nothing over it. Its input is a low pad in the belt's
 * identity colour, where the box is set down; its end exit a low tray rimmed in that colour, with the cue sticker of
 * its level (the rack's: builders/rack buildCueFace) on a small board at its far end, on both faces, upright and never
 * mirrored. The band, the pad and the tray floor are all at the floor of a level-0 shelf (dims RACK.base), where a box of
 * a shelves support rests, so the box rides the belt level from the forks to the tray.
 */

/**
 * Belt measures (cell units). Belt-local space: +z along the belt from the input toward the end exit (its cells at
 * z = 1…n, the input at 0, the end exit at n + 1), x across it, y up.
 */
export const BELT = {
  /** Top of the band, of the input pad and of the tray floor: a level-0 shelf's floor (BoxView rests the box there). */
  top: RACK.base,
  /** Half width of the band's surface between its rails (a box is 0.39 across each side). */
  halfW: 0.4,
  /** The fine rails along both sides: their width and their top (a few cm over the band). */
  edge: { width: 0.03, top: 0.07 },
  /** Stripes across the surface: one every `period` along the belt, `width` wide, `lift` over the band. */
  stripe: { period: 0.25, width: 0.07, lift: 0.0015 },
  /** The input pad: a rounded square. */
  pad: { half: 0.46, radius: 0.09 },
  /** The end exit's tray: its floor's half extent, its low walls (three sides: open toward the belt) and their rim. */
  tray: { half: 0.46, wall: 0.035, top: 0.13, rim: 0.012 },
  /** The board at the tray's far end that holds the cue sticker, and its two slim posts down to the tray wall. */
  board: { halfW: 0.31, y0: 0.66, y1: 1.06, depth: 0.03, post: 0.028 },
} as const;

/** The cue sticker on the end exit's board (both faces): a little smaller than a rack slot's. */
export const BELT_CUE: CueDims = { halfW: 0.25, halfH: 0.16, radius: 0.05, rim: 0.022, glyph: 0.2, lift: 0.003 };

/** Glow band of the end exit (views/RackView SlotLight): a feathered frame round its sticker, on both faces of the board. */
export const BELT_GLOW: GlowFrameDims & { gap: number } = {
  halfW: BELT_CUE.halfW + 0.015,
  solidX: 0.02,
  solidY: 0.02,
  featherX: 0.035,
  featherY: 0.03,
  radius: 0.055,
  gap: 0.004,
};

/** Success burst of an end exit (render/storage conveyor `burstAt`): its ring hugs the box resting in the tray. */
export const BELT_BURST = { halfW: 0.44 } as const;

/** Height of the sticker's centre on the board (slot-local). */
export function beltCueY(): number {
  return (BELT.board.y0 + BELT.board.y1) / 2;
}

/** Slot-local z of the board's centre: over the tray's far wall (slot-local +z points along the belt toward its input). */
export function beltBoardZ(): number {
  return -(BELT.tray.half - BELT.tray.wall / 2);
}

/** The yaw turning belt-local +z (toward the end exit) along a belt that runs from its input toward `facing`'s opposite. */
function beltYaw(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/**
 * Where a belt lies: belt-local → world (a yaw and its input cell's centre), and how many belt cells it has. The
 * direction from the input into the belt is the opposite of the side both ends are worked from (`facing`).
 */
export function beltPlacement(conveyor: LevelConveyor, input: Pick<LevelStorage, 'x' | 'z'>, facing: Facing, level: Pick<LevelData, 'size'>): Placement & { cells: number } {
  const at = cellToWorld(input, level.size);
  return { x: at.x, z: at.z, ry: beltYaw(-FACING_X[facing], -FACING_Z[facing]), cells: conveyor.cells.length };
}

/**
 * The band of a belt, in world space: its graphite body over its cells, from the input's edge to the end exit's, its
 * top at BELT.top, and the two fine rails along its sides (the stripes are views/ConveyorView's, they move).
 */
export function buildBeltBand(placement: Placement & { cells: number }, theme: Theme): BufferGeometry {
  const c = theme.conveyor;
  const local = new PartList();
  const z0 = 0.5;
  const z1 = placement.cells + 0.5;
  const outer = BELT.halfW + BELT.edge.width;
  local.block(c.belt, -BELT.halfW, BELT.halfW, 0, BELT.top, z0, z1);
  for (const side of [-1, 1]) {
    const a = side * BELT.halfW;
    const b = side * outer;
    local.block(c.edge, Math.min(a, b), Math.max(a, b), 0, BELT.edge.top, z0, z1);
  }
  return new PartList().append(local, placement).build();
}

/** A belt's input pad, in world space: a low rounded square in its identity colour, its top at BELT.top. */
export function buildBeltPad(input: Pick<LevelStorage, 'x' | 'z'>, level: Pick<LevelData, 'size'>, identity: string): BufferGeometry {
  const at = cellToWorld(input, level.size);
  const pad = extrudedShapeGeometry(roundedRectShape(BELT.pad.half, BELT.pad.half, BELT.pad.radius, 4), BELT.top, 0, 4);
  return new PartList().add(pad, identity, { x: at.x, z: at.z }).build();
}

/**
 * A belt's end exit tray, in slot-local space (origin = its cell's centre on the floor, +z toward its belt: builders/rack
 * outwardYaw of its facing): the graphite floor at BELT.top, low light walls on its three other sides with a thin rim in
 * the belt's identity colour on top, and the two slim posts that carry the board of its cue.
 */
export function buildBeltTray(theme: Theme, identity: string): BufferGeometry {
  const c = theme.conveyor;
  const T = BELT.tray;
  const B = BELT.board;
  const parts = new PartList();
  parts.block(c.belt, -T.half, T.half, 0, BELT.top, -T.half, T.half);
  const inner = T.half - T.wall;
  // The far wall, then the two side walls up to the open end (toward the belt).
  const walls: [number, number, number, number][] = [
    [-T.half, T.half, -T.half, -inner],
    [-T.half, -inner, -inner, T.half],
    [inner, T.half, -inner, T.half],
  ];
  for (const [x0, x1, z0, z1] of walls) {
    parts.block(c.edge, x0, x1, BELT.top, T.top, z0, z1);
    parts.block(identity, x0, x1, T.top, T.top + T.rim, z0, z1);
  }
  const zb = beltBoardZ();
  for (const side of [-1, 1]) {
    const x = side * (B.halfW - B.post);
    parts.block(c.edge, x - B.post / 2, x + B.post / 2, T.top + T.rim, B.y0, zb - B.post / 2, zb + B.post / 2);
  }
  return parts.build();
}

/** The board of an end exit's cue (its own mesh: it glows), slot-local like buildBeltTray. */
export function buildBeltBoard(theme: Theme): BufferGeometry {
  const B = BELT.board;
  const zb = beltBoardZ();
  return new PartList().block(theme.conveyor.board, -B.halfW, B.halfW, B.y0, B.y1, zb - B.depth / 2, zb + B.depth / 2).build();
}

/** The cue sticker of an end exit, slot-local like buildBeltTray: on both faces of its board, upright, never mirrored. */
export function buildBeltCue(look: Pick<CueLook, 'fill' | 'rim' | 'ink' | 'glyph'>): BufferGeometry {
  const parts = new PartList();
  const y = beltCueY();
  const zb = beltBoardZ();
  const half = BELT.board.depth / 2;
  parts.add(buildCueFace(look, BELT_CUE), null, { y, z: zb + half + BELT_CUE.lift });
  parts.add(buildCueFace(look, BELT_CUE), null, { y, z: zb - half - BELT_CUE.lift, ry: Math.PI });
  return parts.build();
}

/** The glow band round an end exit's sticker (RGBA white: its material tints and fades it), on both faces of its board. */
export function buildBeltGlowGeometry(): BufferGeometry {
  const G = BELT_GLOW;
  const zb = beltBoardZ();
  const half = BELT.board.depth / 2;
  const geo = buildGlowFrameGeometry(G, BELT_CUE.halfH + 0.015, [zb + half + G.gap, zb - half - G.gap]);
  // buildGlowFrameGeometry frames the opening from y = 0 up: lift it round the sticker.
  geo.translate(0, beltCueY() - (BELT_CUE.halfH + 0.015), 0);
  return geo;
}
