import { Shape, Vector2, type BufferGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { BoxKind } from '../../core/types';
import type { BoxPalette, GlyphShape } from '../../themes/types';
import type { BoxDims } from '../dims';
import { GLYPH_YAW, glyphShape } from '../glyphs';
import { PartList } from '../paint';
import { extrudedShapeGeometry } from '../shapes';

/**
 * Box meshes by kind. Geometry origin = center of the box bottom; +Z is the box's forward.
 * To add a kind: add it to BOX_KINDS (core/types) and register a builder here — the Record type
 * makes the compiler ask for it.
 */
export type BoxGeometryBuilder = (palette: BoxPalette, glyph: GlyphShape, dims: BoxDims) => BufferGeometry;

export const BOX_BUILDERS: Record<BoxKind, BoxGeometryBuilder> = {
  standard: buildStandardBox,
};

export function buildBoxGeometry(kind: BoxKind, palette: BoxPalette, glyph: GlyphShape, dims: BoxDims): BufferGeometry {
  return BOX_BUILDERS[kind](palette, glyph, dims);
}

const TAPE_WIDTH_RATIO = 0.19;
const TAPE_THICKNESS = 0.01;
const TAPE_OFFSET = 0.002;
const TAPE_DROP_RATIO = 0.3;
const GLYPH_RATIO = 0.4;
const GLYPH_THICKNESS = 0.012;

/** Beveled carton with a tape strip over the lid (wrapping down the front/back) and a glyph sticker. */
function buildStandardBox(palette: BoxPalette, glyph: GlyphShape, dims: BoxDims): BufferGeometry {
  const { size, height, bevel } = dims;
  const parts = new PartList();
  parts.add(new RoundedBoxGeometry(size, height, size, 1, bevel), palette.base, { y: height / 2 });

  const tapeWidth = size * TAPE_WIDTH_RATIO;
  const profile = tapeProfile(size, height, bevel, height * TAPE_DROP_RATIO);
  // The profile lives in (z, y); extruding along +Z then yawing -90° lays it across the lid along Z.
  const tape = extrudedProfile(profile, tapeWidth);
  parts.add(tape, palette.tape, { x: tapeWidth / 2, ry: -Math.PI / 2 });

  const sticker = extrudedShapeGeometry(glyphShape(glyph, size * GLYPH_RATIO), GLYPH_THICKNESS, 0, 6);
  parts.add(sticker, palette.glyph, { y: height + TAPE_OFFSET + TAPE_THICKNESS * 0.4, ry: GLYPH_YAW });
  return parts.build();
}

/**
 * Closed outline of the tape band seen from the side: follows the box silhouette (front face, the
 * 45° bevel facets, the lid, back face) at a small offset, `TAPE_THICKNESS` thick.
 */
function tapeProfile(size: number, height: number, bevel: number, drop: number): Shape {
  const half = size / 2;
  const path = (offset: number): Vector2[] => {
    const r = bevel + offset;
    const cz = half - bevel;
    const cy = height - bevel;
    const pts: Vector2[] = [new Vector2(-half - offset, height - drop)];
    for (let i = 0; i <= 2; i++) {
      const a = Math.PI - (i * Math.PI) / 4;
      pts.push(new Vector2(-cz + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
    for (let i = 0; i <= 2; i++) {
      const a = Math.PI / 2 - (i * Math.PI) / 4;
      pts.push(new Vector2(cz + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
    pts.push(new Vector2(half + offset, height - drop));
    return pts;
  };
  const inner = path(TAPE_OFFSET);
  const outer = path(TAPE_OFFSET + TAPE_THICKNESS).reverse();
  return new Shape([...inner, ...outer]);
}

function extrudedProfile(shape: Shape, depth: number): BufferGeometry {
  // extrudedShapeGeometry rotates onto XZ; here the profile must stay vertical, so undo that rotation.
  const geo = extrudedShapeGeometry(shape, depth, 0, 1);
  geo.rotateX(Math.PI / 2);
  return geo;
}
