import type { BoxState, Facing, LevelData, Vec2, WallSide } from '../core/types';
import { FACING_X, FACING_Z } from '../core/racks';
import { DOOR_JAMB, dockRailsOf, type DockRail } from '../core/docks';
import { conveyorsOf } from '../core/conveyors';
import { STORAGE_SKINS, storageColumnsOf, storageOf, storageSlotsOf } from '../core/storage';

export { DOOR_JAMB };

/** Axis-aligned rectangle on the floor plane (world units). */
export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Overlap of a circle with an obstacle: penetration depth (> 0) and unit push-out normal. */
export interface Contact {
  depth: number;
  nx: number;
  nz: number;
}

/** Side of the square collider of a potted plant (centered in its cell). */
export const PLANT_SIZE = 0.6;
/** Push-out passes per resolve. Each pass fixes the deepest contact, so seams between rects never snag. */
export const RESOLVE_ITERATIONS = 8;
/** Overlaps at or below this are "touching", not penetrating. */
const CONTACT_EPSILON = 1e-7;
/** Extra push so a resolved contact is not re-detected through rounding on the next query. */
const SKIN = 1e-6;
/**
 * Speed (u/s) at which a just-dropped box grows back to full collision size after starting shrunk by its overlap
 * with the forklift body: the body is eased out (≈0.1 s for a typical 4 cm) instead of popping out in one frame.
 */
export const BOX_SETTLE_SPEED = 0.4;
/**
 * Thickness (u) of the walls of an open rack slot as the carried load meets them: the back panel and the two side
 * uprights of the column's cell. Thin, so the load (collider radius 0.46 in a 1-wide cell) keeps a few cm of play.
 */
export const RACK_WALL = 0.02;
// Loading docks (docs/DOCKS.md): the jambs of a dock door as the carried load meets them, DOOR_JAMB (core/docks, as
// thin as RACK_WALL) into each end of its run of door cells; its guard rails run on that line (dockRailsOf).
/** Thickness (u) of the wall slabs the carried load meets in a level with dock doors: far thicker than any step. */
const WALL_SLAB = 2;
/** Depth (u) of the pocket behind a dock door, beyond the wall line: the truck bed, one cell. */
export const DOOR_POCKET = 1;

/** A dock door in the collision world: its wall and its run of door cells along it (world units, jambs included). */
export interface DoorSpan {
  wall: WallSide;
  from: number;
  to: number;
}

/**
 * The walls as the carried load meets them in a level with dock doors (docs/DOCKS.md): thick slabs outside `bounds`,
 * the north and west ones open at each door (between its jambs) onto a pocket DOOR_POCKET deep (the truck bed),
 * closed at its back. Nothing stands between the columns of one door. Inside the room they meet the load exactly as
 * the walls (`bounds`) do. Each bed column's span of the door is shut on its own until it is opened (doorCells).
 */
export function doorWalls(bounds: Rect, doors: readonly DoorSpan[]): Rect[] {
  const B = WALL_SLAB;
  const j = DOOR_JAMB;
  const { minX, minZ, maxX, maxZ } = bounds;
  const out: Rect[] = [
    { minX: minX - B, minZ: maxZ, maxX: maxX + B, maxZ: maxZ + B },
    { minX: maxX, minZ: minZ - B, maxX: maxX + B, maxZ: maxZ + B },
  ];
  for (const wall of ['north', 'west'] as const) {
    // Along the wall (x for the north one, z for the west one): the slab's pieces between the door openings.
    const openings = doors
      .filter((d) => d.wall === wall)
      .map((d) => [d.from + j, d.to - j] as const)
      .sort((p, q) => p[0] - q[0]);
    const face = wall === 'north' ? minZ : minX;
    const piece = (a: number, b: number, outer: number, inner: number) => {
      if (b > a) out.push(wall === 'north' ? { minX: a, minZ: outer, maxX: b, maxZ: inner } : { minX: outer, minZ: a, maxX: inner, maxZ: b });
    };
    let at = wall === 'north' ? minX - B : minZ - B;
    for (const [a, b] of openings) {
      piece(at, a, face - B, face);
      // The back of the pocket, beyond the bed.
      piece(a, b, face - B, face - DOOR_POCKET);
      at = Math.max(at, b);
    }
    piece(at, wall === 'north' ? maxX + B : maxZ + B, face - B, face);
  }
  return out;
}

/**
 * Each door column's span of its dock door (docs/DOCKS.md), door by door, column by column (the order of their
 * columns in LevelGrid.columns): one cell along the wall, from the wall line to the back of the pocket. While shut the
 * carried load meets it like the wall; GameState opens only the span of the column the rig faces from its door cell
 * (CollisionWorld.setOpen), so a load turned on a door cell meets the door like the wall until the rig faces that
 * column, and it never slides along a wide door into the next column.
 */
export function doorCells(bounds: Rect, doors: readonly DoorSpan[]): Rect[] {
  const out: Rect[] = [];
  for (const d of doors) {
    const n = Math.round(d.to - d.from);
    for (let k = 0; k < n; k++) {
      const a = d.from + k;
      out.push(
        d.wall === 'north'
          ? { minX: a, minZ: bounds.minZ - DOOR_POCKET, maxX: a + 1, maxZ: bounds.minZ }
          : { minX: bounds.minX - DOOR_POCKET, minZ: a, maxX: bounds.minX, maxZ: a + 1 },
      );
    }
  }
  return out;
}

/**
 * A dock door's guard rail (core/docks DockRail, map units) as a static rect in world units (`hw`, `hd`: half the
 * map's width and depth): along the wall between its inner and outer faces, into the room from the wall's inner face
 * to one cell in.
 */
export function railRect(rail: DockRail, hw: number, hd: number): Rect {
  const a = Math.min(rail.line, rail.outer);
  const b = Math.max(rail.line, rail.outer);
  return rail.wall === 'north'
    ? { minX: a - hw, minZ: rail.from - hd, maxX: b - hw, maxZ: rail.to - hd }
    : { minX: rail.from - hw, minZ: a - hd, maxX: rail.to - hw, maxZ: b - hd };
}

/**
 * A storage column as the collision world is given it (docs/STORAGE.md «Acceso»), in storage column order
 * (LevelGrid.columns): where the carried load goes into it.
 * - `front` (a rack): its own cell, solid for the body always and for the load while shut; open, the load only meets
 *   the slot's back panel and side uprights (RACK_WALL), and a shut one eases a load already reaching in back out
 *   (soften).
 * - `door` (a truck): its span of a dock door (doorCells), beyond the wall: wall for the load while shut; open, the load
 *   passes onto the bed (still meeting the jambs, the back of the pocket and any shut span beside it). The body never
 *   meets it (it meets the whole wall) and the fork point never does (empty tines pass any door).
 * - `belt` (a belt's end exit, docs/CONVEYOR.md): its cell, never opened (the forklift never works at it); the world
 *   keeps it among its static obstacles, like the belt's cells, so the body, the load and the fork point all meet it.
 */
export type StorageOpening = { access: 'front'; cell: Rect; facing: Facing } | { access: 'door'; span: Rect } | { access: 'belt'; cell: Rect };

/** The storage a collision world is built with (all optional: none by default). */
export interface StorageColliders {
  /** Every storage column's opening, in storage column order (the indices of setOpen and the others). */
  openings?: readonly StorageOpening[];
  /** The dock doors, one per door unit (its run of door cells along its wall): the load walls open there (doorWalls). */
  doors?: readonly DoorSpan[];
  /**
   * Ids of the storage slots whose boxes never collide on their own (support `shelves`: the column's cell and its walls
   * do). A box in any other slot is a stack like the floor's (support `stack`: its base collides).
   */
  shelfSlots?: ReadonlySet<string>;
}

/** A storage column's opening as the world keeps it: the rect the load reaches into, and a front one's slot walls. */
interface Opening {
  /** front: the column's cell; door: its span of the door. */
  rect: Rect;
  /** front: back panel, then the two side uprights (open: the load only meets these); door: none. */
  walls: readonly Rect[];
}

/** Cell rect and open-slot walls of a rack column whose front looks `facing`. */
function slotOpening(cell: Rect, facing: Facing): Opening {
  const t = RACK_WALL;
  const { minX, minZ, maxX, maxZ } = cell;
  const ox = FACING_X[facing];
  const oz = FACING_Z[facing];
  // Back panel: the side away from the front.
  const back: Rect =
    ox > 0
      ? { minX, minZ, maxX: minX + t, maxZ }
      : ox < 0
        ? { minX: maxX - t, minZ, maxX, maxZ }
        : oz > 0
          ? { minX, minZ, maxX, maxZ: minZ + t }
          : { minX, minZ: maxZ - t, maxX, maxZ };
  // Side uprights: the two edges along the front direction.
  const sides: [Rect, Rect] =
    ox !== 0
      ? [
          { minX, minZ, maxX, maxZ: minZ + t },
          { minX, minZ: maxZ - t, maxX, maxZ },
        ]
      : [
          { minX, minZ, maxX: minX + t, maxZ },
          { minX: maxX - t, minZ, maxX, maxZ },
        ];
  return { rect: cell, walls: [back, sides[0], sides[1]] };
}

const NO_SLOTS: ReadonlySet<string> = new Set();

export function createContact(): Contact {
  return { depth: 0, nx: 0, nz: 0 };
}

/**
 * Circle vs axis-aligned rectangle. Writes into `out` and returns the depth when overlapping, 0 otherwise
 * (`out` untouched). A center inside the rect is pushed through the nearest face. Radius 0 never collides.
 */
export function circleRectContact(
  cx: number,
  cz: number,
  r: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  out: Contact,
): number {
  const qx = cx < minX ? minX : cx > maxX ? maxX : cx;
  const qz = cz < minZ ? minZ : cz > maxZ ? maxZ : cz;
  const dx = cx - qx;
  const dz = cz - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return 0;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    out.depth = r - d;
    out.nx = dx / d;
    out.nz = dz / d;
    return out.depth;
  }
  // Center inside (or exactly on the border): leave through the closest face. Fixed order → deterministic.
  let face = cx - minX;
  let nx = -1;
  let nz = 0;
  if (maxX - cx < face) {
    face = maxX - cx;
    nx = 1;
  }
  if (cz - minZ < face) {
    face = cz - minZ;
    nx = 0;
    nz = -1;
  }
  if (maxZ - cz < face) {
    face = maxZ - cz;
    nx = 0;
    nz = 1;
  }
  out.depth = face + r;
  out.nx = nx;
  out.nz = nz;
  return out.depth;
}

/** Circle that must stay inside `bounds` (the warehouse walls). Same contract as circleRectContact. */
export function circleInsideContact(cx: number, cz: number, r: number, bounds: Rect, out: Contact): number {
  const west = r - (cx - bounds.minX);
  const east = r - (bounds.maxX - cx);
  const north = r - (cz - bounds.minZ);
  const south = r - (bounds.maxZ - cz);
  const depth = Math.max(west, east, north, south);
  if (!(depth > 0)) return 0;
  // Push away from the deepest wall (fixed order → deterministic).
  out.depth = depth;
  out.nx = depth === west ? 1 : depth === east ? -1 : 0;
  out.nz = out.nx !== 0 ? 0 : depth === north ? 1 : -1;
  return depth;
}

/** Signed distance from a point to a rect: positive outside, negative inside. */
export function pointRectDistance(px: number, pz: number, minX: number, minZ: number, maxX: number, maxZ: number): number {
  const dx = Math.max(minX - px, 0, px - maxX);
  const dz = Math.max(minZ - pz, 0, pz - maxZ);
  if (dx > 0 || dz > 0) return Math.sqrt(dx * dx + dz * dz);
  return -Math.min(px - minX, maxX - px, pz - minZ, maxZ - pz);
}

/**
 * Static + dynamic obstacles of one level: walls (bounds), shelves, plants, storage columns and resting boxes (read
 * live from the box list; carried boxes, boxes above the floor and boxes on a storage shelf are skipped).
 * Allocation-free queries.
 * Storage (docs/STORAGE.md «Acceso»): every storage column has an opening (StorageOpening), indexed in storage column
 * order, that GameState opens for the carried load (`setOpen`) and shuts again, whatever its access:
 * - `front` (a rack column): a solid cell for the body; for the carried load solid too while shut, and while open the
 *   load (entering its slot from the front) only meets its back panel and side uprights. Shut with the load already
 *   reaching in, it eases the load out (`soften`).
 * - `door` (a truck column): the walls stay whole for the body (it stops at the wall line, at a door too); the carried
 *   load and the fork point meet them as slabs open at each dock door onto the truck bed beyond (`loadWalls`, see
 *   doorWalls), where they meet only the boxes loaded there (their stack's base, like any floor stack). For the load
 *   each door column's span stays shut like the wall until GameState opens it (the rig faces that column from its door
 *   cell); the fork point (empty tines) passes any door. Without docks the load meets the walls exactly as the body
 *   does.
 */
export class CollisionWorld {
  readonly bounds: Rect;
  private readonly statics: readonly Rect[];
  /** Levels with dock doors: the walls as the carried load and the fork point meet them (doorWalls), else null. */
  private readonly loadWalls: readonly Rect[] | null;
  /** Per storage column (storage column order): its opening. */
  private readonly openings: readonly Opening[];
  /** The storage columns of each access, in storage column order (each kind is checked in its place, as always). */
  private readonly frontColumns: readonly number[];
  private readonly doorColumns: readonly number[];
  /** Per storage column: 1 while the carried load may pass its opening (see setOpen). */
  private readonly open: Uint8Array;
  /** Per storage column (front): how much its cell is currently shrunk for the load (easing it out, see soften). */
  private readonly openingInsets: Float64Array;
  /** Storage slots whose boxes never collide on their own (StorageColliders.shelfSlots). */
  private readonly shelfSlots: ReadonlySet<string>;
  private readonly boxHalf: number;
  private boxes: readonly BoxState[] = [];
  /** Per box: how much its collider is currently shrunk on every side (settling after a drop), 0 = full size. */
  private insets = new Float64Array(0);
  /**
   * Per box: 1 when it is the base of a stack the carried load may pass over (stack levels only; GameState opens
   * a stack with room once the forks are high enough and keeps it open while the load is over it). The load
   * collider ignores such stacks; the body still collides. Boxes above the floor (level > 0) never collide on
   * their own: a stack is one cell, represented by its base.
   */
  private passable = new Uint8Array(0);
  private settling = false;
  private readonly hit = createContact();
  private readonly bodyHit = createContact();
  private readonly loadHit = createContact();

  constructor(bounds: Rect, statics: readonly Rect[], boxSize: number, storage: StorageColliders = {}) {
    const openings = storage.openings ?? [];
    const doors = storage.doors ?? [];
    this.bounds = bounds;
    this.statics = statics;
    this.loadWalls = doors.length > 0 ? doorWalls(bounds, doors) : null;
    // A belt's end exit is in neither list below: its cell is a static obstacle (fromLevel), never opened.
    this.openings = openings.map((o) => (o.access === 'front' ? slotOpening(o.cell, o.facing) : { rect: o.access === 'door' ? o.span : o.cell, walls: [] }));
    this.frontColumns = openings.flatMap((o, i) => (o.access === 'front' ? [i] : []));
    this.doorColumns = openings.flatMap((o, i) => (o.access === 'door' ? [i] : []));
    this.open = new Uint8Array(openings.length);
    this.openingInsets = new Float64Array(openings.length);
    this.shelfSlots = storage.shelfSlots ?? NO_SLOTS;
    this.boxHalf = boxSize / 2;
  }

  static fromLevel(level: LevelData, boxSize: number): CollisionWorld {
    const hw = level.size.width / 2;
    const hd = level.size.depth / 2;
    const statics: Rect[] = level.shelves.map((s) => ({
      minX: s.x - hw,
      minZ: s.z - hd,
      maxX: s.x + s.w - hw,
      maxZ: s.z + s.d - hd,
    }));
    const inset = (1 - PLANT_SIZE) / 2;
    for (const p of level.decor.plants) {
      statics.push({ minX: p.x - hw + inset, minZ: p.z - hd + inset, maxX: p.x + 1 - hw - inset, maxZ: p.z + 1 - hd - inset });
    }
    // The guard rails beside each dock door (none without trucks): thin and static, for the body, the load and the fork
    // point alike, on the door's jamb line from the wall's inner face to one cell in, as thick as DOCK_RAIL outward.
    for (const r of dockRailsOf(level)) statics.push(railRect(r, hw, hd));
    // Conveyor belts (docs/CONVEYOR.md; none without them): every belt cell and every end exit's cell is a whole-cell
    // static obstacle (a table the forklift never drives into); a belt's input is a storage column of the `front`
    // access below, entered only by the load through its front, like a rack slot (at its level on the table top: below
    // it, its cell stays shut, the table's face).
    const cellRect = (x: number, z: number): Rect => ({ minX: x - hw, minZ: z - hd, maxX: x + 1 - hw, maxZ: z + 1 - hd });
    for (const belt of conveyorsOf(level)) for (const c of belt.cells) statics.push(cellRect(c.x, c.z));
    for (const unit of storageOf(level)) if (unit.access.kind === 'belt') statics.push(cellRect(unit.x, unit.z));
    // A dock door spans its unit's run of door cells along its wall; each of its columns opens its own span of it.
    const doors: DoorSpan[] = [];
    for (const unit of storageOf(level)) {
      const a = unit.access;
      if (a.kind !== 'door') continue;
      doors.push(a.wall === 'north' ? { wall: a.wall, from: unit.x - hw, to: unit.x + unit.w - hw } : { wall: a.wall, from: unit.z - hd, to: unit.z + unit.w - hd });
    }
    const spans = doorCells({ minX: -hw, minZ: -hd, maxX: hw, maxZ: hd }, doors);
    let door = 0;
    const openings = storageColumnsOf(level).map((col): StorageOpening => {
      const a = col.unit.access;
      if (a.kind === 'door') return { access: 'door', span: spans[door++] };
      const c = col.cell;
      if (a.kind === 'belt') return { access: 'belt', cell: cellRect(c.x, c.z) };
      return { access: 'front', cell: cellRect(c.x, c.z), facing: a.facing };
    });
    const shelfSlots = new Set(storageSlotsOf(level).filter((s) => STORAGE_SKINS[s.unit.skin].support === 'shelves').map((s) => s.id));
    return new CollisionWorld({ minX: -hw, minZ: -hd, maxX: hw, maxZ: hd }, statics, boxSize, { openings, doors, shelfSlots });
  }

  /** Number of storage columns (each with its opening). */
  get columnCount(): number {
    return this.openings.length;
  }

  /** The rect of storage column `index`'s opening (world units): a front column's cell, a door column's span. */
  opening(index: number): Rect {
    return this.openings[index].rect;
  }

  /**
   * Open (or shut) storage column `index`'s opening for the carried load. Open: the load goes in (front: meeting only
   * the slot's back panel and side uprights; door: onto the bed beyond). Shut: the whole cell / span blocks it. The body
   * always meets a front column's whole cell and never a door's span.
   */
  setOpen(index: number, open: boolean): void {
    if (index >= 0 && index < this.open.length) this.open[index] = open ? 1 : 0;
  }

  isOpen(index: number): boolean {
    return index >= 0 && index < this.open.length && this.open[index] === 1;
  }

  /**
   * Front storage column `index` shuts with the carried load (circle at (cx, cz), radius `r`) already reaching into its
   * cell: for the load the cell starts shrunk by that overlap and grows back at BOX_SETTLE_SPEED (see settle), so the
   * load is eased out instead of popping. Returns the overlap (0 = none; always 0 for a door span: it never shuts around
   * the load). Only push-out (deepestContact / resolve) sees it.
   */
  soften(index: number, cx: number, cz: number, r: number): number {
    if (index < 0 || index >= this.openings.length || this.openings[index].walls.length === 0) return 0;
    const c = this.openings[index].rect;
    const overlap = circleRectContact(cx, cz, r, c.minX, c.minZ, c.maxX, c.maxZ, this.hit);
    this.openingInsets[index] = Math.min(overlap, (c.maxX - c.minX) / 2, (c.maxZ - c.minZ) / 2);
    if (overlap > 0) this.settling = true;
    return overlap;
  }

  /** Current load inset of storage column `index`'s cell (0 = full cell). */
  openingInset(index: number): number {
    return index >= 0 && index < this.openingInsets.length ? this.openingInsets[index] : 0;
  }

  /** Boxes are read live from this array every query (only resting ones collide). */
  setBoxes(boxes: readonly BoxState[]): void {
    this.boxes = boxes;
    this.insets = new Float64Array(boxes.length);
    this.passable = new Uint8Array(boxes.length);
    this.settling = false;
  }

  /** Mark a stack base as one the carried load can pass over (see `passable`). */
  setPassable(index: number, passable: boolean): void {
    if (index >= 0 && index < this.passable.length) this.passable[index] = passable ? 1 : 0;
  }

  /** Whether the carried load currently passes over this stack base (see `passable`). */
  isPassable(index: number): boolean {
    return index >= 0 && index < this.passable.length && this.passable[index] === 1;
  }

  /**
   * A box was just placed overlapping the circle (the forklift body): its collider starts shrunk by that overlap
   * and grows back at BOX_SETTLE_SPEED (see settle), so push-out is gradual. Returns the overlap (0 = none).
   * Only push-out (deepestContact / resolve) sees the inset; clearance and drop rules use the full box.
   */
  softenBox(index: number, cx: number, cz: number, r: number): number {
    const b = this.boxes[index];
    const h = this.boxHalf;
    const overlap = b ? circleRectContact(cx, cz, r, b.pos.x - h, b.pos.z - h, b.pos.x + h, b.pos.z + h, this.hit) : 0;
    if (index >= 0 && index < this.insets.length) this.insets[index] = Math.min(overlap, h);
    if (overlap > 0) this.settling = true;
    return overlap;
  }

  /** Box collider back to full size at once (e.g. when it is picked up). */
  hardenBox(index: number): void {
    if (index >= 0 && index < this.insets.length) this.insets[index] = 0;
  }

  /** Current collider inset of a box (0 = full size). */
  boxInset(index: number): number {
    return index >= 0 && index < this.insets.length ? this.insets[index] : 0;
  }

  /** Grow softened boxes (and front columns' cells, for the load) back toward full size over `dt` seconds. */
  settle(dt: number): void {
    if (!this.settling || !(dt > 0)) return;
    const step = BOX_SETTLE_SPEED * dt;
    const boxes = shrinkInsets(this.insets, step);
    this.settling = shrinkInsets(this.openingInsets, step) || boxes;
  }

  /** The box does not collide on its own: carried, above the floor (its stack's base does) or on a storage shelf. */
  private skips(b: BoxState): boolean {
    return b.carried || b.level > 0 || (b.slotId !== null && this.shelfSlots.has(b.slotId));
  }

  /**
   * Deepest overlap of a circle with walls, static obstacles, storage columns and resting boxes (settling ones shrunk).
   * 0 = free. `load`: the circle is the carried box, which passes over stacks that still have room, enters an open front
   * column (meeting only its slot's walls; a column it is being eased out of meets it shrunk, see soften) and goes
   * through an open span of a dock door onto the truck bed beyond it (loadWalls; a shut span is wall); the body meets the
   * whole walls and every front column's whole cell.
   */
  deepestContact(cx: number, cz: number, r: number, out: Contact, load = false): number {
    out.depth = 0;
    out.nx = 0;
    out.nz = 0;
    if (!(r > 0)) return 0;
    const hit = this.hit;
    const walls = load ? this.loadWalls : null;
    const openings = this.openings;
    if (walls) {
      for (let i = 0; i < walls.length; i++) {
        const s = walls[i];
        if (circleRectContact(cx, cz, r, s.minX, s.minZ, s.maxX, s.maxZ, hit) > out.depth) copyContact(hit, out);
      }
      const doors = this.doorColumns;
      for (let k = 0; k < doors.length; k++) {
        const i = doors[k];
        if (this.open[i] === 1) continue;
        const s = openings[i].rect;
        if (circleRectContact(cx, cz, r, s.minX, s.minZ, s.maxX, s.maxZ, hit) > out.depth) copyContact(hit, out);
      }
    } else if (circleInsideContact(cx, cz, r, this.bounds, hit) > out.depth) copyContact(hit, out);
    const statics = this.statics;
    for (let i = 0; i < statics.length; i++) {
      const s = statics[i];
      if (circleRectContact(cx, cz, r, s.minX, s.minZ, s.maxX, s.maxZ, hit) > out.depth) copyContact(hit, out);
    }
    const fronts = this.frontColumns;
    for (let k = 0; k < fronts.length; k++) {
      const i = fronts[k];
      if (load && this.open[i] === 1) {
        const slotWalls = openings[i].walls;
        for (let w = 0; w < slotWalls.length; w++) {
          const s = slotWalls[w];
          if (circleRectContact(cx, cz, r, s.minX, s.minZ, s.maxX, s.maxZ, hit) > out.depth) copyContact(hit, out);
        }
      } else {
        const s = openings[i].rect;
        const t = load ? this.openingInsets[i] : 0;
        if (circleRectContact(cx, cz, r, s.minX + t, s.minZ + t, s.maxX - t, s.maxZ - t, hit) > out.depth) copyContact(hit, out);
      }
    }
    const boxes = this.boxes;
    const insets = this.insets;
    const passable = this.passable;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (this.skips(b) || (load && passable[i] === 1)) continue;
      const h = i < insets.length ? this.boxHalf - insets[i] : this.boxHalf;
      const x = b.pos.x;
      const z = b.pos.z;
      if (circleRectContact(cx, cz, r, x - h, z - h, x + h, z + h, hit) > out.depth) copyContact(hit, out);
    }
    return out.depth;
  }

  /**
   * Iterative push-out of a rigid rig: a body circle at `pos` plus an optional load circle `loadOffset` ahead
   * along (fx, fz). Each pass resolves the single deepest contact of either circle (so the rig slides along
   * walls and seams instead of catching on them). Mutates `pos`; returns the residual penetration (0 = clear).
   */
  resolve(
    pos: Vec2,
    fx: number,
    fz: number,
    bodyRadius: number,
    loadOffset: number,
    loadRadius: number,
    iterations = RESOLVE_ITERATIONS,
  ): number {
    for (let i = 0; ; i++) {
      let depth = this.deepestContact(pos.x, pos.z, bodyRadius, this.bodyHit);
      let nx = this.bodyHit.nx;
      let nz = this.bodyHit.nz;
      if (loadRadius > 0) {
        const d = this.deepestContact(pos.x + fx * loadOffset, pos.z + fz * loadOffset, loadRadius, this.loadHit, true);
        if (d > depth) {
          depth = d;
          nx = this.loadHit.nx;
          nz = this.loadHit.nz;
        }
      }
      if (depth <= CONTACT_EPSILON) return 0;
      if (i >= iterations) return depth;
      pos.x += nx * (depth + SKIN);
      pos.z += nz * (depth + SKIN);
    }
  }

  /**
   * Free space around a point: signed distance to the nearest wall / obstacle / resting box (negative when the
   * point is inside one). It measures for the fork point or the carried load, so a dock door is open (loadWalls: the
   * point may stand on the truck bed beyond it). `ignoreBoxId` excludes one box (e.g. the one about to be lifted, or
   * its stack's base). `load`: measured for the carried box (stacks with room do not count, see deepestContact; an
   * open front column counts as its slot's walls, a shut span of a dock door as wall). `ignoreColumn`: a storage column
   * left out (the one whose box is about to be lifted: the fork point sits in its cell); a door column's span never
   * counts for the fork point anyway.
   */
  clearance(px: number, pz: number, ignoreBoxId: string | null = null, load = false, ignoreColumn = -1): number {
    const b = this.bounds;
    const walls = this.loadWalls;
    const openings = this.openings;
    let d = Infinity;
    if (walls) for (let i = 0; i < walls.length; i++) d = Math.min(d, pointRectDistance(px, pz, walls[i].minX, walls[i].minZ, walls[i].maxX, walls[i].maxZ));
    else d = Math.min(px - b.minX, b.maxX - px, pz - b.minZ, b.maxZ - pz);
    if (load) {
      const doors = this.doorColumns;
      for (let k = 0; k < doors.length; k++) {
        const i = doors[k];
        const s = openings[i].rect;
        if (this.open[i] === 0) d = Math.min(d, pointRectDistance(px, pz, s.minX, s.minZ, s.maxX, s.maxZ));
      }
    }
    const statics = this.statics;
    for (let i = 0; i < statics.length; i++) {
      const s = statics[i];
      d = Math.min(d, pointRectDistance(px, pz, s.minX, s.minZ, s.maxX, s.maxZ));
    }
    const fronts = this.frontColumns;
    for (let k = 0; k < fronts.length; k++) {
      const i = fronts[k];
      if (i === ignoreColumn) continue;
      if (load && this.open[i] === 1) {
        const slotWalls = openings[i].walls;
        for (let w = 0; w < slotWalls.length; w++) d = Math.min(d, pointRectDistance(px, pz, slotWalls[w].minX, slotWalls[w].minZ, slotWalls[w].maxX, slotWalls[w].maxZ));
      } else {
        const s = openings[i].rect;
        d = Math.min(d, pointRectDistance(px, pz, s.minX, s.minZ, s.maxX, s.maxZ));
      }
    }
    const h = this.boxHalf;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (this.skips(box) || box.id === ignoreBoxId || (load && this.passable[i] === 1)) continue;
      d = Math.min(d, pointRectDistance(px, pz, box.pos.x - h, box.pos.z - h, box.pos.x + h, box.pos.z + h));
    }
    return d;
  }
}

/** Ease every positive inset `step` toward 0; true while any is still above 0. */
function shrinkInsets(insets: Float64Array, step: number): boolean {
  let any = false;
  for (let i = 0; i < insets.length; i++) {
    if (insets[i] <= 0) continue;
    insets[i] = Math.max(0, insets[i] - step);
    if (insets[i] > 0) any = true;
  }
  return any;
}

function copyContact(from: Contact, to: Contact): void {
  to.depth = from.depth;
  to.nx = from.nx;
  to.nz = from.nz;
}
