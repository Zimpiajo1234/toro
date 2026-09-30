import { Box3, Color, Group, Mesh, MeshBasicMaterial, OctahedronGeometry, Vector3, type BufferGeometry, type Material } from 'three';
import type { GameConfig } from '../config';
import { dockRailsOf, hasTrucks, truckSlotIdOf, trucksOf, usesTargetRules } from '../core/docks';
import { degToRad } from '../core/math';
import { hasRacks, racksOf } from '../core/racks';
import { accepts, cueFits, takesNext, usesSymbols } from '../core/sorting';
import { STORAGE_SKINS } from '../core/storage';
import {
  COLOR_IDS,
  DEFAULT_SYMBOL,
  type BoxState,
  type CellPos,
  type ColorId,
  type GameEvent,
  type GameSnapshot,
  type LevelData,
  type StorageHint,
  type StorageSlotState,
  type Vec2,
  type WallSide,
  type ZoneCriteria,
  type ZoneState,
} from '../core/types';
import type { Theme } from '../themes/types';
import { buildBoxGeometry, type LidMark } from './builders/box';
import { addFloor } from './builders/floor';
import { buildForkliftGeometry } from './builders/forklift';
import { addPlant } from './builders/plant';
import {
  PANEL_HEIGHT,
  SLOT_GLOW,
  addRackLines,
  buildRackBays,
  buildSlotCue,
  buildSlotGlowGeometry,
  buildSlotMarkerGeometry,
  buildSlotPanel,
  cueEndSides,
  outwardYaw,
  type CueLook,
} from './builders/rack';
import { addShelf } from './builders/shelf';
import {
  TRUCK_BURST,
  buildDockPlate,
  buildDockRails,
  buildSignCue,
  buildSignFrame,
  buildSignGlowGeometry,
  buildSignPanel,
  buildTruckBody,
  dockColumnX,
  dockPlacement,
  dockToWorld,
  signCell,
  signMidZ,
  signRowY,
} from './builders/truck';
import { buildWallGeometry, toWallLocal, wallLayouts, type WallLayout } from './builders/walls';
import { buildHaloGeometry, buildOutlineGeometry, buildRecipeGeometry, buildZoneGeometry, type ZoneMark } from './builders/zone';
import type { FitBox } from './CameraRig';
import { DIORAMA, ZONE, boxDims, rackSlotY } from './dims';
import { GLYPH_SYMMETRY } from './glyphs';
import { createCueMaterial, createGlowMaterial, createOverlayMaterial, createSharedMaterials, type SharedMaterials } from './materials';
import { PartList } from './paint';
import { createRng } from './random';
import { ResourceBag } from './resources';
import { BoxView, DROP_GLIDE_SEC, lockTintOf } from './views/BoxView';
import { DropPreview } from './views/DropPreview';
import { ForkliftView } from './views/ForkliftView';
import { RackView, type RackBay, type SlotTone } from './views/RackView';
import { ShelfView, hidesBehind } from './views/ShelfView';
import { SlotMarker } from './views/SlotMarker';
import { RACK_SWAP_INVITE, SuccessBurst } from './views/success';
import { TruckView } from './views/TruckView';
import { WallView } from './views/WallView';
import { ZoneView } from './views/ZoneView';

/** Level-complete wave: first zone after the last drop has landed, then one every WAVE_STEP s. */
const WAVE_START_DELAY = 0.45;
const WAVE_STEP = 0.13;
/** Soft bounce-light lift on the back walls (their inner faces rarely face the sun). */
const WALL_BOUNCE = 0.3;
/**
 * Actor volumes a shelf must not hide (it ghosts instead): the forklift's cabin, the upper part of a
 * box (lid + glyph), the middle of a zone pad. Kept inside the silhouettes, so an edge or a bottom
 * corner tucked behind a shelf does not fade it.
 */
const FORKLIFT_HALF = 0.3;
const FORKLIFT_Y = [0.25, 1.0] as const;
const BOX_INSET = 0.12;
const BOX_VISIBLE_FROM = 0.4;
const ZONE_HALF = 0.3;
/**
 * Probes of the forklift cabin that a stacked box must not hide: tiny boxes CABIN_BACK behind the body center
 * (along the heading), at seat/driver height and at the roof.
 */
const CABIN_BACK = 0.1;
const CABIN_PROBE_HALF = 0.02;
const CABIN_PROBE_Y = [0.72, 1.0] as const;
/** Completed stack: each box glows in turn, bottom → top, starting once the last one has landed. */
const STACK_GLOW_START = 0.05;
const STACK_GLOW_STEP = 0.14;
/**
 * Sorting levels, while carrying a box no free zone takes: the occupied zones that accept it breathe this faintly
 * (share of the full invitation), a quiet "swap" hint. Never red, never text.
 */
const SWAP_INVITE = 0.32;
/** Drop preview inside a rack slot: the outline hugs the box between the uprights. */
const SLOT_PREVIEW_SCALE = 0.82;
/**
 * Levels with racks: success bursts kept ready (a drop plays one; two can overlap), their ring's line width, and how
 * much of the way from the box colour to white their sparkles are (the box's own colour, a touch lighter).
 */
const BURSTS = 2;
const BURST_RING_WIDTH = 0.05;
const SPARKLE_LIGHTEN = 0.08;

/** A tall piece of furniture that fades to a ghost while it hides an actor (wooden shelf or storage rack). */
interface Occluder {
  readonly bounds: Box3;
  /**
   * A storage rack bay: the whole rack's bounds. A box reaching into them is the rack's own (in one of its slots, or
   * the load going in or out) and never makes the bay ghost.
   */
  readonly holds?: Box3;
  /**
   * `hiding`: it covers an actor. `soft`: only resting boxes or zones (not the forklift or its load): a rack bay then
   * fades just a little (its cues never fade); a shelf ignores it.
   */
  sync(hiding: boolean, rank: number, dt: number, soft?: boolean): void;
}

const _actorMin = new Vector3();
const _actorMax = new Vector3();
const _back = new Vector3();

/**
 * Everything drawn for one level: static diorama (a few merged meshes), walls, zones, boxes,
 * forklift and the drop preview. Owns and disposes all of its GPU resources.
 */
export class LevelView {
  readonly root = new Group();
  readonly fitBoxes: FitBox[] = [];
  /** Volume that must receive shadows (floor, walls, props). */
  readonly shadowBounds = new Box3();
  /** Unit vector toward the sun (from the window side). */
  readonly toSun = new Vector3();

  private readonly bag = new ResourceBag();
  private readonly size: { width: number; depth: number };
  private readonly forklift: ForkliftView;
  private readonly boxViews = new Map<string, BoxView>();
  private readonly boxList: BoxView[] = [];
  private readonly zoneViews = new Map<string, ZoneView>();
  /** Zone border tone per color: the drop preview takes the carried box's on a zone that takes that box. */
  private readonly borders = new Map<ColorId, Color>();
  /** Zone glow tone per color: levels with racks light a zone in the box it is about (views/ZoneView). */
  private readonly glows = new Map<ColorId, Color>();
  /** …and a rack slot (views/RackView SlotTone: its band in the box colour, its panel in its glow). */
  private readonly slotTones = new Map<ColorId, SlotTone>();
  private readonly zoneStates = new Map<string, ZoneState>();
  /** Last seen `satisfied` per stack zone (recipe of 2+), to glow a completed stack bottom → top. */
  private readonly stackSatisfied = new Map<string, boolean>();
  /** Stack levels: upper stacked boxes may ghost when they hide the forklift, a box or a zone. */
  private readonly stacking: boolean;
  /**
   * The level sorts by symbol (docs/SORTING.md): pads show the symbol they ask for (engraved) instead of their color's
   * glyph, lids print their symbol large, and a carried box nobody free takes hints at a swap.
   */
  private readonly sorting: boolean;
  private readonly stackBox = new Box3();
  private readonly walls: WallView[] = [];
  /** Shelves and racks, in one list so overlapping ghosts are ranked together. */
  private readonly occluders: Occluder[] = [];
  /** Per-occluder scratch for update(): hides an actor now / distance toward the camera. */
  private readonly occluderHiding: boolean[] = [];
  private readonly occluderSoft: boolean[] = [];
  private readonly occluderDepth: number[] = [];
  /** Storage racks (docs/RACKS.md): their slots light only with the destined box and ghost with their rack. */
  private readonly racked: boolean;
  private readonly racks: RackView[] = [];
  private readonly rackOfSlot = new Map<string, RackView>();
  /** The bay (rack column) of each slot: its box ghosts with it. */
  private readonly bayOfSlot = new Map<string, RackBay>();
  /** The rack slots (the slot marker frames the selected one). */
  private readonly slotStates = new Map<string, StorageSlotState>();
  private readonly marker: SlotMarker | null = null;
  /**
   * Storage (docs/STORAGE.md): each slot's index in snapshot.storageSlots (the list never changes during a level), and
   * the ids of the slots on shelves (support `shelves`: a rack's), whose boxes rest on their shelf, ghost with their bay
   * and never dip with a stack; a box in any other slot (a stack: a truck bed) is a stack like the floor's.
   */
  private readonly slotIndex = new Map<string, number>();
  private readonly shelfSlots = new Set<string>();
  /**
   * Loading docks (docs/DOCKS.md): their truck levels light like rack slots, on the sign over each dock door.
   * `targetRules` = racks or trucks: destined boxes, locks, the flash and burst, the strong pulse (docs/RACKS.md).
   */
  private readonly trucked: boolean;
  private readonly targetRules: boolean;
  private readonly trucks: TruckView[] = [];
  /** The wall of each truck (order of `trucks`): its sign ghosts softly while that wall is sunk. */
  private readonly truckWalls: WallView[] = [];
  private readonly truckSides: WallSide[] = [];
  /**
   * Levels with trucks: the wall line (world x of the west wall, z of the north one) of each dock wall standing this
   * frame, −∞ for none. What lies beyond it (a box on a bed, the part of a load through the door) is hidden by that
   * wall, so it never makes a shelf, a rack or a stack ghost (clipToRoom).
   */
  private roomMinX = -Infinity;
  private roomMinZ = -Infinity;
  private readonly truckOfSlot = new Map<string, TruckView>();
  private readonly wallBySide = new Map<WallSide, { view: WallView; layout: WallLayout }>();
  /**
   * Levels with storage: the success bursts (pooled) and the sparkle tone of each box colour; last seen `satisfied` of
   * each zone and storage slot (snapshot order), so a target that just got its destined box plays one (never on load).
   */
  private readonly bursts: SuccessBurst[] = [];
  private nextBurst = 0;
  private readonly sparkleTones = new Map<ColorId, Color>();
  private readonly zoneWasSatisfied: boolean[] = [];
  private readonly slotWasSatisfied: boolean[] = [];
  private readonly depthOnly: MeshBasicMaterial;
  private readonly pitch: number;
  private readonly boxHalf: number;
  private readonly boxHeight: number;
  private readonly glassMaterial: MeshBasicMaterial;
  private readonly preview: DropPreview;
  /**
   * The optional target hints (setTargetHints; off by default): only with them on do the destinations light up for the
   * carried box (see update()).
   */
  private targetHints = false;

  constructor(snapshot: GameSnapshot, theme: Theme, config: GameConfig, cameraYaw: number) {
    const level = snapshot.level;
    this.size = { ...level.size };
    this.pitch = degToRad(config.camera.pitchDeg);
    const dims = boxDims(config);
    this.boxHalf = dims.size / 2 - BOX_INSET;
    this.boxHeight = dims.height;
    this.stacking = (level.stackLimit ?? 1) > 1;
    this.sorting = usesSymbols(level);
    this.racked = hasRacks(level);
    this.trucked = hasTrucks(level);
    this.targetRules = usesTargetRules(level);
    for (const c of COLOR_IDS) this.borders.set(c, new Color(theme.zones[c].border));
    for (const c of COLOR_IDS) this.glows.set(c, new Color(theme.zones[c].glow));
    for (const c of COLOR_IDS) this.slotTones.set(c, { band: new Color(theme.boxes[c].base), glow: this.glows.get(c)! });
    const mats = createSharedMaterials(this.bag);
    // Glass gets its own copy so level-complete warmth can tint it (each wall clones its shafts').
    this.glassMaterial = this.bag.track(mats.unlit.clone());
    // Depth-only prepass shared by every ghosting shelf and rack.
    this.depthOnly = this.bag.track(new MeshBasicMaterial({ colorWrite: false, transparent: true }));
    sunDirection(level, this.toSun);
    snapshot.storageSlots.forEach((slot, i) => {
      this.slotIndex.set(slot.id, i);
      this.slotWasSatisfied.push(slot.satisfied);
      if (STORAGE_SKINS[slot.skin].support === 'shelves') this.shelfSlots.add(slot.id);
    });

    this.buildStatic(level, theme, mats);
    this.buildWalls(level, theme, mats, cameraYaw);
    this.buildZones(snapshot, theme, mats);
    this.buildRacks(snapshot, theme, mats);
    this.buildTrucks(snapshot, theme, mats);
    this.buildBoxes(snapshot, theme, config);

    const fl = buildForkliftGeometry(theme, {
      wheelRadius: config.forklift.wheelRadius,
      forkReach: config.forklift.forkReach,
      boxSize: config.box.size,
    });
    for (const g of Object.values(fl)) this.bag.track(g);
    this.forklift = new ForkliftView(
      fl,
      mats,
      {
        maxSpeed: config.forklift.maxSpeed,
        wheelRadius: config.forklift.wheelRadius,
        forkReach: config.forklift.forkReach,
        stackStep: dims.height,
      },
      snapshot.forklift,
    );
    this.root.add(this.forklift.root);

    const outline = this.bag.track(buildOutlineGeometry(0.5, 0.045, 0.12));
    const previewMat = createOverlayMaterial(this.bag, theme.floor.edge, 0);
    this.preview = new DropPreview(outline, previewMat, new Color(theme.floor.edge), this.size);
    this.root.add(this.preview.mesh);
    if (this.racked) {
      // The warm light of the forklift's own lamps: where it is pointing its forks. Reads on boxes and shaded slots.
      const markerMat = createOverlayMaterial(this.bag, theme.forklift.light, 0);
      this.marker = new SlotMarker(this.bag.track(buildSlotMarkerGeometry()), markerMat, new Color(theme.forklift.light));
      this.root.add(this.marker.mesh);
    }
    if (this.targetRules) this.buildBursts(theme);

    const { width: w, depth: d } = level.size;
    const t = DIORAMA.wallThickness + DIORAMA.capOverhang;
    this.shadowBounds.set(new Vector3(-w / 2 - t, -DIORAMA.slabThickness, -d / 2 - t), new Vector3(w / 2, DIORAMA.wallHeight, d / 2));
    // The camera frames these static volumes only (CameraRig FitBox): the walls whole (buildWalls), the floor up to the
    // content height; nothing animated (a sinking wall, the forks, a load) ever moves the frame.
    this.fitBoxes.unshift({
      min: new Vector3(-w / 2, -DIORAMA.slabThickness, -d / 2),
      max: new Vector3(w / 2, DIORAMA.contentHeight, d / 2),
    });
    // Racks stand taller than the rest of the content: keep them in frame and inside the shadow volume.
    for (const rack of this.racks) {
      this.fitBoxes.push({ min: rack.bounds.min.clone(), max: rack.bounds.max.clone() });
      this.shadowBounds.union(rack.bounds);
    }
    // …and so do the docks: the truck outside and the sign over its door, always (they never sink).
    for (const truck of this.trucks) {
      this.fitBoxes.push(truck.fitBox);
      this.shadowBounds.union(truck.bounds);
    }

    this.update(snapshot, 0, 0, cameraYaw, 0);
  }

  /**
   * The optional target hints (Settings.targetHints, P): on, the destinations that would take the carried box light up
   * (zones that take it, the recipe step it would fill, fitting empty rack slots, loadable truck levels whose cue fits,
   * and the faint swap hint); off, nothing lights up for it (pure deduction). Toggled while a box is carried, that light
   * eases in or out with the views' own smoothing. Nothing else depends on it: the success flash and soft glow, the
   * locked box tone, the drop preview's tone and the slot marker stay as they are.
   */
  setTargetHints(on: boolean): void {
    this.targetHints = on;
  }

  update(snapshot: GameSnapshot, dt: number, time: number, cameraYaw: number, warmth: number): void {
    const f = snapshot.forklift;
    const hint = snapshot.hint;
    // At a column of shelves (a rack) the forks count its slot heights; at a stack (a truck bed), stack levels.
    const shelf = onShelves(hint.storage);
    this.forklift.sync(f, dt, time, shelf !== null);
    this.forklift.root.updateMatrixWorld(true);

    let carried: BoxState | null = null;
    const boxes = snapshot.boxes;
    const target = snapshot.hint.targetBoxId;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const view = this.boxViews.get(box.id);
      if (!view) continue;
      if (box.carried) carried = box;
      view.sync(box, this.forklift.anchor, box.id === target, dt);
    }

    // Teach the goal without words (the optional target hints, P): the zones that would take the carried box breathe,
    // and so do the empty rack slots whose cue fits it (the cue, never the solution: only the destined box lights them).
    // In a sorting level or one with racks, when no free target takes it, the occupied ones that accept it breathe very
    // faintly instead: the box resting there could move on (a swap hint; with racks never on a target that already
    // glows). A truck level invites only as the next level of its column with everything below it right (`loadable`,
    // docs/DOCKS.md). With the hints off nothing invites (`hinted` null): each light eases out on its own.
    const zones = snapshot.zones;
    const slots = snapshot.storageSlots;
    const hinted = this.targetHints ? carried : null;
    let anyTakes = false;
    if (hinted) {
      for (let i = 0; i < zones.length && !anyTakes; i++) anyTakes = takesNext(zones[i], hinted);
      for (let i = 0; i < slots.length && !anyTakes; i++) anyTakes = this.takesNow(slots[i]) && cueFits(slots[i], hinted);
    }
    const swapHint = (this.sorting || this.targetRules) && !anyTakes;
    // With racks or trucks the invitation is a strong pulse (views/success); the swap hint keeps its quiet strength.
    const swapInvite = this.targetRules ? RACK_SWAP_INVITE : SWAP_INVITE;
    const glowTint = carried ? (this.glows.get(carried.color) ?? null) : null;
    const slotTone = carried ? (this.slotTones.get(carried.color) ?? null) : null;
    for (let i = 0; i < zones.length; i++) {
      const zone = zones[i];
      const takes = hinted !== null && takesNext(zone, hinted);
      const swap =
        hinted !== null && swapHint && zone.stack.length > 0 && !(this.targetRules && zone.satisfied) && accepts(zone, hinted);
      this.zoneViews.get(zone.id)?.sync(zone, takes ? 1 : swap ? swapInvite : 0, takes, time, dt, glowTint);
      if (this.targetRules) {
        if (zone.satisfied && this.zoneWasSatisfied[i] === false) this.playBurstOnZone(zone);
        this.zoneWasSatisfied[i] = zone.satisfied;
      }
      const was = this.stackSatisfied.get(zone.id);
      if (was !== undefined && was !== zone.satisfied) {
        this.stackSatisfied.set(zone.id, zone.satisfied);
        if (zone.satisfied) this.glowStack(zone);
      }
    }

    // Each slot lights on its skin's view (a rack's panel, a cell of a dock's sign; phase 5 brings the registry).
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const fits = hinted !== null && cueFits(slot, hinted);
      const invite = !fits ? 0 : this.takesNow(slot) ? 1 : swapHint && slot.occupiedBy !== null && !slot.satisfied ? swapInvite : 0;
      if (slot.skin === 'rack') {
        this.rackOfSlot.get(slot.id)?.syncSlot(slot, invite, slotTone, time, dt);
        if (slot.satisfied && this.slotWasSatisfied[i] === false) this.playBurstInSlot(slot, cameraYaw);
      } else {
        this.truckOfSlot.get(slot.id)?.syncLevel(slot.id, slot.satisfied, invite, slotTone, time, dt);
        if (slot.satisfied && this.slotWasSatisfied[i] === false) this.playBurstOnTruck(slot, cameraYaw);
      }
      this.slotWasSatisfied[i] = slot.satisfied;
    }
    for (let i = 0; i < this.bursts.length; i++) this.bursts[i].update(dt);

    // The preview takes the carried box's zone tone when it would land on a zone that takes that box, or in a rack
    // slot whose cue fits it. Into a slot it floats on the slot floor, and the slot marker frames the selected slot.
    const selected = shelf !== null && !snapshot.completed ? (this.slotStates.get(shelf.slotId) ?? null) : null;
    // A locked box is done: its slot never reads as ready to pick, and nothing previews on top of it.
    const lockedPick = carried === null && selected !== null && selected.occupiedBy !== null && isLocked(boxes, selected.occupiedBy);
    const ready = shelf !== null && shelf.ready && !lockedPick;
    const dropCell = carried !== null && hint.dropCell !== null && !this.dropsOnLocked(boxes, hint.dropCell, hint.dropLevel) ? hint.dropCell : null;
    const intoSlot = carried !== null && selected !== null && ready && dropCell !== null;
    // On a stack (a truck bed) the preview takes the box's tone where the level would take it now: loadable and its cue
    // fits (hint.storage there names where the drop lands).
    const at = hint.storage;
    const dropTruck = carried !== null && at !== null && shelf === null && at.ready ? this.slotAt(snapshot, at.slotId) : null;
    let match: Color | null = null;
    if (carried && selected && intoSlot) {
      if (cueFits(selected, carried)) match = this.borders.get(carried.color) ?? null;
    } else if (carried && dropTruck) {
      if (dropTruck.loadable && cueFits(dropTruck, carried)) match = this.borders.get(carried.color) ?? null;
    } else if (carried) {
      const dropZone = hint.dropZoneId ? this.zoneStates.get(hint.dropZoneId) : undefined;
      if (dropZone && takesNext(dropZone, carried)) match = this.borders.get(carried.color) ?? null;
    }
    const topY = intoSlot ? rackSlotY(hint.dropLevel) - ZONE.padHeight : hint.dropLevel * this.boxHeight;
    this.preview.sync(f.carrying ? dropCell : null, match, dt, topY, intoSlot ? SLOT_PREVIEW_SCALE : 1);
    this.marker?.sync(selected, ready, intoSlot ? match : null, dt);

    if (this.trucked) this.refreshRoomClip();
    this.updateOccluders(snapshot, cameraYaw, dt);
    if (this.stacking) this.updateStackGhosts(snapshot, cameraYaw, dt);
    if (this.racked) this.updateSlotBoxGhosts(snapshot, dt);

    const shaftGain = 1 + 0.2 * warmth;
    for (let i = 0; i < this.walls.length; i++) this.walls[i].sync(cameraYaw, dt, false, shaftGain);
    for (let i = 0; i < this.trucks.length; i++) this.trucks[i].followWall(this.truckWalls[i].heightScale);
    this.glassMaterial.color.setScalar(1 + 0.06 * warmth);
  }

  /** The storage slot `id` of this frame's snapshot (index kept from load: the list never changes during a level). */
  private slotAt(snapshot: GameSnapshot, id: string): StorageSlotState | null {
    const i = this.slotIndex.get(id);
    return i !== undefined ? (snapshot.storageSlots[i] ?? null) : null;
  }

  /**
   * The slot would take the carried box now, so its destined box would light it (what invites, with its cue): an empty
   * shelf; in a stack, its loadable level (the next one up, on right levels only).
   */
  private takesNow(slot: StorageSlotState): boolean {
    return this.shelfSlots.has(slot.id) ? slot.occupiedBy === null : slot.loadable;
  }

  /** The box rests on a storage shelf (a rack slot): not a stack, it ghosts with its bay. */
  private onShelf(box: BoxState): boolean {
    return box.slotId !== null && this.shelfSlots.has(box.slotId);
  }

  /**
   * A drop on `cell` at `level` would land on a locked box: on top of it (floor, a zone) or into its slot. Logic never
   * offers one; the render still never previews it. In a storage stack (a truck bed) the next level loads on top of a
   * locked box (docs/STORAGE.md rule 5): only a drop into its own level would.
   */
  private dropsOnLocked(boxes: readonly BoxState[], cell: CellPos, level: number): boolean {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!b.locked || b.carried || !b.cell || b.cell.x !== cell.x || b.cell.z !== cell.z) continue;
      if (b.slotId !== null && !this.shelfSlots.has(b.slotId)) {
        if (b.level === level) return true;
      } else if (b.slotId === null || b.level === level) return true;
    }
    return false;
  }

  handleEvent(event: GameEvent, snapshot: GameSnapshot): void {
    switch (event.type) {
      case 'actionIdle':
        if (event.carrying && snapshot.forklift.carrying) this.boxViews.get(snapshot.forklift.carrying)?.playWobble();
        else this.forklift.playShrug();
        break;
      case 'levelComplete':
        this.playCompletionWave(snapshot);
        break;
      case 'boxDropped':
        // Stacked on top (a floor stack, a truck bed): as it lands, the whole stack (the new box included) dips a touch
        // together. Rack slots hold one box each on their own shelves: nothing below dips.
        if (event.level > 0 && !(event.slotId !== undefined && this.shelfSlots.has(event.slotId))) {
          for (const box of snapshot.boxes) {
            if (box.cell && box.cell.x === event.cell.x && box.cell.z === event.cell.z) {
              this.boxViews.get(box.id)?.playStackSettle(DROP_GLIDE_SEC);
            }
          }
        }
        break;
      default:
        // Pick hops, drop glides, zone glow and release are derived from state changes in update().
        break;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.bag.dispose();
  }

  /** Loading docks: the room side of every dock wall that stands (as its truck saw it last frame), for clipToRoom. */
  private refreshRoomClip(): void {
    this.roomMinX = -Infinity;
    this.roomMinZ = -Infinity;
    for (let i = 0; i < this.trucks.length; i++) {
      if (!this.trucks[i].wallStands) continue;
      if (this.truckSides[i] === 'north') this.roomMinZ = -this.size.depth / 2;
      else this.roomMinX = -this.size.width / 2;
    }
  }

  /**
   * Clip an actor volume to the room side of every standing dock wall: what lies beyond one (on a truck bed, or the part
   * of the load already through the door) is hidden by the wall itself. False when nothing of it is left. Without
   * trucks, or with the dock wall sunk, the volume is untouched.
   */
  private clipToRoom(min: Vector3, max: Vector3): boolean {
    if (min.x < this.roomMinX) min.x = this.roomMinX;
    if (min.z < this.roomMinZ) min.z = this.roomMinZ;
    return min.x < max.x && min.z < max.z;
  }

  /**
   * Ghost every shelf or rack that stands between the camera and the forklift, a box or a zone, so tall
   * furniture never hides what the player needs to see; back to solid once nothing is behind it. Boxes reaching
   * into a rack (in its slots, the load going in or out) never count: they ghost with it instead; nor does what a
   * standing dock wall already hides (clipToRoom).
   */
  private updateOccluders(snapshot: GameSnapshot, cameraYaw: number, dt: number): void {
    const n = this.occluders.length;
    if (n === 0) return;
    const cp = Math.cos(this.pitch);
    const back = _back.set(cp * Math.sin(cameraYaw), Math.sin(this.pitch), cp * Math.cos(cameraYaw));
    const f = snapshot.forklift.pos;
    const boxes = snapshot.boxes;
    const zones = snapshot.zones;
    for (let i = 0; i < n; i++) {
      const bounds = this.occluders[i].bounds;
      const holds = this.occluders[i].holds;
      _actorMin.set(f.x - FORKLIFT_HALF, FORKLIFT_Y[0], f.z - FORKLIFT_HALF);
      _actorMax.set(f.x + FORKLIFT_HALF, FORKLIFT_Y[1], f.z + FORKLIFT_HALF);
      // The forklift or its load (`actor`), or only resting boxes and zones (`resting`).
      let actor = hidesBehind(bounds, _actorMin, _actorMax, back);
      let resting = false;
      // boxList follows snapshot.boxes (buildBoxes).
      for (let b = 0; b < this.boxList.length && !actor; b++) {
        const carried = boxes[b]?.carried === true;
        if (resting && !carried) continue;
        const p = this.boxList[b].group.position;
        if (holds && reachesInto(holds, p, this.boxHalf + BOX_INSET)) continue;
        _actorMin.set(p.x - this.boxHalf, p.y + this.boxHeight * BOX_VISIBLE_FROM, p.z - this.boxHalf);
        _actorMax.set(p.x + this.boxHalf, p.y + this.boxHeight, p.z + this.boxHalf);
        if (!this.clipToRoom(_actorMin, _actorMax) || !hidesBehind(bounds, _actorMin, _actorMax, back)) continue;
        if (carried) actor = true;
        else resting = true;
      }
      for (let z = 0; z < zones.length && !actor && !resting; z++) {
        const p = zones[z].pos;
        _actorMin.set(p.x - ZONE_HALF, 0, p.z - ZONE_HALF);
        _actorMax.set(p.x + ZONE_HALF, ZONE.padHeight, p.z + ZONE_HALF);
        resting = hidesBehind(bounds, _actorMin, _actorMax, back);
      }
      this.occluderHiding[i] = actor || resting;
      this.occluderSoft[i] = !actor && resting;
      this.occluderDepth[i] = (bounds.min.x + bounds.max.x) * back.x + (bounds.min.z + bounds.max.z) * back.z;
    }
    // Ghosts draw back to front (rank 0 = farthest from the camera).
    const depth = this.occluderDepth;
    for (let i = 0; i < n; i++) {
      let rank = 0;
      for (let j = 0; j < n; j++) {
        if (depth[j] < depth[i] || (depth[j] === depth[i] && j < i)) rank++;
      }
      this.occluders[i].sync(this.occluderHiding[i], rank, dt, this.occluderSoft[i]);
    }
  }

  /**
   * Zones, rack slots with a cue and truck levels glow one after another, starting from the one nearest the forklift
   * (a stack glows bottom → top, and so does a rack column or a truck bed column).
   */
  private playCompletionWave(snapshot: GameSnapshot): void {
    const p = snapshot.forklift.pos;
    const distance = (q: Vec2) => Math.hypot(q.x - p.x, q.z - p.z);
    const order: { d: number; play: (delay: number) => void }[] = [];
    for (const z of snapshot.zones) {
      order.push({
        d: distance(z.pos),
        play: (delay) => {
          this.zoneViews.get(z.id)?.playWave(delay);
          // Boxes in a stack only glow (no bob), so they keep touching.
          const bob = z.stack.length <= 1;
          z.stack.forEach((id, level) => this.boxViews.get(id)?.playWave(delay + level * WAVE_STEP * 0.5, bob));
        },
      });
    }
    // Storage slots with a cue («libre» ones never light), in snapshot order: rack slots, then truck levels. Same
    // distance for a whole column: the stable sort keeps the snapshot order, bottom → top.
    for (const s of snapshot.storageSlots) {
      if (s.accepts === null) continue;
      const shelf = this.shelfSlots.has(s.id);
      order.push({
        d: distance(s.pos),
        play: (delay) => {
          if (s.skin === 'rack') this.rackOfSlot.get(s.id)?.playWave(s.id, delay);
          else this.truckOfSlot.get(s.id)?.playWave(s.id, delay);
          // Boxes in a stack (a bed column) only glow (no bob), so they keep touching.
          if (s.occupiedBy) this.boxViews.get(s.occupiedBy)?.playWave(delay, shelf);
        },
      });
    }
    order.sort((a, b) => a.d - b.d);
    order.forEach((t, i) => t.play(WAVE_START_DELAY + i * WAVE_STEP));
    this.forklift.playHappy(WAVE_START_DELAY);
  }

  /** Levels with racks: the success bursts, built once (a shared ring and sparkle geometry, materials per burst). */
  private buildBursts(theme: Theme): void {
    const ring = this.bag.track(buildOutlineGeometry(0.5, BURST_RING_WIDTH, 0.12));
    const sparkle = this.bag.track(new OctahedronGeometry(1, 0));
    const white = new Color(1, 1, 1);
    for (const c of COLOR_IDS) this.sparkleTones.set(c, new Color(theme.boxes[c].base).lerp(white, SPARKLE_LIGHTEN));
    for (let i = 0; i < BURSTS; i++) {
      const burst = new SuccessBurst(ring, createOverlayMaterial(this.bag, white, 0), sparkle, createOverlayMaterial(this.bag, white, 0));
      this.bursts.push(burst);
      this.root.add(burst.group);
    }
  }

  /** The next burst of the pool: a free one if any, else the oldest. */
  private takeBurst(): SuccessBurst | null {
    const n = this.bursts.length;
    for (let k = 0; k < n; k++) {
      const burst = this.bursts[(this.nextBurst + k) % n];
      if (!burst.active) {
        this.nextBurst = (this.nextBurst + k + 1) % n;
        return burst;
      }
    }
    const oldest = this.bursts[this.nextBurst] ?? null;
    this.nextBurst = n > 0 ? (this.nextBurst + 1) % n : 0;
    return oldest;
  }

  /** A zone just got its destined box: sparkles over it as the box lands (the zone plays its own floor ring). */
  private playBurstOnZone(zone: ZoneState): void {
    const color = zone.destined?.color ?? zone.color;
    const tone = color ? this.sparkleTones.get(color) : undefined;
    if (tone) this.takeBurst()?.play('floor', zone.pos.x, 0, zone.pos.z, 0, tone, DROP_GLIDE_SEC);
  }

  /**
   * A slot just got its destined box: a ring around its opening and sparkles out of it, as the box lands, on the face
   * the camera sees (its cue reads from both; a rack may turn its back to the camera).
   */
  private playBurstInSlot(slot: StorageSlotState, cameraYaw: number): void {
    const tone = slot.destined ? this.sparkleTones.get(slot.destined.color) : undefined;
    if (!tone) return;
    const front = outwardYaw(slot.facing);
    const towardCamera = Math.sin(front) * Math.sin(cameraYaw) + Math.cos(front) * Math.cos(cameraYaw);
    const yaw = towardCamera >= 0 ? front : front + Math.PI;
    const halfW = SLOT_GLOW.halfW + 0.02;
    this.takeBurst()?.play('slot', slot.pos.x, rackSlotY(slot.level), slot.pos.z, yaw, tone, DROP_GLIDE_SEC, halfW, PANEL_HEIGHT / 2);
  }

  /**
   * A truck level just got its destined box (on right levels below): a ring around the box on its bed and sparkles out
   * of it, as the box lands, on the face of its bed column the camera sees (the door plane from inside, the outer end
   * of the bed from outside). Its sign cell flashes with it (TruckView).
   */
  private playBurstOnTruck(ts: StorageSlotState, cameraYaw: number): void {
    const tone = ts.destined ? this.sparkleTones.get(ts.destined.color) : undefined;
    if (!tone) return;
    const front = outwardYaw(ts.facing);
    const towardCamera = Math.sin(front) * Math.sin(cameraYaw) + Math.cos(front) * Math.cos(cameraYaw);
    const yaw = towardCamera >= 0 ? front : front + Math.PI;
    const h = this.boxHeight;
    this.takeBurst()?.play('slot', ts.pos.x, ts.level * h, ts.pos.z, yaw, tone, DROP_GLIDE_SEC, TRUCK_BURST.halfW, h / 2);
  }

  /** A stack zone was just completed: its boxes glow one after another, bottom → top, once the last has landed. */
  private glowStack(zone: ZoneState): void {
    zone.stack.forEach((id, level) =>
      this.boxViews.get(id)?.playWave(DROP_GLIDE_SEC + STACK_GLOW_START + level * STACK_GLOW_STEP, false),
    );
  }

  /**
   * Stack levels: a box resting above the floor fades to a ghost (same idea as the shelves) while it stands
   * between the camera and the forklift's cabin, another box's lid or a zone pad, so tall stacks never hide
   * what the player needs to see. Boxes on the floor stay solid, so a stack still reads as a stack.
   */
  private updateStackGhosts(snapshot: GameSnapshot, cameraYaw: number, dt: number): void {
    const cp = Math.cos(this.pitch);
    const back = _back.set(cp * Math.sin(cameraYaw), Math.sin(this.pitch), cp * Math.cos(cameraYaw));
    const boxes = snapshot.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const view = this.boxViews.get(box.id);
      // Boxes in rack slots ghost with their rack (updateSlotBoxGhosts); a truck bed's are a stack like any other.
      if (!view || this.onShelf(box)) continue;
      // Once complete (input frozen) every box turns solid, so the glow wave always plays on solid stacks.
      const hides = !snapshot.completed && !box.carried && box.level > 0 && box.cell !== null;
      view.setGhost(hides && this.stackBoxHides(box.cell!, view, snapshot, back), dt);
    }
  }

  /**
   * Levels with racks: a box in a slot fades with its bay while the bay hides the forklift or its load (so the ghost is
   * not blocked by solid boxes), solid again with it and once the level is complete. Without stacking nothing else
   * ghosts, so every other box is brought back to solid (a box just lifted out of a ghosted rack).
   */
  private updateSlotBoxGhosts(snapshot: GameSnapshot, dt: number): void {
    const boxes = snapshot.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const view = this.boxViews.get(box.id);
      if (!view) continue;
      if (this.onShelf(box)) view.setGhost(!snapshot.completed && (this.bayOfSlot.get(box.slotId!)?.hidesActor ?? false), dt);
      else if (!this.stacking) view.setGhost(false, dt);
    }
  }

  /** True when the stacked box `view` (resting on `cell`) hides the cabin, a box lid in another cell or a zone pad. */
  private stackBoxHides(cell: CellPos, view: BoxView, snapshot: GameSnapshot, back: Vector3): boolean {
    const p = view.group.position;
    const half = this.boxHalf + BOX_INSET;
    const stack = this.stackBox;
    stack.min.set(p.x - half, p.y, p.z - half);
    stack.max.set(p.x + half, p.y + this.boxHeight, p.z + half);

    // Cabin: small probes (seat level, roof) rather than the whole forklift, so a stack being docked at stays solid.
    const f = snapshot.forklift;
    const cx = f.pos.x - CABIN_BACK * Math.sin(f.heading);
    const cz = f.pos.z - CABIN_BACK * Math.cos(f.heading);
    for (let k = 0; k < CABIN_PROBE_Y.length; k++) {
      const y = CABIN_PROBE_Y[k];
      _actorMin.set(cx - CABIN_PROBE_HALF, y - CABIN_PROBE_HALF, cz - CABIN_PROBE_HALF);
      _actorMax.set(cx + CABIN_PROBE_HALF, y + CABIN_PROBE_HALF, cz + CABIN_PROBE_HALF);
      if (hidesBehind(stack, _actorMin, _actorMax, back)) return true;
    }

    // Lids of resting boxes in other cells (same volume the shelves test; a lid a standing dock wall hides never counts).
    const boxes = snapshot.boxes;
    for (let j = 0; j < boxes.length; j++) {
      const other = boxes[j];
      if (other.carried || !other.cell || (other.cell.x === cell.x && other.cell.z === cell.z)) continue;
      const q = this.boxViews.get(other.id)?.group.position;
      if (!q) continue;
      _actorMin.set(q.x - this.boxHalf, q.y + this.boxHeight * BOX_VISIBLE_FROM, q.z - this.boxHalf);
      _actorMax.set(q.x + this.boxHalf, q.y + this.boxHeight, q.z + this.boxHalf);
      if (this.clipToRoom(_actorMin, _actorMax) && hidesBehind(stack, _actorMin, _actorMax, back)) return true;
    }

    // Zone pads in other cells (the one under this stack is covered by its base box anyway).
    const zones = snapshot.zones;
    for (let z = 0; z < zones.length; z++) {
      const zone = zones[z];
      if (zone.cell.x === cell.x && zone.cell.z === cell.z) continue;
      _actorMin.set(zone.pos.x - ZONE_HALF, 0, zone.pos.z - ZONE_HALF);
      _actorMax.set(zone.pos.x + ZONE_HALF, ZONE.padHeight, zone.pos.z + ZONE_HALF);
      if (hidesBehind(stack, _actorMin, _actorMax, back)) return true;
    }
    return false;
  }

  private mesh(geometry: BufferGeometry, material: Material, cast: boolean): Mesh {
    const m = new Mesh(this.bag.track(geometry), material);
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  }

  private buildStatic(level: LevelData, theme: Theme, mats: SharedMaterials): void {
    const rng = createRng(`${level.id}:decor`);
    const floor = new PartList();
    addFloor(floor, level, theme);
    // The loading line in front of every rack column is paint on the floor.
    for (const rack of racksOf(level)) addRackLines(floor, rack, level, theme);
    this.root.add(this.mesh(floor.build(), mats.painted, false));

    // Each shelf is its own mesh (it may fade out of the way); plants stay merged.
    for (const shelf of level.shelves) {
      const parts = new PartList();
      addShelf(parts, shelf, level, theme, rng);
      const view = new ShelfView(this.bag.track(parts.build()), this.bag.track(mats.painted.clone()), this.depthOnly);
      this.addOccluder(view);
      this.root.add(view.mesh);
    }
    const solid = new PartList();
    const leaves = new PartList();
    for (const plant of level.decor.plants) addPlant(solid, leaves, plant, level, theme, rng);
    if (!solid.isEmpty) this.root.add(this.mesh(solid.build(), mats.painted, true));
    if (!leaves.isEmpty) this.root.add(this.mesh(leaves.build(), mats.faceted, true));
  }

  private buildWalls(level: LevelData, theme: Theme, mats: SharedMaterials, cameraYaw: number): void {
    const local = new Vector3();
    const wallMaterial = createGlowMaterial(this.bag, theme.wall.base);
    wallMaterial.emissiveIntensity = WALL_BOUNCE;
    for (const layout of wallLayouts(level)) {
      const geo = buildWallGeometry(layout, theme, toWallLocal(layout, this.toSun, local));
      const min = new Vector3(layout.start, -DIORAMA.slabThickness, -DIORAMA.wallThickness - DIORAMA.capOverhang);
      const max = new Vector3(layout.end, DIORAMA.wallHeight + DIORAMA.capHeight, DIORAMA.capOverhang);
      const wall = new WallView(layout.inward, ...worldBox(min, max, layout.position, layout.rotationY));
      wall.group.position.copy(layout.position);
      wall.group.rotation.y = layout.rotationY;
      wall.group.add(this.mesh(geo.body, wallMaterial, false));
      if (geo.glass) wall.group.add(new Mesh(this.bag.track(geo.glass), this.glassMaterial));
      if (geo.shafts) wall.addShafts(this.bag.track(geo.shafts), this.bag.track(mats.shaft.clone()));
      wall.sync(cameraYaw, 0, true);
      this.walls.push(wall);
      this.wallBySide.set(layout.side, { view: wall, layout });
      this.fitBoxes.push(wall.fitBox);
      this.root.add(wall.group);
    }
  }

  private addOccluder(view: Occluder): void {
    this.occluders.push(view);
    this.occluderHiding.push(false);
    this.occluderSoft.push(false);
    this.occluderDepth.push(0);
  }

  /**
   * What a pad (or a rack slot's cue) shows in its middle. Levels that never name a symbol: its color's glyph, tone
   * on tone (a colour-blind aid, as always). Sorting levels: the symbol it asks for, engraved, or nothing when it
   * asks for none.
   */
  private markOf(criteria: ZoneCriteria): ZoneMark | null {
    if (!this.sorting) return criteria.color ? { shape: DEFAULT_SYMBOL[criteria.color], style: 'glyph' } : null;
    return criteria.symbol ? { shape: criteria.symbol, style: 'engraved' } : null;
  }

  private buildZones(snapshot: GameSnapshot, theme: Theme, mats: SharedMaterials): void {
    const ring = this.bag.track(buildOutlineGeometry(ZONE.padHalf, 0.035, ZONE.padRadius));
    const halo = this.bag.track(buildHaloGeometry());
    const padByLook = new Map<string, BufferGeometry>();
    for (const zone of snapshot.zones) {
      // Pad color = the color criterion; a zone that asks for none gets the neutral pad.
      const palette = zone.color ? theme.zones[zone.color] : theme.neutralZone;
      const mark = this.markOf(zone.accepts);
      const look = `${zone.color ?? 'neutral'}/${mark ? `${mark.style}:${mark.shape}` : 'plain'}`;
      let pad = padByLook.get(look);
      if (!pad) {
        pad = this.bag.track(buildZoneGeometry(palette, mark));
        padByLook.set(look, pad);
      }
      const view = new ZoneView(
        zone,
        { pad, ring, halo },
        createGlowMaterial(this.bag, palette.glow),
        createOverlayMaterial(this.bag, palette.border, 0),
        createOverlayMaterial(this.bag, palette.glow, 0, true),
        DROP_GLIDE_SEC,
        this.targetRules,
        zone.destined ? (this.glows.get(zone.destined.color) ?? null) : null,
      );
      this.zoneViews.set(zone.id, view);
      this.zoneWasSatisfied.push(zone.satisfied);
      this.zoneStates.set(zone.id, zone);
      // Stack recipes are color-only (validateLevel): every step names its color.
      const recipe = zone.recipe.filter((c): c is ColorId => c !== null);
      if (recipe.length > 1) {
        // The recipe, bottom → top: a cream base (shared material) and one mesh per step that can glow on its own.
        // Neutral cream of the walls: never a functional hue.
        const marker = buildRecipeGeometry(
          recipe.map((c) => theme.boxes[c].base),
          theme.wall.base,
        );
        const steps = marker.steps.map(
          (geo, i) => new Mesh(this.bag.track(geo), createGlowMaterial(this.bag, theme.zones[recipe[i]].glow)),
        );
        for (const step of steps) step.receiveShadow = true;
        view.addRecipe(this.mesh(marker.base, mats.painted, false), steps);
        this.stackSatisfied.set(zone.id, zone.satisfied);
      }
      this.root.add(view.group);
    }
  }

  /**
   * Storage racks (docs/RACKS.md): one RackView per rack, a bay per column (its frame + a glowing panel per slot with a
   * cue), each fading on its own, and the cue of each slot: an unlit sticker in the exact colour of the box it asks
   * for, rimmed in that box's ink (the neutral cue fill and rim for a symbol only), with the same mark as a zone (its
   * symbol, or its colour's glyph in levels without symbols) drawn bold in the cue ink.
   */
  private buildRacks(snapshot: GameSnapshot, theme: Theme, mats: SharedMaterials): void {
    const level = snapshot.level;
    const byId = new Map<string, RackView>();
    const frameMaterial = () => {
      const material = this.bag.track(mats.painted.clone());
      // Painted metal: a touch more sheen than the matte wood and walls.
      material.roughness = 0.72;
      return material;
    };
    const racks = racksOf(level);
    for (const rack of racks) {
      const bays = buildRackBays(rack, level, theme).map((g) => this.bag.track(g));
      const view = new RackView(rack.id, bays, frameMaterial, this.depthOnly, DROP_GLIDE_SEC);
      byId.set(rack.id, view);
      this.racks.push(view);
      for (const bay of view.bays) this.addOccluder(bay);
      this.root.add(view.group);
    }
    const rackById = new Map(racks.map((r) => [r.id, r]));
    let panel: BufferGeometry | null = null;
    let band: BufferGeometry | null = null;
    const cueByLook = new Map<string, BufferGeometry>();
    for (const slot of snapshot.storageSlots) {
      if (slot.skin !== 'rack') continue;
      const view = byId.get(slot.unitId);
      const rack = rackById.get(slot.unitId);
      if (!view || !rack) continue;
      this.slotStates.set(slot.id, slot);
      this.rackOfSlot.set(slot.id, view);
      const bay = view.bayOf(slot);
      if (bay) this.bayOfSlot.set(slot.id, bay);
      const cue = slot.accepts;
      if (!cue) continue; // «libre»: its plain panel is part of the frame
      const r = theme.rack;
      const box = cue.color ? theme.boxes[cue.color] : null;
      const look: CueLook = {
        fill: box ? box.base : r.cueFill,
        rim: box ? box.ink : r.cueRim,
        ink: r.cueInk,
        glyph: this.markOf(cue)?.shape ?? null,
        lip: box ? box.base : r.cueRim,
      };
      const ends = cueEndSides(rack, slot.column);
      const key = `${look.fill}/${look.glyph ?? 'plain'}/${ends.join(',')}`;
      let cueGeometry = cueByLook.get(key);
      if (!cueGeometry) {
        cueGeometry = this.bag.track(buildSlotCue(look, ends));
        cueByLook.set(key, cueGeometry);
      }
      panel ??= this.bag.track(buildSlotPanel(theme));
      band ??= this.bag.track(buildSlotGlowGeometry());
      const glow = cue.color ? theme.zones[cue.color].glow : theme.neutralZone.glow;
      // The slot lights in the tones of the box it is about: the carried one while inviting, the destined one after.
      const destined = slot.destined ? (this.slotTones.get(slot.destined.color) ?? null) : null;
      const bandMaterial = createOverlayMaterial(this.bag, destined?.band ?? glow, 0, true);
      view.addSlot(slot, panel, createGlowMaterial(this.bag, glow), cueGeometry, createCueMaterial(this.bag), band, bandMaterial, destined);
    }
  }

  /**
   * Loading docks (docs/DOCKS.md): one TruckView per truck, static: the dock plate in its door, the truck parked outside
   * and the sign over the door (a bay that fades on its own, like a rack's) with one cell per bed column and level,
   * bottom row = level 0: a glowing panel, the level's unlit sticker on both faces (the rack sticker: the exact colour of
   * the box it asks for, rimmed in its ink, or the neutral fill for a symbol only, the same mark in the cue ink) and a
   * glow band round it. The stickers come from the level data; each level's light reads its StorageSlotState by id every
   * frame. The boxes on a bed are ordinary boxes (buildBoxes) at their state positions, outside the wall.
   */
  private buildTrucks(snapshot: GameSnapshot, theme: Theme, mats: SharedMaterials): void {
    if (!this.trucked) return;
    const level = snapshot.level;
    const signMaterial = () => {
      const material = this.bag.track(mats.painted.clone());
      // Painted metal, like the racks.
      material.roughness = 0.72;
      return material;
    };
    const band = this.bag.track(buildSignGlowGeometry());
    const panelByCell = new Map<string, BufferGeometry>();
    const cueByLook = new Map<string, BufferGeometry>();
    const origin = new Vector3();
    const rails = dockRailsOf(level);
    trucksOf(level).forEach((truck, index) => {
      const wall = this.wallBySide.get(truck.wall);
      if (!wall) return;
      // The bed columns' volume beyond the wall (dock-local −1 < z < −T over the door run): boxes there never make
      // the sign ghost.
      const holds = new Box3();
      const ends = [dockColumnX(truck, level, 0), dockColumnX(truck, level, truck.columns.length - 1)];
      holds.expandByPoint(dockToWorld(truck.wall, level, Math.min(...ends) - 0.5, 0, -1, origin));
      holds.expandByPoint(dockToWorld(truck.wall, level, Math.max(...ends) + 0.5, DIORAMA.wallHeight, -DIORAMA.wallThickness, origin));
      const view = new TruckView(
        truck.id,
        this.bag.track(buildDockPlate(truck, level, theme)),
        this.bag.track(buildTruckBody(truck, level, theme, index)),
        mats.painted,
        this.bag.track(buildSignFrame(truck, level, theme)),
        signMaterial(),
        this.depthOnly,
        holds,
        DROP_GLIDE_SEC,
      );
      // The guard rails beside its door (core/docks dockRailsOf): low static props in the room, like the plants.
      const own = rails.filter((r) => r.unitId === truck.id);
      if (own.length > 0) {
        const mesh = this.mesh(buildDockRails(own, level, theme), mats.painted, true);
        mesh.userData.dockRails = truck.id;
        view.group.add(mesh);
      }
      // Sign cells face the warehouse: their local +z is their wall's inward side (dock-local +z).
      const yaw = dockPlacement(truck.wall, level).ry ?? 0;
      truck.columns.forEach((cues, column) => {
        const x = dockColumnX(truck, level, column);
        cues.forEach((cue, k) => {
          const id = truckSlotIdOf(truck.id, column, k);
          const state = this.slotAt(snapshot, id);
          const cell = signCell(truck, column, k);
          const cellKey = `${cell.x0}/${cell.x1}/${cell.y0}/${cell.y1}`;
          let panel = panelByCell.get(cellKey);
          if (!panel) {
            panel = this.bag.track(buildSignPanel(theme, cell));
            panelByCell.set(cellKey, panel);
          }
          const r = theme.rack;
          const box = cue.color ? theme.boxes[cue.color] : null;
          const look = { fill: box ? box.base : r.cueFill, rim: box ? box.ink : r.cueRim, ink: r.cueInk, glyph: this.markOf(cue)?.shape ?? null };
          const key = `${look.fill}/${look.glyph ?? 'plain'}`;
          let cueGeometry = cueByLook.get(key);
          if (!cueGeometry) {
            cueGeometry = this.bag.track(buildSignCue(look));
            cueByLook.set(key, cueGeometry);
          }
          const glow = cue.color ? theme.zones[cue.color].glow : theme.neutralZone.glow;
          const destined = state?.destined ? (this.slotTones.get(state.destined.color) ?? null) : null;
          const bandMaterial = createOverlayMaterial(this.bag, destined?.band ?? glow, 0, true);
          view.addLevel(
            id,
            state?.satisfied ?? false,
            dockToWorld(truck.wall, level, x, signRowY(k), signMidZ(), origin),
            yaw,
            panel,
            createGlowMaterial(this.bag, glow),
            cueGeometry,
            createCueMaterial(this.bag),
            band,
            bandMaterial,
            destined,
          );
          this.truckOfSlot.set(id, view);
        });
      });
      view.followWall(wall.view.heightScale);
      this.addOccluder(view.occluder);
      this.trucks.push(view);
      this.truckWalls.push(wall.view);
      this.truckSides.push(truck.wall);
      this.root.add(view.group);
    });
  }

  private buildBoxes(snapshot: GameSnapshot, theme: Theme, config: GameConfig): void {
    const dims = boxDims(config);
    const geoByKey = new Map<string, BufferGeometry>();
    // The lid shows the box's own symbol: the small tone-on-tone glyph, or printed large where symbols sort.
    const mark: LidMark = this.sorting ? 'symbol' : 'glyph';
    // Levels with racks or trucks: a box locked on its destiny eases to its deeper tone (one tint per colour).
    const lockTints = new Map<ColorId, Color>();
    if (this.targetRules) for (const c of COLOR_IDS) lockTints.set(c, lockTintOf(theme.boxes[c]));
    for (const box of snapshot.boxes) {
      const key = `${box.kind}:${box.color}:${box.symbol}`;
      let geo = geoByKey.get(key);
      if (!geo) {
        geo = this.bag.track(buildBoxGeometry(box.kind, theme.boxes[box.color], box.symbol, dims, mark));
        geoByKey.set(key, geo);
      }
      const view = new BoxView(
        box,
        geo,
        createGlowMaterial(this.bag, theme.zones[box.color].glow),
        GLYPH_SYMMETRY[box.symbol],
        dims.height,
        // Stacked boxes ghost when they hide the forklift; boxes in rack slots ghost with their rack.
        this.stacking || this.racked,
        lockTints.get(box.color) ?? null,
        this.shelfSlots,
      );
      this.boxViews.set(box.id, view);
      this.boxList.push(view);
      this.root.add(view.group);
    }
  }
}

/**
 * Sun over the wall with more windows (north by default), ~55° high and raking along that wall toward
 * the open side, so exactly one camera-facing side of every object is lit: clear, calm volumes.
 */
function sunDirection(level: LevelData, target: Vector3): Vector3 {
  let north = 0;
  let west = 0;
  for (const w of level.decor.windows) {
    if (w.wall === 'north') north += w.width;
    else west += w.width;
  }
  if (west > north) return target.set(-0.72, 1.35, 0.62).normalize();
  return target.set(0.62, 1.35, -0.72).normalize();
}

/** The box `id` is locked (done on its destiny, levels with racks). */
function isLocked(boxes: readonly BoxState[], id: string): boolean {
  for (let i = 0; i < boxes.length; i++) if (boxes[i].id === id) return boxes[i].locked;
  return false;
}

/**
 * The hint's storage column when its levels are shelves (support `shelves`: a rack column, where the forks count slot
 * heights and the slot marker frames the level chosen), else null (none, or a stack: a truck bed).
 */
function onShelves(at: StorageHint | null): StorageHint | null {
  return at !== null && STORAGE_SKINS[at.skin].support === 'shelves' ? at : null;
}

/** The footprint of half-size `half` around `p` overlaps `bounds` in XZ. */
function reachesInto(bounds: Box3, p: Vector3, half: number): boolean {
  return p.x + half > bounds.min.x && p.x - half < bounds.max.x && p.z + half > bounds.min.z && p.z - half < bounds.max.z;
}

/** World AABB of a local box after a Y rotation + translation. */
function worldBox(min: Vector3, max: Vector3, position: Vector3, rotationY: number): [Vector3, Vector3] {
  const box = new Box3(min, max);
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  const out = new Box3();
  const p = new Vector3();
  for (let i = 0; i < 8; i++) {
    p.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    out.expandByPoint(new Vector3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c).add(position));
  }
  return [out.min, out.max];
}
