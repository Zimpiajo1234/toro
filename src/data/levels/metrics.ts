/**
 * Difficulty metrics of a level, measured on the solver's grid model (solver.ts): what `npm run levels` prints and
 * what `dificultad:` targets are checked against (docs/LEVELS.md, «Métricas»). Pure.
 */
import type { LevelBox, LevelData, StorageSkin, ZoneCriteria } from '../../core/types';
import { assignBoxes, assignmentsOf, criteriaOf, meets, sortableOf, targetsOf, usesSymbols, type Sortable } from '../../core/sorting';
import { STORAGE_SKINS, STORAGE_SKIN_ORDER, hasStorage, storageColumnsOf, storageOf, storageSlotsOf, type StorageSlotRef } from '../../core/storage';
import { targetHolds, targetRefuted, type DifficultyMetric, type DifficultyTarget, type MetricRange } from '../difficulty';
import {
  LevelGrid,
  POS_STACK,
  boxCode,
  correctPrefix,
  deadEnds,
  lockedAt,
  minMoves,
  occupancyOf,
  reachableFrom,
  stacksOf,
  zoneSteps,
  type DeadEndResult,
  type MinMovesOptions,
  type MinMovesResult,
} from './solver';

export interface LevelMetrics {
  id: string;
  order: number;
  name: string;
  width: number;
  depth: number;
  boxes: number;
  zones: number;
  stackLimit: number;
  /** «obligadas»: boxes that must move at least once (not part of a correct stack on their zone). */
  mustMove: number;
  /** «movimientos»: fewest box moves (pick + drop) in the conservative carrying model; exact or a lower bound. */
  moves: MinMovesResult;
  /** «extra»: moves beyond the obligatory ones (parking, re-ordering a stack, undoing a trap). */
  extra: MetricRange;
  /** «bloqueos»: boxes that must move before another box or a zone can be used (ids). */
  blockers: { count: number; covering: string[]; gatekeepers: string[] };
  /** «estrechas»: floor cells where a loaded 90° turn is impossible (no free 2×2 square around them). */
  narrow: { count: number; floor: number; cells: number[] };
  /** «libre»: % of cells with no shelf, plant or box at the start. */
  freeFloorPct: number;
  /** «ambiguas»: boxes with more than one possible destination (distinct zones or stack heights). */
  ambiguous: number;
  /** «trampas»: accepted placements (box kind → zone kind) that leave another box without a zone. */
  traps: number;
  /**
   * «repartos»: distinct complete sortings (levels that sort by symbol, up to identical boxes and identical zones), or
   * in a level with storage distinct complete assignments to its targets (up to identical boxes; always 1 there); null
   * otherwise.
   */
  sortings: number | null;
  /**
   * «huecos»: the storage levels of skin `rack` (docs/RACKS.md: its slots): all of them, those with a cue (targets) and
   * the «libre» ones. Counted like every skin (storageCounts), reported for this one.
   */
  slots: { total: number; cued: number; free: number };
  /**
   * «camion»: the storage of skin `truck` (docs/DOCKS.md): its units, columns and levels (every level is a target;
   * `loaded` of them start with a box on them). Counted like every skin (storageCounts), reported for this one.
   */
  trucks: { trucks: number; columns: number; levels: number; loaded: number };
  /**
   * «callejones»: states the forklift can reach from which the level can no longer be finished, explored around a
   * shortest plan (solver.deadEnds); null when not measured.
   */
  deadEnds: DeadEndResult | null;
}

export interface MetricsOptions extends MinMovesOptions {
  /** Skip the move search: `moves` is then just the obligatory moves as a lower bound. */
  skipMoves?: boolean;
  /** Look for dead ends, expanding at most this many states (solver.deadEnds `maxStates`); default: not measured. */
  deadEndStates?: number;
}

/** States the report explores for «callejones» by default (every slip along a shortest plan, then around it). */
export const DEAD_END_STATES = 60;

/** Boxes that must move at least once: not part of a correct stack on their zone (with storage: not on their destiny). */
function mustMoveOf(level: LevelData): number {
  const grid = new LevelGrid(level);
  const stacks = stacksOf(grid, level);
  let placed = 0;
  for (let c = 0; c < grid.posCount; c++) if (grid.steps[c]) placed += correctPrefix(grid, stacks, c);
  return level.boxes.length - placed;
}

/** One skin's storage (docs/STORAGE.md): units, columns, levels, levels with a cue, boxes stored at the start. */
interface SkinCount {
  units: number;
  columns: number;
  levels: number;
  cued: number;
  loaded: number;
}

/** Every skin's storage, counted the same way for all: unit by unit, column by column, level by level. */
function storageCounts(level: LevelData, grid: LevelGrid): { readonly [S in StorageSkin]: SkinCount } {
  const counts = Object.fromEntries(STORAGE_SKIN_ORDER.map((skin) => [skin, { units: 0, columns: 0, levels: 0, cued: 0, loaded: 0 }])) as {
    [S in StorageSkin]: SkinCount;
  };
  for (const unit of storageOf(level)) counts[unit.skin].units++;
  for (const column of storageColumnsOf(level)) counts[column.unit.skin].columns++;
  for (const slot of storageSlotsOf(level)) {
    counts[slot.unit.skin].levels++;
    if (slot.cue !== null) counts[slot.unit.skin].cued++;
  }
  // A box stored at the start rests on a storage position (its column's cell: inside the map or beyond a wall).
  for (const b of level.boxes) {
    const column = grid.columnOfPos(grid.posOf(b.x, b.z, b.level));
    if (column) counts[column.ref.unit.skin].loaded++;
  }
  return counts;
}

/** All metrics of a level (the move search dominates the cost; `options` caps it or skips it). */
export function levelMetrics(level: LevelData, options: MetricsOptions = {}): LevelMetrics {
  const grid = new LevelGrid(level);
  const stacks = stacksOf(grid, level);
  const mustMove = mustMoveOf(level);
  const moves: MinMovesResult = options.skipMoves
    ? { lower: mustMove, upper: null, exact: false, plan: null, unsolvable: false, states: 0 }
    : minMoves(level, options);
  const blockers = blockersOf(level, grid);
  const { rack, truck } = storageCounts(level, grid);
  return {
    id: level.id,
    order: level.order,
    name: level.name,
    width: level.size.width,
    depth: level.size.depth,
    boxes: level.boxes.length,
    zones: level.zones.length,
    stackLimit: level.stackLimit ?? 1,
    mustMove,
    moves,
    extra: {
      lower: moves.lower - mustMove,
      upper: moves.exact ? moves.lower - mustMove : moves.upper === null ? Infinity : moves.upper - mustMove,
    },
    blockers: { count: new Set([...blockers.covering, ...blockers.gatekeepers]).size, ...blockers },
    narrow: narrowCells(grid),
    freeFloorPct: freeFloor(grid, stacks),
    ambiguous: ambiguousBoxes(level),
    traps: hasStorage(level) ? targetTraps(level) : usesSymbols(level) ? trapPlacements(level) : 0,
    sortings: hasStorage(level) ? targetAssignments(level) : usesSymbols(level) ? distinctSortings(level) : null,
    slots: { total: rack.levels, cued: rack.cued, free: rack.levels - rack.cued },
    trucks: { trucks: truck.units, columns: truck.columns, levels: truck.levels, loaded: truck.loaded },
    deadEnds:
      options.deadEndStates === undefined
        ? null
        : deadEnds(level, { maxStates: options.deadEndStates, ...(moves.plan ? { plan: moves.plan } : {}), reverse: options.reverse }),
  };
}

/** The measured range of one metric (NaN when it does not apply to the level). */
export function metricRange(metrics: LevelMetrics, metric: DifficultyMetric): MetricRange {
  const exact = (n: number): MetricRange => ({ lower: n, upper: n });
  switch (metric) {
    case 'movimientos':
      return metrics.moves.exact ? exact(metrics.moves.lower) : { lower: metrics.moves.lower, upper: metrics.moves.upper ?? Infinity };
    case 'extra':
      return metrics.extra;
    case 'obligadas':
      return exact(metrics.mustMove);
    case 'bloqueos':
      return exact(metrics.blockers.count);
    case 'estrechas':
      return exact(metrics.narrow.count);
    case 'libre':
      return exact(metrics.freeFloorPct);
    case 'ambiguas':
      return exact(metrics.ambiguous);
    case 'trampas':
      return exact(metrics.traps);
    case 'repartos':
      return metrics.sortings === null ? exact(Number.NaN) : exact(metrics.sortings);
    case 'callejones': {
      const d = metrics.deadEnds;
      if (!d) return exact(Number.NaN);
      // Proven dead ends found; the count is exact only once every reachable state was explored.
      return { lower: d.found, upper: d.complete ? d.found + d.unknown : Infinity };
    }
    case 'cajas':
      return exact(metrics.boxes);
    case 'zonas':
      return exact(metrics.zones);
    case 'huecos':
      return exact(metrics.slots.total);
    case 'camion':
      return exact(metrics.trucks.levels);
  }
}

export interface TargetCheck {
  target: DifficultyTarget;
  range: MetricRange;
  ok: boolean;
}

export function checkTargets(metrics: LevelMetrics, targets: readonly DifficultyTarget[]): TargetCheck[] {
  return targets.map((target) => {
    const range = metricRange(metrics, target.metric);
    return { target, range, ok: targetHolds(target, range) };
  });
}

/**
 * Measures a level just enough to decide its `dificultad:` targets: the move search is skipped when no target is about
 * moves, and stops as soon as every move target is proven or refuted (what the level tests run).
 */
export function checkLevelTargets(level: LevelData, targets: readonly DifficultyTarget[], options: MetricsOptions = {}): TargetCheck[] {
  if (targets.length === 0) return [];
  const aboutMoves = (t: DifficultyTarget) => t.metric === 'movimientos' || t.metric === 'extra';
  const deadEndStates = targets.some((t) => t.metric === 'callejones') ? (options.deadEndStates ?? DEAD_END_STATES) : undefined;
  if (!targets.some(aboutMoves)) return checkTargets(levelMetrics(level, { skipMoves: true, deadEndStates, reverse: options.reverse }), targets);
  const must = mustMoveOf(level);
  const decided = (lower: number, upper: number | null) =>
    targets.filter(aboutMoves).every((t) => {
      const shift = t.metric === 'extra' ? must : 0;
      const range = { lower: lower - shift, upper: (upper ?? Infinity) - shift };
      return targetHolds(t, range) || targetRefuted(t, range);
    });
  return checkTargets(levelMetrics(level, { ...options, deadEndStates, until: decided }), targets);
}

/**
 * Blockers at the start:
 * - covering: a box resting on a zone above the part of its stack that fits it (the zone cannot take its box until
 *   it moves), or on top of a box that has to move (a stack off any zone, or a wrongly ordered one);
 * - gatekeepers: an accessible stack whose removal lets the empty forklift get next to a box or a zone that can
 *   take a box, which it could not reach before.
 */
function blockersOf(level: LevelData, grid: LevelGrid): { covering: string[]; gatekeepers: string[] } {
  const stacks = stacksOf(grid, level);
  const byCell = new Map<number, LevelBox[]>();
  for (const b of level.boxes) {
    const cell = grid.posOf(b.x, b.z, b.level);
    byCell.set(cell, [...(byCell.get(cell) ?? []), b]);
  }
  // A stack column lists its boxes by level (bottom → top), like a floor stack.
  for (const [cell, boxes] of byCell) if (grid.kind[cell] === POS_STACK) boxes.sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
  const covering: string[] = [];
  for (const [cell, boxes] of byCell) {
    // A box on a «libre» shelf covers nothing (a shelf holds one box); off zones, only boxes above the bottom one do.
    const firstLoose = grid.steps[cell] ? correctPrefix(grid, stacks, cell) : 1;
    boxes.forEach((b, i) => {
      if (i >= firstLoose) covering.push(b.id);
    });
  }

  const occupancy = occupancyOf(grid, stacks);
  const start = grid.index(level.forklift.x, level.forklift.z);
  // A storage position is reached from its column's front cell (a rack's front cell, a truck's door cell).
  const touches = (region: Uint8Array, pos: number) =>
    grid.isStorage(pos)
      ? region[grid.accessOf(pos)] === 1
      : [0, 1, 2, 3].some((d) => {
          const n = grid.step(pos, d);
          return n >= 0 && region[n] === 1;
        });
  const needed: number[] = [];
  for (let c = 0; c < grid.posCount; c++) {
    // A locked box (levels with storage) is never lifted and takes nothing more: no reason to reach it (a stack column
    // whose satisfied levels are locked still takes its next level: it is reached while it has room).
    if (lockedAt(grid, stacks, c) && !(grid.kind[c] === POS_STACK && stacks[c].length < grid.capacity[c])) continue;
    const steps = grid.steps[c];
    const open = steps !== null && correctPrefix(grid, stacks, c) === stacks[c].length && stacks[c].length < steps.length;
    if (stacks[c].length > 0 || open) needed.push(c);
  }
  const base = reachableFrom(grid, occupancy, start);
  const unreached = needed.filter((c) => !touches(base, c));
  const gatekeepers: string[] = [];
  if (unreached.length > 0) {
    for (const [cell, boxes] of byCell) {
      // A locked box (levels with storage: on its destiny from the start) never moves, so it opens nothing; neither does
      // a storage position, off the floor.
      if (grid.isStorage(cell) || !touches(base, cell) || lockedAt(grid, stacks, cell)) continue;
      const without = occupancy.slice();
      without[cell] = -1;
      const region = reachableFrom(grid, without, start);
      if (unreached.some((u) => u !== cell && touches(region, u))) gatekeepers.push(...boxes.map((b) => b.id));
    }
  }
  return { covering, gatekeepers };
}

/** Floor cells not covered by any 2×2 square of free floor (shelves, plants and the walls block; boxes move). */
function narrowCells(grid: LevelGrid): { count: number; floor: number; cells: number[] } {
  const free = (x: number, z: number) => x >= 0 && z >= 0 && x < grid.width && z < grid.depth && grid.solid[grid.index(x, z)] === 0;
  const cells: number[] = [];
  let floor = 0;
  for (let z = 0; z < grid.depth; z++) {
    for (let x = 0; x < grid.width; x++) {
      if (!free(x, z)) continue;
      floor++;
      let turn = false;
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) if (free(x + dx, z) && free(x, z + dz) && free(x + dx, z + dz)) turn = true;
      if (!turn) cells.push(grid.index(x, z));
    }
  }
  return { count: cells.length, floor, cells };
}

function freeFloor(grid: LevelGrid, stacks: readonly string[]): number {
  let free = 0;
  for (let c = 0; c < grid.cellCount; c++) if (grid.solid[c] === 0 && stacks[c].length === 0) free++;
  return Math.round((100 * free) / grid.cellCount);
}

/** Identical zones (same criteria and recipe) are one destination. */
const zoneKind = (zone: LevelData['zones'][number]) => JSON.stringify([zone.color ?? null, zone.symbol ?? null, zone.recipe ?? null]);

/** A storage cue as a destination kind: identical cues of one skin are one destination, like identical zones. */
const cueKind = (skin: StorageSkin, cue: ZoneCriteria) => JSON.stringify([skin, cue.color ?? null, cue.symbol ?? null]);

/**
 * A storage level with a cue as a destination kind, by its support: a shelf is one kind at any height; a level of a
 * stack column is one at its height, like a floor zone's stack.
 */
function slotKind(slot: StorageSlotRef & { cue: ZoneCriteria }): string {
  const kind = cueKind(slot.unit.skin, slot.cue);
  return STORAGE_SKINS[slot.unit.skin].support === 'stack' ? `${kind}@${slot.level}` : kind;
}

function ambiguousBoxes(level: LevelData): number {
  const cued = storageSlotsOf(level).filter((s): s is StorageSlotRef & { cue: ZoneCriteria } => s.cue !== null);
  return level.boxes.filter((b) => {
    const box = sortableOf(b);
    const destinations = new Set<string>();
    for (const zone of level.zones) {
      zoneSteps(zone).forEach((step, height) => {
        if (meets(step, box)) destinations.add(`${zoneKind(zone)}@${height}`);
      });
    }
    for (const slot of cued) if (meets(slot.cue, box)) destinations.add(slotKind(slot));
    return destinations.size > 1;
  }).length;
}

/**
 * Levels with storage: placements a cue accepts (box kind → kind of zone or storage cue, per skin) that are not the
 * box's destiny, so they leave some other box without its place: a box there fits but never lights (docs/STORAGE.md
 * rules 4 and 6).
 */
function targetTraps(level: LevelData): number {
  const targets = targetsOf(level);
  const kindOf = (t: (typeof targets)[number]) => (t.skin === null ? zoneKind(level.zones[t.index]) : cueKind(t.skin, t.criteria));
  const boxes = level.boxes.map(sortableOf);
  const traps = new Set<string>();
  boxes.forEach((box, i) => {
    targets.forEach((target, t) => {
      if (!meets(target.criteria, box)) return;
      const rest = boxes.filter((_, j) => j !== i);
      const open = targets.filter((_, u) => u !== t).map((u) => u.criteria);
      if (assignmentsOf(rest, open, 1).count === 0) traps.add(`${boxCode(box)}→${kindOf(target)}`);
    });
  });
  return traps.size;
}

/** Levels with storage: complete assignments of boxes to its targets (by position), up to identical boxes. */
function targetAssignments(level: LevelData): number {
  return assignmentsOf(level.boxes.map(sortableOf), targetsOf(level).map((t) => t.criteria), 10_001).count;
}

function trapPlacements(level: LevelData): number {
  const traps = new Set<string>();
  level.boxes.forEach((b, i) => {
    const box = sortableOf(b);
    for (const zone of level.zones) {
      if (!meets(criteriaOf(zone), box)) continue;
      const rest = level.boxes.filter((_, j) => j !== i).map(sortableOf);
      const open = level.zones.filter((z) => z !== zone).map(criteriaOf);
      if (assignBoxes(rest, open).includes(-1)) traps.add(`${boxCode(box)}→${zoneKind(zone)}`);
    }
  });
  return traps.size;
}

/** Complete sortings (one box per zone), counted once up to identical boxes and identical zones. */
function distinctSortings(level: LevelData): number {
  const boxes: Sortable[] = level.boxes.map(sortableOf);
  const zones = level.zones.map((z) => ({ criteria: criteriaOf(z), kind: zoneKind(z) }));
  const found = new Set<string>();
  const used = new Uint8Array(zones.length);
  const pairs: string[] = [];
  const place = (b: number) => {
    if (found.size > 10_000) return;
    if (b === boxes.length) {
      found.add([...pairs].sort().join('|'));
      return;
    }
    zones.forEach((zone, z) => {
      if (used[z] === 1 || !meets(zone.criteria, boxes[b])) return;
      used[z] = 1;
      pairs.push(`${boxCode(boxes[b])}→${zone.kind}`);
      place(b + 1);
      pairs.pop();
      used[z] = 0;
    });
  };
  place(0);
  return found.size;
}
