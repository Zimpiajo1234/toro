import {
  BOX_KINDS,
  COLOR_IDS,
  FACINGS,
  MAX_RACK_SLOTS,
  MAX_TRUCK_COLUMNS,
  MAX_TRUCK_LEVELS,
  SYMBOL_IDS,
  cellKey,
  type BoxKind,
  type ColorId,
  type Facing,
  type LevelBox,
  type LevelData,
  type LevelRack,
  type LevelShelf,
  type LevelTruck,
  type LevelZone,
  type RackSlot,
  type SymbolId,
  type TruckCue,
  type WallSide,
} from '../core/types';
import {
  assignBoxes,
  assignmentsOf,
  criteriaOf,
  meets,
  sameKind,
  sortableOf,
  targetsOf,
  usesSymbols,
  type Sortable,
} from '../core/sorting';
import { frontCellOf, rackCellOf } from '../core/racks';
import { truckCellOf, truckFrontOf } from '../core/docks';
import { GAME_CONFIG } from '../config';

/**
 * A target named in validation messages: `zones[i]`, `racks[i].columns[j][k]` or `trucks[i].columns[j][k]` (asciiLevel
 * places it on the map).
 */
function targetName(target: { kind: 'zone' | 'slot' | 'truck'; index: number }, slotNames: readonly string[], truckSlotNames: readonly string[]): string {
  return target.kind === 'zone' ? `zones[${target.index}]` : target.kind === 'slot' ? slotNames[target.index] : truckSlotNames[target.index];
}

/** How validation messages name a box kind: "blue/circle". */
const kindName = (box: Sortable) => `${box.color}/${box.symbol}`;

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

  // Storage racks (docs/RACKS.md): 1 cell deep, one column per cell, 1–3 slots per column, loaded from the front.
  const rackIds = new Set<string>();
  /** Rack cell key → [rack index, column]. */
  const rackCells = new Map<string, [number, number]>();
  /** Name of each slot for messages, in core/racks `slotsOf` order. */
  const slotNames: string[] = [];
  const racks: LevelRack[] = arr(r.racks, 'racks').map((x, i) => {
    const o = obj(x, `racks[${i}]`);
    const facing = (FACINGS as readonly string[]).includes(o.facing as string)
      ? (o.facing as Facing)
      : fail(`racks[${i}].facing must be north, east, south or west`);
    const columnsRaw = arr(o.columns, `racks[${i}].columns`);
    if (columnsRaw.length === 0) fail(`racks[${i}] needs at least one column`);
    const columns: RackSlot[][] = columnsRaw.map((c, j) => {
      const slots = arr(c, `racks[${i}].columns[${j}]`);
      if (slots.length < 1 || slots.length > MAX_RACK_SLOTS) fail(`racks[${i}].columns[${j}] must have 1 to ${MAX_RACK_SLOTS} slots`);
      return slots.map((s, k) => {
        const so = obj(s, `racks[${i}].columns[${j}][${k}]`);
        const slot: RackSlot = {
          ...(so.color === undefined ? {} : { color: color(so.color, `racks[${i}].columns[${j}][${k}]`) }),
          ...(so.symbol === undefined ? {} : { symbol: symbol(so.symbol, `racks[${i}].columns[${j}][${k}]`) }),
        };
        slotNames.push(`racks[${i}].columns[${j}][${k}]`);
        return slot;
      });
    });
    const rack: LevelRack = {
      id: o.id === undefined ? `r${i + 1}` : str(o.id, `racks[${i}].id`),
      x: int(o.x, `racks[${i}].x`),
      z: int(o.z, `racks[${i}].z`),
      w: o.w === undefined ? columns.length : int(o.w, `racks[${i}].w`),
      facing,
      columns,
    };
    if (rack.w !== columns.length) fail(`racks[${i}].w must equal its number of columns (${columns.length})`);
    if (rackIds.has(rack.id)) fail(`duplicate rack id "${rack.id}"`);
    rackIds.add(rack.id);
    columns.forEach((_, j) => {
      const cell = rackCellOf(rack, j);
      if (!inBounds(cell.x, cell.z)) fail(`racks[${i}] leaves the warehouse at ${cell.x},${cell.z}`);
      const k = cellKey(cell);
      if (blocked.has(k)) fail(`racks[${i}] overlaps another obstacle at ${k}`);
      blocked.add(k);
      rackCells.set(k, [i, j]);
    });
    return rack;
  });
  const hasRacks = racks.length > 0;

  // Loading docks (docs/DOCKS.md): a dock door is a straight run of door cells against the north (z = 0) or west
  // (x = 0) wall, one bed column per door cell (1–MAX_TRUCK_COLUMNS), 1–MAX_TRUCK_LEVELS levels per column, every level
  // with a cue. The door cells are floor, free of furniture (and of zones, boxes and the forklift at the start: checked
  // below); the bed columns lie outside the map, just beyond the wall, and are loaded through the door from them.
  const truckIds = new Set<string>();
  /** Bed cell key (outside the map) → [truck index, column]. */
  const truckCells = new Map<string, [number, number]>();
  /** Door cell key → [truck index, column]. */
  const doorCells = new Map<string, [number, number]>();
  /** Name of each truck slot for messages, in core/docks `truckSlotsOf` order. */
  const truckSlotNames: string[] = [];
  const trucks: LevelTruck[] = arr(r.trucks, 'trucks').map((x, i) => {
    const o = obj(x, `trucks[${i}]`);
    const wall = o.wall === 'north' || o.wall === 'west' ? (o.wall as WallSide) : fail(`trucks[${i}].wall must be "north" or "west"`);
    const columnsRaw = arr(o.columns, `trucks[${i}].columns`);
    if (columnsRaw.length === 0) fail(`trucks[${i}] needs at least one column`);
    const columns: TruckCue[][] = columnsRaw.map((c, j) => {
      const levels = arr(c, `trucks[${i}].columns[${j}]`);
      if (levels.length < 1 || levels.length > MAX_TRUCK_LEVELS) fail(`trucks[${i}].columns[${j}] must have 1 to ${MAX_TRUCK_LEVELS} levels`);
      return levels.map((s, k) => {
        const what = `trucks[${i}].columns[${j}][${k}]`;
        const so = obj(s, what);
        const cue: TruckCue = {
          ...(so.color === undefined ? {} : { color: color(so.color, what) }),
          ...(so.symbol === undefined ? {} : { symbol: symbol(so.symbol, what) }),
        };
        if (cue.color === undefined && cue.symbol === undefined) fail(`${what} must ask for something: a truck level has a color, a symbol or both`);
        truckSlotNames.push(what);
        return cue;
      });
    });
    const truck: LevelTruck = {
      id: o.id === undefined ? `t${i + 1}` : str(o.id, `trucks[${i}].id`),
      wall,
      x: int(o.x, `trucks[${i}].x`),
      z: int(o.z, `trucks[${i}].z`),
      w: o.w === undefined ? columns.length : int(o.w, `trucks[${i}].w`),
      columns,
    };
    if (truck.w !== columns.length) fail(`trucks[${i}].w must equal its number of columns (${columns.length})`);
    if (columns.length > MAX_TRUCK_COLUMNS) fail(`trucks[${i}] has ${columns.length} columns, more than ${MAX_TRUCK_COLUMNS}: its dock door is 1 to ${MAX_TRUCK_COLUMNS} cells wide`);
    if (wall === 'north' && truck.z !== 0) fail(`trucks[${i}] is in the north wall: its door cells run along row z = 0`);
    if (wall === 'west' && truck.x !== 0) fail(`trucks[${i}] is in the west wall: its door cells run along column x = 0`);
    if (truckIds.has(truck.id)) fail(`duplicate truck id "${truck.id}"`);
    if (rackIds.has(truck.id)) fail(`trucks[${i}] has the id "${truck.id}" of a rack: racks and trucks never share an id`);
    truckIds.add(truck.id);
    columns.forEach((_, j) => {
      const door = truckFrontOf(truck, j);
      if (!inBounds(door.x, door.z)) fail(`trucks[${i}] leaves the warehouse at ${door.x},${door.z}`);
      const k = cellKey(door);
      // The door cells stay floor (the forklift stands there to load): no shelf, plant, rack or other dock door.
      if (blocked.has(k) || doorCells.has(k)) fail(`trucks[${i}] overlaps another obstacle at ${k}`);
      doorCells.set(k, [i, j]);
      truckCells.set(cellKey(truckCellOf(truck, j)), [i, j]);
    });
    return truck;
  });
  const hasTrucks = trucks.length > 0;
  // Every rack column is loaded from its front cell: floor, whatever else stands around (a dock's door cell too).
  racks.forEach((rack, i) => {
    rack.columns.forEach((_, j) => {
      const front = frontCellOf(rack, j);
      if (!inBounds(front.x, front.z) || blocked.has(cellKey(front)))
        fail(`racks[${i}] column ${j} has no room in front: cell ${front.x},${front.z} is a wall, a shelf, a plant or another rack`);
    });
  });
  /** The dock door a cell is in front of, as messages name it, or null. */
  const doorAt = (k: string): string | null => {
    const at = doorCells.get(k);
    return at ? `the dock door of trucks[${at[0]}] (column ${at[1]})` : null;
  };
  // The dock door is the truck's run along its wall: no window on it.
  windows.forEach((win, i) => {
    trucks.forEach((truck, j) => {
      const start = truck.wall === 'north' ? truck.x : truck.z;
      if (win.wall === truck.wall && win.at < start + truck.w && start < win.at + win.width) fail(`decor.windows[${i}] overlaps the dock door of trucks[${j}]`);
    });
  });
  /** Levels with racks or trucks follow the target rules of docs/RACKS.md (docs/DOCKS.md rule 10). */
  const targetRules = hasRacks || hasTrucks;

  // Forklift
  const f = obj(r.forklift, 'forklift');
  const forklift = {
    x: int(f.x, 'forklift.x'),
    z: int(f.z, 'forklift.z'),
    heading: f.heading === undefined ? 0 : num(f.heading, 'forklift.heading'),
  };
  if (!inBounds(forklift.x, forklift.z)) fail('forklift starts out of bounds');
  if (blocked.has(cellKey(forklift))) fail('forklift starts inside an obstacle');
  // A door cell holds its truck's character in a .level map: nothing else starts there.
  const forkliftDoor = doorAt(cellKey(forklift));
  if (forkliftDoor) fail(`forklift starts on ${forkliftDoor}: door cells start empty`);

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
    // Its locked box would close that bed column for good.
    const door = doorAt(k);
    if (door) fail(`zone "${zone.id}" is on ${door}: the truck is loaded from there`);
    zoneCells.add(k);
    return zone;
  });
  if (!targetRules && zones.length === 0) fail('a level needs at least one zone');

  // Boxes. Several boxes on one cell form a stack, bottom → top in list order; a box in a rack slot or on a truck bed
  // names its level.
  const boxIds = new Set<string>();
  const stacks = new Map<string, Sortable[]>();
  /** Rack boxes by slot: "x,z@level" → box. */
  const slotBoxes = new Map<string, Sortable>();
  /** Truck boxes by truck slot: "x,z@level" → box. */
  const truckBoxes = new Map<string, Sortable>();
  const truckBoxList: { id: string; key: string; truck: number; column: number; level: number }[] = [];
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
      ...(o.level === undefined ? {} : { level: int(o.level, `boxes[${i}].level`) }),
      kind,
    };
    if (boxIds.has(box.id)) fail(`duplicate box id "${box.id}"`);
    boxIds.add(box.id);
    const k = cellKey(box);
    // A box loaded on a truck rests on its bed cell, outside the map beyond the dock door.
    if (!inBounds(box.x, box.z) && !truckCells.has(k)) fail(`box "${box.id}" out of bounds`);
    const rackCell = rackCells.get(k);
    if (rackCell) {
      // A box in a storage rack slot.
      if (box.level === undefined) fail(`box "${box.id}" is in a rack cell: give it the level of its slot`);
      const [ri, column] = rackCell;
      const slots = racks[ri].columns[column].length;
      if (box.level! < 0 || box.level! >= slots)
        fail(`box "${box.id}" is in slot ${box.level} of racks[${ri}] column ${column}, which has ${slots} slots`);
      const slotKey = `${k}@${box.level}`;
      if (slotBoxes.has(slotKey)) fail(`two boxes share slot ${box.level} of racks[${ri}] column ${column}`);
      slotBoxes.set(slotKey, sortableOf(box));
      return box;
    }
    const truckCell = truckCells.get(k);
    if (truckCell) {
      // A box loaded on a truck bed column at the start (docs/DOCKS.md).
      if (box.level === undefined) fail(`box "${box.id}" is on a truck bed cell: give it its truck level`);
      const [ti, column] = truckCell;
      const levels = trucks[ti].columns[column].length;
      if (box.level! < 0 || box.level! >= levels)
        fail(`box "${box.id}" is on level ${box.level} of trucks[${ti}] column ${column}, which has ${levels} levels`);
      const slotKey = `${k}@${box.level}`;
      if (truckBoxes.has(slotKey)) fail(`two boxes share level ${box.level} of trucks[${ti}] column ${column}`);
      truckBoxes.set(slotKey, sortableOf(box));
      truckBoxList.push({ id: box.id, key: k, truck: ti, column, level: box.level! });
      return box;
    }
    if (box.level !== undefined) fail(`box "${box.id}" has a level but is not in a rack slot (floor stacks go by list order)`);
    if (blocked.has(k)) fail(`box "${box.id}" is inside an obstacle`);
    if (k === cellKey(forklift)) fail(`box "${box.id}" is under the forklift start`);
    const door = doorCells.get(k);
    if (door)
      fail(`box "${box.id}" starts on ${doorAt(k)}: door cells start empty (a box loaded on the truck is on its bed cell ${cellKey(truckCellOf(trucks[door[0]], door[1]))})`);
    const stack = stacks.get(k);
    if (stack) stack.push(sortableOf(box));
    else stacks.set(k, [sortableOf(box)]);
    return box;
  });
  // A truck bed column is a stack: a box loaded at the start sits on the bed or on another box.
  for (const tb of truckBoxList) {
    if (tb.level > 0 && !truckBoxes.has(`${tb.key}@${tb.level - 1}`))
      fail(`box "${tb.id}" is on trucks[${tb.truck}] column ${tb.column} at level ${tb.level} with no box below it`);
  }

  // Stack limit: explicit, else the global max when the level uses stacking at all, else 1 (classic levels). A truck
  // bed column of more than one level is loaded like a floor stack: it counts as stacking.
  const recipeOf = (zone: LevelZone): readonly (ColorId | undefined)[] => zone.recipe ?? [zone.color];
  const tallestRecipe = Math.max(1, ...zones.map((zone) => recipeOf(zone).length));
  const tallestStart = Math.max(0, ...[...stacks.values()].map((st) => st.length));
  const tallestTruck = Math.max(0, ...trucks.flatMap((truck) => truck.columns.map((levels) => levels.length)));
  const stacking = tallestRecipe > 1 || tallestStart > 1 || tallestTruck > 1;
  const stackLimit =
    r.stackLimit === undefined ? (stacking ? GAME_CONFIG.stack.maxHeight : 1) : int(r.stackLimit, 'stackLimit');
  if (stackLimit < 1 || stackLimit > GAME_CONFIG.stack.maxHeight)
    fail(`stackLimit must be between 1 and ${GAME_CONFIG.stack.maxHeight}`);
  if (tallestRecipe > stackLimit) fail(`a zone recipe is taller than stackLimit ${stackLimit}`);
  for (const [k, st] of stacks) {
    if (st.length > stackLimit) fail(stackLimit === 1 ? `two boxes share cell ${k}` : `stack at ${k} is taller than stackLimit ${stackLimit}`);
  }
  trucks.forEach((truck, i) =>
    truck.columns.forEach((levels, j) => {
      if (levels.length > stackLimit) fail(`trucks[${i}].columns[${j}] has ${levels.length} levels, more than stackLimit ${stackLimit}`);
    }),
  );

  // Racks and trucks known to the target helpers (core/sorting), in the shape they read.
  const withRacks = { zones, ...(hasRacks ? { racks } : {}), ...(hasTrucks ? { trucks } : {}) };
  if (targetRules) {
    // Storage racks (docs/RACKS.md) and loading docks (docs/DOCKS.md): floor stacks only park boxes, every zone, every
    // slot with a cue and every truck level is a target, one box per target, and exactly one complete assignment (up
    // to identical boxes) gives each target its box.
    const recipeZone = zones.findIndex((zone) => (zone.recipe?.length ?? 1) > 1);
    if (recipeZone >= 0) fail(`zones[${recipeZone}] asks for a stack: in a level with storage racks floor stacks only park boxes`);
    const targets = targetsOf(withRacks);
    if (targets.length === 0) fail('a level needs at least one zone or rack slot with a cue');
    const truckLevels = truckSlotNames.length;
    if (boxes.length !== targets.length)
      fail(
        hasTrucks
          ? `a level with storage racks or trucks needs one box per target (${boxes.length} boxes, ${zones.length} zones, ${targets.length - zones.length - truckLevels} slots with a cue, ${truckLevels} truck levels)`
          : `a level with storage racks needs one box per target (${boxes.length} boxes, ${zones.length} zones, ${targets.length - zones.length} slots with a cue)`,
      );
    const kinds = boxes.map(sortableOf);
    const criteria = targets.map((t) => t.criteria);
    const { count, found } = assignmentsOf(kinds, criteria, 2);
    if (count === 0) {
      const stranded = assignBoxes(kinds, criteria).indexOf(-1);
      fail(`no complete assignment exists: box "${boxes[Math.max(0, stranded)].id}" is always left without a zone or slot`);
    }
    if (count > 1) {
      const [a, b] = found;
      const t = a.findIndex((kind, i) => !sameKind(kind, b[i]));
      fail(`more than one complete assignment: ${targetName(targets[t], slotNames, truckSlotNames)} may take ${kindName(a[t])} or ${kindName(b[t])}`);
    }
  } else if (usesSymbols({ boxes, zones })) {
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

  // Must not start solved: every zone holding exactly what it asks for (an accepted bottom box, then its recipe); with
  // racks or trucks, every zone, slot with a cue and truck level holding its destined box (the one assignment found
  // above; on a truck that is enough: every level below is then right too).
  let solved: boolean;
  if (targetRules) {
    const targets = targetsOf(withRacks);
    const [assignment] = assignmentsOf(boxes.map(sortableOf), targets.map((t) => t.criteria), 1).found;
    const slotRefs = racks.flatMap((rack) => rack.columns.flatMap((slots, column) => slots.map((_, level) => ({ cell: rackCellOf(rack, column), level }))));
    const truckRefs = trucks.flatMap((truck) => truck.columns.flatMap((levels, column) => levels.map((_, level) => ({ cell: truckCellOf(truck, column), level }))));
    solved = targets.every((t, i) => {
      if (t.kind === 'zone') {
        const st = stacks.get(cellKey(zones[t.index]));
        return st !== undefined && st.length === 1 && sameKind(st[0], assignment[i]);
      }
      const ref = t.kind === 'slot' ? slotRefs[t.index] : truckRefs[t.index];
      const box = (t.kind === 'slot' ? slotBoxes : truckBoxes).get(`${cellKey(ref.cell)}@${ref.level}`);
      return box !== undefined && sameKind(box, assignment[i]);
    });
  } else {
    solved = zones.every((zone) => {
      const recipe = recipeOf(zone);
      const st = stacks.get(cellKey(zone));
      return (
        st !== undefined &&
        st.length === recipe.length &&
        st.every((box, i) => (i === 0 ? meets(criteriaOf(zone), box) : box.color === recipe[i]))
      );
    });
  }
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
    ...(hasRacks ? { racks } : {}),
    ...(hasTrucks ? { trucks } : {}),
    decor: { plants, windows },
    stackLimit,
    theme: typeof r.theme === 'string' && r.theme ? r.theme : 'default',
  };
}
