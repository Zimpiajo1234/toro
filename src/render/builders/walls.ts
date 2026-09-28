import { BufferAttribute, BufferGeometry, Color, PlaneGeometry, Vector3 } from 'three';
import type { LevelData, WallSide } from '../../core/types';
import type { Theme } from '../../themes/types';
import { DIORAMA } from '../dims';
import { PartList } from '../paint';

/**
 * The two low back walls (north, west) with baseboard, top cap and windows (light-wood frames,
 * warm glass, faint additive light shafts). Each wall is built in a local frame:
 * it runs along +x, its inner face is the plane z = 0 facing +z, thickness goes toward -z.
 */

export interface WallOpening {
  a: number;
  b: number;
  cells: number;
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
  north.openings.sort((p, q) => p.a - q.a);
  west.openings.sort((p, q) => p.a - q.a);
  return [north, west];
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

  // Wall body around the openings.
  let cursor = layout.start;
  for (const o of layout.openings) {
    if (o.a > cursor + 1e-3) body.block(theme.wall.base, cursor, o.a, -S, H, -T, 0);
    body.block(theme.wall.base, o.a, o.b, -S, y0, -T, 0);
    body.block(theme.wall.base, o.a, o.b, y1, H, -T, 0);
    cursor = o.b;
  }
  if (layout.end > cursor + 1e-3) body.block(theme.wall.base, cursor, layout.end, -S, H, -T, 0);

  // Baseboard and top cap.
  body.block(theme.wall.trim, 0, layout.innerLength, 0, DIORAMA.baseboardHeight, 0, DIORAMA.baseboardDepth);
  const ov = DIORAMA.capOverhang;
  body.block(theme.wall.top, layout.capFrom, layout.capTo, H, H + DIORAMA.capHeight, -T - ov, ov);

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
