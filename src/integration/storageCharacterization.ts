/**
 * Characterization of the storage units (docs/STORAGE.md, «Red de seguridad»): what the storage racks and the dock
 * trucks of a level are and do today, frozen in ./storageCharacterization.json so that the phases of the shared storage
 * model that must not change the game (1–5) can prove it; phase 6, which changes the rules, regenerates it on purpose.
 *
 * Everything is written in terms that survive the refactor: unit ids, slot ids (`unit:column:level`), map cells
 * (`x,z`, floor stacks `x,z@height`, a zone's id in brackets) and box kinds (`colour/symbol`; a cue that asks nothing of
 * one of them writes `*`, a «libre» slot `libre`). Never a solver position number or the shape of an API: when a phase
 * renames or merges an API, it ports the functions of this file and the JSON stays byte for byte the same.
 *
 * Sections per level (test: ./storageCharacterization.test.ts):
 * - storage: the units as LevelStorage (id, skin, first cell, width, access, cues bottom → top, null = «libre»; since
 *   phase 2 read straight from `level.storage`), every box at the start and every storage slot in snapshot order;
 * - targets: the target rules, the targets with their destined kind and chime timbre, the unique assignment;
 * - metrics: the level metrics of `npm run levels` (no dead-end check: benchmark.test.ts and storageFixture.test.ts run
 *   it);
 * - solver: the exact search's result and its plan, replayed move by move;
 * - start: the live state after load (GameState): progress, every slot and every box;
 * - autopilot60 / autopilot20: the autopilot's game at 60 and 20 fps (moves, frames, controls, every box move).
 *
 * Regenerate (phase 6 only; never by hand):
 *   TORO_CARACTERIZAR=1 npx vitest run src/integration/storageCharacterization.test.ts -u
 *   (PowerShell: $env:TORO_CARACTERIZAR = '1'; npx vitest run src/integration/storageCharacterization.test.ts -u;
 *   Remove-Item Env:TORO_CARACTERIZAR)
 * With the variable set the test only rewrites the file; `-u` alone never touches it.
 */
import type { BoxState, Facing, LevelData, WallSide, ZoneCriteria } from '../core/types';
import { hasRacks } from '../core/racks';
import { STORAGE_SKINS, hasStorage, storageOf, storageSlotsOf } from '../core/storage';
import { assignmentsOf, levelDestinies, sortableOf, targetsOf, usesSymbols, zoneMatchKinds, type Sortable } from '../core/sorting';
import { parseLevel } from '../data/asciiLevel';
import { BENCHMARK_ID, getSpecialLevel } from '../data/levels';
import { levelMetrics } from '../data/levels/metrics';
import { LevelGrid, boxOfCode, lift, minMoves, stacksOf } from '../data/levels/solver';
import { GameState } from '../logic/GameState';
import { autopilot } from './autopilot';
import threeTrucksText from '../data/levels/pruebas/tres-camiones.level?raw';

/** The data file, from the project root (next to its test). */
export const CHARACTERIZATION_PATH = 'src/integration/storageCharacterization.json';

/** The test-only fixture level (docs/STORAGE.md): three trucks on two walls, racks of 2 and 3 levels. */
export const THREE_TRUCKS_FILE = 'src/data/levels/pruebas/tres-camiones.level';
export const THREE_TRUCKS = parseLevel(threeTrucksText, THREE_TRUCKS_FILE);

/** The levels the file freezes: the Benchmark and the three-truck fixture. */
export const CHARACTERIZED_LEVELS: readonly LevelData[] = [getSpecialLevel(BENCHMARK_ID)!, THREE_TRUCKS.level];

const COMMENT =
  'Storage characterization (docs/STORAGE.md): phases 1-5 of the shared storage model must leave it unchanged; phase 6 regenerates it: TORO_CARACTERIZAR=1 npx vitest run src/integration/storageCharacterization.test.ts -u. Never edit by hand.';

/** A storage unit as the planned LevelStorage (docs/STORAGE.md «Modelo»). */
export interface StorageUnitView {
  id: string;
  skin: 'rack' | 'truck';
  x: number;
  z: number;
  w: number;
  access: { kind: 'front'; facing: Facing } | { kind: 'door'; wall: WallSide };
  /** Per column, its cues bottom → top; null = «libre». */
  columns: (ZoneCriteria | null)[][];
}

export interface AutopilotView {
  solved: boolean;
  /** Box moves driven, and the move counter the HUD would show. */
  moves: number;
  counter: number;
  /** Frames until the level completed (the autopilot stops there). */
  frames: number;
  forkSteps: number;
  reverseFrames: number;
  /** Every box move, in order: `box from → to`, then ` ok n/total` (its target lit) or ` wrong` (the soft buzz). */
  log: string[];
}

export interface LevelCharacterization {
  storage: { units: StorageUnitView[]; boxes: string[]; slots: string[] };
  targets: {
    rules: { targetRules: boolean; symbols: boolean; forkRow: boolean };
    counts: { zones: number; slots: number; truckLevels: number; assignments: number };
    /** `id cue → destined kind (chime timbre)`, in targetsOf order: zones, cued rack slots, truck levels. */
    destinies: string[];
  };
  metrics: {
    mustMove: number;
    moves: number;
    exact: boolean;
    extra: number;
    blockers: { count: number; covering: string[]; gatekeepers: string[] };
    narrow: number;
    free: number;
    ambiguous: number;
    traps: number;
    sortings: number | null;
    slots: { total: number; cued: number; free: number };
    trucks: { trucks: number; columns: number; levels: number; loaded: number };
  };
  solver: { lower: number; upper: number | null; exact: boolean; unsolvable: boolean; states: number; plan: string[] };
  start: { progress: string; slots: string[]; boxes: string[] };
  autopilot60: AutopilotView;
  autopilot20: AutopilotView;
}

export type CharacterizationSection = keyof LevelCharacterization;

export interface CharacterizationFile {
  $comment: string;
  levels: Record<string, LevelCharacterization>;
}

/* ------------------------------------------------------------------ */
/* Texts                                                               */
/* ------------------------------------------------------------------ */

const kindText = (k: Sortable) => `${k.color}/${k.symbol}`;
/** A cue or a zone's criteria as `colour/symbol`, `*` for the one it does not ask for; null = `libre`. */
const cueText = (c: ZoneCriteria | null) => (c === null ? 'libre' : `${c.color ?? '*'}/${c.symbol ?? '*'}`);
const cellText = (c: { x: number; z: number }) => `${c.x},${c.z}`;

/** Where a live box rests: its storage slot id, else its floor cell and height (and the zone it is on). */
function boxAt(box: BoxState): string {
  const slot = box.slotId;
  if (slot !== null) return slot;
  if (!box.cell) return 'carried';
  return `${cellText(box.cell)}@${box.level}${box.zoneId === null ? '' : `[${box.zoneId}]`}`;
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

/** The units, the boxes at the start (LevelData) and every storage slot (core/storage geometry), in snapshot order. */
export function storageSection(level: LevelData): LevelCharacterization['storage'] {
  const units = storageOf(level).map(
    (unit): StorageUnitView => ({
      id: unit.id,
      skin: unit.skin,
      x: unit.x,
      z: unit.z,
      w: unit.w,
      access: { ...unit.access },
      columns: unit.columns.map((levels) => levels.map((cue) => (cue === null ? null : { ...cue }))),
    }),
  );
  const storageSlots = storageSlotsOf(level);
  // A box in storage names its slot; a floor box its cell and its height in the stack there (list order).
  const slotAt = new Map<string, string>();
  for (const s of storageSlots) slotAt.set(`${cellText(s.cell)}@${s.level}`, s.id);
  const zoneAt = new Map(level.zones.map((z) => [cellText(z), z.id]));
  const height = new Map<string, number>();
  const boxes = level.boxes.map((b) => {
    const kind = kindText(sortableOf(b));
    const stored = b.level === undefined ? undefined : slotAt.get(`${cellText(b)}@${b.level}`);
    if (stored !== undefined) return `${b.id} ${kind} ${stored}`;
    const h = height.get(cellText(b)) ?? 0;
    height.set(cellText(b), h + 1);
    const zone = zoneAt.get(cellText(b));
    return `${b.id} ${kind} ${cellText(b)}@${h}${zone === undefined ? '' : `[${zone}]`}`;
  });
  const slots = storageSlots.map((s) => `${s.id} cell ${cellText(s.cell)} front ${cellText(s.front)} ${s.facing} · ${cueText(s.cue)}`);
  return { units, boxes, slots };
}

/** Target rules, every target with its destined kind and chime timbre, and the count of complete assignments. */
export function targetsSection(level: LevelData): LevelCharacterization['targets'] {
  const targets = targetsOf(level);
  const destinies = levelDestinies(level);
  const kinds = zoneMatchKinds(level);
  const destinyOf = (t: (typeof targets)[number]): Sortable | null | undefined =>
    t.kind === 'zone' ? destinies?.zones[t.index] : destinies?.slots[t.index];
  return {
    rules: { targetRules: hasStorage(level), symbols: usesSymbols(level), forkRow: hasRacks(level) },
    counts: {
      zones: targets.filter((t) => t.kind === 'zone').length,
      slots: targets.filter((t) => t.skin === 'rack').length,
      truckLevels: targets.filter((t) => t.skin === 'truck').length,
      assignments: assignmentsOf(level.boxes.map(sortableOf), targets.map((t) => t.criteria), 2).count,
    },
    destinies: targets.map((t) => {
      const destined = destinyOf(t);
      return `${t.id} ${cueText(t.criteria)} → ${destined ? kindText(destined) : '-'} (${kinds.get(t.id) ?? '-'})`;
    }),
  };
}

/** The metrics `npm run levels` prints (without the dead-end check). */
export function metricsSection(level: LevelData): LevelCharacterization['metrics'] {
  const m = levelMetrics(level);
  return {
    mustMove: m.mustMove,
    moves: m.moves.lower,
    exact: m.moves.exact,
    extra: m.extra.lower,
    blockers: { count: m.blockers.count, covering: [...m.blockers.covering], gatekeepers: [...m.blockers.gatekeepers] },
    narrow: m.narrow.count,
    free: m.freeFloorPct,
    ambiguous: m.ambiguous,
    traps: m.traps,
    sortings: m.sortings,
    slots: { ...m.slots },
    trucks: { ...m.trucks },
  };
}

/**
 * The exact search's result and its plan, each move replayed in the model: `kind from → to · forklift cell after`,
 * with storage positions as slot ids (a truck level: the height the box leaves or lands at) and floor ones as cells.
 */
export function solverSection(level: LevelData): LevelCharacterization['solver'] {
  const result = minMoves(level);
  const grid = new LevelGrid(level);
  const slots = storageSlotsOf(level);
  const zoneAt = new Map(level.zones.map((z) => [cellText(z), z.id]));
  const posText = (pos: number, height: number) => {
    // A storage position: the level the box leaves or lands at (a shelf's own, a stack column's at that height).
    if (grid.isStorage(pos)) return slots[grid.slotAt(pos, height)].id;
    const cell = cellText(grid.cellOf(pos));
    const zone = zoneAt.get(cell);
    return `${cell}@${height}${zone === undefined ? '' : `[${zone}]`}`;
  };
  let stacks = stacksOf(grid, level);
  const plan = (result.plan ?? []).map((move) => {
    const code = stacks[move.from].slice(-1);
    const from = posText(move.from, stacks[move.from].length - 1);
    const next = lift(stacks, move.from);
    const to = posText(move.drop, next[move.drop].length);
    next[move.drop] += code;
    stacks = next;
    return `${kindText(boxOfCode(code))} ${from} → ${to}${move.after === undefined ? '' : ` · ${cellText(grid.cellOf(move.after))}`}`;
  });
  return { lower: result.lower, upper: result.upper, exact: result.exact, unsolvable: result.unsolvable, states: result.states, plan };
}

/**
 * The live state right after load: progress, every storage slot (rack slots, then truck levels; a stack's also says
 * whether it is loadable, as it always did) and every box.
 */
export function startSection(level: LevelData): LevelCharacterization['start'] {
  const snap = new GameState(level).getSnapshot();
  const destinedText = (k: Sortable | null) => (k === null ? '-' : kindText(k));
  return {
    progress: `${snap.progress.satisfied}/${snap.progress.total}`,
    slots: snap.storageSlots.map(
      (s) =>
        `${s.id} accepts ${cueText(s.accepts)} destined ${destinedText(s.destined)} occupiedBy ${s.occupiedBy ?? '-'} satisfied ${s.satisfied}` +
        (STORAGE_SKINS[s.skin].support === 'stack' ? ` loadable ${s.loadable}` : ''),
    ),
    boxes: snap.boxes.map((b) => `${b.id} ${kindText(b)} ${boxAt(b)} correct ${b.correct} locked ${b.locked}`),
  };
}

/** The autopilot's game (./autopilot.ts) at frame time `dt`, summed up. */
export function autopilotSection(level: LevelData, dt: number): AutopilotView {
  const where = new Map(new GameState(level).getSnapshot().boxes.map((b) => [b.id, boxAt(b)]));
  const out = autopilot(level, dt);
  const log: string[] = [];
  for (const e of out.events) {
    if (e.type !== 'boxDropped') continue;
    const floor = `${cellText(e.cell)}@${e.level}${e.zoneId === null ? '' : `[${e.zoneId}]`}`;
    const to = e.slotId ?? floor;
    const flags = `${e.correct ? ` ok ${e.satisfiedCount}/${e.total}` : ''}${e.wrongTarget ? ' wrong' : ''}`;
    log.push(`${e.boxId} ${where.get(e.boxId) ?? '?'} → ${to}${flags}`);
    where.set(e.boxId, to);
  }
  return {
    solved: out.solved,
    moves: out.moves,
    counter: out.snapshot.moves,
    frames: Math.round(out.seconds / dt),
    forkSteps: out.controls.forkSteps,
    reverseFrames: out.controls.reverseFrames,
    log,
  };
}

/** How each section is measured (the file keeps them in this order). */
const SECTIONS: { readonly [K in CharacterizationSection]: (level: LevelData) => LevelCharacterization[K] } = {
  storage: storageSection,
  targets: targetsSection,
  metrics: metricsSection,
  solver: solverSection,
  start: startSection,
  autopilot60: (level) => autopilotSection(level, 1 / 60),
  autopilot20: (level) => autopilotSection(level, 1 / 20),
};

export const CHARACTERIZATION_SECTIONS = Object.keys(SECTIONS) as readonly CharacterizationSection[];

/** One section of one level. */
export function characterizeSection<S extends CharacterizationSection>(level: LevelData, section: S): LevelCharacterization[S] {
  return SECTIONS[section](level);
}

/** Every section of every level (what the file holds). */
export function characterizationFile(levels: readonly LevelData[] = CHARACTERIZED_LEVELS): CharacterizationFile {
  const out: Record<string, LevelCharacterization> = {};
  for (const level of levels) {
    out[level.id] = Object.fromEntries(CHARACTERIZATION_SECTIONS.map((s) => [s, characterizeSection(level, s)])) as unknown as LevelCharacterization;
  }
  return { $comment: COMMENT, levels: out };
}

/* ------------------------------------------------------------------ */
/* File form                                                           */
/* ------------------------------------------------------------------ */

/** Widest line a value is written on in one piece. */
const LINE = 120;

/** A value on one line: `{ "k": v, … }`, `[a, b]`. */
function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length === 0 ? '{}' : `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(', ')} }`;
  }
  return JSON.stringify(value);
}

/**
 * 2-space JSON; an array or object that fits on its line (`lead` = what comes before it there) within LINE columns
 * stays in one piece. Stable, so a regeneration diffs cleanly.
 */
function pretty(value: unknown, indent: string, lead: number): string {
  const one = inline(value);
  if (value === null || typeof value !== 'object' || lead + one.length + 1 <= LINE) return one;
  const inner = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((v) => `${inner}${pretty(v, inner, inner.length)}`).join(',\n')}\n${indent}]`;
  const entries = Object.entries(value).map(([k, v]) => {
    const key = `${inner}${JSON.stringify(k)}: `;
    return `${key}${pretty(v, inner, key.length)}`;
  });
  return `{\n${entries.join(',\n')}\n${indent}}`;
}

/** The file's text (final newline). */
export function formatCharacterization(file: CharacterizationFile): string {
  return `${pretty(file, '', 0)}\n`;
}
