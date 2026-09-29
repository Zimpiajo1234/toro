import { Shape, Vector2, type BufferGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { BoxKind } from '../../core/types';
import type { BoxPalette, GlyphShape } from '../../themes/types';
import type { BoxDims } from '../dims';
import { GLYPH_YAW, glyphShape } from '../glyphs';
import { PartList } from '../paint';
import { extrudedShapeGeometry } from '../shapes';

/**
 * How the lid shows the box's symbol: the small tone-on-tone glyph of levels that never name a symbol, or the large,
 * deeper print (`BoxPalette.ink`) of a level that sorts by symbol, where it is half of what the zones read.
 */
export type LidMark = 'glyph' | 'symbol';

/**
 * Box meshes by kind. Geometry origin = center of the box bottom; +Z is the box's forward.
 * To add a kind: add it to BOX_KINDS (core/types) and register a builder here — the Record type
 * makes the compiler ask for it.
 */
export type BoxGeometryBuilder = (palette: BoxPalette, glyph: GlyphShape, dims: BoxDims, mark: LidMark) => BufferGeometry;

export const BOX_BUILDERS: Record<BoxKind, BoxGeometryBuilder> = {
  standard: buildStandardBox,
};

/** `glyph` = the box's own symbol (BoxState.symbol). */
export function buildBoxGeometry(kind: BoxKind, palette: BoxPalette, glyph: GlyphShape, dims: BoxDims, mark: LidMark = 'glyph'): BufferGeometry {
  return BOX_BUILDERS[kind](palette, glyph, dims, mark);
}

const TAPE_WIDTH_RATIO = 0.19;
const TAPE_THICKNESS = 0.01;
const TAPE_OFFSET = 0.002;
const TAPE_DROP_RATIO = 0.3;
const GLYPH_RATIO = 0.4;
/** Lid symbol of a sorting level: 1.5× the classic glyph, still inside the flat part of the lid. */
export const SYMBOL_RATIO = 0.6;
const GLYPH_THICKNESS = 0.012;

/** Beveled carton with a tape strip over the lid (wrapping down the front/back) and a glyph sticker or symbol print. */
function buildStandardBox(palette: BoxPalette, glyph: GlyphShape, dims: BoxDims, mark: LidMark): BufferGeometry {
  const { size, height, bevel } = dims;
  const parts = new PartList();
  parts.add(new RoundedBoxGeometry(size, height, size, 1, bevel), palette.base, { y: height / 2 });

  const tapeWidth = size * TAPE_WIDTH_RATIO;
  const profile = tapeProfile(size, height, bevel, height * TAPE_DROP_RATIO);
  // The profile lives in (z, y); extruding along +Z then yawing -90° lays it across the lid along Z.
  const tape = extrudedProfile(profile, tapeWidth);
  parts.add(tape, palette.tape, { x: tapeWidth / 2, ry: -Math.PI / 2 });

  const print = mark === 'symbol';
  const sticker = extrudedShapeGeometry(glyphShape(glyph, size * (print ? SYMBOL_RATIO : GLYPH_RATIO)), GLYPH_THICKNESS, 0, 6);
  parts.add(sticker, print ? palette.ink : palette.glyph, { y: height + TAPE_OFFSET + TAPE_THICKNESS * 0.4, ry: GLYPH_YAW });
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
