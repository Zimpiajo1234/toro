import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Matrix4,
  Quaternion,
  Vector3,
  type ColorRepresentation,
  type EulerOrder,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Low-poly meshes are built from simple primitives, each painted with a flat vertex color and merged
 * into a single geometry, so a whole diorama costs a handful of draw calls and one shared material.
 */

export interface Placement {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** Euler order of rx/ry/rz (default 'XYZ'). */
  order?: EulerOrder;
}

const _matrix = new Matrix4();
const _pos = new Vector3();
const _quat = new Quaternion();
const _euler = new Euler();
const _scale = new Vector3();
const _color = new Color();

export function placementMatrix(t: Placement | undefined, target: Matrix4): Matrix4 {
  if (!t) return target.identity();
  _pos.set(t.x ?? 0, t.y ?? 0, t.z ?? 0);
  _quat.setFromEuler(_euler.set(t.rx ?? 0, t.ry ?? 0, t.rz ?? 0, t.order ?? 'XYZ'));
  _scale.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1);
  return target.compose(_pos, _quat, _scale);
}

/** Fills (or replaces) a per-vertex color attribute with one flat color. */
export function paintGeometry(geometry: BufferGeometry, color: ColorRepresentation, alpha?: number): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const itemSize = alpha === undefined ? 3 : 4;
  const data = new Float32Array(count * itemSize);
  _color.set(color);
  for (let i = 0; i < count; i++) {
    const o = i * itemSize;
    data[o] = _color.r;
    data[o + 1] = _color.g;
    data[o + 2] = _color.b;
    if (alpha !== undefined) data[o + 3] = alpha;
  }
  geometry.setAttribute('color', new BufferAttribute(data, itemSize));
  return geometry;
}

/**
 * Paints each geometry group (e.g. box faces, extrude caps vs. sides) with its own color, indexed by
 * the group's materialIndex. Returns a non-indexed geometry.
 */
export function paintGroups(geometry: BufferGeometry, colors: readonly ColorRepresentation[]): BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  const count = flat.getAttribute('position').count;
  const data = new Float32Array(count * 3);
  const groups = flat.groups.length > 0 ? flat.groups : [{ start: 0, count, materialIndex: 0 }];
  for (const g of groups) {
    _color.set(colors[Math.min(colors.length - 1, g.materialIndex ?? 0)]);
    const end = Math.min(count, g.start + g.count);
    for (let i = g.start; i < end; i++) {
      data[i * 3] = _color.r;
      data[i * 3 + 1] = _color.g;
      data[i * 3 + 2] = _color.b;
    }
  }
  flat.setAttribute('color', new BufferAttribute(data, 3));
  flat.clearGroups();
  return flat;
}

/**
 * Collects painted primitives and merges them into one non-indexed geometry with
 * `position`, `normal` and `color` (RGB, or RGBA when created with `withAlpha`).
 * Geometries handed to add() are consumed (disposed after being copied).
 */
export class PartList {
  private readonly parts: BufferGeometry[] = [];

  constructor(private readonly withAlpha = false) {}

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }

  /**
   * Adds a primitive. `color` null keeps an existing color attribute (see paintGroups).
   * `alpha` is only meaningful for lists created with `withAlpha`.
   */
  add(geometry: BufferGeometry, color: ColorRepresentation | null, t?: Placement, alpha = 1): this {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    geometry.dispose();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    if (color !== null || !g.getAttribute('color')) paintGeometry(g, color ?? 0xffffff, this.withAlpha ? alpha : undefined);
    else if (this.withAlpha && g.getAttribute('color').itemSize === 3) expandToRgba(g, alpha);
    g.clearGroups();
    g.applyMatrix4(placementMatrix(t, _matrix));
    this.parts.push(g);
    return this;
  }

  /** Axis-aligned block given by its min/max corners (after an optional placement). */
  block(color: ColorRepresentation, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): this {
    const geo = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    return this.add(geo, color, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 });
  }

  /** Appends every part of another list (consuming it), with an optional extra placement. */
  append(other: PartList, t?: Placement): this {
    const m = placementMatrix(t, new Matrix4());
    for (const g of other.parts) this.parts.push(g.applyMatrix4(m));
    other.parts.length = 0;
    return this;
  }

  /** Merges everything into one geometry and empties the list. */
  build(): BufferGeometry {
    if (this.parts.length === 0) {
      const empty = new BufferGeometry();
      empty.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
      return empty;
    }
    const merged: BufferGeometry | null = mergeGeometries(this.parts, false);
    for (const g of this.parts) g.dispose();
    this.parts.length = 0;
    if (!merged) throw new Error('PartList: incompatible geometries');
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  }
}

function expandToRgba(geometry: BufferGeometry, alpha: number): void {
  const rgb = geometry.getAttribute('color');
  const data = new Float32Array(rgb.count * 4);
  for (let i = 0; i < rgb.count; i++) {
    data[i * 4] = rgb.getX(i);
    data[i * 4 + 1] = rgb.getY(i);
    data[i * 4 + 2] = rgb.getZ(i);
    data[i * 4 + 3] = alpha;
  }
  geometry.setAttribute('color', new BufferAttribute(data, 4));
}
