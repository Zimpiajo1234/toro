import { angleDelta, approach, clamp, degToRad, wrapAngle } from '../core/math';
import {
  cellToWorld,
  type BoxState,
  type ForkliftState,
  type GameEvent,
  type GameSnapshot,
  type InputFrame,
  type LevelData,
  type Vec2,
  type ZoneState,
} from '../core/types';
import { criteriaOf, fitsLevel, symbolOf } from '../core/sorting';
import { GAME_CONFIG, type GameConfig } from '../config';
import { CollisionWorld, pointRectDistance } from './collision';
import { forkRiseRate } from './forkRise';
import { ForkliftController, MOVE_EPSILON } from './forklift';
import { LevelGrid } from './grid';
import { createDropChoice, Interaction, type DropChoice } from './interaction';

/** Returned when a step emits nothing, so quiet frames allocate no array. */
const NO_EVENTS = Object.freeze([]) as unknown as GameEvent[];

// Stacking levels only (stackLimit > 1): how the forks and the carried load meet stacks. Classic levels never use these.
/**
 * The carried load may start over a stack once the forks are within this many levels of its top: the box rides
 * above the carriage, so it already clears the stack (the rest also covers the view easing the forks up).
 */
export const LOAD_PASS_CLEARANCE = 0.25;
/** The carried box (collider circle or drawn square) counts as over / against a stack within this gap (u). */
const LOAD_NEAR_MARGIN = 0.03;
/** Pre-lift: extra look-ahead (s) on top of the climb time (passage is updated once per frame; margin for the view). */
const PRELIFT_LEAD_SEC = 0.12;
/** Pre-lift: the predicted sweep of the fork point is sampled at least every this many units. */
const PRELIFT_SAMPLE_STEP = 0.25;
/** Pre-lift: most samples of the predicted sweep per stack. */
const PRELIFT_MAX_SAMPLES = 8;
/** Pre-lift: below this body speed (u/s) the rig is taken to move along its heading rather than its measured motion. */
const PRELIFT_MIN_SPEED = 0.05;

/**
 * Pure simulation of one level: forklift kinematics, collisions, pick-up / drop, zone scoring.
 * No three.js, no DOM, no audio. Deterministic for a given sequence of (dt, input).
 */
export class GameState {
  private readonly config: GameConfig;
  private readonly snapshot: GameSnapshot;
  private readonly grid: LevelGrid;
  private readonly world: CollisionWorld;
  private readonly driver: ForkliftController;
  private readonly interaction: Interaction;
  private readonly drop: DropChoice = createDropChoice();
  /** Index of the carried box in snapshot.boxes, or -1. */
  private carriedIndex = -1;
  private sawInput = false;
  /** The last non-idle input was vehicle control (throttle / steer) rather than a move vector. */
  private lastInputWasDrive = false;
  private events: GameEvent[] = [];
  private readonly boxIndex: Map<string, number>;
  /** Level of the current pick target (valid while hint.targetBoxId is set). */
  private pickLevel = 0;
  /**
   * Stacking levels: rig motion over the last step, for the pre-lift. Pose at its end, direction of travel (unit),
   * speed (u/s), the forward speed the input asks for (u/s) and turn rate (rad/s).
   */
  private readonly motion = { x: 0, z: 0, heading: 0, dirX: 0, dirZ: 1, speed: 0, command: 0, turn: 0 };
  /** Scratch fork point for clearLevel. */
  private readonly forkProbe: Vec2 = { x: 0, z: 0 };

  constructor(level: LevelData, config: GameConfig = GAME_CONFIG) {
    this.config = config;
    const size = level.size;
    this.grid = new LevelGrid(level);

    const zones: ZoneState[] = level.zones.map((z) => ({
      id: z.id,
      color: z.color ?? null,
      accepts: criteriaOf(z),
      cell: { x: z.x, z: z.z },
      pos: cellToWorld(z, size),
      recipe: z.recipe ? [...z.recipe] : [z.color ?? null],
      stack: [],
      occupiedBy: null,
      satisfied: false,
      next: null,
    }));
    const boxes: BoxState[] = level.boxes.map((b, i) => {
      const zi = this.grid.zoneAt(b.x, b.z);
      const zone = zi >= 0 ? zones[zi] : null;
      // Boxes sharing a cell are stacked bottom → top in list order (the grid already holds them that way).
      const stackLevel = this.grid.stackAt(b.x, b.z).indexOf(i);
      return {
        id: b.id,
        color: b.color,
        symbol: symbolOf(b),
        kind: b.kind ?? 'standard',
        pos: cellToWorld(b, size),
        cell: { x: b.x, z: b.z },
        level: Math.max(0, stackLevel),
        carried: false,
        zoneId: zone ? zone.id : null,
        correct: false,
      };
    });
    for (const zone of zones) {
      for (const bi of this.grid.stackAt(zone.cell.x, zone.cell.z)) zone.stack.push(boxes[bi].id);
    }
    this.boxIndex = new Map(boxes.map((b, i) => [b.id, i]));
    const forklift: ForkliftState = {
      pos: cellToWorld(level.forklift, size),
      heading: wrapAngle(degToRad(level.forklift.heading)),
      speed: 0,
      forkLift: 0,
      forkHeight: 0,
      carrying: null,
      wheelSpin: 0,
      steer: 0,
    };

    this.world = CollisionWorld.fromLevel(level, config.box.size);
    this.world.setBoxes(boxes);
    this.driver = new ForkliftController(forklift, this.world, config.forklift);
    this.motion.x = forklift.pos.x;
    this.motion.z = forklift.pos.z;
    this.motion.heading = forklift.heading;
    this.interaction = new Interaction(level, config, forklift, boxes, zones, this.grid, this.world);
    this.snapshot = {
      level,
      forklift,
      boxes,
      zones,
      hint: { targetBoxId: null, dropCell: null, dropZoneId: null, dropLevel: 0 },
      completed: false,
      progress: { satisfied: 0, total: zones.length },
    };
    for (const zone of zones) this.refreshZone(zone);
    this.refreshLoadPassage();
    this.recountProgress();
    this.refreshHint();
  }

  /**
   * Advance the simulation. `dt` is seconds (already clamped by the caller to ≤ 1/20).
   * Returns the events emitted during this step (a fresh array, or a shared frozen empty one).
   */
  update(dt: number, input: InputFrame): GameEvent[] {
    const snap = this.snapshot;
    let moveX = Number.isFinite(input.move.x) ? input.move.x : 0;
    let moveZ = Number.isFinite(input.move.z) ? input.move.z : 0;
    let throttle = input.drive && Number.isFinite(input.drive.throttle) ? input.drive.throttle : 0;
    let steer = input.drive && Number.isFinite(input.drive.steer) ? input.drive.steer : 0;

    if (!snap.completed) {
      const moving =
        moveX * moveX + moveZ * moveZ > MOVE_EPSILON * MOVE_EPSILON || Math.abs(throttle) > MOVE_EPSILON || Math.abs(steer) > MOVE_EPSILON;
      if (!this.sawInput && (moving || input.actionPressed)) {
        this.sawInput = true;
        this.emit({ type: 'firstInput' });
      }
      // Act on the pose the player saw last frame (matches the displayed hint).
      if (input.actionPressed) this.act();
    }
    // After completion the forklift ignores input and coasts to rest.
    if (snap.completed) moveX = moveZ = throttle = steer = 0;

    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.world.settle(step);
    // Vehicle input (throttle / steer) takes precedence; otherwise the camera-relative move vector. With no input
    // at all, the rig settles the way it was last driven (each style has its own soft turn release).
    const driving = Math.abs(throttle) > MOVE_EPSILON || Math.abs(steer) > MOVE_EPSILON;
    const moving = moveX * moveX + moveZ * moveZ > MOVE_EPSILON * MOVE_EPSILON;
    if (driving) this.lastInputWasDrive = true;
    else if (moving) this.lastInputWasDrive = false;
    if (driving || (!moving && this.lastInputWasDrive)) this.driver.stepDrive(step, throttle, steer);
    else this.driver.step(step, moveX, moveZ);
    this.followForks();
    if (this.grid.stackLimit > 1) this.trackMotion(step, driving ? throttle : moving ? this.moveThrottle(moveX, moveZ) : 0);
    const f = snap.forklift;
    f.forkLift = approach(f.forkLift, f.carrying ? 1 : 0, this.config.forklift.forkLiftSpeed * step);
    this.refreshHint();
    this.stepForkHeight(step);
    this.refreshLoadPassage();
    return this.flushEvents();
  }

  /** Current state. Returns the same (mutated in place) object every call; consumers must not mutate it. */
  getSnapshot(): GameSnapshot {
    return this.snapshot;
  }

  private act(): void {
    if (this.carriedIndex >= 0) {
      const box = this.snapshot.boxes[this.carriedIndex];
      if (this.interaction.findDrop(box, this.drop)) this.dropCarried(this.drop);
      else this.emit({ type: 'actionIdle', carrying: true });
      return;
    }
    const target = this.interaction.findPickTarget();
    if (target >= 0) this.pick(target);
    else this.emit({ type: 'actionIdle', carrying: false });
  }

  private pick(index: number): void {
    const { boxes, zones, forklift } = this.snapshot;
    const box = boxes[index];
    const fromZoneId = box.zoneId;
    const fromLevel = box.level;
    const cell = box.cell;
    let released: ZoneState | null = null;
    let restored: ZoneState | null = null;
    this.world.hardenBox(index);
    this.world.setPassable(index, false);
    box.carried = true;
    box.cell = null;
    box.level = 0;
    box.zoneId = null;
    box.correct = false;
    if (cell) {
      this.grid.popBox(cell.x, cell.z);
      const zi = this.grid.zoneAt(cell.x, cell.z);
      if (zi >= 0) {
        const zone = zones[zi];
        const was = zone.satisfied;
        zone.stack.pop();
        this.refreshZone(zone);
        if (was && !zone.satisfied) released = zone;
        else if (!was && zone.satisfied) restored = zone; // the wrong box on top came off
      }
      // The load was just lifted off what is left of the stack: it stays over it (see refreshLoadPassage).
      this.world.setPassable(this.grid.baseAt(cell.x, cell.z), true);
    }
    forklift.carrying = box.id;
    this.carriedIndex = index;

    const fork = this.driver.forkPoint(box.pos);
    this.refreshLoadPassage();
    this.driver.attachLoad(this.world.clearance(fork.x, fork.z, box.id, true));
    const progress = this.recountProgress();
    this.emit({ type: 'boxPicked', boxId: box.id, fromZoneId, level: fromLevel });
    if (released) this.emit({ type: 'zoneReleased', zoneId: released.id, boxId: box.id });
    if (restored) {
      this.emit({
        type: 'zoneRestored',
        zoneId: restored.id,
        boxId: box.id,
        recipeLength: restored.recipe.length,
        satisfiedCount: progress.satisfied,
        total: progress.total,
      });
    }
  }

  private dropCarried(choice: DropChoice): void {
    const snap = this.snapshot;
    const box = snap.boxes[this.carriedIndex];
    const { x, z } = choice;
    const zone = choice.zoneIndex >= 0 ? snap.zones[choice.zoneIndex] : null;

    box.carried = false;
    box.cell = { x, z };
    box.pos.x = x + 0.5 - snap.level.size.width / 2;
    box.pos.z = z + 0.5 - snap.level.size.depth / 2;
    box.zoneId = zone ? zone.id : null;
    box.level = this.grid.pushBox(x, z, this.carriedIndex);
    let released = false;
    if (zone) {
      const was = zone.satisfied;
      zone.stack.push(box.id);
      this.refreshZone(zone);
      released = was && !zone.satisfied;
    } else {
      box.correct = false;
    }
    // A floor drop may touch the body a little (drop tolerance): ease the body out rather than popping it.
    const body = snap.forklift.pos;
    if (box.level === 0) this.world.softenBox(this.carriedIndex, body.x, body.z, this.config.forklift.bodyRadius);
    snap.forklift.carrying = null;
    this.carriedIndex = -1;
    this.driver.detachLoad();
    this.refreshLoadPassage();

    const progress = this.recountProgress();
    this.emit({
      type: 'boxDropped',
      boxId: box.id,
      cell: { x, z },
      zoneId: box.zoneId,
      level: box.level,
      correct: zone !== null && zone.satisfied,
      recipeLength: zone ? zone.recipe.length : 0,
      satisfiedCount: progress.satisfied,
      total: progress.total,
    });
    if (released && zone) this.emit({ type: 'zoneReleased', zoneId: zone.id, boxId: box.id });
    if (progress.satisfied === progress.total) {
      snap.completed = true;
      this.emit({ type: 'levelComplete' });
    }
  }

  /**
   * Stacking levels: how the rig moved this step (for the pre-lift in clearLevel). `throttle`: the forward drive the
   * input asks for (−1‥1), which also covers a rig still held at a stack's face.
   */
  private trackMotion(dt: number, throttle: number): void {
    if (!(dt > 0)) return;
    const f = this.snapshot.forklift;
    const m = this.motion;
    const vx = (f.pos.x - m.x) / dt;
    const vz = (f.pos.z - m.z) / dt;
    const speed = Math.hypot(vx, vz);
    m.speed = speed;
    m.command = clamp(throttle, 0, 1) * this.config.forklift.maxSpeed;
    const way = f.speed < 0 && m.command === 0 ? -1 : 1;
    m.dirX = speed > PRELIFT_MIN_SPEED ? vx / speed : way * Math.sin(f.heading);
    m.dirZ = speed > PRELIFT_MIN_SPEED ? vz / speed : way * Math.cos(f.heading);
    m.turn = angleDelta(m.heading, f.heading) / dt;
    m.x = f.pos.x;
    m.z = f.pos.z;
    m.heading = f.heading;
  }

  /** Forward share (0‥1) of a world-space move vector: how hard it drives the rig along its current heading. */
  private moveThrottle(moveX: number, moveZ: number): number {
    const length = Math.min(1, Math.hypot(moveX, moveZ));
    const heading = this.snapshot.forklift.heading;
    return length * Math.max(0, Math.cos(angleDelta(heading, Math.atan2(moveX, moveZ))));
  }

  /**
   * Stacking levels: distance the body is predicted to cover in `t` s: its current speed, speeding up toward what
   * the input asks for (never slowing, so the guess errs toward lifting early).
   */
  private predictedTravel(t: number): number {
    const m = this.motion;
    const target = Math.max(m.speed, m.command);
    const accel = this.config.forklift.acceleration;
    if (target <= m.speed || !(accel > 0)) return m.speed * t;
    const ramp = Math.min(t, (target - m.speed) / accel);
    return m.speed * ramp + 0.5 * accel * ramp * ramp + target * (t - ramp);
  }

  /** Carried box rides on the fork point. */
  private followForks(): void {
    if (this.carriedIndex >= 0) this.driver.forkPoint(this.snapshot.boxes[this.carriedIndex].pos);
  }

  private recountProgress(): GameSnapshot['progress'] {
    const progress = this.snapshot.progress;
    let satisfied = 0;
    for (const zone of this.snapshot.zones) if (zone.satisfied) satisfied++;
    progress.satisfied = satisfied;
    return progress;
  }

  private refreshHint(): void {
    const snap = this.snapshot;
    const hint = snap.hint;
    hint.targetBoxId = null;
    hint.dropLevel = 0;
    if (snap.completed) {
      hint.dropCell = null;
      hint.dropZoneId = null;
      return;
    }
    if (this.carriedIndex < 0) {
      const target = this.interaction.findPickTarget();
      hint.targetBoxId = target >= 0 ? snap.boxes[target].id : null;
      this.pickLevel = target >= 0 ? snap.boxes[target].level : 0;
      hint.dropCell = null;
      hint.dropZoneId = null;
      return;
    }
    const drop = this.drop;
    if (!this.interaction.findDrop(snap.boxes[this.carriedIndex], drop)) {
      hint.dropCell = null;
      hint.dropZoneId = null;
      return;
    }
    hint.dropLevel = drop.level;
    // Keep the same object while the cell is unchanged (cheap identity checks for consumers, no churn).
    const cell = hint.dropCell;
    if (!cell || cell.x !== drop.x || cell.z !== drop.z) hint.dropCell = { x: drop.x, z: drop.z };
    hint.dropZoneId = drop.zoneIndex >= 0 ? snap.zones[drop.zoneIndex].id : null;
  }

  /**
   * Zone state derived from its stack: satisfied iff it holds exactly what it asks for (a bottom box it accepts, then
   * its recipe's colors: core/sorting `fitsLevel`); `next` = the color it takes next while the stack is a correct,
   * unfinished prefix. Boxes on it are `correct` up to the first box that does not fit.
   */
  private refreshZone(zone: ZoneState): void {
    const boxes = this.snapshot.boxes;
    const recipe = zone.recipe;
    let prefix = true;
    for (let i = 0; i < zone.stack.length; i++) {
      const box = boxes[this.boxIndex.get(zone.stack[i]) ?? -1];
      if (!box) continue;
      prefix = prefix && fitsLevel(zone, i, box);
      box.correct = prefix;
    }
    const n = zone.stack.length;
    zone.occupiedBy = n > 0 ? zone.stack[n - 1] : null;
    zone.satisfied = prefix && n === recipe.length;
    zone.next = prefix && n < recipe.length ? recipe[n] : null;
  }

  /**
   * Stacking levels: which stack bases the carried load may pass over (CollisionWorld passable). A stack with room
   * opens once the forks are nearly at its top and stays open while the load is over it (the forks hold there, see
   * clearLevel), so it never turns solid under the load: no push-out. Until then it blocks the load like any box.
   * Classic levels: never.
   */
  private refreshLoadPassage(): void {
    const grid = this.grid;
    const limit = grid.stackLimit;
    if (limit <= 1) return;
    const { boxes, forklift } = this.snapshot;
    const load = this.carriedIndex >= 0 ? boxes[this.carriedIndex].pos : null;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const cell = b.cell;
      if (!cell || b.level > 0) continue;
      const h = grid.height(cell.x, cell.z);
      const high = forklift.forkHeight >= h - LOAD_PASS_CLEARANCE;
      const over = load !== null && this.world.isPassable(i) && this.loadNear(load.x, load.z, forklift.heading, b.pos, true);
      this.world.setPassable(i, h < limit && (high || over));
    }
  }

  /**
   * Carriage height in stack levels: toward the drop height while carrying, the target box's level while empty.
   * Discrete targets, reached at a steady rate that is slower the higher the forks go (always 0 in classic levels).
   * Never below what clearLevel asks for, so neither the load nor the empty forks sink into a stack.
   */
  private stepForkHeight(dt: number): void {
    const snap = this.snapshot;
    const f = snap.forklift;
    let target = 0;
    if (!snap.completed) {
      if (this.carriedIndex >= 0) target = Math.max(snap.hint.dropCell ? snap.hint.dropLevel : 0, this.clearLevel(true));
      else target = snap.hint.targetBoxId ? this.pickLevel : this.clearLevel(false);
    }
    if (target === f.forkHeight || !(dt > 0)) return;
    f.forkHeight = approach(f.forkHeight, target, this.forkRate(Math.max(f.forkHeight, target)) * dt);
  }

  /** Fork climb speed (levels / s) toward `level`. */
  private forkRate(level: number): number {
    return forkRiseRate(this.config, level);
  }

  /**
   * Stacking levels: the lowest carriage height that meets no stack. Carrying: the height of the tallest stack with
   * room the load is over (never sink into it), or will run into before the forks could climb to it at the rig's
   * current motion and throttle (driving or turning; also when held at its face), so it is lifted in time to clear
   * the stack instead of stopping there. Empty: the top box of a stack the forks are at or reaching the same way.
   */
  private clearLevel(carrying: boolean): number {
    const grid = this.grid;
    const limit = grid.stackLimit;
    if (limit <= 1) return 0;
    const { boxes, forklift } = this.snapshot;
    const m = this.motion;
    const reach = this.config.forklift.forkReach;
    const fork = this.forkProbe;
    let level = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const cell = b.cell;
      if (!cell || b.level > 0) continue;
      const h = grid.height(cell.x, cell.z);
      const top = carrying ? (h < limit ? h : 0) : h - 1;
      if (top <= level) continue;
      // Predicted sweep over the time the forks need to clear this stack (sample 0 = now). The load clears it a
      // little below its top; empty tines slide under the top box, so they go all the way (view easing included).
      const climb = carrying ? top - LOAD_PASS_CLEARANCE : top + LOAD_PASS_CLEARANCE;
      const horizon = Math.max(0, climb) / this.forkRate(top) + PRELIFT_LEAD_SEC;
      const path = this.predictedTravel(horizon) + Math.abs(m.turn) * reach * horizon;
      const samples = Math.min(PRELIFT_MAX_SAMPLES, Math.ceil(path / PRELIFT_SAMPLE_STEP));
      const over = carrying && this.world.isPassable(i);
      for (let k = 0; k <= samples; k++) {
        const t = k === 0 ? 0 : (horizon * k) / samples;
        const travel = this.predictedTravel(t);
        const heading = forklift.heading + m.turn * t;
        fork.x = forklift.pos.x + m.dirX * travel + Math.sin(heading) * reach;
        fork.z = forklift.pos.z + m.dirZ * travel + Math.cos(heading) * reach;
        // Right now a load collider merely resting against a stack (e.g. just picked up beside it) does not lift
        // the forks: only a load over it, or the drawn box overlapping it, does. Ahead, touching counts.
        if (this.loadNear(fork.x, fork.z, heading, b.pos, k > 0 || over || !carrying)) {
          level = top;
          break;
        }
      }
    }
    return level;
  }

  /**
   * A carried box at (x, z) turned to `heading` is over or against the box resting at `p` (within LOAD_NEAR_MARGIN):
   * its drawn square (separating axes of both squares), or with `collider` also its collider circle.
   */
  private loadNear(x: number, z: number, heading: number, p: Vec2, collider: boolean): boolean {
    const half = this.config.box.size / 2;
    const r = this.config.forklift.carriedBoxRadius + LOAD_NEAR_MARGIN;
    if (collider && pointRectDistance(x, z, p.x - half, p.z - half, p.x + half, p.z + half) < r) return true;
    const s = Math.sin(heading);
    const c = Math.cos(heading);
    const extent = half * (1 + Math.abs(s) + Math.abs(c)) + LOAD_NEAR_MARGIN;
    const dx = p.x - x;
    const dz = p.z - z;
    return Math.abs(dx) < extent && Math.abs(dz) < extent && Math.abs(dx * s + dz * c) < extent && Math.abs(dx * c - dz * s) < extent;
  }

  private emit(event: GameEvent): void {
    this.events.push(event);
  }

  private flushEvents(): GameEvent[] {
    if (this.events.length === 0) return NO_EVENTS;
    const out = this.events;
    this.events = [];
    return out;
  }
}

