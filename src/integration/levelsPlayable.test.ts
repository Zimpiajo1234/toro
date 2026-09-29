/**
 * Integration check (levels × logic): an autopilot plays every shipped level with the real GameState —
 * sliding collisions, carried-box collider (gameConfig carriedBoxRadius), pick cone and drop rules — at the
 * normal frame rate and at the worst dt Game allows (1/20). levels.test.ts proves solvability on a grid model;
 * this proves the real controls agree with it.
 *
 * Planner: greedy search over "move one box" steps (same conservative carrying model as levels.test.ts:
 * forward only, the box in the cell ahead, 90° turns need two cells of clearance; state = the stack of boxes
 * (color × symbol) on every cell, a move lifts a stack's top box and drops it on the floor or on a stack with room;
 * zones accept by their criteria, so an ambiguous box may go to any zone that accepts it, and a layout that leaves
 * the rest without a complete sorting ranks one step worse), replanned from the live state after every drop.
 * Driver: closed-loop steering toward cell centers with world-space input.
 */
import { describe, expect, it } from 'vitest';
import { angleDelta } from '../core/math';
import { assignBoxes, criteriaOf, meets, usesSymbols, type Sortable } from '../core/sorting';
import {
  COLOR_IDS,
  SYMBOL_IDS,
  cellToWorld,
  worldToCell,
  type GameEvent,
  type GameSnapshot,
  type LevelData,
  type Vec2,
  type ZoneCriteria,
} from '../core/types';
import { LEVELS } from '../data/levels';
import { GameState } from '../logic/GameState';

const DIR_X = [1, 0, -1, 0] as const;
const DIR_Z = [0, 1, 0, -1] as const;
const TURNS = [1, 3] as const;
const dirHeading = (d: number) => Math.atan2(DIR_X[d], DIR_Z[d]);

class Grid {
  readonly width: number;
  readonly depth: number;
  readonly cellCount: number;
  readonly solid: Uint8Array;
  /** Per zone cell: what each box of its stack must meet, bottom → top (its criteria, then its recipe's colors). */
  readonly steps: (ZoneCriteria[] | null)[];
  readonly stackLimit: number;
  /** The level sorts by symbol: plans also keep a complete sorting in reach (see misplacedCount). */
  readonly sorting: boolean;
  constructor(level: LevelData) {
    this.width = level.size.width;
    this.depth = level.size.depth;
    this.cellCount = this.width * this.depth;
    this.solid = new Uint8Array(this.cellCount);
    this.steps = new Array<ZoneCriteria[] | null>(this.cellCount).fill(null);
    this.stackLimit = level.stackLimit ?? 1;
    this.sorting = usesSymbols(level);
    for (const s of level.shelves)
      for (let x = s.x; x < s.x + s.w; x++) for (let z = s.z; z < s.z + s.d; z++) this.solid[this.index(x, z)] = 1;
    for (const p of level.decor.plants) this.solid[this.index(p.x, p.z)] = 1;
    for (const zone of level.zones)
      this.steps[this.index(zone.x, zone.z)] = [criteriaOf(zone), ...(zone.recipe ?? []).slice(1).map((color) => ({ color }))];
  }
  index(x: number, z: number) {
    return z * this.width + x;
  }
  step(cell: number, dir: number): number {
    const x = (cell % this.width) + DIR_X[dir];
    const z = Math.floor(cell / this.width) + DIR_Z[dir];
    return x >= 0 && z >= 0 && x < this.width && z < this.depth ? this.index(x, z) : -1;
  }
  center(cell: number, level: LevelData): Vec2 {
    return cellToWorld({ x: cell % this.width, z: Math.floor(cell / this.width) }, level.size);
  }
}

/** One character per kind of box (color × symbol): a stack is a string of these, bottom → top. */
function boxCode(box: Sortable): string {
  return String.fromCharCode(65 + COLOR_IDS.indexOf(box.color) * SYMBOL_IDS.length + SYMBOL_IDS.indexOf(box.symbol));
}
const KINDS: Sortable[] = COLOR_IDS.flatMap((color) => SYMBOL_IDS.map((symbol) => ({ color, symbol })));
const boxOfCode = (code: string): Sortable => KINDS[code.charCodeAt(0) - 65];

/** Per cell: the stack resting there as box codes bottom → top ('' = empty). */
type Stacks = string[];

/** Live stacks from the snapshot (resting boxes by cell, ordered by level). */
function liveStacks(grid: Grid, snap: GameSnapshot): Stacks {
  const stacks: Stacks = new Array<string>(grid.cellCount).fill('');
  const resting = snap.boxes.filter((b) => b.cell).sort((a, b) => a.level - b.level);
  for (const b of resting) stacks[grid.index(b.cell!.x, b.cell!.z)] += boxCode(b);
  return stacks;
}

function occupancyOf(grid: Grid, stacks: Stacks): Int16Array {
  const occ = new Int16Array(grid.cellCount).fill(-1);
  for (let c = 0; c < grid.cellCount; c++) if (stacks[c].length > 0) occ[c] = 0;
  return occ;
}
/** Boxes on a zone that fit it from the floor up (the bottom one accepted, the rest its recipe's colors). */
function correctPrefix(grid: Grid, stacks: Stacks, cell: number): number {
  const steps = grid.steps[cell];
  if (!steps) return 0;
  const stack = stacks[cell];
  let n = 0;
  while (n < stack.length && n < steps.length && meets(steps[n], boxOfCode(stack[n]))) n++;
  return n;
}
/** Sorting levels: the boxes not yet accepted can all still go to the zones not yet done (no accepted box moves). */
function sortable(grid: Grid, stacks: Stacks): boolean {
  const loose: Sortable[] = [];
  const open: ZoneCriteria[] = [];
  for (let c = 0; c < grid.cellCount; c++) {
    const steps = grid.steps[c];
    const placed = correctPrefix(grid, stacks, c);
    if (steps && placed < steps.length) open.push(steps[0]);
    for (let i = placed; i < stacks[c].length; i++) loose.push(boxOfCode(stacks[c][i]));
  }
  return assignBoxes(loose, open).every((z) => z >= 0);
}
const canStackOn = (grid: Grid, stacks: Stacks, cell: number) =>
  cell >= 0 && grid.solid[cell] === 0 && stacks[cell].length > 0 && stacks[cell].length < grid.stackLimit;
const isFree = (grid: Grid, occ: Int16Array, cell: number) => cell >= 0 && grid.solid[cell] === 0 && occ[cell] === -1;

function reachableFrom(grid: Grid, occ: Int16Array, start: number): Uint8Array {
  const region = new Uint8Array(grid.cellCount);
  const queue = [start];
  region[start] = 1;
  for (let q = 0; q < queue.length; q++)
    for (let dir = 0; dir < 4; dir++) {
      const next = grid.step(queue[q], dir);
      if (next >= 0 && region[next] === 0 && isFree(grid, occ, next)) {
        region[next] = 1;
        queue.push(next);
      }
    }
  return region;
}

/**
 * BFS over carry poses; returns pose chains (cell*4+dir) per drop cell. A drop on a stack ends with one extra
 * pose (a forward step or a turn) that brings the stack ahead; that pose is never expanded.
 */
function carrySearch(grid: Grid, occ: Int16Array, stacks: Stacks, starts: number[]): Map<number, number[]> {
  const parent = new Int32Array(grid.cellCount * 4).fill(-2);
  const queue: number[] = [];
  for (const s of starts) if (parent[s] === -2) (parent[s] = -1), queue.push(s);
  const best = new Map<number, number[]>();
  const chainTo = (end: number, extra: number | null) => {
    const chain: number[] = extra === null ? [] : [extra];
    for (let p = end; p !== -1; p = parent[p]) chain.push(p);
    return chain.reverse();
  };
  for (let q = 0; q < queue.length; q++) {
    const pose = queue[q];
    const cell = pose >> 2;
    const dir = pose & 3;
    const front = grid.step(cell, dir);
    if (!best.has(front)) best.set(front, chainTo(pose, null));
    const visit = (p: number) => {
      if (parent[p] === -2) {
        parent[p] = pose;
        queue.push(p);
      }
    };
    if (isFree(grid, occ, front)) {
      const ahead = grid.step(front, dir);
      if (isFree(grid, occ, ahead)) visit(front * 4 + dir);
      else if (canStackOn(grid, stacks, ahead) && !best.has(ahead)) best.set(ahead, chainTo(pose, front * 4 + dir));
    }
    for (const turn of TURNS) {
      const next = (dir + turn) % 4;
      if (!isFree(grid, occ, grid.step(front, next))) continue;
      const side = grid.step(cell, next);
      if (isFree(grid, occ, side)) visit(cell * 4 + next);
      else if (canStackOn(grid, stacks, side) && !best.has(side)) best.set(side, chainTo(pose, cell * 4 + next));
    }
  }
  return best;
}

function pickupStarts(grid: Grid, region: Uint8Array, from: number): number[] {
  const starts: number[] = [];
  for (let dir = 0; dir < 4; dir++) {
    const approach = grid.step(from, (dir + 2) % 4);
    if (approach >= 0 && region[approach] === 1) starts.push(approach * 4 + dir);
  }
  return starts;
}

interface Move {
  /** Cell whose top box is lifted. */
  from: number;
  drop: number;
}

/** Stacks after lifting the top of `from` (and the occupancy that goes with them). */
function lift(stacks: Stacks, from: number): Stacks {
  const out = stacks.slice();
  out[from] = out[from].slice(0, -1);
  return out;
}

/**
 * Boxes not yet part of a correct prefix on their zone: each must be moved at least once, so this is a lower bound
 * on the moves still needed (on single-box recipes: boxes not on a zone that accepts them; classic levels: not on a
 * zone of their own color). In a sorting level whose loose boxes cannot all be sorted into the zones left (a trap:
 * an ambiguous box took the only zone another box fits), some accepted box must move too: one more.
 */
function misplacedCount(grid: Grid, stacks: Stacks, total: number): number {
  let placed = 0;
  for (let c = 0; c < grid.cellCount; c++) if (grid.steps[c]) placed += correctPrefix(grid, stacks, c);
  return total - placed + (grid.sorting && placed < total && !sortable(grid, stacks) ? 1 : 0);
}

/** Full box-move sequence from the given layout (greedy best-first), or null. */
function planMoves(level: LevelData, grid: Grid, stacks0: Stacks, forklift: number): Move[] | null {
  const total = level.boxes.length;
  const misplaced = (stacks: Stacks) => misplacedCount(grid, stacks, total);
  const keyOf = (stacks: Stacks, region: Uint8Array) => `${stacks.join('/')}@${region.indexOf(1)}`;
  interface Node {
    stacks: Stacks;
    forklift: number;
    moves: Move[];
  }
  const buckets: Node[][] = Array.from({ length: total + 2 }, () => []);
  const seen = new Set<string>();
  const push = (stacks: Stacks, fl: number, moves: Move[], region: Uint8Array) => {
    const key = keyOf(stacks, region);
    if (seen.has(key)) return;
    seen.add(key);
    buckets[misplaced(stacks)].push({ stacks, forklift: fl, moves });
  };
  push(stacks0, forklift, [], reachableFrom(grid, occupancyOf(grid, stacks0), forklift));
  for (let expansions = 0; expansions < 6000; expansions++) {
    const bi = buckets.findIndex((b) => b.length > 0);
    if (bi < 0) return null;
    const node = buckets[bi].pop()!;
    if (bi === 0) return node.moves;
    const occ = occupancyOf(grid, node.stacks);
    const region = reachableFrom(grid, occ, node.forklift);
    for (let from = 0; from < grid.cellCount; from++) {
      const stack = node.stacks[from];
      if (stack.length === 0) continue;
      const box = stack[stack.length - 1];
      const lifted = lift(node.stacks, from);
      occ[from] = lifted[from].length > 0 ? 0 : -1;
      const chains = carrySearch(grid, occ, lifted, pickupStarts(grid, region, from));
      for (const [drop, chain] of chains) {
        if (drop === from || drop < 0 || grid.solid[drop] === 1 || lifted[drop].length >= grid.stackLimit) continue;
        const next = lifted.slice();
        next[drop] += box;
        const before = occ[drop];
        occ[drop] = 0;
        const cell = chain[chain.length - 1] >> 2;
        push(next, cell, [...node.moves, { from, drop }], reachableFrom(grid, occ, cell));
        occ[drop] = before;
      }
      occ[from] = 0;
    }
  }
  return null;
}

function emptyPath(grid: Grid, occ: Int16Array, from: number, to: number): number[] | null {
  const parent = new Int32Array(grid.cellCount).fill(-2);
  parent[from] = -1;
  const queue = [from];
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    if (c === to) break;
    for (let d = 0; d < 4; d++) {
      const n = grid.step(c, d);
      if (n >= 0 && parent[n] === -2 && isFree(grid, occ, n)) {
        parent[n] = c;
        queue.push(n);
      }
    }
  }
  if (parent[to] === -2) return null;
  const path: number[] = [];
  for (let c = to; c !== -1; c = parent[c]) path.push(c);
  return path.reverse();
}

class Pilot {
  readonly state: GameState;
  readonly events: GameEvent[] = [];
  frames = 0;
  constructor(
    readonly level: LevelData,
    readonly dt: number,
  ) {
    this.state = new GameState(level);
  }
  get seconds(): number {
    return this.frames * this.dt;
  }
  get snap(): GameSnapshot {
    return this.state.getSnapshot();
  }
  tick(mx: number, mz: number, action = false) {
    const len = Math.hypot(mx, mz);
    if (len > 1) (mx /= len), (mz /= len);
    const ev = this.state.update(this.dt, { move: { x: mx, z: mz }, actionPressed: action });
    for (const e of ev) this.events.push(e);
    this.frames++;
    return ev;
  }
  /** Drive through world waypoints; the last one is approached slowly. */
  follow(points: Vec2[], budgetSec = 30): boolean {
    for (let i = 0; i < points.length; i++) {
      const last = i === points.length - 1;
      const p = points[i];
      let t = 0;
      for (;;) {
        const f = this.snap.forklift;
        const dx = p.x - f.pos.x;
        const dz = p.z - f.pos.z;
        const dist = Math.hypot(dx, dz);
        const reach = last ? 0.05 : 0.22;
        if (dist < reach) break;
        const mag = Math.max(last ? 0.12 : 0.3, Math.min(1, dist / 0.9));
        // Final approach: roll straight along the heading like a player would, instead of chasing a few cm of
        // lateral error with a big turn (which swings the load into nearby shelves).
        const fx = Math.sin(f.heading);
        const fz = Math.cos(f.heading);
        const ahead = fx * dx + fz * dz;
        if (last && dist < 0.4) {
          if (ahead < 0.06) break;
          this.tick(fx * mag, fz * mag);
        } else {
          this.tick((dx / dist) * mag, (dz / dist) * mag);
        }
        t += this.dt;
        if (t > budgetSec) return false;
      }
    }
    // Settle
    for (let k = 0; k < 40 && Math.abs(this.snap.forklift.speed) > 0.02; k++) this.tick(0, 0);
    return true;
  }
  face(dir: number, budgetSec = 5): boolean {
    const h = dirHeading(dir);
    let t = 0;
    while (Math.abs(angleDelta(this.snap.forklift.heading, h)) > 0.03) {
      this.tick(DIR_X[dir] * 0.08, DIR_Z[dir] * 0.08);
      t += this.dt;
      if (t > budgetSec) return false;
    }
    for (let k = 0; k < 40 && Math.abs(this.snap.forklift.speed) > 0.02; k++) this.tick(0, 0);
    return true;
  }
}

/** Collapse collinear cell runs into corner waypoints. */
function corners(grid: Grid, level: LevelData, cells: number[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (i > 0 && i < cells.length - 1) {
      const a = cells[i - 1], b = cells[i], c = cells[i + 1];
      if (b - a === c - b) continue;
    }
    out.push(grid.center(cells[i], level));
  }
  return out;
}

interface Outcome {
  solved: boolean;
  seconds: number;
  moves: number;
  note: string;
  events: GameEvent[];
}

/** Plays `level` to the end; `opening` = moves to make first as they are (e.g. into a trap), then it plans. */
function autopilot(level: LevelData, dt: number, opening: readonly Move[] = []): Outcome {
  const pilot = new Pilot(level, dt);
  const grid = new Grid(level);
  let moves = 0;
  let queue: Move[] = opening.slice();
  /** Stacks the remaining plan expects; any mismatch with the live state triggers a replan. */
  let expected: Stacks | null = queue.length > 0 ? liveStacks(grid, pilot.snap) : null;
  const fail = (note: string): Outcome => ({ solved: false, seconds: pilot.seconds, moves, note, events: pilot.events });
  for (let iter = 0; iter < 60; iter++) {
    const snap = pilot.snap;
    if (snap.completed) return { solved: true, seconds: pilot.seconds, moves, note: '', events: pilot.events };
    const stacks = liveStacks(grid, snap);
    const occ = occupancyOf(grid, stacks);
    const fc = worldToCell(snap.forklift.pos, level.size);
    const fcell = grid.index(fc.x, fc.z);
    if (!expected || queue.length === 0 || stacks.some((c, i) => c !== expected![i])) {
      const planned = planMoves(level, grid, stacks, fcell);
      if (!planned || planned.length === 0) return fail(`no plan at iter ${iter} from cell ${fc.x},${fc.z}`);
      queue = planned;
    }
    const plan = queue.shift()!;
    const from = plan.from;
    const lifted = lift(stacks, from);
    expected = lifted.slice();
    expected[plan.drop] += stacks[from][stacks[from].length - 1];
    const fromCell = { x: from % grid.width, z: Math.floor(from / grid.width) };
    const box = snap.boxes
      .filter((b) => b.cell && b.cell.x === fromCell.x && b.cell.z === fromCell.z)
      .sort((a, b) => b.level - a.level)[0];
    const region = reachableFrom(grid, occ, fcell);
    const starts = pickupStarts(grid, region, from);
    occ[from] = lifted[from].length > 0 ? 0 : -1;
    // Choose the approach whose carry chain reaches the drop.
    let bestChain: number[] | null = null;
    let bestEmpty: number[] | null = null;
    for (const s of starts) {
      const chain = carrySearch(grid, occ, lifted, [s]).get(plan.drop);
      if (!chain) continue;
      const liftedOcc = occ[from];
      occ[from] = 0;
      const path = emptyPath(grid, occ, fcell, s >> 2);
      occ[from] = liftedOcc;
      if (!path) continue;
      if (!bestChain || path.length + chain.length < bestEmpty!.length + bestChain.length) {
        bestChain = chain;
        bestEmpty = path;
      }
    }
    if (!bestChain || !bestEmpty) return fail(`no executable route for ${box.id}`);
    // 1) drive empty to the approach cell
    const pts = corners(grid, level, bestEmpty);
    const here = snap.forklift.pos;
    if (pts.length > 1 && Math.hypot(pts[0].x - here.x, pts[0].z - here.z) < 0.6) pts.shift();
    if (!pilot.follow(pts)) return fail(`stuck driving to ${box.id}`);
    const dir = bestChain[0] & 3;
    if (!pilot.face(dir)) return fail(`cannot face ${box.id}`);
    // 2) nudge forward until the box is targeted, then pick
    let t = 0;
    while (pilot.snap.hint.targetBoxId !== box.id) {
      pilot.tick(DIR_X[dir] * 0.25, DIR_Z[dir] * 0.25);
      if ((t += pilot.dt) > 3) return fail(`${box.id} never targeted (target=${pilot.snap.hint.targetBoxId})`);
    }
    pilot.tick(0, 0, true);
    if (pilot.snap.forklift.carrying !== box.id) return fail(`pick of ${box.id} failed`);
    for (let k = 0; k < 20; k++) pilot.tick(0, 0);
    // 3) carry along the pose chain
    for (let i = 1; i < bestChain.length; i++) {
      const prev = bestChain[i - 1];
      const pose = bestChain[i];
      if (pose >> 2 === prev >> 2) {
        if (!pilot.face(pose & 3)) return fail(`carry turn failed with ${box.id}`);
      } else {
        // Merge straight runs.
        let j = i;
        while (j + 1 < bestChain.length && (bestChain[j + 1] & 3) === (pose & 3) && bestChain[j + 1] >> 2 !== bestChain[j] >> 2) j++;
        if (!pilot.follow([grid.center(bestChain[j] >> 2, level)])) return fail(`stuck carrying ${box.id}`);
        i = j;
      }
    }
    const endDir = bestChain[bestChain.length - 1] & 3;
    if (!pilot.face(endDir)) return fail(`final face failed ${box.id}`);
    const hint = pilot.snap.hint.dropCell;
    const before = pilot.events.length;
    pilot.tick(0, 0, true);
    // The live drop rules (zone magnet, body overlap) may pick a neighbour of the planned cell: fine, we replan.
    if (!pilot.events.slice(before).some((e) => e.type === 'boxDropped'))
      return fail(`drop of ${box.id} refused (hint ${hint ? `${hint.x},${hint.z}` : 'none'})`);
    moves++;
    for (let k = 0; k < 20; k++) pilot.tick(0, 0);
  }
  return fail('too many moves');
}

const CASES = LEVELS.map((level, i) => [i + 1, level.id, level] as const);

describe('every shipped level is playable with the real controls', () => {
  for (const [label, dt] of [
    ['60 fps', 1 / 60],
    ['20 fps (Game dt clamp)', 1 / 20],
  ] as const) {
    it.each(CASES)(`${label}: level %i (%s)`, (_, __, level) => {
      const out = autopilot(level, dt);
      expect(out.note).toBe('');
      expect(out.solved).toBe(true);
      const grid = new Grid(level);
      const start = liveStacks(grid, new GameState(level).getSnapshot());
      expect(out.moves).toBeGreaterThanOrEqual(misplacedCount(grid, start, level.boxes.length));
    });
  }

  it('the move bound still counts boxes starting on a zone of another color (classic levels)', () => {
    const classic = LEVELS.filter((level) => level.stackLimit === 1 && !usesSymbols(level));
    expect(classic.length).toBeGreaterThanOrEqual(12);
    for (const level of classic) {
      const grid = new Grid(level);
      const start = liveStacks(grid, new GameState(level).getSnapshot());
      const offZone = level.boxes.filter((b) => !level.zones.some((z) => z.x === b.x && z.z === b.z && z.color === b.color));
      expect(misplacedCount(grid, start, level.boxes.length), level.id).toBe(offZone.length);
    }
  });
});

describe('sorting levels with the real controls (docs/SORTING.md)', () => {
  const sample = LEVELS.find((l) => l.id === 'la-muestra')!;
  const grid = new Grid(sample);
  const cellOf = (p: { x: number; z: number }) => grid.index(p.x, p.z);
  const blueTriangle = sample.boxes.find((b) => b.color === 'blue' && b.symbol === 'triangle')!;
  const blueCircle = sample.boxes.find((b) => b.color === 'blue' && b.symbol === 'circle')!;
  const anyBlue = sample.zones.find((z) => z.color === 'blue' && z.symbol === undefined)!;

  it('level 23 is the sample level, with its trap in reach', () => {
    expect(LEVELS.indexOf(sample)).toBe(22);
    expect(usesSymbols(sample)).toBe(true);
  });

  it.each([
    ['60 fps', 1 / 60],
    ['20 fps', 1 / 20],
  ] as const)('%s: level 23 recovers from its trap: blue ▲ into "any blue" first, moved on once blue ● needs it', (_, dt) => {
    const out = autopilot(sample, dt, [{ from: cellOf(blueTriangle), drop: cellOf(anyBlue) }]);
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    const drops = out.events.filter((e): e is Extract<GameEvent, { type: 'boxDropped' }> => e.type === 'boxDropped');
    // The trap drop is accepted (a correct, chiming drop), then undone without anything negative...
    expect(drops[0]).toMatchObject({ boxId: blueTriangle.id, zoneId: anyBlue.id, correct: true });
    expect(out.events).toContainEqual({ type: 'zoneReleased', zoneId: anyBlue.id, boxId: blueTriangle.id });
    // ...and blue ● ends up in "any blue", blue ▲ on a ▲ zone: one move more than a plan free of the trap needs.
    const last = (id: string) => drops.filter((d) => d.boxId === id).at(-1)!;
    expect(last(blueCircle.id)).toMatchObject({ zoneId: anyBlue.id, correct: true });
    expect(sample.zones.find((z) => z.id === last(blueTriangle.id).zoneId)?.symbol).toBe('triangle');
    expect(out.moves).toBeGreaterThanOrEqual(sample.boxes.length + 1);
  });

  it('the move bound counts a trap as one more move', () => {
    const stacks = new Array<string>(grid.cellCount).fill('');
    for (const b of sample.boxes) stacks[cellOf(b)] = boxCode({ color: b.color, symbol: b.symbol! });
    expect(misplacedCount(grid, stacks, 4)).toBe(4);
    // Blue ▲ in "any blue", blue ■ and mint ▲ in their zones: blue ● is left without one.
    const exact = sample.zones.find((z) => z.symbol === 'square')!;
    const triangle = sample.zones.find((z) => z.symbol === 'triangle')!;
    const blueSquare = sample.boxes.find((b) => b.symbol === 'square')!;
    const mintTriangle = sample.boxes.find((b) => b.color === 'mint')!;
    for (const b of [blueTriangle, blueSquare, mintTriangle]) stacks[cellOf(b)] = '';
    stacks[cellOf(anyBlue)] = boxCode({ color: 'blue', symbol: 'triangle' });
    stacks[cellOf(exact)] = boxCode({ color: 'blue', symbol: 'square' });
    stacks[cellOf(triangle)] = boxCode({ color: 'mint', symbol: 'triangle' });
    expect(misplacedCount(grid, stacks, 4)).toBe(2);
  });
});
