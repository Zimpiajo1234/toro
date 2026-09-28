/**
 * Integration check (levels × logic): an autopilot plays every shipped level with the real GameState —
 * sliding collisions, carried-box collider (gameConfig carriedBoxRadius), pick cone and drop rules — at the
 * normal frame rate and at the worst dt Game allows (1/20). levels.test.ts proves solvability on a grid model;
 * this proves the real controls agree with it.
 *
 * Planner: greedy search over "move one box" steps (same conservative carrying model as levels.test.ts:
 * forward only, the box in the cell ahead, 90° turns need two cells of clearance), replanned from the live
 * state after every drop. Driver: closed-loop steering toward cell centers with world-space input.
 */
import { describe, expect, it } from 'vitest';
import { angleDelta } from '../core/math';
import { cellToWorld, worldToCell, type ColorId, type GameEvent, type GameSnapshot, type LevelData, type Vec2 } from '../core/types';
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
  readonly zoneColor: (ColorId | null)[];
  constructor(level: LevelData) {
    this.width = level.size.width;
    this.depth = level.size.depth;
    this.cellCount = this.width * this.depth;
    this.solid = new Uint8Array(this.cellCount);
    this.zoneColor = new Array<ColorId | null>(this.cellCount).fill(null);
    for (const s of level.shelves)
      for (let x = s.x; x < s.x + s.w; x++) for (let z = s.z; z < s.z + s.d; z++) this.solid[this.index(x, z)] = 1;
    for (const p of level.decor.plants) this.solid[this.index(p.x, p.z)] = 1;
    for (const zone of level.zones) this.zoneColor[this.index(zone.x, zone.z)] = zone.color;
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

function occupancyOf(grid: Grid, boxCells: ArrayLike<number>): Int16Array {
  const occ = new Int16Array(grid.cellCount).fill(-1);
  for (let i = 0; i < boxCells.length; i++) if (boxCells[i] >= 0) occ[boxCells[i]] = i;
  return occ;
}
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

/** BFS over carry poses; returns pose chains (cell*4+dir) per drop cell. */
function carrySearch(grid: Grid, occ: Int16Array, starts: number[]): Map<number, number[]> {
  const parent = new Int32Array(grid.cellCount * 4).fill(-2);
  const queue: number[] = [];
  for (const s of starts) if (parent[s] === -2) (parent[s] = -1), queue.push(s);
  const best = new Map<number, number>();
  for (let q = 0; q < queue.length; q++) {
    const pose = queue[q];
    const cell = pose >> 2;
    const dir = pose & 3;
    const front = grid.step(cell, dir);
    if (!best.has(front)) best.set(front, pose);
    const visit = (p: number) => {
      if (parent[p] === -2) {
        parent[p] = pose;
        queue.push(p);
      }
    };
    if (isFree(grid, occ, grid.step(front, dir))) visit(front * 4 + dir);
    for (const turn of TURNS) {
      const next = (dir + turn) % 4;
      if (isFree(grid, occ, grid.step(cell, next)) && isFree(grid, occ, grid.step(front, next))) visit(cell * 4 + next);
    }
  }
  const chains = new Map<number, number[]>();
  for (const [front, end] of best) {
    const chain: number[] = [];
    for (let p = end; p !== -1; p = parent[p]) chain.push(p);
    chains.set(front, chain.reverse());
  }
  return chains;
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
  box: number;
  drop: number;
}

/** Full box-move sequence from the given layout (greedy best-first), or null. */
function planMoves(level: LevelData, grid: Grid, boxCells: Int32Array, forklift: number): Move[] | null {
  const colors = level.boxes.map((b) => b.color);
  const misplaced = (cells: Int32Array) => colors.reduce((n, c, i) => (grid.zoneColor[cells[i]] === c ? n : n + 1), 0);
  const keyOf = (cells: Int32Array, region: Uint8Array) =>
    [...new Set(colors)].map((color) => colors.flatMap((c, i) => (c === color ? [cells[i]] : [])).sort((a, b) => a - b).join(',')).join('|') +
    `@${region.indexOf(1)}`;
  interface Node {
    cells: Int32Array;
    forklift: number;
    moves: Move[];
  }
  const buckets: Node[][] = Array.from({ length: colors.length + 1 }, () => []);
  const seen = new Set<string>();
  const push = (cells: Int32Array, fl: number, moves: Move[], region: Uint8Array) => {
    const key = keyOf(cells, region);
    if (seen.has(key)) return;
    seen.add(key);
    buckets[misplaced(cells)].push({ cells, forklift: fl, moves });
  };
  const occ0 = occupancyOf(grid, boxCells);
  push(boxCells, forklift, [], reachableFrom(grid, occ0, forklift));
  for (let expansions = 0; expansions < 6000; expansions++) {
    const bi = buckets.findIndex((b) => b.length > 0);
    if (bi < 0) return null;
    const node = buckets[bi].pop()!;
    if (bi === 0) return node.moves;
    const occ = occupancyOf(grid, node.cells);
    const region = reachableFrom(grid, occ, node.forklift);
    for (let i = 0; i < colors.length; i++) {
      const from = node.cells[i];
      occ[from] = -1;
      const chains = carrySearch(grid, occ, pickupStarts(grid, region, from));
      for (const [drop, chain] of chains) {
        if (drop === from || !isFree(grid, occ, drop)) continue;
        const next = node.cells.slice();
        next[i] = drop;
        occ[drop] = i;
        const cell = chain[chain.length - 1] >> 2;
        push(next, cell, [...node.moves, { box: i, drop }], reachableFrom(grid, occ, cell));
        occ[drop] = -1;
      }
      occ[from] = i;
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
}

function autopilot(level: LevelData, dt: number): Outcome {
  const pilot = new Pilot(level, dt);
  const grid = new Grid(level);
  let moves = 0;
  let queue: Move[] = [];
  /** Box cells the remaining plan expects; any mismatch with the live state triggers a replan. */
  let expected: Int32Array | null = null;
  const fail = (note: string): Outcome => ({ solved: false, seconds: pilot.seconds, moves, note });
  for (let iter = 0; iter < 60; iter++) {
    const snap = pilot.snap;
    if (snap.completed) return { solved: true, seconds: pilot.seconds, moves, note: '' };
    const cells = Int32Array.from(snap.boxes, (b) => (b.cell ? grid.index(b.cell.x, b.cell.z) : -1));
    const occ = occupancyOf(grid, cells);
    const fc = worldToCell(snap.forklift.pos, level.size);
    const fcell = grid.index(fc.x, fc.z);
    if (!expected || queue.length === 0 || cells.some((c, i) => c !== expected![i])) {
      const planned = planMoves(level, grid, cells, fcell);
      if (!planned || planned.length === 0) return fail(`no plan at iter ${iter} from cell ${fc.x},${fc.z}`);
      queue = planned;
    }
    const plan = queue.shift()!;
    expected = cells.slice();
    expected[plan.box] = plan.drop;
    const box = snap.boxes[plan.box];
    const from = cells[plan.box];
    const region = reachableFrom(grid, occ, fcell);
    occ[from] = -1;
    const starts = pickupStarts(grid, region, from);
    // Choose the approach whose carry chain reaches the drop.
    let bestChain: number[] | null = null;
    let bestEmpty: number[] | null = null;
    for (const s of starts) {
      const chain = carrySearch(grid, occ, [s]).get(plan.drop);
      if (!chain) continue;
      occ[from] = plan.box;
      const path = emptyPath(grid, occ, fcell, s >> 2);
      occ[from] = -1;
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
      expect(out.moves).toBeGreaterThanOrEqual(level.boxes.filter((b) => !level.zones.some((z) => z.x === b.x && z.z === b.z && z.color === b.color)).length);
    });
  }
});
