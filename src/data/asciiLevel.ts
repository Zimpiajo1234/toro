/**
 * Level text format: one `*.level` file per level, a readable ASCII map plus a legend in Spanish. Full grammar,
 * examples and metrics: docs/LEVELS.md.
 *
 * - parseLevel(text, file): text → raw level object → validateLevel → LevelData, plus its `dificultad:` targets and
 *   `nota:` lines. Every authoring mistake throws a LevelFormatError "file:line:column: motivo" (in Spanish).
 * - renderLevel(level): LevelData → canonical text. parseLevel(renderLevel(level)).level deep-equals the level (the
 *   level tests check it for every shipped level) and rendering the result again gives the same text.
 * - parseLevelDraft(text, file): the raw level object parseLevel hands to validateLevel (map and legend checked).
 * Storage units (docs/STORAGE.md: `level.storage`): storage racks, docs/RACKS.md; loading docks (trucks), docs/DOCKS.md.
 * Pure: no DOM, no three.
 */
import {
  BOX_KINDS,
  type BoxKind,
  type ColorId,
  type Facing,
  type LevelData,
  type LevelStorage,
  type LevelZone,
  type StorageAccess,
  type StorageSkin,
  type SymbolId,
  type WallSide,
  type ZoneCriteria,
} from '../core/types';
import { runsAlongX } from '../core/racks';
import { STORAGE_SKINS, STORAGE_SKIN_ORDER, cellOf, frontOf, storageOf } from '../core/storage';
import { DifficultySyntaxError, formatTargets, parseTargets, type DifficultyTarget } from './difficulty';
import { validateLevel } from './validateLevel';

export interface ParsedLevel {
  level: LevelData;
  /** `dificultad:` targets, in file order (the level tests check them against the measured metrics). */
  targets: DifficultyTarget[];
  /** `nota:` lines, in file order (kept by the formatter). */
  notes: string[];
}

/**
 * What parseLevel hands to validateLevel: the raw level object, its map and legend already checked (no defaults, none
 * of validateLevel's rules), plus its `dificultad:` targets and `nota:` lines.
 */
export interface LevelDraft {
  raw: Record<string, unknown>;
  targets: DifficultyTarget[];
  notes: string[];
}

/** What renderLevel writes besides the level itself (so formatting a file keeps them). */
export interface RenderExtras {
  targets?: readonly DifficultyTarget[];
  notes?: readonly string[];
}

/** An authoring mistake: `message` is "file:line:column: reason" (1-based line and column). */
export class LevelFormatError extends Error {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly reason: string;
  constructor(file: string, line: number, column: number, reason: string) {
    super(`${file}:${line}:${column}: ${reason}`);
    this.name = 'LevelFormatError';
    this.file = file;
    this.line = line;
    this.column = column;
    this.reason = reason;
  }
}

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

/** Lower case, no accents, no emoji variation selectors: how every keyword is compared. */
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f\ufe0e\ufe0f]/g, '').toLowerCase();

/** Own-property lookup in a word table (a word like "constructor" is not a colour). */
function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Map characters with a fixed meaning (never defined in the legend). */
const RESERVED: ReadonlySet<string> = new Set(['.', '#', 'p', '^', '>', 'v', '<']);
/** Forklift arrows → heading in degrees (heading 0 faces +z = south, 90 faces +x = east). */
const ARROW_HEADING: Readonly<Record<string, number>> = { v: 0, '>': 90, '^': 180, '<': 270 };
const ARROW_BY_QUARTER = ['v', '>', '^', '<'] as const;
const DEFAULT_TIERS = 2;

/** The arrow drawn for a heading: the nearest cardinal direction. */
export function arrowOf(heading: number): string {
  return ARROW_BY_QUARTER[((Math.round(heading / 90) % 4) + 4) % 4];
}

const COLOR_WORDS: Readonly<Record<string, ColorId>> = {
  azul: 'blue',
  blue: 'blue',
  menta: 'mint',
  mint: 'mint',
  amarillo: 'yellow',
  amarilla: 'yellow',
  yellow: 'yellow',
  coral: 'coral',
  lavanda: 'lavender',
  lavender: 'lavender',
};
/** Spanish colour names used when rendering. */
export const COLOR_NAMES: Readonly<Record<ColorId, string>> = {
  blue: 'azul',
  mint: 'menta',
  yellow: 'amarillo',
  coral: 'coral',
  lavender: 'lavanda',
};
const SYMBOL_WORDS: Readonly<Record<string, SymbolId>> = {
  '●': 'circle',
  '○': 'circle',
  circulo: 'circle',
  circle: 'circle',
  '▲': 'triangle',
  '△': 'triangle',
  triangulo: 'triangle',
  triangle: 'triangle',
  '■': 'square',
  '□': 'square',
  cuadrado: 'square',
  square: 'square',
  '◆': 'diamond',
  '◇': 'diamond',
  rombo: 'diamond',
  diamond: 'diamond',
  '✚': 'cross',
  cruz: 'cross',
  cross: 'cross',
};
/** Glyphs used when rendering (the lid / engraving shapes). */
export const SYMBOL_GLYPHS: Readonly<Record<SymbolId, string>> = {
  circle: '●',
  triangle: '▲',
  square: '■',
  diamond: '◆',
  cross: '✚',
};
/** Symbol glyphs split words even without a space ("azul▲"). */
const GLYPH_CHARS = new Set(Object.keys(SYMBOL_WORDS).filter((k) => k.length === 1));
const KIND_WORDS: Readonly<Record<string, BoxKind>> = {
  ...Object.fromEntries(BOX_KINDS.map((k) => [norm(k), k])),
  estandar: 'standard',
  normal: 'standard',
};
const WALL_WORDS: Readonly<Record<string, WallSide>> = { norte: 'north', north: 'north', oeste: 'west', west: 'west' };
const WALL_NAMES: Readonly<Record<WallSide, string>> = { north: 'norte', west: 'oeste' };
/** Which way a storage rack's front looks (docs/RACKS.md). */
const FACING_WORDS: Readonly<Record<string, Facing>> = {
  norte: 'north',
  north: 'north',
  este: 'east',
  east: 'east',
  sur: 'south',
  south: 'south',
  oeste: 'west',
  west: 'west',
};
/** Spanish facing names used when rendering. */
export const FACING_NAMES: Readonly<Record<Facing, string>> = { north: 'norte', east: 'este', south: 'sur', west: 'oeste' };
const TIER_WORDS: ReadonlySet<string> = new Set(['altura', 'alturas', 'balda', 'baldas', 'nivel', 'niveles', 'piso', 'pisos']);

type HeaderKey = 'id' | 'limit' | 'tema' | 'ventanas' | 'rumbo' | 'dificultad' | 'nota';
const HEADER_KEYS: Readonly<Record<string, HeaderKey>> = {
  id: 'id',
  limit: 'limit',
  limite: 'limit',
  tema: 'tema',
  theme: 'tema',
  ventanas: 'ventanas',
  ventana: 'ventanas',
  rumbo: 'rumbo',
  orientacion: 'rumbo',
  dificultad: 'dificultad',
  nota: 'nota',
  notas: 'nota',
};
const HEADER_LIST = 'id, limit, tema, ventanas, rumbo, dificultad o nota';
const ELEMENTS = ['caja', 'pila', 'zona', 'estantería', 'camión', 'planta'];
const RACK_EXAMPLE = '«a = estantería frente sur: azul / ▲ + caja coral / libre»';
/** A loading dock's truck (docs/DOCKS.md): «camión muelle norte: …». */
const TRUCK_EXAMPLE = '«T = camión muelle norte: azul / ▲ | coral ●»';
/** First word of a truck entry. */
const TRUCK_HEADS: ReadonlySet<string> = new Set(['camion', 'truck', 'muelle', 'dock']);
/** Words allowed between «camión» and its wall: «camión muelle norte», «camión en el muelle norte». */
const TRUCK_FILLERS: ReadonlySet<string> = new Set(['muelle', 'dock', 'en', 'el', 'del', 'de']);
/** How id messages name an element, and its generated ids. */
interface IdWords {
  of: string;
  generated: string;
}
const ID_WORDS = {
  caja: { of: 'de la caja', generated: 'b1, b2…' },
  zona: { of: 'de la zona', generated: 'z1, z2…' },
} as const satisfies Record<string, IdWords>;

/** How the messages name the units of each storage skin (docs/STORAGE.md), in the legend and on the map. */
interface UnitWords {
  /** Its word in the canonical legend («estantería frente sur: …», «camión muelle norte: …»). */
  name: string;
  /** «la estantería», «una estantería», «estanterías». */
  the: string;
  a: string;
  many: string;
  /** Agreement: «un id solo puede ir en una», «dos estanterías pegadas». */
  one: string;
  together: string;
  /** How id messages name it: «también es el de la estantería «R»». */
  of: string;
}
const UNIT_WORDS: { readonly [S in StorageSkin]: UnitWords } = {
  rack: { name: 'estantería', the: 'la estantería', a: 'una estantería', many: 'estanterías', one: 'una', together: 'pegadas', of: 'de la estantería' },
  truck: { name: 'camión', the: 'el camión', a: 'un camión', many: 'camiones', one: 'uno', together: 'pegados', of: 'del camión' },
};

/** The id words of a skin's units: generated ids are its prefix and a number (r1, r2…). */
function unitIdWords(skin: StorageSkin): IdWords {
  const p = STORAGE_SKINS[skin].idPrefix;
  return { of: UNIT_WORDS[skin].of, generated: `${p}1, ${p}2…` };
}
const COLOR_LIST = 'azul, menta, amarillo, coral o lavanda';
const SYMBOL_LIST = '● ▲ ■ ◆ ✚ (o círculo, triángulo, cuadrado, rombo, cruz)';

/** Levenshtein distance, for "¿quisiste decir…?" hints. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

function suggest(word: string, candidates: readonly string[]): string {
  const w = norm(word);
  let best = '';
  let bestDistance = w.length > 3 ? 3 : 2;
  for (const c of candidates) {
    const d = distance(w, norm(c));
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best ? `; ¿quisiste decir «${best}»?` : '';
}

const WORDS_FOR_HINTS = [...Object.keys(COLOR_WORDS), 'círculo', 'triángulo', 'cuadrado', 'rombo', 'cruz', 'pila', 'tipo', 'receta'];

/* ------------------------------------------------------------------ */
/* Parser                                                              */
/* ------------------------------------------------------------------ */

interface Pos {
  line: number;
  column: number;
}

interface Tok {
  kind: 'word' | ',' | '+' | 'id' | ':' | '/' | '|';
  text: string;
  /** Normalised text (words), the raw text otherwise. */
  key: string;
  pos: Pos;
}

interface BoxSpec {
  color: ColorId;
  symbol?: SymbolId;
  kind?: BoxKind;
  id?: string;
  idPos?: Pos;
}

interface ZoneSpec {
  color?: ColorId;
  symbol?: SymbolId;
  recipe?: ColorId[];
  id?: string;
  idPos?: Pos;
}

/**
 * One slot of a storage rack, or one level of a truck bed column, in the legend: its cue (none = «libre», racks only)
 * and the box that starts in it.
 */
interface SlotSpec {
  color?: ColorId;
  symbol?: SymbolId;
  box?: BoxSpec;
  /** Where its text starts in the legend. */
  pos: Pos;
}

/**
 * A storage unit character (docs/STORAGE.md): a storage rack «estantería frente sur: … | …» (docs/RACKS.md) or a truck
 * «camión muelle norte: … | …» (docs/DOCKS.md).
 */
interface UnitSpec {
  skin: StorageSkin;
  access: StorageAccess;
  /** Per column (along the rack, along the wall), levels bottom → top. */
  columns: SlotSpec[][];
  id?: string;
  idPos?: Pos;
}

/** How the messages of a column list name its parts (a rack's slots, a truck's levels). */
interface ColumnWords {
  /** A level with no cue at all (two separators in a row). */
  missing: string;
  /** More levels than a column holds. */
  tooMany: string;
  /** A second colon. */
  colon: string;
  /** How one level is named: «un hueco» / «un nivel del camión». */
  one: string;
  /** Whether «libre» (no cue) is allowed. */
  free: boolean;
}

const RACK_WORDS: ColumnWords = {
  missing: `falta un hueco: su pista (color, símbolo, ambos o «libre»), de abajo arriba, p. ej. ${RACK_EXAMPLE}`,
  tooMany: `una columna de estantería tiene como mucho ${STORAGE_SKINS.rack.maxLevels} huecos (suelo + 2); para otra columna, sepárala con «|»`,
  colon: 'los dos puntos van una sola vez, tras «frente …»',
  one: 'un hueco',
  free: true,
};

const TRUCK_WORDS: ColumnWords = {
  missing: `falta un nivel: su pista (color, símbolo o ambos), de abajo arriba, p. ej. ${TRUCK_EXAMPLE}`,
  tooMany: `una columna del camión lleva como mucho ${STORAGE_SKINS.truck.maxLevels} niveles (${STORAGE_SKINS.truck.maxLevels} cajas de alto); para otra columna, sepárala con «|»`,
  colon: 'los dos puntos van una sola vez, tras «camión muelle …»',
  one: 'un nivel del camión',
  free: false,
};

interface LegendDef {
  char: string;
  /** Where the character is defined in the legend. */
  pos: Pos;
  zone?: ZoneSpec;
  boxes?: BoxSpec[];
  /** A shelf character: its tiers. */
  shelfTiers?: number;
  /** A plant character: its variant (undefined = by position, like «p»). */
  plant?: { variant?: number };
  /** A storage unit character: a storage rack or a loading dock's truck. */
  unit?: UnitSpec;
}

interface Header {
  key: HeaderKey;
  value: string;
  keyPos: Pos;
  valuePos: Pos;
}

interface MapRow {
  cells: string;
  line: number;
  /** Column of the first cell. */
  column: number;
}

/** Where a box or zone came from: its legend entry and its map cell. */
interface Origin {
  def: LegendDef;
  cell: Pos;
  idPos?: Pos;
}

const at = (line: number, column: number): Pos => ({ line, column });

class LevelParser {
  private readonly lines: string[];
  private readonly file: string;

  constructor(text: string, file: string) {
    this.lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
    this.file = file;
  }

  fail(pos: Pos, reason: string): never {
    throw new LevelFormatError(this.file, pos.line, pos.column, reason);
  }

  parse(): ParsedLevel {
    const { raw, targets, notes, context } = this.draft();
    let level: LevelData;
    try {
      level = validateLevel(raw, this.file);
    } catch (e) {
      const message = e instanceof Error ? e.message.replace(/^\[[^\]]*\]\s*/, '') : String(e);
      const explained = explainValidation(message, context);
      this.fail(explained.pos, explained.reason);
    }
    return { level, targets, notes };
  }

  /** The raw level object (map and legend checked), plus what explainValidation needs to place validateLevel's errors. */
  draft(): LevelDraft & { context: ValidationContext } {
    // Title: the first non-blank line.
    let first = 0;
    while (first < this.lines.length && this.lines[first].trim() === '') first++;
    if (first === this.lines.length) this.fail(at(1, 1), 'el archivo está vacío: la primera línea es el título, p. ej. «# 23 · La muestra»');
    const titlePos = at(first + 1, 1);
    const title = /^#\s*(-?\d+(?:[.,]\d+)?)(?:\s*[·•|:–—-]\s*|\s+|\.\s*)(.*)$/.exec(this.lines[first].trim());
    if (!title) this.fail(titlePos, 'la primera línea es el título: «# número · nombre», p. ej. «# 23 · La muestra»');
    const order = Number(title[1].replace(',', '.'));
    const name = title[2].trim();
    if (name === '') this.fail(titlePos, 'falta el nombre del nivel en el título: «# 23 · La muestra»');

    // Sort the other lines: header ("clave: valor"), legend ("c = …") and one block of map rows.
    const headers: Header[] = [];
    const legend: { text: string; line: number }[] = [];
    const map: { text: string; line: number }[] = [];
    let mapClosed = false;
    for (let n = first + 1; n < this.lines.length; n++) {
      const text = this.lines[n].replace(/\s+$/, '');
      const line = n + 1;
      if (text === '') {
        if (map.length > 0) mapClosed = true;
        continue;
      }
      const header = this.headerOf(text, line);
      if (header) {
        if (map.length > 0) mapClosed = true;
        headers.push(header);
      } else if (text.includes('=')) {
        if (map.length > 0) mapClosed = true;
        legend.push({ text, line });
      } else {
        if (mapClosed) this.fail(at(line, 1), 'fila de mapa suelta: el mapa es un solo bloque, sin líneas en blanco en medio');
        map.push({ text, line });
      }
    }
    if (map.length === 0) this.fail(titlePos, 'falta el mapa (filas de casillas como «p....^..»)');

    const rows = this.readMap(map);
    const width = rows[0].cells.length;
    const depth = rows.length;
    const cellPos = (x: number, z: number) => at(rows[z].line, rows[z].column + x);

    // Header values.
    const once = new Map<HeaderKey, Header>();
    const notes: string[] = [];
    for (const h of headers) {
      if (h.key === 'nota') {
        notes.push(h.value);
        continue;
      }
      const seen = once.get(h.key);
      if (seen) this.fail(h.keyPos, `«${h.key}» repetido (ya está en la línea ${seen.keyPos.line})`);
      once.set(h.key, h);
    }
    const idHeader = once.get('id') ?? this.fail(titlePos, 'falta «id: …» bajo el título (el id guarda los mejores tiempos: no lo cambies al renombrar)');
    if (!/^\S+$/.test(idHeader.value)) this.fail(idHeader.valuePos, 'el id es una sola palabra sin espacios, p. ej. «id: la-muestra»');
    const limitHeader = once.get('limit');
    let stackLimit: number | undefined;
    if (limitHeader) {
      if (!/^\d+$/.test(limitHeader.value) || Number(limitHeader.value) < 1)
        this.fail(limitHeader.valuePos, `limit es la altura máxima de pila, un número entero desde 1 (no «${limitHeader.value}»)`);
      stackLimit = Number(limitHeader.value);
    }
    const themeHeader = once.get('tema');
    if (themeHeader && !/^\S+$/.test(themeHeader.value)) this.fail(themeHeader.valuePos, 'el tema es un id sin espacios, p. ej. «tema: default»');
    const headingHeader = once.get('rumbo');
    let heading: number | undefined;
    if (headingHeader) {
      if (!/^-?\d+(?:\.\d+)?$/.test(headingHeader.value))
        this.fail(headingHeader.valuePos, `rumbo son grados (0 = hacia v, 90 = >, 180 = ^, 270 = <), no «${headingHeader.value}»`);
      heading = Number(headingHeader.value);
    }
    const windows = this.readWindows(once.get('ventanas'), width, depth);
    const targetsHeader = once.get('dificultad');
    let targets: DifficultyTarget[] = [];
    if (targetsHeader) {
      try {
        targets = parseTargets(targetsHeader.value);
      } catch (e) {
        if (!(e instanceof DifficultySyntaxError)) throw e;
        this.fail(at(targetsHeader.valuePos.line, targetsHeader.valuePos.column + e.offset), e.message);
      }
    }

    // Legend.
    const defs = new Map<string, LegendDef>();
    const legendOrder: LegendDef[] = [];
    for (const { text, line } of legend) {
      for (const def of this.readLegendLine(text, line)) {
        const seen = defs.get(def.char);
        if (seen) this.fail(def.pos, `«${def.char}» ya está en la leyenda (línea ${seen.pos.line})`);
        defs.set(def.char, def);
        legendOrder.push(def);
      }
    }

    // Map cells.
    const forklifts: { char: string; x: number; z: number }[] = [];
    const shelfCells = new Map<string, Set<number>>();
    /** The cells of each storage unit character (a rack's own cells, a truck's door cells). */
    const unitCells = new Map<string, Set<number>>();
    const plants: { x: number; z: number; variant?: number }[] = [];
    const cellsOf = new Map<string, { x: number; z: number }[]>();
    for (let z = 0; z < depth; z++) {
      for (let x = 0; x < width; x++) {
        const ch = rows[z].cells[x];
        if (ch === '.') continue;
        if (lookup(ARROW_HEADING, ch) !== undefined) {
          forklifts.push({ char: ch, x, z });
          continue;
        }
        if (ch === 'p') {
          plants.push({ x, z });
          continue;
        }
        const def = ch === '#' ? null : defs.get(ch);
        if (def === undefined)
          this.fail(cellPos(x, z), `«${ch}» no está en la leyenda: defínelo debajo del mapa, p. ej. «${ch} = caja azul»`);
        if (def === null || def.shelfTiers !== undefined) {
          const set = shelfCells.get(ch) ?? new Set<number>();
          set.add(z * width + x);
          shelfCells.set(ch, set);
        } else if (def.unit) {
          const set = unitCells.get(ch) ?? new Set<number>();
          set.add(z * width + x);
          unitCells.set(ch, set);
        } else if (def.plant) {
          plants.push({ x, z, ...(def.plant.variant === undefined ? {} : { variant: def.plant.variant }) });
        } else {
          const list = cellsOf.get(ch) ?? [];
          list.push({ x, z });
          cellsOf.set(ch, list);
        }
      }
    }
    for (const def of legendOrder) {
      const used =
        def.shelfTiers !== undefined
          ? shelfCells.has(def.char)
          : def.unit
            ? unitCells.has(def.char)
            : def.plant
              ? rowsContain(rows, def.char)
              : cellsOf.has(def.char);
      if (!used) this.fail(def.pos, `«${def.char}» está en la leyenda pero no en el mapa`);
    }

    // Forklift.
    if (forklifts.length === 0) this.fail(at(rows[0].line, rows[0].column), 'falta la carretilla: pon ^ > v o < en su casilla de salida');
    if (forklifts.length > 1) {
      const [a, b] = forklifts;
      this.fail(cellPos(b.x, b.z), `hay más de una carretilla (la primera está en la línea ${cellPos(a.x, a.z).line})`);
    }
    const [lift] = forklifts;
    if (heading !== undefined && arrowOf(heading) !== lift.char)
      this.fail(cellPos(lift.x, lift.z), `la flecha «${lift.char}» no encaja con «rumbo: ${heading}»: dibuja «${arrowOf(heading)}»`);

    // Shelves: every connected group of one shelf character is one rectangular shelf.
    const shelves: { x: number; z: number; w: number; d: number; tiers: number }[] = [];
    for (const [ch, cells] of shelfCells) {
      const tiers = ch === '#' ? DEFAULT_TIERS : (defs.get(ch)?.shelfTiers ?? DEFAULT_TIERS);
      const seen = new Set<number>();
      for (const start of [...cells].sort((a, b) => a - b)) {
        if (seen.has(start)) continue;
        const group = floodFill(cells, start, width, depth);
        for (const c of group) seen.add(c);
        const xs = group.map((c) => c % width);
        const zs = group.map((c) => Math.floor(c / width));
        const x0 = Math.min(...xs);
        const z0 = Math.min(...zs);
        const w = Math.max(...xs) - x0 + 1;
        const d = Math.max(...zs) - z0 + 1;
        if (group.length !== w * d)
          this.fail(
            cellPos(start % width, Math.floor(start / width)),
            `la estantería «${ch}» que empieza aquí no es un rectángulo: cada estantería es un rectángulo; para dos estanterías pegadas usa otro carácter (p. ej. «E = estantería»)`,
          );
        shelves.push({ x: x0, z: z0, w, d, tiers });
      }
    }
    shelves.sort((a, b) => a.z - b.z || a.x - b.x);

    // Storage units (docs/STORAGE.md): every connected group of one unit character is one unit, a straight run with one
    // legend column per cell, placed by its access (checkRun): a storage rack's own cells, 1 cell deep along its front;
    // a truck's door cells, against its wall (floor in front of the dock door, the bed column of each one outside,
    // beyond the wall). Units come skin by skin (rule 12: racks, then trucks), each skin in legend order, then reading
    // order; generated ids are the skin's prefix and the unit's number within its skin.
    const storage: Record<string, unknown>[] = [];
    const unitOrigins: UnitOrigin[] = [];
    const originsBySkin = Object.fromEntries(STORAGE_SKIN_ORDER.map((skin) => [skin, [] as UnitOrigin[]])) as Record<StorageSkin, UnitOrigin[]>;
    for (const skin of STORAGE_SKIN_ORDER) {
      const words = UNIT_WORDS[skin];
      for (const def of legendOrder) {
        const spec = def.unit;
        const cells = unitCells.get(def.char);
        if (!spec || spec.skin !== skin || !cells) continue;
        const groups = groupsOf(cells, width, depth);
        if (spec.id !== undefined && groups.length > 1)
          this.fail(spec.idPos ?? def.pos, `«${def.char}» lleva un id propio y hay ${groups.length} ${words.many} con ese carácter: un id solo puede ir en ${words.one}`);
        for (const group of groups) {
          const xs = group.map((c) => c % width);
          const zs = group.map((c) => Math.floor(c / width));
          const x0 = Math.min(...xs);
          const z0 = Math.min(...zs);
          const startPos = cellPos(x0, z0);
          this.checkRun(spec, def.char, xs, zs, startPos);
          if (group.length !== spec.columns.length)
            this.fail(
              startPos,
              `${words.the} «${def.char}» que empieza aquí ocupa ${group.length} ${plural(group.length, 'casilla', 'casillas')} y su leyenda describe ${spec.columns.length} ${plural(spec.columns.length, 'columna', 'columnas')}: una columna por casilla, separadas con «|»`,
            );
          storage.push({
            id: spec.id ?? `${STORAGE_SKINS[skin].idPrefix}${originsBySkin[skin].length + 1}`,
            skin,
            x: x0,
            z: z0,
            w: group.length,
            access: { ...spec.access },
            columns: spec.columns.map((levels) => levels.map(cueOfSlot)),
          });
          const origin: UnitOrigin = { def, cell: startPos, columns: group.map((c) => cellPos(c % width, Math.floor(c / width))), ...(spec.idPos ? { idPos: spec.idPos } : {}) };
          unitOrigins.push(origin);
          originsBySkin[skin].push(origin);
        }
      }
    }

    // Zones and boxes, in legend order (a character used on several cells: in reading order).
    const zones: Record<string, unknown>[] = [];
    const boxes: Record<string, unknown>[] = [];
    const zoneOrigins: Origin[] = [];
    const boxOrigins: Origin[] = [];
    for (const def of legendOrder) {
      const cells = cellsOf.get(def.char);
      if (!cells) continue;
      if (cells.length > 1 && (def.zone?.id !== undefined || def.boxes?.some((b) => b.id !== undefined)))
        this.fail(def.pos, `«${def.char}» lleva un id propio y está en ${cells.length} casillas: un id solo puede ir en una`);
      for (const { x, z } of cells) {
        if (def.zone) {
          const zone = def.zone;
          zones.push({
            id: zone.id ?? `z${zones.length + 1}`,
            ...(zone.color === undefined ? {} : { color: zone.color }),
            ...(zone.symbol === undefined ? {} : { symbol: zone.symbol }),
            x,
            z,
            ...(zone.recipe === undefined ? {} : { recipe: zone.recipe }),
          });
          zoneOrigins.push({ def, cell: cellPos(x, z), ...(zone.idPos ? { idPos: zone.idPos } : {}) });
        }
        for (const box of def.boxes ?? []) {
          boxes.push({
            id: box.id ?? `b${boxes.length + 1}`,
            color: box.color,
            ...(box.symbol === undefined ? {} : { symbol: box.symbol }),
            x,
            z,
            ...(box.kind === undefined ? {} : { kind: box.kind }),
          });
          boxOrigins.push({ def, cell: cellPos(x, z), ...(box.idPos ? { idPos: box.idPos } : {}) });
        }
      }
    }
    // Boxes that start stored: numbered after the floor boxes, unit by unit (racks, then trucks), column by column,
    // bottom → top, on the cell of their column (a rack cell; a truck's bed cell, outside the map beyond the door
    // cell). In a stack (a truck bed) a box needs one under it.
    storage.forEach((unit, i) => {
      const origin = unitOrigins[i];
      const spec = origin.def.unit!;
      const stack = STORAGE_SKINS[spec.skin].support === 'stack';
      spec.columns.forEach((levels, column) => {
        const cell = cellOf({ x: unit.x as number, z: unit.z as number, access: spec.access }, column);
        levels.forEach((lv, level) => {
          const box = lv.box;
          if (!box) return;
          if (stack && level > 0 && !levels[level - 1].box)
            this.fail(
              lv.pos,
              `en ${UNIT_WORDS[spec.skin].the} las cajas van una sobre otra, de abajo arriba: esta caja no tiene nada debajo (el nivel ${levelWord(level - 1, levels.length)} está vacío)`,
            );
          boxes.push({
            id: box.id ?? `b${boxes.length + 1}`,
            color: box.color,
            ...(box.symbol === undefined ? {} : { symbol: box.symbol }),
            x: cell.x,
            z: cell.z,
            level,
            ...(box.kind === undefined ? {} : { kind: box.kind }),
          });
          boxOrigins.push({ def: origin.def, cell: origin.columns[column], ...(box.idPos ? { idPos: box.idPos } : {}) });
        });
      });
    });
    this.checkIds(ID_WORDS.caja, boxes, boxOrigins);
    this.checkIds(ID_WORDS.zona, zones, zoneOrigins);
    for (const skin of STORAGE_SKIN_ORDER)
      this.checkIds(unitIdWords(skin), storage.filter((unit) => unit.skin === skin), originsBySkin[skin]);
    // Every storage slot id is «id:columna:nivel»: units of different skins never share an id either.
    storage.forEach((unit, i) => {
      const first = storage.findIndex((other) => other.id === unit.id);
      if (first === i) return;
      const [a, b] = [unitOrigins[first], unitOrigins[i]];
      const [here, other] = b.idPos ? [b, a] : [a, b];
      const skinOf = (o: UnitOrigin) => o.def.unit!.skin;
      this.fail(
        here.idPos ?? here.def.pos,
        `id repetido «${String(unit.id)}»: también es el ${UNIT_WORDS[skinOf(other)].of} «${other.def.char}» (línea ${other.def.pos.line}); ${UNIT_WORDS[skinOf(a)].a} y ${UNIT_WORDS[skinOf(b)].a} no comparten id`,
      );
    });

    const raw = {
      id: idHeader.value,
      order,
      name,
      ...(stackLimit === undefined ? {} : { stackLimit }),
      size: { width, depth },
      forklift: { x: lift.x, z: lift.z, heading: heading ?? ARROW_HEADING[lift.char] },
      boxes,
      zones,
      shelves,
      ...(storage.length > 0 ? { storage } : {}),
      decor: { plants, windows },
      ...(themeHeader ? { theme: themeHeader.value } : {}),
    };
    const context: ValidationContext = {
      title: titlePos,
      map: at(rows[0].line, rows[0].column),
      limit: limitHeader?.valuePos ?? titlePos,
      windows: once.get('ventanas')?.valuePos ?? titlePos,
      size: `${width}×${depth}`,
      boxes: boxOrigins,
      zones: zoneOrigins,
      units: originsBySkin,
      boxIds: boxes.map((b) => String(b.id)),
      zoneIds: zones.map((z) => String(z.id)),
      cell: cellPos,
    };
    return { raw, targets, notes, context };
  }

  /** A header line "clave: valor" (or "clave valor"), or null when the line is something else. */
  private headerOf(text: string, line: number): Header | null {
    const m = /^(\s*)([A-Za-zÀ-ÿ]+)(\s*:\s*|\s+)(.*)$/.exec(text);
    if (!m) return null;
    const key = lookup(HEADER_KEYS, norm(m[2]));
    const colon = m[3].includes(':');
    if (!key) {
      if (colon) this.fail(at(line, m[1].length + 1), `clave desconocida «${m[2]}»: usa ${HEADER_LIST}${suggest(m[2], Object.keys(HEADER_KEYS))}`);
      return null;
    }
    if (!colon && m[4].startsWith('=')) return null;
    return {
      key,
      value: m[4].trim(),
      keyPos: at(line, m[1].length + 1),
      valuePos: at(line, m[1].length + m[2].length + m[3].length + 1),
    };
  }

  /** Map rows (optional column ruler first, optional row numbers), all of the same width. */
  private readMap(block: { text: string; line: number }[]): MapRow[] {
    let ruler: { text: string; line: number } | null = null;
    let lines = block;
    if (/^\s+\d+$/.test(block[0].text)) {
      ruler = block[0];
      lines = block.slice(1);
      if (lines.length === 0) this.fail(at(ruler.line, 1), 'falta el mapa debajo de la regla de columnas');
    }
    const rows: (MapRow & { label: number | null; labelColumn: number })[] = lines.map(({ text, line }) => {
      const labelled = /^(\s*)(\d+)(\s+)(\S+)$/.exec(text);
      if (labelled) {
        const column = labelled[1].length + labelled[2].length + labelled[3].length + 1;
        return { cells: labelled[4], line, column, label: Number(labelled[2]), labelColumn: labelled[1].length + 1 };
      }
      if (/^\S+$/.test(text)) return { cells: text, line, column: 1, label: null, labelColumn: 1 };
      const prefix = /^\s*\d+\s+/.exec(text)?.[0].length ?? 0;
      const space = /\s/.exec(text.slice(prefix));
      const column = prefix + (space ? space.index : 0) + 1;
      return this.fail(at(line, column), 'fila de mapa con espacios: una fila es «número casillas» o solo las casillas, sin espacios entre ellas');
    });
    const labelled = rows[0].label !== null;
    rows.forEach((row, z) => {
      if ((row.label !== null) !== labelled)
        this.fail(at(row.line, 1), labelled ? `a esta fila le falta su número (${z})` : 'numera todas las filas o ninguna');
      if (row.label !== null && row.label !== z)
        this.fail(at(row.line, row.labelColumn), `fila numerada ${row.label}: se esperaba ${z} (las filas van de 0 hacia abajo)`);
      for (let i = 0; i < row.cells.length; i++) {
        const c = row.cells[i];
        if (c < '!' || c > '~')
          this.fail(at(row.line, row.column + i), `«${c}» no vale en el mapa: usa caracteres ASCII (letras, números, . # p ^ > v <) y explica cada uno en la leyenda`);
        if (c === '=' || c === ':') this.fail(at(row.line, row.column + i), `«${c}» no vale en el mapa (se reserva para la leyenda y la cabecera)`);
      }
    });
    const width = rows[0].cells.length;
    for (const row of rows)
      if (row.cells.length !== width)
        this.fail(
          at(row.line, row.column + Math.min(row.cells.length, width)),
          `esta fila tiene ${row.cells.length} casillas y la primera ${width}: todas las filas miden lo mismo`,
        );
    if (ruler) {
      const digits = ruler.text.trim();
      const expected = Array.from({ length: width }, (_, x) => String(x % 10)).join('');
      const column = ruler.text.length - ruler.text.trimStart().length + 1;
      if (digits !== expected) this.fail(at(ruler.line, column), `la regla de columnas debería ser «${expected}» (una cifra por columna)`);
      if (!labelled || column !== rows[0].column)
        this.fail(at(ruler.line, column), 'la regla de columnas no está alineada con las casillas (numera las filas: «0 p.....»)');
    }
    return rows;
  }

  /** `ventanas: norte 2-4, oeste 1-2` → windows (first cell, width), checked against the map size. */
  private readWindows(header: Header | undefined, width: number, depth: number): { wall: WallSide; at: number; width: number }[] {
    if (!header) return [];
    const windows: { wall: WallSide; at: number; width: number }[] = [];
    let offset = 0;
    for (const item of header.value.split(',')) {
      const pos = at(header.valuePos.line, header.valuePos.column + offset + (item.length - item.trimStart().length));
      offset += item.length + 1;
      const m = /^([A-Za-zÀ-ÿ]+)\s+(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(item.trim());
      if (!m) this.fail(pos, `ventana mal escrita «${item.trim()}»: usa muro y casillas, p. ej. «norte 2-4» u «oeste 3»`);
      const wall = lookup(WALL_WORDS, norm(m[1])) ?? this.fail(pos, `las ventanas van en el muro norte u oeste (no «${m[1]}»)`);
      const from = Number(m[2]);
      const to = m[3] === undefined ? from : Number(m[3]);
      if (to < from) this.fail(pos, `ventana «${item.trim()}»: el final va después del principio`);
      const cells = wall === 'north' ? width : depth;
      if (to >= cells)
        this.fail(pos, `la ventana «${item.trim()}» no cabe: el muro ${WALL_NAMES[wall]} tiene las casillas 0-${cells - 1}`);
      windows.push({ wall, at: from, width: to - from + 1 });
    }
    return windows;
  }

  /** One legend line: one or more entries «c = descripción» separated by two or more spaces. */
  private readLegendLine(text: string, line: number): LegendDef[] {
    const isStart = (i: number) => /^(?:[!-9;<>-~] )*[!-9;<>-~] *=/.test(text.slice(i));
    const lead = text.length - text.trimStart().length;
    if (!isStart(lead)) {
      const eq = text.indexOf('=');
      this.fail(
        at(line, lead + 1),
        eq > lead && /\s\s/.test(text.slice(lead, eq))
          ? 'separa los caracteres de una entrada con un solo espacio («1 2 = zona ▲»)'
          : 'entrada de leyenda mal formada: se escribe «c = descripción», con un solo carácter del mapa (o varios separados por un espacio) antes del «=»',
      );
    }
    const starts = [lead];
    for (let i = lead; i < text.length; i++) {
      if (!/\s/.test(text[i])) continue;
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j++;
      if ((j - i >= 2 || text.slice(i, j).includes('\t')) && j < text.length && isStart(j)) starts.push(j);
      i = j - 1;
    }
    return starts.map((start, k) => {
      const end = k + 1 < starts.length ? starts[k + 1] : text.length;
      const entry = text.slice(start, end);
      const eq = entry.indexOf('=');
      const charsText = entry.slice(0, eq);
      const chars: { char: string; pos: Pos }[] = [];
      for (let i = 0; i < charsText.length; i++) if (charsText[i] !== ' ') chars.push({ char: charsText[i], pos: at(line, start + i + 1) });
      for (const { char, pos } of chars) {
        if (RESERVED.has(char))
          this.fail(pos, `«${char}» ya significa algo en el mapa (. suelo, # estantería, p planta, ^ > v < carretilla): elige otro carácter`);
      }
      const descText = entry.slice(eq + 1);
      const glued = descText.indexOf('=');
      if (glued >= 0)
        this.fail(at(line, start + eq + 2 + glued), 'dos entradas en la misma línea van separadas por dos espacios o más («a = caja azul    b = caja menta»)');
      const toks = this.tokenize(descText, at(line, start + eq + 2));
      const template: Omit<LegendDef, 'char' | 'pos'> = {};
      this.readDescription(template, toks, at(line, start + eq + 1), chars.map((c) => c.char).join(' '));
      return chars.map(({ char, pos }) => ({ char, pos, ...structuredCloneDef(template) }));
    }).flat();
  }

  private tokenize(text: string, start: Pos): Tok[] {
    const toks: Tok[] = [];
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      const pos = at(start.line, start.column + i);
      if (/\s/.test(c)) {
        i++;
      } else if (c === ',' || c === '+' || c === ':' || c === '/' || c === '|') {
        toks.push({ kind: c, text: c, key: c, pos });
        i++;
      } else if (c === '(') {
        const end = text.indexOf(')', i);
        if (end < 0) this.fail(pos, 'falta «)» para cerrar el id');
        const id = text.slice(i + 1, end).trim();
        if (!/^[^\s()]+$/.test(id)) this.fail(pos, 'el id va entre paréntesis y sin espacios, p. ej. «(b3)»');
        toks.push({ kind: 'id', text: id, key: id, pos });
        i = end + 1;
      } else if (c === ')') {
        this.fail(pos, '«)» sin su «(»');
      } else if (GLYPH_CHARS.has(c)) {
        let j = i + 1;
        while (j < text.length && /[\ufe0e\ufe0f]/.test(text[j])) j++;
        toks.push({ kind: 'word', text: text.slice(i, j), key: norm(text.slice(i, j)), pos });
        i = j;
      } else {
        let j = i;
        while (j < text.length && !/[\s,+():/|]/.test(text[j]) && !GLYPH_CHARS.has(text[j])) j++;
        const word = text.slice(i, j);
        toks.push({ kind: 'word', text: word, key: norm(word), pos });
        i = j;
      }
    }
    return toks;
  }

  /** «zona … + caja …», «pila …», «estantería 3 alturas», «planta variante 2». */
  private readDescription(def: Omit<LegendDef, 'char' | 'pos'>, toks: Tok[], eqPos: Pos, chars: string): void {
    if (toks.length === 0) this.fail(eqPos, `falta qué es «${chars}» después del «=»`);
    // A storage rack («estantería frente sur: …») and a dock's truck («camión muelle norte: …») have their own grammar:
    // «+» joins a slot's (or a truck level's) cue and its box.
    if ((toks[0].key === 'estanteria' || toks[0].key === 'estante') && toks[1]?.key === 'frente') {
      def.unit = this.readRack(toks);
      return;
    }
    if (toks[0].kind === 'word' && TRUCK_HEADS.has(toks[0].key)) {
      def.unit = this.readTruck(toks);
      return;
    }
    const stray = toks.find((t) => t.kind === ':' || t.kind === '/' || t.kind === '|');
    if (stray) this.fail(stray.pos, `«${stray.text}» solo va en una estantería almacenable o en un camión, p. ej. ${RACK_EXAMPLE} o ${TRUCK_EXAMPLE}`);
    const parts: Tok[][] = [[]];
    for (const t of toks) {
      if (t.kind === '+') {
        if (parts[parts.length - 1].length === 0) this.fail(t.pos, '«+» une dos elementos: «zona azul + caja coral»');
        parts.push([]);
      } else parts[parts.length - 1].push(t);
    }
    if (parts[parts.length - 1].length === 0) this.fail(toks[toks.length - 1].pos, 'falta un elemento después del «+»');
    for (const part of parts) {
      const head = part[0];
      if (head.kind !== 'word') this.fail(head.pos, `se esperaba ${ELEMENTS.join(', ')}`);
      const rest = part.slice(1);
      switch (head.key) {
        case 'caja':
        case 'pila':
          if (def.boxes) this.fail(head.pos, 'una sola caja o pila por carácter: para apilar escribe «pila azul,menta» (de abajo arriba)');
          def.boxes = head.key === 'caja' ? [this.readBox(rest, head)] : this.readStack(rest, head);
          break;
        case 'zona':
          if (def.zone) this.fail(head.pos, 'una sola zona por carácter');
          def.zone = this.readZone(rest, head);
          break;
        case 'estanteria':
        case 'estante':
          if (parts.length > 1) this.fail(head.pos, 'una estantería no se combina con nada más');
          def.shelfTiers = this.readShelf(rest);
          break;
        case 'planta':
          if (parts.length > 1) this.fail(head.pos, 'una planta no se combina con nada más');
          def.plant = this.readPlant(rest);
          break;
        default:
          this.fail(head.pos, `«${head.text}» no es un elemento: usa ${ELEMENTS.join(', ')}${suggest(head.text, ELEMENTS)}`);
      }
    }
  }

  /** «azul ▲», «azul tipo standard (b3)». */
  private readBox(toks: Tok[], head: Tok): BoxSpec {
    let color: ColorId | undefined;
    let symbol: SymbolId | undefined;
    let kind: BoxKind | undefined;
    let id: { text: string; pos: Pos } | undefined;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.kind === 'id') {
        if (k !== toks.length - 1) this.fail(toks[k + 1].pos, 'el id «(…)» va al final de la caja');
        id = { text: t.text, pos: t.pos };
        continue;
      }
      if (t.kind !== 'word') this.fail(t.pos, `«${t.text}» sobra aquí`);
      const c = lookup(COLOR_WORDS, t.key);
      const s = lookup(SYMBOL_WORDS, t.key);
      if (c) {
        if (color) this.fail(t.pos, 'una caja tiene un solo color');
        color = c;
      } else if (s) {
        if (symbol) this.fail(t.pos, 'una caja tiene un solo símbolo');
        symbol = s;
      } else if (t.key === 'tipo') {
        const next = toks[k + 1];
        const found = next?.kind === 'word' ? lookup(KIND_WORDS, next.key) : undefined;
        if (!found) this.fail((next ?? t).pos, `tipo de caja desconocido: usa ${BOX_KINDS.join(', ')}`);
        if (kind) this.fail(t.pos, 'una caja tiene un solo tipo');
        kind = found;
        k++;
      } else {
        this.fail(t.pos, `palabra desconocida «${t.text}» en una caja: color (${COLOR_LIST}), símbolo ${SYMBOL_LIST}${suggest(t.text, WORDS_FOR_HINTS)}`);
      }
    }
    if (!color) this.fail(head.pos, `falta el color de la caja: ${COLOR_LIST}`);
    return {
      color,
      ...(symbol === undefined ? {} : { symbol }),
      ...(kind === undefined ? {} : { kind }),
      ...(id === undefined ? {} : { id: id.text, idPos: id.pos }),
    };
  }

  /** «azul,menta» (bottom → top). */
  private readStack(toks: Tok[], head: Tok): BoxSpec[] {
    const members: Tok[][] = [[]];
    for (const t of toks) {
      if (t.kind === ',') {
        if (members[members.length - 1].length === 0) this.fail(t.pos, 'falta una caja antes de la coma');
        members.push([]);
      } else members[members.length - 1].push(t);
    }
    if (members[members.length - 1].length === 0)
      this.fail(toks.length > 0 ? toks[toks.length - 1].pos : head.pos, 'falta una caja: «pila azul,menta» (de abajo arriba)');
    return members.map((m) => this.readBox(m, m[0]));
  }

  /** «azul», «▲», «azul ■», «pila azul,menta», «azul,menta», with an optional «(id)» at the end. */
  private readZone(toks: Tok[], head: Tok): ZoneSpec {
    const zone: ZoneSpec = {};
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.kind === 'id') {
        if (k !== toks.length - 1) this.fail(toks[k + 1].pos, 'el id «(…)» va al final de la zona');
        zone.id = t.text;
        zone.idPos = t.pos;
        continue;
      }
      if (t.kind !== 'word') this.fail(t.pos, 'coma inesperada: una zona que pide pila se escribe «zona pila azul,menta»');
      const c = lookup(COLOR_WORDS, t.key);
      const s = lookup(SYMBOL_WORDS, t.key);
      if (c && toks[k + 1]?.kind === ',') {
        if (zone.recipe) this.fail(t.pos, 'la zona ya pide una pila');
        const { recipe, next } = this.readColorList(toks, k, t);
        zone.recipe = recipe;
        k = next - 1;
      } else if (c) {
        if (zone.color) this.fail(t.pos, 'una zona pide un solo color (para una pila: «zona pila azul,menta»)');
        zone.color = c;
      } else if (s) {
        if (zone.symbol) this.fail(t.pos, 'una zona pide un solo símbolo');
        zone.symbol = s;
      } else if (t.key === 'pila' || t.key === 'receta') {
        if (zone.recipe) this.fail(t.pos, 'la zona ya pide una pila');
        const { recipe, next } = this.readColorList(toks, k + 1, t);
        zone.recipe = recipe;
        k = next - 1;
      } else {
        this.fail(t.pos, `palabra desconocida «${t.text}» en una zona: color (${COLOR_LIST}), símbolo ${SYMBOL_LIST} o «pila …»${suggest(t.text, WORDS_FOR_HINTS)}`);
      }
    }
    if (zone.recipe) {
      if (zone.color === undefined) zone.color = zone.recipe[0];
      else if (zone.color !== zone.recipe[0])
        this.fail(
          head.pos,
          `la zona es ${COLOR_NAMES[zone.color]} pero su pila empieza por ${COLOR_NAMES[zone.recipe[0]]}: la pila se escribe de abajo arriba y la de abajo es la de la zona`,
        );
    }
    if (zone.color === undefined && zone.symbol === undefined)
      this.fail(head.pos, 'la zona no pide nada: dale un color, un símbolo o ambos («zona azul», «zona ▲», «zona azul ■»)');
    return zone;
  }

  /** A comma-separated list of colours starting at toks[start] (a zone's stack, bottom → top). */
  private readColorList(toks: Tok[], start: number, before: Tok): { recipe: ColorId[]; next: number } {
    const recipe: ColorId[] = [];
    let k = start;
    for (;;) {
      const t = toks[k];
      const c = t?.kind === 'word' ? lookup(COLOR_WORDS, t.key) : undefined;
      if (!c) {
        const where = (t ?? toks[k - 1] ?? before).pos;
        this.fail(where, t && lookup(SYMBOL_WORDS, t.key) ? 'la pila de una zona es solo de colores (el símbolo va antes: «zona ■ pila azul»)' : `falta un color (${COLOR_LIST})`);
      }
      recipe.push(c);
      k++;
      if (toks[k]?.kind !== ',') return { recipe, next: k };
      k++;
    }
  }

  /**
   * «estantería frente sur [(id)]: hueco / hueco | hueco …» — columns along the rack separated by «|», each one's
   * slots bottom → top separated by «/»; a slot is its cue («libre», a colour, a symbol or both) and optionally
   * «+ caja …», the box that starts in it.
   */
  private readRack(toks: Tok[]): UnitSpec {
    const [head, frente] = toks;
    const dir = toks[2];
    const facing = dir?.kind === 'word' ? lookup(FACING_WORDS, dir.key) : undefined;
    if (!facing) this.fail((dir ?? frente).pos, `¿hacia dónde mira el frente? «frente norte», «frente este», «frente sur» o «frente oeste»${dir?.kind === 'word' ? suggest(dir.text, Object.keys(FACING_WORDS)) : ''}`);
    let k = 3;
    const spec: UnitSpec = { skin: 'rack', access: { kind: 'front', facing }, columns: [] };
    if (toks[k]?.kind === 'id') {
      spec.id = toks[k].text;
      spec.idPos = toks[k].pos;
      k++;
    }
    if (toks[k]?.kind !== ':')
      this.fail((toks[k] ?? toks[k - 1]).pos, `después de «frente ${FACING_NAMES[facing]}» van dos puntos y los huecos de abajo arriba: ${RACK_EXAMPLE}`);
    spec.columns = this.readColumns(toks, k + 1, STORAGE_SKINS.rack.maxLevels, RACK_WORDS);
    if (head.kind !== 'word') this.fail(head.pos, 'se esperaba «estantería»');
    return spec;
  }

  /**
   * «camión muelle norte [(id)]: nivel / nivel | nivel …» (docs/DOCKS.md) — the bed columns along the wall separated
   * by «|», each one's levels bottom → top separated by «/»; a level is its cue (a colour, a symbol or both; never
   * «libre») and optionally «+ caja …», the box loaded there at the start. Also «camión en el muelle norte»,
   * «muelle norte», «truck north».
   */
  private readTruck(toks: Tok[]): UnitSpec {
    let k = 1;
    while (toks[k]?.kind === 'word' && TRUCK_FILLERS.has(toks[k].key)) k++;
    const dir = toks[k];
    const wall = dir?.kind === 'word' ? lookup(WALL_WORDS, dir.key) : undefined;
    if (!wall) {
      const where = (dir ?? toks[k - 1]).pos;
      if (dir?.kind === 'word' && lookup(FACING_WORDS, dir.key))
        this.fail(where, `los muelles van en el muro norte o en el oeste, como las ventanas (no «${dir.text}»)`);
      this.fail(
        where,
        `¿en qué muro está el muelle? «camión muelle norte» o «camión muelle oeste», p. ej. ${TRUCK_EXAMPLE}${dir?.kind === 'word' ? suggest(dir.text, Object.keys(WALL_WORDS)) : ''}`,
      );
    }
    k++;
    const spec: UnitSpec = { skin: 'truck', access: { kind: 'door', wall }, columns: [] };
    if (toks[k]?.kind === 'id') {
      spec.id = toks[k].text;
      spec.idPos = toks[k].pos;
      k++;
    }
    if (toks[k]?.kind !== ':')
      this.fail((toks[k] ?? toks[k - 1]).pos, `después de «camión muelle ${WALL_NAMES[wall]}» van dos puntos y los niveles de cada columna de abajo arriba: ${TRUCK_EXAMPLE}`);
    spec.columns = this.readColumns(toks, k + 1, STORAGE_SKINS.truck.maxLevels, TRUCK_WORDS);
    return spec;
  }

  /**
   * A unit's cells on the map, a straight run placed by its access (docs/STORAGE.md): `front` — its own cells, 1 cell
   * deep along its front (a row for a front north / south, a column for east / west); `door` — its door cells, along its
   * wall, on row 0 (north) or column 0 (west). `at` = its first cell.
   */
  private checkRun(spec: UnitSpec, char: string, xs: readonly number[], zs: readonly number[], at: Pos): void {
    const words = UNIT_WORDS[spec.skin];
    const { access } = spec;
    const x0 = Math.min(...xs);
    const z0 = Math.min(...zs);
    const alongX = access.kind === 'front' ? runsAlongX(access.facing) : access.wall === 'north';
    const line = alongX ? 'fila' : 'columna';
    const straight = alongX ? zs.every((z) => z === z0) : xs.every((x) => x === x0);
    const others = `para dos ${words.many} ${words.together} usa otro carácter`;
    if (access.kind === 'front') {
      if (!straight)
        this.fail(at, `${words.the} «${char}» que empieza aquí no es una ${line} recta: con el frente ${FACING_NAMES[access.facing]} va a lo largo de una ${line}, con 1 casilla de fondo; ${others}`);
      return;
    }
    const wall = WALL_NAMES[access.wall];
    if (!straight) this.fail(at, `${words.the} «${char}» que empieza aquí no es una ${line} recta: en el muelle ${wall} sus casillas son las de la puerta, a lo largo del muro; ${others}`);
    if (alongX ? z0 !== 0 : x0 !== 0)
      this.fail(
        at,
        `${words.the} «${char}» del muelle ${wall} espera fuera, pegado al muro ${wall}: sus casillas son las de la puerta, en la ${line} 0 del mapa (aquí está en la ${line} ${alongX ? z0 : x0})`,
      );
  }

  /**
   * The columns after a rack's or a truck's colon (toks[start] is the first token after it): columns split by «|»,
   * each one's levels bottom → top split by «/», at most `max` per column.
   */
  private readColumns(toks: Tok[], start: number, max: number, words: ColumnWords): SlotSpec[][] {
    const columns: SlotSpec[][] = [];
    let column: SlotSpec[] = [];
    let slot: Tok[] = [];
    let slotPos = toks[start - 1].pos;
    const endSlot = () => {
      if (slot.length === 0) this.fail(slotPos, words.missing);
      if (column.length === max) this.fail(slot[0].pos, words.tooMany);
      column.push(this.readSlot(slot, words));
      slot = [];
    };
    for (let k = start; k < toks.length; k++) {
      const t = toks[k];
      if (t.kind === '/' || t.kind === '|') {
        slotPos = t.pos;
        endSlot();
        if (t.kind === '|') {
          columns.push(column);
          column = [];
        }
        continue;
      }
      if (t.kind === ':') this.fail(t.pos, words.colon);
      if (slot.length === 0) slotPos = t.pos;
      slot.push(t);
    }
    endSlot();
    columns.push(column);
    return columns;
  }

  /**
   * One rack slot («libre», «azul», «▲», «azul ■») or one truck level (the same without «libre»), each optionally
   * «+ caja …».
   */
  private readSlot(toks: Tok[], words: ColumnWords): SlotSpec {
    const plus = toks.findIndex((t) => t.kind === '+');
    const cue = plus >= 0 ? toks.slice(0, plus) : toks;
    const rest = plus >= 0 ? toks.slice(plus + 1) : [];
    const slot: SlotSpec = { pos: toks[0].pos };
    const one = words.one;
    if (cue.length === 0)
      this.fail(toks[0].pos, `falta la pista ${words.free ? 'del hueco' : 'del nivel'} antes del «+»: un color, un símbolo${words.free ? ', ambos o «libre»' : ' o ambos'}`);
    let free = false;
    for (const t of cue) {
      if (t.kind !== 'word') this.fail(t.pos, `«${t.text}» sobra en la pista de ${one}`);
      const c = lookup(COLOR_WORDS, t.key);
      const s = lookup(SYMBOL_WORDS, t.key);
      if (t.key === 'libre' || t.key === 'free') {
        if (!words.free)
          this.fail(t.pos, 'en un camión cada nivel pide algo (un color, un símbolo o ambos): no hay niveles «libre»; para aparcar una caja, usa el suelo');
        if (free || slot.color || slot.symbol) this.fail(t.pos, '«libre» va solo: un hueco libre no pide nada');
        free = true;
      } else if (c) {
        if (free) this.fail(t.pos, '«libre» va solo: un hueco libre no pide nada');
        if (slot.color) this.fail(t.pos, `${one} pide un solo color`);
        slot.color = c;
      } else if (s) {
        if (free) this.fail(t.pos, '«libre» va solo: un hueco libre no pide nada');
        if (slot.symbol) this.fail(t.pos, `${one} pide un solo símbolo`);
        slot.symbol = s;
      } else if (t.key === 'caja') {
        this.fail(t.pos, `la caja va después de la pista y un «+»: ${words.free ? '«libre + caja azul»' : '«azul + caja azul»'}, «▲ + caja menta ▲»`);
      } else {
        const options = words.free ? `color (${COLOR_LIST}), símbolo ${SYMBOL_LIST} o «libre»` : `color (${COLOR_LIST}) o símbolo ${SYMBOL_LIST}`;
        this.fail(t.pos, `palabra desconocida «${t.text}» en ${one}: ${options}${suggest(t.text, words.free ? [...WORDS_FOR_HINTS, 'libre'] : WORDS_FOR_HINTS)}`);
      }
    }
    if (plus >= 0) {
      if (rest.length === 0) this.fail(toks[plus].pos, 'falta la caja después del «+»: «+ caja azul»');
      const more = rest.findIndex((t) => t.kind === '+');
      if (more >= 0) this.fail(rest[more].pos, `${one} guarda una sola caja`);
      const [head, ...box] = rest;
      if (head.kind !== 'word' || head.key !== 'caja')
        this.fail(head.pos, head.kind === 'word' && head.key === 'pila' ? `en ${one} cabe una sola caja (no una pila)` : 'después del «+» va «caja …», p. ej. «+ caja coral»');
      slot.box = this.readBox(box, head);
    }
    return slot;
  }

  /** «3 alturas», «de 3 alturas», nothing (2 tiers). */
  private readShelf(toks: Tok[]): number {
    let tiers: number | undefined;
    let unit = false;
    for (const t of toks) {
      if (t.kind === 'word' && t.key === 'frente') this.fail(t.pos, `una estantería almacenable se escribe «estantería frente sur: …», p. ej. ${RACK_EXAMPLE}`);
      if (t.kind !== 'word') this.fail(t.pos, `«${t.text}» sobra: escribe p. ej. «estantería 3 alturas»`);
      if (t.key === 'de' && tiers === undefined) continue;
      if (/^\d+$/.test(t.key) && tiers === undefined) {
        tiers = Number(t.key);
        if (tiers < 1) this.fail(t.pos, 'una estantería tiene al menos 1 altura');
        continue;
      }
      if (TIER_WORDS.has(t.key) && tiers !== undefined && !unit) {
        unit = true;
        continue;
      }
      this.fail(t.pos, `«${t.text}» sobra: escribe p. ej. «estantería 3 alturas»`);
    }
    return tiers ?? DEFAULT_TIERS;
  }

  /** «variante 2», «2», nothing (by position, like «p»). */
  private readPlant(toks: Tok[]): { variant?: number } {
    let variant: number | undefined;
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k];
      if (t.kind === 'word' && t.key === 'variante' && variant === undefined && k === 0) continue;
      if (t.kind === 'word' && /^\d+$/.test(t.key) && variant === undefined) {
        variant = Number(t.key);
        continue;
      }
      this.fail(t.pos, `«${t.text}» sobra: escribe p. ej. «planta variante 2»`);
    }
    return variant === undefined ? {} : { variant };
  }

  private checkIds(words: IdWords, items: Record<string, unknown>[], origins: Origin[]): void {
    const seen = new Map<string, number>();
    items.forEach((item, i) => {
      const id = String(item.id);
      const j = seen.get(id);
      if (j !== undefined) {
        // Point at an explicit «(id)» and name the other character (a generated id is b1, b2… / z1, z2… by position).
        const [here, other] = origins[i].idPos ? [origins[i], origins[j]] : [origins[j], origins[i]];
        this.fail(
          here.idPos ?? here.def.pos,
          `id repetido «${id}»: también es el ${words.of} «${other.def.char}» (línea ${other.def.pos.line}); los ids sin paréntesis son ${words.generated} por orden de leyenda`,
        );
      }
      seen.set(id, i);
    });
  }
}

function rowsContain(rows: MapRow[], ch: string): boolean {
  return rows.some((r) => r.cells.includes(ch));
}

/** Copy of a legend definition template (several characters may share one description). */
function structuredCloneDef(def: Omit<LegendDef, 'char' | 'pos'>): Omit<LegendDef, 'char' | 'pos'> {
  return {
    ...(def.zone ? { zone: { ...def.zone, ...(def.zone.recipe ? { recipe: [...def.zone.recipe] } : {}) } } : {}),
    ...(def.boxes ? { boxes: def.boxes.map((b) => ({ ...b })) } : {}),
    ...(def.shelfTiers === undefined ? {} : { shelfTiers: def.shelfTiers }),
    ...(def.plant ? { plant: { ...def.plant } } : {}),
    ...(def.unit ? { unit: { ...def.unit, access: { ...def.unit.access }, columns: cloneColumns(def.unit.columns) } } : {}),
  };
}

function cloneColumns(columns: readonly SlotSpec[][]): SlotSpec[][] {
  return columns.map((slots) => slots.map((slot) => ({ ...slot, ...(slot.box ? { box: { ...slot.box } } : {}) })));
}

/** A level's cue as `level.storage` keeps it: the criteria it names, null for «libre» (no criteria). */
function cueOfSlot(slot: SlotSpec): ZoneCriteria | null {
  if (slot.color === undefined && slot.symbol === undefined) return null;
  return { ...(slot.color === undefined ? {} : { color: slot.color }), ...(slot.symbol === undefined ? {} : { symbol: slot.symbol }) };
}

/** The 4-connected groups of `cells` (indexed z * width + x), in reading order of their first cell, each one sorted. */
function groupsOf(cells: ReadonlySet<number>, width: number, depth: number): number[][] {
  const groups: number[][] = [];
  const seen = new Set<number>();
  for (const start of [...cells].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const group = floodFill(cells, start, width, depth).sort((a, b) => a - b);
    for (const c of group) seen.add(c);
    groups.push(group);
  }
  return groups;
}

/** 4-connected group of `cells` containing `start` (cells indexed z * width + x). */
function floodFill(cells: ReadonlySet<number>, start: number, width: number, depth: number): number[] {
  const group = [start];
  const seen = new Set(group);
  for (let q = 0; q < group.length; q++) {
    const c = group[q];
    const x = c % width;
    const z = Math.floor(c / width);
    for (const [nx, nz] of [
      [x + 1, z],
      [x - 1, z],
      [x, z + 1],
      [x, z - 1],
    ]) {
      const n = nz * width + nx;
      if (nx < 0 || nz < 0 || nx >= width || nz >= depth || seen.has(n) || !cells.has(n)) continue;
      seen.add(n);
      group.push(n);
    }
  }
  return group;
}

/** Where a storage unit came from: its legend entry, its first map cell and the map cell of each column. */
interface UnitOrigin extends Origin {
  columns: Pos[];
}

interface ValidationContext {
  title: Pos;
  map: Pos;
  limit: Pos;
  /** The `ventanas:` value (the title when there is none). */
  windows: Pos;
  size: string;
  boxes: Origin[];
  zones: Origin[];
  /** Per skin, its units in storage order: validateLevel's `racks[i]` / `trucks[i]` (the i-th unit of that skin). */
  units: Record<StorageSkin, UnitOrigin[]>;
  boxIds: string[];
  zoneIds: string[];
  cell: (x: number, z: number) => Pos;
}

const SLOT_ORDINALS = ['de abajo', 'del medio', 'de arriba'];

/** «de abajo», «del medio», «de arriba» or «único»: a slot or truck level (from 0) of a column of `levels`. */
function levelWord(level: number, levels: number): string {
  return levels === 1 ? 'único' : levels === 2 ? (level === 0 ? 'de abajo' : 'de arriba') : SLOT_ORDINALS[level] ?? `${level + 1}`;
}

/** «el hueco de abajo de la columna 2 de la estantería «a»» (level / column from 0). */
function slotText(rack: UnitOrigin | undefined, column: number, level: number, levels: number): string {
  const col = rack && rack.columns.length > 1 ? ` de la columna ${column + 1}` : '';
  return `el hueco ${levelWord(level, levels)}${col} de la estantería «${rack?.def.char ?? '?'}»`;
}

/** «el nivel de abajo de la columna 2 del camión «T»» (level / column from 0). */
function truckSlotText(truck: UnitOrigin | undefined, column: number, level: number): string {
  const levels = truck?.def.unit?.columns[column]?.length ?? 1;
  const col = truck && truck.columns.length > 1 ? ` de la columna ${column + 1}` : '';
  return `el nivel ${levelWord(level, levels)}${col} del camión «${truck?.def.char ?? '?'}»`;
}

/** «azul ●» for "blue/circle". */
function kindText(kind: string): string {
  const [color, symbol] = kind.split('/') as [ColorId, SymbolId];
  return `${COLOR_NAMES[color] ?? color} ${SYMBOL_GLYPHS[symbol] ?? symbol}`;
}

/** validateLevel's message (English, no position) → a Spanish reason at the place the author has to fix. */
function explainValidation(message: string, ctx: ValidationContext): { pos: Pos; reason: string } {
  const boxOf = (id: string) => ctx.boxes[ctx.boxIds.indexOf(id)];
  const zoneAt = (i: number) => ctx.zones[i];
  let m: RegExpExecArray | null;
  if ((m = /^size must be between (\d+) and (\d+)/.exec(message)))
    return { pos: ctx.map, reason: `el mapa mide ${ctx.size}: cada lado tiene entre ${m[1]} y ${m[2]} casillas` };
  if ((m = /^stackLimit must be between 1 and (\d+)/.exec(message)))
    return { pos: ctx.limit, reason: `limit va de 1 a ${m[1]} (gameConfig stack.maxHeight)` };
  if ((m = /^a zone recipe is taller than stackLimit (\d+)/.exec(message))) {
    const tallest = ctx.zones.reduce((best, o) => ((o.def.zone?.recipe?.length ?? 1) > (best.def.zone?.recipe?.length ?? 1) ? o : best));
    return { pos: tallest.def.pos, reason: `esta zona pide una pila de ${tallest.def.zone?.recipe?.length ?? 1} cajas y limit es ${m[1]}` };
  }
  if ((m = /^two boxes share cell (\d+),(\d+)/.exec(message)))
    return { pos: ctx.cell(Number(m[1]), Number(m[2])), reason: 'aquí empieza una pila, pero limit es 1: sube «limit» o separa las cajas' };
  if ((m = /^stack at (\d+),(\d+) is taller than stackLimit (\d+)/.exec(message)))
    return { pos: ctx.cell(Number(m[1]), Number(m[2])), reason: `esta pila es más alta que limit ${m[3]}` };
  if (/^a level that sorts by symbol does not stack yet/.test(message))
    return { pos: ctx.limit, reason: 'un nivel con símbolos todavía no apila: limit 1, sin pilas en zonas ni pilas al empezar' };
  if ((m = /^a level that sorts by symbol needs one box per zone \((\d+) boxes, (\d+) zones\)/.exec(message)))
    return { pos: ctx.title, reason: `un nivel con símbolos lleva una caja por zona (hay ${m[1]} cajas y ${m[2]} zonas)` };
  if ((m = /^no complete sorting exists: box "([^"]+)"/.exec(message))) {
    const origin = boxOf(m[1]);
    return {
      pos: origin?.cell ?? ctx.title,
      reason: `no hay reparto completo: la caja «${origin?.def.char ?? m[1]}» de esta casilla siempre se queda sin zona que la acepte`,
    };
  }
  if ((m = /^color "(\w+)" has (more boxes than zones|more zones than boxes)/.exec(message))) {
    const color = m[1] as ColorId;
    const name = COLOR_NAMES[color] ?? color;
    if (m[2] === 'more boxes than zones') {
      const first = ctx.boxes.find((o) => o.def.boxes?.some((b) => b.color === color));
      return { pos: first?.def.pos ?? ctx.title, reason: `sobran cajas ${name}: hay más que huecos ${name} en las zonas (cuenta también los pisos de las pilas)` };
    }
    const first = ctx.zones.find((o) => (o.def.zone?.recipe ?? [o.def.zone?.color]).includes(color));
    return { pos: first?.def.pos ?? ctx.title, reason: `faltan cajas ${name}: las zonas piden más de las que hay en el mapa` };
  }
  if ((m = /^racks\[(\d+)\] column (\d+) has no room in front: cell (-?\d+),(-?\d+)/.exec(message))) {
    const rack = ctx.units.rack[Number(m[1])];
    return {
      pos: rack?.columns[Number(m[2])] ?? rack?.cell ?? ctx.title,
      reason: `la estantería «${rack?.def.char ?? '?'}» se carga por delante y delante de esta casilla (la ${m[3]},${m[4]}) hay una pared, una estantería o una planta: déjale sitio o cambia su frente`,
    };
  }
  if ((m = /^zones\[(\d+)\] asks for a stack: in a level with storage racks/.exec(message)))
    return {
      pos: zoneAt(Number(m[1]))?.def.pos ?? ctx.title,
      reason: 'en un nivel con estanterías almacenables las zonas piden una sola caja: apilar en el suelo solo sirve para aparcar',
    };
  if (/^a level needs at least one zone or rack slot with a cue/.test(message))
    return { pos: ctx.title, reason: 'el nivel necesita al menos una zona o un hueco de estantería con pista' };
  if ((m = /^a level with storage racks needs one box per target \((\d+) boxes, (\d+) zones, (\d+) slots with a cue\)/.exec(message)))
    return {
      pos: ctx.title,
      reason: `con estanterías, cada zona y cada hueco con pista lleva una caja: hay ${m[1]} cajas para ${m[2]} zonas y ${m[3]} huecos con pista (los huecos «libre» no cuentan)`,
    };
  if ((m = /^no complete assignment exists: box "([^"]+)"/.exec(message))) {
    const origin = boxOf(m[1]);
    const places = ctx.units.truck.length > 0 ? 'sin zona, hueco ni nivel de camión' : 'sin zona ni hueco';
    return {
      pos: origin?.cell ?? ctx.title,
      reason: `no hay reparto completo: la caja «${origin?.def.char ?? m[1]}» de esta casilla siempre se queda ${places} que la acepte`,
    };
  }
  // Loading docks (docs/DOCKS.md «Validación»: the English messages validateLevel gives for trucks).
  if ((m = /^trucks\[(\d+)\] has (\d+) columns, more than (\d+)/.exec(message))) {
    const truck = ctx.units.truck[Number(m[1])];
    return {
      pos: truck?.columns[Number(m[3])] ?? truck?.cell ?? ctx.title,
      reason: `el camión «${truck?.def.char ?? '?'}» tiene ${m[2]} columnas y lleva como mucho ${m[3]}: su puerta mide de 1 a ${m[3]} casillas; quítale columnas o usa dos camiones`,
    };
  }
  if ((m = /^trucks\[(\d+)\]\.columns\[(\d+)\] has (\d+) levels, more than stackLimit (\d+)/.exec(message))) {
    const truck = ctx.units.truck[Number(m[1])];
    return {
      pos: truck?.columns[Number(m[2])] ?? truck?.cell ?? ctx.title,
      reason: `esta columna del camión «${truck?.def.char ?? '?'}» tiene ${m[3]} niveles y limit es ${m[4]}: sube «limit» (hasta ${STORAGE_SKINS.truck.maxLevels}) o quítale niveles`,
    };
  }
  if ((m = /^trucks\[(\d+)\] needs a static obstacle beside its dock door at (\d+),(\d+) for its guard rail, but that is the dock door of trucks\[(\d+)\]/.exec(message))) {
    const [truck, other] = [ctx.units.truck[Number(m[1])], ctx.units.truck[Number(m[4])]];
    return {
      pos: ctx.cell(Number(m[2]), Number(m[3])),
      reason: `dos puertas de muelle no van pegadas: a cada lado de una puerta va una barandilla naranja con un obstáculo fijo detrás, y aquí, junto a la puerta del camión «${truck?.def.char ?? '?'}», está la del camión «${other?.def.char ?? '?'}»: deja entre las dos una casilla con una planta «p»`,
    };
  }
  if ((m = /^trucks\[(\d+)\] needs a static obstacle beside its dock door at (\d+),(\d+)/.exec(message)))
    return {
      pos: ctx.cell(Number(m[2]), Number(m[3])),
      reason: `junto a la puerta del camión «${ctx.units.truck[Number(m[1])]?.def.char ?? '?'}» va una barandilla naranja (sale sola, no se escribe) y esta casilla, detrás de ella a lo largo del muro, tiene que ser un obstáculo fijo: pon una planta «p» (o una estantería)`,
    };
  if ((m = /^racks\[(\d+)\] column (\d+) is loaded from the dock door of trucks\[(\d+)\], across its guard rail/.exec(message))) {
    const rack = ctx.units.rack[Number(m[1])];
    return {
      pos: rack?.columns[Number(m[2])] ?? rack?.cell ?? ctx.title,
      reason: `la estantería «${rack?.def.char ?? '?'}» se cargaría desde la puerta del camión «${ctx.units.truck[Number(m[3])]?.def.char ?? '?'}», pero entre las dos va la barandilla naranja de la puerta: gira la estantería para que su frente no dé a la puerta`,
    };
  }
  if ((m = /^decor\.windows\[(\d+)\] overlaps the dock door of trucks\[(\d+)\]/.exec(message)))
    return {
      pos: ctx.windows,
      reason: `una ventana choca con la puerta del muelle del camión «${ctx.units.truck[Number(m[2])]?.def.char ?? '?'}» (la puerta es lo que ocupan sus casillas a lo largo del muro): mueve la ventana`,
    };
  if ((m = /^box "([^"]+)" is on trucks\[(\d+)\] column (\d+) at level (\d+) with no box below it/.exec(message))) {
    const origin = boxOf(m[1]);
    return { pos: origin?.cell ?? ctx.title, reason: 'en el camión las cajas van una sobre otra, de abajo arriba: esta caja no tiene nada debajo' };
  }
  if ((m = /^a level with storage racks or trucks needs one box per target \((\d+) boxes, (\d+) zones, (\d+) slots with a cue, (\d+) truck levels\)/.exec(message)))
    return {
      pos: ctx.title,
      reason: `con estanterías o camiones, cada zona, cada hueco con pista y cada nivel del camión lleva una caja: hay ${m[1]} cajas para ${m[2]} zonas, ${m[3]} huecos con pista y ${m[4]} niveles de camión (los huecos «libre» no cuentan)`,
    };
  if ((m = /^more than one complete assignment: trucks\[(\d+)\]\.columns\[(\d+)\]\[(\d+)\] may take (\S+) or (\S+)/.exec(message))) {
    const truck = ctx.units.truck[Number(m[1])];
    const column = Number(m[2]);
    return {
      pos: truck?.columns[column] ?? truck?.def.pos ?? ctx.title,
      reason: `hay más de un reparto: ${truckSlotText(truck, column, Number(m[3]))} puede llevar la caja ${kindText(m[4])} o la ${kindText(m[5])}; cada caja tiene un único sitio: afina las pistas (color, símbolo o ambos) hasta que solo quede un reparto`,
    };
  }
  if ((m = /^more than one complete assignment: (?:zones\[(\d+)\]|racks\[(\d+)\]\.columns\[(\d+)\]\[(\d+)\]) may take (\S+) or (\S+)/.exec(message))) {
    const kinds = `puede llevar la caja ${kindText(m[5])} o la ${kindText(m[6])}`;
    const advice = 'con estanterías cada caja tiene un único sitio: afina las pistas (color, símbolo o ambos) hasta que solo quede un reparto';
    if (m[1] !== undefined) {
      const zone = zoneAt(Number(m[1]));
      return { pos: zone?.def.pos ?? ctx.title, reason: `hay más de un reparto: la zona «${zone?.def.char ?? '?'}» ${kinds}; ${advice}` };
    }
    const rack = ctx.units.rack[Number(m[2])];
    const column = Number(m[3]);
    const levels = rack?.def.unit?.columns[column]?.length ?? 1;
    return { pos: rack?.columns[column] ?? rack?.def.pos ?? ctx.title, reason: `hay más de un reparto: ${slotText(rack, column, Number(m[4]), levels)} ${kinds}; ${advice}` };
  }
  if (/^level starts already solved/.test(message)) return { pos: ctx.title, reason: 'el nivel empieza ya resuelto: todas las zonas tienen lo que piden' };
  if (/^a level needs at least one zone/.test(message)) return { pos: ctx.title, reason: 'el nivel necesita al menos una zona' };
  if ((m = /^zones\[(\d+)\] asks for a symbol and a stack/.exec(message)))
    return { pos: zoneAt(Number(m[1]))?.def.pos ?? ctx.title, reason: 'una zona con símbolo no pide pila: las pilas de zona son solo de colores' };
  return { pos: ctx.title, reason: `nivel no válido: ${message}` };
}

/** Parses a `.level` text into a validated level (see the file header). `file` only labels error messages. */
export function parseLevel(text: string, file = 'nivel.level'): ParsedLevel {
  return new LevelParser(text, file).parse();
}

/**
 * The raw level object of a `.level` text, before validateLevel: every grammar and map error is thrown as in
 * parseLevel, none of validateLevel's (no defaults either). For tools and for tests of the grammar alone.
 */
export function parseLevelDraft(text: string, file = 'nivel.level'): LevelDraft {
  const { raw, targets, notes } = new LevelParser(text, file).draft();
  return { raw, targets, notes };
}

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */

/** Characters the renderer hands out, per kind of entry, in order of preference. */
const ZONE_CHARS = '1234567890ABCDEFGIJKLMNOQRSTUVWXYZ';
const BOX_CHARS = 'abcdefghijklmnoqrstuwxyzABCDEFGIJKLMNOQRSTUVWXYZ';
/** «H» (it reads like a shelf frame) is kept for tall shelves (3+ tiers); other shelf kinds take the rest. */
const TALL_SHELF_CHARS = 'HKLMNORSTUWXYZ';
// Storage units: one character each, from their skin's `STORAGE_SKINS[skin].chars` (the trucks' after the racks').
const SHELF_CHARS = 'EFGIJQVKLMNORSTUWXYZ';
const PLANT_CHARS = 'PQRSTUVWXYZ';
const SPARE_CHARS = '!$%&*;?@[]{}|~_\'"`/\\';

function take(preferred: string, used: Set<string>): string {
  for (const ch of preferred + SPARE_CHARS) {
    if (!used.has(ch)) {
      used.add(ch);
      return ch;
    }
  }
  throw new Error('renderLevel: demasiados elementos distintos para dibujarlos con un carácter cada uno');
}

interface RenderEntry {
  char: string;
  text: string;
  /** Its kind of entry (a storage unit: its skin). */
  group: 'zona' | 'caja' | 'otro' | StorageSkin;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function zoneText(zone: LevelZone): string {
  const words = ['zona'];
  if (zone.recipe) {
    if (zone.symbol) words.push(SYMBOL_GLYPHS[zone.symbol]);
    words.push(`pila ${zone.recipe.map((c) => COLOR_NAMES[c]).join(',')}`);
  } else {
    if (zone.color) words.push(COLOR_NAMES[zone.color]);
    if (zone.symbol) words.push(SYMBOL_GLYPHS[zone.symbol]);
  }
  return words.join(' ');
}

function boxText(box: LevelData['boxes'][number], id: string | null): string {
  const words = [COLOR_NAMES[box.color]];
  if (box.symbol) words.push(SYMBOL_GLYPHS[box.symbol]);
  if (box.kind && box.kind !== 'standard') words.push(`tipo ${box.kind}`);
  if (id !== null) words.push(`(${id})`);
  return words.join(' ');
}

/**
 * A storage unit's entry: its skin's word and its access («estantería frente sur», docs/RACKS.md; «camión muelle
 * norte», docs/DOCKS.md), then its columns «azul / ▲ + caja coral / libre | …». `boxAt(column, level)` gives the text
 * of the box that starts on a level («caja …»), or null.
 */
function unitText(unit: LevelStorage, id: string | null, boxAt: (column: number, level: number) => string | null): string {
  const columns = unit.columns.map((levels, column) =>
    levels
      .map((cue, level) => {
        const words = cue === null ? 'libre' : [cue.color ? COLOR_NAMES[cue.color] : '', cue.symbol ? SYMBOL_GLYPHS[cue.symbol] : ''].filter((w) => w !== '').join(' ');
        const box = boxAt(column, level);
        return `${words}${box === null ? '' : ` + ${box}`}`;
      })
      .join(' / '),
  );
  const { access } = unit;
  const where = access.kind === 'front' ? `frente ${FACING_NAMES[access.facing]}` : `muelle ${WALL_NAMES[access.wall]}`;
  return `${UNIT_WORDS[unit.skin].name} ${where}${id === null ? '' : ` (${id})`}: ${columns.join(' | ')}`;
}

/** Legend entries in columns; a new line whenever the kind of entry changes. */
function layoutLegend(entries: RenderEntry[]): string[] {
  const merged: { text: string; group: RenderEntry['group'] }[] = [];
  let run: RenderEntry[] = [];
  const flush = () => {
    if (run.length > 0) merged.push({ text: `${run.map((e) => e.char).join(' ')} = ${run[0].text}`, group: run[0].group });
    run = [];
  };
  for (const e of entries) {
    if (run.length > 0 && (run[0].text !== e.text || run[0].group !== e.group)) flush();
    run.push(e);
  }
  flush();
  if (merged.length === 0) return [];
  // Columns sized for the short entries; a long one (a stack, a combination) spans several columns.
  const short = merged.map((e) => e.text.length).filter((n) => n <= 28);
  const column = Math.max(16, ...short) + 4;
  const lines: string[] = [];
  let line = '';
  let group: string | null = null;
  for (const e of merged) {
    if (line !== '' && (e.group !== group || line.length + e.text.length > 100)) {
      lines.push(line.trimEnd());
      line = '';
    }
    line += e.text.padEnd(Math.ceil((e.text.length + 2) / column) * column);
    group = e.group;
  }
  lines.push(line.trimEnd());
  return lines;
}

/**
 * Canonical text of a validated level: title, header, numbered map and legend. Zones and boxes appear in the legend
 * in the level's own order (zones first where that order allows it) with ids only when they differ from the generated
 * ones, so parsing the text gives the same LevelData back.
 */
export function renderLevel(level: LevelData, extras: RenderExtras = {}): string {
  const { grid, legend } = drawLevel(level);
  const lines: string[] = [`# ${level.order} · ${level.name}`, `id: ${level.id}`, `limit: ${level.stackLimit ?? 1}`];
  if (level.theme !== 'default') lines.push(`tema: ${level.theme}`);
  if (![0, 90, 180, 270].includes(level.forklift.heading)) lines.push(`rumbo: ${level.forklift.heading}`);
  if (level.decor.windows.length > 0)
    lines.push(
      `ventanas: ${level.decor.windows
        .map((w) => `${WALL_NAMES[w.wall]} ${w.width === 1 ? w.at : `${w.at}-${w.at + w.width - 1}`}`)
        .join(', ')}`,
    );
  if (extras.targets && extras.targets.length > 0) lines.push(`dificultad: ${formatTargets(extras.targets)}`);
  for (const note of extras.notes ?? []) lines.push(`nota: ${note}`);
  lines.push('', ...renderMapLines(grid));
  if (legend.length > 0) lines.push('', ...legend);
  return `${lines.join('\n')}\n`;
}

/** The canonical map of a level (grid[z][x] = its character, as renderLevel draws it) and its legend lines. */
export function drawLevel(level: LevelData): { grid: string[][]; legend: string[] } {
  const { width, depth } = level.size;
  const grid = Array.from({ length: depth }, () => new Array<string>(width).fill('.'));
  const used = new Set<string>([...RESERVED, '=', ':']);
  const legendTail: RenderEntry[] = [];
  const key = (x: number, z: number) => z * width + x;

  // Shelves: «#» has 2 tiers; other tier counts, and a second character where two shelves of one kind touch, get a
  // legend letter («H» for the first tall one: no other pool hands it out).
  const charsByTiers = new Map<number, string[]>([[DEFAULT_TIERS, ['#']]]);
  const shelfCharAt = new Map<number, string>();
  for (const shelf of level.shelves) {
    const tiers = shelf.tiers ?? DEFAULT_TIERS;
    const touching = new Set<string>();
    for (let x = shelf.x; x < shelf.x + shelf.w; x++)
      for (let z = shelf.z; z < shelf.z + shelf.d; z++)
        for (const [nx, nz] of [
          [x + 1, z],
          [x - 1, z],
          [x, z + 1],
          [x, z - 1],
        ]) {
          const ch = shelfCharAt.get(key(nx, nz));
          if (ch !== undefined && nx >= 0 && nz >= 0 && nx < width && nz < depth) touching.add(ch);
        }
    const options = charsByTiers.get(tiers) ?? [];
    charsByTiers.set(tiers, options);
    let ch = options.find((c) => !touching.has(c));
    if (ch === undefined) {
      ch = take(tiers >= 3 ? TALL_SHELF_CHARS : SHELF_CHARS, used);
      options.push(ch);
      legendTail.push({ char: ch, text: `estantería ${tiers} ${plural(tiers, 'altura', 'alturas')}`, group: 'otro' });
    }
    for (let x = shelf.x; x < shelf.x + shelf.w; x++)
      for (let z = shelf.z; z < shelf.z + shelf.d; z++) {
        grid[z][x] = ch;
        shelfCharAt.set(key(x, z), ch);
      }
  }

  // Plants: «p» takes its variant from its position (reading order, like validateLevel's default); other variants
  // get a legend letter.
  const readingIndex = new Map(
    [...level.decor.plants].sort((a, b) => a.z - b.z || a.x - b.x).map((p, i) => [key(p.x, p.z), i] as const),
  );
  const plantChars = new Map<number, string>();
  for (const plant of level.decor.plants) {
    const index = readingIndex.get(key(plant.x, plant.z)) ?? 0;
    const variant = plant.variant ?? index;
    let ch = 'p';
    if (variant !== index) {
      ch = plantChars.get(variant) ?? take(PLANT_CHARS, used);
      if (!plantChars.has(variant)) {
        plantChars.set(variant, ch);
        legendTail.push({ char: ch, text: `planta variante ${variant}`, group: 'otro' });
      }
    }
    grid[plant.z][plant.x] = ch;
  }

  grid[level.forklift.z][level.forklift.x] = arrowOf(level.forklift.heading);

  // Storage units (docs/STORAGE.md): one character each, unit by unit (racks, then trucks), from its skin's letters
  // (their entries go after the zones and boxes). It marks a rack's own cells and a truck's door cells.
  const units = storageOf(level);
  /** The cell of every storage column (a truck's lies outside the map: string keys, never a map index). */
  const storageCells = new Set<string>();
  const unitChars = units.map((unit) => {
    const ch = take(STORAGE_SKINS[unit.skin].chars, used);
    unit.columns.forEach((_, column) => {
      const cell = cellOf(unit, column);
      const drawn = unit.access.kind === 'front' ? cell : frontOf(unit, column);
      grid[drawn.z][drawn.x] = ch;
      storageCells.add(`${cell.x},${cell.z}`);
    });
    return ch;
  });
  /** Boxes that start stored: in a rack slot or loaded on a truck (the rest are floor boxes and stacks). */
  const inRack = (b: LevelData['boxes'][number]) => b.level !== undefined && storageCells.has(`${b.x},${b.z}`);

  // Zones and boxes by cell. Legend order = LevelData order: zones first, a box-only cell whenever the next zone
  // carries later boxes (a crossing order, never shipped, cannot be kept and gets normalised by the parser).
  interface Item {
    zone: number | null;
    boxes: number[];
  }
  const boxesAt = new Map<number, number[]>();
  level.boxes.forEach((b, i) => {
    if (!inRack(b)) boxesAt.set(key(b.x, b.z), [...(boxesAt.get(key(b.x, b.z)) ?? []), i]);
  });
  const itemAt = new Map<number, Item>();
  level.zones.forEach((z, i) => itemAt.set(key(z.x, z.z), { zone: i, boxes: boxesAt.get(key(z.x, z.z)) ?? [] }));
  for (const [cell, boxes] of boxesAt) if (!itemAt.has(cell)) itemAt.set(cell, { zone: null, boxes });
  const zoneItems = level.zones.map((z) => itemAt.get(key(z.x, z.z))!);
  const boxItems = level.boxes.filter((b) => !inRack(b)).map((b) => itemAt.get(key(b.x, b.z))!);
  const ordered: Item[] = [];
  const done = new Set<Item>();
  let zi = 0;
  let bi = 0;
  while (ordered.length < itemAt.size) {
    while (zi < zoneItems.length && done.has(zoneItems[zi])) zi++;
    while (bi < boxItems.length && done.has(boxItems[bi])) bi++;
    const z = zi < zoneItems.length ? zoneItems[zi] : null;
    const b = bi < boxItems.length ? boxItems[bi] : null;
    const next = z && (z.boxes.length === 0 || z === b || b === null) ? z : b && b.zone === null ? b : (z ?? b)!;
    done.add(next);
    ordered.push(next);
  }

  const entries: RenderEntry[] = [];
  const levelBoxes = level.boxes;
  let zoneCount = 0;
  let boxCount = 0;
  for (const item of ordered) {
    const parts: string[] = [];
    if (item.zone !== null) {
      const zone = level.zones[item.zone];
      zoneCount++;
      parts.push(zoneText(zone) + (zone.id === `z${zoneCount}` ? '' : ` (${zone.id})`));
    }
    if (item.boxes.length > 0) {
      const texts = item.boxes.map((i) => {
        boxCount++;
        const box = level.boxes[i];
        return boxText(box, box.id === `b${boxCount}` ? null : box.id);
      });
      parts.push(texts.length === 1 ? `caja ${texts[0]}` : `pila ${texts.join(',')}`);
    }
    const ch = take(item.zone !== null ? ZONE_CHARS : BOX_CHARS, used);
    const any = item.zone !== null ? level.zones[item.zone] : level.boxes[item.boxes[0]];
    grid[any.z][any.x] = ch;
    entries.push({ char: ch, text: parts.join(' + '), group: item.zone !== null ? 'zona' : 'caja' });
  }

  // Storage entries, unit by unit (racks, then trucks); their boxes are numbered after the floor boxes (column by
  // column, bottom → top); an id is written only when it is not the generated one (prefix + number within the skin).
  const inSkin = Object.fromEntries(STORAGE_SKIN_ORDER.map((skin) => [skin, 0])) as Record<StorageSkin, number>;
  units.forEach((unit, u) => {
    const generated = `${STORAGE_SKINS[unit.skin].idPrefix}${++inSkin[unit.skin]}`;
    const boxAt = (column: number, level: number) => {
      const cell = cellOf(unit, column);
      const box = levelBoxes.find((b) => b.x === cell.x && b.z === cell.z && b.level === level);
      if (!box) return null;
      boxCount++;
      return `caja ${boxText(box, box.id === `b${boxCount}` ? null : box.id)}`;
    };
    entries.push({ char: unitChars[u], text: unitText(unit, unit.id === generated ? null : unit.id, boxAt), group: unit.skin });
  });

  return { grid, legend: layoutLegend([...entries, ...legendTail]) };
}

/** Numbered map rows under a column ruler (x mod 10), as in a .level file. */
export function renderMapLines(grid: readonly (readonly string[])[]): string[] {
  const labelWidth = String(grid.length - 1).length;
  const width = grid[0]?.length ?? 0;
  return [
    ' '.repeat(labelWidth + 1) + Array.from({ length: width }, (_, x) => String(x % 10)).join(''),
    ...grid.map((row, z) => `${String(z).padStart(labelWidth)} ${row.join('')}`),
  ];
}

/** The canonical form of a .level text (what `npm run levels:fmt` writes): keeps its targets and notes. */
export function formatLevel(text: string, file?: string): string {
  const parsed = parseLevel(text, file);
  return renderLevel(parsed.level, parsed);
}
