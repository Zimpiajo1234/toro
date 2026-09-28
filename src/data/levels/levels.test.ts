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
  /** Zone recipe per cell as color codes bottom → top (see colorCode), or ''. */
  readonly recipe: string[];
  readonly stackLimit: number;

  constructor(level: LevelData) {
    this.width = level.size.width;
    this.depth = level.size.depth;
    this.cellCount = this.width * this.depth;
    this.solid = new Uint8Array(this.cellCount);
    this.zoneColor = new Array<ColorId | null>(this.cellCount).fill(null);
    this.recipe = new Array<string>(this.cellCount).fill('');
    this.stackLimit = level.stackLimit ?? 1;
    for (const s of level.shelves)
      for (let x = s.x; x < s.x + s.w; x++) for (let z = s.z; z < s.z + s.d; z++) this.solid[this.index(x, z)] = 1;
    for (const p of level.decor.plants) this.solid[this.index(p.x, p.z)] = 1;
    for (const zone of level.zones) {
      this.zoneColor[this.index(zone.x, zone.z)] = zone.color;
      this.recipe[this.index(zone.x, zone.z)] = (zone.recipe ?? [zone.color]).map(colorCode).join('');
    }
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

/** One character per color (index in COLOR_IDS): a stack is a string of these, bottom → top. */
function colorCode(c: ColorId): string {
  return String(COLOR_IDS.indexOf(c));
}

/** Per cell: the stack resting there as color codes bottom → top ('' = empty). */
type Stacks = string[];

function stacksOf(grid: LevelGrid, level: LevelData): Stacks {
  const stacks: Stacks = new Array<string>(grid.cellCount).fill('');
  for (const b of level.boxes) stacks[grid.index(b.x, b.z)] += colorCode(b.color);
  return stacks;
}

/** Occupancy for driving: any stack blocks its cell (0 = occupied, -1 = empty). */
function occupancyOfStacks(grid: LevelGrid, stacks: Stacks): Int16Array {
  const occupancy = new Int16Array(grid.cellCount).fill(-1);
  for (let c = 0; c < grid.cellCount; c++) if (stacks[c].length > 0) occupancy[c] = 0;
  return occupancy;
}

/** Boxes on a zone that already match its recipe from the floor up. */
function correctPrefix(grid: LevelGrid, stacks: Stacks, cell: number): number {
  const recipe = grid.recipe[cell];
  const stack = stacks[cell];
  let n = 0;
  while (n < stack.length && n < recipe.length && stack[n] === recipe[n]) n++;
  return n;
}

/** A stack (not empty) that still has room for one more box. */
function canStackOn(grid: LevelGrid, stacks: Stacks, cell: number): boolean {
  return cell >= 0 && grid.solid[cell] === 0 && stacks[cell].length > 0 && stacks[cell].length < grid.stackLimit;
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
 * Every drop the forklift can make after lifting the top box at `from` (`occupancy` / `stacks` already without
 * it: `from` stays occupied while boxes remain under it). Conservative carrying model (the real controller slides,
 * arcs and reverses, so it is more permissive):
 * - the forklift sits on a cell center facing one of 4 directions; the box occupies the cell ahead;
 * - it only drives forward (no reverse gear): the forklift's next cell and the one after it must be free;
 * - a 90° turn in place needs the new front cell and the diagonal the box sweeps through free
 *   (≈ 2 cells of clearance, the design rule for lanes where the forklift turns while carrying);
 * - stacks block like any box, except as a drop target: a stack with room that ends up right ahead (after a
 *   forward step or a turn) takes the box on top.
 * The box can be dropped on the free cell ahead in any reached pose. Returns drop cell → forklift cells.
 */
function carryDrops(grid: LevelGrid, occupancy: Int16Array, stacks: Stacks, region: Uint8Array, from: number): Map<number, number[]> {
  const visited = new Uint8Array(grid.cellCount * 4);
  const queue: number[] = [];
  const visit = (cell: number, dir: number) => {
    const pose = cell * 4 + dir;
    if (visited[pose] === 0) {
      visited[pose] = 1;
      queue.push(pose);
    }
  };
  const drops = new Map<number, number[]>();
  const record = (drop: number, cell: number) => {
    const cells = drops.get(drop);
    if (cells) cells.push(cell);
    else drops.set(drop, [cell]);
  };
  // Pick-up: face the box from a reachable orthogonal neighbour.
  for (let dir = 0; dir < 4; dir++) {
    const approach = grid.step(from, (dir + 2) % 4);
    if (approach >= 0 && region[approach] === 1) visit(approach, dir);
  }
  for (let q = 0; q < queue.length; q++) {
    const cell = queue[q] >> 2;
    const dir = queue[q] & 3;
    const front = grid.step(cell, dir);
    record(front, cell);
    if (isFree(grid, occupancy, front)) {
      const ahead = grid.step(front, dir);
      if (isFree(grid, occupancy, ahead)) visit(front, dir);
      else if (canStackOn(grid, stacks, ahead)) record(ahead, front);
    }
    for (const turn of TURNS) {
      const next = (dir + turn) % 4;
      if (!isFree(grid, occupancy, grid.step(front, next))) continue;
      const side = grid.step(cell, next);
      if (isFree(grid, occupancy, side)) visit(cell, next);
      else if (canStackOn(grid, stacks, side)) record(side, cell);
    }
  }
  return drops;
}

/* ------------------------------------------------------------------ */
/* Solver: greedy best-first search over "move one box" macro steps    */
/* ------------------------------------------------------------------ */

interface SolveOptions {
  /** When false, a box may only go where it extends a zone's recipe (no temporary parking). */
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
  stacks: Stacks;
  forklift: number;
  moves: number;
}

/**
 * State = the colors stacked on every cell (same-colored boxes are interchangeable) + the forklift's reachable
 * region. A move lifts the top box of a stack and drops it on the floor or on top of a stack with room.
 */
function solve(level: LevelData, options: SolveOptions): SolveResult {
  const grid = new LevelGrid(level);
  const total = level.boxes.length;
  const misplaced = (stacks: Stacks) => {
    let placed = 0;
    for (let c = 0; c < grid.cellCount; c++) if (grid.recipe[c]) placed += correctPrefix(grid, stacks, c);
    return total - placed;
  };
  const keyOf = (stacks: Stacks, region: Uint8Array) => `${stacks.join('/')}@${region.indexOf(1)}`;

  // Buckets by number of misplaced boxes; LIFO inside a bucket (greedy, depth-first flavoured).
  const buckets: SearchNode[][] = Array.from({ length: total + 1 }, () => []);
  const seen = new Set<string>();
  const push = (stacks: Stacks, forklift: number, moves: number, region: Uint8Array) => {
    const key = keyOf(stacks, region);
    if (seen.has(key)) return;
    seen.add(key);
    buckets[misplaced(stacks)].push({ stacks, forklift, moves });
  };

  const initial = stacksOf(grid, level);
  const start = grid.index(level.forklift.x, level.forklift.z);
  push(initial, start, 0, reachableFrom(grid, occupancyOfStacks(grid, initial), start));

  let expansions = 0;
  while (expansions < options.maxExpansions) {
    const bucketIndex = buckets.findIndex((b) => b.length > 0);
    if (bucketIndex < 0) break;
    const node = buckets[bucketIndex].pop();
    if (!node) break;
    if (bucketIndex === 0) return { solved: true, moves: node.moves, expansions };
    expansions++;

    const occupancy = occupancyOfStacks(grid, node.stacks);
    const region = reachableFrom(grid, occupancy, node.forklift);
    for (let from = 0; from < grid.cellCount; from++) {
      const stack = node.stacks[from];
      if (stack.length === 0) continue;
      const box = stack[stack.length - 1];
      const lifted = node.stacks.slice();
      lifted[from] = stack.slice(0, -1);
      occupancy[from] = lifted[from].length > 0 ? 0 : -1;
      for (const [drop, forkliftCells] of carryDrops(grid, occupancy, lifted, region, from)) {
        if (drop === from || drop < 0 || lifted[drop].length >= grid.stackLimit) continue;
        const h = lifted[drop].length;
        if (!options.allowParking && !(correctPrefix(grid, lifted, drop) === h && grid.recipe[drop][h] === box)) continue;
        const next = lifted.slice();
        next[drop] += box;
        const before = occupancy[drop];
        occupancy[drop] = 0;
        // The same drop may leave the forklift on different sides of the box: keep each distinct region.
        const regions: Uint8Array[] = [];
        for (const cell of forkliftCells) {
          if (regions.some((r) => r[cell] === 1)) continue;
          const after = reachableFrom(grid, occupancy, cell);
          regions.push(after);
          push(next, cell, node.moves + 1, after);
        }
        occupancy[drop] = before;
      }
      occupancy[from] = 0;
    }
  }
  return { solved: false, moves: -1, expansions };
}

/* ------------------------------------------------------------------ */
/* Static helpers                                                      */
/* ------------------------------------------------------------------ */

/**
 * Boxes that start on a zone above the part of its stack that already matches the recipe from the floor up
 * (classic levels: a box on a zone of another color). They must move before that zone can be finished.
 */
function misplacedBoxes(level: LevelData) {
  const grid = new LevelGrid(level);
  const stacks = stacksOf(grid, level);
  const seen = new Array<number>(grid.cellCount).fill(0);
  return level.boxes.filter((b) => {
    const cell = grid.index(b.x, b.z);
    // List order is bottom → top, so the count so far is this box's level in its stack.
    const index = seen[cell]++;
    return grid.recipe[cell] !== '' && index >= correctPrefix(grid, stacks, cell);
  });
}

/** Zones that start with a wrong box somewhere in their stack (classic levels: covered by another color). */
function blockedZones(level: LevelData) {
  const grid = new LevelGrid(level);
  const stacks = stacksOf(grid, level);
  return level.zones.filter((z) => {
    const cell = grid.index(z.x, z.z);
    return correctPrefix(grid, stacks, cell) < stacks[cell].length;
  });
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
 * Zones, boxes and the forklift spawn hidden from the default camera (yaw 45°, sitting toward +x / +z): the cells
 * east, south and south-east of an item stand between it and the camera. Blockers there are shelves, plants and
 * any cell whose stack stands 2+ boxes tall at the start or once its recipe is built (1.28 u, taller than a 2-tier
 * shelf; stacks only ghost for the forklift). A 3-high tower (1.92 u) also shades the cells one step further.
 */
function hiddenItems(level: LevelData): string[] {
  const grid = new LevelGrid(level);
  const stacks = stacksOf(grid, level);
  const blocks = (x: number, z: number, far: boolean) => {
    if (x >= grid.width || z >= grid.depth) return false;
    const cell = grid.index(x, z);
    const tallest = Math.max(stacks[cell].length, grid.recipe[cell].length);
    return far ? tallest >= 3 : grid.solid[cell] === 1 || tallest >= 2;
  };
  // Offsets never include the item's own cell, so boxes of a stack never hide each other or their zone.
  const near = [
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const;
  const far = [
    [2, 1],
    [1, 2],
    [2, 2],
  ] as const;
  const inFront = (x: number, z: number) =>
    near.some(([dx, dz]) => blocks(x + dx, z + dz, false)) || far.some(([dx, dz]) => blocks(x + dx, z + dz, true));
  return [...level.zones, ...level.boxes, { id: 'forklift', ...level.forklift }]
    .filter((item) => inFront(item.x, item.z))
    .map((item) => `${item.id}@${item.x},${item.z}`);
}

const colorsOf = (level: LevelData) => new Set(level.boxes.map((b) => b.color));
const CLASSIC = LEVELS.filter((l) => (l.stackLimit ?? 1) === 1);
const STACKING = LEVELS.filter((l) => (l.stackLimit ?? 1) > 1);

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

  // Two chapters: classic levels (no stacking), then the stacking chapter, which starts small again.
  const chapters = [CLASSIC, STACKING] as const;

  it('box count never decreases within a chapter and stays within 10', () => {
    for (const chapter of chapters) {
      const counts = chapter.map((l) => l.boxes.length);
      for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
      expect(Math.max(...counts)).toBeLessThanOrEqual(10);
      expect(counts[counts.length - 1]).toBeGreaterThanOrEqual(8);
    }
    expect(CLASSIC.map((l) => l.boxes.length).slice(0, 5)).toEqual([1, 2, 3, 3, 4]);
  });

  it('warehouses grow gently within a chapter, up to 14×11', () => {
    for (const chapter of chapters) {
      const areas = chapter.map((l) => l.size.width * l.size.depth);
      for (let i = 1; i < areas.length; i++) expect(areas[i]).toBeGreaterThanOrEqual(areas[i - 1]);
    }
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

describe('stacking chapter (docs/STACKING.md)', () => {
  const tallest = (l: LevelData) => Math.max(...l.zones.map((z) => (z.recipe ?? [z.color]).length));
  const stackedStart = (l: LevelData) => l.boxes.some((b, i) => l.boxes.findIndex((o) => o.x === b.x && o.z === b.z) !== i);

  it('follows the classic chapter: 12 classic levels, then 6 stacking levels', () => {
    expect(CLASSIC).toHaveLength(12);
    expect(STACKING).toHaveLength(6);
    expect(LEVELS.indexOf(STACKING[0])).toBe(CLASSIC.length);
    for (const l of CLASSIC) expect(l.stackLimit).toBe(1);
  });

  it('13–14 use stackLimit 2 with one 2-high recipe; 13 has its base already on the zone', () => {
    for (const l of STACKING.slice(0, 2)) {
      expect(l.stackLimit).toBe(2);
      expect(l.zones).toHaveLength(1);
      expect(tallest(l)).toBe(2);
    }
    const [z] = STACKING[0].zones;
    expect(STACKING[0].boxes.some((b) => b.x === z.x && b.z === z.z && b.color === z.color)).toBe(true);
  });

  it('15 has two 2-high stacks, 16 starts with a wrong stack on its zone, 17 builds a 3-high tower, 18 mixes all', () => {
    expect(STACKING[2].zones.filter((z) => (z.recipe ?? []).length === 2)).toHaveLength(2);
    expect(stackedStart(STACKING[3])).toBe(true);
    expect(misplacedBoxes(STACKING[3]).length).toBeGreaterThan(0);
    expect(tallest(STACKING[4])).toBe(3);
    expect(stackedStart(STACKING[4])).toBe(true);
    const last = STACKING[5];
    expect(tallest(last)).toBe(3);
    expect(last.zones.some((z) => !z.recipe)).toBe(true);
    expect(stackedStart(last)).toBe(true);
  });

  it.each(STACKING.map((l) => [l.id, l] as const))('%s: the start heading faces a box straight ahead', (_, level) => {
    const f = forwardOf(degToRad(level.forklift.heading));
    const ahead = [1, 2, 3, 4].map((d) => ({ x: level.forklift.x + Math.round(f.x) * d, z: level.forklift.z + Math.round(f.z) * d }));
    expect(level.boxes.some((b) => ahead.some((c) => c.x === b.x && c.z === b.z))).toBe(true);
  });

  it.each(STACKING.map((l) => [l.id, l] as const))('%s starts driving away from the camera', (_, level) => {
    // The camera sits toward +x / +z. Driving away keeps A/D reading as screen left / right and builds stacks from
    // their far side, so a stack rarely stands between the camera and the cabin, where it would be ghosted.
    const f = forwardOf(degToRad(level.forklift.heading));
    expect(f.x + f.z).toBeLessThan(0);
  });

  it('13–15 build straight onto their zones; 16 (desmontar) and 17 (aparcamiento) need a temporary park', () => {
    const noParking = { allowParking: false, maxExpansions: 2000 };
    for (const l of STACKING.slice(0, 3)) expect(solve(l, noParking).solved, l.id).toBe(true);
    for (const l of STACKING.slice(3, 5)) {
      expect(solve(l, noParking).solved, l.id).toBe(false);
      expect(solve(l, { allowParking: true, maxExpansions: 2000 }).solved, l.id).toBe(true);
    }
  });

  it('every stacking level asks for at least one real stack', () => {
    for (const l of STACKING) expect(tallest(l)).toBeGreaterThan(1);
  });

  it('layout helpers read stacks from the floor up against the recipe', () => {
    // z1 is built right (mint belongs on blue); z2's top coral matches its base color but not its recipe.
    const level = validateLevel({
      id: 'helpers',
      order: 0,
      name: 'Ayudantes',
      stackLimit: 2,
      size: { width: 7, depth: 5 },
      forklift: { x: 1, z: 3, heading: 180 },
      boxes: [
        { id: 'b1', color: 'blue', x: 1, z: 1 },
        { id: 'b2', color: 'mint', x: 1, z: 1 },
        { id: 'b3', color: 'coral', x: 3, z: 1 },
        { id: 'b4', color: 'coral', x: 3, z: 1 },
        { id: 'b5', color: 'yellow', x: 5, z: 3 },
      ],
      zones: [
        { id: 'z1', color: 'blue', x: 1, z: 1, recipe: ['blue', 'mint'] },
        { id: 'z2', color: 'coral', x: 3, z: 1, recipe: ['coral', 'yellow'] },
        { id: 'z3', color: 'coral', x: 5, z: 1 },
      ],
      shelves: [],
    });
    expect(misplacedBoxes(level).map((b) => b.id)).toEqual(['b4']);
    expect(blockedZones(level).map((z) => z.id)).toEqual(['z2']);
    // A tall stack hides what stands just behind it from the camera, like a shelf does.
    expect(hiddenItems({ ...level, forklift: { x: 0, z: 1, heading: 180 } })).toEqual(['forklift@0,1']);
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

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s never hides the forklift, a zone or a box behind a shelf, plant or tall stack', (_, level) => {
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

  // Classic-chapter guarantees: the stacking chapter must not satisfy them on the classic levels' behalf.
  it('a later classic level brings misplaced boxes back', () => {
    expect(CLASSIC.slice(5).some((l) => misplacedBoxes(l).length > 0)).toBe(true);
  });

  it('a later classic level has a chain: a zone blocked by a wrong box, solvable just by choosing the order', () => {
    const chain = CLASSIC.slice(5).filter(
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
