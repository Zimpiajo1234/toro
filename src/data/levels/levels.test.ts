import { describe, expect, it } from 'vitest';
import { COLOR_IDS, forwardOf, type ColorId, type LevelData, type SymbolId } from '../../core/types';
import { degToRad } from '../../core/math';
import { usesSymbols } from '../../core/sorting';
import { parseLevel, renderLevel } from '../asciiLevel';
import { formatRange, formatTarget } from '../difficulty';
import { validateLevel } from '../validateLevel';
import { LEVELS, LEVEL_SOURCES, SPECIAL_LEVEL_SOURCES } from './index';
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
 *
 * Levels 4–24 were removed (2026-09-30) to be redone. The systems they used (stack recipes, symbols, racks) stay in the
 * game: their checks here run on small layouts written inline, and the generic checks run over every shipped level.
 */

const code = (color: ColorId, symbol: SymbolId) => boxCode({ color, symbol });

/** An inline layout in the .level format (docs/LEVELS.md). */
const layout = (lines: readonly string[]) => parseLevel(`${lines.join('\n')}\n`).level;

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
/**
 * Chapters: classic (no stacking, no symbols), stacking, sorting by color + symbol; each starts small again. Today only
 * classic levels ship (levels 4–24 are being redone), so the other two are empty.
 */
const CLASSIC = LEVELS.filter((l) => (l.stackLimit ?? 1) === 1 && !usesSymbols(l));
const STACKING = LEVELS.filter((l) => (l.stackLimit ?? 1) > 1);
const SORTING = LEVELS.filter((l) => usesSymbols(l));
const CHAPTERS = [CLASSIC, STACKING, SORTING].filter((chapter) => chapter.length > 0);

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

/** Two boxes on each other's zones, a third one waiting (the layout of the former level 4, «Pequeño desorden»). */
const DISORDER = layout([
  '# 4 · Pequeño desorden',
  'id: pequeno-desorden',
  'limit: 1',
  'ventanas: norte 3-5',
  '',
  '  012345678',
  '0 pHH...HHp',
  '1 .........',
  '2 ...123...',
  '3 .........',
  '4 .........',
  '5 .a.......',
  '6 ....^....',
  '',
  '1 = zona azul + caja amarillo      2 = zona menta',
  '3 = zona amarillo + caja azul',
  'a = caja menta',
  'H = estantería 3 alturas',
]);

/** A zone covered by the wrong box whose own zone is free: choosing the order is enough (a chain). */
const CHAIN = layout([
  '# 5 · Cadena',
  'id: cadena',
  'limit: 1',
  '',
  '  0123456',
  '0 .......',
  '1 .1...2.',
  '2 .......',
  '3 ...a...',
  '4 .......',
  '5 ...^...',
  '',
  '1 = zona azul + caja menta      2 = zona menta',
  'a = caja azul',
]);

/**
 * The sorting sample (the former level 23, «La muestra», docs/SORTING.md): two «any ▲» zones, one «any blue», one exact
 * «blue ■»; one complete sorting and the classic trap (blue ▲ in «any blue» leaves blue ● without a zone).
 */
const SAMPLE = layout([
  '# 23 · La muestra',
  'id: la-muestra',
  'limit: 1',
  'ventanas: norte 2-4, oeste 3-4',
  '',
  '  0123456789',
  '0 p.........',
  '1 .1.2.3.4..',
  '2 ..........',
  '3 ..........',
  '4 ....b..a..',
  '5 ..c.......',
  '6 .....d.^.p',
  '',
  '1 2 = zona ▲        3 = zona azul ■     4 = zona azul',
  'a = caja azul ▲     b = caja azul ■     c = caja menta ▲    d = caja azul ●',
]);

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('level registry', () => {
  it('ships validated levels with unique ids and strictly ascending orders', () => {
    // Invariants (the registry also refuses a repeated id or order across .level and .json files).
    expect(LEVELS.length).toBeGreaterThanOrEqual(1);
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
 * means updating it here in the same change. Levels 4–24 were removed on 2026-09-30 to be redone (saves that name
 * them still load: src/storage/ProgressStore.test.ts, src/game/Game.test.ts).
 */
const SHIPPED: readonly (readonly [number, string])[] = [
  [1, 'primer-encargo'],
  [2, 'dos-colores'],
  [3, 'rincon-tranquilo'],
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

  // The special levels (especiales/, outside LEVELS) keep the same canonical form.
  const everyFile = [...LEVEL_SOURCES, ...SPECIAL_LEVEL_SOURCES];
  it.each(everyFile.map((s) => [s.file, s] as const))('%s: parse(render(level)) is the level again, and rendering is idempotent', (_, source) => {
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

  it('box count never decreases within a chapter and stays within 10', () => {
    for (const chapter of CHAPTERS) {
      const counts = chapter.map((l) => l.boxes.length);
      for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
      expect(Math.max(...counts)).toBeLessThanOrEqual(10);
    }
    expect(CLASSIC.map((l) => l.boxes.length).slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('warehouses grow gently within a chapter, up to 14×11', () => {
    for (const chapter of CHAPTERS) {
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
    expect(colorsOf(LEVELS[1])).toEqual(new Set(['blue', 'mint']));
    expect(colorsOf(LEVELS[2]).has('yellow')).toBe(true);
  });

  it('introduces the first shelf on level 3', () => {
    expect(LEVELS[0].shelves).toHaveLength(0);
    expect(LEVELS[1].shelves).toHaveLength(0);
    expect(LEVELS[2].shelves.length).toBeGreaterThan(0);
  });
});

describe('stacks and sorting in the grid model (docs/STACKING.md, docs/SORTING.md)', () => {
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

  it('solver model: a trap ranks one step worse until the ambiguous box moves on', () => {
    const grid = new LevelGrid(SAMPLE);
    const at = (z: { x: number; z: number }) => grid.index(z.x, z.z);
    const [tri1, tri2] = SAMPLE.zones.filter((z) => z.symbol === 'triangle');
    const anyBlue = SAMPLE.zones.find((z) => z.color === 'blue' && z.symbol === undefined)!;
    const exact = SAMPLE.zones.find((z) => z.symbol === 'square')!;
    const stacks: Stacks = new Array<string>(grid.cellCount).fill('');
    stacks[at(anyBlue)] = code('blue', 'triangle');
    stacks[at(exact)] = code('blue', 'square');
    stacks[at(tri1)] = code('mint', 'triangle');
    const blueCircle = SAMPLE.boxes.find((b) => b.color === 'blue' && b.symbol === 'circle')!;
    stacks[at(blueCircle)] = code('blue', 'circle');
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
  it('boxes starting on each other\'s zones need a temporary park', () => {
    expect(misplacedBoxes(DISORDER).length).toBeGreaterThan(0);
    expect(solve(DISORDER, { allowParking: false, maxExpansions: 500 }).solved).toBe(false);
    expect(solve(DISORDER, { allowParking: true, maxExpansions: 500 }).solved).toBe(true);
  });

  it('a chain: a zone blocked by a wrong box, solvable just by choosing the order', () => {
    expect(blockedZones(CHAIN).map((z) => z.id)).toEqual(['z1']);
    expect(solve(CHAIN, { allowParking: false, maxExpansions: 500 }).solved).toBe(true);
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
