/**
 * The shared storage model (docs/STORAGE.md): a level's storage units (`level.storage`, LevelStorage), whatever they
 * look like — a storage rack, a dock truck, the skins still to come. `STORAGE_SKINS` declares what a skin brings
 * besides its drawing and `STORAGE_WORDS` how the texts name it; the geometry here serves every unit through its
 * access, on the math of core/racks (`front`: the unit's own map cells, loaded from the floor cell in front) and of
 * core/docks (`door`: cells one step beyond the wall, outside the map, loaded from the door cells). Not to be confused
 * with src/storage (the saved progress). Pure.
 */
import {
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
import { frontCellOf, rackCellOf } from './racks';
import { truckCellOf, truckFrontOf } from './docks';

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
  /**
   * Every column holds min(maxLevels, stackLimit) levels: its written cues bottom → top, the rest «libre» (docs/STORAGE.md
   * rule 7; validateLevel fills them, the canonical `.level` form leaves those implicit ones out: data/asciiLevel).
   */
  readonly fillToMax: boolean;
  /** How a drop and a pick sound (metal = slotDrop / slotLift, wood = truckDrop / pickup): audio/AudioEngine. */
  readonly sound: 'metal' | 'wood';
}

/**
 * One row per skin (docs/STORAGE.md): adding a skin = a row here, its words (STORAGE_WORDS) and its drawing. The key
 * order is the order of a level's units (rule 12: racks, then trucks). `chars` are the canonical letters of before the
 * shared model (three trucks are written T, C, U), so the canonical form of every level stays the same.
 */
export const STORAGE_SKINS: { readonly [S in StorageSkin]: StorageSkinRow } = {
  rack: {
    support: 'shelves',
    // The floor slot + 2 (docs/RACKS.md).
    maxLevels: 3,
    maxColumns: Infinity,
    access: 'front',
    idPrefix: 'r',
    chars: 'RSTUVWXYZKLMNO',
    fillToMax: false,
    sound: 'metal',
  },
  truck: {
    support: 'stack',
    // «Solo hasta 2 alturas», on a door 1 to 3 cells wide (docs/DOCKS.md).
    maxLevels: 2,
    maxColumns: 3,
    access: 'door',
    idPrefix: 't',
    chars: 'TCUVWXYZKLMNO',
    fillToMax: true,
    sound: 'wood',
  },
};

/** The skins in STORAGE_SKINS order: a level lists its units skin by skin in this order (rule 12). */
export const STORAGE_SKIN_ORDER = Object.keys(STORAGE_SKINS) as readonly StorageSkin[];

/**
 * How the texts name a skin's units and their levels (docs/STORAGE.md «Cómo añadir un aspecto nuevo»): the Spanish
 * words of the `.level` messages (data/asciiLevel) and of the plan `npm run levels` prints (data/levels/report), and in
 * `en` the English words of validateLevel's messages (asciiLevel reads those messages back: they never change).
 */
export interface StorageWords {
  /** The unit's word in the canonical legend and in the plan: «estantería frente sur: …», «camión T». */
  readonly name: string;
  /** «la estantería», «una estantería», «estanterías». */
  readonly the: string;
  readonly a: string;
  readonly many: string;
  /** Agreement: «un id solo puede ir en una», «dos estanterías pegadas». */
  readonly one: string;
  readonly together: string;
  /** How messages name a unit by its letter: «también es el de la estantería «R»». */
  readonly of: string;
  /** One level of a column: «falta la pista del hueco», «el hueco de abajo», the plan's «hueco 2 de R». */
  readonly level: string;
  readonly en: {
    /** The skin's legacy JSON list, and so a unit's name: `racks[0]`. */
    readonly list: string;
    /** One unit: «duplicate rack id». */
    readonly one: string;
    /** One level of a column: «slot 2» (plural + s). */
    readonly level: string;
    /** A box stored on the unit: «is in a rack cell: give it the level of its slot». */
    readonly at: string;
    readonly cell: string;
    readonly itsLevel: string;
  };
}

/** One row per skin, next to its STORAGE_SKINS row. */
export const STORAGE_WORDS: { readonly [S in StorageSkin]: StorageWords } = {
  rack: {
    name: 'estantería',
    the: 'la estantería',
    a: 'una estantería',
    many: 'estanterías',
    one: 'una',
    together: 'pegadas',
    of: 'de la estantería',
    level: 'hueco',
    en: { list: 'racks', one: 'rack', level: 'slot', at: 'in', cell: 'a rack cell', itsLevel: 'the level of its slot' },
  },
  truck: {
    name: 'camión',
    the: 'el camión',
    a: 'un camión',
    many: 'camiones',
    one: 'uno',
    together: 'pegados',
    of: 'del camión',
    level: 'nivel',
    en: { list: 'trucks', one: 'truck', level: 'level', at: 'on', cell: 'a truck bed cell', itsLevel: 'its truck level' },
  },
};

/** A level's storage units (none → an empty list): racks, then trucks (rule 12). */
export function storageOf(level: Pick<LevelData, 'storage'>): readonly LevelStorage[] {
  return level.storage ?? [];
}

/**
 * The level has storage, so the target rules apply (docs/STORAGE.md rules 4–6: destined boxes, locks, soft buzz, strong
 * pulse) and the forks go by the keys at its units (rule 9: F / V step there, the control hint's fork row, their
 * click). Levels without storage play exactly as before.
 */
export function hasStorage(level: Pick<LevelData, 'storage'>): boolean {
  return (level.storage?.length ?? 0) > 0;
}

/** Id of a storage slot, in every skin: `${unitId}:${column}:${level}` (column and level from 0; level 0 = bottom). */
export function slotIdOf(unitId: string, column: number, level: number): string {
  return `${unitId}:${column}:${level}`;
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
