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

/**
 * Symbols a box carries on its lid and a zone may ask for (engraved on its pad): the glyph shapes, never text.
 * Sorting rules (who accepts what) live in core/sorting.ts.
 */
export const SYMBOL_IDS = ['circle', 'triangle', 'square', 'diamond', 'cross'] as const;
export type SymbolId = (typeof SYMBOL_IDS)[number];

/**
 * Canonical colour → symbol. A box that names no `symbol` carries its colour's, and a zone of a level that never
 * names a symbol shows its colour's glyph tone on tone (a colour-blind aid). Levels 1–18 name none, so they play and
 * look exactly as before the sorting chapter.
 */
export const DEFAULT_SYMBOL: Readonly<Record<ColorId, SymbolId>> = {
  blue: 'circle',
  mint: 'triangle',
  yellow: 'square',
  coral: 'diamond',
  lavender: 'cross',
};

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
/* Level data (authored as text in src/data/levels/*.level, docs/LEVELS.md; parsed + validated into LevelData) */
/* ------------------------------------------------------------------ */

/**
 * A box of a level. Stacked starts: boxes listed with the same (x, z) form a stack, bottom → top in list order (the
 * first one on the floor, the next on top of it, …; a `.level` file writes it «pila azul,menta»). No height field.
 */
export interface LevelBox {
  id: string;
  color: ColorId;
  /** Symbol on the lid. Omitted = its colour's canonical one (DEFAULT_SYMBOL), as in every level before 19. */
  symbol?: SymbolId;
  x: number;
  z: number;
  kind?: BoxKind;
}

/**
 * A delivery zone. It declares what it accepts, at least one criterion: `color` only = any box of that colour (the
 * classic rule), `symbol` only = any box with that symbol whatever its colour, both = that exact box.
 */
export interface LevelZone {
  id: string;
  /**
   * Colour criterion, drawn as the pad colour (a zone without one gets a neutral pad). With a recipe it must equal
   * recipe[0] (the first box that goes down).
   */
  color?: ColorId;
  /** Symbol criterion, engraved in the pad. Never together with a recipe longer than 1 (recipes are colour-only). */
  symbol?: SymbolId;
  x: number;
  z: number;
  /** Stack this zone asks for, bottom → top. Omitted = one box (the classic rule). Needs `color`. */
  recipe?: ColorId[];
}

/** What a zone asks of its box (the bottom box of a stack zone): a colour, a symbol, or both. At least one is set. */
export interface ZoneCriteria {
  color?: ColorId;
  symbol?: SymbolId;
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
  /**
   * Tallest stack allowed (boxes per cell). Omitted in the raw level: gameConfig `stack.maxHeight` when the level uses
   * stacking (a recipe longer than 1 or a stacked start), else 1 — classic levels never stack.
   * validateLevel always fills it; hand-built LevelData without it counts as 1.
   */
  stackLimit?: number;
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
  /**
   * Extra carriage height in stack levels (0 = floor, 1 = on top of one box, …), continuous while it moves.
   * Rises toward the drop height (carrying) or the target box's level (empty), and early enough to clear any stack
   * the load or the forks are over or about to reach (they never sink into one). Animated by logic; 0 in classic levels.
   */
  forkHeight: number;
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
  /** Symbol on the lid (its level entry, else its colour's canonical one). */
  symbol: SymbolId;
  kind: BoxKind;
  /** World position of the box center on the floor plane. While carried it follows the forks. */
  pos: Vec2;
  /** Grid cell when resting (on the floor or on a stack), null while carried. */
  cell: CellPos | null;
  /** Height in its stack: 0 = on the floor, 1 = on one box, … (0 while carried). */
  level: number;
  carried: boolean;
  /** Zone the box is resting on (accepting it or not), or null. */
  zoneId: string | null;
  /**
   * True when resting on a zone and the stack from the floor up to this box fits it so far: the bottom box accepted
   * by the zone (core/sorting `accepts`), every box above it of the colour its recipe asks for there.
   */
  correct: boolean;
}

export interface ZoneState {
  id: string;
  /**
   * Pad colour: the zone's colour criterion (= `accepts.color`), or null for a neutral pad (a zone that asks for a
   * symbol only). Display only: whether a box fits is always decided by `accepts` (core/sorting).
   */
  color: ColorId | null;
  /** What the zone asks of its box (the bottom box of a stack zone): a colour, a symbol, or both. */
  accepts: ZoneCriteria;
  cell: CellPos;
  pos: Vec2;
  /**
   * The colour of each box the zone holds when done, bottom → top (length 1 = a single-box zone). The bottom box
   * answers to `accepts`, so its entry is only the colour criterion (null when the zone asks no colour); boxes above
   * it follow this colour recipe.
   */
  recipe: (ColorId | null)[];
  /** Box ids resting on this zone, bottom → top. */
  stack: string[];
  /** Top box resting on this zone (accepted or not), or null. */
  occupiedBy: string | null;
  /** True when the zone holds exactly what it asks for: an accepted bottom box and, above it, the recipe's colours. */
  satisfied: boolean;
  /**
   * Colour the zone needs next while its stack is a correct, unfinished prefix, else null (also null for an empty
   * zone that asks no colour). Whether the zone would take a given box next: core/sorting `takesNext`.
   */
  next: ColorId | null;
}

/** Guidance the render layer uses to teach through design (no text). */
export interface InteractionHint {
  /** Box that would be picked up if the action were pressed now. */
  targetBoxId: string | null;
  /** While carrying: the cell the box would be dropped on (null if nowhere valid). */
  dropCell: CellPos | null;
  /** While carrying: the zone at dropCell, if any. */
  dropZoneId: string | null;
  /** While carrying: height the box would land at on dropCell (0 = floor, 1 = on one box, …). */
  dropLevel: number;
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
  | { type: 'boxPicked'; boxId: string; fromZoneId: string | null; /** Height it was lifted from. */ level: number }
  | {
      type: 'boxDropped';
      boxId: string;
      cell: CellPos;
      zoneId: string | null;
      /** Height it landed at (0 = floor). */
      level: number;
      /**
       * This drop completed its zone: a single-box zone now holds a box it accepts (classic: one of its colour), a
       * stack zone its recipe.
       */
      correct: boolean;
      /** Recipe length of that zone (1 = classic zone), 0 when not on a zone. */
      recipeLength: number;
      /** 1-based count of satisfied zones after this drop (for rising chimes). */
      satisfiedCount: number;
      total: number;
    }
  /** Action pressed but nothing to do (no box in reach / no free cell). Feedback must stay gentle. */
  | { type: 'actionIdle'; carrying: boolean }
  /** A satisfied zone stopped being satisfied (its box lifted, or one stacked on top). Neutral, never negative. */
  | { type: 'zoneReleased'; zoneId: string; boxId: string }
  /**
   * Lifting a box (`boxId`) off a zone left it satisfied again: the wrong box on top came off (stacking levels
   * only). Positive, like a completing drop; the counts are as in boxDropped.
   */
  | {
      type: 'zoneRestored';
      zoneId: string;
      boxId: string;
      /** Recipe length of that zone. */
      recipeLength: number;
      /** 1-based count of satisfied zones after this pick (for rising chimes). */
      satisfiedCount: number;
      total: number;
    }
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
