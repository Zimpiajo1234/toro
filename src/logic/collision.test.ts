import { describe, expect, it } from 'vitest';
import { DOCK_RAIL, dockRailsOf } from '../core/docks';
import type { BoxState, LevelData, LevelStorage, LevelTruck } from '../core/types';
import { LEVELS } from '../data/levels';
import {
  BOX_SETTLE_SPEED,
  circleRectContact,
  CollisionWorld,
  createContact,
  DOOR_JAMB,
  PLANT_SIZE,
  RACK_WALL,
  pointRectDistance,
  railRect,
  type Rect,
} from './collision';

const BOUNDS: Rect = { minX: -5, minZ: -5, maxX: 5, maxZ: 5 };

function box(id: string, x: number, z: number, carried = false): BoxState {
  return { id, color: 'blue', symbol: 'circle', kind: 'standard', pos: { x, z }, cell: null, level: 0, carried, zoneId: null, slotId: null, correct: false, locked: false };
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
    const world = new CollisionWorld(BOUNDS, [], 0.78, { openings: [{ access: 'front', cell: { minX: -0.5, minZ: -3, maxX: 0.5, maxZ: -2 }, facing: 'south' }] });
    const touching = -2 + 0.46; // load centre just touching the cell from the south
    const pos = { x: 0, z: touching - 0.04 + 0.92 };
    expect(world.soften(0, 0, touching - 0.04, 0.46)).toBeCloseTo(0.04, 9);
    expect(world.openingInset(0)).toBeCloseTo(0.04, 9);
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
    expect(world.openingInset(0)).toBe(0);
    expect(pos.z - 0.92).toBeCloseTo(touching, 5);
    // No overlap → nothing to soften; out-of-range columns are ignored.
    expect(world.soften(0, 0, touching + 0.1, 0.46)).toBe(0);
    expect(world.soften(3, 0, 0, 0.46)).toBe(0);
    expect(world.openingInset(3)).toBe(0);
  });
});

describe('CollisionWorld dock doors (docs/DOCKS.md)', () => {
  /** A 6×4 room; `trucks` in its north / west walls (its storage units). */
  const room = (trucks: readonly LevelTruck[] | undefined): LevelData => ({
    id: 'x',
    order: 1,
    name: 'x',
    size: { width: 6, depth: 4 },
    forklift: { x: 5, z: 3, heading: 0 },
    boxes: [],
    zones: [],
    shelves: [],
    ...(trucks
      ? { storage: trucks.map((t): LevelStorage => ({ id: t.id, skin: 'truck', x: t.x, z: t.z, w: t.w, access: { kind: 'door', wall: t.wall }, columns: t.columns })) }
      : {}),
    decor: { plants: [], windows: [] },
    theme: 'default',
  });
  const hit = createContact();

  it('without docks the load meets the walls exactly as the body does', () => {
    const world = CollisionWorld.fromLevel(room(undefined), 0.78);
    for (const [x, z] of [
      [-2.7, 0],
      [0, -1.7],
      [-2.8, -1.8],
      [2.9, 1.9],
      [0.3, 0.2],
    ]) {
      expect(world.deepestContact(x, z, 0.46, hit, true)).toBeCloseTo(world.deepestContact(x, z, 0.46, hit), 12);
      expect(world.clearance(x, z, null, true)).toBeCloseTo(Math.min(x + 3, 3 - x, z + 2, 2 - z), 12);
    }
  });

  it('a north door: the load passes the wall line only through an open column, between its jambs, into a pocket one cell deep; never the body', () => {
    // Door cells (2,0) and (3,0): world x −1‥1 along the north wall (z = −2); the bed pocket is z −3‥−2.
    const world = CollisionWorld.fromLevel(room([{ id: 't1', wall: 'north', x: 2, z: 0, w: 2, columns: [[{ color: 'blue' }], [{ color: 'mint' }]] }]), 0.78);
    expect(world.columnCount).toBe(2);
    expect(world.opening(0)).toEqual({ minX: -1, minZ: -3, maxX: 0, maxZ: -2 });
    expect(world.opening(1)).toEqual({ minX: 0, minZ: -3, maxX: 1, maxZ: -2 });
    // Shut (until GameState opens a column), the door is wall for the load: resting against its line, never past it.
    expect([world.isOpen(0), world.isOpen(1)]).toEqual([false, false]);
    expect(world.deepestContact(-0.5, -2 + 0.46, 0.46, hit, true)).toBeCloseTo(0, 9);
    expect(world.deepestContact(-0.5, -2 + 0.4, 0.46, hit, true)).toBeCloseTo(0.06, 9);
    expect(hit.nz).toBe(1);
    expect(world.clearance(-0.5, -2.5, null, true)).toBeLessThan(0);
    // Column 0 open: the load passes onto its bed, never into the shut span beside it (no sliding along the door).
    world.setOpen(0, true);
    expect(world.isOpen(0)).toBe(true);
    expect(world.deepestContact(-0.5, -2.5, 0.46, hit, true)).toBe(0);
    expect(world.deepestContact(0, -2.5, 0.46, hit, true)).toBeCloseTo(0.46, 9);
    expect(hit.nx).toBe(-1);
    expect(world.clearance(-0.5, -2.5, null, true)).toBeCloseTo(0.5 - DOOR_JAMB, 9);
    // Both open: nothing stands between the columns of one door.
    world.setOpen(1, true);
    for (const x of [-0.5, 0, 0.5]) expect(world.deepestContact(x, -2.5, 0.46, hit, true), `x ${x}`).toBe(0);
    // The body always meets the whole wall, also at an open door.
    expect(world.deepestContact(0, -2.1, 0.42, hit)).toBeCloseTo(0.42 + 0.1, 9);
    expect(hit.nz).toBe(1);
    // The back of the pocket, and the jambs (DOOR_JAMB into each end of the run).
    expect(world.deepestContact(0, -2.6, 0.46, hit, true)).toBeCloseTo(0.06, 9);
    expect(hit.nz).toBe(1);
    expect(world.deepestContact(-1 + DOOR_JAMB + 0.46, -2.5, 0.46, hit, true)).toBeCloseTo(0, 9);
    expect(world.deepestContact(-1 + DOOR_JAMB + 0.4, -2.5, 0.46, hit, true)).toBeCloseTo(0.06, 9);
    expect(hit.nx).toBe(1);
    // Beside the door the wall is whole for the load too.
    expect(world.deepestContact(-2, -1.8, 0.46, hit, true)).toBeCloseTo(0.26, 9);
    expect(world.deepestContact(2, -1.8, 0.46, hit, true)).toBeCloseTo(0.26, 9);
    // The fork point (empty tines) passes any door, shut or open: on the bed it has room; beside the door it is inside
    // the wall.
    world.setOpen(0, false);
    world.setOpen(1, false);
    expect(world.clearance(0, -2.5)).toBeCloseTo(0.5, 9);
    expect(world.clearance(-2, -2.5)).toBeLessThan(0);
    // Elsewhere (south and east walls, the room) exactly as the plain walls.
    expect(world.deepestContact(2.8, 1.8, 0.46, hit, true)).toBeCloseTo(world.deepestContact(2.8, 1.8, 0.46, hit), 12);
    expect(world.clearance(1.5, 0.5, null, true)).toBeCloseTo(1.5, 12);
    // Out-of-range columns are ignored.
    world.setOpen(5, true);
    expect(world.isOpen(5)).toBe(false);
  });

  it('the guard rails beside a door: static on its jamb line from the wall one cell in, for the body, the load and the fork point', () => {
    // Door cells (2,0) and (3,0): world x −1‥1; the rails stand at x −1 + J (west) and 1 − J (east), from the wall's
    // inner face (z = −2) to the end of the door cells (z = −1), DOCK_RAIL.thickness thick outward.
    const level = room([{ id: 't1', wall: 'north', x: 2, z: 0, w: 2, columns: [[{ color: 'blue' }], [{ color: 'mint' }]] }]);
    const world = CollisionWorld.fromLevel(level, 0.78);
    const T = DOCK_RAIL.thickness;
    expect(dockRailsOf(level).map((r) => railRect(r, 3, 2))).toEqual([
      { minX: -1 + DOOR_JAMB - T, minZ: -2, maxX: -1 + DOOR_JAMB, maxZ: -1 },
      { minX: 1 - DOOR_JAMB, minZ: -2, maxX: 1 - DOOR_JAMB + T, maxZ: -1 },
    ]);
    // The body on a door cell has a few cm of play to the rail (0.06), the load 0.02: both meet it like a wall.
    expect(world.deepestContact(-0.5, -1.5, 0.42, hit)).toBe(0);
    expect(world.deepestContact(-0.6, -1.5, 0.42, hit)).toBeCloseTo(0.04, 9);
    expect([hit.nx, hit.nz]).toEqual([1, 0]);
    expect(world.deepestContact(-0.5, -1.5, 0.46, hit, true)).toBe(0);
    expect(world.deepestContact(-0.53, -1.5, 0.46, hit, true)).toBeCloseTo(0.01, 9);
    expect(world.deepestContact(0.53, -1.5, 0.46, hit, true)).toBeCloseTo(0.01, 9);
    expect(hit.nx).toBe(-1);
    // Its inner face is the jamb line: one straight chute with the opening (the load in the door stays as clear of it).
    expect(world.clearance(-0.5, -1.5, null, true)).toBeCloseTo(0.5 - DOOR_JAMB, 9);
    world.setOpen(0, true);
    expect(world.clearance(-0.5, -2.5, null, true)).toBeCloseTo(0.5 - DOOR_JAMB, 9);
    // The fork point (empty tines too) has no room inside a rail; the side cell behind it is walled off from the door.
    expect(world.clearance(-1, -1.5)).toBeLessThan(0);
    expect(world.deepestContact(-1 + DOOR_JAMB - T - 0.4, -1.5, 0.42, hit)).toBeCloseTo(0.02, 9);
    expect([hit.nx, hit.nz]).toEqual([-1, 0]);
    // It never reaches the row behind the door cells, where the forklift lines up: only its end touches from there.
    expect(world.deepestContact(-1, -0.5, 0.42, hit)).toBe(0);
    expect(world.deepestContact(-1, -1 + 0.41, 0.42, hit)).toBeCloseTo(0.01, 9);
    expect([hit.nx, hit.nz]).toEqual([0, 1]);
  });

  it('levels without trucks: no rails and the very same static world as before', () => {
    for (const level of LEVELS) {
      expect(dockRailsOf(level)).toEqual([]);
      const hw = level.size.width / 2;
      const hd = level.size.depth / 2;
      // The world as it was built before the rails: shelves, plants and racks only.
      const inset = (1 - PLANT_SIZE) / 2;
      const statics: Rect[] = [
        ...level.shelves.map((s) => ({ minX: s.x - hw, minZ: s.z - hd, maxX: s.x + s.w - hw, maxZ: s.z + s.d - hd })),
        ...level.decor.plants.map((p) => ({ minX: p.x - hw + inset, minZ: p.z - hd + inset, maxX: p.x + 1 - hw - inset, maxZ: p.z + 1 - hd - inset })),
      ];
      const before = new CollisionWorld({ minX: -hw, minZ: -hd, maxX: hw, maxZ: hd }, statics, 0.78);
      const world = CollisionWorld.fromLevel(level, 0.78);
      const a = createContact();
      const b = createContact();
      for (let x = -hw - 0.3; x <= hw + 0.3; x += 0.17) {
        for (let z = -hd - 0.3; z <= hd + 0.3; z += 0.17) {
          for (const [r, load] of [
            [0.42, false],
            [0.46, true],
          ] as const) {
            expect(world.deepestContact(x, z, r, a, load)).toBe(before.deepestContact(x, z, r, b, load));
            expect([a.nx, a.nz]).toEqual([b.nx, b.nz]);
          }
          expect(world.clearance(x, z)).toBe(before.clearance(x, z));
          expect(world.clearance(x, z, null, true)).toBe(before.clearance(x, z, null, true));
        }
      }
    }
  });

  it('a west door in the corner and a north door next to it: each opens its own pocket, the corner stays solid', () => {
    const world = CollisionWorld.fromLevel(
      room([
        { id: 't1', wall: 'west', x: 0, z: 0, w: 1, columns: [[{ color: 'blue' }]] },
        { id: 't2', wall: 'north', x: 0, z: 0, w: 1, columns: [[{ color: 'mint' }]] },
      ]),
      0.78,
    );
    // West pocket: x −4‥−3 beside row 0 (z −2‥−1); north pocket: z −3‥−2 over column 0 (x −3‥−2).
    expect(world.opening(0)).toEqual({ minX: -4, minZ: -2, maxX: -3, maxZ: -1 });
    expect(world.opening(1)).toEqual({ minX: -3, minZ: -3, maxX: -2, maxZ: -2 });
    expect(world.deepestContact(-3.5, -1.5, 0.46, hit, true)).toBeGreaterThan(0);
    world.setOpen(0, true);
    expect(world.deepestContact(-3.5, -1.5, 0.46, hit, true)).toBe(0);
    // Each door opens on its own.
    expect(world.deepestContact(-2.5, -2.5, 0.46, hit, true)).toBeGreaterThan(0);
    world.setOpen(1, true);
    expect(world.deepestContact(-2.5, -2.5, 0.46, hit, true)).toBe(0);
    expect(world.clearance(-3.5, -2.5)).toBeLessThan(0);
    // Two doors side by side on one wall leave a post of two jambs between them.
    const pair = CollisionWorld.fromLevel(
      room([
        { id: 't1', wall: 'north', x: 1, z: 0, w: 1, columns: [[{ color: 'blue' }]] },
        { id: 't2', wall: 'north', x: 2, z: 0, w: 1, columns: [[{ color: 'mint' }]] },
      ]),
      0.78,
    );
    pair.setOpen(0, true);
    pair.setOpen(1, true);
    expect(pair.clearance(-1, -2.5)).toBeLessThan(0);
    expect(pair.clearance(-1.5, -2.5, null, true)).toBeCloseTo(0.5 - DOOR_JAMB, 9);
    expect(pair.clearance(-0.5, -2.5, null, true)).toBeCloseTo(0.5 - DOOR_JAMB, 9);
  });
});

describe('CollisionWorld storage slots (docs/STORAGE.md «Soporte»)', () => {
  it('a box on a storage shelf never collides on its own (its column does); one in a stack slot is a stack like the floor', () => {
    // A front column (x −1‥0, z −3‥−2) holding a box on a shelf; a box in a stack slot (a truck bed) stands at (2, 0).
    const world = new CollisionWorld(BOUNDS, [], 0.78, {
      openings: [{ access: 'front', cell: { minX: -1, minZ: -3, maxX: 0, maxZ: -2 }, facing: 'south' }],
      shelfSlots: new Set(['r1:0:1']),
    });
    const shelf = { ...box('s', -0.5, -2.5), cell: { x: 0, z: 0 }, level: 1, slotId: 'r1:0:1' };
    const onShelf0 = { ...box('f', -0.5, -2.5), cell: { x: 0, z: 0 }, level: 0, slotId: 'r1:0:1' };
    const stacked = { ...box('t', 2, 0), cell: { x: 5, z: -1 }, level: 0, slotId: 't1:0:0' };
    world.setBoxes([onShelf0, shelf, stacked]);
    const hit = createContact();
    world.setOpen(0, true);
    // Open for the load: it only meets the slot's walls, never the shelf box (even at level 0).
    expect(world.deepestContact(-0.5, -2.5, 0.46, hit, true)).toBe(0);
    expect(world.clearance(-0.5, -2.5, null, true)).toBeCloseTo(0.5 - RACK_WALL, 9);
    // The stack slot's box collides like a floor box, and a clearance can leave it out (its stack's base).
    expect(world.deepestContact(2, 0.5, 0.42, hit)).toBeGreaterThan(0);
    expect(world.clearance(2, 0)).toBeLessThan(0);
    expect(world.clearance(2, 0, 't')).toBeGreaterThan(0);
    // Without its id among the shelf slots a stored box is a stack (the default).
    const plain = new CollisionWorld(BOUNDS, [], 0.78);
    plain.setBoxes([onShelf0]);
    expect(plain.clearance(-0.5, -2.5)).toBeLessThan(0);
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
