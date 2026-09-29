import { describe, expect, it } from 'vitest';
import { COLOR_IDS, forwardOf, type ColorId, type LevelData, type SymbolId } from '../../core/types';
import { degToRad } from '../../core/math';
import { assignBoxes, criteriaOf, matchKind, meets, sortableOf, usesSymbols } from '../../core/sorting';
import { parseLevel, renderLevel } from '../asciiLevel';
import { formatRange, formatTarget } from '../difficulty';
import { validateLevel } from '../validateLevel';
import { LEVELS, LEVEL_SOURCES } from './index';
import { checkLevelTargets } from './metrics';
import {
  LevelGrid,
  blockedZones,
  boxCode,
  deadEnds,
  isFree,
  minMoves,
  misplacedBoxes,
  occupancyOf,
  reachableFrom,
  replayMoves,
  solve,
  sortable,
  stacksOf,
  type Stacks,
} from './solver';

/*
 * The grid model, the conservative carrying model and the greedy solver live in ./solver.ts (shared with the
 * autopilot planner in src/integration/levelsPlayable.test.ts and the level metrics behind `npm run levels`).
 */

const code = (color: ColorId, symbol: SymbolId) => boxCode({ color, symbol });

/* ------------------------------------------------------------------ */
/* Static helpers                                                      */
/* ------------------------------------------------------------------ */

/** Coarse reachability report from the forklift start, treating resting boxes as obstacles. */
function coarseProblems(level: LevelData): string[] {
  const grid = new LevelGrid(level);
  const occupancy = occupancyOf(grid, stacksOf(grid, level));
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
      if (region[cell] !== 1 || grid.steps[cell] !== null) continue;
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
    const tallest = Math.max(stacks[cell].length, grid.steps[cell]?.length ?? 0);
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

/** Shortest plans, searched once per level for the tests below that need one. */
const shortest = new Map<string, ReturnType<typeof minMoves>>();
const shortestOf = (level: LevelData) => {
  let result = shortest.get(level.id);
  if (!result) shortest.set(level.id, (result = minMoves(level)));
  return result;
};
/** Chapters: classic (1–12), stacking (13–18), sorting by color + symbol (19–24). */
const SORTING = LEVELS.filter((l) => usesSymbols(l));
const CLASSIC = LEVELS.filter((l) => (l.stackLimit ?? 1) === 1 && !usesSymbols(l));
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
    // Invariants (the registry also refuses a repeated id or order across .level and .json files).
    expect(LEVELS.length).toBeGreaterThanOrEqual(12);
    // Strictly ascending also means unique, so the registry sort is deterministic.
    const orders = LEVELS.map((l) => l.order);
    expect(orders.every((o, i) => i === 0 || o > orders[i - 1])).toBe(true);
    expect(new Set(LEVELS.map((l) => l.id)).size).toBe(LEVELS.length);
    expect(new Set(LEVELS.map((l) => l.name)).size).toBe(LEVELS.length);
  });
});

/**
 * The shipped levels, by order. Saved best times, rankings, unlocks and "Continuar" are keyed by these ids (and the
 * order decides the play order), so this list only changes on purpose: adding, removing or re-ordering a level
 * means updating it here in the same change.
 */
const SHIPPED: readonly (readonly [number, string])[] = [
  [1, 'primer-encargo'],
  [2, 'dos-colores'],
  [3, 'rincon-tranquilo'],
  [4, 'pequeno-desorden'],
  [5, 'cruce-de-pasillos'],
  [6, 'un-toque-de-coral'],
  [7, 'estanterias-en-fila'],
  [8, 'una-cosa-lleva-a-otra'],
  [9, 'tarde-de-lavanda'],
  [10, 'mudanza-a-medias'],
  [11, 'pasillos-de-luz'],
  [12, 'el-gran-almacen'],
  [13, 'una-encima'],
  [14, 'primero-la-base'],
  [15, 'dos-pilas'],
  [16, 'al-reves'],
  [17, 'torre-de-tres'],
  [18, 'el-gran-apilado'],
  [19, 'lo-que-dice-la-tapa'],
  [20, 'color-o-forma'],
  [21, 'dos-sitios-posibles'],
  [22, 'justo-esa'],
  [23, 'la-muestra'],
  [24, 'el-gran-reparto'],
];

describe('level files (.level, docs/LEVELS.md)', () => {
  it('ships exactly the expected levels: ids and orders (saves are keyed by id)', () => {
    expect(LEVELS.map((l) => [l.order, l.id])).toEqual(SHIPPED);
  });

  it('every shipped level comes from its own .level file (the JSON sources are gone)', () => {
    const shipped = new Set(SHIPPED.map(([, id]) => id));
    const sources = LEVEL_SOURCES.filter((s) => shipped.has(s.level.id));
    expect(sources.map((s) => s.format)).toEqual(SHIPPED.map(() => 'level'));
    expect(new Set(sources.map((s) => s.file)).size).toBe(SHIPPED.length);
    expect(sources.every((s) => s.file.startsWith('src/data/levels/') && s.file.endsWith('.level'))).toBe(true);
  });

  it.each(LEVEL_SOURCES.map((s) => [s.file, s] as const))('%s: parse(render(level)) is the level again, and rendering is idempotent', (_, source) => {
    const text = renderLevel(source.level, source);
    const again = parseLevel(text, source.file);
    expect(again.level).toStrictEqual(source.level);
    expect(again.targets).toEqual(source.targets);
    expect(again.notes).toEqual(source.notes);
    expect(renderLevel(again.level, again)).toBe(text);
  });

  const declared = LEVEL_SOURCES.filter((s) => s.targets.length > 0);
  it(`difficulty targets («dificultad:», ${declared.length} levels declare some) are all proven by the measured metrics`, () => {
    for (const source of declared) {
      const failed = checkLevelTargets(source.level, source.targets).filter((c) => !c.ok);
      expect(failed.map((c) => `${formatTarget(c.target)}: medido ${formatRange(c.range)}`), source.file).toEqual([]);
    }
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

  // Three chapters: classic levels (no stacking), then stacking, then sorting by color + symbol; each starts small
  // again.
  const chapters = [CLASSIC, STACKING, SORTING] as const;

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

describe('sorting chapter (docs/SORTING.md)', () => {
  type Box = LevelData['boxes'][number];
  type Zone = LevelData['zones'][number];
  const fits = (zone: Zone, box: Box) => meets(criteriaOf(zone), sortableOf(box));
  const zonesFor = (level: LevelData, box: Box) => level.zones.filter((z) => fits(z, box));
  const ambiguous = (level: LevelData) => level.boxes.filter((b) => zonesFor(level, b).length > 1);
  const kinds = (level: LevelData) => new Set(level.zones.map((z) => matchKind(criteriaOf(z))));
  /** Every complete sorting (box index → zone index, one box per zone), by backtracking. */
  const sortings = (level: LevelData): number[][] => {
    const out: number[][] = [];
    const used = new Set<number>();
    const pick: number[] = [];
    const place = (b: number) => {
      if (b === level.boxes.length) return void out.push([...pick]);
      level.zones.forEach((zone, z) => {
        if (used.has(z) || !fits(zone, level.boxes[b])) return;
        used.add(z);
        pick.push(z);
        place(b + 1);
        pick.pop();
        used.delete(z);
      });
    };
    place(0);
    return out;
  };
  /** A box put in one of its zones that leaves the other boxes without a complete sorting (a trap, fixable by moving it). */
  const traps = (level: LevelData) =>
    level.boxes.flatMap((box, b) =>
      level.zones
        .filter((zone) => fits(zone, box))
        .filter((zone) => {
          const rest = level.boxes.filter((_, i) => i !== b).map(sortableOf);
          const open = level.zones.filter((z) => z !== zone).map(criteriaOf);
          return assignBoxes(rest, open).includes(-1);
        })
        .map((zone) => `${box.id}→${zone.id}`),
    );
  const box = (level: LevelData, color: ColorId, symbol: SymbolId) => {
    const found = level.boxes.find((b) => b.color === color && sortableOf(b).symbol === symbol);
    expect(found, `${color} ${symbol} box`).toBeDefined();
    return found!;
  };

  it('follows the stacking chapter: 6 levels that sort by color + symbol, none of them stacking', () => {
    expect(SORTING).toHaveLength(6);
    expect(LEVELS.indexOf(SORTING[0])).toBe(CLASSIC.length + STACKING.length);
    for (const l of SORTING) {
      expect(l.stackLimit).toBe(1);
      expect(l.boxes).toHaveLength(l.zones.length);
      expect(sortings(l).length, l.id).toBeGreaterThan(0);
    }
  });

  it('19 sorts by symbol alone: neutral pads, and two boxes of one color go to different zones', () => {
    const [first] = SORTING;
    expect(kinds(first)).toEqual(new Set(['symbol']));
    expect(first.zones.every((z) => z.color === undefined)).toBe(true);
    const sameColor = first.boxes.filter((b, i) => first.boxes.some((o, j) => j !== i && o.color === b.color));
    expect(new Set(sameColor.map((b) => zonesFor(first, b)[0].id)).size).toBeGreaterThan(1);
    for (const b of first.boxes) expect(zonesFor(first, b)).toHaveLength(1);
  });

  it('20 mixes color zones and symbol zones, and every box still fits exactly one zone', () => {
    const level = SORTING[1];
    expect(kinds(level)).toEqual(new Set(['color', 'symbol']));
    for (const b of level.boxes) expect(zonesFor(level, b), b.id).toHaveLength(1);
  });

  it('21 brings the first box that fits two zones, and where it goes matters a little', () => {
    for (const l of SORTING.slice(0, 2)) expect(ambiguous(l), l.id).toEqual([]);
    const level = SORTING[2];
    expect(ambiguous(level)).toHaveLength(1);
    expect(traps(level).length).toBeGreaterThan(0);
    expect(sortings(level)).toHaveLength(1);
  });

  it('22 asks for exact boxes: color and symbol, each shared with another zone', () => {
    const level = SORTING[3];
    expect(kinds(level)).toEqual(new Set(['exact']));
    for (const b of level.boxes) {
      expect(zonesFor(level, b), b.id).toHaveLength(1);
      // Near misses: another pad has its color, another engraving its symbol.
      expect(level.zones.some((z) => z.color === b.color && !fits(z, b))).toBe(true);
      expect(level.zones.some((z) => z.symbol === sortableOf(b).symbol && !fits(z, b))).toBe(true);
    }
  });

  it('23 is the sample: two "any ▲", one "any blue", one exact "blue ■"; one complete sorting and the classic trap', () => {
    const level = SORTING[4];
    const anyTriangle = level.zones.filter((z) => z.symbol === 'triangle' && z.color === undefined);
    const anyBlue = level.zones.filter((z) => z.color === 'blue' && z.symbol === undefined);
    const exact = level.zones.filter((z) => z.color === 'blue' && z.symbol === 'square');
    expect([anyTriangle.length, anyBlue.length, exact.length, level.zones.length]).toEqual([2, 1, 1, 4]);
    const blueTriangle = box(level, 'blue', 'triangle');
    const blueSquare = box(level, 'blue', 'square');
    const mintTriangle = box(level, 'mint', 'triangle');
    const blueCircle = box(level, 'blue', 'circle');
    expect(level.boxes).toHaveLength(4);
    // The one complete sorting (up to the two identical ▲ zones).
    const index = (b: Box) => level.boxes.indexOf(b);
    for (const s of sortings(level)) {
      expect(level.zones[s[index(blueSquare)]]).toBe(exact[0]);
      expect(level.zones[s[index(blueCircle)]]).toBe(anyBlue[0]);
      expect(anyTriangle).toContain(level.zones[s[index(blueTriangle)]]);
      expect(anyTriangle).toContain(level.zones[s[index(mintTriangle)]]);
    }
    // The gentle trap: blue ▲ (or blue ■) in "any blue" leaves blue ● without a zone.
    expect(traps(level)).toContain(`${blueTriangle.id}→${anyBlue[0].id}`);
    expect(traps(level)).toContain(`${blueSquare.id}→${anyBlue[0].id}`);
    // Easy to see: the forklift starts facing blue ▲, and "any blue" lies straight on beyond it.
    const f = forwardOf(degToRad(level.forklift.heading));
    const ahead = (p: { x: number; z: number }, d: number) =>
      p.x === level.forklift.x + Math.round(f.x) * d && p.z === level.forklift.z + Math.round(f.z) * d;
    expect([1, 2, 3].some((d) => ahead(blueTriangle, d))).toBe(true);
    expect([4, 5, 6, 7].some((d) => ahead(anyBlue[0], d))).toBe(true);
  });

  it('24 closes the chapter: every kind of zone, several ambiguous boxes, one complete sorting', () => {
    const last = SORTING[5];
    expect(kinds(last)).toEqual(new Set(['color', 'symbol', 'exact']));
    expect(ambiguous(last).length).toBeGreaterThanOrEqual(2);
    expect(sortings(last)).toHaveLength(1);
    expect(last.shelves.length).toBeGreaterThan(0);
  });

  it.each(SORTING.map((l) => [l.id, l] as const))('%s: the start heading faces a box straight ahead', (_, level) => {
    const f = forwardOf(degToRad(level.forklift.heading));
    const ahead = [1, 2, 3, 4].map((d) => ({ x: level.forklift.x + Math.round(f.x) * d, z: level.forklift.z + Math.round(f.z) * d }));
    expect(level.boxes.some((b) => ahead.some((c) => c.x === b.x && c.z === b.z))).toBe(true);
  });

  it.each(SORTING.map((l) => [l.id, l] as const))('%s never starts with a box hiding the engraving of a symbol zone that does not take it', (_, level) => {
    // A box on a pad hides its engraving (docs/SORTING.md): only colour pads may start covered by a wrong box.
    for (const z of level.zones.filter((zone) => zone.symbol !== undefined)) {
      const onIt = level.boxes.filter((b) => b.x === z.x && b.z === z.z);
      for (const b of onIt) expect(fits(z, b), `${b.id} on ${z.id}`).toBe(true);
    }
  });

  it.each(SORTING.map((l) => [l.id, l] as const))('%s flows away from the camera', (_, level) => {
    // The camera sits toward +x / +z: driving away keeps A/D reading as screen left / right. Every zone lies further
    // from the camera than the forklift starts, so each delivery heads up the screen.
    const f = forwardOf(degToRad(level.forklift.heading));
    expect(f.x + f.z).toBeLessThan(0);
    for (const z of level.zones) expect(z.x + z.z, z.id).toBeLessThan(level.forklift.x + level.forklift.z);
  });

  it('solver model: a trap ranks one step worse until the ambiguous box moves on', () => {
    const level = SORTING[4];
    const grid = new LevelGrid(level);
    const at = (z: Zone) => grid.index(z.x, z.z);
    const [tri1, tri2] = level.zones.filter((z) => z.symbol === 'triangle');
    const anyBlue = level.zones.find((z) => z.color === 'blue' && z.symbol === undefined)!;
    const exact = level.zones.find((z) => z.symbol === 'square')!;
    const stacks: Stacks = new Array<string>(grid.cellCount).fill('');
    stacks[at(anyBlue)] = code('blue', 'triangle');
    stacks[at(exact)] = code('blue', 'square');
    stacks[at(tri1)] = code('mint', 'triangle');
    const blueCircle = box(level, 'blue', 'circle');
    stacks[grid.index(blueCircle.x, blueCircle.z)] = code('blue', 'circle');
    expect(sortable(grid, stacks)).toBe(false);
    // Blue ▲ moved on to the free ▲ zone: blue ● has its zone again.
    stacks[at(anyBlue)] = '';
    stacks[at(tri2)] = code('blue', 'triangle');
    expect(sortable(grid, stacks)).toBe(true);
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
  it('solver model: turning while carrying needs two cells of clearance, even with the reverse gear', () => {
    for (const reverse of [true, false]) {
      expect(solve(corridorLevel(3), { allowParking: true, maxExpansions: 200, reverse }).solved).toBe(false);
      expect(solve(corridorLevel(4), { allowParking: true, maxExpansions: 200, reverse })).toMatchObject({ solved: true, moves: 1 });
    }
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s: every box and zone is reachable from the start', (_, level) => {
    expect(coarseProblems(level)).toEqual([]);
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s: can be solved with the conservative carrying model', (_, level) => {
    // The greedy search and the exact search's plan, replayed move by move.
    expect(solve(level, { allowParking: true, maxExpansions: 2000 }).solved).toBe(true);
    const result = shortestOf(level);
    expect(result.unsolvable).toBe(false);
    expect(result.plan).not.toBeNull();
    expect(replayMoves(level, result.plan!)).toBe(true);
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))('%s: no dead ends («callejones»): every slip along a shortest plan can be undone', (_, level) => {
    // Every state of a shortest plan is expanded: all the moves a player could make there are checked, and each one
    // can be undone with the reverse gear (the box carried back, the forklift back in the same region), so the level
    // can always still be finished. docs/LEVELS.md, «callejones».
    const plan = shortestOf(level).plan!;
    const result = deadEnds(level, { plan, maxStates: plan.length + 1 });
    expect(result.explored).toBe(plan.length + 1);
    expect(result).toMatchObject({ found: 0, unknown: 0, deepChecks: 0 });
    expect(result.checked).toBeGreaterThan(result.explored);
  });
});
