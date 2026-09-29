import { describe, expect, it } from 'vitest';
import type { BoxState } from '../core/types';
import { BOX_SETTLE_SPEED, circleRectContact, CollisionWorld, createContact, pointRectDistance, type Rect } from './collision';

const BOUNDS: Rect = { minX: -5, minZ: -5, maxX: 5, maxZ: 5 };

function box(id: string, x: number, z: number, carried = false): BoxState {
  return { id, color: 'blue', symbol: 'circle', kind: 'standard', pos: { x, z }, cell: null, level: 0, carried, zoneId: null, slotId: null, correct: false };
}

describe('circleRectContact', () => {
  it('reports no contact when separated or just touching', () => {
    const c = createContact();
    expect(circleRectContact(0, -2, 0.5, -1, -1, 1, 1, c)).toBe(0);
    expect(circleRectContact(0, -1.5, 0.5, -1, -1, 1, 1, c)).toBe(0);
  });

  it('pushes straight out of a face', () => {
    const c = createContact();
    const d = circleRectContact(0.3, -1.4, 0.5, -1, -1, 1, 1, c);
    expect(d).toBeCloseTo(0.1, 12);
    expect(c.nx).toBeCloseTo(0, 12);
    expect(c.nz).toBeCloseTo(-1, 12);
  });

  it('pushes radially away from a corner', () => {
    const c = createContact();
    const d = circleRectContact(1.3, 1.3, 0.5, -1, -1, 1, 1, c);
    expect(d).toBeCloseTo(0.5 - Math.hypot(0.3, 0.3), 12);
    expect(c.nx).toBeCloseTo(Math.SQRT1_2, 12);
    expect(c.nz).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('pushes a center inside the rect out through the nearest face', () => {
    const c = createContact();
    const d = circleRectContact(0.8, 0.1, 0.5, -1, -1, 1, 1, c);
    expect(d).toBeCloseTo(0.2 + 0.5, 12);
    expect([c.nx, c.nz]).toEqual([1, 0]);
  });

  it('never collides with a zero radius', () => {
    expect(circleRectContact(0, 0, 0, -1, -1, 1, 1, createContact())).toBe(0);
  });
});

describe('pointRectDistance', () => {
  it('is positive outside and negative inside', () => {
    expect(pointRectDistance(3, 0, -1, -1, 1, 1)).toBeCloseTo(2, 12);
    expect(pointRectDistance(2, 2, -1, -1, 1, 1)).toBeCloseTo(Math.SQRT2, 12);
    expect(pointRectDistance(0.5, 0, -1, -1, 1, 1)).toBeCloseTo(-0.5, 12);
  });
});

describe('CollisionWorld.resolve', () => {
  it('keeps a circle inside the walls', () => {
    const world = new CollisionWorld(BOUNDS, [], 0.78);
    const pos = { x: 4.9, z: 0 };
    expect(world.resolve(pos, 0, 1, 0.42, 0, 0)).toBe(0);
    expect(pos.x).toBeCloseTo(5 - 0.42, 5);
    expect(pos.z).toBe(0);
  });

  it('resolves a concave corner in both axes', () => {
    const world = new CollisionWorld(BOUNDS, [], 0.78);
    const pos = { x: -4.9, z: -4.8 };
    expect(world.resolve(pos, 0, 1, 0.42, 0, 0)).toBe(0);
    expect(pos.x).toBeCloseTo(-5 + 0.42, 5);
    expect(pos.z).toBeCloseTo(-5 + 0.42, 5);
  });

  it('does not snag on the seam between two adjacent rects', () => {
    const left: Rect = { minX: -2, minZ: 0, maxX: 0, maxZ: 1 };
    const right: Rect = { minX: 0, minZ: 0, maxX: 2, maxZ: 1 };
    const world = new CollisionWorld(BOUNDS, [left, right], 0.78);
    for (const x of [-0.001, 0, 0.001, 0.2]) {
      const pos = { x, z: -0.4 };
      world.resolve(pos, 0, 1, 0.42, 0, 0);
      expect(pos.x).toBe(x);
      expect(pos.z).toBeCloseTo(-0.42, 5);
    }
  });

  it('pushes the whole rig when the load circle overlaps', () => {
    const wall: Rect = { minX: 1, minZ: -1, maxX: 2, maxZ: 1 };
    const world = new CollisionWorld(BOUNDS, [wall], 0.78);
    // Facing +X, load 0.92 ahead with radius 0.46 → load center must stay at x ≤ 0.54.
    const pos = { x: -0.3, z: 0 };
    world.resolve(pos, 1, 0, 0.42, 0.92, 0.46);
    expect(pos.x + 0.92).toBeCloseTo(1 - 0.46, 5);
  });

  it('collides with resting boxes but not carried ones', () => {
    const world = new CollisionWorld(BOUNDS, [], 0.78);
    const boxes = [box('a', 1, 0), box('b', -1, 0, true)];
    world.setBoxes(boxes);
    const pos = { x: 0.3, z: 0 };
    world.resolve(pos, 0, 1, 0.42, 0, 0);
    expect(pos.x).toBeCloseTo(1 - 0.39 - 0.42, 5);
    expect(world.clearance(-1, 0)).toBeGreaterThan(0.5);
    expect(world.clearance(1, 0)).toBeLessThan(0);
    expect(world.clearance(1, 0, 'a')).toBeGreaterThan(0);
  });

  it('builds shelves and plant colliders from a level', () => {
    const world = CollisionWorld.fromLevel(
      {
        id: 'x',
        order: 1,
        name: 'x',
        size: { width: 6, depth: 4 },
        forklift: { x: 0, z: 0, heading: 0 },
        boxes: [],
        zones: [],
        shelves: [{ x: 2, z: 1, w: 2, d: 1 }],
        decor: { plants: [{ x: 5, z: 3 }], windows: [] },
        theme: 'default',
      },
      0.78,
    );
    expect(world.bounds).toEqual({ minX: -3, minZ: -2, maxX: 3, maxZ: 2 });
    expect(world.clearance(0, -0.5)).toBeCloseTo(-0.5, 9); // center of the 2×1 shelf
    expect(world.clearance(2.5, 1.5)).toBeCloseTo(-0.3, 9); // center of the 0.6 plant
    expect(world.clearance(2.5, 1.15)).toBeCloseTo(0.05, 9); // just outside the plant (spans z 1.2‥1.8)
  });

  it('stays finite for degenerate inputs', () => {
    const world = new CollisionWorld(BOUNDS, [{ minX: 0, minZ: 0, maxX: 1, maxZ: 1 }], 0.78);
    const pos = { x: 0, z: 0 }; // exactly on a corner
    world.resolve(pos, 0, 1, 0.42, 0.92, 0.46);
    expect(Number.isFinite(pos.x) && Number.isFinite(pos.z)).toBe(true);
    expect(world.deepestContact(pos.x, pos.z, 0.42, createContact())).toBeLessThan(1e-6);
  });
});

describe('CollisionWorld settling boxes', () => {
  const touching = 1 - 0.39 - 0.42; // circle center when just touching box 'a' (at x = 1) from the west

  it('a softened box eases an overlapping circle out, then is solid again', () => {
    const world = new CollisionWorld(BOUNDS, [], 0.78);
    world.setBoxes([box('a', 1, 0)]);
    const pos = { x: touching + 0.04, z: 0 };
    expect(world.softenBox(0, pos.x, pos.z, 0.42)).toBeCloseTo(0.04, 9);
    expect(world.boxInset(0)).toBeCloseTo(0.04, 9);
    // Push-out sees the shrunk box (already clear); clearance still measures the full box.
    expect(world.resolve(pos, 0, 1, 0.42, 0, 0)).toBe(0);
    expect(pos.x).toBeCloseTo(touching + 0.04, 9);
    expect(world.clearance(0.6, 0)).toBeCloseTo(0.01, 9);
    const dt = 1 / 60;
    for (let i = 0; i < 12; i++) {
      const x = pos.x;
      world.settle(dt);
      world.resolve(pos, 0, 1, 0.42, 0, 0);
      expect(x - pos.x).toBeGreaterThanOrEqual(0);
      expect(x - pos.x).toBeLessThanOrEqual(BOX_SETTLE_SPEED * dt + 1e-5);
    }
    expect(world.boxInset(0)).toBe(0);
    expect(pos.x).toBeCloseTo(touching, 5);
  });

  it('hardenBox restores the full collider at once; setBoxes starts every box at full size', () => {
    const world = new CollisionWorld(BOUNDS, [], 0.78);
    const boxes = [box('a', 1, 0)];
    world.setBoxes(boxes);
    world.softenBox(0, touching + 0.04, 0, 0.42);
    world.hardenBox(0);
    expect(world.boxInset(0)).toBe(0);
    world.softenBox(0, touching + 0.04, 0, 0.42);
    world.setBoxes(boxes);
    expect(world.boxInset(0)).toBe(0);
    // No overlap → nothing to soften.
    expect(world.softenBox(0, touching - 0.1, 0, 0.42)).toBe(0);
    expect(world.boxInset(0)).toBe(0);
  });
});

describe('CollisionWorld rack column closing on the load', () => {
  it('a softened rack cell eases a load reaching into it back out; the body always meets the full cell', () => {
    // One rack column (z −3‥−2) facing south; the rig faces north with the load 0.92 ahead, 4 cm into the cell.
    const world = new CollisionWorld(BOUNDS, [], 0.78, [{ cell: { minX: -0.5, minZ: -3, maxX: 0.5, maxZ: -2 }, facing: 'south' }]);
    const touching = -2 + 0.46; // load centre just touching the cell from the south
    const pos = { x: 0, z: touching - 0.04 + 0.92 };
    expect(world.softenRack(0, 0, touching - 0.04, 0.46)).toBeCloseTo(0.04, 9);
    expect(world.rackInset(0)).toBeCloseTo(0.04, 9);
    const hit = createContact();
    expect(world.deepestContact(0, touching - 0.04, 0.46, hit, true)).toBeCloseTo(0, 9);
    expect(world.deepestContact(0, touching - 0.04, 0.46, hit)).toBeCloseTo(0.04, 9);
    expect(world.clearance(0, -2)).toBeCloseTo(0, 9);
    const dt = 1 / 60;
    for (let i = 0; i < 12; i++) {
      const z = pos.z;
      world.settle(dt);
      world.resolve(pos, 0, -1, 0.42, 0.92, 0.46);
      expect(pos.z - z).toBeGreaterThanOrEqual(0);
      expect(pos.z - z).toBeLessThanOrEqual(BOX_SETTLE_SPEED * dt + 1e-5);
    }
    expect(world.rackInset(0)).toBe(0);
    expect(pos.z - 0.92).toBeCloseTo(touching, 5);
    // No overlap → nothing to soften; out-of-range columns are ignored.
    expect(world.softenRack(0, 0, touching + 0.1, 0.46)).toBe(0);
    expect(world.softenRack(3, 0, 0, 0.46)).toBe(0);
    expect(world.rackInset(3)).toBe(0);
  });
});

describe('CollisionWorld passable stack bases', () => {
  it('only the carried load passes over a passable base; the body and plain queries still collide', () => {
    const world = new CollisionWorld(BOUNDS, [], 0.78);
    world.setBoxes([box('a', 1, 0), box('b', -2, 0)]);
    expect(world.isPassable(0)).toBe(false);
    world.setPassable(0, true);
    expect(world.isPassable(0)).toBe(true);
    expect(world.isPassable(1)).toBe(false);
    const hit = createContact();
    expect(world.deepestContact(1, 0, 0.46, hit, true)).toBe(0);
    expect(world.deepestContact(1, 0, 0.46, hit)).toBeGreaterThan(0);
    expect(world.clearance(1, 0, null, true)).toBeGreaterThan(0);
    expect(world.clearance(1, 0)).toBeLessThan(0);
    world.setPassable(0, false);
    expect(world.deepestContact(1, 0, 0.46, hit, true)).toBeGreaterThan(0);
    // Out-of-range indices are ignored; a new box list starts with nothing passable.
    world.setPassable(5, true);
    expect(world.isPassable(5)).toBe(false);
    world.setPassable(0, true);
    world.setBoxes([box('a', 1, 0)]);
    expect(world.isPassable(0)).toBe(false);
  });
});
