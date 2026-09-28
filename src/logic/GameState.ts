import { approach, degToRad, wrapAngle } from '../core/math';
import {
  cellToWorld,
  type BoxState,
  type ForkliftState,
  type GameEvent,
  type GameSnapshot,
  type InputFrame,
  type LevelData,
  type ZoneState,
} from '../core/types';
import { GAME_CONFIG, type GameConfig } from '../config';
import { CollisionWorld } from './collision';
import { ForkliftController, MOVE_EPSILON } from './forklift';
import { LevelGrid } from './grid';
import { createDropChoice, Interaction, type DropChoice } from './interaction';

/** Returned when a step emits nothing, so quiet frames allocate no array. */
const NO_EVENTS = Object.freeze([]) as unknown as GameEvent[];

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

  constructor(level: LevelData, config: GameConfig = GAME_CONFIG) {
    this.config = config;
    const size = level.size;
    this.grid = new LevelGrid(level);

    const zones: ZoneState[] = level.zones.map((z) => ({
      id: z.id,
      color: z.color,
      cell: { x: z.x, z: z.z },
      pos: cellToWorld(z, size),
      occupiedBy: null,
      satisfied: false,
    }));
    const boxes: BoxState[] = level.boxes.map((b) => {
      const zi = this.grid.zoneAt(b.x, b.z);
      const zone = zi >= 0 ? zones[zi] : null;
      const correct = zone !== null && zone.color === b.color;
      if (zone) {
        zone.occupiedBy = b.id;
        zone.satisfied = correct;
      }
      return {
        id: b.id,
        color: b.color,
        kind: b.kind ?? 'standard',
        pos: cellToWorld(b, size),
        cell: { x: b.x, z: b.z },
        carried: false,
        zoneId: zone ? zone.id : null,
        correct,
      };
    });
    const forklift: ForkliftState = {
      pos: cellToWorld(level.forklift, size),
      heading: wrapAngle(degToRad(level.forklift.heading)),
      speed: 0,
      forkLift: 0,
      carrying: null,
      wheelSpin: 0,
      steer: 0,
    };

    this.world = CollisionWorld.fromLevel(level, config.box.size);
    this.world.setBoxes(boxes);
    this.driver = new ForkliftController(forklift, this.world, config.forklift);
    this.interaction = new Interaction(level, config, forklift, boxes, zones, this.grid, this.world);
    this.snapshot = {
      level,
      forklift,
      boxes,
      zones,
      hint: { targetBoxId: null, dropCell: null, dropZoneId: null },
      completed: false,
      progress: { satisfied: 0, total: zones.length },
    };
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
    const f = snap.forklift;
    f.forkLift = approach(f.forkLift, f.carrying ? 1 : 0, this.config.forklift.forkLiftSpeed * step);
    this.refreshHint();
    return this.flushEvents();
  }

  /** Current state. Returns the same (mutated in place) object every call; consumers must not mutate it. */
  getSnapshot(): GameSnapshot {
    return this.snapshot;
  }

  private act(): void {
    if (this.carriedIndex >= 0) {
      const box = this.snapshot.boxes[this.carriedIndex];
      if (this.interaction.findDrop(box.color, this.drop)) this.dropCarried(this.drop);
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
    let released: ZoneState | null = null;
    this.world.hardenBox(index);
    if (box.cell) {
      this.grid.setBox(box.cell.x, box.cell.z, -1);
      const zi = this.grid.zoneAt(box.cell.x, box.cell.z);
      if (zi >= 0) {
        const zone = zones[zi];
        if (zone.satisfied) released = zone;
        zone.occupiedBy = null;
        zone.satisfied = false;
      }
    }
    box.carried = true;
    box.cell = null;
    box.zoneId = null;
    box.correct = false;
    forklift.carrying = box.id;
    this.carriedIndex = index;

    const fork = this.driver.forkPoint(box.pos);
    this.driver.attachLoad(this.world.clearance(fork.x, fork.z, box.id));
    this.recountProgress();
    this.emit({ type: 'boxPicked', boxId: box.id, fromZoneId });
    if (released) this.emit({ type: 'zoneReleased', zoneId: released.id, boxId: box.id });
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
    box.correct = zone !== null && zone.color === box.color;
    if (zone) {
      zone.occupiedBy = box.id;
      zone.satisfied = box.correct;
    }
    this.grid.setBox(x, z, this.carriedIndex);
    // The box may touch the body a little (drop tolerance): ease the body out rather than popping it.
    const body = snap.forklift.pos;
    this.world.softenBox(this.carriedIndex, body.x, body.z, this.config.forklift.bodyRadius);
    snap.forklift.carrying = null;
    this.carriedIndex = -1;
    this.driver.detachLoad();

    const progress = this.recountProgress();
    this.emit({
      type: 'boxDropped',
      boxId: box.id,
      cell: { x, z },
      zoneId: box.zoneId,
      correct: box.correct,
      satisfiedCount: progress.satisfied,
      total: progress.total,
    });
    if (progress.satisfied === progress.total) {
      snap.completed = true;
      this.emit({ type: 'levelComplete' });
    }
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
    if (snap.completed) {
      hint.dropCell = null;
      hint.dropZoneId = null;
      return;
    }
    if (this.carriedIndex < 0) {
      const target = this.interaction.findPickTarget();
      hint.targetBoxId = target >= 0 ? snap.boxes[target].id : null;
      hint.dropCell = null;
      hint.dropZoneId = null;
      return;
    }
    const drop = this.drop;
    if (!this.interaction.findDrop(snap.boxes[this.carriedIndex].color, drop)) {
      hint.dropCell = null;
      hint.dropZoneId = null;
      return;
    }
    // Keep the same object while the cell is unchanged (cheap identity checks for consumers, no churn).
    const cell = hint.dropCell;
    if (!cell || cell.x !== drop.x || cell.z !== drop.z) hint.dropCell = { x: drop.x, z: drop.z };
    hint.dropZoneId = drop.zoneIndex >= 0 ? snap.zones[drop.zoneIndex].id : null;
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

