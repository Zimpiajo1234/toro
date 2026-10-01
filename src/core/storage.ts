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
  /**
   * How a drop and a pick sound (metal = slotDrop / slotLift, wood = truckDrop / pickup, belt = beltDrop / pickup):
   * audio/AudioEngine.
   */
  readonly sound: 'metal' | 'wood' | 'belt';
}

/**
 * One row per skin (docs/STORAGE.md): adding a skin = a row here, its words (STORAGE_WORDS) and its drawing. The key
 * order is the order of a level's units (rule 12: racks, then trucks, then the belts' inputs and end exits). `chars` are
 * the canonical letters of before the shared model (three trucks are written T, C, U), so the canonical form of every
 * level stays the same. A conveyor belt (docs/CONVEYOR.md) is two skins, one row per access: its input (`front`, loaded
 * like a rack slot, at its belt's height: its unit's base level) and its end exit (`belt`, never engaged: the belt
 * fills it); one drawing serves both.
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
  beltIn: {
    support: 'shelves',
    // A belt's input (docs/CONVEYOR.md): one level, «libre», on its belt's table (its base level: 1 for a floor belt,
    // a rack's level-1 slot); the box rides on from there.
    maxLevels: 1,
    maxColumns: 1,
    access: 'front',
    idPrefix: 'e',
    chars: 'ADFJ',
    fillToMax: false,
    sound: 'belt',
  },
  beltOut: {
    support: 'shelves',
    // A belt's end exit: one level with its cue (or «libre»), at its belt's height too, filled by the belt only.
    maxLevels: 1,
    maxColumns: 1,
    access: 'belt',
    idPrefix: 's',
    chars: 'BEGK',
    fillToMax: false,
    sound: 'belt',
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
  beltIn: {
    name: 'cinta entrada',
    the: 'la entrada de la cinta',
    a: 'una entrada de cinta',
    many: 'entradas de cinta',
    one: 'una',
    together: 'pegadas',
    of: 'de la entrada de cinta',
    level: 'entrada',
    en: { list: 'beltInputs', one: 'belt input', level: 'level', at: 'on', cell: 'a belt input cell', itsLevel: 'its level' },
  },
  beltOut: {
    name: 'cinta final',
    the: 'la salida final de la cinta',
    a: 'una salida final de cinta',
    many: 'salidas finales de cinta',
    one: 'una',
    together: 'pegadas',
    of: 'de la salida final de cinta',
    level: 'final',
    en: { list: 'beltExits', one: 'belt exit', level: 'level', at: 'in', cell: 'a belt exit cell', itsLevel: 'its level' },
  },
};

/** A level's storage units (none → an empty list): racks, then trucks, then the belts' inputs and end exits (rule 12). */
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

/**
 * Id of a storage slot, in every skin: `${unitId}:${column}:${level}` (column from 0; `level` its level, from its
 * unit's base level up: 0 = at the floor).
 */
export function slotIdOf(unitId: string, column: number, level: number): string {
  return `${unitId}:${column}:${level}`;
}

/**
 * The level of a unit's bottom slot (LevelStorage.baseLevel, docs/STORAGE.md «Nivel base»): 0 at the floor (every rack
 * and truck); a conveyor belt's input and end exit, their belt's height. Below it the unit is solid.
 */
export function baseLevelOf(unit: Pick<LevelStorage, 'baseLevel'>): number {
  return unit.baseLevel ?? 0;
}

/**
 * The side a unit is loaded from: its front's facing (a belt's end exit: the side its belt comes in from); through a
 * door, TRUCK_FACING[wall] (into the room).
 */
export function facingOf(unit: Pick<LevelStorage, 'access'>): Facing {
  return unit.access.kind === 'door' ? TRUCK_FACING[unit.access.wall] : unit.access.facing;
}

/**
 * The cell of `column` (0 = the unit's first): a front or belt unit's own map cell (core/racks `rackCellOf`); a door
 * unit's cell outside the map, one step beyond the wall from its door cell (core/docks `truckCellOf`: z = -1 / x = -1).
 * A box stored in the column rests there.
 */
export function cellOf(unit: Pick<LevelStorage, 'x' | 'z' | 'access'>, column: number): CellPos {
  const { x, z, access } = unit;
  return access.kind === 'door' ? truckCellOf({ x, z, wall: access.wall }, column) : rackCellOf({ x, z, facing: access.facing }, column);
}

/**
 * Where `column` is loaded from, facing it: the floor cell in front of it where the forklift stands (core/racks
 * `frontCellOf`), or its door cell, a map cell against the wall (core/docks `truckFrontOf`); for a belt's end exit, the
 * belt's last cell (the forklift never stands there: the belt fills it).
 */
export function frontOf(unit: Pick<LevelStorage, 'x' | 'z' | 'access'>, column: number): CellPos {
  const { x, z, access } = unit;
  return access.kind === 'door' ? truckFrontOf({ x, z, wall: access.wall }, column) : frontCellOf({ x, z, facing: access.facing }, column);
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
  /** The level of its bottom slot (its unit's baseLevelOf): its levels are baseLevel ‥ baseLevel + cues.length − 1. */
  baseLevel: number;
  /** Index of its bottom level in storageSlotsOf (level baseLevel + n is firstSlot + n). */
  firstSlot: number;
}

/** Every storage column of a level, unit by unit (storage order), column by column. */
export function storageColumnsOf(level: Pick<LevelData, 'storage'>): StorageColumnRef[] {
  const out: StorageColumnRef[] = [];
  let firstSlot = 0;
  storageOf(level).forEach((unit, unitIndex) => {
    const facing = facingOf(unit);
    const baseLevel = baseLevelOf(unit);
    unit.columns.forEach((cues, column) => {
      out.push({ unit, unitIndex, column, cell: cellOf(unit, column), front: frontOf(unit, column), facing, cues, baseLevel, firstSlot });
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
  /**
   * Its level: its unit's base level + its place in the column (0 = the floor: a rack's bottom slot, a truck's bed; a
   * floor belt's input and end exit, 1).
   */
  level: number;
  /** Its column's cell, front and facing (StorageColumnRef). */
  cell: CellPos;
  front: CellPos;
  facing: Facing;
  /** The level's cue; null = «libre». */
  cue: ZoneCriteria | null;
}

/**
 * Every storage slot of a level: unit by unit (racks, then trucks, then the belts' ends), column by column, bottom →
 * top — the order of the targets after the zones (core/sorting `targetsOf`), of the stored boxes' ids and of the
 * snapshot's slots.
 */
export function storageSlotsOf(level: Pick<LevelData, 'storage'>): StorageSlotRef[] {
  const out: StorageSlotRef[] = [];
  for (const col of storageColumnsOf(level)) {
    col.cues.forEach((cue, k) => {
      const lvl = col.baseLevel + k;
      out.push({ id: slotIdOf(col.unit.id, col.column, lvl), unit: col.unit, unitIndex: col.unitIndex, column: col.column, level: lvl, cell: col.cell, front: col.front, facing: col.facing, cue });
    });
  }
  return out;
}
