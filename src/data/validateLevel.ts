import {
  BOX_KINDS,
  COLOR_IDS,
  CONVEYOR_PIECES,
  FACINGS,
  SYMBOL_IDS,
  cellKey,
  type BoxKind,
  type ColorId,
  type ConveyorPiece,
  type Facing,
  type LevelBox,
  type LevelConveyor,
  type LevelData,
  type LevelShelf,
  type LevelStorage,
  type LevelZone,
  type StorageAccess,
  type StorageSkin,
  type SymbolId,
  type WallSide,
  type ZoneCriteria,
} from '../core/types';
import { FACING_X, FACING_Z } from '../core/racks';
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
import { STORAGE_SKINS, STORAGE_SKIN_ORDER, STORAGE_WORDS, baseLevelOf, cellOf, frontOf, slotIdOf, storageSlotsOf } from '../core/storage';
import { FLOOR_BELT_LEVEL, beltEndLevels } from '../core/conveyors';
import { dockRailsOf } from '../core/docks';
import { GAME_CONFIG } from '../config';

/** How validation messages name a box kind: "blue/circle". */
const kindName = (box: Sortable) => `${box.color}/${box.symbol}`;

/**
 * How validation messages name the storage units of each skin and their levels: the English words of its row of
 * core/storage STORAGE_WORDS (asciiLevel's explainValidation reads the messages back and places them on the map). A
 * unit is `${list}[i]`, the i-th unit of its skin: its index in the JSON list `racks` / `trucks` of a legacy level, or
 * among the units of that skin in `storage`.
 */
const wordsOf = (skin: StorageSkin) => STORAGE_WORDS[skin].en;

/**
 * Parses and validates a raw level object (from a .level file via asciiLevel.parseLevel, or a legacy JSON level) into
 * a fully-defaulted LevelData. Throws a descriptive Error on the first problem found, so authoring mistakes surface
 * at load / test time (parseLevel re-words these in Spanish at the file position to fix). Storage comes as `storage`
 * (LevelData's own form: validateLevel(level) gives the level back) or, from a legacy JSON level, as `racks` and
 * `trucks`; either way the level gets `storage` (docs/STORAGE.md).
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

  // Storage units (docs/STORAGE.md): `storage`, or a legacy JSON level's `racks` (docs/RACKS.md) and `trucks`
  // (docs/DOCKS.md). Skin by skin (rule 12: racks, then trucks, then the belts' inputs and end exits), each skin in the
  // order given. What every unit shares comes from its skin's row (STORAGE_SKINS: levels per column, columns, the id
  // prefix; in a stack the «libre» levels on top; a stack within stackLimit and the `fillToMax` levels, below); then its
  // access places it on the map: `front` — its own cells, solid, loaded from the floor cell in front of each column
  // (checked once every obstacle is known); `door` — its door cells, a straight run of floor against the north (row
  // z = 0) or west (column x = 0) wall, free of furniture and other doors (and of zones, boxes and the forklift at the
  // start: checked below), its columns' cells just beyond the wall, outside the map; `belt` — its own cell, solid, fed by
  // its conveyor (docs/CONVEYOR.md: checked with the conveyors).
  const sources: { skin: StorageSkin; raw: unknown; path: string }[] = [];
  if (r.storage !== undefined) {
    if (r.racks !== undefined || r.trucks !== undefined) fail('storage and the legacy racks / trucks lists do not mix: give every storage unit in storage');
    arr(r.storage, 'storage').forEach((s, i) => {
      const skin = obj(s, `storage[${i}]`).skin;
      if (!STORAGE_SKIN_ORDER.includes(skin as StorageSkin)) fail(`storage[${i}].skin must be ${STORAGE_SKIN_ORDER.join(' or ')}`);
      sources.push({ skin: skin as StorageSkin, raw: s, path: `storage[${i}]` });
    });
    // A stable sort: skin by skin, each skin as given.
    sources.sort((a, b) => STORAGE_SKIN_ORDER.indexOf(a.skin) - STORAGE_SKIN_ORDER.indexOf(b.skin));
  } else {
    arr(r.racks, 'racks').forEach((raw, i) => sources.push({ skin: 'rack', raw, path: `racks[${i}]` }));
    arr(r.trucks, 'trucks').forEach((raw, i) => sources.push({ skin: 'truck', raw, path: `trucks[${i}]` }));
  }
  const legacy = r.storage === undefined;
  const facingIn = (fields: Record<string, unknown>, where: string): Facing =>
    (FACINGS as readonly string[]).includes(fields.facing as string) ? (fields.facing as Facing) : fail(`${where}.facing must be north, east, south or west`);
  /** A unit's access: in its own fields (legacy `facing` / `wall`) or in its `access` object; `where` names them. */
  const accessOf = (kind: StorageAccess['kind'], fields: Record<string, unknown>, where: string): StorageAccess =>
    kind === 'door'
      ? { kind, wall: fields.wall === 'north' || fields.wall === 'west' ? (fields.wall as WallSide) : fail(`${where}.wall must be "north" or "west"`) }
      : { kind, facing: facingIn(fields, where) };
  /** A level's cue: a colour, a symbol or both; null (or `{}`, the legacy form) = «libre». */
  const readCue = (s: unknown, what: string): ZoneCriteria | null => {
    if (s === null) return null;
    const so = obj(s, what);
    const cue: ZoneCriteria = {
      ...(so.color === undefined ? {} : { color: color(so.color, what) }),
      ...(so.symbol === undefined ? {} : { symbol: symbol(so.symbol, what) }),
    };
    return cue.color === undefined && cue.symbol === undefined ? null : cue;
  };
  const units: LevelStorage[] = [];
  /** How messages name each unit, in storage order: `racks[0]`, `trucks[1]`… (wordsOf). */
  const names: string[] = [];
  /** Per unit, in storage order: the base level its raw object gives (LevelStorage.baseLevel), if any. */
  const givenBases: (number | undefined)[] = [];
  /** Storage slot id → how messages name it: `racks[0].columns[1][2]` (filled once every unit has its base level). */
  const slotNames = new Map<string, string>();
  /** Cell key of a unit column (a front unit's own cell; a door unit's, outside the map) → [unit, column]. */
  const unitCells = new Map<string, [number, number]>();
  /** Door cell key → [unit, column]. */
  const doorCells = new Map<string, [number, number]>();
  /** Units of each skin so far. */
  const inSkin = Object.fromEntries(STORAGE_SKIN_ORDER.map((skin) => [skin, 0])) as Record<StorageSkin, number>;
  for (const { skin, raw: unitRaw, path } of sources) {
    const row = STORAGE_SKINS[skin];
    const words = wordsOf(skin);
    const name = `${words.list}[${inSkin[skin]}]`;
    const o = obj(unitRaw, path);
    let unitAccess: StorageAccess;
    if (legacy) unitAccess = accessOf(row.access, o, name);
    else {
      const fields = obj(o.access, `${name}.access`);
      if (fields.kind !== row.access) fail(`${name}.access.kind must be "${row.access}": the access of a ${words.one}`);
      unitAccess = accessOf(row.access, fields, `${name}.access`);
    }
    const columnsRaw = arr(o.columns, `${name}.columns`);
    if (columnsRaw.length === 0) fail(`${name} needs at least one column`);
    const columns = columnsRaw.map((c, j) => {
      const levels = arr(c, `${name}.columns[${j}]`);
      if (levels.length < 1 || levels.length > row.maxLevels) fail(`${name}.columns[${j}] must have 1 to ${row.maxLevels} ${words.level}s`);
      const cues = levels.map((s, k) => readCue(s, `${name}.columns[${j}][${k}]`));
      // In a stack (docs/STORAGE.md rule 7) the «libre» levels only sit above the ones with a cue: a level is satisfied
      // on satisfied levels, so no level with a cue ever stands on a «libre» one.
      const free = cues.indexOf(null);
      const above = free < 0 || row.support !== 'stack' ? -1 : cues.findIndex((cue, k) => k > free && cue !== null);
      if (above >= 0) fail(`${name}.columns[${j}][${above}] has a cue above a free level: in a stack the free levels go on top of the ones with a cue`);
      return cues;
    });
    // A belt's input takes any box (docs/CONVEYOR.md): its one level is «libre».
    if (skin === 'beltIn' && columns.some((levels) => levels.some((cue) => cue !== null)))
      fail(`${name} asks for a cue: a belt input is «libre» (any box set down there rides its belt)`);
    const unit: LevelStorage = {
      id: o.id === undefined ? `${row.idPrefix}${inSkin[skin] + 1}` : str(o.id, `${name}.id`),
      skin,
      x: int(o.x, `${name}.x`),
      z: int(o.z, `${name}.z`),
      w: o.w === undefined ? columns.length : int(o.w, `${name}.w`),
      access: unitAccess,
      columns,
    };
    if (unit.w !== columns.length) fail(`${name}.w must equal its number of columns (${columns.length})`);
    if (columns.length > row.maxColumns)
      fail(`${name} has ${columns.length} columns, more than ${row.maxColumns}${unitAccess.kind === 'door' ? `: its dock door is 1 to ${row.maxColumns} cells wide` : ''}`);
    if (unitAccess.kind === 'door' && unitAccess.wall === 'north' && unit.z !== 0) fail(`${name} is in the north wall: its door cells run along row z = 0`);
    if (unitAccess.kind === 'door' && unitAccess.wall === 'west' && unit.x !== 0) fail(`${name} is in the west wall: its door cells run along column x = 0`);
    // Ids are unique across skins: every slot id is «unit:column:level».
    if (units.some((other) => other.skin === skin && other.id === unit.id)) fail(`duplicate ${words.one} id "${unit.id}"`);
    const clash = units.find((other) => other.id === unit.id);
    if (clash)
      fail(`${name} has the id "${unit.id}" of a ${wordsOf(clash.skin).one}: ${wordsOf(clash.skin).list} and ${words.list} never share an id`);
    const u = units.length;
    columns.forEach((_, j) => {
      const cell = cellOf(unit, j);
      if (unitAccess.kind !== 'door') {
        // Its own map cell (a rack's, a belt's input or end exit): solid.
        if (!inBounds(cell.x, cell.z)) fail(`${name} leaves the warehouse at ${cell.x},${cell.z}`);
        const k = cellKey(cell);
        if (blocked.has(k)) fail(`${name} overlaps another obstacle at ${k}`);
        blocked.add(k);
      } else {
        const door = frontOf(unit, j);
        if (!inBounds(door.x, door.z)) fail(`${name} leaves the warehouse at ${door.x},${door.z}`);
        const k = cellKey(door);
        // The door cells stay floor (the forklift stands there to load): no shelf, plant, rack or other dock door.
        if (blocked.has(k) || doorCells.has(k)) fail(`${name} overlaps another obstacle at ${k}`);
        doorCells.set(k, [u, j]);
      }
      unitCells.set(cellKey(cell), [u, j]);
    });
    givenBases.push(o.baseLevel === undefined ? undefined : int(o.baseLevel, `${name}.baseLevel`));
    units.push(unit);
    names.push(name);
    inSkin[skin]++;
  }
  /** With trucks, the one-box-per-target message counts their levels apart (its text as asciiLevel reads it). */
  const withTrucks = units.some((unit) => unit.skin === 'truck');
  // Conveyor belts (docs/CONVEYOR.md): each a straight run of belt cells from its input (a unit of skin beltIn) to its
  // end exit (one of skin beltOut), the input loaded from the side away from the belt, the end exit fed from the belt's
  // last cell. Every cell a floor piece for now (the ramp and the ceiling pieces come later: the data already carries
  // them), a table at FLOOR_BELT_LEVEL (its cells' height, by default), on cells of its own: nothing else stands on a
  // belt (an obstacle for the body and the load).
  const conveyors: LevelConveyor[] = arr(r.conveyors, 'conveyors').map((c, i) => {
    const name = `conveyors[${i}]`;
    const o = obj(c, name);
    const cells = arr(o.cells, `${name}.cells`).map((cell, j) => {
      const where = `${name}.cells[${j}]`;
      const co = obj(cell, where);
      const piece: ConveyorPiece =
        co.piece === undefined
          ? 'suelo'
          : (CONVEYOR_PIECES as readonly string[]).includes(co.piece as string)
            ? (co.piece as ConveyorPiece)
            : fail(`${where}.piece must be ${CONVEYOR_PIECES.join(', ')}`);
      return { x: int(co.x, `${where}.x`), z: int(co.z, `${where}.z`), piece, height: co.height === undefined ? FLOOR_BELT_LEVEL : num(co.height, `${where}.height`) };
    });
    return { id: o.id === undefined ? `c${i + 1}` : str(o.id, `${name}.id`), input: str(o.input, `${name}.input`), output: str(o.output, `${name}.output`), cells };
  });
  /** The conveyor of each belt unit (by unit index). */
  const beltOfUnit = new Map<number, number>();
  /** The base level a belt gives each of its two units (by unit index): its height there. */
  const beltBases = new Map<number, number>();
  conveyors.forEach((belt, i) => {
    const name = `conveyors[${i}]`;
    if (conveyors.some((other, j) => j < i && other.id === belt.id)) fail(`duplicate conveyor id "${belt.id}"`);
    if (belt.cells.length === 0) fail(`${name} needs at least one belt cell between its input and its end exit`);
    belt.cells.forEach((cell, j) => {
      if (cell.piece !== 'suelo') fail(`${name}.cells[${j}] is a ${cell.piece} piece: only floor belts («suelo») are built so far`);
      if (cell.height !== FLOOR_BELT_LEVEL)
        fail(`${name}.cells[${j}] has height ${cell.height}: a floor belt («suelo») is a table at level ${FLOOR_BELT_LEVEL} (the floor of a rack's level-1 slot)`);
    });
    const unitOf = (id: string, skin: StorageSkin, role: string): number => {
      const u = units.findIndex((unit) => unit.id === id);
      if (u < 0 || units[u].skin !== skin) fail(`${name}.${role} "${id}" is not a ${wordsOf(skin).one} (a storage unit of skin ${skin})`);
      const other = beltOfUnit.get(u);
      if (other !== undefined) fail(`${names[u]} belongs to conveyors[${other}] and to ${name}: every belt has its own input and end exit`);
      beltOfUnit.set(u, i);
      return u;
    };
    const input = unitOf(belt.input, 'beltIn', 'input');
    const output = unitOf(belt.output, 'beltOut', 'output');
    // One straight line: the input, its belt cells, the end exit, one cell apart, always the same way.
    const path = [units[input], ...belt.cells, units[output]];
    const dx = path[1].x - path[0].x;
    const dz = path[1].z - path[0].z;
    for (let k = 1; k < path.length; k++) {
      if (Math.abs(dx) + Math.abs(dz) !== 1 || path[k].x - path[k - 1].x !== dx || path[k].z - path[k - 1].z !== dz)
        fail(`${name} is not a straight run from its input to its end exit at ${path[k].x},${path[k].z}`);
    }
    // The input is loaded from the side away from its belt; the end exit takes its box from the belt's last cell.
    const away = FACINGS.find((f) => FACING_X[f] === -dx && FACING_Z[f] === -dz)!;
    if (units[input].access.kind !== 'front' || units[input].access.facing !== away)
      fail(`${names[input]} must face ${away}: a belt input is loaded from the side away from its belt`);
    if (units[output].access.kind !== 'belt' || units[output].access.facing !== away)
      fail(`${names[output]} must face ${away}: a belt's end exit takes its box from the belt's last cell`);
    for (const cell of belt.cells) {
      const k = cellKey(cell);
      if (!inBounds(cell.x, cell.z)) fail(`${name} leaves the warehouse at ${k}`);
      if (blocked.has(k) || doorCells.has(k)) fail(`${name} overlaps another obstacle at ${k}`);
      blocked.add(k);
    }
    // Its input and end exit stand on the belt (docs/CONVEYOR.md): their slots at its height next to each.
    const ends = beltEndLevels(belt);
    beltBases.set(input, ends.input);
    beltBases.set(output, ends.output);
  });
  units.forEach((unit, u) => {
    if ((unit.skin === 'beltIn' || unit.skin === 'beltOut') && !beltOfUnit.has(u))
      fail(`${names[u]} belongs to no conveyor: a belt's input and end exit come with their belt`);
  });
  // Base levels (docs/STORAGE.md «Nivel base»): a belt's ends at their belt's height (written in the unit, so every
  // layer reads its slots' levels off the unit itself), every other unit at the floor (0, never written). A raw level
  // may repeat it (validateLevel gives the level back), never contradict it.
  units.forEach((unit, u) => {
    const base = beltBases.get(u) ?? 0;
    const given = givenBases[u];
    if (given !== undefined && given !== base)
      fail(
        beltBases.has(u)
          ? `${names[u]}.baseLevel must be ${base}: a belt's input and end exit stand at their belt's height`
          : `${names[u]}.baseLevel must be 0: only a conveyor belt's input and end exit stand above the floor`,
      );
    if (base !== 0) unit.baseLevel = base;
    unit.columns.forEach((levels, j) => levels.forEach((_, k) => slotNames.set(slotIdOf(unit.id, j, base + k), `${names[u]}.columns[${j}][${k}]`)));
  });
  // Access `front`: every column is loaded from its front cell, floor whatever else stands around (a dock's door cell
  // too).
  units.forEach((unit, u) => {
    if (unit.access.kind !== 'front') return;
    unit.columns.forEach((_, j) => {
      const front = frontOf(unit, j);
      if (!inBounds(front.x, front.z) || blocked.has(cellKey(front)))
        fail(`${names[u]} column ${j} has no room in front: cell ${front.x},${front.z} is a wall, a shelf, a plant or another rack`);
    });
  });
  // Access `door`: every dock door has a guard rail at each end of its run (core/docks dockRailsOf, never written in a
  // .level), and the cell just past that end along the wall, behind the rail, holds a static obstacle (a plant, a shelf
  // or a rack); a run reaching a corner of the room has no rail there. A rack in that cell never faces a door cell: the
  // rail would stand right across its front.
  /** How messages name each unit, by its id (a rail names the unit of its door). */
  const nameOf = new Map(units.map((unit, u) => [unit.id, names[u]]));
  for (const rail of dockRailsOf({ storage: units, size: { width, depth } })) {
    const door = nameOf.get(rail.unitId)!;
    const k = cellKey(rail.side);
    const other = doorCells.get(k);
    if (other)
      fail(`${door} needs a static obstacle beside its dock door at ${k} for its guard rail, but that is the dock door of ${names[other[0]]}: leave a cell with an obstacle between two dock doors`);
    if (!blocked.has(k)) fail(`${door} needs a static obstacle beside its dock door at ${k} (a plant, a shelf or a rack): its guard rail stands there`);
    // A map cell: never the cell of a door unit's column (those lie outside), so a front unit's.
    const beside = unitCells.get(k);
    const faced = beside ? doorCells.get(cellKey(frontOf(units[beside[0]], beside[1]))) : undefined;
    if (beside && faced) fail(`${names[beside[0]]} column ${beside[1]} is loaded from the dock door of ${names[faced[0]]}, across its guard rail`);
  }
  /** The dock door a cell is in front of, as messages name it, or null. */
  const doorAt = (k: string): string | null => {
    const at = doorCells.get(k);
    return at ? `the dock door of ${names[at[0]]} (column ${at[1]})` : null;
  };
  // A dock door is its unit's run along the wall: no window on it.
  windows.forEach((win, i) => {
    units.forEach((unit, u) => {
      if (unit.access.kind !== 'door') return;
      const start = unit.access.wall === 'north' ? unit.x : unit.z;
      if (win.wall === unit.access.wall && win.at < start + unit.w && start < win.at + win.width) fail(`decor.windows[${i}] overlaps the dock door of ${names[u]}`);
    });
  });
  /** Levels with storage follow the target rules (docs/STORAGE.md rules 4–6). */
  const targetRules = units.length > 0;

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

  // Boxes. Several boxes on one cell form a stack, bottom → top in list order; a box stored in a unit (a rack slot, a
  // truck level) names its level.
  const boxIds = new Set<string>();
  const stacks = new Map<string, Sortable[]>();
  /** Stored boxes by storage slot: "x,z@level" → box (a front unit's cell inside the map, a door unit's outside). */
  const storedBoxes = new Map<string, Sortable>();
  /**
   * Every stored box, to check its level once the columns hold all their levels (a skin's `fillToMax` levels come with
   * the stack limit, below) and, in a stack column (a truck bed), that it has a box under it.
   */
  const storedList: { id: string; key: string; unit: number; column: number; level: number }[] = [];
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
    // A box stored in a door unit (a truck) rests on its column's cell, outside the map beyond the dock door.
    const stored = unitCells.get(k);
    if (!inBounds(box.x, box.z) && !stored) fail(`box "${box.id}" out of bounds`);
    if (stored) {
      // A box stored at the start (docs/STORAGE.md): on a level of its column (checked below), one box per level.
      const [u, column] = stored;
      if (beltOfUnit.has(u)) fail(`box "${box.id}" starts on ${names[u]}: a conveyor belt starts empty (a box rides it once set down on its input)`);
      const words = wordsOf(units[u].skin);
      if (box.level === undefined) fail(`box "${box.id}" is ${words.at} ${words.cell}: give it ${words.itsLevel}`);
      const slotKey = `${k}@${box.level}`;
      if (storedBoxes.has(slotKey)) fail(`two boxes share ${words.level} ${box.level} of ${names[u]} column ${column}`);
      storedBoxes.set(slotKey, sortableOf(box));
      storedList.push({ id: box.id, key: k, unit: u, column, level: box.level! });
      return box;
    }
    if (box.level !== undefined) fail(`box "${box.id}" has a level but is not in a rack slot (floor stacks go by list order)`);
    if (blocked.has(k)) fail(`box "${box.id}" is inside an obstacle`);
    if (k === cellKey(forklift)) fail(`box "${box.id}" is under the forklift start`);
    const door = doorCells.get(k);
    if (door)
      fail(`box "${box.id}" starts on ${doorAt(k)}: door cells start empty (a box loaded on the truck is on its bed cell ${cellKey(cellOf(units[door[0]], door[1]))})`);
    const stack = stacks.get(k);
    if (stack) stack.push(sortableOf(box));
    else stacks.set(k, [sortableOf(box)]);
    return box;
  });
  // Stack limit: explicit, else the global max when the level uses stacking at all, else 1 (classic levels). A stack
  // column of more than one level written (a truck bed) is loaded like a floor stack: it counts as stacking.
  const recipeOf = (zone: LevelZone): readonly (ColorId | undefined)[] => zone.recipe ?? [zone.color];
  const tallestRecipe = Math.max(1, ...zones.map((zone) => recipeOf(zone).length));
  const tallestStart = Math.max(0, ...[...stacks.values()].map((st) => st.length));
  const stackUnits = units.flatMap((unit, u) => (STORAGE_SKINS[unit.skin].support === 'stack' ? [u] : []));
  const tallestColumn = Math.max(0, ...stackUnits.flatMap((u) => units[u].columns.map((levels) => levels.length)));
  const stacking = tallestRecipe > 1 || tallestStart > 1 || tallestColumn > 1;
  const stackLimit =
    r.stackLimit === undefined ? (stacking ? GAME_CONFIG.stack.maxHeight : 1) : int(r.stackLimit, 'stackLimit');
  if (stackLimit < 1 || stackLimit > GAME_CONFIG.stack.maxHeight)
    fail(`stackLimit must be between 1 and ${GAME_CONFIG.stack.maxHeight}`);
  if (tallestRecipe > stackLimit) fail(`a zone recipe is taller than stackLimit ${stackLimit}`);
  for (const [k, st] of stacks) {
    if (st.length > stackLimit) fail(stackLimit === 1 ? `two boxes share cell ${k}` : `stack at ${k} is taller than stackLimit ${stackLimit}`);
  }
  // Support `stack`: a column never taller than the stack limit.
  for (const u of stackUnits) {
    units[u].columns.forEach((levels, j) => {
      if (levels.length > stackLimit) fail(`${names[u]}.columns[${j}] has ${levels.length} levels, more than stackLimit ${stackLimit}`);
    });
  }
  // A skin with `fillToMax` (docs/STORAGE.md rule 7: the truck): every column holds min(maxLevels, stackLimit) levels,
  // its written cues bottom → top and the rest «libre» (on top of them, as a stack wants them).
  for (const unit of units) {
    const row = STORAGE_SKINS[unit.skin];
    if (!row.fillToMax) continue;
    const height = Math.min(row.maxLevels, stackLimit);
    for (const levels of unit.columns) while (levels.length < height) levels.push(null);
  }
  // Every stored box on a level of its column; in a stack (a truck bed) the boxes sit on each other, so a box stored at
  // the start is on the bottom or on another box.
  for (const sb of storedList) {
    const words = wordsOf(units[sb.unit].skin);
    const levels = units[sb.unit].columns[sb.column].length;
    // Its levels count from its unit's base level (0 for every unit a box can start in).
    const base = baseLevelOf(units[sb.unit]);
    if (sb.level < base || sb.level >= base + levels)
      fail(`box "${sb.id}" is ${words.at} ${words.level} ${sb.level} of ${names[sb.unit]} column ${sb.column}, which has ${levels} ${words.level}s`);
  }
  for (const sb of storedList) {
    if (STORAGE_SKINS[units[sb.unit].skin].support !== 'stack') continue;
    if (sb.level > baseLevelOf(units[sb.unit]) && !storedBoxes.has(`${sb.key}@${sb.level - 1}`))
      fail(`box "${sb.id}" is ${wordsOf(units[sb.unit].skin).at} ${names[sb.unit]} column ${sb.column} at level ${sb.level} with no box below it`);
  }

  // The storage as the target helpers (core/sorting) read it.
  const withStorage = { zones, ...(targetRules ? { storage: units } : {}) };
  if (targetRules) {
    // Storage (docs/STORAGE.md rule 4): floor stacks only park boxes, every zone and every storage slot with a cue is
    // a target, one box per target, and exactly one complete assignment (up to identical boxes) gives each target its
    // box.
    const recipeZone = zones.findIndex((zone) => (zone.recipe?.length ?? 1) > 1);
    if (recipeZone >= 0) fail(`zones[${recipeZone}] asks for a stack: in a level with storage racks floor stacks only park boxes`);
    const targets = targetsOf(withStorage);
    if (targets.length === 0) fail('a level needs at least one zone or rack slot with a cue');
    const truckLevels = targets.filter((t) => t.skin === 'truck').length;
    const beltExits = targets.filter((t) => t.skin === 'beltOut').length;
    if (boxes.length !== targets.length)
      fail(
        conveyors.length > 0
          ? `a level with storage needs one box per target (${boxes.length} boxes, ${zones.length} zones, ${targets.length - zones.length - truckLevels - beltExits} slots with a cue, ${truckLevels} truck levels, ${beltExits} belt exits with a cue)`
          : withTrucks
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
      const target = targets[t];
      const where = target.kind === 'zone' ? `zones[${target.index}]` : slotNames.get(target.id);
      fail(`more than one complete assignment: ${where} may take ${kindName(a[t])} or ${kindName(b[t])}`);
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
  // storage, every zone and storage slot with a cue holding its destined box (the one assignment found above; in a
  // stack that is enough: every level below is then right too).
  let solved: boolean;
  if (targetRules) {
    const targets = targetsOf(withStorage);
    const [assignment] = assignmentsOf(boxes.map(sortableOf), targets.map((t) => t.criteria), 1).found;
    const slots = new Map(storageSlotsOf(withStorage).map((slot) => [slot.id, slot]));
    solved = targets.every((t, i) => {
      if (t.kind === 'zone') {
        const st = stacks.get(cellKey(zones[t.index]));
        return st !== undefined && st.length === 1 && sameKind(st[0], assignment[i]);
      }
      const slot = slots.get(t.id)!;
      const box = storedBoxes.get(`${cellKey(slot.cell)}@${slot.level}`);
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
    ...(targetRules ? { storage: units } : {}),
    ...(conveyors.length > 0 ? { conveyors } : {}),
    decor: { plants, windows },
    stackLimit,
    theme: typeof r.theme === 'string' && r.theme ? r.theme : 'default',
  };
}
