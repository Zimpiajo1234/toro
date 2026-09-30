/**
 * Sorting rules shared by every module (logic, render, audio wiring, level validation, tests): which zone accepts
 * which box. A zone asks for a colour, a symbol, or both (docs/SORTING.md); `accepts` is the single source of truth.
 * Pure functions, no allocation in the per-frame ones (accepts, takesNext, specificity).
 */
import {
  DEFAULT_SYMBOL,
  type ColorSymbol,
  type LevelBox,
  type LevelData,
  type LevelZone,
  type RackSlot,
  type StorageSkin,
  type SymbolId,
  type ZoneCriteria,
  type ZoneState,
} from './types';
import { hasStorage, storageOf, storageSlotsOf } from './storage';

/** What sorting looks at on a box: its colour and symbol (boxes alike in both are interchangeable). */
export type Sortable = ColorSymbol;

/** How a zone matched the box it accepted: the chime's timbre (colour = bell, symbol = wood, exact = both). */
export type MatchKind = 'color' | 'symbol' | 'exact';

/** Symbol a level box carries: its own, else its colour's canonical one. */
export function symbolOf(box: Pick<LevelBox, 'color' | 'symbol'>): SymbolId {
  return box.symbol ?? DEFAULT_SYMBOL[box.color];
}

/** A level box as sorting sees it. */
export function sortableOf(box: Pick<LevelBox, 'color' | 'symbol'>): Sortable {
  return { color: box.color, symbol: symbolOf(box) };
}

/** The criteria a level zone declares (only the keys it sets). */
export function criteriaOf(zone: Pick<LevelZone, 'color' | 'symbol'>): ZoneCriteria {
  const criteria: ZoneCriteria = {};
  if (zone.color !== undefined) criteria.color = zone.color;
  if (zone.symbol !== undefined) criteria.symbol = zone.symbol;
  return criteria;
}

/** The box meets every criterion given (validateLevel makes sure a zone always declares at least one). */
export function meets(criteria: ZoneCriteria, box: Sortable): boolean {
  return (criteria.color === undefined || criteria.color === box.color) && (criteria.symbol === undefined || criteria.symbol === box.symbol);
}

/**
 * Single source of truth: the zone accepts `box` as its box (the bottom box of a stack zone) when the box meets every
 * criterion the zone declares — its colour, its symbol, or both (that exact box). A zone is satisfied iff it holds
 * such a box (plus, on a stack zone, its colour recipe above it).
 */
export function accepts(zone: { readonly accepts: ZoneCriteria }, box: Sortable): boolean {
  return meets(zone.accepts, box);
}

/**
 * Whether `box` fits height `level` of the zone's stack: the bottom box must be accepted, a box above it must have the
 * colour the zone's recipe asks for there.
 */
export function fitsLevel(zone: Pick<ZoneState, 'accepts' | 'recipe'>, level: number, box: Sortable): boolean {
  if (level === 0) return accepts(zone, box);
  return level < zone.recipe.length && zone.recipe[level] === box.color;
}

/**
 * The zone would take `box` as its next box: an empty zone that accepts it, or a stack zone whose correct, unfinished
 * stack needs that colour next. What the zone magnet pulls toward and what breathes while a box is carried.
 */
export function takesNext(zone: Pick<ZoneState, 'accepts' | 'stack' | 'next'>, box: Sortable): boolean {
  return zone.stack.length === 0 ? accepts(zone, box) : zone.next !== null && zone.next === box.color;
}

/** 2 = colour + symbol (exactly one kind of box), 1 = a single criterion. The zone magnet prefers the higher. */
export function specificity(criteria: ZoneCriteria): number {
  return (criteria.color === undefined ? 0 : 1) + (criteria.symbol === undefined ? 0 : 1);
}

export function matchKind(criteria: ZoneCriteria): MatchKind {
  if (criteria.symbol === undefined) return 'color';
  return criteria.color === undefined ? 'symbol' : 'exact';
}

/**
 * Match kind of every zone of a level, by zone id, and of every storage slot with a cue (docs/STORAGE.md: rack slots,
 * truck levels), by slot id.
 */
export function zoneMatchKinds(level: Pick<LevelData, 'zones' | 'storage'>): Map<string, MatchKind> {
  const kinds = new Map(level.zones.map((zone) => [zone.id, matchKind(criteriaOf(zone))]));
  for (const slot of storageSlotsOf(level)) if (slot.cue) kinds.set(slot.id, matchKind(slot.cue));
  return kinds;
}

/**
 * A level sorts by symbol when any of its boxes, zones or storage cues (rack slots, truck levels) names a symbol
 * (levels 1–18 never do).
 */
export function usesSymbols(level: Pick<LevelData, 'boxes' | 'zones' | 'storage'>): boolean {
  return (
    level.boxes.some((b) => b.symbol !== undefined) ||
    level.zones.some((z) => z.symbol !== undefined) ||
    storageOf(level).some((unit) => unit.columns.some((levels) => levels.some((cue) => cue?.symbol !== undefined)))
  );
}

/**
 * Largest assignment of boxes to zones that accept them, one box per zone (augmenting paths): the zone index for
 * each box, -1 for a box left without one. Every box gets a zone iff a complete sorting exists; validateLevel asks
 * for one in every level that sorts by symbol.
 */
export function assignBoxes(boxes: readonly Sortable[], zones: readonly ZoneCriteria[]): number[] {
  const zoneOfBox = new Array<number>(boxes.length).fill(-1);
  const boxOfZone = new Array<number>(zones.length).fill(-1);
  const seen = new Uint8Array(zones.length);
  const augment = (b: number): boolean => {
    for (let z = 0; z < zones.length; z++) {
      if (seen[z] === 1 || !meets(zones[z], boxes[b])) continue;
      seen[z] = 1;
      if (boxOfZone[z] < 0 || augment(boxOfZone[z])) {
        boxOfZone[z] = b;
        zoneOfBox[b] = z;
        return true;
      }
    }
    return false;
  };
  for (let b = 0; b < boxes.length; b++) {
    seen.fill(0);
    augment(b);
  }
  return zoneOfBox;
}

/* ------------------------------------------------------------------ */
/* Storage racks: cues, destined boxes, unique complete assignment      */
/* ------------------------------------------------------------------ */

/** Same colour and symbol (identical boxes are interchangeable). */
export function sameKind(a: Sortable, b: Sortable): boolean {
  return a.color === b.color && a.symbol === b.symbol;
}

/** A rack slot's cue as criteria, or null for a «libre» slot (it asks for nothing: plain storage). */
export function cueOf(slot: RackSlot): ZoneCriteria | null {
  const cue = criteriaOf(slot);
  return cue.color === undefined && cue.symbol === undefined ? null : cue;
}

/**
 * The box fits the target's cue (a zone's criteria, a slot's cue; never a «libre» slot): what breathes while it is
 * carried and what the zone magnet pulls toward. In a level with racks it does not mean the box is the right one.
 */
export function cueFits(target: { readonly accepts: ZoneCriteria | null }, box: Sortable): boolean {
  return target.accepts !== null && meets(target.accepts, box);
}

/** The box is the target's destined one (levels with racks: the only box that lights a zone or a slot). */
export function isDestined(target: { readonly destined: Sortable | null }, box: Sortable): boolean {
  return target.destined !== null && sameKind(target.destined, box);
}

/**
 * What satisfies a target as its (bottom) box: its destined kind when it has one (levels with racks), else any box its
 * criteria accept (every level without racks, unchanged).
 */
export function satisfiesTarget(
  target: { readonly accepts: ZoneCriteria | null; readonly destined: Sortable | null },
  box: Sortable,
): boolean {
  return target.destined !== null ? sameKind(target.destined, box) : cueFits(target, box);
}

/** Result of assignmentsOf. */
export interface Assignments {
  /** Complete assignments found, up to the limit asked for (with limit 2: 0, 1 or «two or more»). */
  count: number;
  /** The first assignments found (at most two): the box kind each target gets, in target order. */
  found: Sortable[][];
}

/**
 * Complete assignments of `boxes` to `targets`: every target gets one box that meets its criteria and every box is
 * used, counted up to identical boxes (two assignments differ when some target gets a box of another colour or
 * symbol). Backtracking over the targets with a matching check at every step, so it only walks branches that end in
 * an assignment; stops at `limit`. validateLevel needs exactly one in a level with racks.
 */
export function assignmentsOf(boxes: readonly Sortable[], targets: readonly ZoneCriteria[], limit = 2): Assignments {
  const found: Sortable[][] = [];
  if (boxes.length !== targets.length) return { count: 0, found };
  const kinds: Sortable[] = [];
  const left: number[] = [];
  for (const b of boxes) {
    const k = kinds.findIndex((kind) => sameKind(kind, b));
    if (k >= 0) left[k]++;
    else {
      kinds.push({ color: b.color, symbol: b.symbol });
      left.push(1);
    }
  }
  const pick: number[] = [];
  let count = 0;
  /** The boxes still unused can fill targets t… (a perfect matching exists). */
  const feasible = (t: number): boolean => {
    const rest: Sortable[] = [];
    kinds.forEach((kind, k) => {
      for (let n = 0; n < left[k]; n++) rest.push(kind);
    });
    return assignBoxes(rest, targets.slice(t)).every((z) => z >= 0);
  };
  const place = (t: number): void => {
    if (t === targets.length) {
      count++;
      if (found.length < 2) found.push(pick.map((k) => kinds[k]));
      return;
    }
    for (let k = 0; k < kinds.length && count < limit; k++) {
      if (left[k] === 0 || !meets(targets[t], kinds[k])) continue;
      left[k]--;
      pick.push(k);
      if (feasible(t + 1)) place(t + 1);
      pick.pop();
      left[k]++;
    }
  };
  if (feasible(0)) place(0);
  return { count, found };
}

/**
 * A target of a level with storage (docs/STORAGE.md rule 4): a floor zone, or a storage slot with a cue in any skin (a
 * rack slot, a truck level); «libre» slots are never targets (rule 7).
 */
export interface LevelTarget {
  kind: 'zone' | 'slot';
  /** Zone id or slot id. */
  id: string;
  /** Index in level.zones (kind 'zone') or in core/storage `storageSlotsOf` (kind 'slot'). */
  index: number;
  /** The skin of the slot's unit (kind 'slot'); null for a zone. */
  skin: StorageSkin | null;
  criteria: ZoneCriteria;
}

/**
 * Every target of a level: its zones (level order), then its storage slots with a cue (core/storage `storageSlotsOf`
 * order: unit by unit, rule 12: its rack slots, then its truck levels).
 */
export function targetsOf(level: Pick<LevelData, 'zones' | 'storage'>): LevelTarget[] {
  const targets: LevelTarget[] = level.zones.map((zone, index) => ({ kind: 'zone', id: zone.id, index, skin: null, criteria: criteriaOf(zone) }));
  storageSlotsOf(level).forEach((slot, index) => {
    if (slot.cue) targets.push({ kind: 'slot', id: slot.id, index, skin: slot.unit.skin, criteria: criteriaOf(slot.cue) });
  });
  return targets;
}

/** The destined box kind of every target of a level with storage (docs/STORAGE.md rule 4). */
export interface LevelDestinies {
  /** Per zone, in level.zones order. */
  zones: Sortable[];
  /** Per storage slot, in core/storage `storageSlotsOf` order (every skin): its destined kind, null for a «libre» one. */
  slots: (Sortable | null)[];
}

/**
 * Levels with storage: the kind of box the level's unique complete assignment puts on every zone and storage slot
 * with a cue (identical boxes are interchangeable, so a destiny is a kind, not a box id). null for a level without
 * storage, or one with no complete assignment or more than one (validateLevel refuses those).
 */
export function levelDestinies(level: Pick<LevelData, 'boxes' | 'zones' | 'storage'>): LevelDestinies | null {
  if (!hasStorage(level)) return null;
  const targets = targetsOf(level);
  const { count, found } = assignmentsOf(level.boxes.map(sortableOf), targets.map((t) => t.criteria));
  if (count !== 1) return null;
  const [assignment] = found;
  const zones = new Array<Sortable>(level.zones.length);
  const slots = new Array<Sortable | null>(storageSlotsOf(level).length).fill(null);
  targets.forEach((t, i) => {
    if (t.kind === 'zone') zones[t.index] = assignment[i];
    else slots[t.index] = assignment[i];
  });
  return { zones, slots };
}
