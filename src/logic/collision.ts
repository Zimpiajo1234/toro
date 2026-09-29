import type { BoxState, LevelData, Vec2 } from '../core/types';

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
 * Static + dynamic obstacles of one level: walls (bounds), shelves, plants and resting boxes (read live from
 * the box list; carried boxes are skipped). Allocation-free queries.
 */
export class CollisionWorld {
  readonly bounds: Rect;
  private readonly statics: readonly Rect[];
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

  constructor(bounds: Rect, statics: readonly Rect[], boxSize: number) {
    this.bounds = bounds;
    this.statics = statics;
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
    return new CollisionWorld({ minX: -hw, minZ: -hd, maxX: hw, maxZ: hd }, statics, boxSize);
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

  /** Grow softened boxes back toward full size over `dt` seconds. */
  settle(dt: number): void {
    if (!this.settling || !(dt > 0)) return;
    const step = BOX_SETTLE_SPEED * dt;
    let any = false;
    const insets = this.insets;
    for (let i = 0; i < insets.length; i++) {
      if (insets[i] <= 0) continue;
      insets[i] = Math.max(0, insets[i] - step);
      if (insets[i] > 0) any = true;
    }
    this.settling = any;
  }

  /**
   * Deepest overlap of a circle with walls, static obstacles and resting boxes (settling ones shrunk). 0 = free.
   * `load`: the circle is the carried box, which passes over stacks that still have room.
   */
  deepestContact(cx: number, cz: number, r: number, out: Contact, load = false): number {
    out.depth = 0;
    out.nx = 0;
    out.nz = 0;
    if (!(r > 0)) return 0;
    const hit = this.hit;
    if (circleInsideContact(cx, cz, r, this.bounds, hit) > out.depth) copyContact(hit, out);
    const statics = this.statics;
    for (let i = 0; i < statics.length; i++) {
      const s = statics[i];
      if (circleRectContact(cx, cz, r, s.minX, s.minZ, s.maxX, s.maxZ, hit) > out.depth) copyContact(hit, out);
    }
    const boxes = this.boxes;
    const insets = this.insets;
    const passable = this.passable;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.carried || b.level > 0 || (load && passable[i] === 1)) continue;
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
   * point is inside one). `ignoreBoxId` excludes one box (e.g. the one about to be lifted, or its stack's base).
   * `load`: measured for the carried box (stacks with room do not count, see deepestContact).
   */
  clearance(px: number, pz: number, ignoreBoxId: string | null = null, load = false): number {
    const b = this.bounds;
    let d = Math.min(px - b.minX, b.maxX - px, pz - b.minZ, b.maxZ - pz);
    const statics = this.statics;
    for (let i = 0; i < statics.length; i++) {
      const s = statics[i];
      d = Math.min(d, pointRectDistance(px, pz, s.minX, s.minZ, s.maxX, s.maxZ));
    }
    const h = this.boxHalf;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.carried || box.level > 0 || box.id === ignoreBoxId || (load && this.passable[i] === 1)) continue;
      d = Math.min(d, pointRectDistance(px, pz, box.pos.x - h, box.pos.z - h, box.pos.x + h, box.pos.z + h));
    }
    return d;
  }
}

function copyContact(from: Contact, to: Contact): void {
  to.depth = from.depth;
  to.nx = from.nx;
  to.nz = from.nz;
}
