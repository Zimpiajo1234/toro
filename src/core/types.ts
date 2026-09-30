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
 * floor boxes. A box that starts stored (docs/STORAGE.md) has (x, z) = the cell of its storage column (core/storage
 * `cellOf`: a storage rack's own cell; a truck's bed cell, outside the map beyond the dock door, z = -1 for a north
 * dock, x = -1 for a west one) and `level` = its level there (a rack slot, a truck level).
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

/** Most slots a storage rack column holds (floor slot + 2): core/storage `STORAGE_SKINS.rack.maxLevels`. */
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
 * The view of a LevelStorage of skin `rack` that core/racks `racksOf` derives (docs/STORAGE.md: until phase 7); a JSON
 * level may still list its racks this way (`racks`, turned into `storage` by validateLevel).
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
 * between the bed columns: the cues are on the framed sign above the dock door. core/storage
 * `STORAGE_SKINS.truck.maxLevels`.
 */
export const MAX_TRUCK_LEVELS = 2;

/**
 * Most bed columns a truck has (docs/DOCKS.md): its door is 1 to 3 cells wide; the sign above it grows with it.
 * core/storage `STORAGE_SKINS.truck.maxColumns`.
 */
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
 * door (one cell per bed column and level): a colour, a symbol or both, like a zone; neither = «libre» (any box, never
 * a target: docs/STORAGE.md rule 7), which only sits above the levels with a cue.
 */
export type TruckCue = ZoneCriteria;

/**
 * A loading dock (docs/DOCKS.md): a door in the north or west wall with a truck parked OUTSIDE the building, its rear
 * right against the outer face of the wall at the door. The door is a straight run of `w` map cells along that wall
 * (row z = 0 for a north dock, column x = 0 for a west one): the **door cells**, ordinary floor in front of the door.
 * Each door cell has one **bed column** of the truck just beyond the wall (core/docks `truckCellOf`: z = -1 / x = -1,
 * outside the map). The forklift stands on a door cell facing the wall and loads its bed column through the door as a
 * stack, bottom → top, up to its number of levels, with the forks set by the keys (F / V: docs/STORAGE.md rule 9); its
 * body never passes the wall line. 1‥MAX_TRUCK_COLUMNS columns of min(MAX_TRUCK_LEVELS, stackLimit) levels each (the
 * written cues bottom → top, the rest «libre»: docs/STORAGE.md rule 7). A box that starts loaded is a LevelBox with
 * (x, z) = its bed cell (outside) and `level` = its truck level.
 * The view of a LevelStorage of skin `truck` that core/docks `trucksOf` derives (docs/STORAGE.md: until phase 7); a
 * JSON level may still list its trucks this way (`trucks`, turned into `storage` by validateLevel).
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
  /** Per bed column (first cell first), the cue of each level bottom → top (min(MAX_TRUCK_LEVELS, stackLimit); `{}` = «libre»). */
  columns: TruckCue[][];
}

/* ------------------------------------------------------------------ */
/* Storage units (docs/STORAGE.md): one model, a skin per look          */
/* ------------------------------------------------------------------ */

/**
 * The skin of a storage unit (docs/STORAGE.md «Modelo»): its drawing plus the few properties its row of core/storage
 * `STORAGE_SKINS` declares (support, heights, columns, access, id prefix, map letters, fill, sound). The logic is one.
 */
export type StorageSkin = 'rack' | 'truck';

/**
 * How the levels of a unit's column hold boxes (`STORAGE_SKINS[skin].support`): `shelves` = every level is a slot of
 * its own, filled and emptied in any order and satisfied alone (a rack); `stack` = the boxes sit on each other from the
 * bottom up, and a level is satisfied only on satisfied levels (a truck bed).
 */
export type StorageSupport = 'shelves' | 'stack';

/**
 * Where a unit is loaded from (docs/STORAGE.md «Acceso»). `front`: from the floor cell next to each column on the
 * `facing` side; the unit's cells are map cells, solid (a rack). `door`: from the door cell of each column, a map cell of
 * row 0 / column 0 against `wall`; the column's cell lies one step beyond the wall, outside the map (a truck).
 */
export type StorageAccess = { kind: 'front'; facing: Facing } | { kind: 'door'; wall: WallSide };

/**
 * A storage unit of a level (docs/STORAGE.md «Modelo», rules 1–3): a straight run of 1‥maxColumns columns, one per
 * cell, each of 1‥maxLevels levels (its skin's row in core/storage `STORAGE_SKINS`; a stack never taller than
 * `stackLimit`; a skin with `fillToMax` gets min(maxLevels, stackLimit) levels in every column, the ones past its
 * written cues «libre», and in a stack the «libre» levels only sit above the ones with a cue: validateLevel). Level
 * data's one source of truth for storage: core/racks `racksOf` and core/docks `trucksOf` derive the old per-skin views
 * from it until phase 7. The geometry of every unit: core/storage (`cellOf`, `frontOf`, `facingOf`, `storageSlotsOf`).
 */
export interface LevelStorage {
  /** Unique among all the level's units; generated: `idPrefix` + its number within its skin (r1, r2… / t1, t2…). */
  id: string;
  skin: StorageSkin;
  /**
   * First cell: a front unit's first own cell (the west-most of a run along x, the north-most of one along z); a door
   * unit's first door cell (the west-most of a north door, z = 0; the north-most of a west door, x = 0).
   */
  x: number;
  z: number;
  /** Columns along the run, one per cell (= columns.length). */
  w: number;
  access: StorageAccess;
  /**
   * Per column (first cell first), the cue of each level bottom → top: a colour, a symbol or both, like a zone; null =
   * «libre» (asks for nothing, never a target). An empty cue is always null here.
   */
  columns: (ZoneCriteria | null)[][];
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
   * Storage units (docs/STORAGE.md): storage racks (docs/RACKS.md), then dock trucks (docs/DOCKS.md) — skin by skin in
   * `STORAGE_SKINS` order, each skin in legend order (rule 12: the order of box ids, targets, snapshot and solver
   * positions). Omitted when the level has none (validateLevel never adds an empty list, so the levels without storage
   * are exactly as before). A level with storage follows the target rules (destined boxes, locks, soft buzz: core/storage
   * `hasStorage`).
   */
  storage?: LevelStorage[];
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
   * Rises toward the drop height (carrying) or the target box's level (empty), and early enough to clear any floor
   * stack the load or the forks are over or about to reach (they never sink into one). At a storage column (any unit:
   * its forks go by the keys, docs/STORAGE.md rule 9) it goes to the level selected there (`hint.storage.level`; level
   * n sits at height n, a shelf's or a stack's). Animated by logic; 0 in classic levels.
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
   * Grid cell when resting (on the floor, on a stack; in storage its column's cell: a rack's own cell, a truck's bed
   * cell outside the map beyond the dock door), null while carried.
   */
  cell: CellPos | null;
  /** Height in its stack: 0 = on the floor, 1 = on one box, … ; in storage, its level there (0 while carried). */
  level: number;
  carried: boolean;
  /** Zone the box is resting on (accepting it or not), or null. */
  zoneId: string | null;
  /**
   * The storage slot the box rests in, in any skin (docs/STORAGE.md: StorageSlotState.id, `${unitId}:${column}:${level}`:
   * a rack slot, a truck level), else null (always null in levels without storage). `cell` is then its column's cell and
   * `level` its level there (zoneId null).
   */
  slotId: string | null;
  /**
   * True when resting on a zone and the stack from the floor up to this box fits it so far: the bottom box accepted
   * by the zone (core/sorting `accepts`), every box above it of the colour its recipe asks for there. In levels with
   * storage: the box rests alone on its zone, or in its storage slot, and is the destined one (zone / slot
   * `satisfied`).
   */
  correct: boolean;
  /**
   * Levels with storage: true while the box rests on its destined zone or storage slot (docs/STORAGE.md rule 5; the
   * target is `satisfied`). A locked box is done: it can no longer be picked up (the action there gives the gentle
   * `actionIdle`) and nothing can be dropped or stacked on it — except in a stack (a truck bed column), where the next
   * level can still be loaded on top of it. Always false in levels without storage.
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
 * One storage slot (docs/STORAGE.md «Modelo»): one level of one column of one storage unit, in any skin (a rack slot,
 * a truck level), in GameSnapshot.storageSlots: unit by unit (rule 12: racks, then trucks), column by column, bottom →
 * top (core/storage `storageSlotsOf`). How its levels hold boxes is its skin's support (core/storage
 * `STORAGE_SKINS[skin].support`): on shelves each level is a slot apart; in a stack the boxes sit on each other from
 * the bottom up (the levels below an occupied one are occupied). Whether a carried box fits its cue (what breathes):
 * core/sorting `cueFits`; whether it is the destined one (what lights it): `isDestined`.
 */
export interface StorageSlotState {
  /** `${unitId}:${column}:${level}` (core/storage `slotIdOf`, the same form in every skin). */
  id: string;
  unitId: string;
  skin: StorageSkin;
  /** Column along the unit (0 = its first cell, see LevelStorage). */
  column: number;
  /**
   * Height: 0 = the bottom level (a rack's bottom slot, a truck's bed). The fork level that reaches it and the box's
   * `level` in it.
   */
  level: number;
  /**
   * Its column's cell: a rack's own cell (inside the map, solid), a truck's bed cell (OUTSIDE the map, one step beyond
   * the wall from its door cell: a north dock { x, z: -1 }, a west dock { x: -1, z }). Boxes stored there carry it.
   */
  cell: CellPos;
  /**
   * Where the forklift stands, facing the column, to load or unload it: the floor cell in front of a rack column, a
   * truck column's door cell (row 0 / column 0, against the wall).
   */
  front: CellPos;
  /** The side it is loaded from (a truck's: TRUCK_FACING[wall]). */
  facing: Facing;
  /** World position of the centre of `cell`. */
  pos: Vec2;
  /**
   * The level's cue (a rack slot's back panel, a cell of the sign above a dock door): a colour, a symbol or both; null =
   * «libre» (plain storage, never a target; in a stack only above the levels with a cue).
   */
  accepts: ZoneCriteria | null;
  /** The kind of box the level's unique solution puts here; null for a «libre» slot. Only it lights the slot. */
  destined: ColorSymbol | null;
  /** Box resting at this level, or null. */
  occupiedBy: string | null;
  /**
   * Holds its destined box (never true for a «libre» slot); in a stack also every level below it is satisfied (a
   * column is right from the bottom up). Its box is then locked; in a stack the level above can still be loaded.
   */
  satisfied: boolean;
  /**
   * Loading its destined box now satisfies it (docs/STORAGE.md rule 8): on shelves, empty; in a stack, the lowest empty
   * level of its column (where the next box loaded there lands) with every level below it satisfied. Only for the
   * light (the target hints, the drop preview's tone), never for whether a drop is allowed.
   */
  loadable: boolean;
}

/**
 * Levels with storage (docs/STORAGE.md): the storage column the forklift works at and the level chosen there, in any
 * skin (`skin`; its support, core/storage `STORAGE_SKINS[skin].support`, says how the forks reach that level: a shelf's
 * height, dims `rackSlotY`, or a stack level). The forks go by the keys at every unit (F / V, the mouse wheel, gamepad
 * X / B: rule 9): it is there while the forklift faces the column or is still held at it (and does not lift a floor
 * box there), the level being the one selected.
 */
export interface StorageHint {
  unitId: string;
  skin: StorageSkin;
  column: number;
  /** Levels in this column (a rack's 1–3 slots, a truck's 1–2 levels). */
  levels: number;
  /** The level chosen (0 = bottom): the one selected with F / V (the forks go there and pick / drop act on it). */
  level: number;
  /** The slot at that level. */
  slotId: string;
  /**
   * Empty forks: the action lifts the box at that level (also `targetBoxId`; in a stack only its top box). Carrying:
   * the action drops the box into it (`dropCell` = the column's cell, `dropLevel` = the level; in a stack only its next
   * free level).
   */
  ready: boolean;
}

/** Guidance the render layer uses to teach through design (no text). */
export interface InteractionHint {
  /** Box that would be picked up if the action were pressed now. */
  targetBoxId: string | null;
  /**
   * While carrying: the cell the box would be dropped on (null if nowhere valid; into storage its column's cell: a rack
   * cell, or a truck's bed cell outside the map).
   */
  dropCell: CellPos | null;
  /** While carrying: the zone at dropCell, if any. */
  dropZoneId: string | null;
  /** While carrying: height the box would land at on dropCell (0 = floor, 1 = on one box, …; a storage level). */
  dropLevel: number;
  /** Levels with storage: the column worked at and the level chosen there (StorageHint), else null (always without). */
  storage: StorageHint | null;
}

export interface GameSnapshot {
  level: LevelData;
  forklift: ForkliftState;
  boxes: BoxState[];
  zones: ZoneState[];
  /** Every storage slot (docs/STORAGE.md), in core/storage `storageSlotsOf` order; empty in levels without storage. */
  storageSlots: StorageSlotState[];
  hint: InteractionHint;
  completed: boolean;
  /** Targets currently satisfied / total: the zones, plus the storage slots with a cue in levels with storage. */
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
   * Edge: fork one level up (+1: F, mouse wheel up, gamepad X) or down (−1: V, wheel down, gamepad B). Acts only at a
   * storage column (every unit: docs/STORAGE.md rule 9); elsewhere the fork height is automatic, as on the floor.
   * Optional: omitted = 0.
   */
  forkStep?: -1 | 0 | 1;
}

/**
 * Events produced by GameState.update(). Consumed by render (feedback), audio and game/UI. Storage slots (docs/
 * STORAGE.md, any skin) only add optional fields, present only when the event is about one: its id (`fromSlotId`,
 * `slotId`) and, with it, the skin of its unit (`skin`: how it sounds and looks: core/storage `STORAGE_SKINS[skin]`), so
 * events in levels without storage are exactly as before.
 */
export type GameEvent =
  | { type: 'firstInput' }
  | {
      type: 'boxPicked';
      boxId: string;
      fromZoneId: string | null;
      /** Height it was lifted from (a storage level: a rack slot's, a truck level). */
      level: number;
      /** The storage slot it was lifted from (only then present; `fromZoneId` null). */
      fromSlotId?: string;
      /** The skin of that slot's unit (present with `fromSlotId`). */
      skin?: StorageSkin;
    }
  | {
      type: 'boxDropped';
      boxId: string;
      cell: CellPos;
      /** Zone it landed on; null on plain floor and in storage. */
      zoneId: string | null;
      /** Height it landed at (0 = floor; a storage level: a rack slot's, a truck level). */
      level: number;
      /**
       * This drop completed its zone: a single-box zone now holds a box it accepts (classic: one of its colour), a
       * stack zone its recipe. Levels with storage: its zone or storage slot is now satisfied (holds its destined box;
       * in a stack, on satisfied levels).
       */
      correct: boolean;
      /**
       * Recipe length of that zone (1 = classic zone), 0 when not on a zone. In storage: 1 in a slot with a cue, 0 in a
       * «libre» one (any skin).
       */
      recipeLength: number;
      /** 1-based count of satisfied zones (and storage slots) after this drop (for rising chimes). */
      satisfiedCount: number;
      total: number;
      /** The storage slot it landed in (only then present; `cell` is its column's cell, outside the map on a truck). */
      slotId?: string;
      /** The skin of that slot's unit (present with `slotId`). */
      skin?: StorageSkin;
      /**
       * Levels with storage only: true when the box landed on a target it does not satisfy — a floor zone or a storage
       * slot with a cue (a trap box that fits the cue included; in a stack also on top of a level that is not
       * satisfied). Absent otherwise: its destined target (`correct`), a «libre» slot, plain floor, and every drop in
       * levels without storage.
       */
      wrongTarget?: boolean;
    }
  /** Action pressed but nothing to do (no box in reach / no free cell). Feedback must stay gentle. */
  | { type: 'actionIdle'; carrying: boolean }
  /**
   * A satisfied zone stopped being satisfied (its box lifted, or one stacked on top). Neutral, never negative. For a
   * storage slot (its box lifted), `zoneId` is null and `slotId` names the slot, `skin` its unit's skin (never emitted
   * while a satisfied box is locked: docs/STORAGE.md rule 5).
   */
  | { type: 'zoneReleased'; zoneId: string | null; boxId: string; slotId?: string; skin?: StorageSkin }
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
