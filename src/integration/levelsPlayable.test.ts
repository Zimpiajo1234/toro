/**
 * Integration check (levels × logic): an autopilot plays every shipped level with the real GameState —
 * sliding collisions, carried-box collider (gameConfig carriedBoxRadius), pick cone and drop rules — at the
 * normal frame rate and at the worst dt Game allows (1/20). levels.test.ts proves solvability on a grid model;
 * this proves the real controls agree with it.
 *
 * Planner: greedy search over "move one box" steps (src/data/levels/solver.ts, the same conservative carrying model
 * as levels.test.ts: forward only, the box in the cell ahead, 90° turns need two cells of clearance; state = the stack
 * of boxes (color × symbol) on every cell, a move lifts a stack's top box and drops it on the floor or on a stack with
 * room; zones accept by their criteria, so an ambiguous box may go to any zone that accepts it, and a layout that
 * leaves the rest without a complete sorting ranks one step worse), replanned from the live state after every drop.
 * Driver: closed-loop steering toward cell centers with world-space input.
 */
import { describe, expect, it } from 'vitest';
import { angleDelta } from '../core/math';
import { usesSymbols } from '../core/sorting';
import { worldToCell, type GameEvent, type GameSnapshot, type LevelData, type Vec2 } from '../core/types';
import { LEVELS } from '../data/levels';
import {
  DIR_X,
  DIR_Z,
  LevelGrid,
  boxCode,
  carrySearch,
  greedySearch,
  isFree,
  lift,
  misplacedCount,
  occupancyOf,
  pickupStarts,
  reachableFrom,
  type Move,
  type Stacks,
} from '../data/levels/solver';
import { GameState } from '../logic/GameState';

const dirHeading = (d: number) => Math.atan2(DIR_X[d], DIR_Z[d]);

/** Live stacks from the snapshot (resting boxes by cell, ordered by level). */
function liveStacks(grid: LevelGrid, snap: GameSnapshot): Stacks {
  const stacks: Stacks = new Array<string>(grid.cellCount).fill('');
  const resting = snap.boxes.filter((b) => b.cell).sort((a, b) => a.level - b.level);
  for (const b of resting) stacks[grid.index(b.cell!.x, b.cell!.z)] += boxCode(b);
  return stacks;
}

/** Full box-move sequence from the given layout (greedy best-first, one successor per drop: the chain the driver follows), or null. */
function planMoves(level: LevelData, grid: LevelGrid, stacks0: Stacks, forklift: number): Move[] | null {
  return greedySearch(grid, stacks0, forklift, level.boxes.length, { allowParking: true, maxExpansions: 6000, regions: 'first' }).moves;
}

function emptyPath(grid: LevelGrid, occ: Int16Array, from: number, to: number): number[] | null {
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
function corners(grid: LevelGrid, cells: number[]): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (i > 0 && i < cells.length - 1) {
      const a = cells[i - 1], b = cells[i], c = cells[i + 1];
      if (b - a === c - b) continue;
    }
    out.push(grid.center(cells[i]));
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
  const grid = new LevelGrid(level);
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
      const chain = carrySearch(grid, occ, lifted, [s]).chain(plan.drop);
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
    const pts = corners(grid, bestEmpty);
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
        if (!pilot.follow([grid.center(bestChain[j] >> 2)])) return fail(`stuck carrying ${box.id}`);
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
      const grid = new LevelGrid(level);
      const start = liveStacks(grid, new GameState(level).getSnapshot());
      expect(out.moves).toBeGreaterThanOrEqual(misplacedCount(grid, start, level.boxes.length));
    });
  }

  it('the move bound still counts boxes starting on a zone of another color (classic levels)', () => {
    const classic = LEVELS.filter((level) => level.stackLimit === 1 && !usesSymbols(level));
    expect(classic.length).toBeGreaterThanOrEqual(12);
    for (const level of classic) {
      const grid = new LevelGrid(level);
      const start = liveStacks(grid, new GameState(level).getSnapshot());
      const offZone = level.boxes.filter((b) => !level.zones.some((z) => z.x === b.x && z.z === b.z && z.color === b.color));
      expect(misplacedCount(grid, start, level.boxes.length), level.id).toBe(offZone.length);
    }
  });
});

describe('sorting levels with the real controls (docs/SORTING.md)', () => {
  const sample = LEVELS.find((l) => l.id === 'la-muestra')!;
  const grid = new LevelGrid(sample);
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
