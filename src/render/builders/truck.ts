import { CylinderGeometry, ShapeGeometry, type BufferGeometry, type Vector3 } from 'three';
import type { DockRail } from '../../core/docks';
import { clamp } from '../../core/math';
import type { LevelData, LevelTruck, TruckCue, WallSide } from '../../core/types';
import type { Theme } from '../../themes/types';
import { DIORAMA, DOCK } from '../dims';
import { PartList, type Placement } from '../paint';
import { buildCueFace, buildGlowFrameGeometry, rectRingShape, type CueDims, type CueLook, type GlowFrameDims } from './rack';
import { DOOR, dockSpan } from './walls';

/*
 * Loading dock (docs/DOCKS.md): a small, friendly low-poly rigid truck parked OUTSIDE the building, its rear right
 * against the outer face of the wall at the dock door, as plain as the storage racks (square blocks, no clutter,
 * pastel and slate). Built in "dock-local" space = the local frame of its wall (builders/walls): x along the wall,
 * y up, z inward (the wall's inner face is z = 0, its outer face z = −T; everything of the truck lies at z < −T). A
 * pure yaw + translation from world (dockPlacement), never a mirror.
 *
 * The door cells (the map cells in front of the door, 0 < z < 1) are plain floor: the forklift stands there facing
 * the wall, its body stops at the wall line and its forks and load reach through the door onto the bed column just
 * beyond (−1 < z < 0: a loaded box spans z −0.89‥−0.11, its inner end inside the door opening).
 * - buildDockPlate (flat, never in the way): the slate dock plate across the wall thickness in the door opening, a
 *   bevelled lip onto the floor and a lap onto the truck's bed, a hinge and a few treads.
 * - buildDockRails: a low orange guard rail at each end of the door run, from the door frame straight into the room
 *   over its door cells (0 < z < 1), on the door's jamb line: two posts with cream caps and two bars (RAIL).
 * - buildTruckBody: a low open flatbed level with the floor (DOCK.bedTop), low drop sides at both ends of the door run
 *   and a headboard by the cab (nothing over or between its bed columns: no posts, rails or boards), the chassis, an
 *   under-run bumper, the wheels, the cab-over cab facing away, and the driveway a step down (the dock pit) with its
 *   pit face and two guide lines. Low: from any camera looking over it it hides nothing inside the warehouse, so it
 *   never sinks with its wall (the boxes on its bed are ordinary boxes at their state positions).
 * - The dock sign on the inner face above the door (buildSignFrame + buildSignPanel + buildSignCue +
 *   buildSignGlowGeometry): a framed grid with one cell per bed column (right above its door cell, so left to right it
 *   reads as the door cells from either face) and per level (bottom row = level 0), each cell a lit cream panel with
 *   the rack sticker of its level's cue on both faces, upright and unmirrored for whoever looks at that face. The cell
 *   of a «libre» level (or of a column with fewer levels than the tallest one: never in a level, whose truck columns
 *   all hold the same levels, docs/STORAGE.md rule 7) stays a plain panel. The chosen level's cell gets the marker of
 *   views/SlotMarker (buildSignMarkerGeometry).
 */

export const TRUCK = {
  /** Bed and drop sides stay this far inside each end of the door run (the door's seals fit around them). */
  inset: 0.06,
  /** Gap between the bed's rear and the wall's outer face. */
  rearGap: 0.012,
  /** Bed length from its rear outward (it carries a box from 0.11 to 0.89 beyond the wall's inner face). */
  bedLength: 1.1,
  deckBottom: -0.05,
  /** Plank seams along the bed, about this far apart. */
  plank: 0.24,
  /** Rear sill: a slate edge across the bed's rear face, flush with the deck (the dock plate laps over it). */
  sill: 0.03,
  /** Low drop sides at both ends of the run: thickness, top (world y) and the slate cap on it. */
  side: 0.035,
  sideTop: 0.16,
  sideCap: 0.02,
  /**
   * Headboard across the front end of the bed, by the cab (the bed's planks and drop sides stop at it): its board
   * depth, the posts' width and depth, its top and cap.
   */
  headboard: { depth: 0.035, post: 0.05, postDepth: 0.055, top: 0.92, cap: 0.04 },
  wheelR: 0.19,
  wheelW: 0.14,
  /** Rear axle, this far out from the bed's rear. */
  rearAxle: 0.42,
  /** Under-run bumper under the bed's rear: its height range and depth. */
  underrun: { y0: -0.3, y1: -0.22, depth: 0.035 },
  /**
   * Cab-over cab past the headboard (`gap`): its length, its width (`share` of the bed, within minW‥maxW), the
   * bottom of its body, the belt line (windows above it), the top of the cabin under a thin roof and its roof pod.
   */
  cab: { gap: 0.08, length: 0.95, share: 0.82, minW: 0.86, maxW: 1.7, bottom: -0.1, belt: 0.42, top: 0.98, roof: 0.06, pod: 0.11 },
  /** Driveway: its margin past the run's ends, how far it goes past the cab, its thickness and the guide lines. */
  apron: { margin: 0.4, beyond: 0.35, thickness: 0.12, line: 0.05, lineGap: 0.2 },
} as const;

/**
 * Dock plate (buildDockPlate), dock-local: its top (under the drop preview on the bed, 0.028), the bevelled lip onto
 * the floor (`lip` into the room, two steps down from `lipTop`), the lap onto the bed (`lap` out past the wall's outer
 * face, over the rear sill), the hinge bar at the wall's outer face and the flat treads.
 */
export const DOCK_PLATE = { top: 0.025, lip: 0.08, lipTop: 0.014, lap: 0.13, hinge: 0.012, tread: 0.0012 } as const;

/**
 * Dock sign on the inner face above the door (dock-local): `gap` over the door frame's head, its back `back` off the
 * wall (clear of the wall cap's overhang), `depth` deep; a slate `border` round it, `divider` bars between its cells,
 * `row` of height per level; each cell's cream panel `panel` thick, centred in the frame's depth (recessed on both
 * faces); two slate brackets hold it to the wall (`bracket`: width, height range over the sign's bottom, how far they
 * reach into the frame), each right behind an end bar of the border, so from outside they never cover a sticker. With
 * two levels it rises ≈ 0.3 over the wall cap, like a shop sign.
 */
export const DOCK_SIGN = {
  gap: 0.02,
  back: 0.035,
  depth: 0.05,
  border: 0.05,
  divider: 0.024,
  row: 0.34,
  panel: 0.024,
  bracket: { w: 0.03, y0: 0.06, y1: 0.2, grip: 0.01 },
} as const;

/** A sign cell's sticker: the rack sticker (builders/rack CUE) sized for a cell of the dock sign. */
export const SIGN_CUE: CueDims = { halfW: 0.29, halfH: 0.13, radius: 0.05, rim: 0.022, glyph: 0.17, lift: 0.003 };

/**
 * Glow band of a sign cell (views/TruckView): a feathered frame of light on both faces of its panel, just outside its
 * sticker, `gap` off the panel.
 */
export const SIGN_GLOW: GlowFrameDims & { halfH: number; gap: number } = {
  halfW: SIGN_CUE.halfW + 0.012,
  halfH: SIGN_CUE.halfH + 0.012,
  solidX: 0.02,
  solidY: 0.018,
  featherX: 0.035,
  featherY: 0.012,
  radius: 0.05,
  gap: 0.004,
};

/**
 * Chosen-level marker on a sign cell (views/SlotMarker; render/storage truck `markerAt`), like a rack slot's: a thin
 * rounded frame over the bars around the cell's opening, `gap` off both faces of the sign. The size of a cell: out to
 * the middle of the bars between cells along the wall (one door cell wide, `halfW`) and just past the row's height up
 * and down (`halfH`); `width` its band, `radius` its corners.
 */
export const SIGN_MARKER = { halfW: 0.5, halfH: DOCK_SIGN.row / 2 + 0.012, width: 0.03, radius: 0.05, gap: 0.008 } as const;

/** Success burst of a truck level (render/storage truck `burstAt`): its ring hugs the box's face on the door plane. */
export const TRUCK_BURST = { halfW: 0.44 } as const;

/**
 * What the dock builders read of a unit loaded through a dock door (render/storage truck: a LevelStorage of skin
 * `truck`; a LevelTruck reads the same): its wall, its first door cell and, per bed column, its levels' cues bottom
 * → top (null = «libre»: its sign cell stays a plain panel).
 */
export type DockShape = Pick<LevelTruck, 'wall' | 'x' | 'z'> & { readonly columns: readonly (readonly (TruckCue | null)[])[] };

/**
 * Guard rail of a dock door (buildDockRails), dock-local, inside the footprint the logic gives it (core/docks DockRail:
 * DOCK_RAIL.thickness from the door's jamb line outward, from the wall's inner face to one cell in): two posts `post`
 * deep, one against the door frame (which stands DOOR.proud off the wall) and one at the inner end, up to `top`, each
 * with a cream cap `cap` high that overhangs it by `capOver`; two bars between them, `bar` high, their bottoms at
 * `bars`, `barInset` inside the rail's faces. Low: well under a carried box (its top ≈ 0.98), so it never hides the
 * load, a box on the door cells or the sign.
 */
export const RAIL = { post: 0.06, top: 0.5, cap: 0.03, capOver: 0.008, bar: 0.045, barInset: 0.01, bars: [0.2, 0.41] } as const;

/** Dock-local → world: its wall's own transform (builders/walls wallLayouts). */
export function dockPlacement(wall: WallSide, level: Pick<LevelData, 'size'>): Placement {
  const { width: w, depth: d } = level.size;
  return wall === 'north' ? { x: -w / 2, z: -d / 2 } : { x: -w / 2, z: d / 2, ry: Math.PI / 2 };
}

/** A dock-local point (x, y, z) of a dock in `wall`, in world space (dockPlacement), into `out`. Allocation-free. */
export function dockToWorld(wall: WallSide, level: Pick<LevelData, 'size'>, x: number, y: number, z: number, out: Vector3): Vector3 {
  const { width: w, depth: d } = level.size;
  // West: a quarter turn, local (x, z) → world (z, −x).
  return wall === 'north' ? out.set(x - w / 2, y, z - d / 2) : out.set(z - w / 2, y, d / 2 - x);
}

/** Dock-local x of the centre of bed column `column` (a west dock's columns run toward −x: see dockSpan). */
export function dockColumnX(truck: Pick<LevelTruck, 'wall' | 'x' | 'z'>, level: Pick<LevelData, 'size'>, column: number): number {
  return truck.wall === 'north' ? truck.x + column + 0.5 : level.size.depth - truck.z - column - 0.5;
}

/** Place of bed column `column` along the door run, from its start (dockSpan a): a west dock's columns run backward. */
function runIndex(truck: Pick<DockShape, 'wall' | 'columns'>, column: number): number {
  return truck.wall === 'north' ? column : truck.columns.length - 1 - column;
}

/** Rows of the truck's sign: the levels of its tallest bed column. */
export function signRows(truck: Pick<DockShape, 'columns'>): number {
  let rows = 1;
  for (const column of truck.columns) rows = Math.max(rows, column.length);
  return rows;
}

/** Bottom of the dock sign (world y): over the door frame's head. */
export function signBottom(): number {
  return DOCK.doorTop + DOOR.frame + DOCK_SIGN.gap;
}

/** Height of the centre of the sign row of `level` (bottom row = level 0). */
export function signRowY(level: number): number {
  return signBottom() + DOCK_SIGN.border + (level + 0.5) * DOCK_SIGN.row;
}

/** Top of a dock sign of `rows` rows. */
export function signTop(rows: number): number {
  return signBottom() + 2 * DOCK_SIGN.border + rows * DOCK_SIGN.row;
}

/** Dock-local z of the sign's mid-plane (where its cells' panels, stickers and bands are centred). */
export function signMidZ(): number {
  return DOCK_SIGN.back + DOCK_SIGN.depth / 2;
}

/** The opening of a sign cell between its frame bars, around the cell's centre (along the wall and up). */
export interface SignCell {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * The opening of the sign cell of `column` at `level`, in cell-local coordinates (origin at the centre of the column's
 * door cell along the wall and at signRowY(level); x along the wall like dock-local x): the outer border at the ends
 * of the sign, half a divider toward a neighbouring cell.
 */
export function signCell(truck: Pick<DockShape, 'wall' | 'columns'>, column: number, level: number): SignCell {
  const S = DOCK_SIGN;
  const n = truck.columns.length;
  const rows = signRows(truck);
  const j = runIndex(truck, column);
  return {
    x0: -0.5 + (j === 0 ? S.border : S.divider / 2),
    x1: 0.5 - (j === n - 1 ? S.border : S.divider / 2),
    y0: -S.row / 2 + (level === 0 ? 0 : S.divider / 2),
    y1: S.row / 2 - (level === rows - 1 ? 0 : S.divider / 2),
  };
}

/** The truck's cab, in dock-local space: its x range and its back (toward the bed) and front faces. */
function cabBox(x0: number, x1: number): { l: number; r: number; back: number; front: number } {
  const C = TRUCK.cab;
  const cx = (x0 + x1) / 2;
  const w = Math.min(x1 - x0 + 0.04, clamp((x1 - x0) * C.share, C.minW, C.maxW));
  const back = bedRear() - TRUCK.bedLength - C.gap;
  return { l: cx - w / 2, r: cx + w / 2, back, front: back - C.length };
}

/** Dock-local z of the bed's rear, just off the wall's outer face. */
function bedRear(): number {
  return -DIORAMA.wallThickness - TRUCK.rearGap;
}

/** A wheel (tyre + hub) with its axis along x, centred at (x, y, z). */
function addWheel(parts: PartList, theme: Theme, x: number, y: number, z: number): void {
  const R = TRUCK.wheelR;
  const W = TRUCK.wheelW;
  parts.add(new CylinderGeometry(R, R, W, 12), theme.truck.wheel, { x, y, z, rz: Math.PI / 2 });
  parts.add(new CylinderGeometry(R * 0.45, R * 0.45, W + 0.02, 10), theme.truck.hub, { x, y, z, rz: Math.PI / 2 });
}

/**
 * The dock plate, in world space (flat: it never hides anything and needs no ghost): a slate plate filling the door
 * opening across the wall thickness from the sill up to DOCK_PLATE.top, its bevelled lip onto the warehouse floor, its
 * lap onto the truck's bed out past the wall's outer face (between the drop sides), the hinge bar where they meet and
 * three flat treads.
 */
export function buildDockPlate(truck: DockShape, level: Pick<LevelData, 'size'>, theme: Theme): BufferGeometry {
  const c = theme.truck;
  const P = DOCK_PLATE;
  const T = DIORAMA.wallThickness;
  const { a, b } = dockSpan(truck, level);
  const d0 = a + DOCK.doorInset;
  const d1 = b - DOCK.doorInset;
  const l0 = a + TRUCK.inset + TRUCK.side + 0.005;
  const l1 = b - TRUCK.inset - TRUCK.side - 0.005;
  const local = new PartList();
  local.block(c.leveller, d0, d1, DOCK.sillTop, P.top, -T, 0);
  local.block(c.leveller, d0, d1, 0, P.lipTop, 0, P.lip / 2);
  local.block(c.leveller, d0, d1, 0, P.lipTop / 2, P.lip / 2, P.lip);
  local.block(c.leveller, l0, l1, DOCK.bedTop, P.top, -T - P.lap, -T);
  local.block(c.trim, l0 + 0.01, l1 - 0.01, P.top - 0.004, P.top + 0.002, -T - P.hinge, -T + P.hinge);
  for (let k = 1; k <= 3; k++) {
    const z = (-T * k) / 4;
    local.block(c.trim, d0 + 0.05, d1 - 0.05, P.top, P.top + P.tread, z - 0.008, z + 0.008);
  }
  return new PartList().append(local, dockPlacement(truck.wall, level)).build();
}

/**
 * Guard rails of a dock door (the DockRail list of one truck, core/docks dockRailsOf), in world space: per rail, an
 * orange post against the door frame and one at the rail's inner end, each under a cream cap, and two orange bars
 * between them (RAIL), all within the footprint the logic gives the rail (a static obstacle). Static and low; it casts
 * and takes shadows like the other props.
 */
export function buildDockRails(rails: readonly DockRail[], level: Pick<LevelData, 'size'>, theme: Theme): BufferGeometry {
  const c = theme.truck;
  const R = RAIL;
  const out = new PartList();
  for (const rail of rails) {
    // Along the wall in dock-local x (a west dock's runs the other way: local x = depth − z, see dockSpan).
    const along = (u: number) => (rail.wall === 'north' ? u : level.size.depth - u);
    const u0 = Math.min(along(rail.line), along(rail.outer));
    const u1 = Math.max(along(rail.line), along(rail.outer));
    // Into the room: from the face of the door frame (proud of the wall's inner face) to the inner end.
    const z0 = rail.from + DOOR.proud;
    const z1 = rail.to;
    const local = new PartList();
    for (const [p0, p1] of [
      [z0, z0 + R.post],
      [z1 - R.post, z1],
    ] as const) {
      local.block(c.rail, u0, u1, 0, R.top, p0, p1);
      // The cap overhangs the post, except over the frame and past the rail's inner end.
      const c0 = p0 > z0 ? p0 - R.capOver : p0;
      const c1 = p1 < z1 ? p1 + R.capOver : p1;
      local.block(c.railCap, u0 - R.capOver, u1 + R.capOver, R.top, R.top + R.cap, c0, c1);
    }
    for (const y of R.bars) local.block(c.rail, u0 + R.barInset, u1 - R.barInset, y, y + R.bar, z0 + R.post, z1 - R.post);
    out.append(local, dockPlacement(rail.wall, level));
  }
  return out.build();
}

/**
 * The truck, in world space: a low open flatbed from just off the wall's outer face outward (wooden planks level with
 * the floor, their seams, a slate rear sill, low drop sides at the run's ends with slate caps, a headboard by the cab),
 * the chassis rails, an under-run bumper and the rear wheels under it, the cab-over cab facing away (windows all round,
 * a slate stripe, grille, lamps, bumper, mirrors, front wheels), and the driveway a step down with the face of the dock
 * pit and two soft guide lines. Nothing of it stands over or between the bed columns. `index` (the truck's place in the
 * level) sets each driveway a hair lower than the one before, so two docks side by side never z-fight.
 */
export function buildTruckBody(truck: DockShape, level: Pick<LevelData, 'size'>, theme: Theme, index = 0): BufferGeometry {
  const c = theme.truck;
  const T = DIORAMA.wallThickness;
  const { a, b } = dockSpan(truck, level);
  const x0 = a + TRUCK.inset;
  const x1 = b - TRUCK.inset;
  const cx = (a + b) / 2;
  const rear = bedRear();
  const far = rear - TRUCK.bedLength;
  const H = TRUCK.headboard;
  // The planks and the drop sides run from the headboard (the bed's front end, by the cab) to the rear.
  const bedFront = far + H.postDepth;
  const top = DOCK.bedTop;
  const s0 = x0 + TRUCK.side;
  const s1 = x1 - TRUCK.side;
  const p = new PartList();

  // Bed between the drop sides: planks, their seams, the rear sill flush with them.
  p.block(c.deck, s0, s1, TRUCK.deckBottom, top, bedFront, rear - TRUCK.sill);
  p.block(c.trim, s0, s1, TRUCK.deckBottom - 0.02, top, rear - TRUCK.sill, rear);
  const n = Math.max(1, Math.round((s1 - s0) / TRUCK.plank));
  for (let k = 1; k < n; k++) {
    const x = s0 + (k * (s1 - s0)) / n;
    p.block(c.deckLine, x - 0.007, x + 0.007, top, top + 0.0015, bedFront, rear - TRUCK.sill);
  }
  // Low drop sides at both ends of the run, slate capped.
  const capY = TRUCK.sideTop - TRUCK.sideCap;
  for (const [u0, u1] of [
    [x0, s0],
    [s1, x1],
  ] as const) {
    p.block(c.board, u0, u1, TRUCK.deckBottom, capY, bedFront, rear);
    p.block(c.trim, u0, u1, capY, TRUCK.sideTop, bedFront, rear);
  }
  // Headboard across the bed's front end: slate posts and cap round a cream board (a touch recessed).
  p.block(c.board, x0 + H.post, x1 - H.post, TRUCK.deckBottom, H.top - H.cap, far + H.postDepth - H.depth, bedFront);
  p.block(c.trim, x0, x0 + H.post, TRUCK.deckBottom, H.top, far, bedFront);
  p.block(c.trim, x1 - H.post, x1, TRUCK.deckBottom, H.top, far, bedFront);
  p.block(c.trim, x0, x1, H.top - H.cap, H.top, far, bedFront);

  // Chassis rails under the bed and the cab, an under-run bumper at the rear, the rear axle and its wheels.
  const cab = cabBox(x0, x1);
  const off = Math.min(0.32, (x1 - x0) * 0.3);
  for (const s of [-1, 1]) p.block(c.trim, cx + s * off - 0.05, cx + s * off + 0.05, -0.16, TRUCK.deckBottom, cab.front + 0.15, rear - 0.03);
  const U = TRUCK.underrun;
  p.block(c.trim, x0 + 0.1, x1 - 0.1, U.y0, U.y1, rear - U.depth - 0.005, rear - 0.005);
  for (const s of [-1, 1]) p.block(c.trim, cx + s * off - 0.03, cx + s * off + 0.03, U.y1, -0.16, rear - U.depth, rear - 0.01);
  const R = TRUCK.wheelR;
  const W = TRUCK.wheelW;
  const wy = DOCK.apronTop + R;
  const rearZ = rear - TRUCK.rearAxle;
  p.block(c.trim, x0 + 0.1, x1 - 0.1, wy - 0.03, wy + 0.03, rearZ - 0.03, rearZ + 0.03);
  addWheel(p, theme, x0 + 0.02 + W / 2, wy, rearZ);
  addWheel(p, theme, x1 - 0.02 - W / 2, wy, rearZ);

  // Cab-over cab, facing away from the dock: body, cabin, roof and a slate stripe all round.
  const C = TRUCK.cab;
  const { l, r, back, front } = cab;
  p.block(c.cab, l, r, C.bottom, C.belt, front, back);
  p.block(c.cab, l + 0.02, r - 0.02, C.belt, C.top, front + 0.05, back);
  p.block(c.roof, l, r, C.top, C.top + C.roof, front + 0.03, back + 0.01);
  // A low roof pod over the windshield and the stripe all round.
  p.block(c.cabAccent, l + 0.1, r - 0.1, C.top + C.roof, C.top + C.roof + C.pod, front + 0.08, front + 0.45);
  p.block(c.cabAccent, l - 0.004, r + 0.004, 0.22, 0.29, front - 0.004, back + 0.004);
  // Windows: the rear one (seen from the warehouse through the door), the windshield, both sides.
  p.block(c.glass, l + 0.14, r - 0.14, C.belt + 0.1, C.top - 0.1, back, back + 0.008);
  p.block(c.glass, l + 0.1, r - 0.1, C.belt + 0.06, C.top - 0.07, front + 0.042, front + 0.05);
  p.block(c.glass, l + 0.012, l + 0.02, C.belt + 0.08, C.top - 0.08, front + 0.14, back - 0.16);
  p.block(c.glass, r - 0.02, r - 0.012, C.belt + 0.08, C.top - 0.08, front + 0.14, back - 0.16);
  // Grille, headlamps, bumper and two mirrors on short arms.
  const cw = r - l;
  p.block(c.trim, (l + r) / 2 - cw * 0.22, (l + r) / 2 + cw * 0.22, 0.0, 0.18, front - 0.008, front);
  p.block(c.lamp, l + 0.07, l + 0.21, 0.04, 0.13, front - 0.01, front);
  p.block(c.lamp, r - 0.21, r - 0.07, 0.04, 0.13, front - 0.01, front);
  p.block(c.trim, l - 0.01, r + 0.01, C.bottom - 0.08, C.bottom + 0.05, front - 0.05, front + 0.06);
  for (const [m0, m1, arm0, arm1] of [
    [l - 0.08, l - 0.02, l - 0.03, l + 0.02],
    [r + 0.02, r + 0.08, r - 0.02, r + 0.03],
  ] as const) {
    p.block(c.trim, m0, m1, 0.6, 0.76, front + 0.08, front + 0.12);
    p.block(c.trim, arm0, arm1, 0.665, 0.69, front + 0.09, front + 0.11);
  }
  const frontZ = front + 0.32;
  addWheel(p, theme, l + W / 2 - 0.03, wy, frontZ);
  addWheel(p, theme, r - W / 2 + 0.03, wy, frontZ);

  // Driveway a step down (the dock pit), the face of the pit up to the slab, two guide lines flanking the truck.
  const A = TRUCK.apron;
  const ax0 = a - A.margin;
  const ax1 = b + A.margin;
  const az0 = front - A.beyond;
  const shift = index * 0.002;
  const y = DOCK.apronTop - shift;
  p.block(c.apron, ax0, ax1, y - A.thickness, y, az0, -T);
  p.block(c.apronEdge, ax0, ax1, y, -DIORAMA.slabThickness, -T - 0.03 - shift, -T);
  for (const x of [a - A.lineGap - A.line, b + A.lineGap]) p.block(c.apronLine, x, x + A.line, y, y + 0.003, az0 + 0.15, -T - 0.08);
  return new PartList().append(p, dockPlacement(truck.wall, level)).build();
}

/**
 * The frame of the dock sign, in world space (a bay of its own, views/TruckView: it ghosts, its stickers never): the
 * slate border round the sign, the dividers between its cells (one column per bed column along the door run, one row
 * per level of its tallest column, bottom row = level 0), the plain cream panel of each cell a shorter column leaves
 * empty (and of a «libre» level: nothing to show), and two slate brackets holding it off the wall, hidden behind its
 * end bars from inside (and beside the stickers, never over them, from outside). A cell with a cue gets its own panel
 * (buildSignPanel).
 */
export function buildSignFrame(truck: DockShape, level: Pick<LevelData, 'size'>, theme: Theme): BufferGeometry {
  const c = theme.truck;
  const S = DOCK_SIGN;
  const { a, b } = dockSpan(truck, level);
  const rows = signRows(truck);
  const y0 = signBottom();
  const y1 = signTop(rows);
  const z0 = S.back;
  const z1 = S.back + S.depth;
  const local = new PartList();
  local.block(c.doorFrame, a, a + S.border, y0, y1, z0, z1);
  local.block(c.doorFrame, b - S.border, b, y0, y1, z0, z1);
  local.block(c.doorFrame, a + S.border, b - S.border, y0, y0 + S.border, z0, z1);
  local.block(c.doorFrame, a + S.border, b - S.border, y1 - S.border, y1, z0, z1);
  const n = truck.columns.length;
  for (let j = 1; j < n; j++) local.block(c.doorFrame, a + j - S.divider / 2, a + j + S.divider / 2, y0 + S.border, y1 - S.border, z0, z1);
  for (let k = 1; k < rows; k++) {
    const y = y0 + S.border + k * S.row;
    local.block(c.doorFrame, a + S.border, b - S.border, y - S.divider / 2, y + S.divider / 2, z0, z1);
  }
  // The cells a shorter column leaves empty, and those of its «libre» levels: plain panels, recessed like the lit ones.
  const mid = signMidZ();
  truck.columns.forEach((cues, column) => {
    const x = dockColumnX(truck, level, column);
    for (let k = 0; k < rows; k++) {
      if (k < cues.length && cues[k] !== null) continue;
      const cell = signCell(truck, column, k);
      const y = signRowY(k);
      local.block(c.board, x + cell.x0, x + cell.x1, y + cell.y0, y + cell.y1, mid - S.panel / 2, mid + S.panel / 2);
    }
  });
  // The brackets reach from the wall into the end bars, centred behind them (clear of every cell and its sticker).
  const B = S.bracket;
  for (const u of [a + (S.border - B.w) / 2, b - (S.border + B.w) / 2]) local.block(c.doorFrame, u, u + B.w, y0 + B.y0, y0 + B.y1, 0, z0 + B.grip);
  return new PartList().append(local, dockPlacement(truck.wall, level)).build();
}

/**
 * The lit panel of a sign cell (its opening `cell`, see signCell), in cell-local space: origin at the cell's centre on
 * the sign's mid-plane, +z toward the warehouse, x along the wall. Its own mesh so it can glow (and ghost with the
 * sign frame); one geometry per opening, shared by the cells that have it.
 */
export function buildSignPanel(theme: Theme, cell: SignCell): BufferGeometry {
  const half = DOCK_SIGN.panel / 2;
  return new PartList().block(theme.truck.board, cell.x0, cell.x1, cell.y0, cell.y1, -half, half).build();
}

/**
 * The cue of a truck level on its sign cell, in the space of buildSignPanel, for an unlit material (never shaded,
 * never faded): the rack sticker (builders/rack buildCueFace, SIGN_CUE) on both faces of its panel, each upright and
 * unmirrored for whoever looks at that face (a pure yaw), so the sign reads from inside the warehouse and, with the
 * wall sunk, from outside.
 */
export function buildSignCue(look: Pick<CueLook, 'fill' | 'rim' | 'ink' | 'glyph'>): BufferGeometry {
  const parts = new PartList();
  const half = DOCK_SIGN.panel / 2;
  parts.add(buildCueFace(look, SIGN_CUE), null, { z: half + SIGN_CUE.lift });
  parts.add(buildCueFace(look, SIGN_CUE), null, { z: -half - SIGN_CUE.lift, ry: Math.PI });
  return parts.build();
}

/**
 * Glow band of a sign cell (SIGN_GLOW), in the space of buildSignPanel: a feathered frame of light round its sticker on
 * both faces of the panel. One geometry, shared by every cell.
 */
export function buildSignGlowGeometry(): BufferGeometry {
  const G = SIGN_GLOW;
  const half = DOCK_SIGN.panel / 2;
  const geo = buildGlowFrameGeometry(G, G.halfH, [half + G.gap, -half - G.gap]);
  geo.translate(0, -G.halfH, 0);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Marker of the chosen truck level (views/SlotMarker, SIGN_MARKER), in the space of buildSignPanel (origin at the cell's
 * centre on the sign's mid-plane, +z toward the warehouse, x along the wall): on each face of the sign, facing out, a
 * thin rounded frame over the bars around the cell (so it reads from inside the warehouse and, with the wall sunk,
 * from outside). One geometry for every cell. Unlit white: the marker's material gives it its tone.
 */
export function buildSignMarkerGeometry(): BufferGeometry {
  const M = SIGN_MARKER;
  const parts = new PartList();
  const z = DOCK_SIGN.depth / 2 + M.gap;
  const ring = () => new ShapeGeometry(rectRingShape(M.halfW, M.halfH, M.width, M.radius), 4);
  parts.add(ring(), '#ffffff', { z });
  parts.add(ring(), '#ffffff', { z: -z, ry: Math.PI });
  return parts.build();
}
