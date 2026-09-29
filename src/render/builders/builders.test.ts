import { Box2, Box3, Color, Vector2, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../config';
import { BOX_KINDS, COLOR_IDS } from '../../core/types';
import { defaultTheme } from '../../themes/default';
import type { GlyphShape } from '../../themes/types';
import { boxDims, ZONE } from '../dims';
import { GLYPH_SYMMETRY, glyphShape } from '../glyphs';
import { PartList } from '../paint';
import { flatShapeGeometry } from '../shapes';
import { BOX_BUILDERS, SYMBOL_RATIO, buildBoxGeometry } from './box';
import { FORKLIFT_LAYOUT, buildForkliftGeometry } from './forklift';
import { ENGRAVE, RECIPE_MARKER, buildHaloGeometry, buildRecipeGeometry, buildZoneGeometry, recipeStepY } from './zone';

function bounds(geo: BufferGeometry): Box3 {
  geo.computeBoundingBox();
  return geo.boundingBox!.clone();
}

describe('PartList', () => {
  it('merges primitives into one geometry with a linear-space color per vertex', () => {
    const parts = new PartList();
    parts.block('#8fb3da', 0, 1, 0, 1, 0, 1).block('#f0cd73', 2, 3, 0, 1, 0, 1);
    const geo = parts.build();
    const pos = geo.getAttribute('position');
    const col = geo.getAttribute('color');
    expect(col.count).toBe(pos.count);
    expect(geo.index).toBeNull();
    const blue = new Color('#8fb3da');
    expect(col.getX(0)).toBeCloseTo(blue.r, 5);
    expect(col.getZ(0)).toBeCloseTo(blue.b, 5);
    expect(bounds(geo).max.x).toBeCloseTo(3, 5);
    expect(parts.isEmpty).toBe(true);
  });
});

describe('box registry', () => {
  it('has a builder for every BoxKind and every color', () => {
    const dims = boxDims(GAME_CONFIG);
    for (const kind of BOX_KINDS) {
      expect(BOX_BUILDERS[kind]).toBeTypeOf('function');
      for (const color of COLOR_IDS) {
        const geo = buildBoxGeometry(kind, defaultTheme.boxes[color], defaultTheme.glyphs[color], dims);
        const b = bounds(geo);
        // Footprint matches the collision size (tape adds a hair), bottom sits on the floor.
        expect(b.max.x - b.min.x).toBeCloseTo(dims.size, 1);
        expect(b.max.z - b.min.z).toBeLessThan(dims.size + 0.04);
        expect(b.min.y).toBeCloseTo(0, 5);
        expect(b.max.y).toBeGreaterThan(dims.height);
        expect(b.max.y).toBeLessThan(dims.height + 0.04);
      }
    }
  });

  it('prints the symbol large and deeper on the lid where symbols sort, still on the flat part of the lid', () => {
    const dims = boxDims(GAME_CONFIG);
    const flat = dims.size / 2 - dims.bevel;
    const lidSpan = (geo: BufferGeometry, hex: string) => {
      const c = new Color(hex);
      const pos = geo.getAttribute('position');
      const col = geo.getAttribute('color');
      let span = 0;
      for (let i = 0; i < pos.count; i++)
        if (Math.abs(col.getX(i) - c.r) < 1e-4 && Math.abs(col.getY(i) - c.g) < 1e-4 && Math.abs(col.getZ(i) - c.b) < 1e-4)
          span = Math.max(span, Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)));
      return span;
    };
    for (const color of COLOR_IDS) {
      const palette = defaultTheme.boxes[color];
      for (const kind of ['circle', 'triangle', 'square', 'diamond', 'cross'] as GlyphShape[]) {
        const glyph = lidSpan(buildBoxGeometry('standard', palette, kind, dims, 'glyph'), palette.glyph);
        const symbol = lidSpan(buildBoxGeometry('standard', palette, kind, dims, 'symbol'), palette.ink);
        expect(symbol, `${color} ${kind}`).toBeGreaterThan(glyph * 1.4);
        expect(symbol).toBeLessThan(flat);
      }
    }
    expect(SYMBOL_RATIO).toBeGreaterThan(0.5);
  });
});

describe('glyphs', () => {
  const kinds: GlyphShape[] = ['circle', 'triangle', 'square', 'diamond', 'cross'];

  it('builds a non-empty flat shape for every glyph', () => {
    for (const kind of kinds) {
      const geo = flatShapeGeometry(glyphShape(kind, 0.4));
      const b = bounds(geo);
      expect(geo.getAttribute('position').count).toBeGreaterThan(2);
      expect(b.max.x - b.min.x).toBeGreaterThan(0.2);
      expect(b.max.x - b.min.x).toBeLessThan(0.45);
    }
  });

  it('declares a symmetry that really maps each glyph onto itself (lid and zone glyphs line up)', () => {
    for (const kind of kinds) {
      const pts = glyphShape(kind, 1).getPoints();
      const c = Math.cos(GLYPH_SYMMETRY[kind]);
      const sn = Math.sin(GLYPH_SYMMETRY[kind]);
      for (const p of pts) {
        const q = new Vector2(p.x * c - p.y * sn, p.x * sn + p.y * c);
        const nearest = Math.min(...pts.map((o) => o.distanceTo(q)));
        expect(nearest, `${kind} rotated by its symmetry`).toBeLessThan(1e-6);
      }
    }
  });

  it('keeps the diamond a rhombus, never a rotated copy of the square', () => {
    const extents = (kind: GlyphShape) => {
      const b = new Box2().setFromPoints(glyphShape(kind, 1).getPoints());
      return { w: b.max.x - b.min.x, h: b.max.y - b.min.y };
    };
    const square = extents('square');
    const diamond = extents('diamond');
    expect(square.h / square.w).toBeCloseTo(1, 6);
    expect(diamond.h / diamond.w).toBeGreaterThan(1.5);
  });
});

describe('zone geometry', () => {
  it('stays inside its cell and only slightly raised', () => {
    for (const color of COLOR_IDS) {
      const b = bounds(buildZoneGeometry(defaultTheme.zones[color], { shape: defaultTheme.glyphs[color], style: 'glyph' }));
      expect(b.max.x).toBeLessThanOrEqual(0.5);
      expect(b.min.z).toBeGreaterThanOrEqual(-0.5);
      expect(b.max.y).toBeLessThan(ZONE.padHeight + 0.01);
    }
    const halo = buildHaloGeometry();
    expect(halo.getAttribute('color').itemSize).toBe(4);
  });

  it('engraves a large symbol into the pad: a real recess, clear of the tape ring, hidden by a box on the pad', () => {
    const kinds: GlyphShape[] = ['circle', 'triangle', 'square', 'diamond', 'cross'];
    const plain = buildZoneGeometry(defaultTheme.neutralZone, null);
    for (const kind of kinds) {
      for (const palette of [defaultTheme.neutralZone, defaultTheme.zones.blue]) {
        const geo = buildZoneGeometry(palette, { shape: kind, style: 'engraved' });
        const b = bounds(geo);
        expect(b.max.x).toBeLessThanOrEqual(0.5);
        expect(b.max.y).toBeLessThan(ZONE.padHeight + 0.01);
        // The engraving's floor: painted `engrave`, below the pad top, above the floor, inside the tape ring and the
        // footprint of a box resting there (half 0.39).
        const pos = geo.getAttribute('position');
        const col = geo.getAttribute('color');
        const engrave = new Color(palette.engrave);
        let floorVerts = 0;
        for (let i = 0; i < pos.count; i++) {
          const isEngrave = Math.abs(col.getX(i) - engrave.r) < 1e-4 && Math.abs(col.getY(i) - engrave.g) < 1e-4 && Math.abs(col.getZ(i) - engrave.b) < 1e-4;
          if (!isEngrave) continue;
          floorVerts++;
          expect(pos.getY(i)).toBeCloseTo(ENGRAVE.floorY, 5);
          expect(Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)))).toBeLessThan(0.36);
        }
        expect(floorVerts).toBeGreaterThan(2);
        expect(ENGRAVE.floorY).toBeGreaterThan(0.002);
        expect(ENGRAVE.floorY).toBeLessThan(ZONE.padHeight);
        // The pad top has a hole: more geometry than the plain pad (hole walls + floor).
        expect(pos.count).toBeGreaterThan(plain.getAttribute('position').count);
      }
    }
    // Bigger than the classic tone-on-tone glyph (0.38), so it reads from the default camera.
    expect(ENGRAVE.size).toBeGreaterThanOrEqual(0.55);
  });

  it('a pad without a mark is just the pad and its tape ring', () => {
    const plain = buildZoneGeometry(defaultTheme.zones.mint, null);
    const glyph = buildZoneGeometry(defaultTheme.zones.mint, { shape: 'triangle', style: 'glyph' });
    expect(plain.getAttribute('position').count).toBeLessThan(glyph.getAttribute('position').count);
  });

  it('draws a recipe as one colored step per box, bottom → top, clear of the box, neighbours and a docked forklift', () => {
    const colors = ['#9bbce0', '#92d2b6', '#b8a6da'];
    const recipe = buildRecipeGeometry(colors, '#f3ece1');
    expect(recipe.steps).toHaveLength(3);
    const all = [recipe.base, ...recipe.steps];
    for (const geo of all) {
      const pos = geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        // Box on the pad: half 0.39; box on the diagonal neighbour: from 0.61; chassis docked along an axis: half ≤ 0.29.
        expect(Math.min(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)))).toBeGreaterThan(0.4);
        expect(Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getZ(i)))).toBeLessThan(0.6);
      }
    }
    // Stands on the floor, steps stacked bottom → top with a spacer between them, each painted its box color.
    expect(bounds(recipe.base).min.y).toBeCloseTo(0, 5);
    recipe.steps.forEach((geo, i) => {
      const b = bounds(geo);
      expect(b.min.y).toBeCloseTo(recipeStepY(i), 5);
      expect(b.max.y - b.min.y).toBeCloseTo(RECIPE_MARKER.step, 5);
      if (i > 0) expect(b.min.y).toBeGreaterThan(bounds(recipe.steps[i - 1]).max.y + 0.01);
      const c = new Color(colors[i]);
      expect(geo.getAttribute('color').getX(0)).toBeCloseTo(c.r, 5);
    });
    // Big enough to read at play scale (the first step is not lost in the pad rim).
    expect(RECIPE_MARKER.size).toBeGreaterThanOrEqual(0.15);
    expect(RECIPE_MARKER.step).toBeGreaterThanOrEqual(0.08);
    expect(recipeStepY(0)).toBeGreaterThan(ZONE.padHeight);
  });
});

describe('forklift geometry', () => {
  it('forks reach under a carried box centered at forkReach', () => {
    const f = GAME_CONFIG.forklift;
    const geo = buildForkliftGeometry(defaultTheme, { wheelRadius: f.wheelRadius, forkReach: f.forkReach, boxSize: GAME_CONFIG.box.size });
    const forks = bounds(geo.carriage);
    const half = GAME_CONFIG.box.size / 2;
    expect(forks.max.z).toBeGreaterThan(GAME_CONFIG.forklift.forkReach + half * 0.5);
    expect(forks.max.z).toBeLessThan(GAME_CONFIG.forklift.forkReach + half);
    // Mast stays behind the carried box.
    expect(bounds(geo.chassis).max.z).toBeLessThan(GAME_CONFIG.forklift.forkReach - half);
    // Low-poly tires touch the floor (within a centimetre) when mounted at wheelRadius.
    const wheel = bounds(geo.wheel);
    expect(wheel.min.y).toBeLessThan(-GAME_CONFIG.forklift.wheelRadius + 0.01);
    expect(wheel.min.y).toBeGreaterThanOrEqual(-GAME_CONFIG.forklift.wheelRadius - 1e-6);
    expect(FORKLIFT_LAYOUT.trackHalf).toBeLessThan(GAME_CONFIG.forklift.bodyRadius);
  });
});
