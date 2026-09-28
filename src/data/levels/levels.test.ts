import { describe, expect, it } from 'vitest';
import { COLOR_IDS, forwardOf, type ColorId, type LevelData } from '../../core/types';
import { degToRad } from '../../core/math';
import { validateLevel } from '../validateLevel';
import { LEVELS } from './index';

/* ------------------------------------------------------------------ */
/* Grid model                                                          */
/* ------------------------------------------------------------------ */

/** Grid directions, clockwise: east (+x), south (+z), west (-x), north (-z). Adjacent indices are 90° apart. */
const DIR_X = [1, 0, -1, 0] as const;
const DIR_Z = [0, 1, 0, -1] as const;
const TURNS = [1, 3] as const;

/** Static view of a level on its grid. Cells are indexed `z * width + x`. */
class LevelGrid {
  readonly width: number;
  readonly depth: number;
  readonly cellCount: number;
  /** 1 where a shelf or a plant stands. */
  readonly solid: Uint8Array;
  /** Zone color per cell, or null. */
  readonly zoneColor: (ColorId | null)[];

  constructor(level: LevelData) {
    this.width = level.size.width;
    this.depth = level.size.depth;
    this.cellCount = this.width * this.depth;
    this.solid = new Uint8Array(this.cellCount);
    this.zoneColor = new Array<ColorId | null>(this.cellCount).fill(null);
    for (const s of level.shelves)
      for (let x = s.x; x < s.x + s.w; x++) for (let z = s.z; z < s.z + s.d; z++) this.solid[this.index(x, z)] = 1;
    for (const p of level.decor.plants) this.solid[this.index(p.x, p.z)] = 1;
    for (const zone of level.zones) this.zoneColor[this.index(zone.x, zone.z)] = zone.color;
  }

  index(x: number, z: number): number {
    return z * this.width + x;
  }

  /** Neighbour of `cell` in direction `dir`, or -1 outside the warehouse. */
  step(cell: number, dir: number): number {
    const x = (cell % this.width) + DIR_X[dir];
    const z = Math.floor(cell / this.width) + DIR_Z[dir];
    return x >= 0 && z >= 0 && x < this.width && z < this.depth ? this.index(x, z) : -1;
  }
}

/** Cell → index of the box resting there, or -1. */
function occupancyOf(grid: LevelGrid, boxCells: ArrayLike<number>): Int16Array {
  const occupancy = new Int16Array(grid.cellCount).fill(-1);
  for (let i = 0; i < boxCells.length; i++) occupancy[boxCells[i]] = i;
  return occupancy;
}

function isFree(grid: LevelGrid, occupancy: Int16Array, cell: number): boolean {
  return cell >= 0 && grid.solid[cell] === 0 && occupancy[cell] === -1;
}

/** Cells the empty forklift can drive to: 4-connected floor without shelves, plants or boxes. */
function reachableFrom(grid: LevelGrid, occupancy: Int16Array, start: number): Uint8Array {
  const region = new Uint8Array(grid.cellCount);
  const queue = [start];
  region[start] = 1;
  for (let q = 0; q < queue.length; q++) {
    for (let dir = 0; dir < 4; dir++) {
      const next = grid.step(queue[q], dir);
      if (next >= 0 && region[next] === 0 && isFree(grid, occupancy, next)) {
        region[next] = 1;
        queue.push(next);
      }
    }
  }
  return region;
}

/**
 * Every drop the forklift can make after lifting the box at `from` (already removed from `occupancy`).
 * Conservative carrying model (the real controller slides and arcs, so it is more permissive):
 * - the forklift sits on a cell center facing one of 4 directions; the box occupies the cell ahead;
 * - it only drives forward (no reverse gear): the next cell ahead of the box must be free;
 * - a 90° turn in place needs the new front cell and the diagonal the box sweeps through free
 *   (≈ 2 cells of clearance, the design rule for lanes where the forklift turns while carrying).
 * The box can be dropped on the cell ahead in any reached pose. Returns drop cell → forklift cells.
 */
function carryDrops(grid: LevelGrid, occupancy: Int16Array, region: Uint8Array, from: number): Map<number, number[]> {
  const visited = new Uint8Array(grid.cellCount * 4);
  const queue: number[] = [];
  const visit = (cell: number, dir: number) => {
    const pose = cell * 4 + dir;
    if (visited[pose] === 0) {
      visited[pose] = 1;
      queue.push(pose);
    }
  };
  // Pick-up: face the box from a reachable orthogonal neighbour.
  for (let dir = 0; dir < 4; dir++) {
    const approach = grid.step(from, (dir + 2) % 4);
    if (approach >= 0 && region[approach] === 1) visit(approach, dir);
  }
  const drops = new Map<number, number[]>();
  for (let q = 0; q < queue.length; q++) {
    const cell = queue[q] >> 2;
    const dir = queue[q] & 3;
    const front = grid.step(cell, dir);
    const cells = drops.get(front);
    if (cells) cells.push(cell);
    else drops.set(front, [cell]);
    if (isFree(grid, occupancy, grid.step(front, dir))) visit(front, dir);
    for (const turn of TURNS) {
      const next = (dir + turn) % 4;
      if (isFree(grid, occupancy, grid.step(cell, next)) && isFree(grid, occupancy, grid.step(front, next))) visit(cell, next);
    }
  }
  return drops;
}

/* ------------------------------------------------------------------ */
/* Solver: greedy best-first search over "move one box" macro steps    */
/* ------------------------------------------------------------------ */

interface SolveOptions {
  /** When false, boxes may only be dropped on a free zone of their own color (no temporary parking). */
  allowParking: boolean;
  /** Upper bound on expanded states: keeps the test fast and deterministic. */
  maxExpansions: number;
}

interface SolveResult {
  solved: boolean;
  /** Box moves (pick + drop) of the solution found; not necessarily optimal. */
  moves: number;
  expansions: number;
}

interface SearchNode {
  boxCells: Int32Array;
  forklift: number;
  moves: number;
}

function solve(level: LevelData, options: SolveOptions): SolveResult {
  const grid = new LevelGrid(level);
  const colors = level.boxes.map((b) => b.color);
  const misplaced = (cells: Int32Array) => colors.reduce((n, c, i) => (grid.zoneColor[cells[i]] === c ? n : n + 1), 0);
  // Same-colored boxes are interchangeable; the forklift is identified by its reachable region.
  const keyOf = (cells: Int32Array, region: Uint8Array) =>
    COLOR_IDS.map((color) =>
      colors
        .flatMap((c, i) => (c === color ? [cells[i]] : []))
        .sort((a, b) => a - b)
        .join(','),
    ).join('|') + `@${region.indexOf(1)}`;

  // Buckets by number of misplaced boxes; LIFO inside a bucket (greedy, depth-first flavoured).
  const buckets: SearchNode[][] = Array.from({ length: colors.length + 1 }, () => []);
  const seen = new Set<string>();
  const push = (boxCells: Int32Array, forklift: number, moves: number, region: Uint8Array) => {
    const key = keyOf(boxCells, region);
    if (seen.has(key)) return;
    seen.add(key);
    buckets[misplaced(boxCells)].push({ boxCells, forklift, moves });
  };

  const initial = Int32Array.from(level.boxes, (b) => grid.index(b.x, b.z));
  const start = grid.index(level.forklift.x, level.forklift.z);
  push(initial, start, 0, reachableFrom(grid, occupancyOf(grid, initial), start));

  let expansions = 0;
  while (expansions < options.maxExpansions) {
    const bucketIndex = buckets.findIndex((b) => b.length > 0);
    if (bucketIndex < 0) break;
    const node = buckets[bucketIndex].pop();
    if (!node) break;
    if (bucketIndex === 0) return { solved: true, moves: node.moves, expansions };
    expansions++;

    const occupancy = occupancyOf(grid, node.boxCells);
    const region = reachableFrom(grid, occupancy, node.forklift);
    for (let i = 0; i < colors.length; i++) {
      const from = node.boxCells[i];
      occupancy[from] = -1;
      for (const [drop, forkliftCells] of carryDrops(grid, occupancy, region, from)) {
        if (drop === from) continue;
        if (!options.allowParking && grid.zoneColor[drop] !== colors[i]) continue;
        const next = node.boxCells.slice();
        next[i] = drop;
        occupancy[drop] = i;
        // The same drop may leave the forklift on different sides of the box: keep each distinct region.
        const regions: Uint8Array[] = [];
        for (const cell of forkliftCells) {
          if (regions.some((r) => r[cell] === 1)) continue;
          const after = reachableFrom(grid, occupancy, cell);
          regions.push(after);
          push(next, cell, node.moves + 1, after);
        }
        occupancy[drop] = -1;
      }
      occupancy[from] = i;
    }
  }
  return { solved: false, moves: -1, expansions };
}

/* ------------------------------------------------------------------ */
/* Static helpers                                                      */
/* ------------------------------------------------------------------ */

/** Boxes that start on a zone of another color. */
function misplacedBoxes(level: LevelData) {
  return level.boxes.filter((b) => level.zones.some((z) => z.x === b.x && z.z === b.z && z.color !== b.color));
}

/** Zones that start covered by a box of another color. */
function blockedZones(level: LevelData) {
  return level.zones.filter((z) => level.boxes.some((b) => b.x === z.x && b.z === z.z && b.color !== z.color));
}

/** Coarse reachability report from the forklift start, treating resting boxes as obstacles. */
function coarseProblems(level: LevelData): string[] {
  const grid = new LevelGrid(level);
  const occupancy = occupancyOf(grid, level.boxes.map((b) => grid.index(b.x, b.z)));
  const region = reachableFrom(grid, occupancy, grid.index(level.forklift.x, level.forklift.z));
  const hasReachableNeighbour = (cell: number) =>
    [0, 1, 2, 3].some((d) => {
      const next = grid.step(cell, d);
      return next >= 0 && region[next] === 1;
    });
  const problems: string[] = [];
  for (const b of level.boxes)
    if (!hasReachableNeighbour(grid.index(b.x, b.z))) problems.push(`box ${b.id} has no reachable free neighbour`);
  for (const z of level.zones)
    if (!hasReachableNeighbour(grid.index(z.x, z.z))) problems.push(`zone ${z.id} has no reachable free neighbour`);
  if (misplacedBoxes(level).length > 0) {
    // Parking spot: reachable open floor (not a zone) with at least 3 free sides.
    let parking = 0;
    for (let cell = 0; cell < grid.cellCount; cell++) {
      if (region[cell] !== 1 || grid.zoneColor[cell] !== null) continue;
      const freeSides = [0, 1, 2, 3].filter((d) => isFree(grid, occupancy, grid.step(cell, d))).length;
      if (freeSides >= 3) parking++;
    }
    if (parking < 2) problems.push(`only ${parking} parking cells for misplaced boxes`);
  }
  return problems;
}

/**
 * Zones, boxes and the forklift spawn hidden behind a shelf or plant from the default camera (yaw 45°, sitting
 * toward +x / +z): the cells east, south and south-east of an item stand between it and the camera.
 */
function hiddenItems(level: LevelData): string[] {
  const grid = new LevelGrid(level);
  const inFront = (x: number, z: number) =>
    [
      [1, 0],
      [0, 1],
      [1, 1],
    ].some(([dx, dz]) => x + dx < grid.width && z + dz < grid.depth && grid.solid[grid.index(x + dx, z + dz)] === 1);
  return [...level.zones, ...level.boxes, { id: 'forklift', ...level.forklift }]
    .filter((item) => inFront(item.x, item.z))
    .map((item) => `${item.id}@${item.x},${item.z}`);
}

const colorsOf = (level: LevelData) => new Set(level.boxes.map((b) => b.color));

/** Tiny synthetic level: a corridor with the zone behind the forklift, so the box must be carried back. */
function corridorLevel(depth: number): LevelData {
  return validateLevel({
    id: `corridor-${depth}`,
    order: 0,
    name: 'Pasillo',
    size: { width: 6, depth },
    forklift: { x: 1, z: 1, heading: 90 },
    boxes: [{ id: 'b1', color: 'blue', x: 3, z: 1 }],
    zones: [{ id: 'z1', color: 'blue', x: 0, z: 1 }],
    shelves: [
      { x: 0, z: 0, w: 6, d: 1 },
      { x: 0, z: depth - 1, w: 6, d: 1 },
    ],
  });
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('level registry', () => {
  it('ships at least 12 validated levels with unique ids and strictly ascending orders', () => {
    // Invariants, not a fixed list: dropping in a new level-XX.json (any order value) must keep CI green.
    expect(LEVELS.length).toBeGreaterThanOrEqual(12);
    // Strictly ascending also means unique, so the registry sort is deterministic.
    const orders = LEVELS.map((l) => l.order);
    expect(orders.every((o, i) => i === 0 || o > orders[i - 1])).toBe(true);
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
    expect(new Set(LEVELS.map((l) => l.name)).size).toBe(LEVELS.length);
  });
});

describe('progression', () => {
  it('level 1 is a single straight run: forklift facing its one box, zone further along', () => {
    const [first] = LEVELS;
    expect(first.boxes).toHaveLength(1);
    const f = forwardOf(degToRad(first.forklift.heading));
    const dx = Math.round(f.x);
    const dz = Math.round(f.z);
    const along = (p: { x: number; z: number }) => (p.x - first.forklift.x) * dx + (p.z - first.forklift.z) * dz;
    const across = (p: { x: number; z: number }) => (p.x - first.forklift.x) * dz - (p.z - first.forklift.z) * dx;
    const [box] = first.boxes;
    const [zone] = first.zones;
    expect(across(box)).toBe(0);
    expect(across(zone)).toBe(0);
    expect(along(box)).toBeGreaterThan(0);
    expect(along(zone)).toBeGreaterThan(along(box));
  });

  it('box count never decreases and stays within 10', () => {
    const counts = LEVELS.map((l) => l.boxes.length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(counts.slice(0, 5)).toEqual([1, 2, 3, 3, 4]);
    expect(Math.max(...counts)).toBeLessThanOrEqual(10);
    expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(8);
  });

  it('warehouses grow gently up to 14×11', () => {
    const areas = LEVELS.map((l) => l.size.width * l.size.depth);
    for (let i = 1; i < areas.length; i++) expect(areas[i]).toBeGreaterThanOrEqual(areas[i - 1]);
    for (const l of LEVELS) {
      expect(l.size.width).toBeLessThanOrEqual(14);
      expect(l.size.depth).toBeLessThanOrEqual(11);
    }
  });

  it('introduces colors in COLOR_IDS order', () => {
    const seen = new Set<ColorId>();
    for (const level of LEVELS) {
      for (const c of colorsOf(level)) seen.add(c);
      expect([...seen].sort((a, b) => COLOR_IDS.indexOf(a) - COLOR_IDS.indexOf(b))).toEqual(COLOR_IDS.slice(0, seen.size));
    }
    expect(seen.size).toBe(COLOR_IDS.length);
    expect(colorsOf(LEVELS[1])).toEqual(new Set(['blue', 'mint']));
    expect(colorsOf(LEVELS[2]).has('yellow')).toBe(true);
  });

  it('introduces the first shelf on level 3', () => {
    expect(LEVELS[0].shelves).toHaveLength(0);
    expect(LEVELS[1].shelves).toHaveLength(0);
    expect(LEVELS[2].shelves.length).toBeGreaterThan(0);
  });
});

describe('decor', () => {
  it.each(LEVELS.map((l) => [l.id, l] as const))('%s keeps decor sparse and out of the lanes', (_, level) => {
    const { plants, windows } = level.decor;
    expect(plants.length).toBeGreaterThanOrEqual(1);
    expect(plants.length).toBeLessThanOrEqual(4);
    expect(windows.length).toBeGreaterThanOrEqual(1);
    expect(windows.length).toBeLessThanOrEqual(3);
    const { width, depth } = level.size;
    for (const p of plants) expect(p.x === 0 || p.z === 0 || p.x === width - 1 || p.z === depth - 1).toBe(true);
    for (const wall of ['north', 'west'] as const) {
      const spans = windows.filter((w) => w.wall === wall).sort((a, b) => a.at - b.at);
      for (let i = 1; i < spans.length; i++) expect(spans[i].at).toBeGreaterThan(spans[i - 1].at + spans[i - 1].width - 1);
    }
    // No shelf stands against a window.
    const shelfAt = (x: number, z: number) => level.shelves.some((s) => x >= s.x && x < s.x + s.w && z >= s.z && z < s.z + s.d);
    for (const w of windows)
      for (let i = w.at; i < w.at + w.width; i++) expect(w.wall === 'north' ? shelfAt(i, 0) : shelfAt(0, i)).toBe(false);
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s never hides the forklift, a zone or a box behind a shelf or plant', (_, level) => {
    expect(hiddenItems(level)).toEqual([]);
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s keeps tall shelves against the back walls', (_, level) => {
    // A 3-tier shelf shades ~1.4 cells diagonally toward the camera, beyond what hiddenItems() checks:
    // only the north (z = 0) or west (x = 0) wall has nothing behind it to hide.
    const tall = level.shelves.filter((s) => (s.tiers ?? 2) > 2);
    for (const s of tall) expect(s.z === 0 || s.x === 0, `shelf at ${s.x},${s.z}`).toBe(true);
  });

});

describe('special layouts', () => {
  it('level 4 starts with boxes on wrong zones and needs a temporary park', () => {
    const level = LEVELS[3];
    expect(misplacedBoxes(level).length).toBeGreaterThan(0);
    expect(solve(level, { allowParking: false, maxExpansions: 500 }).solved).toBe(false);
    expect(solve(level, { allowParking: true, maxExpansions: 500 }).solved).toBe(true);
  });

  it('a later level brings misplaced boxes back', () => {
    expect(LEVELS.slice(5).some((l) => misplacedBoxes(l).length > 0)).toBe(true);
  });

  it('a later level has a chain: a zone blocked by a wrong box, solvable just by choosing the order', () => {
    const chain = LEVELS.slice(5).filter(
      (l) => blockedZones(l).length > 0 && solve(l, { allowParking: false, maxExpansions: 500 }).solved,
    );
    expect(chain.length).toBeGreaterThan(0);
  });
});

describe('solvability', () => {
  it('solver model: turning while carrying needs two cells of clearance (no reverse gear)', () => {
    expect(solve(corridorLevel(3), { allowParking: true, maxExpansions: 200 }).solved).toBe(false);
    expect(solve(corridorLevel(4), { allowParking: true, maxExpansions: 200 })).toMatchObject({ solved: true, moves: 1 });
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s: every box and zone is reachable from the start', (_, level) => {
    expect(coarseProblems(level)).toEqual([]);
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s: can be solved with the conservative carrying model', (_, level) => {
    const result = solve(level, { allowParking: true, maxExpansions: 2000 });
    expect(result.solved).toBe(true);
  });
});
