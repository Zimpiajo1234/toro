import { BufferAttribute, BufferGeometry } from 'three';
import type { GlyphShape, ZonePalette } from '../../themes/types';
import { ZONE } from '../dims';
import { GLYPH_YAW, glyphShape } from '../glyphs';
import { PartList, paintGroups } from '../paint';
import { extrudedShapeGeometry, flatShapeGeometry, roundedRectPoints, roundedRectShape, roundedRingShape } from '../shapes';

const TAPE_OUTER = 0.43;
const TAPE_WIDTH = 0.045;
const GLYPH_SIZE = 0.38;

/**
 * Delivery zone pad (origin = cell center on the floor): slightly raised rounded square in `fill`,
 * edges and inset floor-tape ring in `border`, tone-on-tone glyph in the middle.
 */
export function buildZoneGeometry(palette: ZonePalette, glyph: GlyphShape): BufferGeometry {
  const parts = new PartList();
  const pad = extrudedShapeGeometry(roundedRectShape(ZONE.padHalf, ZONE.padHalf, ZONE.padRadius, 4), ZONE.padHeight, 0, 4);
  parts.add(paintGroups(pad, [palette.fill, palette.border]), null);
  const top = ZONE.padHeight;
  parts.add(flatShapeGeometry(roundedRingShape(TAPE_OUTER, TAPE_WIDTH, ZONE.padRadius - 0.04, 4), top + 0.0015), palette.border);
  parts.add(flatShapeGeometry(glyphShape(glyph, GLYPH_SIZE), top + 0.002), palette.glyph, { ry: GLYPH_YAW });
  return parts.build();
}

/** Thin rounded-square outline on the floor (celebration ring, drop preview). */
export function buildOutlineGeometry(half: number, thickness: number, radius: number): BufferGeometry {
  return flatShapeGeometry(roundedRingShape(half, thickness, radius, 4), 0, 4);
}

/**
 * Feathered rounded-square glow ring hugging the pad: white RGBA vertices, alpha 1 at the pad edge
 * fading to 0 outside. Tinted and faded by its material (color = zone glow).
 */
export function buildHaloGeometry(spread = 0.2, y = 0.003): BufferGeometry {
  const segments = 4;
  const inner = roundedRectPoints(ZONE.padHalf - 0.02, ZONE.padHalf - 0.02, ZONE.padRadius, segments);
  const outer = roundedRectPoints(ZONE.padHalf + spread, ZONE.padHalf + spread, ZONE.padRadius + spread, segments);
  const positions: number[] = [];
  const colors: number[] = [];
  const push = (x: number, z: number, alpha: number) => {
    positions.push(x, y, -z);
    colors.push(1, 1, 1, alpha);
  };
  for (let i = 0; i < inner.length; i++) {
    const j = (i + 1) % inner.length;
    push(inner[i].x, inner[i].y, 1);
    push(outer[i].x, outer[i].y, 0);
    push(outer[j].x, outer[j].y, 0);
    push(inner[i].x, inner[i].y, 1);
    push(outer[j].x, outer[j].y, 0);
    push(inner[j].x, inner[j].y, 1);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 4));
  geo.computeBoundingSphere();
  return geo;
}
