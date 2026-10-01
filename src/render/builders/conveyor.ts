import { ShapeGeometry, type BufferGeometry } from 'three';
import { FACING_X, FACING_Z } from '../../core/racks';
import { cellToWorld, type Facing, type LevelConveyor, type LevelData, type LevelStorage } from '../../core/types';
import type { Theme } from '../../themes/types';
import { rackSlotY } from '../dims';
import { PartList, type Placement } from '../paint';
import { extrudedShapeGeometry, roundedRectShape } from '../shapes';
import { buildCueFace, buildGlowFrameGeometry, rectRingShape, type CueDims, type CueLook, type GlowFrameDims } from './rack';

/*
 * Conveyor belt (docs/CONVEYOR.md): a piece clearly apart from the rest of the furniture, clear and minimalist. A table
 * (H1b, «como una mesa con la cinta»): a light top on four slim graphite legs (a pair more every few cells of a long
 * belt) with a plain frame, an apron under the top and low stretchers between the legs, from its input's front to its
 * end exit's back. Its top stands at the floor of the slot of its belt's height (dims rackSlotY of the belt's level: a
 * floor belt's level 1, a rack's level-1 slot), where the boxes rest, so a box goes in at the forks' level 1 and rides
 * level. On it, over the belt's cells, a band of soft light-grey rubber between two fine light rails, its white stripes
 * sliding only while it runs (views/ConveyorView); no rollers, nothing over it. Its input is a pad in the belt's
 * identity colour on the table top, where the box is set down. Its end exit is the table's last stretch: a deck with
 * the cue sticker of its level (the rack's, builders/rack buildCueFace) painted flat on it, and a very low orange fence
 * (the look of the docks' guard rails, builders/truck buildDockRails, at a much lower scale: the same orange and cream
 * caps) along its three open edges, never on the side joined to the belt.
 */

/**
 * Belt measures (cell units). Belt-local space: +z along the belt from the input toward the end exit (its cells at
 * z = 1…n, the input at 0, the end exit at n + 1), x across it, y up from the floor.
 */
export const BELT = {
  /** Half width of the table across the belt: a cell less a little on each side. */
  halfW: 0.47,
  /** The table stops this short of the input's front edge and of the end exit's back edge. */
  endGap: 0.03,
  /** The table top: a slab `slab` thick under a skin `skin` thick (the band, the input's pad, the end exit's deck). */
  slab: 0.045,
  skin: 0.02,
  /** Half width of the band's surface between its rails (a box is 0.39 across each side). */
  band: 0.4,
  /** The fine rails along both sides of the band: their width and how far they stand over the table top. */
  edge: { width: 0.03, height: 0.025 },
  /** White stripes across the band: one every `period` along the belt, `width` wide, `lift` over it. */
  stripe: { period: 0.25, width: 0.07, lift: 0.0015 },
  /** Square legs `side` thick, `inset` inside the top's corners; a pair at least every `span` cells along the belt. */
  leg: { side: 0.06, inset: 0.03, span: 3 },
  /** The apron under the top, `height` tall and `depth` thick, its outer face flush with the legs'. */
  apron: { height: 0.07, depth: 0.025 },
  /** The low stretchers between the legs, on the same line as the apron, from `y0` to `y1` (clear of the tines). */
  stretcher: { y0: 0.1, y1: 0.135 },
  /** The input's pad on the table top: a rounded square. */
  pad: { half: 0.43, radius: 0.08 },
} as const;

/**
 * The very low fence round an end exit's three open edges (slot-local, heights over the table top): the look of a dock
 * guard rail (builders/truck RAIL) at a much smaller scale. Square posts `post` thick at the far corners and at the
 * near ends of the sides (by the belt), up to `top`, each with a cream cap `cap` high overhanging it by `capOver`; one
 * bar per edge between them, `bar` high from `barY`, `barDepth` thick. Its top is a fifth of a box's height: it never
 * hides the box or the cue.
 */
export const BELT_FENCE = { post: 0.032, top: 0.12, cap: 0.014, capOver: 0.005, bar: 0.022, barY: 0.055, barDepth: 0.016 } as const;

/**
 * The cue sticker painted flat on an end exit's deck (the rack's sticker, builders/rack buildCueFace, lying face up):
 * well inside the fence, so it reads from any camera turn over the fence.
 */
export const BELT_CUE: CueDims = { halfW: 0.28, halfH: 0.28, radius: 0.07, rim: 0.026, glyph: 0.34, lift: 0.003 };

/**
 * Glow band of an end exit (views/RackView SlotLight): a feathered frame of light flat on its deck, round the spot
 * where its box rests (a box is 0.39 across each side) and inside the fence, `lift` over the deck.
 */
export const BELT_GLOW: GlowFrameDims & { halfH: number; lift: number } = {
  halfW: 0.395,
  halfH: 0.395,
  solidX: 0.018,
  solidY: 0.018,
  featherX: 0.025,
  featherY: 0.025,
  radius: 0.06,
  lift: 0.006,
};

/** Success burst of an end exit (render/storage conveyor `burstAt`): its ring hugs the box resting on its deck. */
export const BELT_BURST = { halfW: 0.44 } as const;

/**
 * Chosen-level marker on a belt's input (views/SlotMarker; render/storage conveyor `markerAt`): a thin rounded frame
 * flat on the table top, round the input's pad (`halfW` its outer half extent, `width` its band), `lift` over it.
 */
export const BELT_MARKER = { halfW: 0.47, width: 0.03, radius: 0.07, lift: 0.004 } as const;

/** World y of a belt's table top at `level` (its cells' height): the floor of a slot there (dims rackSlotY). */
export function beltTopY(level: number): number {
  return rackSlotY(level);
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
 * The table of a belt, in world space (its top at `top`, dims beltTopY): the light slab from the input's front to the
 * end exit's back, the graphite legs at its corners (and a pair at least every BELT.leg.span cells), the apron under
 * the slab and the low stretchers between the legs, both on the legs' outer line, all round. Plain: no rollers, no
 * clutter.
 */
export function buildBeltTable(placement: Placement & { cells: number }, top: number, theme: Theme): BufferGeometry {
  const c = theme.conveyor;
  const L = BELT.leg;
  const A = BELT.apron;
  const S = BELT.stretcher;
  const local = new PartList();
  const z0 = -0.5 + BELT.endGap;
  const z1 = placement.cells + 1.5 - BELT.endGap;
  const under = top - BELT.skin - BELT.slab;
  local.block(c.top, -BELT.halfW, BELT.halfW, under, top - BELT.skin, z0, z1);
  // Legs: their outer faces `inset` inside the slab's edges, evenly along it, never more than `span` cells apart.
  const outer = BELT.halfW - L.inset;
  const first = z0 + L.inset;
  const last = z1 - L.inset;
  const spans = Math.max(1, Math.ceil((last - first) / L.span));
  for (let k = 0; k <= spans; k++) {
    const z = first + ((last - first - L.side) * k) / spans;
    for (const side of [-1, 1]) {
      const x = side * (outer - L.side / 2);
      local.block(c.frame, x - L.side / 2, x + L.side / 2, 0, under, z, z + L.side);
    }
  }
  // The apron under the slab and the stretchers near the floor: a frame on the legs' outer line, all round.
  for (const [y0, y1] of [
    [under - A.height, under],
    [S.y0, S.y1],
  ] as const) {
    for (const side of [-1, 1]) {
      const a = side * outer;
      const b = side * (outer - A.depth);
      local.block(c.frame, Math.min(a, b), Math.max(a, b), y0, y1, first + L.side, last - L.side);
    }
    for (const [za, zb] of [
      [first, first + A.depth],
      [last - A.depth, last],
    ] as const) {
      local.block(c.frame, -outer + L.side, outer - L.side, y0, y1, za, zb);
    }
  }
  return new PartList().append(local, placement).build();
}

/**
 * The band of a belt, in world space: its light-grey rubber over its cells, from the input's edge to the end exit's,
 * its surface at `top`, and the two fine rails along its sides (the stripes are views/ConveyorView's: they move).
 */
export function buildBeltBand(placement: Placement & { cells: number }, top: number, theme: Theme): BufferGeometry {
  const c = theme.conveyor;
  const local = new PartList();
  const z0 = 0.5;
  const z1 = placement.cells + 0.5;
  const outer = BELT.band + BELT.edge.width;
  local.block(c.belt, -BELT.band, BELT.band, top - BELT.skin, top, z0, z1);
  for (const side of [-1, 1]) {
    const a = side * BELT.band;
    const b = side * outer;
    local.block(c.edge, Math.min(a, b), Math.max(a, b), top - BELT.skin, top + BELT.edge.height, z0, z1);
  }
  return new PartList().append(local, placement).build();
}

/** A belt's input pad, in world space: a rounded square in its identity colour on the table top, its top at `top`. */
export function buildBeltPad(input: Pick<LevelStorage, 'x' | 'z'>, level: Pick<LevelData, 'size'>, top: number, identity: string): BufferGeometry {
  const at = cellToWorld(input, level.size);
  const pad = extrudedShapeGeometry(roundedRectShape(BELT.pad.half, BELT.pad.half, BELT.pad.radius, 4), BELT.skin, top - BELT.skin, 4);
  return new PartList().add(pad, identity, { x: at.x, z: at.z }).build();
}

/**
 * An end exit's deck, in slot-local space (origin = its cell's centre on the floor, +z toward its belt: builders/rack
 * outwardYaw of its facing): its stretch of the table top, from its back (the table's end) to its belt, its top at
 * `top`. Its own mesh so it can glow (views/RackView SlotLight).
 */
export function buildBeltDeck(top: number, theme: Theme): BufferGeometry {
  return new PartList().block(theme.conveyor.top, -BELT.halfW, BELT.halfW, top - BELT.skin, top, -0.5 + BELT.endGap, 0.5).build();
}

/**
 * The very low fence of an end exit (BELT_FENCE), slot-local like buildBeltDeck, on its deck at `top`: along its back
 * and both sides, open toward its belt; posts and bars in the docks' guard-rail orange (Theme.truck.rail), cream caps
 * (railCap). Static; it casts and takes shadows like the other props.
 */
export function buildBeltFence(top: number, theme: Theme): BufferGeometry {
  const F = BELT_FENCE;
  const rail = theme.truck.rail;
  const parts = new PartList();
  const x1 = BELT.halfW;
  const back = -0.5 + BELT.endGap;
  const near = 0.5;
  const y = (h: number) => top + h;
  // Posts at the back corners and at the sides' near ends (by the belt), each under its cap, which overhangs it only
  // over the deck (never past the table's edges, nor into the belt).
  const clampX = (u: number) => Math.min(x1, Math.max(-x1, u));
  const clampZ = (z: number) => Math.min(near, Math.max(back, z));
  for (const sx of [-1, 1]) {
    for (const [z0, z1] of [
      [back, back + F.post],
      [near - F.post, near],
    ] as const) {
      const xa = sx * x1;
      const xb = sx * (x1 - F.post);
      const [u0, u1] = [Math.min(xa, xb), Math.max(xa, xb)];
      parts.block(rail, u0, u1, y(0), y(F.top), z0, z1);
      parts.block(
        theme.truck.railCap,
        clampX(u0 - F.capOver),
        clampX(u1 + F.capOver),
        y(F.top),
        y(F.top + F.cap),
        clampZ(z0 - F.capOver),
        clampZ(z1 + F.capOver),
      );
    }
  }
  // One bar per edge, centred on the posts' line.
  const mid = (F.post - F.barDepth) / 2;
  parts.block(rail, -x1 + F.post, x1 - F.post, y(F.barY), y(F.barY + F.bar), back + mid, back + F.post - mid);
  for (const sx of [-1, 1]) {
    const xa = sx * (x1 - mid);
    const xb = sx * (x1 - F.post + mid);
    parts.block(rail, Math.min(xa, xb), Math.max(xa, xb), y(F.barY), y(F.barY + F.bar), back + F.post, near - F.post);
  }
  return parts.build();
}

/**
 * The cue sticker of an end exit, painted flat on its deck at `top`, face up (in world axes: like a zone's glyph, its
 * top toward the north, whatever way its belt runs), centred on the cell. For an unlit material (never shaded, never
 * faded).
 */
export function buildBeltCue(look: Pick<CueLook, 'fill' | 'rim' | 'ink' | 'glyph'>, top: number): BufferGeometry {
  return new PartList().add(buildCueFace(look, BELT_CUE), null, { y: top + BELT_CUE.lift, rx: -Math.PI / 2 }).build();
}

/**
 * The glow band of an end exit (BELT_GLOW: RGBA white, its material tints and fades it), flat on its deck at `top`
 * round the spot where its box rests, centred on the cell.
 */
export function buildBeltGlowGeometry(top: number): BufferGeometry {
  const G = BELT_GLOW;
  const geo = buildGlowFrameGeometry(G, G.halfH, [0]);
  // buildGlowFrameGeometry frames the opening from y = 0 up, facing +z: centre it, lay it face up on the deck.
  geo.translate(0, -G.halfH, 0);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, top + G.lift, 0);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Marker of the chosen level at a belt's input (views/SlotMarker, BELT_MARKER), in its slot-local space (origin = its
 * cell's centre at the chosen level's floor): a thin rounded frame flat on the table top, round its pad. Unlit white:
 * the marker's material gives it its tone.
 */
export function buildBeltMarkerGeometry(): BufferGeometry {
  const M = BELT_MARKER;
  const ring = new ShapeGeometry(rectRingShape(M.halfW, M.halfW, M.width, M.radius), 4);
  return new PartList().add(ring, '#ffffff', { y: M.lift, rx: -Math.PI / 2 }).build();
}
