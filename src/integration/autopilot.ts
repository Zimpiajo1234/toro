/**
 * The autopilot of src/integration/levelsPlayable.test.ts, as a module so level tooling and probes can run it too: it
 * plays a level with the real GameState — sliding collisions, carried-box collider (gameConfig carriedBoxRadius), pick
 * cone and drop rules — at a given frame time.
 *
 * Planner: searches over "move one box" steps (src/data/levels/solver.ts, the same conservative carrying model
 * as levels.test.ts: the box in the cell ahead, forward or straight back in reverse, 90° turns need two cells of
 * clearance; state = the stack of boxes (color × symbol) on every cell, a move lifts a stack's top box and drops it on
 * the floor or on a stack with room; zones accept by their criteria, so an ambiguous box may go to any zone that
 * accepts it, and a layout that leaves the rest without a complete sorting ranks one step worse), replanned from the
 * live state after every drop: the exact search's plan (minMovesFrom) from the live state, or the greedy search's when
 * that finds none within its budget. Each move is driven along the carry chain that leaves the forklift where the
 * plan expects it (`Move.after`).
 * Driver: closed-loop steering toward cell centers with world-space input; steps back in reverse with the vehicle
 * controls (S = drive throttle < 0), as a player would. Storage (docs/STORAGE.md): a storage position of the same model
 * (a shelf, a stack column; its cell inside the map or beyond a wall) is worked from its column's front cell, so the
 * plan drives straight up to it, the load going in (through the door of a truck), and a box lifted out of it backs
 * straight out. The forks go by the keys at every unit (rule 9): it first picks the level with the fork keys
 * (InputFrame.forkStep, one press per level, like F / V: hint.storage) and waits for the forks there (a rack's shelf
 * or a stack's level: logic counts both in levels), then drives in and drops, or lifts the box there.
 * Conveyor belts (docs/CONVEYOR.md): a box the plan sends to a belt's end exit is set down on the belt's input (on its
 * table: its slot's level is the belt's height, so F raises the forks to it, as at a rack's level-1 slot), and the belt
 * brings it there; while it is on its way the planner already sees it in the end exit (liveStacks), and the next move
 * at that belt (or the end of the level) waits for the belt to deliver it, as a player would.
 */
import { angleDelta } from '../core/math';
import { storageSlotsOf, type StorageSlotRef } from '../core/storage';
import { worldToCell, type GameEvent, type GameSnapshot, type LevelData, type StorageSkin, type Vec2 } from '../core/types';
import {
  DIR_X,
  DIR_Z,
  LevelGrid,
  boxCode,
  carrySearch,
  greedySearch,
  isFree,
  lift,
  minMovesFrom,
  occupancyOf,
  pickupStarts,
  reachableFrom,
  type Move,
  type Stacks,
} from '../data/levels/solver';
import { GameState } from '../logic/GameState';

const dirHeading = (d: number) => Math.atan2(DIR_X[d], DIR_Z[d]);

/**
 * Live stacks from the snapshot (resting boxes by position — floor cell or storage position — ordered by level). A
 * stored box names its storage level (`slotId`, any skin): the position it rests on (a shelf; a stack column, whatever
 * the level). A box on its way down a conveyor belt (settling on its input, riding it: still in the input's slot) is
 * where the model puts it: in its belt's end exit (`feeds`).
 */
export function liveStacks(grid: LevelGrid, snap: GameSnapshot): Stacks {
  const stacks: Stacks = new Array<string>(grid.posCount).fill('');
  const onItsWay = new Set<string>();
  for (const belt of snap.conveyors) if (belt.boxId !== null) onItsWay.add(belt.boxId);
  const resting = snap.boxes.filter((b) => b.cell).sort((a, b) => a.level - b.level);
  for (const b of resting) {
    const pos = b.slotId !== null ? grid.positionOfSlot(b.slotId) : grid.index(b.cell!.x, b.cell!.z);
    stacks[onItsWay.has(b.id) && grid.feeds[pos] >= 0 ? grid.feeds[pos] : pos] += boxCode(b);
  }
  return stacks;
}

/**
 * Full box-move sequence from the given layout: the exact search's plan (shortest, or the best one within its budget:
 * fewer moves to drive on the harder levels), else greedy best-first (one successor per drop), or null.
 */
function planMoves(level: LevelData, grid: LevelGrid, stacks0: Stacks, forklift: number): Move[] | null {
  const total = level.boxes.length;
  return (
    minMovesFrom(grid, stacks0, forklift, total, { maxWork: 100_000 }).plan ??
    greedySearch(grid, stacks0, forklift, total, { allowParking: true, maxExpansions: 6000, regions: 'first' }).moves
  );
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
  /**
   * Fork level presses (F / V), also by the skin of the unit they were pressed at, and frames driven in reverse (S):
   * what the controls did, for the tests.
   */
  readonly controls = { forkSteps: 0, forkStepsAt: { rack: 0, truck: 0, beltIn: 0, beltOut: 0 } as Record<StorageSkin, number>, reverseFrames: 0 };
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
  /** One frame with a fork level press (F = +1 / V = −1), then one frame released. */
  fork(step: -1 | 1) {
    this.controls.forkSteps++;
    const at = this.snap.hint.storage;
    if (at) this.controls.forkStepsAt[at.skin]++;
    for (const e of this.state.update(this.dt, { move: { x: 0, z: 0 }, actionPressed: false, forkStep: step })) this.events.push(e);
    this.frames++;
    this.tick(0, 0);
  }
  /**
   * At a storage column (any unit): press F / V until level `level` is selected (hint.storage), then wait for the forks
   * to stand at it (ForkliftState.forkHeight counts levels in every support: a rack's shelf n and a stack's level n are
   * both at height n; only the drawing turns them into metres). False when the rig is not at a column or it takes too
   * long.
   */
  selectLevel(level: number, budgetSec = 6): boolean {
    let t = 0;
    for (;;) {
      const at = this.snap.hint.storage;
      if (!at) return false;
      if (at.level === level) break;
      this.fork(at.level < level ? 1 : -1);
      if ((t += 2 * this.dt) > budgetSec) return false;
    }
    while (Math.abs(this.snap.forklift.forkHeight - level) > 0.02) {
      this.tick(0, 0);
      if ((t += this.dt) > budgetSec) return false;
    }
    return true;
  }
  /** One frame of vehicle controls (the keyboard's W / S / A / D): throttle < 0 backs up. */
  drive(throttle: number, steer: number) {
    if (throttle < 0) this.controls.reverseFrames++;
    const ev = this.state.update(this.dt, { move: { x: 0, z: 0 }, drive: { throttle, steer }, actionPressed: false });
    for (const e of ev) this.events.push(e);
    this.frames++;
  }
  /** Back up in a straight line (S) until the forklift centre reaches `p`, easing off near it like a player. */
  back(p: Vec2, budgetSec = 20): boolean {
    let t = 0;
    for (;;) {
      const f = this.snap.forklift;
      const behind = -(Math.sin(f.heading) * (p.x - f.pos.x) + Math.cos(f.heading) * (p.z - f.pos.z));
      if (behind < 0.05) break;
      this.drive(-Math.max(0.12, Math.min(1, behind / 0.6)), 0);
      if ((t += this.dt) > budgetSec) return false;
    }
    for (let k = 0; k < 40 && Math.abs(this.snap.forklift.speed) > 0.02; k++) this.tick(0, 0);
    return true;
  }
  /**
   * Carry straight ahead along grid direction `dir` (holding W, as a player would on a straight run) until the forklift
   * centre reaches `p`, easing off near it. No steering toward the point: with a load next to a wall, a small
   * correction could make the game refuse the turn and swing the load the long way round.
   */
  ahead(p: Vec2, dir: number, budgetSec = 20): boolean {
    let t = 0;
    for (;;) {
      const f = this.snap.forklift;
      const left = DIR_X[dir] * (p.x - f.pos.x) + DIR_Z[dir] * (p.z - f.pos.z);
      if (left < 0.05) break;
      const mag = Math.max(0.12, Math.min(1, left / 0.9));
      this.tick(DIR_X[dir] * mag, DIR_Z[dir] * mag);
      if ((t += this.dt) > budgetSec) return false;
    }
    for (let k = 0; k < 40 && Math.abs(this.snap.forklift.speed) > 0.02; k++) this.tick(0, 0);
    return true;
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
  /** A conveyor belt is still carrying a box (settling on its input, or riding it). */
  get beltBusy(): boolean {
    return this.snap.conveyors.some((belt) => belt.phase !== 'idle');
  }
  /** Stand still until every conveyor belt has delivered its box (false when it takes too long). */
  waitForBelts(budgetSec = 20): boolean {
    for (let t = 0; this.beltBusy; t += this.dt) {
      if (t > budgetSec) return false;
      this.tick(0, 0);
    }
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

/** Driving effort of a carry chain, as carrySearch weighs it: a step ahead or a turn 1, a step back 2. */
function chainCost(grid: LevelGrid, chain: readonly number[]): number {
  let cost = 0;
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1];
    const b = chain[i];
    cost += b >> 2 === grid.step(a >> 2, ((a & 3) + 2) % 4) ? 2 : 1;
  }
  return cost;
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

export interface Outcome {
  solved: boolean;
  seconds: number;
  moves: number;
  note: string;
  events: GameEvent[];
  /**
   * Fork level presses (InputFrame.forkStep, F / V), also by the skin of the unit they were pressed at (hint.storage),
   * and frames driven in reverse (S, drive throttle < 0).
   */
  controls: { forkSteps: number; forkStepsAt: Record<StorageSkin, number>; reverseFrames: number };
  /** The game state where it stopped (e.g. `snapshot.moves`, the move counter the HUD shows). */
  snapshot: GameSnapshot;
}

/**
 * Plays `level` to the end; `opening` = moves to make first as they are (e.g. into a trap), then it plans. `log`
 * receives one line per move (debugging and probes).
 */
export function autopilot(level: LevelData, dt: number, opening: readonly Move[] = [], log?: (line: string) => void): Outcome {
  const pilot = new Pilot(level, dt);
  const grid = new LevelGrid(level);
  const slots = storageSlotsOf(level);
  /**
   * The storage level a move works at on position `pos` with the box `height` boxes up (a shelf's own; on a stack
   * column, the top box's or the one the box lands at), or null off storage.
   */
  const slotAt = (pos: number, height: number): StorageSlotRef | null => (grid.isStorage(pos) ? slots[grid.slotAt(pos, height)] : null);
  let moves = 0;
  let queue: Move[] = opening.slice();
  /** Stacks the remaining plan expects; any mismatch with the live state triggers a replan. */
  let expected: Stacks | null = queue.length > 0 ? liveStacks(grid, pilot.snap) : null;
  const fail = (note: string): Outcome => {
    const f = pilot.snap.forklift;
    log?.(`stopped: ${note} · forklift at ${f.pos.x.toFixed(2)},${f.pos.z.toFixed(2)} heading ${((f.heading * 180) / Math.PI).toFixed(0)}° carrying ${f.carrying ?? '-'}`);
    return { solved: false, seconds: pilot.seconds, moves, note, events: pilot.events, controls: pilot.controls, snapshot: pilot.snap };
  };
  /** The approach (empty path to a pick-up pose) and carry chain for `plan` from the live state, or null. */
  const route = (stacks: Stacks, fcell: number, plan: Move) => {
    const occ = occupancyOf(grid, stacks);
    const region = reachableFrom(grid, occ, fcell);
    const starts = pickupStarts(grid, region, plan.from);
    const lifted = lift(stacks, plan.from);
    const floorFrom = plan.from < grid.cellCount;
    if (floorFrom) occ[plan.from] = lifted[plan.from].length > 0 ? 0 : -1;
    // The approach whose carry chain reaches the drop, leaving the forklift where the plan continues from if it can.
    let best: { chain: number[]; path: number[]; after: boolean; cost: number } | null = null;
    for (const s of starts) {
      const search = carrySearch(grid, occ, lifted, [s]);
      const exact = plan.after === undefined ? undefined : search.chainTo(plan.drop, plan.after);
      const chain = exact ?? search.chain(plan.drop);
      if (!chain) continue;
      const liftedOcc = occ[plan.from];
      if (floorFrom) occ[plan.from] = 0;
      const path = emptyPath(grid, occ, fcell, s >> 2);
      if (floorFrom) occ[plan.from] = liftedOcc;
      if (!path) continue;
      const after = exact !== undefined;
      const cost = path.length + chainCost(grid, chain);
      if (!best || (after && !best.after) || (after === best.after && cost < best.cost)) best = { chain, path, after, cost };
    }
    return best;
  };
  /** The move works at a conveyor belt: onto its input, into its end exit (through the input) or off its input. */
  const atBelt = (move: Move) => grid.feeds[move.drop] >= 0 || grid.fedBy[move.drop] >= 0 || grid.feeds[move.from] >= 0;
  for (let iter = 0; iter < 80; iter++) {
    const snap = pilot.snap;
    if (snap.completed) return { solved: true, seconds: pilot.seconds, moves, note: '', events: pilot.events, controls: pilot.controls, snapshot: snap };
    // A belt still carrying a box: the next move at a belt waits for it, and so does the end (its delivery may be what
    // completes the level).
    if (pilot.beltBusy && (queue.length === 0 || atBelt(queue[0]))) {
      if (!pilot.waitForBelts()) return fail('a conveyor belt never delivered its box');
      continue;
    }
    const stacks = liveStacks(grid, snap);
    const fc = worldToCell(snap.forklift.pos, level.size);
    const fcell = grid.index(fc.x, fc.z);
    const replan = () => {
      const planned = planMoves(level, grid, stacks, fcell);
      if (planned && planned.length > 0) queue = planned;
      return planned !== null && planned.length > 0;
    };
    if (!expected || queue.length === 0 || stacks.some((c, i) => c !== expected![i])) {
      if (!replan()) return fail(`no plan at iter ${iter} from cell ${fc.x},${fc.z}`);
    }
    let found = route(stacks, fcell, queue[0]);
    // The forklift may have ended in another region than the plan expected: plan again from here.
    if (!found && replan()) found = route(stacks, fcell, queue[0]);
    const plan = queue.shift()!;
    const from = plan.from;
    const lifted = lift(stacks, from);
    expected = lifted.slice();
    expected[plan.drop] += stacks[from][stacks[from].length - 1];
    // A stored box by its storage level (the top one of a stack column); a floor box on top of its cell.
    const fromSlot = slotAt(from, stacks[from].length - 1);
    const fromCell = grid.cellOf(from);
    const box = fromSlot
      ? snap.boxes.find((b) => b.slotId === fromSlot.id)
      : snap.boxes.filter((b) => b.cell && b.cell.x === fromCell.x && b.cell.z === fromCell.z).sort((a, b) => b.level - a.level)[0];
    if (!box) return fail(`no box at ${from}`);
    if (!found) return fail(`no executable route for ${box.id}`);
    const bestChain = found.chain;
    const bestEmpty = found.path;
    // The storage levels to select first with F / V (every unit): where the box is lifted from, where it is set down (a
    // box bound for a belt's end exit goes onto its input: the belt brings it on).
    const pickSlot = fromSlot;
    const dropAt = grid.fedBy[plan.drop] >= 0 ? grid.fedBy[plan.drop] : plan.drop;
    const toSlot = slotAt(dropAt, lifted[dropAt].length);
    const cellText = (c: number) => {
      const column = grid.columnOfPos(c);
      if (column) return column.support === 'shelves' ? `slot ${slots[grid.slotAt(c)].id}` : `stack ${column.ref.unit.id}:${column.ref.column}`;
      const cell = grid.cellOf(c);
      return `${cell.x},${cell.z}`;
    };
    log?.(
      `move ${moves + 1}: ${box.id} ${cellText(from)} → ${cellText(plan.drop)}${plan.after === undefined ? '' : ` (then ${cellText(plan.after)}${found.after ? '' : ', elsewhere'})`}` +
        ` · chain ${bestChain.map((p) => `${cellText(p >> 2)}${'ESWN'[p & 3]}`).join(' ')}`,
    );
    // 1) drive empty to the approach cell
    const pts = corners(grid, bestEmpty);
    const here = snap.forklift.pos;
    if (pts.length > 1 && Math.hypot(pts[0].x - here.x, pts[0].z - here.z) < 0.6) pts.shift();
    if (!pilot.follow(pts)) return fail(`stuck driving to ${box.id}`);
    const dir = bestChain[0] & 3;
    if (!pilot.face(dir)) return fail(`cannot face ${box.id}`);
    // A stored box: select its level first (the forks must stand at it to reach under it).
    if (pickSlot && !pilot.selectLevel(pickSlot.level)) return fail(`cannot select slot ${pickSlot.id} for ${box.id}`);
    // 2) nudge forward until the box is targeted, then pick
    let t = 0;
    while (pilot.snap.hint.targetBoxId !== box.id) {
      pilot.tick(DIR_X[dir] * 0.25, DIR_Z[dir] * 0.25);
      if ((t += pilot.dt) > 3) return fail(`${box.id} never targeted (target=${pilot.snap.hint.targetBoxId})`);
    }
    pilot.tick(0, 0, true);
    if (pilot.snap.forklift.carrying !== box.id) return fail(`pick of ${box.id} failed`);
    for (let k = 0; k < 20; k++) pilot.tick(0, 0);
    // 3) carry along the pose chain: turns in place, straight runs forward, straight runs back (reverse gear)
    const backStep = (a: number, b: number) => b >> 2 === grid.step(a >> 2, ((a & 3) + 2) % 4) && (a & 3) === (b & 3);
    for (let i = 1; i < bestChain.length; i++) {
      const prev = bestChain[i - 1];
      const pose = bestChain[i];
      if (pose >> 2 === prev >> 2) {
        if (!pilot.face(pose & 3)) return fail(`carry turn failed with ${box.id}`);
        if (log) {
          const f = pilot.snap.forklift;
          log(`  turn to ${'ESWN'[pose & 3]}: at ${f.pos.x.toFixed(2)},${f.pos.z.toFixed(2)} heading ${((f.heading * 180) / Math.PI).toFixed(0)}°`);
        }
        continue;
      }
      // Merge straight runs of the same kind.
      const reverse = backStep(prev, pose);
      let j = i;
      while (j + 1 < bestChain.length && (bestChain[j + 1] & 3) === (pose & 3) && bestChain[j + 1] >> 2 !== bestChain[j] >> 2 && backStep(bestChain[j], bestChain[j + 1]) === reverse) j++;
      if (toSlot && !reverse && j === bestChain.length - 1) {
        // Into storage: stop one cell short (the forks reach the level there, the load still out of the column's
        // opening), select it, then drive the load in.
        if (j > i) {
          if (!pilot.ahead(grid.center(bestChain[j - 1] >> 2), pose & 3)) return fail(`stuck carrying ${box.id} to the ${toSlot.unit.skin}`);
        }
        if (!pilot.selectLevel(toSlot.level)) return fail(`cannot select slot ${toSlot.id} for ${box.id}`);
        i = j - 1;
        j = i + 1;
      }
      const target = grid.center(bestChain[j] >> 2);
      if (!(reverse ? pilot.back(target) : pilot.ahead(target, pose & 3))) return fail(`stuck carrying ${box.id}${reverse ? ' in reverse' : ''}`);
      if (log) {
        const f = pilot.snap.forklift;
        log(`  ${reverse ? 'back' : 'ahead'} to ${cellText(bestChain[j] >> 2)}: at ${f.pos.x.toFixed(2)},${f.pos.z.toFixed(2)} heading ${((f.heading * 180) / Math.PI).toFixed(0)}°`);
      }
      i = j;
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
