import type { BoxState, Facing, LevelData, Vec2, WallSide } from '../core/types';
import { FACING_X, FACING_Z, racksOf, rackCellOf } from '../core/racks';
import { trucksOf } from '../core/docks';

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
/**
 * Loading docks (docs/DOCKS.md): the jambs of a dock door as the carried load meets them. The opening is this much
 * narrower than its run of door cells at each end, like the side uprights of a rack slot (RACK_WALL), so the load
 * (radius 0.46) goes through a 1-cell door with a few cm of play.
 */
export const DOOR_JAMB = RACK_WALL;
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
 * Each truck bed column's span of its dock door (docs/DOCKS.md), door by door, column by column (the order of
 * LevelGrid.truckColumns): one cell along the wall, from the wall line to the back of the pocket. While shut the
 * carried load meets it like the wall; GameState opens only the span of the column the rig faces from its door cell
 * (CollisionWorld.setDoorOpen), so a load turned on a door cell meets the door like the wall until the rig faces that
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

/** A storage rack column as the collision world sees it: the whole cell, and its walls when open for the load. */
interface RackCollider {
  cell: Rect;
  /** Back panel, then the two side uprights (open column: the load only meets these). */
  walls: readonly [Rect, Rect, Rect];
}

/** Cell rect and open-slot walls of a rack column whose front looks `facing`. */
function rackCollider(cell: Rect, facing: Facing): RackCollider {
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
  return { cell, walls: [back, sides[0], sides[1]] };
}

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
 * Static + dynamic obstacles of one level: walls (bounds), shelves, plants, storage rack columns and resting boxes
 * (read live from the box list; carried boxes and boxes in rack slots are skipped). Allocation-free queries.
 * A rack column is a solid cell for the body; for the carried load it is solid too, unless GameState opened it
 * (`setRackOpen`: the load enters its slot from the front), when the load only meets its back panel and side uprights.
 * Loading docks (docs/DOCKS.md): the walls stay whole for the body (it stops at the wall line, at a door too); the
 * carried load and the fork point meet them as slabs open at each dock door onto the truck bed beyond (`loadWalls`,
 * see doorWalls), where they meet only the boxes loaded there (their stack's base, like any floor stack). For the load
 * each bed column's span of the door stays shut like the wall until GameState opens it (`setDoorOpen`: the rig faces
 * that column from its door cell), like a rack column; the fork point (empty tines) passes any door. Without docks
 * the load meets the walls exactly as the body does.
 */
export class CollisionWorld {
  readonly bounds: Rect;
  private readonly statics: readonly Rect[];
  /** Levels with dock doors: the walls as the carried load and the fork point meet them (doorWalls), else null. */
  private readonly loadWalls: readonly Rect[] | null;
  /** Per truck bed column (LevelGrid.truckColumns order): its span of the door (doorCells); empty without docks. */
  private readonly doors: readonly Rect[];
  /** Per bed column: 1 while the carried load may pass its span of the door (see setDoorOpen). */
  private readonly doorOpen: Uint8Array;
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
  /** Storage rack columns (GameSnapshot.slots order of their columns: core/racks). */
  private readonly racks: readonly RackCollider[];
  /** Per rack column: 1 while the carried load may enter it (see setRackOpen). */
  private readonly rackOpen: Uint8Array;
  /** Per rack column: how much its cell is currently shrunk for the load (easing it out after a close, see softenRack). */
  private readonly rackInsets: Float64Array;
  private settling = false;
  private readonly hit = createContact();
  private readonly bodyHit = createContact();
  private readonly loadHit = createContact();

  constructor(
    bounds: Rect,
    statics: readonly Rect[],
    boxSize: number,
    racks: readonly { cell: Rect; facing: Facing }[] = [],
    doors: readonly DoorSpan[] = [],
  ) {
    this.bounds = bounds;
    this.statics = statics;
    this.loadWalls = doors.length > 0 ? doorWalls(bounds, doors) : null;
    this.doors = doorCells(bounds, doors);
    this.doorOpen = new Uint8Array(this.doors.length);
    this.boxHalf = boxSize / 2;
    this.racks = racks.map((r) => rackCollider(r.cell, r.facing));
    this.rackOpen = new Uint8Array(racks.length);
    this.rackInsets = new Float64Array(racks.length);
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
    const racks: { cell: Rect; facing: Facing }[] = [];
    for (const rack of racksOf(level)) {
      rack.columns.forEach((_, column) => {
        const c = rackCellOf(rack, column);
        racks.push({ cell: { minX: c.x - hw, minZ: c.z - hd, maxX: c.x + 1 - hw, maxZ: c.z + 1 - hd }, facing: rack.facing });
      });
    }
    // A dock door spans its run of door cells along its wall.
    const doors: DoorSpan[] = trucksOf(level).map((t) =>
      t.wall === 'north' ? { wall: t.wall, from: t.x - hw, to: t.x + t.w - hw } : { wall: t.wall, from: t.z - hd, to: t.z + t.w - hd },
    );
    return new CollisionWorld({ minX: -hw, minZ: -hd, maxX: hw, maxZ: hd }, statics, boxSize, racks, doors);
  }

  /** Number of storage rack columns. */
  get rackCount(): number {
    return this.racks.length;
  }

  /** The cell of rack column `index` (world units). */
  rackCell(index: number): Rect {
    return this.racks[index].cell;
  }

  /**
   * Open (or close) rack column `index` for the carried load: open, the load may enter the cell and only meets the
   * slot's back panel and side uprights; closed, the whole cell blocks it. The body always meets the whole cell.
   */
  setRackOpen(index: number, open: boolean): void {
    if (index >= 0 && index < this.rackOpen.length) this.rackOpen[index] = open ? 1 : 0;
  }

  isRackOpen(index: number): boolean {
    return index >= 0 && index < this.rackOpen.length && this.rackOpen[index] === 1;
  }

  /**
   * Rack column `index` closes with the carried load (circle at (cx, cz), radius `r`) already reaching into its cell:
   * for the load the cell starts shrunk by that overlap and grows back at BOX_SETTLE_SPEED (see settle), so the load is
   * eased out instead of popping. Returns the overlap (0 = none). Only push-out (deepestContact / resolve) sees it.
   */
  softenRack(index: number, cx: number, cz: number, r: number): number {
    if (index < 0 || index >= this.racks.length) return 0;
    const c = this.racks[index].cell;
    const overlap = circleRectContact(cx, cz, r, c.minX, c.minZ, c.maxX, c.maxZ, this.hit);
    this.rackInsets[index] = Math.min(overlap, (c.maxX - c.minX) / 2, (c.maxZ - c.minZ) / 2);
    if (overlap > 0) this.settling = true;
    return overlap;
  }

  /** Current load inset of rack column `index` (0 = full cell). */
  rackInset(index: number): number {
    return index >= 0 && index < this.rackInsets.length ? this.rackInsets[index] : 0;
  }

  /** Number of truck bed columns (each with its span of a dock door). */
  get doorCount(): number {
    return this.doors.length;
  }

  /** Bed column `index`'s span of its door (world units, see doorCells). */
  doorCell(index: number): Rect {
    return this.doors[index];
  }

  /**
   * Open (or shut) bed column `index`'s span of its door for the carried load: shut, the load meets it like the wall;
   * open, the load passes onto the bed beyond (still meeting the jambs, the back of the pocket and any shut span
   * beside it). The body and the fork point never meet it.
   */
  setDoorOpen(index: number, open: boolean): void {
    if (index >= 0 && index < this.doorOpen.length) this.doorOpen[index] = open ? 1 : 0;
  }

  isDoorOpen(index: number): boolean {
    return index >= 0 && index < this.doorOpen.length && this.doorOpen[index] === 1;
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

  /** Grow softened boxes (and rack cells, for the load) back toward full size over `dt` seconds. */
  settle(dt: number): void {
    if (!this.settling || !(dt > 0)) return;
    const step = BOX_SETTLE_SPEED * dt;
    const boxes = shrinkInsets(this.insets, step);
    this.settling = shrinkInsets(this.rackInsets, step) || boxes;
  }

  /**
   * Deepest overlap of a circle with walls, static obstacles and resting boxes (settling ones shrunk). 0 = free.
   * `load`: the circle is the carried box, which passes over stacks that still have room (and meets a rack column it
   * is being eased out of shrunk, see softenRack) and through an open span of a dock door onto the truck bed beyond it
   * (loadWalls; a shut span is wall); the body meets the whole walls.
   */
  deepestContact(cx: number, cz: number, r: number, out: Contact, load = false): number {
    out.depth = 0;
    out.nx = 0;
    out.nz = 0;
    if (!(r > 0)) return 0;
    const hit = this.hit;
    const walls = load ? this.loadWalls : null;
    if (walls) {
      for (let i = 0; i < walls.length; i++) {
        const s = walls[i];
        if (circleRectContact(cx, cz, r, s.minX, s.minZ, s.maxX, s.maxZ, hit) > out.depth) copyContact(hit, out);
      }
      const doors = this.doors;
      for (let i = 0; i < doors.length; i++) {
        if (this.doorOpen[i] === 1) continue;
        const s = doors[i];
        if (circleRectContact(cx, cz, r, s.minX, s.minZ, s.maxX, s.maxZ, hit) > out.depth) copyContact(hit, out);
      }
    } else if (circleInsideContact(cx, cz, r, this.bounds, hit) > out.depth) copyContact(hit, out);
    const statics = this.statics;
    for (let i = 0; i < statics.length; i++) {
      const s = statics[i];
      if (circleRectContact(cx, cz, r, s.minX, s.minZ, s.maxX, s.maxZ, hit) > out.depth) copyContact(hit, out);
    }
    const racks = this.racks;
    for (let i = 0; i < racks.length; i++) {
      if (load && this.rackOpen[i] === 1) {
        const walls = racks[i].walls;
        for (let w = 0; w < 3; w++) {
          const s = walls[w];
          if (circleRectContact(cx, cz, r, s.minX, s.minZ, s.maxX, s.maxZ, hit) > out.depth) copyContact(hit, out);
        }
      } else {
        const s = racks[i].cell;
        const t = load ? this.rackInsets[i] : 0;
        if (circleRectContact(cx, cz, r, s.minX + t, s.minZ + t, s.maxX - t, s.maxZ - t, hit) > out.depth) copyContact(hit, out);
      }
    }
    const boxes = this.boxes;
    const insets = this.insets;
    const passable = this.passable;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.carried || b.level > 0 || b.slotId !== null || (load && passable[i] === 1)) continue;
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
   * open rack column counts as its walls, a shut span of a dock door as wall). `ignoreRack`: a rack column left out
   * (the one whose slot box is about to be lifted).
   */
  clearance(px: number, pz: number, ignoreBoxId: string | null = null, load = false, ignoreRack = -1): number {
    const b = this.bounds;
    const walls = this.loadWalls;
    let d = Infinity;
    if (walls) for (let i = 0; i < walls.length; i++) d = Math.min(d, pointRectDistance(px, pz, walls[i].minX, walls[i].minZ, walls[i].maxX, walls[i].maxZ));
    else d = Math.min(px - b.minX, b.maxX - px, pz - b.minZ, b.maxZ - pz);
    if (load) {
      const doors = this.doors;
      for (let i = 0; i < doors.length; i++) {
        if (this.doorOpen[i] === 0) d = Math.min(d, pointRectDistance(px, pz, doors[i].minX, doors[i].minZ, doors[i].maxX, doors[i].maxZ));
      }
    }
    const statics = this.statics;
    for (let i = 0; i < statics.length; i++) {
      const s = statics[i];
      d = Math.min(d, pointRectDistance(px, pz, s.minX, s.minZ, s.maxX, s.maxZ));
    }
    const racks = this.racks;
    for (let i = 0; i < racks.length; i++) {
      if (i === ignoreRack) continue;
      if (load && this.rackOpen[i] === 1) {
        const walls = racks[i].walls;
        for (let w = 0; w < 3; w++) d = Math.min(d, pointRectDistance(px, pz, walls[w].minX, walls[w].minZ, walls[w].maxX, walls[w].maxZ));
      } else {
        const s = racks[i].cell;
        d = Math.min(d, pointRectDistance(px, pz, s.minX, s.minZ, s.maxX, s.maxZ));
      }
    }
    const h = this.boxHalf;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.carried || box.level > 0 || box.slotId !== null || box.id === ignoreBoxId || (load && this.passable[i] === 1)) continue;
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
