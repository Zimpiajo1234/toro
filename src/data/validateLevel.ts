import {
  BOX_KINDS,
  COLOR_IDS,
  SYMBOL_IDS,
  cellKey,
  type BoxKind,
  type ColorId,
  type LevelBox,
  type LevelData,
  type LevelShelf,
  type LevelZone,
  type SymbolId,
  type WallSide,
} from '../core/types';
import { assignBoxes, criteriaOf, meets, sortableOf, usesSymbols, type Sortable } from '../core/sorting';
import { GAME_CONFIG } from '../config';

/**
 * Parses and validates a raw level object (from a .level file via asciiLevel.parseLevel, or a legacy JSON level) into
 * a fully-defaulted LevelData. Throws a descriptive Error on the first problem found, so authoring mistakes surface
 * at load / test time (parseLevel re-words these in Spanish at the file position to fix).
 */
export function validateLevel(raw: unknown, source = 'level'): LevelData {
  const fail = (msg: string): never => {
    throw new Error(`[${source}] ${msg}`);
  };
  const obj = (v: unknown, what: string): Record<string, unknown> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : fail(`${what} must be an object`);
  const int = (v: unknown, what: string): number =>
    typeof v === 'number' && Number.isInteger(v) ? v : fail(`${what} must be an integer`);
  const num = (v: unknown, what: string): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fail(`${what} must be a number`);
  const str = (v: unknown, what: string): string =>
    typeof v === 'string' && v.length > 0 ? v : fail(`${what} must be a non-empty string`);
  const arr = (v: unknown, what: string): unknown[] =>
    v === undefined ? [] : Array.isArray(v) ? v : fail(`${what} must be an array`);
  const color = (v: unknown, what: string): ColorId =>
    (COLOR_IDS as readonly string[]).includes(v as string) ? (v as ColorId) : fail(`${what} has unknown color "${String(v)}"`);
  const symbol = (v: unknown, what: string): SymbolId =>
    (SYMBOL_IDS as readonly string[]).includes(v as string) ? (v as SymbolId) : fail(`${what} has unknown symbol "${String(v)}"`);

  const r = obj(raw, 'level');
  const id = str(r.id, 'id');
  const order = num(r.order, 'order');
  const name = str(r.name, 'name');
  const sizeRaw = obj(r.size, 'size');
  const width = int(sizeRaw.width, 'size.width');
  const depth = int(sizeRaw.depth, 'size.depth');
  if (width < 3 || depth < 3 || width > 40 || depth > 40) fail('size must be between 3 and 40 cells per side');

  const inBounds = (x: number, z: number) => x >= 0 && z >= 0 && x < width && z < depth;

  // Shelves (obstacles)
  const blocked = new Set<string>();
  const shelves: LevelShelf[] = arr(r.shelves, 'shelves').map((s, i) => {
    const o = obj(s, `shelves[${i}]`);
    const shelf: LevelShelf = {
      x: int(o.x, `shelves[${i}].x`),
      z: int(o.z, `shelves[${i}].z`),
      w: int(o.w, `shelves[${i}].w`),
      d: int(o.d, `shelves[${i}].d`),
      tiers: o.tiers === undefined ? 2 : int(o.tiers, `shelves[${i}].tiers`),
    };
    if (shelf.w < 1 || shelf.d < 1) fail(`shelves[${i}] must be at least 1×1`);
    for (let x = shelf.x; x < shelf.x + shelf.w; x++)
      for (let z = shelf.z; z < shelf.z + shelf.d; z++) {
        if (!inBounds(x, z)) fail(`shelves[${i}] leaves the warehouse at ${x},${z}`);
        const k = cellKey({ x, z });
        if (blocked.has(k)) fail(`shelves[${i}] overlaps another obstacle at ${k}`);
        blocked.add(k);
      }
    return shelf;
  });

  // Decor
  const decorRaw = r.decor === undefined ? {} : obj(r.decor, 'decor');
  const plants = arr(decorRaw.plants, 'decor.plants').map((p, i) => {
    const o = obj(p, `decor.plants[${i}]`);
    const plant = {
      x: int(o.x, `decor.plants[${i}].x`),
      z: int(o.z, `decor.plants[${i}].z`),
      variant: o.variant === undefined ? i : int(o.variant, `decor.plants[${i}].variant`),
    };
    if (!inBounds(plant.x, plant.z)) fail(`decor.plants[${i}] out of bounds`);
    const k = cellKey(plant);
    if (blocked.has(k)) fail(`decor.plants[${i}] overlaps an obstacle at ${k}`);
    blocked.add(k);
    return plant;
  });
  const windows = arr(decorRaw.windows, 'decor.windows').map((w, i) => {
    const o = obj(w, `decor.windows[${i}]`);
    const wall = o.wall === 'north' || o.wall === 'west' ? (o.wall as WallSide) : fail(`decor.windows[${i}].wall must be "north" or "west"`);
    const at = int(o.at, `decor.windows[${i}].at`);
    const ww = int(o.width, `decor.windows[${i}].width`);
    const len = wall === 'north' ? width : depth;
    if (at < 0 || ww < 1 || at + ww > len) fail(`decor.windows[${i}] does not fit on the ${wall} wall`);
    return { wall, at, width: ww };
  });

  // Forklift
  const f = obj(r.forklift, 'forklift');
  const forklift = {
    x: int(f.x, 'forklift.x'),
    z: int(f.z, 'forklift.z'),
    heading: f.heading === undefined ? 0 : num(f.heading, 'forklift.heading'),
  };
  if (!inBounds(forklift.x, forklift.z)) fail('forklift starts out of bounds');
  if (blocked.has(cellKey(forklift))) fail('forklift starts inside an obstacle');

  // Zones: each declares what it accepts (a color, a symbol, or both) and optionally a color recipe to stack.
  const zoneIds = new Set<string>();
  const zoneCells = new Set<string>();
  const zones: LevelZone[] = arr(r.zones, 'zones').map((z, i) => {
    const o = obj(z, `zones[${i}]`);
    const zoneColor = o.color === undefined ? undefined : color(o.color, `zones[${i}]`);
    const zoneSymbol = o.symbol === undefined ? undefined : symbol(o.symbol, `zones[${i}]`);
    if (zoneColor === undefined && zoneSymbol === undefined) fail(`zones[${i}] must accept something: give it a color, a symbol or both`);
    let recipe: ColorId[] | undefined;
    if (o.recipe !== undefined) {
      recipe = arr(o.recipe, `zones[${i}].recipe`).map((c, j) => color(c, `zones[${i}].recipe[${j}]`));
      if (recipe.length === 0) fail(`zones[${i}].recipe must not be empty`);
      if (recipe[0] !== zoneColor) fail(`zones[${i}].color must equal recipe[0] (the bottom box)`);
      if (zoneSymbol !== undefined && recipe.length > 1) fail(`zones[${i}] asks for a symbol and a stack: recipes are color-only`);
    }
    const zone: LevelZone = {
      id: str(o.id, `zones[${i}].id`),
      ...(zoneColor === undefined ? {} : { color: zoneColor }),
      ...(zoneSymbol === undefined ? {} : { symbol: zoneSymbol }),
      x: int(o.x, `zones[${i}].x`),
      z: int(o.z, `zones[${i}].z`),
      ...(recipe === undefined ? {} : { recipe }),
    };
    if (zoneIds.has(zone.id)) fail(`duplicate zone id "${zone.id}"`);
    zoneIds.add(zone.id);
    if (!inBounds(zone.x, zone.z)) fail(`zone "${zone.id}" out of bounds`);
    const k = cellKey(zone);
    if (blocked.has(k)) fail(`zone "${zone.id}" is inside an obstacle`);
    if (zoneCells.has(k)) fail(`two zones share cell ${k}`);
    if (k === cellKey(forklift)) fail(`zone "${zone.id}" is under the forklift start`);
    zoneCells.add(k);
    return zone;
  });
  if (zones.length === 0) fail('a level needs at least one zone');

  // Boxes. Several boxes on one cell form a stack, bottom → top in list order.
  const boxIds = new Set<string>();
  const stacks = new Map<string, Sortable[]>();
  const boxes: LevelBox[] = arr(r.boxes, 'boxes').map((b, i) => {
    const o = obj(b, `boxes[${i}]`);
    const kind: BoxKind =
      o.kind === undefined
        ? 'standard'
        : (BOX_KINDS as readonly string[]).includes(o.kind as string)
          ? (o.kind as BoxKind)
          : fail(`boxes[${i}] has unknown kind "${String(o.kind)}"`);
    const box: LevelBox = {
      id: str(o.id, `boxes[${i}].id`),
      color: color(o.color, `boxes[${i}]`),
      ...(o.symbol === undefined ? {} : { symbol: symbol(o.symbol, `boxes[${i}]`) }),
      x: int(o.x, `boxes[${i}].x`),
      z: int(o.z, `boxes[${i}].z`),
      kind,
    };
    if (boxIds.has(box.id)) fail(`duplicate box id "${box.id}"`);
    boxIds.add(box.id);
    if (!inBounds(box.x, box.z)) fail(`box "${box.id}" out of bounds`);
    const k = cellKey(box);
    if (blocked.has(k)) fail(`box "${box.id}" is inside an obstacle`);
    if (k === cellKey(forklift)) fail(`box "${box.id}" is under the forklift start`);
    const stack = stacks.get(k);
    if (stack) stack.push(sortableOf(box));
    else stacks.set(k, [sortableOf(box)]);
    return box;
  });

  // Stack limit: explicit, else the global max when the level uses stacking at all, else 1 (classic levels).
  const recipeOf = (zone: LevelZone): readonly (ColorId | undefined)[] => zone.recipe ?? [zone.color];
  const tallestRecipe = Math.max(...zones.map((zone) => recipeOf(zone).length));
  const tallestStart = Math.max(0, ...[...stacks.values()].map((st) => st.length));
  const stacking = tallestRecipe > 1 || tallestStart > 1;
  const stackLimit =
    r.stackLimit === undefined ? (stacking ? GAME_CONFIG.stack.maxHeight : 1) : int(r.stackLimit, 'stackLimit');
  if (stackLimit < 1 || stackLimit > GAME_CONFIG.stack.maxHeight)
    fail(`stackLimit must be between 1 and ${GAME_CONFIG.stack.maxHeight}`);
  if (tallestRecipe > stackLimit) fail(`a zone recipe is taller than stackLimit ${stackLimit}`);
  for (const [k, st] of stacks) {
    if (st.length > stackLimit) fail(stackLimit === 1 ? `two boxes share cell ${k}` : `stack at ${k} is taller than stackLimit ${stackLimit}`);
  }

  if (usesSymbols({ boxes, zones })) {
    // Sorting by symbol (docs/SORTING.md): not combined with stacks yet, one box per zone, and some complete sorting
    // box → accepting zone must exist (ambiguous boxes are fine: several zones may accept the same box).
    if (stacking || stackLimit > 1) fail('a level that sorts by symbol does not stack yet: stackLimit 1, no recipes, no stacked starts');
    if (boxes.length !== zones.length)
      fail(`a level that sorts by symbol needs one box per zone (${boxes.length} boxes, ${zones.length} zones)`);
    const assignment = assignBoxes(boxes.map(sortableOf), zones.map(criteriaOf));
    const stranded = assignment.indexOf(-1);
    if (stranded >= 0) fail(`no complete sorting exists: box "${boxes[stranded].id}" is always left without a zone`);
  } else {
    // Box colors must be exactly the colors the recipes ask for (as a multiset).
    const count = new Map<ColorId, number>();
    for (const b of boxes) count.set(b.color, (count.get(b.color) ?? 0) + 1);
    for (const zone of zones) for (const c of recipeOf(zone)) if (c !== undefined) count.set(c, (count.get(c) ?? 0) - 1);
    for (const [c, n] of count) if (n !== 0) fail(`color "${c}" has ${n > 0 ? 'more boxes than zones' : 'more zones than boxes'}`);
  }

  // Must not start solved: every zone holding exactly what it asks for (an accepted bottom box, then its recipe).
  const solved = zones.every((zone) => {
    const recipe = recipeOf(zone);
    const st = stacks.get(cellKey(zone));
    return (
      st !== undefined &&
      st.length === recipe.length &&
      st.every((box, i) => (i === 0 ? meets(criteriaOf(zone), box) : box.color === recipe[i]))
    );
  });
  if (solved) fail('level starts already solved');

  return {
    id,
    order,
    name,
    size: { width, depth },
    forklift,
    boxes,
    zones,
    shelves,
    decor: { plants, windows },
    stackLimit,
    theme: typeof r.theme === 'string' && r.theme ? r.theme : 'default',
  };
}
