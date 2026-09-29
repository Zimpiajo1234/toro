/**
 * Sorting rules shared by every module (logic, render, audio wiring, level validation, tests): which zone accepts
 * which box. A zone asks for a colour, a symbol, or both (docs/SORTING.md); `accepts` is the single source of truth.
 * Pure functions, no allocation in the per-frame ones (accepts, takesNext, specificity).
 */
import {
  DEFAULT_SYMBOL,
  type ColorId,
  type LevelBox,
  type LevelData,
  type LevelZone,
  type SymbolId,
  type ZoneCriteria,
  type ZoneState,
} from './types';

/** What sorting looks at on a box. */
export interface Sortable {
  color: ColorId;
  symbol: SymbolId;
}

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

/** Match kind of every zone of a level, by zone id. */
export function zoneMatchKinds(level: Pick<LevelData, 'zones'>): Map<string, MatchKind> {
  return new Map(level.zones.map((zone) => [zone.id, matchKind(criteriaOf(zone))]));
}

/** A level sorts by symbol when any of its boxes or zones names a symbol (levels 1–18 never do). */
export function usesSymbols(level: Pick<LevelData, 'boxes' | 'zones'>): boolean {
  return level.boxes.some((b) => b.symbol !== undefined) || level.zones.some((z) => z.symbol !== undefined);
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
