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
import { BOX_BUILDERS, buildBoxGeometry } from './box';
import { FORKLIFT_LAYOUT, buildForkliftGeometry } from './forklift';
import { buildHaloGeometry, buildZoneGeometry } from './zone';

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
      const b = bounds(buildZoneGeometry(defaultTheme.zones[color], defaultTheme.glyphs[color]));
      expect(b.max.x).toBeLessThanOrEqual(0.5);
      expect(b.min.z).toBeGreaterThanOrEqual(-0.5);
      expect(b.max.y).toBeLessThan(ZONE.padHeight + 0.01);
    }
    const halo = buildHaloGeometry();
    expect(halo.getAttribute('color').itemSize).toBe(4);
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
