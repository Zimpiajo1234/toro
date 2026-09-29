import { BufferAttribute, BufferGeometry, Path, Vector2 } from 'three';
import type { GlyphShape, ZonePalette } from '../../themes/types';
import { ZONE } from '../dims';
import { GLYPH_YAW, glyphShape } from '../glyphs';
import { PartList, paintGroups } from '../paint';
import { extrudedShapeGeometry, flatShapeGeometry, roundedRectPoints, roundedRectShape, roundedRingShape } from '../shapes';

const TAPE_OUTER = 0.43;
const TAPE_WIDTH = 0.045;
const GLYPH_SIZE = 0.38;
const ORIGIN = new Vector2();

/**
 * Symbol engraved in the pad of a zone that asks for one (levels that sort by symbol): `size` across (the classic
 * glyph is 0.38), cut through the pad top down to a floor at `floorY`. Clear of the tape ring (inner half 0.385) and
 * covered by a box resting on the pad (half 0.39).
 */
export const ENGRAVE = { size: 0.6, floorY: 0.008 } as const;

/**
 * What a pad shows in its middle: the tone-on-tone glyph of its color (levels that never name a symbol) or the
 * symbol the zone asks for, engraved.
 */
export interface ZoneMark {
  shape: GlyphShape;
  style: 'glyph' | 'engraved';
}

/**
 * Delivery zone pad (origin = cell center on the floor): slightly raised rounded square in `fill`, edges and inset
 * floor-tape ring in `border`, and in the middle either the tone-on-tone glyph or an engraved symbol (a real recess:
 * a symbol-shaped hole through the pad top, its walls in `border`, over a floor in `engrave`), or nothing.
 */
export function buildZoneGeometry(palette: ZonePalette, mark: ZoneMark | null): BufferGeometry {
  const parts = new PartList();
  const outline = roundedRectShape(ZONE.padHalf, ZONE.padHalf, ZONE.padRadius, 4);
  const engraved = mark?.style === 'engraved' ? mark.shape : null;
  if (engraved) {
    // Turned like the placed glyphs (shape +Y is world −Z, so a shape-space turn by GLYPH_YAW is ry = GLYPH_YAW).
    const hole = glyphShape(engraved, ENGRAVE.size)
      .getPoints()
      .map((p) => p.rotateAround(ORIGIN, GLYPH_YAW));
    outline.holes.push(new Path(hole));
  }
  const pad = extrudedShapeGeometry(outline, ZONE.padHeight, 0, 4);
  parts.add(paintGroups(pad, [palette.fill, palette.border]), null);
  const top = ZONE.padHeight;
  parts.add(flatShapeGeometry(roundedRingShape(TAPE_OUTER, TAPE_WIDTH, ZONE.padRadius - 0.04, 4), top + 0.0015), palette.border);
  if (mark?.style === 'glyph') parts.add(flatShapeGeometry(glyphShape(mark.shape, GLYPH_SIZE), top + 0.002), palette.glyph, { ry: GLYPH_YAW });
  if (engraved) parts.add(flatShapeGeometry(glyphShape(engraved, ENGRAVE.size), ENGRAVE.floorY), palette.engrave, { ry: GLYPH_YAW });
  return parts.build();
}

/**
 * Recipe marker measurements (cell units): square colored steps of side `size` (each `taper` narrower than the one
 * below) and height `step`, parted by cream spacers `gap` high, on a cream plinth slightly wider than the first step.
 * Centered on two opposite pad corners (±corner, ∓corner): clear of the box on the pad (half 0.39), of a box on the
 * diagonal neighbour (from 0.61) and of a forklift docked along an axis (half-width ≤ 0.29).
 */
export const RECIPE_MARKER = { corner: 0.5, size: 0.16, step: 0.085, gap: 0.02, taper: 0.1, plinth: 0.025, plinthSize: 0.18 } as const;

/** Corners holding a recipe column: the sides of the pad at the default 45° view (one stays in view at any yaw). */
const RECIPE_CORNERS = [
  [RECIPE_MARKER.corner, -RECIPE_MARKER.corner],
  [-RECIPE_MARKER.corner, RECIPE_MARKER.corner],
] as const;

export interface RecipeGeometry {
  /** Plinths and spacers (neutral cream) of both columns. */
  base: BufferGeometry;
  /** One geometry per recipe step, bottom → top (both columns), so the next step can glow on its own. */
  steps: BufferGeometry[];
}

/** Bottom height of recipe step `i` (world y, pad origin on the floor). */
export function recipeStepY(i: number): number {
  const { plinth, step, gap } = RECIPE_MARKER;
  return plinth + i * (step + gap);
}

/**
 * Recipe of a stack zone, drawn without text: a mini stack of colored steps, bottom → top, standing on the floor at
 * two opposite pad corners, so one of them shows from every view and stays visible while the stack grows. The cream
 * plinth and spacers keep the first step apart from the same-colored pad rim and every step apart from the next.
 * `colors` = box base colors, bottom first; `spacer` = the neutral cream.
 */
export function buildRecipeGeometry(colors: readonly string[], spacer: string): RecipeGeometry {
  const { size, step, gap, taper, plinth, plinthSize } = RECIPE_MARKER;
  const base = new PartList();
  const steps = colors.map(() => new PartList());
  for (const [cx, cz] of RECIPE_CORNERS) {
    const h = plinthSize / 2;
    base.block(spacer, cx - h, cx + h, 0, plinth, cz - h, cz + h);
    colors.forEach((color, i) => {
      // Each step is a touch narrower than the one below: reads as "stacked", bottom → top.
      const half = (size / 2) * (1 - taper * i);
      const y0 = recipeStepY(i);
      steps[i].block(color, cx - half, cx + half, y0, y0 + step, cz - half, cz + half);
      // Spacer under the next step, flush with it.
      if (i + 1 < colors.length) {
        const next = (size / 2) * (1 - taper * (i + 1));
        base.block(spacer, cx - next, cx + next, y0 + step, y0 + step + gap, cz - next, cz + next);
      }
    });
  }
  return { base: base.build(), steps: steps.map((s) => s.build()) };
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
