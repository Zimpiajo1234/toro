import { ExtrudeGeometry, Path, Shape, ShapeGeometry, Vector2, type BufferGeometry } from 'three';

/**
 * 2D outlines (rounded squares, filleted polygons) and helpers that turn them into flat or thin
 * extruded geometry lying on the XZ plane. Shape +Y maps to world -Z.
 */

/** Rounded rectangle outline, counter-clockwise, centered on the origin. */
export function roundedRectPoints(halfW: number, halfH: number, radius: number, segments = 3): Vector2[] {
  const r = Math.min(radius, halfW, halfH);
  const pts: Vector2[] = [];
  const corners: ReadonlyArray<readonly [number, number, number]> = [
    [halfW - r, -halfH + r, -Math.PI / 2],
    [halfW - r, halfH - r, 0],
    [-halfW + r, halfH - r, Math.PI / 2],
    [-halfW + r, -halfH + r, Math.PI],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = start + (i / segments) * (Math.PI / 2);
      pts.push(new Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  }
  return pts;
}

export function roundedRectShape(halfW: number, halfH: number, radius: number, segments = 3): Shape {
  return new Shape(roundedRectPoints(halfW, halfH, radius, segments));
}

/** A rounded-square ring (outer minus inner), e.g. floor tape or an outline. */
export function roundedRingShape(outerHalf: number, thickness: number, outerRadius: number, segments = 3): Shape {
  const shape = roundedRectShape(outerHalf, outerHalf, outerRadius, segments);
  const innerHalf = outerHalf - thickness;
  const innerRadius = Math.max(0.01, outerRadius - thickness);
  shape.holes.push(new Path(roundedRectPoints(innerHalf, innerHalf, innerRadius, segments)));
  return shape;
}

/**
 * Polygon with softened corners: each vertex is replaced by a quadratic curve between points at
 * `radius` distance along its two edges. Works for convex and concave (reflex) corners alike.
 */
export function filletedPolygonPoints(vertices: readonly Vector2[], radius: number, segments = 3): Vector2[] {
  const out: Vector2[] = [];
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const prev = vertices[(i + n - 1) % n];
    const cur = vertices[i];
    const next = vertices[(i + 1) % n];
    const toPrev = prev.clone().sub(cur);
    const toNext = next.clone().sub(cur);
    const r = Math.min(radius, toPrev.length() * 0.45, toNext.length() * 0.45);
    const a = cur.clone().addScaledVector(toPrev.normalize(), r);
    const b = cur.clone().addScaledVector(toNext.normalize(), r);
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const u = 1 - t;
      out.push(new Vector2(u * u * a.x + 2 * u * t * cur.x + t * t * b.x, u * u * a.y + 2 * u * t * cur.y + t * t * b.y));
    }
  }
  return out;
}

/** Flat shape on the XZ plane facing +Y, at height y. */
export function flatShapeGeometry(shape: Shape, y = 0, curveSegments = 6): BufferGeometry {
  const geo = new ShapeGeometry(shape, curveSegments);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}

/** Shape extruded upward by `height` starting at y (caps = group 0, sides = group 1). */
export function extrudedShapeGeometry(shape: Shape, height: number, y = 0, curveSegments = 6): BufferGeometry {
  const geo = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y, 0);
  return geo;
}
