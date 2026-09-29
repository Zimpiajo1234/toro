import { Path, PlaneGeometry, Shape, ShapeGeometry, Vector2, type BufferGeometry } from 'three';
import { FACING_X, FACING_Z, runsAlongX } from '../../core/racks';
import { cueOf } from '../../core/sorting';
import type { Facing, LevelData, LevelRack } from '../../core/types';
import type { GlyphShape, Theme } from '../../themes/types';
import { RACK, rackSlotY } from '../dims';
import { glyphShape } from '../glyphs';
import { PartList, type Placement } from '../paint';
import { roundedRectPoints, roundedRectShape } from '../shapes';

/*
 * Storage rack (docs/RACKS.md): a plain, low-poly piece of painted metal, clearly another piece of furniture than the
 * wooden shelves (builders/shelf.ts): slate uprights, cream load beams, open slot floors, a back panel per slot and a
 * solid panel at each end, no bracing. Measured in depth d from the front face (d = 0) to the back face (d = 1) of its
 * 1-cell-deep cells.
 *
 * Clearances (cell units): the resting box spans d 0.11‥0.89 and ±0.39 across; the load going in keeps a couple of
 * cm of play inside the collision walls (logic RACK_WALL), reaching d ≈ 0.91 at most. So the uprights and the end
 * panels stay within 0.06 of the column edges, the beams' inner lips (d ≤ 0.12, ≥ 0.88) carry the box, and the back
 * panel starts at 0.95.
 */

/** Upright side (along the rack and in depth). End uprights sit inside the rack; inner ones straddle two columns. */
const POST = 0.06;
/** Uprights stand this much above the top beam. */
const POST_CAP = 0.025;
/** Depth of each beam from its face: the resting box sits on their inner lips. */
const BEAM_DEPTH = 0.12;
/**
 * Floor of every upper slot: two slim bars front to back (a metal deck, not a wooden board). Open, so the cue of the
 * slot below still shows through an empty slot from the front.
 */
const BAR = { offset: 0.25, half: 0.02, height: 0.025 } as const;

/** Back panel of a slot (depths from the front face), between its two beams. */
export const RACK_PANEL = { halfW: 0.44, d0: 0.95, d1: 0.98 } as const;
/** Height of a back panel: from the slot floor up to the beam of the slot above. */
export const PANEL_HEIGHT = RACK.pitch - RACK.beam;
/**
 * Solid end panel of the rack (along-rack offsets from its end), between the front and back uprights, from the floor
 * to the top beam of the end column: set a touch behind the uprights' outer faces, so they frame it.
 */
export const END_PANEL = { u0: 0.015, u1: 0.04 } as const;
/**
 * Cue sticker (the «leyenda» of a slot), on both faces of its back panel and on the outer face of the end panel beside
 * it: the front of a box as a flat sticker for an unlit material (its colour exactly the box's, never shaded), a rim
 * and, in the middle, a bold glyph. `lift` keeps each layer just off the surface under it.
 */
export const CUE = {
  halfW: 0.38,
  halfH: 0.3,
  radius: 0.08,
  rim: 0.03,
  glyph: 0.4,
  lift: 0.003,
} as const;
/**
 * Tape of the cue's colour on the front lip of its slot (on the beam top, clear of the resting box): the colour
 * reads from the front even where the panel is hidden by the slot above.
 */
export const LIP = { half: 0.36, d0: 0.015, d1: 0.1, height: 0.006 } as const;
/** Loading line painted in front of each column: a stop line along the face and two short bay marks. */
export const LOADING_LINE = { y: 0.0025, width: 0.045, inset: 0.1, near: 0.05, far: 0.5 } as const;
/**
 * Selected-slot marker (views/SlotMarker), just outside both faces: a thin frame over the slot's bay (on the uprights
 * and beams around its opening) and a small tab on each upright pointing in at mid-height, which stays in view beside
 * the load in front of the slot.
 */
const MARKER = {
  halfW: 0.5,
  over: 0.03,
  width: 0.035,
  radius: 0.06,
  gap: 0.012,
  tabOut: 0.54,
  tabIn: 0.42,
  tabHalf: 0.075,
} as const;

/**
 * What a slot's cue shows (LevelView picks it from the theme): `fill` = the colour of the box it asks for (the neutral
 * cue fill for a symbol only), `rim` its outline, `glyph` the symbol drawn in `ink` (or none), `lip` the tape on the
 * slot's front lip.
 */
export interface CueLook {
  fill: string;
  rim: string;
  ink: string;
  glyph: GlyphShape | null;
  lip: string;
}

/**
 * Rack-local → world. Local x runs along the rack in column order (column c spans c‥c+1), y is up and z crosses
 * the rack's depth (the outward side is `outwardZ`), centred on its cells: a pure yaw + translation, never a mirror.
 */
export function rackPlacement(rack: Pick<LevelRack, 'x' | 'z' | 'facing'>, level: Pick<LevelData, 'size'>): Placement {
  const hw = level.size.width / 2;
  const hd = level.size.depth / 2;
  return runsAlongX(rack.facing)
    ? { x: rack.x - hw, z: rack.z + 0.5 - hd }
    : { x: rack.x + 0.5 - hw, z: rack.z - hd, ry: -Math.PI / 2 };
}

/** Sign of the rack's front along rack-local z (racks facing north or east look toward local −z). */
function outwardZ(facing: Facing): 1 | -1 {
  return facing === 'south' || facing === 'west' ? 1 : -1;
}

/** Yaw that turns slot-local +z (see buildSlotPanel) toward the rack's front. */
export function outwardYaw(facing: Facing): number {
  return Math.atan2(FACING_X[facing], FACING_Z[facing]);
}

/** Top of the uprights of a column holding `levels` slots. */
export function rackTopY(levels: number): number {
  return rackSlotY(levels) + POST_CAP;
}

/**
 * The ends of the rack a column closes, as slot-local x directions (buildSlotCue): the first column closes the −x end
 * of rack-local space and the last one the +x end (a one-column rack both). Slot-local x is rack-local x turned with
 * the front (outwardYaw), so it flips for racks facing north or east. Middle columns close no end: [].
 */
export function cueEndSides(rack: Pick<LevelRack, 'facing' | 'columns'>, column: number): (1 | -1)[] {
  const out = outwardZ(rack.facing);
  const sides: (1 | -1)[] = [];
  if (column === 0) sides.push(out === 1 ? -1 : 1);
  if (column === rack.columns.length - 1) sides.push(out);
  return sides;
}

/**
 * Frame of a storage rack in world space, one geometry per column (a bay, so each can fade on its own): uprights,
 * the bottom deck, cream beams under every slot floor and on top of the column, the slot floors, a solid panel at
 * each end of the rack and the plain back panel of every «libre» slot (a slot with a cue gets its own panel mesh,
 * buildSlotPanel, so it can glow). The upright between two columns belongs to the first of them.
 */
export function buildRackBays(rack: LevelRack, level: Pick<LevelData, 'size'>, theme: Theme): BufferGeometry[] {
  const c = theme.rack;
  const w = rack.columns.length;
  const bays = rack.columns.map(() => new PartList());
  const out = outwardZ(rack.facing);
  const zOf = (d: number) => out * (0.5 - d);
  const block = (col: number, color: string, u0: number, u1: number, y0: number, y1: number, d0: number, d1: number) => {
    const za = zOf(d0);
    const zb = zOf(d1);
    bays[col].block(color, u0, u1, y0, y1, Math.min(za, zb), Math.max(za, zb));
  };
  const faces = [
    [0, POST],
    [1 - POST, 1],
  ] as const;
  const beams = [
    [0, BEAM_DEPTH],
    [1 - BEAM_DEPTH, 1],
  ] as const;

  // Uprights at every column boundary, front and back, as tall as the taller column beside them.
  const tops = rack.columns.map((slots) => rackTopY(slots.length));
  for (let b = 0; b <= w; b++) {
    const top = Math.max(b > 0 ? tops[b - 1] : 0, b < w ? tops[b] : 0);
    const u0 = b === 0 ? 0 : b === w ? w - POST : b - POST / 2;
    const col = Math.max(0, Math.min(w - 1, b - 1));
    for (const [d0, d1] of faces) block(col, c.frame, u0, u0 + POST, 0, top, d0, d1);
  }

  // Solid end panels between the end uprights, up to the top beam of the end column (they carry its cues).
  const endTop = (col: number) => rackSlotY(rack.columns[col].length);
  block(0, c.panel, END_PANEL.u0, END_PANEL.u1, 0, endTop(0), POST, 1 - POST);
  block(w - 1, c.panel, w - END_PANEL.u1, w - END_PANEL.u0, 0, endTop(w - 1), POST, 1 - POST);

  rack.columns.forEach((slots, col) => {
    // Between the uprights: end uprights are a full POST inside the rack, inner ones half.
    const u0 = col + (col === 0 ? POST : POST / 2);
    const u1 = col + 1 - (col === w - 1 ? POST : POST / 2);
    const n = slots.length;
    for (const [d0, d1] of beams) block(col, c.beam, u0, u1, 0, RACK.base, d0, d1);
    block(col, c.deck, u0, u1, 0, RACK.base, BEAM_DEPTH, 1 - BEAM_DEPTH);
    for (let k = 1; k <= n; k++) {
      const y = rackSlotY(k);
      for (const [d0, d1] of beams) block(col, c.beam, u0, u1, y - RACK.beam, y, d0, d1);
      if (k === n) continue;
      for (const s of [-BAR.offset, BAR.offset]) {
        const m = col + 0.5 + s;
        block(col, c.deck, m - BAR.half, m + BAR.half, y - BAR.height, y, BEAM_DEPTH, 1 - BEAM_DEPTH);
      }
    }
    for (let k = 0; k < n; k++) {
      if (cueOf(slots[k]) !== null) continue;
      const y = rackSlotY(k);
      const m = col + 0.5;
      block(col, c.panel, m - RACK_PANEL.halfW, m + RACK_PANEL.halfW, y, y + PANEL_HEIGHT, RACK_PANEL.d0, RACK_PANEL.d1);
    }
  });

  const placement = rackPlacement(rack, level);
  return bays.map((local) => new PartList().append(local, placement).build());
}

/**
 * Loading line on the floor in front of each column (the `facing` side), in world space: a stop line along the face
 * and two short bay marks, the rack's own soft slate (never a functional hue).
 */
export function addRackLines(parts: PartList, rack: LevelRack, level: Pick<LevelData, 'size'>, theme: Theme): void {
  const local = new PartList();
  const out = outwardZ(rack.facing);
  const L = LOADING_LINE;
  const flat = (u0: number, u1: number, d0: number, d1: number) => {
    const za = out * (0.5 - d0);
    const zb = out * (0.5 - d1);
    local.add(new PlaneGeometry(u1 - u0, Math.abs(zb - za)), theme.rack.line, {
      x: (u0 + u1) / 2,
      y: L.y,
      z: (za + zb) / 2,
      rx: -Math.PI / 2,
    });
  };
  for (let col = 0; col < rack.columns.length; col++) {
    flat(col + L.inset, col + 1 - L.inset, -L.near - L.width, -L.near);
    for (const u of [col + L.inset, col + 1 - L.inset - L.width]) flat(u, u + L.width, -L.far, -L.near - L.width);
  }
  parts.append(local, rackPlacement(rack, level));
}

/**
 * Plain back panel of a slot with a cue, in slot-local space: origin = the column cell's centre at the slot floor
 * (dims rackSlotY), +z toward the rack's front (outwardYaw), x along the rack. Its own mesh so it can glow (and fade
 * with its bay); the cue itself is buildSlotCue. One geometry, shared by every slot with a cue.
 */
export function buildSlotPanel(theme: Theme): BufferGeometry {
  const parts = new PartList();
  const P = RACK_PANEL;
  parts.block(theme.rack.panel, -P.halfW, P.halfW, 0, PANEL_HEIGHT, 0.5 - P.d1, 0.5 - P.d0);
  return parts.build();
}

/**
 * The cue of a slot, in the slot-local space of buildSlotPanel, for an unlit material (never shaded, never faded): a
 * sticker on both faces of the back panel and, for a column at an end of the rack, on the outer face of that end
 * panel (`endSides`, see cueEndSides), each upright and unmirrored for whoever looks at that face (pure yaws: the
 * rack reads from any side), plus the tape on the slot's front lip. One geometry per look and ends, shared by its
 * slots.
 */
export function buildSlotCue(look: CueLook, endSides: readonly (1 | -1)[] = []): BufferGeometry {
  const parts = new PartList();
  const y = PANEL_HEIGHT / 2;
  parts.add(buildCueFace(look), null, { y, z: 0.5 - RACK_PANEL.d0 + CUE.lift });
  parts.add(buildCueFace(look), null, { y, z: 0.5 - RACK_PANEL.d1 - CUE.lift, ry: Math.PI });
  for (const side of endSides) {
    parts.add(buildCueFace(look), null, { x: side * (0.5 - END_PANEL.u0 + CUE.lift), y, ry: (side * Math.PI) / 2 });
  }
  parts.block(look.lip, -LIP.half, LIP.half, 0, LIP.height, 0.5 - LIP.d1, 0.5 - LIP.d0);
  return parts.build();
}

/** One cue sticker, in the XY plane facing +Z from z = 0: the rim, the fill over it and the bold glyph on top. */
function buildCueFace(look: CueLook): BufferGeometry {
  const parts = new PartList();
  const r = CUE.rim;
  parts.add(new ShapeGeometry(roundedRectShape(CUE.halfW, CUE.halfH, CUE.radius, 4), 4), look.rim);
  const fill = roundedRectShape(CUE.halfW - r, CUE.halfH - r, CUE.radius - r, 4);
  parts.add(new ShapeGeometry(fill, 4), look.fill, { z: CUE.lift });
  if (look.glyph) parts.add(new ShapeGeometry(glyphShape(look.glyph, CUE.glyph), 6), look.ink, { z: 2 * CUE.lift });
  return parts.build();
}

/**
 * Marker of the selected slot (views/SlotMarker), in slot-local space: on the front face and on the back face, each
 * facing out, a thin rounded frame over the slot's bay and two small tabs pointing in from the uprights at mid-height
 * (a level mark). Unlit white: the marker's material gives it its tone.
 */
export function buildSlotMarkerGeometry(): BufferGeometry {
  const parts = new PartList();
  const M = MARKER;
  const face = (z: number, ry: number) => {
    const ring = rectRingShape(M.halfW, PANEL_HEIGHT / 2 + M.over, M.width, M.radius);
    parts.add(new ShapeGeometry(ring, 4), '#ffffff', { y: PANEL_HEIGHT / 2, z, ry });
    for (const side of [-1, 1]) {
      const tab = new Shape([
        new Vector2(side * M.tabOut, -M.tabHalf),
        new Vector2(side * M.tabOut, M.tabHalf),
        new Vector2(side * M.tabIn, 0),
      ]);
      parts.add(new ShapeGeometry(tab), '#ffffff', { y: PANEL_HEIGHT / 2, z: z + (ry === 0 ? 0.002 : -0.002), ry });
    }
  };
  face(0.5 + M.gap, 0);
  face(-0.5 - M.gap, Math.PI);
  return parts.build();
}

/** Rounded-rectangle ring `width` wide (outer half extents given). */
function rectRingShape(halfW: number, halfH: number, width: number, radius: number): Shape {
  const shape = roundedRectShape(halfW, halfH, radius, 4);
  shape.holes.push(new Path(roundedRectPoints(halfW - width, halfH - width, Math.max(0.01, radius - width), 4)));
  return shape;
}
