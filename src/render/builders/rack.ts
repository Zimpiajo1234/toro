import { BufferAttribute, BufferGeometry, Path, PlaneGeometry, Shape, ShapeGeometry, Vector2 } from 'three';
import { FACING_X, FACING_Z, runsAlongX } from '../../core/racks';
import { cueOf } from '../../core/sorting';
import type { Facing, LevelData, LevelRack, RackSlot } from '../../core/types';
import type { GlyphShape, Theme } from '../../themes/types';
import { RACK, rackSlotY } from '../dims';
import { glyphShape } from '../glyphs';
import { PartList, type Placement } from '../paint';
import { roundedRectPoints, roundedRectShape } from '../shapes';

/*
 * Storage rack (docs/RACKS.md): a plain, low-poly piece of painted metal, clearly another piece of furniture than the
 * wooden shelves (builders/shelf.ts): slate uprights, cream load beams, open slot floors, a back panel per slot and,
 * at each end, only a faint see-through plate that holds the end cues (no solid side wall: the boxes in the end column
 * show from the side), no bracing. Measured in depth d from the front face (d = 0) to the back face (d = 1) of its
 * 1-cell-deep cells.
 *
 * Clearances (cell units): the resting box spans d 0.11‥0.89 and ±0.39 across; the load going in keeps a couple of
 * cm of play inside the collision walls (logic RACK_WALL), reaching d ≈ 0.91 at most. So the uprights and the end
 * plates stay within 0.06 of the column edges, the beams' inner lips (d ≤ 0.12, ≥ 0.88) carry the box, and the back
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
 * See-through end plate of the rack (along-rack offsets from its end), between the front and back uprights, from the
 * floor to the top beam of the end column, set a touch behind the uprights' outer faces, so they frame it. Not a wall:
 * a faint sheet (views/RackView END_PLATE_OPACITY, never writing depth nor casting a shadow) that only holds the end
 * cues, so the boxes in the end column read through it. Its own geometry (buildRackBays), apart from the solid frame.
 */
export const END_PLATE = { u0: 0.015, u1: 0.04 } as const;
/**
 * Cue sticker (the «leyenda» of a slot), on both faces of its back panel and on the outer face of the end plate beside
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
 * Glow band of a slot with a cue (views/RackView, levels with racks): a soft rounded frame of light just outside both
 * faces of its bay, around the slot opening: a solid strip over the uprights (`solidX`) and the beams under and above
 * it (`solidY`, their height), then a short feather (alpha 1 → 0). It never reaches into the opening of the slot above
 * or below, nor covers a cue or the load going in. Lit while a carried box fits the cue (a clear pulse) and in the
 * flash of the destined box.
 */
export const SLOT_GLOW = { halfW: 0.45, solidX: 0.035, solidY: 0.035, featherX: 0.045, featherY: 0.012, radius: 0.05, gap: 0.006 } as const;

/**
 * What the rack builders read of a unit loaded from its front (render/storage rack: a LevelStorage of skin `rack`; a
 * LevelRack reads the same): its first cell, its front's facing and, per column, its slots' cues bottom → top («libre»
 * = null, or a cue asking for nothing).
 */
export type RackShape = Pick<LevelRack, 'x' | 'z' | 'facing'> & { readonly columns: readonly (readonly (RackSlot | null)[])[] };

/**
 * What a slot's cue shows (render/storage picks it from the theme): `fill` = the colour of the box it asks for (the
 * neutral cue fill for a symbol only), `rim` its outline, `glyph` the symbol drawn in `ink` (or none), `lip` the tape
 * on the slot's front lip.
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
export function cueEndSides(rack: Pick<RackShape, 'facing' | 'columns'>, column: number): (1 | -1)[] {
  const out = outwardZ(rack.facing);
  const sides: (1 | -1)[] = [];
  if (column === 0) sides.push(out === 1 ? -1 : 1);
  if (column === rack.columns.length - 1) sides.push(out);
  return sides;
}

/**
 * A storage rack in world space. First its frame, one geometry per column in column order (a bay, so each can fade on
 * its own): uprights, the bottom deck, cream beams under every slot floor and on top of the column, the slot floors
 * and the plain back panel of every «libre» slot (a slot with a cue gets its own panel mesh, buildSlotPanel, so it can
 * glow). The upright between two columns belongs to the first of them. No wall closes the ends. Then the see-through
 * plate of each end (END_PLATE; one geometry per end column, both ends in one for a one-column rack), tagged with that
 * column (endPlateColumn): views/RackView draws it apart, faint, with its bay.
 */
export function buildRackBays(rack: RackShape, level: Pick<LevelData, 'size'>, theme: Theme): BufferGeometry[] {
  const c = theme.rack;
  const w = rack.columns.length;
  const bays = rack.columns.map(() => new PartList());
  const out = outwardZ(rack.facing);
  const zOf = (d: number) => out * (0.5 - d);
  const put = (parts: PartList, color: string, u0: number, u1: number, y0: number, y1: number, d0: number, d1: number) => {
    const za = zOf(d0);
    const zb = zOf(d1);
    parts.block(color, u0, u1, y0, y1, Math.min(za, zb), Math.max(za, zb));
  };
  const block = (col: number, color: string, u0: number, u1: number, y0: number, y1: number, d0: number, d1: number) =>
    put(bays[col], color, u0, u1, y0, y1, d0, d1);
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

  // The see-through plates between the end uprights, up to the top beam of the end column: they only hold its end
  // cues (buildSlotCue), apart from the frame so they can stay faint.
  const plates = new Map<number, PartList>();
  for (const [col, u0, u1] of [
    [0, END_PLATE.u0, END_PLATE.u1],
    [w - 1, w - END_PLATE.u1, w - END_PLATE.u0],
  ] as const) {
    const parts = plates.get(col) ?? new PartList();
    plates.set(col, parts);
    put(parts, c.panel, u0, u1, 0, rackSlotY(rack.columns[col].length), POST, 1 - POST);
  }

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
      const slot = slots[k];
      if (slot !== null && cueOf(slot) !== null) continue;
      const y = rackSlotY(k);
      const m = col + 0.5;
      block(col, c.panel, m - RACK_PANEL.halfW, m + RACK_PANEL.halfW, y, y + PANEL_HEIGHT, RACK_PANEL.d0, RACK_PANEL.d1);
    }
  });

  const placement = rackPlacement(rack, level);
  const place = (local: PartList) => new PartList().append(local, placement).build();
  const endPlates = [...plates].map(([col, local]) => {
    const geometry = place(local);
    geometry.userData.rackEndPlate = col;
    return geometry;
  });
  return [...bays.map(place), ...endPlates];
}

/** The end column a geometry of buildRackBays is the see-through end plate of, or null for a column's frame. */
export function endPlateColumn(geometry: BufferGeometry): number | null {
  const col: unknown = geometry.userData.rackEndPlate;
  return typeof col === 'number' ? col : null;
}

/**
 * Loading line on the floor in front of each column (the `facing` side), in world space: a stop line along the face
 * and two short bay marks, the rack's own soft slate (never a functional hue).
 */
export function addRackLines(parts: PartList, rack: RackShape, level: Pick<LevelData, 'size'>, theme: Theme): void {
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
 * plate (`endSides`, see cueEndSides), each upright and unmirrored for whoever looks at that face (pure yaws: the
 * rack reads from any side), plus the tape on the slot's front lip. One geometry per look and ends, shared by its
 * slots.
 */
export function buildSlotCue(look: CueLook, endSides: readonly (1 | -1)[] = []): BufferGeometry {
  const parts = new PartList();
  const y = PANEL_HEIGHT / 2;
  parts.add(buildCueFace(look), null, { y, z: 0.5 - RACK_PANEL.d0 + CUE.lift });
  parts.add(buildCueFace(look), null, { y, z: 0.5 - RACK_PANEL.d1 - CUE.lift, ry: Math.PI });
  for (const side of endSides) {
    parts.add(buildCueFace(look), null, { x: side * (0.5 - END_PLATE.u0 + CUE.lift), y, ry: (side * Math.PI) / 2 });
  }
  parts.block(look.lip, -LIP.half, LIP.half, 0, LIP.height, 0.5 - LIP.d1, 0.5 - LIP.d0);
  return parts.build();
}

/** Measures of a cue sticker (CUE for a rack slot; builders/truck SIGN_CUE for a cell of a dock sign, smaller). */
export interface CueDims {
  halfW: number;
  halfH: number;
  radius: number;
  rim: number;
  glyph: number;
  lift: number;
}

/**
 * One cue sticker, in the XY plane facing +Z from z = 0: the rim, the fill over it and the bold glyph on top. Shared by
 * the rack slots and the dock signs over the truck doors (docs/DOCKS.md), so both read the same.
 */
export function buildCueFace(look: Pick<CueLook, 'fill' | 'rim' | 'ink' | 'glyph'>, dims: CueDims = CUE): BufferGeometry {
  const parts = new PartList();
  const r = dims.rim;
  parts.add(new ShapeGeometry(roundedRectShape(dims.halfW, dims.halfH, dims.radius, 4), 4), look.rim);
  const fill = roundedRectShape(dims.halfW - r, dims.halfH - r, dims.radius - r, 4);
  parts.add(new ShapeGeometry(fill, 4), look.fill, { z: dims.lift });
  if (look.glyph) parts.add(new ShapeGeometry(glyphShape(look.glyph, dims.glyph), 6), look.ink, { z: 2 * dims.lift });
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

/**
 * Glow band of a slot (SLOT_GLOW), in slot-local space: on the front and on the back face, a rounded frame of light
 * around the slot opening (from its floor up to the beam of the slot above): RGBA white vertices, a solid strip
 * (alpha 1) and a feather out to alpha 0. Tinted and faded by its material (a vertex-alpha overlay, both sides).
 */
export function buildSlotGlowGeometry(): BufferGeometry {
  return buildGlowFrameGeometry(SLOT_GLOW, PANEL_HEIGHT / 2, [0.5 + SLOT_GLOW.gap, -0.5 - SLOT_GLOW.gap]);
}

/** Measures of a glow band (SLOT_GLOW; builders/truck SIGN_GLOW round a dock sign cell's sticker). */
export interface GlowFrameDims {
  halfW: number;
  solidX: number;
  solidY: number;
  featherX: number;
  featherY: number;
  radius: number;
}

/**
 * A feathered frame of light (RGBA white vertices: a solid strip at alpha 1 around an opening `halfW` × `halfH`, from
 * y = 0 up, then a feather out to alpha 0), in the XY plane at each z of `faces`. Tinted and faded by its material.
 */
export function buildGlowFrameGeometry(G: GlowFrameDims, halfH: number, faces: readonly number[]): BufferGeometry {
  const ring = (dx: number, dy: number) => roundedRectPoints(G.halfW + dx, halfH + dy, G.radius + dy, 3);
  const inner = ring(0, 0);
  const solid = ring(G.solidX, G.solidY);
  const outer = ring(G.solidX + G.featherX, G.solidY + G.featherY);
  const positions: number[] = [];
  const colors: number[] = [];
  const push = (p: Vector2, z: number, alpha: number) => {
    positions.push(p.x, halfH + p.y, z);
    colors.push(1, 1, 1, alpha);
  };
  // A strip of quads between two rings of matching points (same corners, same segments).
  const strip = (a: Vector2[], alphaA: number, b: Vector2[], alphaB: number, z: number) => {
    for (let i = 0; i < a.length; i++) {
      const j = (i + 1) % a.length;
      push(a[i], z, alphaA);
      push(b[i], z, alphaB);
      push(b[j], z, alphaB);
      push(a[i], z, alphaA);
      push(b[j], z, alphaB);
      push(a[j], z, alphaA);
    }
  };
  for (const z of faces) {
    strip(inner, 1, solid, 1, z);
    strip(solid, 1, outer, 0, z);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 4));
  geo.computeBoundingSphere();
  return geo;
}

/** Rounded-rectangle ring `width` wide (outer half extents given): a slot marker's frame (also a dock sign cell's). */
export function rectRingShape(halfW: number, halfH: number, width: number, radius: number): Shape {
  const shape = roundedRectShape(halfW, halfH, radius, 4);
  shape.holes.push(new Path(roundedRectPoints(halfW - width, halfH - width, Math.max(0.01, radius - width), 4)));
  return shape;
}
