import { angleDelta, approach, clamp, degToRad, wrapAngle } from '../core/math';
import {
  cellToWorld,
  type BoxState,
  type ForkliftState,
  type GameEvent,
  type GameSnapshot,
  type InputFrame,
  type LevelData,
  type RackHint,
  type SlotState,
  type TruckSlotState,
  type Vec2,
  type ZoneState,
} from '../core/types';
import { criteriaOf, cueOf, fitsLevel, levelDestinies, sameKind, symbolOf } from '../core/sorting';
import { FACING_X, columnFrame, inwardHeading, slotsOf } from '../core/racks';
import { hasTrucks, truckSlotsOf, usesTargetRules } from '../core/docks';
import { GAME_CONFIG, type GameConfig } from '../config';
import { CollisionWorld, pointRectDistance } from './collision';
import { forkRiseRate } from './forkRise';
import { ForkliftController, MOVE_EPSILON } from './forklift';
import { LevelGrid } from './grid';
import { createDropChoice, createRackAim, Interaction, type DropChoice, type RackAim } from './interaction';

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

// Storage racks (docs/RACKS.md). Classic, stacking and sorting levels never use these.
/** Facing a rack column: heading within this (rad) of straight into the rack… */
export const RACK_FACE_ANGLE = degToRad(30);
/** …the fork point within this (u) of the column's centre line… */
export const RACK_FACE_LATERAL = 0.35;
/** …and between this far (u) in front of the rack face and RACK_FACE_FAR into it. */
export const RACK_FACE_NEAR = 0.8;
const RACK_FACE_FAR = 1;
/**
 * Once facing a column, the rig stays at it (slot level kept, forks held there) until it turns, slides or backs
 * further away than these: small wobbles never drop the forks.
 */
const RACK_HOLD_ANGLE = degToRad(50);
const RACK_HOLD_LATERAL = 0.75;
const RACK_HOLD_NEAR = 1.3;
/**
 * Carrying: the box goes into the faced slot once the fork point is within this (u) of the rack face (a load resting
 * against the face stands carriedBoxRadius = 0.46 in front of it).
 */
export const RACK_DROP_REACH = 0.55;
/** The load counts as inside an open slot (the level locked) once it is this far (u) past the rack face. */
const RACK_INSIDE_MARGIN = 0.05;

// Loading docks (docs/DOCKS.md). Levels without trucks never use these.
/**
 * Facing a truck bed column (loaded only through its door, from its door cell): the body in line with its door cell
 * (on it or straight behind it), heading within this (rad) of straight into the truck, the fork point within
 * TRUCK_FACE_LATERAL (u) of the column's centre line (half a cell: anywhere in front of it) and between
 * TRUCK_FACE_NEAR in front of the wall line (the bed's face) and TRUCK_FACE_FAR past it. Only then does the column's
 * span of the door open for the carried load (refreshDoorPassage).
 */
export const TRUCK_FACE_ANGLE = degToRad(30);
export const TRUCK_FACE_LATERAL = 0.5;
const TRUCK_FACE_NEAR = 0.8;
const TRUCK_FACE_FAR = 1;
/** Once facing a column the rig stays at it until it turns or slides further than these (no flicker at the edges). */
const TRUCK_HOLD_ANGLE = degToRad(45);
const TRUCK_HOLD_LATERAL = 0.6;
/**
 * Pick and drop act on the faced column only with the forks through its door: the fork point at least this far (u)
 * past the wall line, the load mostly on the bed (with the body against the wall it stands 0.5 in, at the bed's
 * centre; on the door cell's centre, 0.42). Short of it the load is in the doorway at most, where nothing can be
 * dropped (RackAim.doorway); further back the floor rules apply (a bed cell is never a floor drop).
 */
export const TRUCK_REACH = 0.3;

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
  /** Levels with racks: the rack column the forks work on (shared with Interaction) and the selection state. */
  private readonly aim: RackAim = createRackAim();
  /** Rack column the rig is at (facing it, or still within the hold margins), -1 = none: the forks follow `forkLevel`. */
  private engaged = -1;
  /** Facing `engaged` this frame (not merely held). */
  private facing = false;
  /** Selected slot level at the engaged column (F / V, wheel, gamepad X / B). */
  private forkLevel = 0;
  /** Carrying with the load gone into the engaged column's open slot: the selection is locked (it cannot pass a shelf board). */
  private loadInside = false;
  /**
   * The carried load is inside the engaged column's slot: the heading holds (it goes in and out straight). Empty
   * tines never lock it (they collide with nothing, as against shelves).
   */
  private forksInside = false;
  /** Per rack column: world centre of its cell and the heading that faces into it. */
  private readonly columnCenters: Vec2[] = [];
  private readonly columnHeadings: number[] = [];
  /** Scratch for core/racks columnFrame. */
  private readonly frame = { depth: 0, lateral: 0 };
  /** Per rack column: the slot level it was opened at for the load (-1 = closed). */
  private openLevels = new Int8Array(0);
  /** The hint's rack object, reused (hint.rack points at it or is null). */
  private readonly rackHint: RackHint = { rackId: '', column: 0, levels: 1, level: 0, slotId: '', ready: false };
  /** The level follows the target rules of docs/RACKS.md (it has racks or trucks: destinies, locks, soft buzz). */
  private readonly targetRules: boolean;
  /** Truck slots (docs/DOCKS.md), snapshot.truckSlots order; empty without trucks. */
  private readonly truckSlots: TruckSlotState[] = [];
  /** Per truck bed column: world centre of its bed cell (outside, past the wall) and the heading that faces into it. */
  private readonly truckCenters: Vec2[] = [];
  private readonly truckHeadings: number[] = [];
  /** Walls with a dock door (the carried load can only cross their line through one): north, west. */
  private readonly dockWalls = { north: false, west: false };
  /** Truck bed column the rig faces (or is still held at), -1 = none. */
  private truckEngaged = -1;
  /** Facing `truckEngaged` this frame (not merely held): its span of the door may open for the load. */
  private truckFacing = false;
  /**
   * Where the carried box was picked up (its cell, height and rack slot): a drop right back there is no move for
   * snapshot.moves (see countMove).
   */
  private readonly origin = { x: -1, z: -1, level: 0, slotId: null as string | null };

  constructor(level: LevelData, config: GameConfig = GAME_CONFIG) {
    this.config = config;
    const size = level.size;
    this.grid = new LevelGrid(level);
    this.targetRules = usesTargetRules(level);
    const trucks = hasTrucks(level);

    // Levels with racks or trucks: every zone, slot with a cue and truck slot has the one box kind the level's unique
    // solution gives it.
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
    const slots: SlotState[] = slotsOf(level).map((ref, i) => {
      const destined = destinies?.slots[i] ?? null;
      return {
        id: ref.id,
        rackId: ref.rack.id,
        column: ref.column,
        level: ref.level,
        cell: ref.cell,
        front: ref.front,
        facing: ref.rack.facing,
        pos: cellToWorld(ref.cell, size),
        accepts: cueOf(ref.rack.columns[ref.column][ref.level]),
        destined: destined ? { ...destined } : null,
        occupiedBy: null,
        satisfied: false,
      };
    });
    for (const column of this.grid.columns) {
      this.columnCenters.push(cellToWorld(column.cell, size));
      this.columnHeadings.push(inwardHeading(column.facing));
    }
    truckSlotsOf(level).forEach((ref, i) => {
      const destined = destinies?.trucks[i] ?? null;
      const facing = this.grid.truckColumns[this.grid.truckColumnAt(ref.cell.x, ref.cell.z)].facing;
      this.truckSlots.push({
        id: ref.id,
        truckId: ref.truck.id,
        column: ref.column,
        level: ref.level,
        cell: ref.cell,
        front: ref.front,
        wall: ref.truck.wall,
        facing,
        pos: cellToWorld(ref.cell, size),
        accepts: criteriaOf(ref.cue),
        destined: destined ? { ...destined } : null,
        occupiedBy: null,
        satisfied: false,
        loadable: false,
      });
    });
    for (const column of this.grid.truckColumns) {
      this.truckCenters.push(cellToWorld(column.cell, size));
      this.truckHeadings.push(inwardHeading(column.facing));
    }
    for (const truck of level.trucks ?? []) this.dockWalls[truck.wall] = true;
    this.openLevels = new Int8Array(this.grid.columns.length).fill(-1);
    const boxes: BoxState[] = level.boxes.map((b, i) => {
      const zi = this.grid.zoneAt(b.x, b.z);
      const zone = zi >= 0 ? zones[zi] : null;
      const column = this.grid.columnAt(b.x, b.z);
      const slot = column >= 0 && b.level !== undefined ? slots[this.grid.slotOf(column, b.level)] : null;
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
        // Levels with trucks only (every box gets the key; set by refreshTruckColumn below).
        ...(trucks ? { truckSlotId: null } : {}),
        correct: false,
        locked: false,
      };
    });
    for (const zone of zones) {
      for (const bi of this.grid.stackAt(zone.cell.x, zone.cell.z)) zone.stack.push(boxes[bi].id);
    }
    slots.forEach((slot, i) => {
      const bi = this.grid.slotBox(i);
      slot.occupiedBy = bi >= 0 ? boxes[bi].id : null;
    });
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
      slots,
      ...(trucks ? { truckSlots: this.truckSlots } : {}),
      hint: { targetBoxId: null, dropCell: null, dropZoneId: null, dropLevel: 0, rack: null, ...(trucks ? { dropTruckSlotId: null } : {}) },
      completed: false,
      progress: { satisfied: 0, total: zones.length + slots.filter((slot) => slot.accepts !== null).length + this.truckSlots.length },
      moves: 0,
    };
    for (const zone of zones) this.refreshZone(zone);
    for (const slot of slots) this.refreshSlot(slot);
    for (let c = 0; c < this.grid.truckColumns.length; c++) this.refreshTruckColumn(c);
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
    // Fork level steps only mean something in a level with racks (elsewhere F / V do nothing, as before).
    const forkStep = this.grid.columns.length === 0 ? 0 : input.forkStep === 1 ? 1 : input.forkStep === -1 ? -1 : 0;

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
    // A load inside a rack slot, or in a dock door (only ever the faced column's: seen at the end of last frame):
    // straight in or out only.
    if (this.grid.columns.length > 0 || this.grid.truckColumns.length > 0) this.driver.setHeadingLock(this.forksInside || this.loadInDoor());
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
    this.refreshRackPassage();
    this.refreshDoorPassage();
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
    const slot = box.slotId !== null ? this.slotOfBox(index) : -1;
    const bed = cell ? this.grid.truckColumnAt(cell.x, cell.z) : -1;
    const fromTruck = bed >= 0 ? this.truckSlots[this.grid.truckColumns[bed].firstSlot + fromLevel] : null;
    const truckWas = fromTruck !== null && fromTruck.satisfied;
    let released: ZoneState | null = null;
    let restored: ZoneState | null = null;
    let releasedSlot: SlotState | null = null;
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
    if (box.truckSlotId !== undefined) box.truckSlotId = null;
    box.correct = false;
    box.locked = false;
    if (slot >= 0) {
      // Out of a rack slot: the load starts inside the column's cell, which stays open for it while it backs out.
      const state = this.snapshot.slots[slot];
      const was = state.satisfied;
      this.grid.setSlotBox(slot, -1);
      this.refreshSlot(state);
      if (was) releasedSlot = state;
      if (this.engaged >= 0) {
        this.world.setRackOpen(this.engaged, true);
        this.openLevels[this.engaged] = state.level;
      }
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
      // Off a truck bed column (its top box, never a locked one): what is left below keeps its state, and its span of
      // the door opens for the load, which starts on the bed (it stays open while the load backs out through it).
      if (bed >= 0) {
        this.refreshTruckColumn(bed);
        this.world.setDoorOpen(bed, true);
      }
      // The load was just lifted off what is left of the stack: it stays over it (see refreshLoadPassage).
      this.world.setPassable(this.grid.baseAt(cell.x, cell.z), true);
    }
    forklift.carrying = box.id;
    this.carriedIndex = index;

    const fork = this.driver.forkPoint(box.pos);
    this.refreshLoadPassage();
    this.refreshRackPassage();
    this.driver.attachLoad(this.world.clearance(fork.x, fork.z, box.id, true));
    const progress = this.recountProgress();
    if (slot >= 0) this.emit({ type: 'boxPicked', boxId: box.id, fromZoneId, level: fromLevel, fromSlotId: this.snapshot.slots[slot].id });
    else if (fromTruck) this.emit({ type: 'boxPicked', boxId: box.id, fromZoneId, level: fromLevel, fromTruckSlotId: fromTruck.id });
    else this.emit({ type: 'boxPicked', boxId: box.id, fromZoneId, level: fromLevel });
    if (released) this.emit({ type: 'zoneReleased', zoneId: released.id, boxId: box.id });
    if (releasedSlot) this.emit({ type: 'zoneReleased', zoneId: null, boxId: box.id, slotId: releasedSlot.id });
    // Never today: a satisfied truck box is locked (docs/DOCKS.md rule 6). Kept for symmetry with rack slots.
    if (fromTruck && truckWas && !fromTruck.satisfied) this.emit({ type: 'zoneReleased', zoneId: null, boxId: box.id, truckSlotId: fromTruck.id });
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
    if (choice.slot >= 0) {
      this.dropInSlot(choice.slot);
      return;
    }
    if (choice.truck >= 0) {
      this.dropOnTruck(choice.truck);
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
    // Levels with racks or trucks: a zone that did not get its destined box (plain floor never is a target).
    if (zone !== null && !correct && this.targetRules) drop.wrongTarget = true;
    this.emit(drop);
    if (released && zone) this.emit({ type: 'zoneReleased', zoneId: zone.id, boxId: box.id });
    if (progress.satisfied === progress.total) {
      snap.completed = true;
      this.emit({ type: 'levelComplete' });
    }
  }

  /** The carried box goes into rack slot `slot` (flat index): the column the forks face, at the selected level. */
  private dropInSlot(slot: number): void {
    const snap = this.snapshot;
    const index = this.carriedIndex;
    const box = snap.boxes[index];
    const state = snap.slots[slot];
    box.carried = false;
    box.cell = { x: state.cell.x, z: state.cell.z };
    box.pos.x = state.pos.x;
    box.pos.z = state.pos.z;
    box.zoneId = null;
    box.slotId = state.id;
    box.level = state.level;
    this.grid.setSlotBox(slot, index);
    this.refreshSlot(state);
    snap.forklift.carrying = null;
    this.carriedIndex = -1;
    this.driver.detachLoad();
    this.refreshRackPassage();
    this.countMove(box);

    const progress = this.recountProgress();
    const drop: BoxDropped = {
      type: 'boxDropped',
      boxId: box.id,
      cell: { x: state.cell.x, z: state.cell.z },
      zoneId: null,
      level: state.level,
      correct: state.satisfied,
      recipeLength: state.accepts !== null ? 1 : 0,
      satisfiedCount: progress.satisfied,
      total: progress.total,
      slotId: state.id,
    };
    // A slot with a cue that did not get its destined box (a trap box that fits the cue too); «libre» slots never.
    if (state.accepts !== null && !state.satisfied) drop.wrongTarget = true;
    this.emit(drop);
    if (progress.satisfied === progress.total) {
      snap.completed = true;
      this.emit({ type: 'levelComplete' });
    }
  }

  /**
   * The carried box is loaded onto truck bed column `column` (LevelGrid.truckColumns), on top of its stack, like a
   * floor stack (docs/DOCKS.md): it lands on the bed cell beyond the door (the forks already stand over it). Its level
   * is satisfied only with its destined box on satisfied levels below; any other drop there is a wrong target (soft
   * buzz) and the box stays pickable.
   */
  private dropOnTruck(column: number): void {
    const snap = this.snapshot;
    const index = this.carriedIndex;
    const box = snap.boxes[index];
    const { cell, firstSlot } = this.grid.truckColumns[column];
    box.carried = false;
    box.cell = { x: cell.x, z: cell.z };
    box.pos.x = cell.x + 0.5 - snap.level.size.width / 2;
    box.pos.z = cell.z + 0.5 - snap.level.size.depth / 2;
    box.zoneId = null;
    box.level = this.grid.pushBox(cell.x, cell.z, index);
    this.refreshTruckColumn(column);
    const state = this.truckSlots[firstSlot + box.level];
    snap.forklift.carrying = null;
    this.carriedIndex = -1;
    this.driver.detachLoad();
    this.refreshLoadPassage();
    this.countMove(box);

    const progress = this.recountProgress();
    const drop: BoxDropped = {
      type: 'boxDropped',
      boxId: box.id,
      cell: { x: cell.x, z: cell.z },
      zoneId: null,
      level: box.level,
      correct: state.satisfied,
      recipeLength: 1,
      satisfiedCount: progress.satisfied,
      total: progress.total,
      truckSlotId: state.id,
    };
    // Not its destiny, or on a level below that is not satisfied (docs/DOCKS.md rule 7).
    if (!state.satisfied) drop.wrongTarget = true;
    this.emit(drop);
    if (progress.satisfied === progress.total) {
      snap.completed = true;
      this.emit({ type: 'levelComplete' });
    }
  }

  /**
   * Truck bed column state from its stack, bottom → top (docs/DOCKS.md): a level is satisfied with its destined box
   * on satisfied levels only; its box is then locked (never lifted again, but the next level still loads on top of
   * it). `loadable` = the lowest empty level, with every level below satisfied.
   */
  private refreshTruckColumn(column: number): void {
    const { cell, levels, firstSlot } = this.grid.truckColumns[column];
    const stack = this.grid.stackAt(cell.x, cell.z);
    const boxes = this.snapshot.boxes;
    let right = true;
    for (let level = 0; level < levels; level++) {
      const slot = this.truckSlots[firstSlot + level];
      const box = level < stack.length ? boxes[stack[level]] : null;
      slot.occupiedBy = box ? box.id : null;
      slot.satisfied = right && box !== null && slot.destined !== null && sameKind(slot.destined, box);
      slot.loadable = right && level === stack.length;
      if (box) {
        box.truckSlotId = slot.id;
        box.correct = slot.satisfied;
        box.locked = slot.satisfied;
      }
      right = slot.satisfied;
    }
  }

  /**
   * Levels with trucks: which truck bed column the rig works at (docs/DOCKS.md: loaded only through its door, from its
   * door cell facing the wall). Facing one (the body in line with its door cell, heading, fork point in front of it,
   * near the wall line) engages it; it holds within slightly looser margins (the body still in line) so a small wobble
   * does not flicker the hint. RackAim.truck is that column once the forks are through the door (the fork point
   * TRUCK_REACH past the wall line: the body then stands on its door cell), so a column is never worked from the door
   * cell beside it; never while the rig works at a storage rack. RackAim.doorway: carrying with the load in a door short
   * of that, where nothing can be dropped.
   */
  private refreshTruckAim(): void {
    const columns = this.grid.truckColumns;
    if (columns.length === 0) return;
    const f = this.snapshot.forklift;
    const reach = this.config.forklift.forkReach;
    const px = f.pos.x + Math.sin(f.heading) * reach;
    const pz = f.pos.z + Math.cos(f.heading) * reach;
    const frame = this.frame;
    let best = -1;
    let bestScore = Infinity;
    let bestDepth = 0;
    let facing = false;
    if (this.engaged < 0) {
      for (let c = 0; c < columns.length; c++) {
        if (Math.abs(angleDelta(f.heading, this.truckHeadings[c])) > TRUCK_FACE_ANGLE || !this.inLineWith(c)) continue;
        columnFrame(this.truckCenters[c], columns[c].facing, px, pz, frame);
        if (Math.abs(frame.lateral) > TRUCK_FACE_LATERAL || frame.depth < -TRUCK_FACE_NEAR || frame.depth > TRUCK_FACE_FAR) continue;
        const score = Math.abs(frame.lateral) + Math.abs(frame.depth);
        if (score < bestScore) {
          best = c;
          bestScore = score;
          bestDepth = frame.depth;
        }
      }
      facing = best >= 0;
      const was = this.truckEngaged;
      if (best < 0 && was >= 0 && Math.abs(angleDelta(f.heading, this.truckHeadings[was])) <= TRUCK_HOLD_ANGLE && this.inLineWith(was)) {
        columnFrame(this.truckCenters[was], columns[was].facing, px, pz, frame);
        if (Math.abs(frame.lateral) <= TRUCK_HOLD_LATERAL && frame.depth >= -TRUCK_FACE_NEAR && frame.depth <= TRUCK_FACE_FAR) {
          best = was;
          bestDepth = frame.depth;
        }
      }
    }
    this.truckEngaged = best;
    this.truckFacing = facing;
    this.aim.truck = best >= 0 && bestDepth >= TRUCK_REACH ? best : -1;
    this.aim.doorway = this.aim.truck < 0 && this.loadInDoor();
  }

  /**
   * The body is in line with truck bed column `c`'s door cell: on it or straight behind it (a north dock: the same map
   * column x; a west dock: the same row z).
   */
  private inLineWith(c: number): boolean {
    const column = this.grid.truckColumns[c];
    const p = this.snapshot.forklift.pos;
    return FACING_X[column.facing] === 0
      ? Math.floor(p.x + this.grid.width / 2) === column.front.x
      : Math.floor(p.z + this.grid.depth / 2) === column.front.z;
  }

  /**
   * Levels with trucks: which bed columns' spans of their doors the carried load may pass (CollisionWorld.setDoorOpen).
   * The column the rig faces (truckFacing: in line with its door cell, within TRUCK_FACE_ANGLE) opens, like a rack
   * column, and stays open while the load reaches into its span (it never shuts around the load: the heading holds
   * once the load is in, so it only ever leaves straight back out); every other span stays shut like the wall. So a
   * load turned on a door cell meets the door like the wall until the rig faces the column in line with its body, and
   * it never slides along a wide door into the next column (as in the solver's model: a column is loaded from its own
   * door cell, facing the wall). Empty tines open nothing (they meet nothing).
   */
  private refreshDoorPassage(): void {
    const columns = this.grid.truckColumns;
    if (columns.length === 0) return;
    const world = this.world;
    const load = this.carriedIndex >= 0 ? this.snapshot.boxes[this.carriedIndex].pos : null;
    const r = this.config.forklift.carriedBoxRadius;
    for (let c = 0; c < columns.length; c++) {
      let open = false;
      if (load) {
        open = c === this.truckEngaged && this.truckFacing;
        if (!open && world.isDoorOpen(c)) {
          const span = world.doorCell(c);
          open = pointRectDistance(load.x, load.z, span.minX, span.minZ, span.maxX, span.maxZ) < r;
        }
      }
      world.setDoorOpen(c, open);
    }
  }

  /**
   * Levels with trucks: the carried load has crossed a dock wall's line (by RACK_INSIDE_MARGIN; the walls only let it
   * through the open span of the door of the column the rig faces, see refreshDoorPassage), so it is in that door or
   * on the bed beyond: the heading holds and the rig goes in and out straight, as with a load in a rack slot; nothing
   * is dropped short of the bed (RackAim.doorway). Empty tines never count (they meet nothing).
   */
  private loadInDoor(): boolean {
    if (this.carriedIndex < 0 || this.grid.truckColumns.length === 0) return false;
    const load = this.snapshot.boxes[this.carriedIndex].pos;
    const edge = this.config.forklift.carriedBoxRadius - RACK_INSIDE_MARGIN;
    return (
      (this.dockWalls.north && load.z - edge < -this.grid.depth / 2) || (this.dockWalls.west && load.x - edge < -this.grid.width / 2)
    );
  }

  /**
   * The move counter (snapshot.moves, the solver's «movimientos»): the box just put down is one more box move, unless
   * it landed exactly where it was picked up (same cell and height, same rack slot; a truck level is its bed cell and
   * height), which changes nothing.
   */
  private countMove(box: BoxState): void {
    const o = this.origin;
    const cell = box.cell;
    const back = cell !== null && cell.x === o.x && cell.z === o.z && box.level === o.level && box.slotId === o.slotId;
    if (!back) this.snapshot.moves++;
  }

  /** Flat slot index of a box resting in a rack, or -1. */
  private slotOfBox(index: number): number {
    const box = this.snapshot.boxes[index];
    const cell = box.cell;
    if (!cell || box.slotId === null) return -1;
    return this.grid.slotOf(this.grid.columnAt(cell.x, cell.z), box.level);
  }

  /**
   * F / V, wheel, gamepad X / B: one slot level up or down at the rack column the rig works at (hint.rack: not while
   * it lifts a floor box there), never through a board.
   */
  private stepForkLevel(step: -1 | 1): void {
    const engaged = this.engaged;
    if (engaged < 0 || this.snapshot.hint.rack === null || this.loadInside) return;
    const level = clamp(this.forkLevel + step, 0, this.grid.columns[engaged].levels - 1);
    if (level === this.forkLevel) return;
    this.forkLevel = level;
    // Open for the load at the old level: it closes now, before the rig moves (a load just reaching in is eased out).
    this.closeRack(engaged);
  }

  /**
   * Levels with racks: which rack column the rig works at. Facing one (heading, fork point beside its centre line and
   * near its face) engages it; an engaged column holds (keeping the selected level, so the forks stay up) until the rig
   * leaves looser margins, then the selection resets to the bottom slot and the forks go back to automatic. Arriving
   * at another rack starts at its bottom slot; sliding along the same rack keeps the level.
   */
  private refreshRackAim(): void {
    const aim = this.aim;
    const columns = this.grid.columns;
    if (columns.length === 0) return;
    const f = this.snapshot.forklift;
    const reach = this.config.forklift.forkReach;
    const px = f.pos.x + Math.sin(f.heading) * reach;
    const pz = f.pos.z + Math.cos(f.heading) * reach;
    const frame = this.frame;
    let best = -1;
    let bestScore = Infinity;
    let bestDepth = 0;
    for (let c = 0; c < columns.length; c++) {
      if (Math.abs(angleDelta(f.heading, this.columnHeadings[c])) > RACK_FACE_ANGLE) continue;
      columnFrame(this.columnCenters[c], columns[c].facing, px, pz, frame);
      if (Math.abs(frame.lateral) > RACK_FACE_LATERAL || frame.depth < -RACK_FACE_NEAR || frame.depth > RACK_FACE_FAR) continue;
      const score = Math.abs(frame.lateral) + Math.abs(frame.depth);
      if (score < bestScore) {
        best = c;
        bestScore = score;
        bestDepth = frame.depth;
      }
    }
    const was = this.engaged;
    if (best >= 0) {
      if (was < 0 || columns[was].rackIndex !== columns[best].rackIndex) this.forkLevel = 0;
      this.engaged = best;
      this.facing = true;
    } else if (was >= 0 && this.holds(was, px, pz)) {
      this.facing = false;
      columnFrame(this.columnCenters[was], columns[was].facing, px, pz, frame);
      bestDepth = frame.depth;
    } else {
      this.engaged = -1;
      this.facing = false;
      this.forkLevel = 0;
    }
    const engaged = this.engaged;
    if (engaged >= 0) this.forkLevel = clamp(this.forkLevel, 0, columns[engaged].levels - 1);
    const carrying = this.carriedIndex >= 0;
    // The load has gone into the open slot (past resting against a closed face).
    this.loadInside =
      engaged >= 0 && carrying && this.world.isRackOpen(engaged) && bestDepth > RACK_INSIDE_MARGIN - this.config.forklift.carriedBoxRadius;
    this.forksInside = this.loadInside;
    // Pick and drop act on the slot only once the forks stand at its level (the tines / the load fit its opening).
    const atLevel = Math.abs(f.forkHeight - this.forkLevel) <= LOAD_PASS_CLEARANCE;
    const within = engaged >= 0 && this.facing && bestDepth >= -RACK_DROP_REACH;
    aim.column = engaged >= 0 && this.facing && atLevel ? engaged : -1;
    aim.level = this.forkLevel;
    aim.reach = aim.column >= 0 && within;
    // The load at the face while the forks go to the selected level (not up to a floor stack it is over): no drop.
    aim.travel = within && carrying && !atLevel && this.clearLevel(true) <= this.forkLevel;
  }

  /** The rig is still at rack column `c` (the looser hold margins around facing it). */
  private holds(c: number, px: number, pz: number): boolean {
    const f = this.snapshot.forklift;
    if (Math.abs(angleDelta(f.heading, this.columnHeadings[c])) > RACK_HOLD_ANGLE) return false;
    const frame = columnFrame(this.columnCenters[c], this.grid.columns[c].facing, px, pz, this.frame);
    return Math.abs(frame.lateral) <= RACK_HOLD_LATERAL && frame.depth >= -RACK_HOLD_NEAR && frame.depth <= RACK_FACE_FAR;
  }

  /**
   * Levels with racks: which rack columns the carried load may enter (CollisionWorld.setRackOpen). The faced column
   * opens once the forks stand at the selected slot level and that slot is empty, and stays open while the load is in
   * its cell at that level (it never turns solid around the load: the level is locked once the load is in, and a load
   * only just reaching into a column that closes is eased out, see closeRack); every other column blocks the load like
   * a shelf. Inside, the load meets the slot's back panel and side uprights, so it goes in and out straight. The body
   * never enters.
   */
  private refreshRackPassage(): void {
    const columns = this.grid.columns;
    if (columns.length === 0) return;
    const world = this.world;
    const open = this.openLevels;
    if (this.carriedIndex < 0) {
      for (let c = 0; c < columns.length; c++) this.closeRack(c);
      return;
    }
    const load = this.snapshot.boxes[this.carriedIndex].pos;
    const r = this.config.forklift.carriedBoxRadius + LOAD_NEAR_MARGIN;
    const aim = this.aim;
    const forkHeight = this.snapshot.forklift.forkHeight;
    for (let c = 0; c < columns.length; c++) {
      let level = -1;
      if (c === aim.column && this.grid.slotBox(this.grid.slotOf(c, aim.level)) < 0) level = aim.level;
      else if (open[c] >= 0 && Math.abs(forkHeight - open[c]) <= LOAD_PASS_CLEARANCE) {
        const cell = world.rackCell(c);
        if (pointRectDistance(load.x, load.z, cell.minX, cell.minZ, cell.maxX, cell.maxZ) < r) level = open[c];
      }
      if (level < 0) this.closeRack(c);
      else {
        open[c] = level;
        world.setRackOpen(c, true);
      }
    }
  }

  /**
   * Close rack column `c` for the carried load. A load already reaching into its cell (a level step or the forks
   * leaving just as it went in) is eased out of it (CollisionWorld.softenRack) instead of popping out in one frame.
   */
  private closeRack(c: number): void {
    const world = this.world;
    if (this.carriedIndex >= 0 && world.isRackOpen(c)) {
      const load = this.snapshot.boxes[this.carriedIndex].pos;
      world.softenRack(c, load.x, load.z, this.config.forklift.carriedBoxRadius);
    }
    world.setRackOpen(c, false);
    this.openLevels[c] = -1;
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
    for (const slot of this.snapshot.slots) if (slot.satisfied) satisfied++;
    for (const slot of this.truckSlots) if (slot.satisfied) satisfied++;
    progress.satisfied = satisfied;
    return progress;
  }

  private refreshHint(): void {
    const snap = this.snapshot;
    const hint = snap.hint;
    hint.targetBoxId = null;
    hint.dropLevel = 0;
    hint.rack = null;
    if (hint.dropTruckSlotId !== undefined) hint.dropTruckSlotId = null;
    if (snap.completed) {
      hint.dropCell = null;
      hint.dropZoneId = null;
      return;
    }
    this.refreshRackAim();
    this.refreshTruckAim();
    if (this.carriedIndex < 0) {
      const target = this.interaction.findPickTarget();
      hint.targetBoxId = target >= 0 ? snap.boxes[target].id : null;
      this.pickLevel = target >= 0 ? snap.boxes[target].level : 0;
      hint.dropCell = null;
      hint.dropZoneId = null;
      // A floor box targeted at a rack column is lifted as anywhere else: no slot selected, automatic height.
      if (target < 0 || snap.boxes[target].slotId !== null) this.fillRackHint(target >= 0);
      return;
    }
    const drop = this.drop;
    if (!this.interaction.findDrop(snap.boxes[this.carriedIndex], drop)) {
      hint.dropCell = null;
      hint.dropZoneId = null;
      this.fillRackHint(false);
      return;
    }
    this.fillRackHint(drop.slot >= 0);
    hint.dropLevel = drop.level;
    // Keep the same object while the cell is unchanged (cheap identity checks for consumers, no churn).
    const cell = hint.dropCell;
    if (!cell || cell.x !== drop.x || cell.z !== drop.z) hint.dropCell = { x: drop.x, z: drop.z };
    hint.dropZoneId = drop.zoneIndex >= 0 ? snap.zones[drop.zoneIndex].id : null;
    if (drop.truck >= 0) hint.dropTruckSlotId = this.truckSlots[this.grid.truckColumns[drop.truck].firstSlot + drop.level].id;
  }

  /**
   * hint.rack while the rig is at a rack column and not lifting a floor box there (null otherwise); `ready` = the
   * action works on its selected slot.
   */
  private fillRackHint(ready: boolean): void {
    const engaged = this.engaged;
    if (engaged < 0) return;
    const column = this.grid.columns[engaged];
    const h = this.rackHint;
    h.rackId = column.rackId;
    h.column = column.column;
    h.levels = column.levels;
    h.level = this.forkLevel;
    h.slotId = this.snapshot.slots[column.firstSlot + this.forkLevel].id;
    h.ready = ready;
    this.snapshot.hint.rack = h;
  }

  /**
   * Slot state from its box: satisfied iff it holds its destined kind (a «libre» slot never is). Its destined box is
   * locked there: done, it can no longer be picked up.
   */
  private refreshSlot(slot: SlotState): void {
    const bi = this.grid.slotBox(this.snapshot.slots.indexOf(slot));
    const box = bi >= 0 ? this.snapshot.boxes[bi] : null;
    slot.occupiedBy = box ? box.id : null;
    slot.satisfied = box !== null && slot.destined !== null && sameKind(slot.destined, box);
    if (box) {
      box.correct = slot.satisfied;
      box.locked = slot.satisfied;
    }
  }

  /**
   * Zone state derived from its stack: satisfied iff it holds exactly what it asks for (a bottom box it accepts, then
   * its recipe's colors: core/sorting `fitsLevel`); `next` = the color it takes next while the stack is a correct,
   * unfinished prefix. Boxes on it are `correct` up to the first box that does not fit. Levels with racks: only its
   * destined kind fits its bottom (and its recipe is one box), and while it is satisfied that box is locked there
   * (done: never picked up again, nothing stacked on it). Levels without racks never lock a box.
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
   * A locked box (levels with racks) has no room: it never opens, only stays open while a load lifted off it is still
   * over it; on a truck bed a locked box is a stack like any other (the next level loads on it) and the room is its
   * column's levels. Classic levels: never.
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
      const bed = grid.truckColumnAt(cell.x, cell.z) >= 0;
      const high = forklift.forkHeight >= h - LOAD_PASS_CLEARANCE;
      const over = load !== null && this.world.isPassable(i) && this.loadNear(load.x, load.z, forklift.heading, b.pos, true);
      this.world.setPassable(i, h < grid.capacity(cell.x, cell.z) && ((high && (bed || !b.locked)) || over));
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
      // At a rack column (hint.rack) the forks go to the selected slot level, never into a stack the load or the empty
      // forks are at; a floor box targeted there leaves hint.rack null and is lifted at its level, as anywhere else.
      if (snap.hint.rack) target = Math.max(this.forkLevel, this.clearLevel(this.carriedIndex >= 0));
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
   * Stacking levels: the lowest carriage height that meets no stack. Carrying: the height of the tallest stack with
   * room the load is over (never sink into it), or will run into before the forks could climb to it at the rig's
   * current motion and throttle (driving or turning; also when held at its face), so it is lifted in time to clear
   * the stack instead of stopping there (a locked box has no room: the load meets it like a full stack, unless it is
   * still over it). Empty: the top box of a stack the forks are at or reaching the same way.
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
      const room = h < grid.capacity(cell.x, cell.z);
      const bed = grid.truckColumnAt(cell.x, cell.z) >= 0;
      const top = carrying ? (room && (bed || !b.locked || this.world.isPassable(i)) ? h : 0) : h - 1;
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

