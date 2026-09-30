/**
 * The shared storage model (docs/STORAGE.md): a level's storage units (`level.storage`, LevelStorage), whatever they
 * look like — a storage rack, a dock truck, the skins still to come. `STORAGE_SKINS` declares what a skin brings
 * besides its drawing; the geometry here serves every unit through its access, on the math of core/racks (`front`: the
 * unit's own map cells, loaded from the floor cell in front) and of core/docks (`door`: cells one step beyond the wall,
 * outside the map, loaded from the door cells). Not to be confused with src/storage (the saved progress). Pure.
 */
import {
  MAX_RACK_SLOTS,
  MAX_TRUCK_COLUMNS,
  MAX_TRUCK_LEVELS,
  TRUCK_FACING,
  type CellPos,
  type Facing,
  type LevelData,
  type LevelStorage,
  type StorageAccess,
  type StorageSkin,
  type StorageSupport,
  type ZoneCriteria,
} from './types';
import { frontCellOf, rackCellOf, slotIdOf } from './racks';
import { truckCellOf, truckFrontOf } from './docks';

export { inwardHeading, slotIdOf } from './racks';

/** What a storage skin declares besides its drawing: its row of STORAGE_SKINS (docs/STORAGE.md «Modelo»). */
export interface StorageSkinRow {
  /** How the levels of a column hold boxes: shelves (each level apart) or a stack (bottom → top). */
  readonly support: StorageSupport;
  /** Most levels per column (a stack is never taller than the level's stackLimit either). */
  readonly maxLevels: number;
  /** Most columns per unit (Infinity = no limit). */
  readonly maxColumns: number;
  /** The access of every unit of the skin (its `access.kind`). */
  readonly access: StorageAccess['kind'];
  /** Unit ids are the prefix + a number within the skin (r1, r2…); prefixes differ, so no two level ids clash. */
  readonly idPrefix: string;
  /** Map letters the canonical `.level` form hands the skin's units, one each, in this order (data/asciiLevel). */
  readonly chars: string;
  /** Phase 6: every column holds min(maxLevels, stackLimit) levels, the ones past its cues «libre». Unread until then. */
  readonly fillToMax: boolean;
  /** How a drop and a pick sound (metal = slotDrop / slotLift, wood = truckDrop / pickup): the audio reads it (phase 3). */
  readonly sound: 'metal' | 'wood';
}

/**
 * One row per skin (docs/STORAGE.md): adding a skin = a row here + its drawing. The key order is the order of a
 * level's units (rule 12: racks, then trucks). `chars` are the canonical letters of before the shared model (three
 * trucks are written T, C, U: docs/STORAGE.md «Huecos» 1), so the canonical form of every level stays the same.
 */
export const STORAGE_SKINS: { readonly [S in StorageSkin]: StorageSkinRow } = {
  rack: {
    support: 'shelves',
    maxLevels: MAX_RACK_SLOTS,
    maxColumns: Infinity,
    access: 'front',
    idPrefix: 'r',
    chars: 'RSTUVWXYZKLMNO',
    fillToMax: false,
    sound: 'metal',
  },
  truck: {
    support: 'stack',
    maxLevels: MAX_TRUCK_LEVELS,
    maxColumns: MAX_TRUCK_COLUMNS,
    access: 'door',
    idPrefix: 't',
    chars: 'TCUVWXYZKLMNO',
    fillToMax: true,
    sound: 'wood',
  },
};

/** The skins in STORAGE_SKINS order: a level lists its units skin by skin in this order (rule 12). */
export const STORAGE_SKIN_ORDER = Object.keys(STORAGE_SKINS) as readonly StorageSkin[];

/** A level's storage units (none → an empty list): racks, then trucks (rule 12). */
export function storageOf(level: Pick<LevelData, 'storage'>): readonly LevelStorage[] {
  return level.storage ?? [];
}

/**
 * The level has storage, so the target rules apply (docs/STORAGE.md rules 4–6: destined boxes, locks, soft buzz, strong
 * pulse; core/docks `usesTargetRules` is its old name). Levels without storage play exactly as before.
 */
export function hasStorage(level: Pick<LevelData, 'storage'>): boolean {
  return (level.storage?.length ?? 0) > 0;
}

/** The side a unit is loaded from: its front's facing; through a door, TRUCK_FACING[wall] (into the room). */
export function facingOf(unit: Pick<LevelStorage, 'access'>): Facing {
  return unit.access.kind === 'front' ? unit.access.facing : TRUCK_FACING[unit.access.wall];
}

/**
 * The cell of `column` (0 = the unit's first): a front unit's own map cell (core/racks `rackCellOf`); a door unit's
 * cell outside the map, one step beyond the wall from its door cell (core/docks `truckCellOf`: z = -1 / x = -1). A box
 * stored in the column rests there.
 */
export function cellOf(unit: Pick<LevelStorage, 'x' | 'z' | 'access'>, column: number): CellPos {
  const { x, z, access } = unit;
  return access.kind === 'front' ? rackCellOf({ x, z, facing: access.facing }, column) : truckCellOf({ x, z, wall: access.wall }, column);
}

/**
 * Where the forklift stands to load `column`, facing it: the floor cell in front of it (core/racks `frontCellOf`), or
 * its door cell, a map cell against the wall (core/docks `truckFrontOf`).
 */
export function frontOf(unit: Pick<LevelStorage, 'x' | 'z' | 'access'>, column: number): CellPos {
  const { x, z, access } = unit;
  return access.kind === 'front' ? frontCellOf({ x, z, facing: access.facing }, column) : truckFrontOf({ x, z, wall: access.wall }, column);
}

/** One column of a level's storage, flattened: unit by unit, column by column. */
export interface StorageColumnRef {
  unit: LevelStorage;
  /** Its unit's index in storageOf. */
  unitIndex: number;
  column: number;
  /** Its cell (cellOf: inside or outside the map), where it is loaded from (frontOf) and that side (facingOf). */
  cell: CellPos;
  front: CellPos;
  facing: Facing;
  /** Its levels' cues, bottom → top (null = «libre»). */
  cues: readonly (ZoneCriteria | null)[];
  /** Index of its bottom level in storageSlotsOf (level n is firstSlot + n). */
  firstSlot: number;
}

/** Every storage column of a level, unit by unit (storage order), column by column. */
export function storageColumnsOf(level: Pick<LevelData, 'storage'>): StorageColumnRef[] {
  const out: StorageColumnRef[] = [];
  let firstSlot = 0;
  storageOf(level).forEach((unit, unitIndex) => {
    const facing = facingOf(unit);
    unit.columns.forEach((cues, column) => {
      out.push({ unit, unitIndex, column, cell: cellOf(unit, column), front: frontOf(unit, column), facing, cues, firstSlot });
      firstSlot += cues.length;
    });
  });
  return out;
}

/**
 * One level of a storage column (a slot, in any skin), flattened in storageSlotsOf order. Its fields mean what they
 * do in the snapshot's StorageSlotState (GameSnapshot.storageSlots, the same order).
 */
export interface StorageSlotRef {
  /** `${unitId}:${column}:${level}` (slotIdOf, the same form in every skin). */
  id: string;
  unit: LevelStorage;
  unitIndex: number;
  column: number;
  /** 0 = the bottom level (a rack's bottom slot, a truck's bed). */
  level: number;
  /** Its column's cell, front and facing (StorageColumnRef). */
  cell: CellPos;
  front: CellPos;
  facing: Facing;
  /** The level's cue; null = «libre». */
  cue: ZoneCriteria | null;
}

/**
 * Every storage slot of a level: unit by unit (racks, then trucks), column by column, bottom → top — the order of the
 * targets after the zones (core/sorting `targetsOf`), of the stored boxes' ids and of the snapshot's slots.
 */
export function storageSlotsOf(level: Pick<LevelData, 'storage'>): StorageSlotRef[] {
  const out: StorageSlotRef[] = [];
  for (const col of storageColumnsOf(level)) {
    col.cues.forEach((cue, lvl) =>
      out.push({ id: slotIdOf(col.unit.id, col.column, lvl), unit: col.unit, unitIndex: col.unitIndex, column: col.column, level: lvl, cell: col.cell, front: col.front, facing: col.facing, cue }),
    );
  }
  return out;
}
