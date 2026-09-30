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

/** What sorting looks at on a box: its colour and its symbol (two boxes alike in both are interchangeable). */
export interface ColorSymbol {
  color: ColorId;
  symbol: SymbolId;
}

/**
 * A box of a level. Stacked starts: boxes listed with the same (x, z) form a stack, bottom → top in list order (the
 * first one on the floor, the next on top of it, …; a `.level` file writes it «pila azul,menta»). No height field for
 * floor boxes. A box that starts in a storage rack slot has (x, z) = its rack cell and `level` = the slot; one that
 * starts loaded on a truck (docs/DOCKS.md) has (x, z) = its bed cell, outside the map beyond the dock door (core/docks
 * `truckCellOf`: z = -1 for a north dock, x = -1 for a west one), and `level` = its truck level.
 */
export interface LevelBox {
  id: string;
  color: ColorId;
  /** Symbol on the lid. Omitted = its colour's canonical one (DEFAULT_SYMBOL), as in every level before 19. */
  symbol?: SymbolId;
  x: number;
  z: number;
  /**
   * Storage rack slot the box starts in (0 = bottom slot), or its truck level on a truck bed cell (0 = on the bed;
   * the levels below it hold boxes too). Only on rack cells and truck bed cells (outside the map); never on floor
   * boxes.
   */
  level?: number;
  kind?: BoxKind;
}

/**
 * Which way a storage rack's open front looks: its slots are loaded and unloaded only from that side (its cues are
 * visible from both faces).
 */
export const FACINGS = ['north', 'east', 'south', 'west'] as const;
export type Facing = (typeof FACINGS)[number];

/** Most slots a storage rack column holds (floor slot + 2). */
export const MAX_RACK_SLOTS = 3;

/**
 * One slot of a storage rack column: its cue (docs/RACKS.md), shown on the slot's back panel and visible from both
 * faces of the rack. A colour, a symbol or both (like a zone); neither = «libre», plain storage with no destination.
 * A box starting in it is a LevelBox with `level`.
 */
export interface RackSlot {
  color?: ColorId;
  symbol?: SymbolId;
}

/**
 * A storage rack (docs/RACKS.md): 1 cell deep, `w` cells wide, 1–3 slots high per column. Access from `facing` only:
 * it is loaded and unloaded from its front (the floor cell next to each column on the `facing` side); its cues are
 * visible from both faces. Its cells are solid for the forklift body and for floor boxes; the carried load enters a
 * column's cell only from the front, at the selected slot level, into an empty slot. A rack facing north / south runs
 * along x from (x, z); one facing east / west runs along z.
 */
export interface LevelRack {
  id: string;
  /** First cell: the west-most of a rack facing north / south, the north-most of one facing east / west. */
  x: number;
  z: number;
  /** Cells along the rack (= columns.length). */
  w: number;
  facing: Facing;
  /** Per column (first cell first), its slots bottom → top. */
  columns: RackSlot[][];
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

/**
 * Most levels a truck bed column holds (docs/DOCKS.md): the bed + 1 («solo hasta 2 alturas»). Nothing stands over or
 * between the bed columns: the cues are on the framed sign above the dock door.
 */
export const MAX_TRUCK_LEVELS = 2;

/** Most bed columns a truck has (docs/DOCKS.md): its door is 1 to 3 cells wide; the sign above it grows with it. */
export const MAX_TRUCK_COLUMNS = 3;

/**
 * The side a truck is loaded from, by the wall its dock is in (docs/DOCKS.md): a truck in the north wall is loaded
 * from the south (its door cells, row 0, facing north through the door), one in the west wall from the east (column
 * 0, facing west). With it the core/racks geometry reads a truck like a rack whose cells lie one step beyond the wall:
 * core/docks `truckCellOf` (the bed cell, outside the map), `truckFrontOf` (the door cell), `inwardHeading`,
 * `columnFrame` (depth 0 = the wall line).
 */
export const TRUCK_FACING: Readonly<Record<WallSide, Facing>> = { north: 'south', west: 'east' };

/**
 * What one level of a truck bed column asks for (docs/DOCKS.md), shown as a cell of the framed sign above the dock
 * door (one cell per bed column and level): a colour, a symbol or both, like a zone. At least one is set: a truck has
 * no «libre» levels, every level is a target.
 */
export type TruckCue = ZoneCriteria;

/**
 * A loading dock (docs/DOCKS.md): a door in the north or west wall with a truck parked OUTSIDE the building, its rear
 * right against the outer face of the wall at the door. The door is a straight run of `w` map cells along that wall
 * (row z = 0 for a north dock, column x = 0 for a west one): the **door cells**, ordinary floor in front of the door.
 * Each door cell has one **bed column** of the truck just beyond the wall (core/docks `truckCellOf`: z = -1 / x = -1,
 * outside the map). The forklift stands on a door cell facing the wall and loads its bed column through the door
 * exactly like a floor stack (automatic fork height), bottom → top, up to its number of levels; its body never passes
 * the wall line. 1‥MAX_TRUCK_COLUMNS columns of 1‥MAX_TRUCK_LEVELS levels. A box that starts loaded is a LevelBox with
 * (x, z) = its bed cell (outside) and `level` = its truck level.
 */
export interface LevelTruck {
  id: string;
  /** Wall the dock door is in. */
  wall: WallSide;
  /** First door cell (a map cell): the west-most of a north dock (z = 0), the north-most of a west dock (x = 0). */
  x: number;
  z: number;
  /** Door cells along the wall = bed columns (= columns.length, 1‥MAX_TRUCK_COLUMNS). */
  w: number;
  /** Per bed column (first cell first), the cue of each level bottom → top (1‥MAX_TRUCK_LEVELS, ≤ stackLimit). */
  columns: TruckCue[][];
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
  /**
   * Storage racks (docs/RACKS.md). Omitted when the level has none (validateLevel never adds an empty list, so the
   * levels without racks are exactly as before).
   */
  racks?: LevelRack[];
  /**
   * Loading docks (docs/DOCKS.md). Omitted when the level has none (validateLevel never adds an empty list, so the
   * levels without docks are exactly as before). A level with trucks follows the rules of docs/RACKS.md for levels with
   * racks (destined boxes, locks, soft buzz), with or without racks.
   */
  trucks?: LevelTruck[];
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
   * the load or the forks are over or about to reach (they never sink into one). In front of a storage rack it goes
   * to the selected slot level (`hint.rack.level`; slot level n sits at height n). Animated by logic; 0 in classic
   * levels.
   */
  forkHeight: number;
  /** Id of the box on the forks, or null. */
  carrying: string | null;
  /** Accumulated wheel rotation (radians) for visuals. */
  wheelSpin: number;
  /** -1 … 1, current turning intent (visual steer of rear wheels, body lean). */
  steer: number;
  /**
   * Backing up: the one signal the reverse beeper and the beacon on the roof follow, so the beep and the light switch
   * on and off on the same frames (core/reversing: latched with hysteresis on speed / maxSpeed; B and M never touch
   * it). Logic sets it every step; a hand-built state may omit it (reads as false).
   */
  reversing?: boolean;
}

export interface BoxState {
  id: string;
  color: ColorId;
  /** Symbol on the lid (its level entry, else its colour's canonical one). */
  symbol: SymbolId;
  kind: BoxKind;
  /** World position of the box center on the floor plane. While carried it follows the forks. */
  pos: Vec2;
  /**
   * Grid cell when resting (on the floor, on a stack, in a rack slot: its rack cell; on a truck: its bed cell, outside
   * the map beyond the dock door), null while carried.
   */
  cell: CellPos | null;
  /** Height in its stack: 0 = on the floor, 1 = on one box, … ; in a rack, its slot level (0 while carried). */
  level: number;
  carried: boolean;
  /** Zone the box is resting on (accepting it or not), or null. */
  zoneId: string | null;
  /** Storage rack slot the box rests in, or null (always null in levels without racks). */
  slotId: string | null;
  /**
   * Levels with trucks (docs/DOCKS.md): the truck slot the box rests on (`${truckId}:${column}:${level}`, see
   * TruckSlotState), else null; `cell` is then its bed cell (outside the map) and `pos` its centre, `level` its truck
   * level (zoneId and slotId null).
   * GameState sets it on every box of a level with trucks and leaves it undefined in every other level, so their state
   * is exactly as before: undefined reads as null.
   */
  truckSlotId?: string | null;
  /**
   * True when resting on a zone and the stack from the floor up to this box fits it so far: the bottom box accepted
   * by the zone (core/sorting `accepts`), every box above it of the colour its recipe asks for there. In levels with
   * racks or trucks: the box rests alone on its zone, or in its slot, or on its truck slot, and is the destined one
   * (zone / slot / truck slot `satisfied`).
   */
  correct: boolean;
  /**
   * Levels with racks or trucks: true while the box rests on its destined zone, slot or truck slot (docs/RACKS.md,
   * docs/DOCKS.md; the target is `satisfied`). A locked box is done: it can no longer be picked up (the action there
   * gives the gentle `actionIdle`) and nothing can be dropped or stacked on it — except on a truck, where the next
   * level of its bed column can still be loaded on top of it. Always false in levels without racks or trucks.
   */
  locked: boolean;
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
  /**
   * True when the zone holds exactly what it asks for: an accepted bottom box and, above it, the recipe's colours.
   * Levels with racks: exactly one box, of the `destined` kind (a box that merely fits `accepts` leaves it neutral).
   */
  satisfied: boolean;
  /**
   * Colour the zone needs next while its stack is a correct, unfinished prefix, else null (also null for an empty
   * zone that asks no colour). Whether the zone would take a given box next: core/sorting `takesNext`.
   */
  next: ColorId | null;
  /**
   * Levels with racks or trucks: the kind of box the level's unique solution puts here (docs/RACKS.md); only that one
   * satisfies it. null in levels without racks or trucks (satisfied by `accepts`, as always).
   */
  destined: ColorSymbol | null;
}

/**
 * One slot of a storage rack (docs/RACKS.md), in GameSnapshot.slots: every rack, column by column, bottom → top.
 * Whether a carried box fits its cue (what breathes): core/sorting `cueFits`; whether it is the destined one (what
 * lights it): `isDestined`.
 */
export interface SlotState {
  /** `${rackId}:${column}:${level}` (core/racks `slotIdOf`). */
  id: string;
  rackId: string;
  /** Column along the rack (0 = its first cell, see LevelRack). */
  column: number;
  /** Height: 0 = bottom slot. The fork level that reaches it and the box's `level` inside it. */
  level: number;
  /** The rack cell of this column. */
  cell: CellPos;
  /** Floor cell in front of the column: where the forklift stands, facing the rack, to load or unload it. */
  front: CellPos;
  facing: Facing;
  /** World position of the rack cell's centre. */
  pos: Vec2;
  /**
   * The slot's cue (on its back panel, visible from both faces of the rack): a colour, a symbol or both; null =
   * «libre» (plain storage, never a target).
   */
  accepts: ZoneCriteria | null;
  /** The kind of box the level's unique solution puts here; null for a «libre» slot. Only it lights the slot. */
  destined: ColorSymbol | null;
  /** Box resting in the slot, or null. */
  occupiedBy: string | null;
  /** Holds its destined box (never true for a «libre» slot). */
  satisfied: boolean;
}

/**
 * One level of a truck bed column (docs/DOCKS.md), in GameSnapshot.truckSlots: every truck, column by column, bottom
 * → top. The fields it shares with SlotState mean the same, so the core/sorting helpers (`cueFits`, `isDestined`,
 * `satisfiesTarget`) and the glow / lock / success code read both. Unlike a rack slot, a bed column is a stack: its
 * boxes sit on each other from the bed up (the levels below an occupied one are occupied). The bed column lies just
 * outside the building, beyond its door cell: the forklift loads it through the door from `front`.
 */
export interface TruckSlotState {
  /** `${truckId}:${column}:${level}` (column and level from 0; level 0 = on the bed). */
  id: string;
  truckId: string;
  /** Column along the truck bed (0 = its first door cell, see LevelTruck). */
  column: number;
  /** Height: 0 = on the bed, 1 = on one box, … as on a floor stack (the box's `level` there, the drop level). */
  level: number;
  /**
   * The bed cell of this column: OUTSIDE the map, one step beyond the wall from its door cell (a north dock:
   * { x, z: -1 }; a west dock: { x: -1, z }). Boxes on it carry this cell.
   */
  cell: CellPos;
  /**
   * The door cell of the column (floor inside the room, row 0 / column 0): where the forklift stands, facing the wall,
   * to load or unload it through the door.
   */
  front: CellPos;
  /** Wall of its dock. */
  wall: WallSide;
  /** Side the column is loaded from: TRUCK_FACING[wall]. */
  facing: Facing;
  /** World position of the (outside) bed cell's centre. */
  pos: Vec2;
  /** The level's cue (on the sign above the dock door): a colour, a symbol or both. Never null: no «libre» levels. */
  accepts: ZoneCriteria;
  /** The kind of box the level's unique solution puts here (null only in a hand-built level without one). */
  destined: ColorSymbol | null;
  /** Box resting at this level of the column, or null. */
  occupiedBy: string | null;
  /**
   * Holds its destined box and every level below it is satisfied (a column is right from the bed up). Its box is then
   * locked, and the level above can still be loaded.
   */
  satisfied: boolean;
  /**
   * Empty, the lowest empty level of its column (where the next box loaded there lands) and every level below it
   * satisfied: loading its destined box now satisfies it. What may pulse while a box is carried (with `cueFits`).
   */
  loadable: boolean;
}

/**
 * Levels with racks: the rack column the forklift faces (on or approaching its front cell, turned toward it) and the
 * slot level selected with F / V, the mouse wheel or gamepad X / B.
 */
export interface RackHint {
  rackId: string;
  column: number;
  /** Slots in this column (1–3). */
  levels: number;
  /** Selected slot level (0 = bottom): the forks go there and pick / drop act on that slot. */
  level: number;
  /** The slot at that level. */
  slotId: string;
  /**
   * Empty forks: that slot holds a box (also `targetBoxId`). Carrying: it is empty, so the action drops the box into
   * it (`dropCell` = the rack cell, `dropLevel` = the slot level).
   */
  ready: boolean;
}

/** Guidance the render layer uses to teach through design (no text). */
export interface InteractionHint {
  /** Box that would be picked up if the action were pressed now. */
  targetBoxId: string | null;
  /**
   * While carrying: the cell the box would be dropped on (null if nowhere valid; a rack cell for a slot; a truck's bed
   * cell, outside the map, for a truck slot).
   */
  dropCell: CellPos | null;
  /** While carrying: the zone at dropCell, if any. */
  dropZoneId: string | null;
  /** While carrying: height the box would land at on dropCell (0 = floor, 1 = on one box, …; a slot's level). */
  dropLevel: number;
  /** Levels with racks: the rack column faced and the selected slot, or null (always null without racks). */
  rack: RackHint | null;
  /**
   * Levels with trucks, while carrying: the truck slot the box would land in (`dropCell` = its bed cell, outside the
   * map; `dropLevel` = its level, `dropZoneId` null), else null. Undefined in levels without trucks (their hint is
   * exactly as before).
   */
  dropTruckSlotId?: string | null;
}

export interface GameSnapshot {
  level: LevelData;
  forklift: ForkliftState;
  boxes: BoxState[];
  zones: ZoneState[];
  /** Storage rack slots (empty in levels without racks). */
  slots: SlotState[];
  /**
   * Truck slots (docs/DOCKS.md): every truck, column by column, bottom → top. Undefined in levels without trucks, so
   * their snapshot is exactly as before (read it as `snapshot.truckSlots ?? []`).
   */
  truckSlots?: TruckSlotState[];
  hint: InteractionHint;
  completed: boolean;
  /**
   * Targets currently satisfied / total: the zones, plus the slots with a cue in levels with racks, plus every truck
   * slot in levels with trucks.
   */
  progress: { satisfied: number; total: number };
  /**
   * Box moves so far this attempt (the optional move counter): one per box picked up and put down somewhere else,
   * the same count as the solver's «movimientos» metric (src/data/levels/solver.ts), so it compares with
   * levelMinimum() (src/data/levels/minimums.ts). Putting a box back exactly where it was picked up (same cell and
   * height, same rack slot) counts nothing. Counted on the drop (before its boxDropped event); 0 on a fresh GameState
   * (level load, restart).
   */
  moves: number;
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
  /**
   * Edge: fork one slot level up (+1: F, mouse wheel up, gamepad X) or down (−1: V, wheel down, gamepad B). Acts only
   * in front of a storage rack (elsewhere the fork height is automatic, also at a truck: its bed loads like a floor
   * stack). Optional: omitted = 0.
   */
  forkStep?: -1 | 0 | 1;
}

/**
 * Events produced by GameState.update(). Consumed by render (feedback), audio and game/UI. Storage rack slots and
 * truck slots only add optional fields (`fromSlotId`, `slotId`, `fromTruckSlotId`, `truckSlotId`), present only when
 * the event is about one, so events in levels without racks or trucks are exactly as before.
 */
export type GameEvent =
  | { type: 'firstInput' }
  | {
      type: 'boxPicked';
      boxId: string;
      fromZoneId: string | null;
      /** Height it was lifted from (a rack slot's level, a truck level). */
      level: number;
      /** The rack slot it was lifted from (only then present). */
      fromSlotId?: string;
      /** The truck slot it was lifted from (only then present; `fromZoneId` null). */
      fromTruckSlotId?: string;
    }
  | {
      type: 'boxDropped';
      boxId: string;
      cell: CellPos;
      /** Zone it landed on; null on plain floor, in a rack slot and on a truck. */
      zoneId: string | null;
      /** Height it landed at (0 = floor; a rack slot's level; a truck level). */
      level: number;
      /**
       * This drop completed its zone: a single-box zone now holds a box it accepts (classic: one of its colour), a
       * stack zone its recipe. Levels with racks or trucks: its zone, slot or truck slot is now satisfied (holds its
       * destined box; on a truck, on satisfied levels).
       */
      correct: boolean;
      /**
       * Recipe length of that zone (1 = classic zone), 0 when not on a zone. 1 in a slot with a cue, 0 in a «libre»
       * one. 1 on a truck (every truck level has a cue).
       */
      recipeLength: number;
      /** 1-based count of satisfied zones (and slots, and truck slots) after this drop (for rising chimes). */
      satisfiedCount: number;
      total: number;
      /** The rack slot it landed in (only then present; `cell` is the rack cell). */
      slotId?: string;
      /** The truck slot it landed on (only then present; `cell` is the bed cell outside the map, `zoneId` null). */
      truckSlotId?: string;
      /**
       * Levels with racks or trucks only: true when the box landed on a target it does not satisfy — a floor zone, a
       * slot with a cue (a trap box that fits the cue included), or a truck slot (not its destiny, or on top of a level
       * that is not satisfied). Absent otherwise: its destined target (`correct`), a «libre» slot, plain floor, and
       * every drop in levels without racks or trucks.
       */
      wrongTarget?: boolean;
    }
  /** Action pressed but nothing to do (no box in reach / no free cell). Feedback must stay gentle. */
  | { type: 'actionIdle'; carrying: boolean }
  /**
   * A satisfied zone stopped being satisfied (its box lifted, or one stacked on top). Neutral, never negative. For a
   * rack slot (its box lifted), `zoneId` is null and `slotId` names the slot; for a truck slot, `truckSlotId` (never
   * emitted while satisfied truck boxes are locked: docs/DOCKS.md).
   */
  | { type: 'zoneReleased'; zoneId: string | null; boxId: string; slotId?: string; truckSlotId?: string }
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
