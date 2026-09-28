import {
  BOX_KINDS,
  COLOR_IDS,
  cellKey,
  type BoxKind,
  type ColorId,
  type LevelData,
  type LevelShelf,
  type WallSide,
} from '../core/types';

/**
 * Parses and validates raw level JSON into a fully-defaulted LevelData.
 * Throws a descriptive Error on the first problem found, so authoring mistakes surface at load / test time.
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

  // Zones
  const zoneIds = new Set<string>();
  const zoneCells = new Map<string, ColorId>();
  const zones = arr(r.zones, 'zones').map((z, i) => {
    const o = obj(z, `zones[${i}]`);
    const zone = { id: str(o.id, `zones[${i}].id`), color: color(o.color, `zones[${i}]`), x: int(o.x, `zones[${i}].x`), z: int(o.z, `zones[${i}].z`) };
    if (zoneIds.has(zone.id)) fail(`duplicate zone id "${zone.id}"`);
    zoneIds.add(zone.id);
    if (!inBounds(zone.x, zone.z)) fail(`zone "${zone.id}" out of bounds`);
    const k = cellKey(zone);
    if (blocked.has(k)) fail(`zone "${zone.id}" is inside an obstacle`);
    if (zoneCells.has(k)) fail(`two zones share cell ${k}`);
    if (k === cellKey(forklift)) fail(`zone "${zone.id}" is under the forklift start`);
    zoneCells.set(k, zone.color);
    return zone;
  });
  if (zones.length === 0) fail('a level needs at least one zone');

  // Boxes
  const boxIds = new Set<string>();
  const boxCells = new Set<string>();
  const boxes = arr(r.boxes, 'boxes').map((b, i) => {
    const o = obj(b, `boxes[${i}]`);
    const kind: BoxKind =
      o.kind === undefined
        ? 'standard'
        : (BOX_KINDS as readonly string[]).includes(o.kind as string)
          ? (o.kind as BoxKind)
          : fail(`boxes[${i}] has unknown kind "${String(o.kind)}"`);
    const box = { id: str(o.id, `boxes[${i}].id`), color: color(o.color, `boxes[${i}]`), x: int(o.x, `boxes[${i}].x`), z: int(o.z, `boxes[${i}].z`), kind };
    if (boxIds.has(box.id)) fail(`duplicate box id "${box.id}"`);
    boxIds.add(box.id);
    if (!inBounds(box.x, box.z)) fail(`box "${box.id}" out of bounds`);
    const k = cellKey(box);
    if (blocked.has(k)) fail(`box "${box.id}" is inside an obstacle`);
    if (boxCells.has(k)) fail(`two boxes share cell ${k}`);
    if (k === cellKey(forklift)) fail(`box "${box.id}" is under the forklift start`);
    boxCells.add(k);
    return box;
  });

  // Every color must have exactly as many boxes as zones.
  const count = new Map<ColorId, number>();
  for (const b of boxes) count.set(b.color, (count.get(b.color) ?? 0) + 1);
  for (const z of zones) count.set(z.color, (count.get(z.color) ?? 0) - 1);
  for (const [c, n] of count) if (n !== 0) fail(`color "${c}" has ${n > 0 ? 'more boxes than zones' : 'more zones than boxes'}`);

  // Must not start solved.
  const solved = boxes.every((b) => zoneCells.get(cellKey(b)) === b.color);
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
    theme: typeof r.theme === 'string' && r.theme ? r.theme : 'default',
  };
}
