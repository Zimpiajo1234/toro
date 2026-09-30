import { BufferAttribute, BufferGeometry, Color, CylinderGeometry, PlaneGeometry, Vector3 } from 'three';
import { storageOf } from '../../core/storage';
import type { LevelData, LevelTruck, WallSide } from '../../core/types';
import type { Theme } from '../../themes/types';
import { DIORAMA, DOCK } from '../dims';
import { PartList } from '../paint';

/**
 * The two low back walls (north, west) with baseboard, top cap, windows (light-wood frames,
 * warm glass, faint additive light shafts) and the door of each loading dock (docs/DOCKS.md: an opening
 * from the floor with a slate frame, the rolled-up door over it outside and rubber seals around it outside).
 * Each wall is built in a local frame: it runs along +x, its inner face is the plane z = 0 facing +z,
 * thickness goes toward -z. Trucks are built in this same frame (builders/truck: "dock-local").
 */

export interface WallOpening {
  a: number;
  b: number;
  cells: number;
}

/** A dock door: its opening along the wall (local x), from the floor up to DOCK.doorTop. */
export interface WallDoor {
  a: number;
  b: number;
}

export interface WallLayout {
  side: WallSide;
  /** Local extent of the wall body and of its cap. */
  start: number;
  end: number;
  capFrom: number;
  capTo: number;
  /** Inner face length (baseboard). */
  innerLength: number;
  openings: WallOpening[];
  /** Dock doors (loading docks in this wall), sorted along the wall. Never overlap a window (validateLevel). */
  doors: WallDoor[];
  /** Group transform placing the local frame in the world. */
  position: Vector3;
  rotationY: number;
  /** World-space inward normal (toward the room). */
  inward: Vector3;
}

export interface WallGeometry {
  body: BufferGeometry;
  glass: BufferGeometry | null;
  shafts: BufferGeometry | null;
}

const FRAME = 0.06;
const MULLION = 0.04;
const SHAFT_ALPHA = 0.065;
const PATCH_ALPHA = 0.055;
const FEATHER = 0.22;
/**
 * Dock door (docs/DOCKS.md): its slate frame just outside the opening, the rolled-up door on the outer face over the
 * opening (a soft cream roll on two slate brackets, above the head seal; the inner face over the door carries the
 * dock sign, builders/truck), the bottom rail of the shutter at the head of the opening, and the rubber dock seals on
 * the outer face, down its sides and across its head, with two bumpers at the foot of the jambs.
 */
export const DOOR = {
  frame: 0.07,
  /** How far the frame stands proud of the wall's inner face (a door's guard rails start there, builders/truck). */
  proud: 0.025,
  roll: 0.075,
  /** Brackets holding the roll at its ends (along the wall). */
  bracket: 0.03,
  rail: 0.035,
  seal: 0.08,
  sealOut: 0.07,
  bumperW: 0.12,
  bumperOut: 0.09,
  bumperY: [-0.24, -0.09],
} as const;

export function wallLayouts(level: LevelData): WallLayout[] {
  const { width: w, depth: d } = level.size;
  const t = DIORAMA.wallThickness;
  const ov = DIORAMA.capOverhang;
  const inset = DIORAMA.windowInset;
  const north: WallLayout = {
    side: 'north',
    start: -t,
    end: w,
    capFrom: -t - ov,
    capTo: w + ov,
    innerLength: w,
    openings: [],
    doors: [],
    position: new Vector3(-w / 2, 0, -d / 2),
    rotationY: 0,
    inward: new Vector3(0, 0, 1),
  };
  // West: local +x runs toward world -z, so cell index z maps to local x = depth - z.
  const west: WallLayout = {
    side: 'west',
    start: 0,
    end: d,
    capFrom: -ov,
    capTo: d - ov,
    innerLength: d,
    openings: [],
    doors: [],
    position: new Vector3(-w / 2, 0, d / 2),
    rotationY: Math.PI / 2,
    inward: new Vector3(1, 0, 0),
  };
  for (const win of level.decor.windows) {
    if (win.wall === 'north') {
      north.openings.push({ a: win.at + inset, b: win.at + win.width - inset, cells: win.width });
    } else {
      west.openings.push({ a: d - win.at - win.width + inset, b: d - win.at - inset, cells: win.width });
    }
  }
  // Every storage unit loaded through a door (docs/STORAGE.md access `door`: a truck) opens its dock door in its wall.
  for (const unit of storageOf(level)) {
    if (unit.access.kind !== 'door') continue;
    const { wall } = unit.access;
    const span = dockSpan({ wall, x: unit.x, z: unit.z, columns: unit.columns }, level);
    const door = { a: span.a + DOCK.doorInset, b: span.b - DOCK.doorInset };
    (wall === 'north' ? north : west).doors.push(door);
  }
  for (const layout of [north, west]) {
    layout.openings.sort((p, q) => p.a - q.a);
    layout.doors.sort((p, q) => p.a - q.a);
  }
  return [north, west];
}

/** What a dock door's run reads of its unit: its wall, its first door cell and its columns (one per door cell). */
export type DockRun = Pick<LevelTruck, 'wall' | 'x' | 'z'> & { readonly columns: { readonly length: number } };

/**
 * The run of a truck's bed cells along its wall, in the wall's local x (see wallLayouts): a north dock's column c
 * spans x + c‥x + c + 1; a west dock's runs the other way (local x = depth − z), so its first column is the last span.
 */
export function dockSpan(truck: DockRun, level: Pick<LevelData, 'size'>): { a: number; b: number } {
  const n = truck.columns.length;
  if (truck.wall === 'north') return { a: truck.x, b: truck.x + n };
  const d = level.size.depth;
  return { a: d - truck.z - n, b: d - truck.z };
}

/** World direction toward the sun expressed in a wall's local frame (inverse of its Y rotation). */
export function toWallLocal(layout: WallLayout, world: Vector3, target: Vector3): Vector3 {
  const c = Math.cos(-layout.rotationY);
  const s = Math.sin(-layout.rotationY);
  return target.set(world.x * c + world.z * s, world.y, -world.x * s + world.z * c);
}

export function buildWallGeometry(layout: WallLayout, theme: Theme, toSunLocal: Vector3): WallGeometry {
  const H = DIORAMA.wallHeight;
  const T = DIORAMA.wallThickness;
  const S = DIORAMA.slabThickness;
  const y0 = DIORAMA.windowBottom;
  const y1 = DIORAMA.windowTop;
  const body = new PartList();

  // Wall body around the openings: under and over a window, only under (the sill) and over (the lintel) a door and its
  // frame (addDoor: the jambs and the head fill the wall's thickness there, so no face of theirs lies on a wall face).
  const gaps = [
    ...layout.openings.map((o) => ({ a: o.a, b: o.b, below: y0, above: y1 })),
    ...layout.doors.map((o) => ({ a: o.a - DOOR.frame, b: o.b + DOOR.frame, below: DOCK.sillTop, above: DOCK.doorTop + DOOR.frame })),
  ].sort((p, q) => p.a - q.a);
  let cursor = layout.start;
  for (const o of gaps) {
    if (o.a > cursor + 1e-3) body.block(theme.wall.base, cursor, o.a, -S, H, -T, 0);
    body.block(theme.wall.base, o.a, o.b, -S, o.below, -T, 0);
    body.block(theme.wall.base, o.a, o.b, o.above, H, -T, 0);
    cursor = o.b;
  }
  if (layout.end > cursor + 1e-3) body.block(theme.wall.base, cursor, layout.end, -S, H, -T, 0);

  // Baseboard (broken by each door and its frame) and top cap.
  const B = DIORAMA.baseboardHeight;
  let from = 0;
  for (const door of layout.doors) {
    const to = door.a - DOOR.frame;
    if (to > from + 1e-3) body.block(theme.wall.trim, from, to, 0, B, 0, DIORAMA.baseboardDepth);
    from = door.b + DOOR.frame;
  }
  if (layout.innerLength > from + 1e-3) body.block(theme.wall.trim, from, layout.innerLength, 0, B, 0, DIORAMA.baseboardDepth);
  const ov = DIORAMA.capOverhang;
  body.block(theme.wall.top, layout.capFrom, layout.capTo, H, H + DIORAMA.capHeight, -T - ov, ov);
  for (const door of layout.doors) addDoor(body, theme, door);

  if (layout.openings.length === 0) return { body: body.build(), glass: null, shafts: null };

  const glass = new PartList();
  const shafts = new PartList(true);
  for (const o of layout.openings) {
    addWindowFrame(body, theme, o);
    glass.add(glassPane(theme, o), null);
    addLightShaft(shafts, theme, o, toSunLocal);
  }
  return { body: body.build(), glass: glass.build(), shafts: shafts.build() };
}

/**
 * A dock door (DOOR): the slate frame around the opening (jambs from the sill, a head under the lintel), through the
 * wall's thickness and a touch proud of both faces; the bottom rail of the rolled-up shutter at the head of the
 * opening; outside, the rubber seals down both sides and across the head, the roll over the head seal on two brackets,
 * and a bumper at the foot of each jamb. The opening itself stays clear from the sill to the rail for the load going
 * through it (builders/truck: the dock plate fills its floor, the truck waits outside).
 */
function addDoor(parts: PartList, theme: Theme, door: WallDoor): void {
  const T = DIORAMA.wallThickness;
  const D = DOOR;
  const top = DOCK.doorTop;
  const c = theme.truck;
  const z0 = -T - 0.012;
  const z1 = D.proud;
  parts.block(c.doorFrame, door.a - D.frame, door.a, DOCK.sillTop, top, z0, z1);
  parts.block(c.doorFrame, door.b, door.b + D.frame, DOCK.sillTop, top, z0, z1);
  parts.block(c.doorFrame, door.a - D.frame, door.b + D.frame, top, top + D.frame, z0, z1);
  // The shutter is rolled up: its bottom rail waits at the head of the opening, inside the wall.
  parts.block(c.doorFrame, door.a, door.b, top - D.rail, top, -T / 2 - 0.02, -T / 2 + 0.02);
  // Dock seals and bumpers on the outer face.
  const s0 = -T - D.sealOut;
  const sealTop = top + D.seal - 0.02;
  parts.block(c.rubber, door.a - D.seal, door.a + 0.01, DOCK.sillTop, top - 0.02, s0, -T);
  parts.block(c.rubber, door.b - 0.01, door.b + D.seal, DOCK.sillTop, top - 0.02, s0, -T);
  parts.block(c.rubber, door.a - D.seal, door.b + D.seal, top - 0.02, sealTop, s0, -T);
  // The roll, outside over the head seal, on a slate bracket at each end.
  const rollY = sealTop + D.roll + 0.01;
  const rollZ = z0 - D.roll;
  const roll = new CylinderGeometry(D.roll, D.roll, door.b - door.a, 10);
  parts.add(roll, c.shutter, { x: (door.a + door.b) / 2, y: rollY, z: rollZ, rz: Math.PI / 2 });
  for (const x of [door.a - D.bracket, door.b]) {
    parts.block(c.doorFrame, x, x + D.bracket, rollY - D.roll - 0.01, rollY + D.roll + 0.01, rollZ - D.roll - 0.01, -T);
  }
  const [by0, by1] = D.bumperY;
  parts.block(c.rubber, door.a - D.seal - D.bumperW, door.a - D.seal, by0, by1, -T - D.bumperOut, -T);
  parts.block(c.rubber, door.b + D.seal, door.b + D.seal + D.bumperW, by0, by1, -T - D.bumperOut, -T);
}

function addWindowFrame(parts: PartList, theme: Theme, o: WallOpening): void {
  const T = DIORAMA.wallThickness;
  const y0 = DIORAMA.windowBottom;
  const y1 = DIORAMA.windowTop;
  const color = theme.window.frame;
  const z0 = -T - 0.012;
  const z1 = 0.022;
  parts.block(color, o.a, o.a + FRAME, y0, y1, z0, z1);
  parts.block(color, o.b - FRAME, o.b, y0, y1, z0, z1);
  parts.block(color, o.a, o.b, y1 - FRAME, y1, z0, z1);
  parts.block(color, o.a, o.b, y0, y0 + FRAME, z0, z1);
  // Mullions (one per cell boundary) and a transom, at the glass plane.
  const gz0 = -T / 2 - 0.022;
  const gz1 = -T / 2 + 0.022;
  for (let k = 1; k < o.cells; k++) {
    const x = o.a + (k * (o.b - o.a)) / o.cells;
    parts.block(color, x - MULLION / 2, x + MULLION / 2, y0 + FRAME, y1 - FRAME, gz0, gz1);
  }
  const ty = y0 + (y1 - y0) * 0.64;
  parts.block(color, o.a + FRAME, o.b - FRAME, ty - MULLION / 2, ty + MULLION / 2, gz0, gz1);
  // Inner sill ledge.
  parts.block(color, o.a - 0.05, o.b + 0.05, y0 - 0.045, y0, -0.01, 0.09);
}

/** Glass plane with a soft vertical gradient (brighter at the top). */
function glassPane(theme: Theme, o: WallOpening): BufferGeometry {
  const T = DIORAMA.wallThickness;
  const w = o.b - o.a - FRAME * 2;
  const h = DIORAMA.windowTop - DIORAMA.windowBottom - FRAME * 2;
  const geo = new PlaneGeometry(w, h);
  geo.translate((o.a + o.b) / 2, (DIORAMA.windowTop + DIORAMA.windowBottom) / 2, -T / 2);
  const top = new Color(theme.window.glass);
  const bottom = new Color(theme.window.light);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const mid = (DIORAMA.windowTop + DIORAMA.windowBottom) / 2;
  for (let i = 0; i < pos.count; i++) {
    const c = pos.getY(i) > mid ? top : bottom;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

/** A faint sheet from the window head down to the floor, plus a feathered light patch on the floor. */
function addLightShaft(parts: PartList, theme: Theme, o: WallOpening, toSun: Vector3): void {
  if (toSun.y <= 0.05 || toSun.z >= -0.05) return; // sun not shining through this wall
  const top = DIORAMA.windowTop - FRAME;
  const bottom = DIORAMA.windowBottom + FRAME;
  const a = o.a + FRAME;
  const b = o.b - FRAME;
  const hit = (x: number, y: number, lift: number) => {
    const t = y / toSun.y;
    return new Vector3(x - toSun.x * t, lift, -toSun.z * t);
  };
  const color = new Color(theme.window.light);
  const pA0 = new Vector3(a, top, 0);
  const pA1 = new Vector3(b, top, 0);
  const fA0 = hit(a, top, 0.004);
  const fA1 = hit(b, top, 0.004);
  const fB0 = hit(a, bottom, 0.004);
  const fB1 = hit(b, bottom, 0.004);
  // Sheet: alpha fades from the window toward the floor and at both sides.
  parts.add(gridPatch(pA0, pA1, fA0, fA1, [0, FEATHER, 1 - FEATHER, 1], [0, 1], color, (u, v) => edge(u) * (1 - v) * SHAFT_ALPHA), null);
  // Floor patch between the projections of the window's bottom and top edges.
  const stops = [0, FEATHER, 1 - FEATHER, 1];
  parts.add(gridPatch(fB0, fB1, fA0, fA1, stops, stops, color, (u, v) => edge(u) * edge(v) * PATCH_ALPHA), null);
}

function edge(t: number): number {
  return t <= 0 || t >= 1 ? 0 : 1;
}

/**
 * Bilinear patch between four corners (p00 → p10 along u, p00 → p01 along v) sampled at the given
 * parametric stops, with RGBA vertex colors (alpha from `alphaAt`).
 */
function gridPatch(
  p00: Vector3,
  p10: Vector3,
  p01: Vector3,
  p11: Vector3,
  uStops: readonly number[],
  vStops: readonly number[],
  color: Color,
  alphaAt: (u: number, v: number) => number,
): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const point = (u: number, v: number) => {
    const a = p00.clone().lerp(p10, u);
    const b = p01.clone().lerp(p11, u);
    return a.lerp(b, v);
  };
  const push = (u: number, v: number) => {
    const p = point(u, v);
    positions.push(p.x, p.y, p.z);
    colors.push(color.r, color.g, color.b, alphaAt(u, v));
  };
  for (let i = 0; i < uStops.length - 1; i++) {
    for (let j = 0; j < vStops.length - 1; j++) {
      const u0 = uStops[i], u1 = uStops[i + 1], v0 = vStops[j], v1 = vStops[j + 1];
      push(u0, v0); push(u1, v0); push(u1, v1);
      push(u0, v0); push(u1, v1); push(u0, v1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 4));
  geo.computeVertexNormals();
  return geo;
}
