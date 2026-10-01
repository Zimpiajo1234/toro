import { BufferAttribute, BufferGeometry, Path, Shape, ShapeGeometry, Vector2 } from 'three';
import { FACING_X, FACING_Z } from '../../core/racks';
import { BASE_GUARD } from '../../core/storage';
import { cellToWorld, type Facing, type LevelConveyor, type LevelData, type LevelStorage } from '../../core/types';
import type { Theme } from '../../themes/types';
import { rackSlotY } from '../dims';
import { PartList, type Placement } from '../paint';
import { extrudedShapeGeometry, roundedRectPoints, roundedRectShape } from '../shapes';
import { buildCueFace, buildGlowFrameGeometry, rectRingShape, type CueDims, type CueLook, type GlowFrameDims } from './rack';

/*
 * Conveyor belt (docs/CONVEYOR.md): a piece clearly apart from the rest of the furniture, clear and minimalist. A table
 * (H1b, «como una mesa con la cinta») standing on a closed base (H1c, «que no tenga patas, sea como una pared lateral
 * cerrada, así visualmente ocupa más»): a light top over a solid block whose side walls, a soft near-black, go down to
 * the floor all round, from its input's front to its end exit's back. Its top stands at the floor of the slot of its
 * belt's height (dims rackSlotY of the belt's level: a floor belt's level 1, a rack's level-1 slot), where the boxes
 * rest, so a box goes in at the forks' level 1 and rides level. On it, over the belt's cells, a band of soft light-grey
 * rubber between two fine light rails, its white stripes sliding only while it runs (views/ConveyorView); no rollers,
 * nothing over it. Its input is a pad in the belt's identity colour on the table top, where the box is set down, with
 * the drop icon painted on it and closed black guards on its two sides (it is loaded from its front only). Its end exit
 * is the table's last stretch: a deck with the cue sticker of its level (the rack's, builders/rack buildCueFace) painted
 * flat on it and a low solid skirting in the belt's identity colour along its three open edges, never on the side
 * joined to the belt. Its button (H2b), on a floor cell of its own next to the input, is the input's pad again, on the
 * floor, with a cream back arrow on it («un slot en el suelo con un icono de flecha hacia atrás… del mismo color que la
 * base A»): A and its button read as one. Round it, a halo of its light on the floor (H2c), lit by views/ConveyorView.
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
  /** The closed base under the top, from the floor up: its walls this far inside the top's edges (a slim shadow line). */
  base: { inset: 0.012 },
  /** The input's pad on the table top: a rounded square, just inside its side guards. */
  pad: { half: 0.43, radius: 0.08 },
} as const;

/**
 * The closed side guards of a belt's input (buildBeltGuards, slot-local, heights over the table top): solid panels on
 * its two side edges, from the table's front end to the belt, in the colour of the closed base (Theme.conveyor.side),
 * so it reads «no se carga por aquí». Their outer face flush with the top's edge, their inner one BASE_GUARD.inset in
 * from the cell's (the tines meet them there: logic/collision SolidBase); `top` high, under a fifth of a box: they never
 * hide the box being set down, nor the pad's icon.
 */
export const BELT_GUARD = { top: 0.12 } as const;

/**
 * The low skirting («rodapié») round an end exit's three open edges (buildBeltSkirting, slot-local, heights over its
 * deck): one continuous solid strip `thickness` thick and `top` high, in the belt's identity colour (its input's pad's:
 * several belts pair up by colour), never on the side joined to the belt. A tenth of a box high: it never hides the box
 * or the painted cue.
 */
export const BELT_SKIRTING = { top: 0.06, thickness: 0.03 } as const;

/**
 * The drop icon painted flat on a belt input's pad (buildBeltIcon, slot-local: +z toward its loading face): «deja aquí
 * una caja», light cream (Theme.conveyor.icon) on its identity colour. A bold arrow from the loading face pointing in
 * (the way the forklift drives and the box goes on, toward the belt) at the outline of a box seen from above: turned
 * with the input, so it says the same from every camera turn. A box resting on the pad hides it.
 */
export const BELT_ICON = {
  lift: 0.003,
  /** The box outline: centred at `z`, `half` its outer half side, a `ring` wide line, `radius` corners. */
  box: { z: -0.1, half: 0.2, ring: 0.05, radius: 0.05 },
  /** The arrow: its `tip` (nearest the box), the base of its head and its `tail` (z), head and shaft half widths. */
  arrow: { tip: 0.13, head: 0.25, tail: 0.4, halfHead: 0.12, halfShaft: 0.045 },
} as const;

/**
 * The cue sticker painted flat on an end exit's deck (the rack's sticker, builders/rack buildCueFace, lying face up):
 * well inside the skirting, so it reads from any camera turn over it.
 */
export const BELT_CUE: CueDims = { halfW: 0.28, halfH: 0.28, radius: 0.07, rim: 0.026, glyph: 0.34, lift: 0.003 };

/**
 * Glow band of an end exit (views/RackView SlotLight): a feathered frame of light flat on its deck, round the spot
 * where its box rests (a box is 0.39 across each side) and inside the skirting, `lift` over the deck.
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
 * A belt's button (H2b; buildBeltButtonPad, buildBeltButtonIcon), on a floor cell of its own next to its input: «un slot
 * en el suelo… del mismo color que la base A». Its input's pad over again, on the floor: the same rounded square
 * (BELT.pad), as thick as the input's (BELT.skin), the same rubber, in the belt's identity colour (its input's pad's and
 * its end exit's skirting's: with several belts each button pairs with its own), with a back arrow painted on it
 * (BELT_BUTTON_ICON). Flat: the forklift drives onto it. `dip` = how far it sinks into the floor on an accepted press
 * (views/ConveyorView BeltButton).
 */
export const BELT_BUTTON = { half: BELT.pad.half, radius: BELT.pad.radius, height: BELT.skin, dip: 0.01 } as const;

/**
 * The light a belt's button spills on the floor round its pad (H2c, «que cuando le des click se ilumine mucho más»;
 * buildBeltButtonHaloGeometry, views/ConveyorView BeltButton): a feathered rounded square hugging the pad from just under
 * its edge (`inset`) and fading out past it, ring by ring (`stops`: how far past the pad's edge, its alpha there), so it
 * reads round a forklift standing on the pad, from the default camera too (the forklift hides the light behind it, the
 * input's table the light on its side). `lift` over the floor, `segments` per corner. The zones' soft success glow,
 * much stronger: over three times as wide as a zone's halo (its 0.2), most of it into the cells round the pad.
 */
export const BELT_BUTTON_HALO = {
  inset: 0.02,
  stops: [
    { out: 0, alpha: 1 },
    { out: 0.2, alpha: 0.8 },
    { out: 0.45, alpha: 0.38 },
    { out: 0.7, alpha: 0 },
  ],
  lift: 0.004,
  segments: 6,
} as const;

/**
 * The back arrow painted flat on a belt's button (buildBeltButtonIcon, cell-local: +z along its belt, from the input
 * toward the end exit): «un icono de flecha hacia atrás», a bold U-turn in cream (Theme.conveyor.icon, the drop icon's)
 * on its identity colour. Its tail runs along the belt toward the end exit, it turns over and its head points back,
 * toward the input (seen with the belt running up: ↶, the box coming back). Turned with its belt; a turn is never a
 * mirror, so it reads the same from every camera turn. The forklift standing on the pad covers it.
 */
export const BELT_BUTTON_ICON = {
  lift: 0.003,
  /** The turn: the radius of its centre line, its centre (z), the width of the line. */
  turn: { radius: 0.14, z: 0.05, width: 0.075 },
  /** Where its tail starts (z). */
  tail: -0.2,
  /** The head: half its base, its length back toward the input. */
  head: { half: 0.11, length: 0.14 },
  /** Points on each half-turn edge. */
  segments: 10,
} as const;

/**
 * Chosen-level marker on a belt's input (views/SlotMarker; render/storage conveyor `markerAt`): a thin rounded frame
 * flat on the input's pad, along its rim, between its side guards (`halfW` its outer half extent, `width` its band),
 * `lift` over it.
 */
export const BELT_MARKER = { halfW: 0.43, width: 0.03, radius: 0.07, lift: 0.004 } as const;

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
 * end exit's back, on its closed base: one solid block from the floor up to the slab, its side walls all round in a
 * soft near-black (Theme.conveyor.side), BELT.base.inset inside the slab's edges. No legs: it occupies its cells, and
 * below its top the forks meet its face (docs/STORAGE.md «Nivel base»). Plain: no rollers, no clutter.
 */
export function buildBeltTable(placement: Placement & { cells: number }, top: number, theme: Theme): BufferGeometry {
  const c = theme.conveyor;
  const local = new PartList();
  const z0 = -0.5 + BELT.endGap;
  const z1 = placement.cells + 1.5 - BELT.endGap;
  const under = top - BELT.skin - BELT.slab;
  const i = BELT.base.inset;
  local.block(c.top, -BELT.halfW, BELT.halfW, under, top - BELT.skin, z0, z1);
  local.block(c.side, -BELT.halfW + i, BELT.halfW - i, 0, under, z0 + i, z1 - i);
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
 * The closed side guards of a belt's input (BELT_GUARD), in its slot-local space (origin = its cell's centre on the
 * floor, +z toward its loading face: builders/rack outwardYaw of its facing): a solid panel on each side edge, from the
 * belt (z = −0.5) to the table's front end, from the slab up to BELT_GUARD.top over the table top, in the base's
 * near-black. Its own mesh: it casts and takes shadows like the table.
 */
export function buildBeltGuards(top: number, theme: Theme): BufferGeometry {
  const parts = new PartList();
  const inner = 0.5 - BASE_GUARD.inset;
  for (const side of [-1, 1]) {
    const a = side * inner;
    const b = side * BELT.halfW;
    parts.block(theme.conveyor.side, Math.min(a, b), Math.max(a, b), top - BELT.skin, top + BELT_GUARD.top, -0.5, 0.5 - BELT.endGap);
  }
  return parts.build();
}

/**
 * The drop icon of a belt's input (BELT_ICON), slot-local like buildBeltGuards: flat on its pad at `top`, face up, its
 * arrow pointing in from the loading face to the box outline, in `color` (Theme.conveyor.icon).
 */
export function buildBeltIcon(top: number, color: string): BufferGeometry {
  const I = BELT_ICON;
  const B = I.box;
  const A = I.arrow;
  const parts = new PartList();
  // Drawn in the XY plane and laid face up (rx −π/2), so a shape's y is −z.
  const flat = (shape: Shape) => parts.add(new ShapeGeometry(shape, 4), color, { y: top + I.lift, rx: -Math.PI / 2 });
  const at = (points: Vector2[], y: number) => points.map((p) => new Vector2(p.x, p.y + y));
  // The box: its outline, a rounded ring.
  const outline = new Shape(at(roundedRectPoints(B.half, B.half, B.radius, 4), -B.z));
  outline.holes.push(new Path(at(roundedRectPoints(B.half - B.ring, B.half - B.ring, Math.max(0.01, B.radius - B.ring), 4), -B.z)));
  flat(outline);
  // The arrow: its shaft from the tail to its head, the head pointing in to the box.
  flat(rectShape(-A.halfShaft, -A.tail, A.halfShaft, -A.head));
  flat(new Shape([new Vector2(-A.halfHead, -A.head), new Vector2(A.halfHead, -A.head), new Vector2(0, -A.tip)]));
  return parts.build();
}

/** An axis-aligned rectangle as a shape (x0 < x1, y0 < y1). */
function rectShape(x0: number, y0: number, x1: number, y1: number): Shape {
  return new Shape([new Vector2(x0, y0), new Vector2(x1, y0), new Vector2(x1, y1), new Vector2(x0, y1)]);
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
 * The low skirting of an end exit (BELT_SKIRTING), slot-local like buildBeltDeck, on its deck at `top`: one solid strip
 * along its back and both sides, open toward its belt, in `identity` (its belt's identity colour, the one of its
 * input's pad). Static; it casts and takes shadows like the other props.
 */
export function buildBeltSkirting(top: number, identity: string): BufferGeometry {
  const S = BELT_SKIRTING;
  const parts = new PartList();
  const x1 = BELT.halfW;
  const back = -0.5 + BELT.endGap;
  parts.block(identity, -x1, x1, top, top + S.top, back, back + S.thickness);
  for (const side of [-1, 1]) {
    const a = side * x1;
    const b = side * (x1 - S.thickness);
    parts.block(identity, Math.min(a, b), Math.max(a, b), top, top + S.top, back + S.thickness, 0.5);
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
 * The pad of a belt's button (BELT_BUTTON), in its cell-local space (origin = its cell's centre on the floor): its
 * input's pad (buildBeltPad) standing on the floor, in `identity` (its belt's colour). Its own mesh: it glows and dips.
 */
export function buildBeltButtonPad(identity: string): BufferGeometry {
  const B = BELT_BUTTON;
  const pad = extrudedShapeGeometry(roundedRectShape(B.half, B.half, B.radius, 4), B.height, 0, 4);
  return new PartList().add(pad, identity).build();
}

/**
 * The light of a belt's button on the floor (BELT_BUTTON_HALO), in its cell-local space (origin = its cell's centre on
 * the floor): rounded-square rings round its pad, from just under the pad's edge out past it, joined ring to ring; white
 * RGBA vertices whose alpha follows the stops (0 at the outer one: feathered), so its material tints and fades it.
 * Flat, `lift` over the floor; the pad covers its inner edge.
 */
export function buildBeltButtonHaloGeometry(): BufferGeometry {
  const H = BELT_BUTTON_HALO;
  const B = BELT_BUTTON;
  const rings = H.stops.map((stop, i) => {
    const half = B.half + stop.out - (i === 0 ? H.inset : 0);
    return { points: roundedRectPoints(half, half, B.radius + stop.out, H.segments), alpha: stop.alpha };
  });
  const positions: number[] = [];
  const colors: number[] = [];
  // A shape point (x, y) lies flat at (x, lift, −y), like the zones' halo.
  const push = (p: Vector2, alpha: number) => {
    positions.push(p.x, H.lift, -p.y);
    colors.push(1, 1, 1, alpha);
  };
  for (let k = 1; k < rings.length; k++) {
    const inner = rings[k - 1];
    const outer = rings[k];
    const n = inner.points.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      push(inner.points[i], inner.alpha);
      push(outer.points[i], outer.alpha);
      push(outer.points[j], outer.alpha);
      push(inner.points[i], inner.alpha);
      push(outer.points[j], outer.alpha);
      push(inner.points[j], inner.alpha);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 4));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The back arrow of a belt's button (BELT_BUTTON_ICON), cell-local (+z along its belt: the mesh is turned with it),
 * flat on the pad's top, face up, in `color` (Theme.conveyor.icon): the tail, the half-turn and the head, the whole
 * centred on the pad.
 */
export function buildBeltButtonIcon(color: string): BufferGeometry {
  const I = BELT_BUTTON_ICON;
  const { radius: r, z: zc, width: w } = I.turn;
  const outer = r + w / 2;
  const inner = r - w / 2;
  // Centred on the pad: across, from the tail's outer edge (x = −outer) to the head's far corner; along, from the tail's
  // start to the top of the turn.
  const dx = -(r + I.head.half - outer) / 2;
  const dz = -(I.tail + zc + outer) / 2;
  // Drawn in cell-local (x, z) and laid face up (rx −π/2: a shape's y is −z).
  const point = (x: number, z: number) => new Vector2(x + dx, -(z + dz));
  const parts = new PartList();
  const flat = (points: Vector2[]) => parts.add(new ShapeGeometry(new Shape(points), 4), color, { y: BELT_BUTTON.height + I.lift, rx: -Math.PI / 2 });
  // The tail, along the belt on the −x side, up to where the turn starts.
  flat([point(-outer, I.tail), point(-inner, I.tail), point(-inner, zc), point(-outer, zc)]);
  // The half-turn over the top (toward the end exit), from −x round to +x.
  const turn: Vector2[] = [];
  for (let i = 0; i <= I.segments; i++) {
    const a = Math.PI - (Math.PI * i) / I.segments;
    turn.push(point(Math.cos(a) * outer, zc + Math.sin(a) * outer));
  }
  for (let i = I.segments; i >= 0; i--) {
    const a = Math.PI - (Math.PI * i) / I.segments;
    turn.push(point(Math.cos(a) * inner, zc + Math.sin(a) * inner));
  }
  flat(turn);
  // The head at the turn's end (+x), pointing back toward the input (−z).
  flat([point(r - I.head.half, zc), point(r, zc - I.head.length), point(r + I.head.half, zc)]);
  return parts.build();
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
