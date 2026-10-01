import { CylinderGeometry, type BufferGeometry } from 'three';
import { clamp } from '../../core/math';
import type { LevelData, LevelTruck, WallSide } from '../../core/types';
import type { Theme } from '../../themes/types';
import { DIORAMA, DOCK } from '../dims';
import { PartList, type Placement } from '../paint';
import { buildCueFace, buildGlowFrameGeometry, type CueDims, type CueLook, type GlowFrameDims } from './rack';
import { dockSpan } from './walls';

/*
 * Loading dock truck (docs/DOCKS.md): a small, friendly low-poly rigid truck backed into its dock door, as plain as the
 * storage racks (square blocks, no clutter, pastel and slate). Built in "dock-local" space = the local frame of its
 * wall (builders/walls): x along the wall, y up, z inward (the wall's inner face is z = 0; the wall and everything
 * outside it at z < 0). A pure yaw + translation from world (dockPlacement), never a mirror.
 *
 * Inside, on its bed cells (z 0‥1): the rear of its wooden bed, level with the warehouse floor (DOCK.bedTop), low rub
 * rails, the rear sill and the dock leveller plate at the loading edge (buildTruckBed); and the cue board, one per bed
 * column at the back of its cell, over the column's full stack, with a sticker per level, bottom at the bottom
 * (buildTruckBoardBays + buildTruckCuePanel + buildTruckCue). A loaded box never hides a sticker: every camera looks
 * down, and the board stands behind the stack and above it.
 * Outside (buildTruckOutside, sinks with its wall): the rest of the bed through the door, its headboard, chassis and
 * rear wheels, the cab-over cab facing away, and the driveway a step down (the dock pit) with two guide lines.
 */

export const TRUCK = {
  /** Deck, rails and cue board stay this far inside the run's ends (a box spans ±0.39 around its column's centre). */
  inset: 0.06,
  deckBottom: -0.05,
  /** The bed reaches this far out past the wall's outer face. */
  bedOut: 1.25,
  /** Rub rails along both sides of the bed: width and top (low: they never hide a box). */
  rail: 0.04,
  railTop: 0.07,
  /** Plank seams across the bed, about this far apart. */
  plank: 0.24,
  /** Rear sill of the bed, at the loading edge (dock-local z). */
  sill: [0.965, 1.0],
  /** Dock leveller: a slate plate over the sill that laps onto the floor in front (z), its bevelled lip and top. */
  leveller: { z0: 0.94, z1: 1.1, lip: 1.15, top: 0.03, lipTop: 0.016 },
  /** Headboard at the far end of the bed (by the cab). */
  headboard: 0.4,
  wheelR: 0.19,
  wheelW: 0.14,
  /** Rear axle, this far out past the wall's outer face (the rigid truck's own rear axle). */
  rearAxle: 0.42,
  /**
   * Cab-over cab past the bed's far end (`gap`): its length, its width (`share` of the bed, within minW‥maxW), the
   * bottom of its body, the belt line (windows above it), the top of the cabin under a thin roof and its roof pod.
   */
  cab: { gap: 0.1, length: 0.95, share: 0.82, minW: 0.86, maxW: 1.7, bottom: -0.1, belt: 0.42, top: 0.98, roof: 0.06, pod: 0.11 },
  /** Driveway: its margin past the run's ends, how far it goes past the cab, its thickness and the guide lines. */
  apron: { margin: 0.4, beyond: 0.35, thickness: 0.12, line: 0.05, lineGap: 0.2 },
} as const;

/** A truck level's cue sticker: the rack sticker (builders/rack CUE) a little smaller, so three fit on one board. */
export const TRUCK_CUE: CueDims = { halfW: 0.3, halfH: 0.18, radius: 0.06, rim: 0.025, glyph: 0.27, lift: 0.003 };

/**
 * Cue board of a bed column (dock-local z from the wall's inner face): slate posts behind (z `post`), a cream panel per
 * level (`panel`, its own mesh so it can glow) in slate bars (`bars`: bottom, top and a thin separator between levels).
 * It starts `clear` over the column's full stack and gives each level `pitch` of height.
 */
export const CUE_BOARD = {
  clear: 0.06,
  pitch: 0.42,
  bar: 0.03,
  sep: 0.015,
  postW: 0.05,
  panelHalfW: 0.44,
  post: [0.01, 0.04],
  panel: [0.04, 0.065],
  bars: [0.035, 0.07],
} as const;

/**
 * Glow band of a truck level (views/TruckView), around the volume its box takes (from the level's floor up one box
 * height): on the loading face and, from behind, between the stack and the board (`back`, dock-local z).
 */
export const TRUCK_GLOW: GlowFrameDims & { gap: number; back: number } = {
  halfW: 0.42,
  solidX: 0.035,
  solidY: 0.035,
  featherX: 0.045,
  featherY: 0.02,
  radius: 0.05,
  gap: 0.006,
  back: 0.085,
};

/** Dock-local → world: its wall's own transform (builders/walls wallLayouts). */
export function dockPlacement(wall: WallSide, level: Pick<LevelData, 'size'>): Placement {
  const { width: w, depth: d } = level.size;
  return wall === 'north' ? { x: -w / 2, z: -d / 2 } : { x: -w / 2, z: d / 2, ry: Math.PI / 2 };
}

/** Dock-local x of the centre of bed column `column` (a west dock's columns run toward −x: see dockSpan). */
export function dockColumnX(truck: Pick<LevelTruck, 'wall' | 'x' | 'z'>, level: Pick<LevelData, 'size'>, column: number): number {
  return truck.wall === 'north' ? truck.x + column + 0.5 : level.size.depth - truck.z - column - 0.5;
}

/** Bottom of the cue board of a column of `levels` (over its full stack; `stackStep` = one box height). */
export function truckBoardBottom(levels: number, stackStep: number): number {
  return levels * stackStep + CUE_BOARD.clear;
}

/** Top of the cue board of a column of `levels`. */
export function truckBoardTop(levels: number, stackStep: number): number {
  return truckBoardBottom(levels, stackStep) + 2 * CUE_BOARD.bar + levels * CUE_BOARD.pitch;
}

/** Height of the centre of the sticker of `level` on the board of a column of `levels` (bottom level lowest). */
export function truckCueY(levels: number, level: number, stackStep: number): number {
  return truckBoardBottom(levels, stackStep) + CUE_BOARD.bar + (level + 0.5) * CUE_BOARD.pitch;
}

/** The truck's cab, in dock-local space: its x range and its back (toward the bed) and front faces. */
function cabBox(x0: number, x1: number): { l: number; r: number; back: number; front: number } {
  const C = TRUCK.cab;
  const cx = (x0 + x1) / 2;
  const w = Math.min(x1 - x0 + 0.04, clamp((x1 - x0) * C.share, C.minW, C.maxW));
  const back = -DIORAMA.wallThickness - TRUCK.bedOut - C.gap;
  return { l: cx - w / 2, r: cx + w / 2, back, front: back - C.length };
}

/** Wooden bed planks from z0 to z1 (dock-local), their seams and the two rub rails. */
function addDeck(parts: PartList, theme: Theme, x0: number, x1: number, z0: number, z1: number): void {
  const c = theme.truck;
  const top = DOCK.bedTop;
  parts.block(c.deck, x0, x1, TRUCK.deckBottom, top, z0, z1);
  const s0 = x0 + TRUCK.rail;
  const s1 = x1 - TRUCK.rail;
  const n = Math.max(1, Math.round((s1 - s0) / TRUCK.plank));
  for (let k = 1; k < n; k++) {
    const x = s0 + (k * (s1 - s0)) / n;
    parts.block(c.deckLine, x - 0.007, x + 0.007, top, top + 0.0015, z0, z1);
  }
  parts.block(c.trim, x0, s0, TRUCK.deckBottom, TRUCK.railTop, z0, z1);
  parts.block(c.trim, s1, x1, TRUCK.deckBottom, TRUCK.railTop, z0, z1);
}

/** A wheel (tyre + hub) with its axis along x, centred at (x, y, z). */
function addWheel(parts: PartList, theme: Theme, x: number, y: number, z: number): void {
  const R = TRUCK.wheelR;
  const W = TRUCK.wheelW;
  parts.add(new CylinderGeometry(R, R, W, 12), theme.truck.wheel, { x, y, z, rz: Math.PI / 2 });
  parts.add(new CylinderGeometry(R * 0.45, R * 0.45, W + 0.02, 10), theme.truck.hub, { x, y, z, rz: Math.PI / 2 });
}

/**
 * The part of the truck inside the warehouse, in world space (flat, it never hides anything): the rear of the bed on
 * the bed cells (planks level with the floor, seams, rub rails), its rear sill and the dock leveller plate lapping onto
 * the floor in front, where the forklift loads.
 */
export function buildTruckBed(truck: LevelTruck, level: Pick<LevelData, 'size'>, theme: Theme): BufferGeometry {
  const c = theme.truck;
  const { a, b } = dockSpan(truck, level);
  const x0 = a + TRUCK.inset;
  const x1 = b - TRUCK.inset;
  const local = new PartList();
  const [s0, s1] = TRUCK.sill;
  addDeck(local, theme, x0, x1, 0, s0);
  local.block(c.trim, x0, x1, TRUCK.deckBottom, DOCK.bedTop + 0.004, s0, s1);
  const L = TRUCK.leveller;
  local.block(c.leveller, x0, x1, 0, L.top, L.z0, L.z1);
  local.block(c.leveller, x0, x1, 0, L.lipTop, L.z1, L.lip);
  // Its hinge at the back and three low treads across the plate.
  local.block(c.trim, x0, x1, L.top - 0.006, L.top + 0.006, L.z0, L.z0 + 0.016);
  for (let k = 1; k <= 3; k++) {
    const z = L.z0 + ((L.z1 - L.z0) * k) / 4;
    local.block(c.leveller, x0 + 0.05, x1 - 0.05, L.top, L.top + 0.005, z - 0.008, z + 0.008);
  }
  return new PartList().append(local, dockPlacement(truck.wall, level)).build();
}

/**
 * The part of the truck outside its wall, in dock-local space (views/TruckView puts it in a group with its wall's
 * transform, so it sinks with the wall): the bed through the door and on out, its headboard, the chassis and the rear
 * wheels under it, the cab-over cab facing away (windows all round, a slate stripe, grille, lamps, bumper, mirrors,
 * front wheels), and the driveway a step down with the face of the dock pit and two soft guide lines. `index` (the
 * truck's place in the level) sets each driveway a hair lower than the one before, so two docks side by side never
 * z-fight where their driveways meet.
 */
export function buildTruckOutside(truck: LevelTruck, level: Pick<LevelData, 'size'>, theme: Theme, index = 0): BufferGeometry {
  const c = theme.truck;
  const T = DIORAMA.wallThickness;
  const { a, b } = dockSpan(truck, level);
  const x0 = a + TRUCK.inset;
  const x1 = b - TRUCK.inset;
  const cx = (a + b) / 2;
  const far = -T - TRUCK.bedOut;
  const p = new PartList();

  // Bed on out through the door, and its headboard (slate posts and cap around a cream board).
  addDeck(p, theme, x0, x1, far, 0);
  const H = TRUCK.headboard;
  p.block(c.board, x0 + 0.05, x1 - 0.05, DOCK.bedTop, H - 0.04, far + 0.01, far + 0.045);
  p.block(c.trim, x0, x0 + 0.05, DOCK.bedTop, H, far, far + 0.055);
  p.block(c.trim, x1 - 0.05, x1, DOCK.bedTop, H, far, far + 0.055);
  p.block(c.trim, x0, x1, H - 0.04, H, far, far + 0.055);

  // Chassis rails under the bed and the cab; the rear axle just outside the wall.
  const cab = cabBox(x0, x1);
  const off = Math.min(0.32, (x1 - x0) * 0.3);
  for (const s of [-1, 1]) p.block(c.trim, cx + s * off - 0.05, cx + s * off + 0.05, -0.16, TRUCK.deckBottom, cab.front + 0.15, -T);
  const R = TRUCK.wheelR;
  const W = TRUCK.wheelW;
  const wy = DOCK.apronTop + R;
  const rearZ = -T - TRUCK.rearAxle;
  p.block(c.trim, x0 + 0.1, x1 - 0.1, wy - 0.03, wy + 0.03, rearZ - 0.03, rearZ + 0.03);
  addWheel(p, theme, x0 + 0.02 + W / 2, wy, rearZ);
  addWheel(p, theme, x1 - 0.02 - W / 2, wy, rearZ);

  // Cab-over cab, facing away from the dock: body, cabin, roof and a slate stripe all round.
  const C = TRUCK.cab;
  const { l, r, back, front } = cab;
  p.block(c.cab, l, r, C.bottom, C.belt, front, back);
  p.block(c.cab, l + 0.02, r - 0.02, C.belt, C.top, front + 0.05, back);
  p.block(c.roof, l, r, C.top, C.top + C.roof, front + 0.03, back + 0.01);
  // A low roof pod over the windshield (the silhouette of a truck from above, over the wall) and the stripe all round.
  p.block(c.cabAccent, l + 0.1, r - 0.1, C.top + C.roof, C.top + C.roof + C.pod, front + 0.08, front + 0.45);
  p.block(c.cabAccent, l - 0.004, r + 0.004, 0.22, 0.29, front - 0.004, back + 0.004);
  // Windows: the rear one (seen from the warehouse through the door and over the wall), the windshield, both sides.
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
  return p.build();
}

/**
 * The frame of the cue board of each bed column, in world space, one geometry per column in column order (a bay, so
 * each fades on its own, views/TruckView): slate posts at the column edges from the bed up to the board's top (an
 * inner post belongs to the column before it in dock-local x and is as tall as the taller board beside it), and the
 * bars of its board: bottom, top and a thin separator between levels. The panels and stickers are per level.
 */
export function buildTruckBoardBays(truck: LevelTruck, level: Pick<LevelData, 'size'>, theme: Theme, stackStep: number): BufferGeometry[] {
  const c = theme.truck;
  const B = CUE_BOARD;
  const { a, b } = dockSpan(truck, level);
  const n = truck.columns.length;
  const bays = truck.columns.map(() => new PartList());
  // Slot j along dock-local x (from a) holds truck column colAt(j).
  const colAt = (j: number) => (truck.wall === 'north' ? j : n - 1 - j);
  const tops: number[] = [];
  for (let j = 0; j < n; j++) tops.push(truckBoardTop(truck.columns[colAt(j)].length, stackStep));
  for (let i = 0; i <= n; i++) {
    const top = Math.max(i > 0 ? tops[i - 1] : 0, i < n ? tops[i] : 0);
    const u0 = i === 0 ? a + TRUCK.inset : i === n ? b - TRUCK.inset - B.postW : a + i - B.postW / 2;
    bays[colAt(Math.max(0, Math.min(n - 1, i - 1)))].block(c.trim, u0, u0 + B.postW, DOCK.bedTop, top, B.post[0], B.post[1]);
  }
  for (let j = 0; j < n; j++) {
    const col = colAt(j);
    const levels = truck.columns[col].length;
    const u0 = j === 0 ? a + TRUCK.inset + B.postW : a + j + B.postW / 2;
    const u1 = j === n - 1 ? b - TRUCK.inset - B.postW : a + j + 1 - B.postW / 2;
    const bottom = truckBoardBottom(levels, stackStep);
    const top = truckBoardTop(levels, stackStep);
    const bar = (y0: number, y1: number) => bays[col].block(c.trim, u0, u1, y0, y1, B.bars[0], B.bars[1]);
    bar(bottom, bottom + B.bar);
    bar(top - B.bar, top);
    for (let k = 1; k < levels; k++) {
      const y = bottom + B.bar + k * B.pitch;
      bar(y - B.sep / 2, y + B.sep / 2);
    }
  }
  const placement = dockPlacement(truck.wall, level);
  return bays.map((local) => new PartList().append(local, placement).build());
}

/**
 * The plain panel behind a level's sticker on its board, in the level's cue-local space: origin at the sticker's
 * centre, on the column's centre line; +z toward the loading side (builders/rack outwardYaw of TRUCK_FACING), x along
 * the wall. Its own mesh so it can glow (and fade with its board); one geometry shared by every level.
 */
export function buildTruckCuePanel(theme: Theme): BufferGeometry {
  const parts = new PartList();
  const B = CUE_BOARD;
  parts.block(theme.truck.board, -B.panelHalfW, B.panelHalfW, -B.pitch / 2, B.pitch / 2, B.panel[0] - 0.5, B.panel[1] - 0.5);
  return parts.build();
}

/**
 * The cue of a truck level, in the space of buildTruckCuePanel, for an unlit material (never shaded, never faded): the
 * rack sticker (builders/rack buildCueFace, TRUCK_CUE) on both faces of its panel, each upright and unmirrored for
 * whoever looks at that face (a pure yaw), so the board reads from inside the warehouse and from behind its wall.
 */
export function buildTruckCue(look: Pick<CueLook, 'fill' | 'rim' | 'ink' | 'glyph'>): BufferGeometry {
  const parts = new PartList();
  const B = CUE_BOARD;
  parts.add(buildCueFace(look, TRUCK_CUE), null, { z: B.panel[1] - 0.5 + TRUCK_CUE.lift });
  parts.add(buildCueFace(look, TRUCK_CUE), null, { z: B.panel[0] - 0.5 - TRUCK_CUE.lift, ry: Math.PI });
  return parts.build();
}

/**
 * Glow band of a truck level (TRUCK_GLOW), in its level-local space: origin at the bed cell's centre at the level's
 * floor (level · stackStep), +z toward the loading side: a feathered frame around the volume its box takes, on the
 * loading face and on the back (between the stack and the board).
 */
export function buildTruckGlowGeometry(stackStep: number): BufferGeometry {
  const G = TRUCK_GLOW;
  return buildGlowFrameGeometry(G, stackStep / 2, [0.5 + G.gap, G.back - 0.5]);
}
