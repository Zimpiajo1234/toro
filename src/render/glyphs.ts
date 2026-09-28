import { Shape, Vector2 } from 'three';
import type { GlyphShape } from '../themes/types';
import { filletedPolygonPoints } from './shapes';

/**
 * Tone-on-tone glyphs shared by box lids and zone pads (accessibility: shape + color, never text).
 * Glyphs are rotated 45° around Y when placed so they read upright from the default camera yaw.
 */
export const GLYPH_YAW = Math.PI / 4;

/**
 * Rotational symmetry of each glyph. A box resting correctly on its zone turns to the nearest multiple
 * of this so its lid glyph lines up with the zone glyph.
 */
export const GLYPH_SYMMETRY: Record<GlyphShape, number> = {
  circle: Math.PI / 2,
  square: Math.PI / 2,
  diamond: Math.PI,
  cross: Math.PI / 2,
  triangle: Math.PI * 2,
};

/** Builds the glyph outline centered on the origin, roughly `size` across. */
export function glyphShape(kind: GlyphShape, size: number): Shape {
  const h = size / 2;
  switch (kind) {
    case 'circle': {
      const pts: Vector2[] = [];
      const segments = 16;
      const r = h * 0.9;
      for (let i = 0; i < segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        pts.push(new Vector2(Math.cos(a) * r, Math.sin(a) * r));
      }
      return new Shape(pts);
    }
    case 'triangle': {
      const r = h * 1.05;
      const verts = [0, 1, 2].map((i) => {
        const a = Math.PI / 2 + (i * Math.PI * 2) / 3;
        return new Vector2(Math.cos(a) * r, Math.sin(a) * r - r * 0.12);
      });
      return new Shape(filletedPolygonPoints(verts, size * 0.1));
    }
    case 'square': {
      const s = h * 0.78;
      const verts = [new Vector2(s, -s), new Vector2(s, s), new Vector2(-s, s), new Vector2(-s, -s)];
      return new Shape(filletedPolygonPoints(verts, size * 0.1));
    }
    case 'diamond': {
      // A true rhombus (long axis ≈ 1.7× the short one), never a rotated square: it must not match
      // the 'square' glyph at any heading (the two colors colorblind players confuse most).
      const l = h * 1.25;
      const w = h * 0.72;
      const verts = [new Vector2(0, -l), new Vector2(w, 0), new Vector2(0, l), new Vector2(-w, 0)];
      return new Shape(filletedPolygonPoints(verts, size * 0.07));
    }
    case 'cross': {
      const a = h * 0.92;
      const t = h * 0.32;
      const verts = [
        [t, -a], [t, -t], [a, -t], [a, t], [t, t], [t, a],
        [-t, a], [-t, t], [-a, t], [-a, -t], [-t, -t], [-t, -a],
      ].map(([x, y]) => new Vector2(x, y));
      return new Shape(filletedPolygonPoints(verts, size * 0.06, 2));
    }
  }
}
