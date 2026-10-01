import { angleDelta, approach, clamp, degToRad, wrapAngle } from '../core/math';
import {
  cellToWorld,
  type BoxState,
  type ForkliftState,
  type GameEvent,
  type GameSnapshot,
  type InputFrame,
  type LevelData,
  type StorageHint,
  type StorageSlotState,
  type Vec2,
  type ZoneState,
} from '../core/types';
import { criteriaOf, cueOf, fitsLevel, levelDestinies, sameKind, symbolOf } from '../core/sorting';
import { FACING_X, columnFrame, inwardHeading } from '../core/racks';
import { hasStorage, storageSlotsOf } from '../core/storage';
import { GAME_CONFIG, type GameConfig } from '../config';
import { CollisionWorld, pointRectDistance } from './collision';
import { forkRiseRate } from './forkRise';
import { ForkliftController, MOVE_EPSILON } from './forklift';
import { LevelGrid } from './grid';
import { createDropChoice, createStorageAim, Interaction, type DropChoice, type StorageAim } from './interaction';
import { STORAGE_ACCESS, STORAGE_ACCESS_ORDER, type StorageAccessRow } from './storageAccess';

type BoxDropped = Extract<GameEvent, { type: 'boxDropped' }>;

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

// Storage (docs/STORAGE.md). Classic, stacking and sorting levels never use these; how the rig engages a column of each
// access and how deep it must reach: logic/storageAccess STORAGE_ACCESS (the forks go by the keys at every one).
/**
 * The carried load counts as inside a storage opening (the heading holds: it goes in and out straight) once its leading
 * edge is this far (u) past the opening's face: a rack slot's front face, a dock's wall line (loadInOpening).
 */
const INSIDE_MARGIN = 0.05;

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
  /** Levels with storage: the storage column the forks work on (shared with Interaction) and the selection state. */
  private readonly aim: StorageAim = createStorageAim();
  /**
   * Storage column the rig works at (facing it, or still within its access's hold margins), -1 = none: its forks follow
   * `forkLevel` there (every unit: docs/STORAGE.md rule 9).
   */
  private engaged = -1;
  /** Facing `engaged` this frame (not merely held). */
  private facing = false;
  /** Selected level at the engaged column (F / V, wheel, gamepad X / B). */
  private forkLevel = 0;
  /**
   * Per storage column: world centre of its cell (inside the map, or beyond a wall) and the heading that faces into it
   * from its front.
   */
  private readonly columnCenters: Vec2[] = [];
  private readonly columnHeadings: number[] = [];
  /** Scratch for core/racks columnFrame. */
  private readonly frame = { depth: 0, lateral: 0 };
  /** Per storage column (access `front`): the level its slot was opened at for the load (-1 = closed). */
  private openLevels = new Int8Array(0);
  /** The hint's storage object, reused (hint.storage points at it or is null). */
  private readonly storageHint: StorageHint = { unitId: '', skin: 'rack', column: 0, levels: 1, level: 0, slotId: '', ready: false };
  /**
   * The level has storage (core/storage hasStorage): it follows the target rules of docs/STORAGE.md (destinies, locks,
   * soft buzz) and F / V step the forks at its units (elsewhere they do nothing, as before).
   */
  private readonly targetRules: boolean;
  /**
   * Where the carried box was picked up (its cell, height and storage slot): a drop right back there is no move for
   * snapshot.moves (see countMove).
   */
  private readonly origin = { x: -1, z: -1, level: 0, slotId: null as string | null };

  constructor(level: LevelData, config: GameConfig = GAME_CONFIG) {
    this.config = config;
    const size = level.size;
    this.grid = new LevelGrid(level);
    this.targetRules = hasStorage(level);
    const columns = this.grid.columns;

    // Levels with storage: every zone and storage slot with a cue has the one box kind the level's unique solution
    // gives it.
    const destinies = levelDestinies(level);
    const zones: ZoneState[] = level.zones.map((z, i) => ({
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
      destined: destinies ? { ...destinies.zones[i] } : null,
    }));
    const storageSlots: StorageSlotState[] = storageSlotsOf(level).map((ref, i) => {
      const destined = destinies?.slots[i] ?? null;
      return {
        id: ref.id,
        unitId: ref.unit.id,
        skin: ref.unit.skin,
        column: ref.column,
        level: ref.level,
        cell: ref.cell,
        front: ref.front,
        facing: ref.facing,
        pos: cellToWorld(ref.cell, size),
        // Its cue as criteria (a fresh object); none, or an empty one, is «libre».
        accepts: ref.cue ? cueOf(ref.cue) : null,
        destined: destined ? { ...destined } : null,
        occupiedBy: null,
        satisfied: false,
        loadable: false,
      };
    });
    for (const column of columns) {
      this.columnCenters.push(cellToWorld(column.cell, size));
      this.columnHeadings.push(inwardHeading(column.facing));
    }
    this.openLevels = new Int8Array(columns.length).fill(-1);
    const boxes: BoxState[] = level.boxes.map((b, i) => {
      const zi = this.grid.zoneAt(b.x, b.z);
      const zone = zi >= 0 ? zones[zi] : null;
      const column = this.grid.columnAt(b.x, b.z);
      const slot = column >= 0 && b.level !== undefined ? storageSlots[this.grid.slotOf(column, b.level)] : null;
      // Boxes sharing a cell are stacked bottom → top in list order (the grid already holds them that way).
      const stackLevel = this.grid.stackAt(b.x, b.z).indexOf(i);
      return {
        id: b.id,
        color: b.color,
        symbol: symbolOf(b),
        kind: b.kind ?? 'standard',
        pos: cellToWorld(b, size),
        cell: { x: b.x, z: b.z },
        level: slot ? slot.level : Math.max(0, stackLevel),
        carried: false,
        zoneId: zone ? zone.id : null,
        slotId: slot ? slot.id : null,
        correct: false,
        locked: false,
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
      reversing: false,
    };

    this.world = CollisionWorld.fromLevel(level, config.box.size);
    this.world.setBoxes(boxes);
    this.driver = new ForkliftController(forklift, this.world, config.forklift);
    this.motion.x = forklift.pos.x;
    this.motion.z = forklift.pos.z;
    this.motion.heading = forklift.heading;
    this.interaction = new Interaction(level, config, forklift, boxes, zones, this.grid, this.world, this.aim);
    this.snapshot = {
      level,
      forklift,
      boxes,
      zones,
      storageSlots,
      hint: { targetBoxId: null, dropCell: null, dropZoneId: null, dropLevel: 0, storage: null },
      completed: false,
      progress: { satisfied: 0, total: zones.length + storageSlots.filter((slot) => slot.accepts !== null).length },
      moves: 0,
    };
    for (const zone of zones) this.refreshZone(zone);
    for (let c = 0; c < columns.length; c++) this.refreshColumn(c);
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
    // Fork level steps only mean something in a level with storage (elsewhere F / V do nothing, as before).
    const forkStep = !this.targetRules ? 0 : input.forkStep === 1 ? 1 : input.forkStep === -1 ? -1 : 0;

    if (!snap.completed) {
      const moving =
        moveX * moveX + moveZ * moveZ > MOVE_EPSILON * MOVE_EPSILON || Math.abs(throttle) > MOVE_EPSILON || Math.abs(steer) > MOVE_EPSILON;
      if (!this.sawInput && (moving || input.actionPressed || forkStep !== 0)) {
        this.sawInput = true;
        this.emit({ type: 'firstInput' });
      }
      // Act on the pose the player saw last frame (matches the displayed hint).
      if (input.actionPressed) this.act();
      if (forkStep !== 0) this.stepForkLevel(forkStep);
    }
    // After completion the forklift ignores input and coasts to rest.
    if (snap.completed) moveX = moveZ = throttle = steer = 0;

    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    this.world.settle(step);
    // Vehicle input (throttle / steer) takes precedence; otherwise the camera-relative move vector. With no input
    // at all, the rig settles the way it was last driven (each style has its own soft turn release).
    const driving = Math.abs(throttle) > MOVE_EPSILON || Math.abs(steer) > MOVE_EPSILON;
    const moving = moveX * moveX + moveZ * moveZ > MOVE_EPSILON * MOVE_EPSILON;
    // A load inside a storage opening (a rack slot, a dock door: only ever the one of the column the rig works at, as
    // the aim saw it at the end of last frame; a box just lifted out of it counts at once): straight in or out only.
    if (this.grid.columns.length > 0) this.driver.setHeadingLock(this.loadInOpening());
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
    this.refreshStoragePassage();
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
    // Out of storage (any skin): the column it rests in and its slot there.
    const column = box.slotId !== null && cell ? this.grid.columnAt(cell.x, cell.z) : -1;
    const from = column >= 0 ? this.snapshot.storageSlots[this.grid.columns[column].firstSlot + fromLevel] : null;
    const fromWas = from !== null && from.satisfied;
    let released: ZoneState | null = null;
    let restored: ZoneState | null = null;
    const origin = this.origin;
    origin.x = cell ? cell.x : -1;
    origin.z = cell ? cell.z : -1;
    origin.level = fromLevel;
    origin.slotId = box.slotId;
    this.world.hardenBox(index);
    this.world.setPassable(index, false);
    box.carried = true;
    box.cell = null;
    box.level = 0;
    box.zoneId = null;
    box.slotId = null;
    box.correct = false;
    box.locked = false;
    if (from && cell) {
      // Out of a storage column: what is left there keeps its state, and its opening opens for the load, which starts
      // inside it (it stays open while the load backs out): a rack slot at that level, a door column's span.
      this.grid.takeBox(column, fromLevel);
      this.refreshColumn(column);
      this.world.setOpen(column, true);
      if (this.grid.columns[column].access === 'front') this.openLevels[column] = fromLevel;
      // Lifted off what is left of a stack: the load stays over it (see refreshLoadPassage).
      else this.world.setPassable(this.grid.baseAt(cell.x, cell.z), true);
    } else if (cell) {
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
    this.refreshStoragePassage();
    this.driver.attachLoad(this.world.clearance(fork.x, fork.z, box.id, true));
    const progress = this.recountProgress();
    if (from) this.emit({ type: 'boxPicked', boxId: box.id, fromZoneId, level: fromLevel, fromSlotId: from.id, skin: from.skin });
    else this.emit({ type: 'boxPicked', boxId: box.id, fromZoneId, level: fromLevel });
    if (released) this.emit({ type: 'zoneReleased', zoneId: released.id, boxId: box.id });
    // Never today: a satisfied box is locked (docs/STORAGE.md rule 5), so it is never picked.
    if (from && fromWas && !from.satisfied) this.emit({ type: 'zoneReleased', zoneId: null, boxId: box.id, slotId: from.id, skin: from.skin });
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
    if (choice.column >= 0) {
      this.dropInStorage(choice.column, choice.level);
      return;
    }
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
      box.locked = false;
    }
    // A floor drop may touch the body a little (drop tolerance): ease the body out rather than popping it.
    const body = snap.forklift.pos;
    if (box.level === 0) this.world.softenBox(this.carriedIndex, body.x, body.z, this.config.forklift.bodyRadius);
    snap.forklift.carrying = null;
    this.carriedIndex = -1;
    this.driver.detachLoad();
    this.refreshLoadPassage();
    this.countMove(box);

    const progress = this.recountProgress();
    const correct = zone !== null && zone.satisfied;
    const drop: BoxDropped = {
      type: 'boxDropped',
      boxId: box.id,
      cell: { x, z },
      zoneId: box.zoneId,
      level: box.level,
      correct,
      recipeLength: zone ? zone.recipe.length : 0,
      satisfiedCount: progress.satisfied,
      total: progress.total,
    };
    // Levels with storage: a zone that did not get its destined box (plain floor never is a target).
    if (zone !== null && !correct && this.targetRules) drop.wrongTarget = true;
    this.emit(drop);
    if (released && zone) this.emit({ type: 'zoneReleased', zoneId: zone.id, boxId: box.id });
    if (progress.satisfied === progress.total) {
      snap.completed = true;
      this.emit({ type: 'levelComplete' });
    }
  }

  /**
   * The carried box goes into storage column `column` (LevelGrid.columns) at `level`, in any skin: onto that shelf, or
   * on top of the column's stack (which is that level). It lands in the column's cell (a rack cell, a truck's bed cell
   * beyond the door: the forks already stand over it). Its slot is satisfied only by its destined box (in a stack, on
   * satisfied levels below); any other drop on a slot with a cue is a wrong target (soft buzz) and the box stays
   * pickable.
   */
  private dropInStorage(column: number, level: number): void {
    const snap = this.snapshot;
    const index = this.carriedIndex;
    const box = snap.boxes[index];
    const { cell, firstSlot } = this.grid.columns[column];
    box.carried = false;
    box.cell = { x: cell.x, z: cell.z };
    box.zoneId = null;
    box.level = this.grid.putBox(column, level, index);
    const state = snap.storageSlots[firstSlot + box.level];
    box.pos.x = state.pos.x;
    box.pos.z = state.pos.z;
    box.slotId = state.id;
    this.refreshColumn(column);
    snap.forklift.carrying = null;
    this.carriedIndex = -1;
    this.driver.detachLoad();
    this.refreshLoadPassage();
    this.refreshStoragePassage();
    this.countMove(box);

    const progress = this.recountProgress();
    const drop: BoxDropped = {
      type: 'boxDropped',
      boxId: box.id,
      cell: { x: cell.x, z: cell.z },
      zoneId: null,
      level: box.level,
      correct: state.satisfied,
      recipeLength: state.accepts !== null ? 1 : 0,
      satisfiedCount: progress.satisfied,
      total: progress.total,
      slotId: state.id,
      skin: state.skin,
    };
    // A slot with a cue that did not get its destined box (a trap box that fits the cue too; in a stack also on a
    // level below that is not satisfied); «libre» slots never.
    if (state.accepts !== null && !state.satisfied) drop.wrongTarget = true;
    this.emit(drop);
    if (progress.satisfied === progress.total) {
      snap.completed = true;
      this.emit({ type: 'levelComplete' });
    }
  }

  /**
   * A storage column's slots from its boxes, by its support (docs/STORAGE.md rules 5 and 8). Shelves: each level on its
   * own, satisfied iff it holds its destined kind (a «libre» one never is), loadable while empty. A stack: bottom → top,
   * a level is satisfied only with its destined box on satisfied levels; loadable = the lowest empty level with every
   * level below satisfied. A satisfied level's box is locked (done: never lifted again; on a stack the next level still
   * loads on top of it).
   */
  private refreshColumn(c: number): void {
    const column = this.grid.columns[c];
    const slots = this.snapshot.storageSlots;
    const boxes = this.snapshot.boxes;
    const stack = column.support === 'stack' ? this.grid.stackAt(column.cell.x, column.cell.z) : null;
    let right = true;
    for (let level = 0; level < column.levels; level++) {
      const slot = slots[column.firstSlot + level];
      let box: BoxState | null;
      if (stack) {
        box = level < stack.length ? boxes[stack[level]] : null;
        slot.satisfied = right && box !== null && slot.destined !== null && sameKind(slot.destined, box);
        slot.loadable = right && level === stack.length;
        right = slot.satisfied;
      } else {
        const bi = this.grid.slotBox(column.firstSlot + level);
        box = bi >= 0 ? boxes[bi] : null;
        slot.satisfied = box !== null && slot.destined !== null && sameKind(slot.destined, box);
        slot.loadable = box === null;
      }
      slot.occupiedBy = box ? box.id : null;
      if (box) {
        box.correct = slot.satisfied;
        box.locked = slot.satisfied;
      }
    }
  }

  /**
   * Levels with storage: which storage column the rig works at, by its access (STORAGE_ACCESS). Facing one (heading, fork
   * point beside its centre line and near its face; through a door also the body in line with its door cell) engages it;
   * an engaged column holds within looser margins so a small wobble does not flicker the hint or drop the forks (it
   * keeps its selected level, so the forks stay up); leaving them resets the selection to the bottom level and the forks
   * go back to automatic, as on the floor. Arriving at another unit starts at its bottom level; sliding along the same
   * unit keeps it. The accesses are tried in STORAGE_ACCESS order (a rack before a truck), facing a column before holding
   * the old one. Then StorageAim: the column pick / drop act on (the forks at the selected level, the fork point deep
   * enough), that level, and whether nothing may be dropped yet (the forks on their way to the selected level; the load
   * in a doorway short of the reach or with the forks away from that level).
   */
  private refreshStorageAim(): void {
    const aim = this.aim;
    const columns = this.grid.columns;
    if (columns.length === 0) return;
    const f = this.snapshot.forklift;
    const reach = this.config.forklift.forkReach;
    const px = f.pos.x + Math.sin(f.heading) * reach;
    const pz = f.pos.z + Math.cos(f.heading) * reach;
    const frame = this.frame;
    const was = this.engaged;
    let engaged = -1;
    let facing = false;
    let depth = 0;
    for (const kind of STORAGE_ACCESS_ORDER) {
      const row = STORAGE_ACCESS[kind];
      let best = -1;
      let bestScore = Infinity;
      for (let c = 0; c < columns.length; c++) {
        if (columns[c].access !== kind) continue;
        if (Math.abs(angleDelta(f.heading, this.columnHeadings[c])) > row.faceAngle || (row.bodyInLine && !this.inLineWith(c))) continue;
        columnFrame(this.columnCenters[c], columns[c].facing, px, pz, frame);
        if (Math.abs(frame.lateral) > row.faceLateral || frame.depth < -row.faceNear || frame.depth > row.faceFar) continue;
        const score = Math.abs(frame.lateral) + Math.abs(frame.depth);
        if (score < bestScore) {
          best = c;
          bestScore = score;
          depth = frame.depth;
        }
      }
      if (best >= 0) {
        engaged = best;
        facing = true;
        break;
      }
      if (was >= 0 && columns[was].access === kind && this.holds(was, row, px, pz)) {
        engaged = was;
        depth = frame.depth;
        break;
      }
    }
    if (facing) {
      if (was < 0 || columns[was].unitIndex !== columns[engaged].unitIndex) this.forkLevel = 0;
    } else if (engaged < 0) this.forkLevel = 0;
    this.engaged = engaged;
    this.facing = facing;
    if (engaged >= 0) this.forkLevel = clamp(this.forkLevel, 0, columns[engaged].levels - 1);
    const row = engaged >= 0 ? STORAGE_ACCESS[columns[engaged].access] : null;
    const carrying = this.carriedIndex >= 0;
    // The forks act on the column only once they stand at its selected level (the tines / the load fit its opening).
    const atLevel = Math.abs(f.forkHeight - this.forkLevel) <= LOAD_PASS_CLEARANCE;
    const acting = row !== null && (facing || row.actsHeld) && atLevel;
    aim.column = row !== null && acting && depth >= row.pickReach ? engaged : -1;
    aim.level = this.forkLevel;
    aim.reach = row !== null && aim.column >= 0 && depth >= row.dropReach;
    // The load at the column's face while the forks go to the selected level (not up to a floor stack it is over): no
    // drop.
    const travel = row !== null && facing && depth >= row.dropReach && carrying && !atLevel && this.clearLevel(true) <= this.forkLevel;
    // The load in a dock door with the forks not through it at the level chosen (the column not aimed): no drop either.
    const doorway = row !== null && row.doorway && aim.column < 0 && this.loadInOpening();
    aim.blocked = travel || doorway;
  }

  /** The rig is still at storage column `c` (its access's looser hold margins around facing it). */
  private holds(c: number, row: StorageAccessRow, px: number, pz: number): boolean {
    const f = this.snapshot.forklift;
    if (Math.abs(angleDelta(f.heading, this.columnHeadings[c])) > row.holdAngle || (row.bodyInLine && !this.inLineWith(c))) return false;
    const frame = columnFrame(this.columnCenters[c], this.grid.columns[c].facing, px, pz, this.frame);
    return Math.abs(frame.lateral) <= row.holdLateral && frame.depth >= -row.holdNear && frame.depth <= row.faceFar;
  }

  /**
   * The body is in line with storage column `c`'s front cell: on it or straight behind it (loaded from the south or
   * the north: the same map column x; from the east or the west: the same row z).
   */
  private inLineWith(c: number): boolean {
    const column = this.grid.columns[c];
    const p = this.snapshot.forklift.pos;
    return FACING_X[column.facing] === 0
      ? Math.floor(p.x + this.grid.width / 2) === column.front.x
      : Math.floor(p.z + this.grid.depth / 2) === column.front.z;
  }

  /**
   * Levels with storage: which storage columns' openings the carried load may pass (CollisionWorld.setOpen), by access.
   * `front` (a rack column): the aimed column opens once the forks stand at the selected level and that slot is empty,
   * and stays open while the load is in its cell at that level (it never turns solid around the load: the level is
   * locked once the load is in, and a load only just reaching into a column that closes is eased out, see
   * closeOpening); every other column blocks the load like a shelf. Inside, the load meets the slot's back panel and side
   * uprights, so it goes in and out straight. The body never enters. `door` (a truck column): the column the rig faces
   * (in line with its door cell) opens its span of the door and stays open while the load reaches into it (it never
   * shuts around the load: the heading holds once the load is in, so it only ever leaves straight back out); every other
   * span stays shut like the wall. So a load turned on a door cell meets the door like the wall until the rig faces the
   * column in line with its body, and it never slides along a wide door into the next column (as in the solver's
   * model: a column is loaded from its own door cell, facing the wall). Empty tines open nothing (they meet nothing).
   */
  private refreshStoragePassage(): void {
    const columns = this.grid.columns;
    if (columns.length === 0) return;
    const world = this.world;
    const open = this.openLevels;
    const load = this.carriedIndex >= 0 ? this.snapshot.boxes[this.carriedIndex].pos : null;
    const r = this.config.forklift.carriedBoxRadius;
    const aim = this.aim;
    const forkHeight = this.snapshot.forklift.forkHeight;
    for (let c = 0; c < columns.length; c++) {
      if (columns[c].access === 'door') {
        let opens = false;
        if (load) {
          opens = c === this.engaged && this.facing;
          if (!opens && world.isOpen(c)) {
            const span = world.opening(c);
            opens = pointRectDistance(load.x, load.z, span.minX, span.minZ, span.maxX, span.maxZ) < r;
          }
        }
        world.setOpen(c, opens);
        continue;
      }
      if (!load) {
        this.closeOpening(c);
        continue;
      }
      let level = -1;
      if (c === aim.column && this.grid.slotBox(this.grid.slotOf(c, aim.level)) < 0) level = aim.level;
      else if (open[c] >= 0 && Math.abs(forkHeight - open[c]) <= LOAD_PASS_CLEARANCE) {
        const cell = world.opening(c);
        if (pointRectDistance(load.x, load.z, cell.minX, cell.minZ, cell.maxX, cell.maxZ) < r + LOAD_NEAR_MARGIN) level = open[c];
      }
      if (level < 0) this.closeOpening(c);
      else {
        open[c] = level;
        world.setOpen(c, true);
      }
    }
  }

  /**
   * Close front storage column `c` for the carried load. A load already reaching into its cell (a level step or the
   * forks leaving just as it went in) is eased out of it (CollisionWorld.soften) instead of popping out in one frame.
   */
  private closeOpening(c: number): void {
    const world = this.world;
    if (this.carriedIndex >= 0 && world.isOpen(c)) {
      const load = this.snapshot.boxes[this.carriedIndex].pos;
      world.soften(c, load.x, load.z, this.config.forklift.carriedBoxRadius);
    }
    world.setOpen(c, false);
    this.openLevels[c] = -1;
  }

  /**
   * The carried load is inside the opening of the storage column the rig works at (docs/STORAGE.md «Acceso», rumbo
   * fijo): that opening is open for it and the load's leading edge is INSIDE_MARGIN past its face (depth 0 of the
   * column's frame: a rack slot's front face, a dock's wall line). One measure for every access, read live: the heading
   * holds, so the rig goes in and out straight; a load in a rack slot keeps its level (it cannot pass a board); a load in
   * a dock door short of the reach drops nothing (the doorway). Empty tines never count (they meet nothing).
   */
  private loadInOpening(): boolean {
    const c = this.engaged;
    if (this.carriedIndex < 0 || c < 0 || !this.world.isOpen(c)) return false;
    const load = this.snapshot.boxes[this.carriedIndex].pos;
    const frame = columnFrame(this.columnCenters[c], this.grid.columns[c].facing, load.x, load.z, this.frame);
    return frame.depth > INSIDE_MARGIN - this.config.forklift.carriedBoxRadius;
  }

  /**
   * The move counter (snapshot.moves, the solver's «movimientos»): the box just put down is one more box move, unless
   * it landed exactly where it was picked up (same cell and height, same storage slot), which changes nothing.
   */
  private countMove(box: BoxState): void {
    const o = this.origin;
    const cell = box.cell;
    const back = cell !== null && cell.x === o.x && cell.z === o.z && box.level === o.level && box.slotId === o.slotId;
    if (!back) this.snapshot.moves++;
  }

  /**
   * F / V, wheel, gamepad X / B: one level up or down at the storage column the rig works at, any unit (hint.storage:
   * not while it lifts a floor box there), never through a board (a load inside a rack slot keeps its level) and never
   * down into the boxes of a stack (a truck bed) the load is over.
   */
  private stepForkLevel(step: -1 | 1): void {
    const engaged = this.engaged;
    if (engaged < 0 || !this.atColumn()) return;
    if (this.grid.columns[engaged].support === 'shelves' && this.loadInOpening()) return;
    const level = clamp(this.forkLevel + step, 0, this.grid.columns[engaged].levels - 1);
    if (level === this.forkLevel || this.sinksIntoStack(engaged, level)) return;
    this.forkLevel = level;
    // A rack slot open for the load at the old level closes now, before the rig moves (a load just reaching in is eased
    // out). A dock door stays open: it is the way into the whole column, at any level (refreshStoragePassage).
    if (this.grid.columns[engaged].access === 'front') this.closeOpening(engaged);
  }

  /** The rig works at a storage column (it shows in hint.storage): the forks follow the level selected there. */
  private atColumn(): boolean {
    return this.engaged >= 0 && this.snapshot.hint.storage !== null;
  }

  /**
   * Forks set to `level` at stack column `c` (a truck bed) would take the carried load down into the boxes it is over or
   * against (its drawn square or its collider on the column's stack, lower than its top): lifted off them, or brought
   * in at their height.
   */
  private sinksIntoStack(c: number, level: number): boolean {
    const column = this.grid.columns[c];
    if (column.support !== 'stack' || this.carriedIndex < 0) return false;
    const { x, z } = column.cell;
    const base = this.grid.baseAt(x, z);
    if (base < 0 || level >= this.grid.height(x, z)) return false;
    const { boxes, forklift } = this.snapshot;
    const load = boxes[this.carriedIndex].pos;
    return this.loadNear(load.x, load.z, forklift.heading, boxes[base].pos, true);
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
    for (const slot of this.snapshot.storageSlots) if (slot.satisfied) satisfied++;
    progress.satisfied = satisfied;
    return progress;
  }

  private refreshHint(): void {
    const snap = this.snapshot;
    const hint = snap.hint;
    hint.targetBoxId = null;
    hint.dropLevel = 0;
    hint.storage = null;
    if (snap.completed) {
      hint.dropCell = null;
      hint.dropZoneId = null;
      return;
    }
    this.refreshStorageAim();
    if (this.carriedIndex < 0) {
      const target = this.interaction.findPickTarget();
      hint.targetBoxId = target >= 0 ? snap.boxes[target].id : null;
      this.pickLevel = target >= 0 ? snap.boxes[target].level : 0;
      hint.dropCell = null;
      hint.dropZoneId = null;
      // A floor box targeted at a storage column is lifted as anywhere else: no level chosen, automatic height.
      if (target < 0 || snap.boxes[target].slotId !== null) this.fillStorageHint(target >= 0);
      return;
    }
    const drop = this.drop;
    if (!this.interaction.findDrop(snap.boxes[this.carriedIndex], drop)) {
      hint.dropCell = null;
      hint.dropZoneId = null;
      this.fillStorageHint(false);
      return;
    }
    this.fillStorageHint(drop.column >= 0);
    hint.dropLevel = drop.level;
    // Keep the same object while the cell is unchanged (cheap identity checks for consumers, no churn).
    const cell = hint.dropCell;
    if (!cell || cell.x !== drop.x || cell.z !== drop.z) hint.dropCell = { x: drop.x, z: drop.z };
    hint.dropZoneId = drop.zoneIndex >= 0 ? snap.zones[drop.zoneIndex].id : null;
  }

  /**
   * hint.storage while the rig is at a storage column (any unit) and not lifting a floor box there (null otherwise):
   * the level chosen there; `ready` = the action works on it.
   */
  private fillStorageHint(ready: boolean): void {
    const engaged = this.engaged;
    if (engaged < 0) return;
    const column = this.grid.columns[engaged];
    const level = this.forkLevel;
    const h = this.storageHint;
    h.unitId = column.unitId;
    h.skin = column.skin;
    h.column = column.column;
    h.levels = column.levels;
    h.level = level;
    h.slotId = this.snapshot.storageSlots[column.firstSlot + level].id;
    h.ready = ready;
    this.snapshot.hint.storage = h;
  }

  /**
   * Zone state derived from its stack: satisfied iff it holds exactly what it asks for (a bottom box it accepts, then
   * its recipe's colors: core/sorting `fitsLevel`); `next` = the color it takes next while the stack is a correct,
   * unfinished prefix. Boxes on it are `correct` up to the first box that does not fit. Levels with storage: only its
   * destined kind fits its bottom (and its recipe is one box), and while it is satisfied that box is locked there
   * (done: never picked up again, nothing stacked on it). Levels without storage never lock a box.
   */
  private refreshZone(zone: ZoneState): void {
    const boxes = this.snapshot.boxes;
    const recipe = zone.recipe;
    const destined = zone.destined;
    let prefix = true;
    for (let i = 0; i < zone.stack.length; i++) {
      const box = boxes[this.boxIndex.get(zone.stack[i]) ?? -1];
      if (!box) continue;
      prefix = prefix && (i === 0 && destined !== null ? sameKind(destined, box) : fitsLevel(zone, i, box));
      box.correct = prefix;
      if (destined !== null) box.locked = false;
    }
    const n = zone.stack.length;
    zone.occupiedBy = n > 0 ? zone.stack[n - 1] : null;
    zone.satisfied = prefix && n === recipe.length;
    zone.next = prefix && n < recipe.length ? recipe[n] : null;
    if (destined !== null && zone.satisfied) {
      const box = boxes[this.boxIndex.get(zone.stack[0]) ?? -1];
      if (box) box.locked = true;
    }
  }

  /**
   * Stacking levels: which stack bases the carried load may pass over (CollisionWorld passable). A stack with room
   * opens once the forks are nearly at its top and stays open while the load is over it (the forks hold there, see
   * clearLevel), so it never turns solid under the load: no push-out. Until then it blocks the load like any box.
   * A locked box (levels with storage) has no room: it never opens, only stays open while a load lifted off it is still
   * over it; in a stack column (a truck bed) a locked box is a stack like any other (the next level loads on it), the
   * room is its column's levels and the forks reach its top only when F / V set them there (a load carried lower meets
   * its boxes, as a rack's face). Classic levels: never.
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
      const stacked = grid.isStackColumn(cell.x, cell.z);
      const high = forklift.forkHeight >= h - LOAD_PASS_CLEARANCE;
      const over = load !== null && this.world.isPassable(i) && this.loadNear(load.x, load.z, forklift.heading, b.pos, true);
      this.world.setPassable(i, h < grid.capacity(cell.x, cell.z) && ((high && (stacked || !b.locked)) || over));
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
      // At a storage column (hint.storage) the forks go to the selected level, never into a floor stack the load or the
      // empty forks are at; a floor box targeted there leaves hint.storage null and is lifted at its level, as anywhere
      // else.
      if (this.atColumn()) target = Math.max(this.forkLevel, this.clearLevel(this.carriedIndex >= 0));
      else if (this.carriedIndex >= 0) target = Math.max(snap.hint.dropCell ? snap.hint.dropLevel : 0, this.clearLevel(true));
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
   * Stacking levels: the lowest carriage height that meets no floor stack. Carrying: the height of the tallest stack
   * with room the load is over (never sink into it), or will run into before the forks could climb to it at the rig's
   * current motion and throttle (driving or turning; also when held at its face), so it is lifted in time to clear
   * the stack instead of stopping there (a locked box has no room: the load meets it like a full stack, unless it is
   * still over it). Empty: the top box of a stack the forks are at or reaching the same way. A storage stack (a truck
   * bed) never lifts the forks ahead of time: its level is chosen with F / V (docs/STORAGE.md rule 9), so a load
   * carried too low meets its boxes; only a load already over them keeps their height (it never sinks into them).
   */
  private clearLevel(carrying: boolean): number {
    const grid = this.grid;
    const limit = grid.stackLimit;
    if (limit <= 1) return 0;
    const { boxes, forklift } = this.snapshot;
    const m = this.motion;
    const reach = this.config.forklift.forkReach;
    const fork = this.forkProbe;
    const forkX = forklift.pos.x + Math.sin(forklift.heading) * reach;
    const forkZ = forklift.pos.z + Math.cos(forklift.heading) * reach;
    let level = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const cell = b.cell;
      if (!cell || b.level > 0) continue;
      const h = grid.height(cell.x, cell.z);
      if (grid.isStackColumn(cell.x, cell.z)) {
        if (carrying && h > level && this.world.isPassable(i) && this.loadNear(forkX, forkZ, forklift.heading, b.pos, true)) level = h;
        continue;
      }
      const room = h < grid.capacity(cell.x, cell.z);
      const top = carrying ? (room && (!b.locked || this.world.isPassable(i)) ? h : 0) : h - 1;
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
