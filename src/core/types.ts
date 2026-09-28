/**
 * Shared contracts between every module (logic, render, audio, UI, data).
 * This file is the single source of truth: change it deliberately.
 *
 * Coordinate system
 * - 1 world unit = 1 grid cell. Floor top surface is y = 0.
 * - The warehouse is centered on the origin. Cell (x, z) with x ∈ [0, width) and z ∈ [0, depth)
 *   has its center at world (x + 0.5 - width / 2, z + 0.5 - depth / 2)  → see cellToWorld().
 * - "north" wall runs along z = -depth/2, "west" wall along x = -width/2 (the two back walls
 *   seen by the default camera, which sits at +x / +z looking toward the origin).
 * - Heading (radians): forward vector = (sin h, cos h) in the XZ plane. h = 0 faces +Z.
 *   In three.js a mesh modelled facing +Z gets rotation.y = heading.
 */

/** Functional colors. Order matters: it is also the order new colors are introduced in levels. */
export const COLOR_IDS = ['blue', 'mint', 'yellow', 'coral', 'lavender'] as const;
export type ColorId = (typeof COLOR_IDS)[number];

/** Box types. Only 'standard' exists today; the render layer keeps a registry keyed by kind. */
export const BOX_KINDS = ['standard'] as const;
export type BoxKind = (typeof BOX_KINDS)[number];

export interface CellPos {
  x: number;
  z: number;
}

/** A point on the floor plane (world units). */
export interface Vec2 {
  x: number;
  z: number;
}

/* ------------------------------------------------------------------ */
/* Level data (authored as JSON in src/data/levels/*.json)             */
/* ------------------------------------------------------------------ */

export interface LevelBox {
  id: string;
  color: ColorId;
  x: number;
  z: number;
  kind?: BoxKind;
}

export interface LevelZone {
  id: string;
  color: ColorId;
  x: number;
  z: number;
}

/** Rectangular obstacle covering cells [x, x + w) × [z, z + d). */
export interface LevelShelf {
  x: number;
  z: number;
  w: number;
  d: number;
  /** Number of storage levels drawn (visual only). Default 2. */
  tiers?: number;
}

export type WallSide = 'north' | 'west';

export interface LevelWindow {
  wall: WallSide;
  /** First cell index along the wall (x for north, z for west). */
  at: number;
  /** Width in cells. */
  width: number;
}

/** Decorative potted plant. Occupies its cell (small obstacle). */
export interface LevelPlant {
  x: number;
  z: number;
  variant?: number;
}

export interface LevelData {
  id: string;
  /** Sort key. Levels are played in ascending order. */
  order: number;
  /** Internal / completion-card name (never drawn in the 3D world). */
  name: string;
  size: { width: number; depth: number };
  forklift: { x: number; z: number; /** degrees, 0 = facing +Z */ heading: number };
  boxes: LevelBox[];
  zones: LevelZone[];
  shelves: LevelShelf[];
  decor: {
    plants: LevelPlant[];
    windows: LevelWindow[];
  };
  /** Theme id registered in src/themes (checked by src/integration/themes.test.ts). Defaults to 'default'. */
  theme: string;
}

/* ------------------------------------------------------------------ */
/* Runtime state (owned by logic, read by render / audio / game)       */
/* ------------------------------------------------------------------ */

export interface ForkliftState {
  /** Center of the body collider, world units. */
  pos: Vec2;
  /** Radians. forward = (sin h, cos h). */
  heading: number;
  /** Signed scalar speed along forward, units / s. */
  speed: number;
  /** Current fork height 0 (down) … 1 (carrying height). Animated by logic. */
  forkLift: number;
  /** Id of the box on the forks, or null. */
  carrying: string | null;
  /** Accumulated wheel rotation (radians) for visuals. */
  wheelSpin: number;
  /** -1 … 1, current turning intent (visual steer of rear wheels, body lean). */
  steer: number;
}

export interface BoxState {
  id: string;
  color: ColorId;
  kind: BoxKind;
  /** World position of the box center on the floor plane. While carried it follows the forks. */
  pos: Vec2;
  /** Grid cell when resting on the floor, null while carried. */
  cell: CellPos | null;
  carried: boolean;
  /** Zone the box is resting on (any color), or null. */
  zoneId: string | null;
  /** True when resting on a zone of the same color. */
  correct: boolean;
}

export interface ZoneState {
  id: string;
  color: ColorId;
  cell: CellPos;
  pos: Vec2;
  /** Box resting on this zone (any color), or null. */
  occupiedBy: string | null;
  /** True when occupied by a box of the same color. */
  satisfied: boolean;
}

/** Guidance the render layer uses to teach through design (no text). */
export interface InteractionHint {
  /** Box that would be picked up if the action were pressed now. */
  targetBoxId: string | null;
  /** While carrying: the cell the box would be dropped on (null if nowhere valid). */
  dropCell: CellPos | null;
  /** While carrying: the zone at dropCell, if any. */
  dropZoneId: string | null;
}

export interface GameSnapshot {
  level: LevelData;
  forklift: ForkliftState;
  boxes: BoxState[];
  zones: ZoneState[];
  hint: InteractionHint;
  completed: boolean;
  /** Number of zones currently satisfied / total zones. */
  progress: { satisfied: number; total: number };
}

/** Per-frame input, already converted to world space by the Game orchestrator. */
export interface InputFrame {
  /** Desired move direction in world XZ. Length 0 … 1 (analog-friendly). */
  move: Vec2;
  /**
   * Vehicle-relative control (keyboard mapping 'vehicle'): `throttle` −1 … 1 drives forward / in reverse along the
   * forklift's own heading, `steer` −1 … 1 turns it (+1 = left, i.e. heading increases). When non-zero it takes
   * precedence over `move`. Optional: omitted means no vehicle input.
   */
  drive?: { throttle: number; steer: number };
  /** True only on the frame the action button was pressed (edge). */
  actionPressed: boolean;
}

/** Events produced by GameState.update(). Consumed by render (feedback), audio and game/UI. */
export type GameEvent =
  | { type: 'firstInput' }
  | { type: 'boxPicked'; boxId: string; fromZoneId: string | null }
  | {
      type: 'boxDropped';
      boxId: string;
      cell: CellPos;
      zoneId: string | null;
      /** Dropped on a zone of its own color. */
      correct: boolean;
      /** 1-based count of satisfied zones after this drop (for rising chimes). */
      satisfiedCount: number;
      total: number;
    }
  /** Action pressed but nothing to do (no box in reach / no free cell). Feedback must stay gentle. */
  | { type: 'actionIdle'; carrying: boolean }
  /** A correctly placed box was lifted again (zone no longer satisfied). Neutral, never negative. */
  | { type: 'zoneReleased'; zoneId: string; boxId: string }
  | { type: 'levelComplete' };

export type GameEventType = GameEvent['type'];

/* ------------------------------------------------------------------ */
/* Helpers (pure, shared)                                              */
/* ------------------------------------------------------------------ */

export function cellToWorld(cell: CellPos, size: { width: number; depth: number }): Vec2 {
  return { x: cell.x + 0.5 - size.width / 2, z: cell.z + 0.5 - size.depth / 2 };
}

export function worldToCell(p: Vec2, size: { width: number; depth: number }): CellPos {
  return { x: Math.floor(p.x + size.width / 2), z: Math.floor(p.z + size.depth / 2) };
}

export function cellKey(c: CellPos): string {
  return `${c.x},${c.z}`;
}

export function forwardOf(heading: number): Vec2 {
  return { x: Math.sin(heading), z: Math.cos(heading) };
}
