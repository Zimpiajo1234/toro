import { Box3, Color, Group, Mesh, MeshBasicMaterial, OctahedronGeometry, Vector3, type BufferGeometry, type Material } from 'three';
import type { GameConfig } from '../config';
import { degToRad } from '../core/math';
import { accepts, cueFits, takesNext, usesSymbols } from '../core/sorting';
import { STORAGE_SKINS, hasStorage, storageOf } from '../core/storage';
import {
  COLOR_IDS,
  DEFAULT_SYMBOL,
  type BoxState,
  type CellPos,
  type ColorId,
  type GameEvent,
  type GameSnapshot,
  type LevelData,
  type StorageSkin,
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
import { addShelf } from './builders/shelf';
import { buildWallGeometry, toWallLocal, wallLayouts, type WallLayout } from './builders/walls';
import { buildHaloGeometry, buildOutlineGeometry, buildRecipeGeometry, buildZoneGeometry, type ZoneMark } from './builders/zone';
import type { FitBox } from './CameraRig';
import { DIORAMA, ZONE, boxDims } from './dims';
import { GLYPH_SYMMETRY } from './glyphs';
import { createGlowMaterial, createOverlayMaterial, createSharedMaterials, type SharedMaterials } from './materials';
import { PartList } from './paint';
import { createRng } from './random';
import { ResourceBag } from './resources';
import {
  STORAGE_RENDER,
  SUPPORT_LOOK,
  type BeyondWall,
  type BurstPlace,
  type MarkerPlace,
  type Occluder,
  type StorageBuildContext,
  type StorageUnitBuilder,
  type StorageUnitView,
  type SupportLook,
} from './storage';
import { BoxView, DROP_GLIDE_SEC, lockTintOf } from './views/BoxView';
import { DropPreview } from './views/DropPreview';
import { ForkliftView } from './views/ForkliftView';
import type { SlotTone } from './views/RackView';
import { ShelfView, hidesBehind } from './views/ShelfView';
import { SlotMarker } from './views/SlotMarker';
import { TARGET_SWAP_INVITE, SuccessBurst } from './views/success';
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
/** Drop preview onto a shelf of its own (a rack slot): the outline hugs the box between the uprights. */
const SLOT_PREVIEW_SCALE = 0.82;
/**
 * Levels with storage: success bursts kept ready (a drop plays one; two can overlap), their ring's line width, and how
 * much of the way from the box colour to white their sparkles are (the box's own colour, a touch lighter).
 */
const BURSTS = 2;
const BURST_RING_WIDTH = 0.05;
const SPARKLE_LIGHTEN = 0.08;

const _actorMin = new Vector3();
const _actorMax = new Vector3();
const _back = new Vector3();

/**
 * Everything drawn for one level: static diorama (a few merged meshes), walls, zones, storage units (through the
 * skins registry, render/storage), boxes, forklift and the drop preview. Owns and disposes all of its GPU resources.
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
  /** Zone glow tone per color: levels with storage light a zone in the box it is about (views/ZoneView). */
  private readonly glows = new Map<ColorId, Color>();
  /** …and a storage level (views/RackView SlotTone: its band in the box colour, its panel in its glow). */
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
  /** Shelves and storage pieces (rack bays, dock signs), in one list so overlapping ghosts are ranked together. */
  private readonly occluders: Occluder[] = [];
  /** Per-occluder scratch for update(): hides an actor now / distance toward the camera. */
  private readonly occluderHiding: boolean[] = [];
  private readonly occluderSoft: boolean[] = [];
  private readonly occluderDepth: number[] = [];
  /**
   * Storage (docs/STORAGE.md), built through the skins registry (render/storage STORAGE_RENDER): every unit on screen
   * in storage order, and by id; each slot's index in snapshot.storageSlots (the list never changes during a level) and
   * the unit of the slot at each index. Past building, nothing here branches on a skin.
   */
  private readonly units: StorageUnitView[] = [];
  private readonly unitById = new Map<string, StorageUnitView>();
  private readonly slotIndex = new Map<string, number>();
  private readonly unitOfSlot: (StorageUnitView | undefined)[] = [];
  /**
   * The support of each slot, by id (render/storage SUPPORT_LOOK of its skin's support): a box on a shelf of its own
   * (a rack slot) rests on it, ghosts with the piece holding it and never dips with a stack; a box in a stack (a truck
   * bed) is a stack like the floor's. `shelved`: the level has shelves.
   */
  private readonly slotSupport = new Map<string, SupportLook>();
  private readonly shelved: boolean;
  /** The chosen-level marker of each skin on screen that has one (views/SlotMarker), shared by its units. */
  private readonly markers: { skin: StorageSkin; marker: SlotMarker }[] = [];
  private readonly markerPlace: MarkerPlace = { x: 0, y: 0, z: 0, yaw: 0 };
  private readonly burstPlace: BurstPlace = { x: 0, y: 0, z: 0, yaw: 0, halfW: 0, halfH: 0 };
  /** The level has storage (core/storage hasStorage): destined boxes, locks, the flash and burst, the strong pulse. */
  private readonly targetRules: boolean;
  /**
   * The units beyond a back wall (the `door` access: a truck outside its dock door) and that wall: each follows it every
   * frame (its sign ghosts softly while it is sunk).
   */
  private readonly beyond: { unit: BeyondWall; wall: WallView }[] = [];
  /**
   * Levels with units beyond a wall: the wall line (world x of the west wall, z of the north one) of each such wall
   * standing this frame, −∞ for none. What lies beyond it (a box on a bed, the part of a load through the door) is
   * hidden by that wall, so it never makes a shelf, a rack or a stack ghost (clipToRoom).
   */
  private roomMinX = -Infinity;
  private roomMinZ = -Infinity;
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
    this.targetRules = hasStorage(level);
    for (const c of COLOR_IDS) this.borders.set(c, new Color(theme.zones[c].border));
    for (const c of COLOR_IDS) this.glows.set(c, new Color(theme.zones[c].glow));
    for (const c of COLOR_IDS) this.slotTones.set(c, { band: new Color(theme.boxes[c].base), glow: this.glows.get(c)! });
    const mats = createSharedMaterials(this.bag);
    // Glass gets its own copy so level-complete warmth can tint it (each wall clones its shafts').
    this.glassMaterial = this.bag.track(mats.unlit.clone());
    // Depth-only prepass shared by every ghosting shelf and storage piece.
    this.depthOnly = this.bag.track(new MeshBasicMaterial({ colorWrite: false, transparent: true }));
    sunDirection(level, this.toSun);
    snapshot.storageSlots.forEach((slot, i) => {
      this.slotIndex.set(slot.id, i);
      this.slotWasSatisfied.push(slot.satisfied);
      this.slotSupport.set(slot.id, SUPPORT_LOOK[STORAGE_SKINS[slot.skin].support]);
    });
    this.shelved = snapshot.storageSlots.some((slot) => this.onShelves(slot.id));

    this.buildStatic(level, theme, mats);
    this.buildWalls(level, theme, mats, cameraYaw);
    this.buildZones(snapshot, theme, mats);
    this.buildStorage(snapshot, theme, mats);
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
    this.buildMarkers(level, theme);
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
    // Storage units stand taller than the rest of the content (a rack) or outside the room (a truck and the sign over
    // its door): each unit's static frame keeps it in frame, always (none ever sinks), and inside the shadow volume.
    for (const unit of this.units) {
      this.fitBoxes.push(unit.fitBox);
      this.shadowBounds.union(unit.bounds);
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
    // The storage column worked at and its support (render/storage SUPPORT_LOOK): on shelves of their own (a rack) the
    // forks count shelf heights; in a stack (a truck bed), stack levels.
    const at = hint.storage;
    const support = at !== null ? STORAGE_SKINS[at.skin].support : null;
    const look = support !== null ? SUPPORT_LOOK[support] : null;
    const shelf = look !== null && look.shelf;
    this.forklift.sync(f, dt, time, support);
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
    // and so do the empty shelves whose cue fits it (the cue, never the solution: only the destined box lights them).
    // In a sorting level or one with storage, when no free target takes it, the occupied ones that accept it breathe
    // very faintly instead: the box resting there could move on (a swap hint; with storage never on a target that
    // already glows). A stack level (a truck's) invites only as the next level of its column with everything below it
    // right (`loadable`, docs/DOCKS.md). With the hints off nothing invites (`hinted` null): each light eases out.
    const zones = snapshot.zones;
    const slots = snapshot.storageSlots;
    const hinted = this.targetHints ? carried : null;
    let anyTakes = false;
    if (hinted) {
      for (let i = 0; i < zones.length && !anyTakes; i++) anyTakes = takesNext(zones[i], hinted);
      for (let i = 0; i < slots.length && !anyTakes; i++) anyTakes = this.takesNow(slots[i]) && cueFits(slots[i], hinted);
    }
    const swapHint = (this.sorting || this.targetRules) && !anyTakes;
    // With storage the invitation is a strong pulse (views/success); the swap hint keeps its quiet strength.
    const swapInvite = this.targetRules ? TARGET_SWAP_INVITE : SWAP_INVITE;
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

    // Every storage level lights on its unit (render/storage: a rack slot's panel, a cell of a dock's sign), one list.
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const fits = hinted !== null && cueFits(slot, hinted);
      const invite = !fits ? 0 : this.takesNow(slot) ? 1 : swapHint && slot.occupiedBy !== null && !slot.satisfied ? swapInvite : 0;
      const unit = this.unitOfSlot[i];
      unit?.syncSlot(slot, invite, slotTone, time, dt);
      if (slot.satisfied && this.slotWasSatisfied[i] === false) this.playBurstInStorage(unit, slot, cameraYaw);
      this.slotWasSatisfied[i] = slot.satisfied;
    }
    for (let i = 0; i < this.bursts.length; i++) this.bursts[i].update(dt);
    // Units that move on their own (a conveyor belt's stripes while it runs).
    for (let i = 0; i < this.units.length; i++) this.units[i].animate?.(snapshot, dt);

    // The preview takes the carried box's zone tone when it would land on a zone that takes that box, on a shelf whose
    // cue fits it, or on a stack level (a truck bed's) that would take it now: loadable, its cue fitting (hint.storage
    // there is ready: the drop lands at the level chosen). Onto a shelf it floats on the shelf floor; the marker frames
    // the chosen level (a rack's shelf, a truck's sign cell) in that same tone.
    const chosen = at !== null && !snapshot.completed ? this.slotAt(snapshot, at.slotId) : null;
    // A locked box is done: its level never reads as ready to pick, and nothing previews on top of it.
    const lockedPick = carried === null && chosen !== null && chosen.occupiedBy !== null && isLocked(boxes, chosen.occupiedBy);
    const ready = at !== null && at.ready && !lockedPick;
    const dropCell = carried !== null && hint.dropCell !== null && !this.dropsOnLocked(boxes, hint.dropCell, hint.dropLevel) ? hint.dropCell : null;
    const intoShelf = carried !== null && shelf && chosen !== null && ready && dropCell !== null;
    const onStack = carried !== null && at !== null && !shelf && at.ready ? this.slotAt(snapshot, at.slotId) : null;
    let match: Color | null = null;
    if (carried && chosen && intoShelf) {
      if (cueFits(chosen, carried)) match = this.borders.get(carried.color) ?? null;
    } else if (carried && onStack) {
      if (onStack.loadable && cueFits(onStack, carried)) match = this.borders.get(carried.color) ?? null;
    } else if (carried) {
      const dropZone = hint.dropZoneId ? this.zoneStates.get(hint.dropZoneId) : undefined;
      if (dropZone && takesNext(dropZone, carried)) match = this.borders.get(carried.color) ?? null;
    }
    const topY = intoShelf && look ? look.levelY(hint.dropLevel, this.boxHeight) - ZONE.padHeight : hint.dropLevel * this.boxHeight;
    this.preview.sync(f.carrying ? dropCell : null, match, dt, topY, intoShelf ? SLOT_PREVIEW_SCALE : 1);
    // The marker of the chosen level's skin, where its unit frames it (every unit: the forks go by the keys).
    const worked = at !== null ? this.unitById.get(at.unitId) : undefined;
    const place = chosen !== null && worked ? worked.markerAt(chosen, this.markerPlace) : null;
    const tone = intoShelf || onStack !== null ? match : null;
    for (let i = 0; i < this.markers.length; i++) {
      const { skin, marker } = this.markers[i];
      marker.sync(at !== null && at.skin === skin ? place : null, ready, tone, dt);
    }

    if (this.beyond.length > 0) this.refreshRoomClip();
    this.updateOccluders(snapshot, cameraYaw, dt);
    if (this.stacking) this.updateStackGhosts(snapshot, cameraYaw, dt);
    if (this.shelved) this.updateSlotBoxGhosts(snapshot, dt);

    const shaftGain = 1 + 0.2 * warmth;
    for (let i = 0; i < this.walls.length; i++) this.walls[i].sync(cameraYaw, dt, false, shaftGain);
    for (let i = 0; i < this.beyond.length; i++) this.beyond[i].unit.follow(this.beyond[i].wall.heightScale);
    this.glassMaterial.color.setScalar(1 + 0.06 * warmth);
  }

  /** The storage slot `id` of this frame's snapshot (index kept from load: the list never changes during a level). */
  private slotAt(snapshot: GameSnapshot, id: string): StorageSlotState | null {
    const i = this.slotIndex.get(id);
    return i !== undefined ? (snapshot.storageSlots[i] ?? null) : null;
  }

  /** The unit of the storage slot `id` (index kept from load). */
  private unitOfSlotId(id: string): StorageUnitView | undefined {
    const i = this.slotIndex.get(id);
    return i !== undefined ? this.unitOfSlot[i] : undefined;
  }

  /** The storage slot `id` is a shelf of its own (its skin's support: a rack slot), not a stack level. */
  private onShelves(id: string | null | undefined): boolean {
    return id !== null && id !== undefined && this.slotSupport.get(id)?.shelf === true;
  }

  /**
   * The slot would take the carried box now, so its destined box would light it (what invites, with its cue): an empty
   * shelf; in a stack, its loadable level (the next one up, on right levels only).
   */
  private takesNow(slot: StorageSlotState): boolean {
    return this.onShelves(slot.id) ? slot.occupiedBy === null : slot.loadable;
  }

  /** The box rests on a storage shelf (a rack slot): not a stack, it ghosts with the piece holding it (its bay). */
  private onShelf(box: BoxState): boolean {
    return this.onShelves(box.slotId);
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
      if (b.slotId !== null && !this.onShelves(b.slotId)) {
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
        // together. Shelves (a rack's slots) hold one box each on a shelf of its own: nothing below dips.
        if (event.level > 0 && !this.onShelves(event.slotId)) {
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

  /**
   * Units beyond a wall (loading docks): the room side of every such wall that stands (as its unit saw it last frame),
   * for clipToRoom.
   */
  private refreshRoomClip(): void {
    this.roomMinX = -Infinity;
    this.roomMinZ = -Infinity;
    for (let i = 0; i < this.beyond.length; i++) {
      const unit = this.beyond[i].unit;
      if (!unit.stands) continue;
      if (unit.side === 'north') this.roomMinZ = -this.size.depth / 2;
      else this.roomMinX = -this.size.width / 2;
    }
  }

  /**
   * Clip an actor volume to the room side of every standing dock wall: what lies beyond one (on a truck bed, or the part
   * of the load already through the door) is hidden by the wall itself. False when nothing of it is left. Without
   * units beyond a wall, or with the wall sunk, the volume is untouched.
   */
  private clipToRoom(min: Vector3, max: Vector3): boolean {
    if (min.x < this.roomMinX) min.x = this.roomMinX;
    if (min.z < this.roomMinZ) min.z = this.roomMinZ;
    return min.x < max.x && min.z < max.z;
  }

  /**
   * Ghost every shelf or storage piece (a rack bay, a dock sign) that stands between the camera and the forklift, a
   * box or a zone, so tall furniture never hides what the player needs to see; back to solid once nothing is behind
   * it. Boxes reaching into a unit (in its levels, the load going in or out) never count: they ghost with it instead;
   * nor does what a standing dock wall already hides (clipToRoom).
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
   * Zones and storage levels with a cue (rack slots, truck levels) glow one after another, starting from the one
   * nearest the forklift (a stack glows bottom → top, and so does a rack column or a truck bed column).
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
    // Storage slots with a cue («libre» ones never light), in snapshot order: rack slots, then truck levels, each on its
    // unit. Same distance for a whole column: the stable sort keeps the snapshot order, bottom → top.
    for (const s of snapshot.storageSlots) {
      if (s.accepts === null) continue;
      const shelf = this.onShelves(s.id);
      const unit = this.unitById.get(s.unitId);
      order.push({
        d: distance(s.pos),
        play: (delay) => {
          unit?.playWave(s.id, delay);
          // Boxes in a stack (a bed column) only glow (no bob), so they keep touching.
          if (s.occupiedBy) this.boxViews.get(s.occupiedBy)?.playWave(delay, shelf);
        },
      });
    }
    order.sort((a, b) => a.d - b.d);
    order.forEach((t, i) => t.play(WAVE_START_DELAY + i * WAVE_STEP));
    this.forklift.playHappy(WAVE_START_DELAY);
  }

  /** Levels with storage: the success bursts, built once (a shared ring and sparkle geometry, materials per burst). */
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
   * A storage level just got its destined box (in a stack, on right levels below): a ring and sparkles, as the box
   * lands, where its unit says (render/storage `burstAt`: around a rack slot's opening, around the box on a truck's
   * bed), on the face the camera sees (a cue reads from both; a unit may turn its back to the camera).
   */
  private playBurstInStorage(unit: StorageUnitView | undefined, slot: StorageSlotState, cameraYaw: number): void {
    const tone = slot.destined ? this.sparkleTones.get(slot.destined.color) : undefined;
    if (!tone || !unit) return;
    const p = unit.burstAt(slot, cameraYaw, this.burstPlace);
    // As the box lands: a dropped box glides first; one a belt brings is already there (the unit's own delay).
    this.takeBurst()?.play('slot', p.x, p.y, p.z, p.yaw, tone, unit.landDelay ?? DROP_GLIDE_SEC, p.halfW, p.halfH);
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
      // Boxes on shelves ghost with their unit (updateSlotBoxGhosts); a truck bed's are a stack like any other.
      if (!view || this.onShelf(box)) continue;
      // Once complete (input frozen) every box turns solid, so the glow wave always plays on solid stacks.
      const hides = !snapshot.completed && !box.carried && box.level > 0 && box.cell !== null;
      view.setGhost(hides && this.stackBoxHides(box.cell!, view, snapshot, back), dt);
    }
  }

  /**
   * Levels with shelves (racks): a box on one fades with the piece holding it (its bay) while that hides the forklift or
   * its load (so the ghost is not blocked by solid boxes), solid again with it and once the level is complete. Without
   * stacking nothing else ghosts, so every other box is brought back to solid (a box just lifted out of a ghosted rack).
   */
  private updateSlotBoxGhosts(snapshot: GameSnapshot, dt: number): void {
    const boxes = snapshot.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      const view = this.boxViews.get(box.id);
      if (!view) continue;
      if (this.onShelf(box)) {
        const id = box.slotId!;
        view.setGhost(!snapshot.completed && (this.unitOfSlotId(id)?.hidesActorAt(id) ?? false), dt);
      } else if (!this.stacking) view.setGhost(false, dt);
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
    // What storage paints on the floor (a rack's loading line in front of every column), unit by unit.
    for (const unit of storageOf(level)) STORAGE_RENDER[unit.skin].paintFloor?.(floor, unit, level, theme);
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
   * Storage (docs/STORAGE.md): every unit of `level.storage`, in storage order, through its skin's entry in the
   * registry (render/storage STORAGE_RENDER), from its LevelStorage and its levels' states; one builder per skin, so
   * the units of a skin share their geometries (a rack: its bays, panels, stickers and bands; a truck: the dock plate,
   * the truck outside, the sign over its door with its cells, its rails). The boxes stored in any unit are ordinary
   * boxes (buildBoxes) at their state positions. From here on LevelView only speaks the units' common interface.
   */
  private buildStorage(snapshot: GameSnapshot, theme: Theme, mats: SharedMaterials): void {
    const level = snapshot.level;
    const ctx: StorageBuildContext = {
      level,
      theme,
      mats,
      bag: this.bag,
      depthOnly: this.depthOnly,
      landDelay: DROP_GLIDE_SEC,
      boxHeight: this.boxHeight,
      slotTones: this.slotTones,
      markOf: (criteria) => this.markOf(criteria),
      wall: (side) => {
        const wall = this.wallBySide.get(side);
        if (!wall) throw new Error(`LevelView: no ${side} wall for a storage unit`);
        return wall.view;
      },
    };
    const builders = new Map<StorageSkin, StorageUnitBuilder>();
    for (const unit of storageOf(level)) {
      let builder = builders.get(unit.skin);
      if (!builder) {
        builder = STORAGE_RENDER[unit.skin].builder(ctx);
        builders.set(unit.skin, builder);
      }
      const view = builder.build(unit, snapshot.storageSlots.filter((slot) => slot.unitId === unit.id));
      this.units.push(view);
      this.unitById.set(view.id, view);
      for (const occluder of view.occluders) this.addOccluder(occluder);
      if (view.beyondWall) this.beyond.push({ unit: view.beyondWall, wall: ctx.wall(view.beyondWall.side) });
      this.root.add(view.group);
    }
    snapshot.storageSlots.forEach((slot, i) => (this.unitOfSlot[i] = this.unitById.get(slot.unitId)));
  }

  /**
   * The chosen-level marker of each skin on screen (render/storage `markerGeometry`: a rack's shelf frame, a truck's
   * sign cell frame), in the warm light of the forklift's own lamps: where it is pointing its forks. Reads on boxes,
   * shaded slots and the dock sign.
   */
  private buildMarkers(level: LevelData, theme: Theme): void {
    for (const skin of new Set(storageOf(level).map((unit) => unit.skin))) {
      const entry = STORAGE_RENDER[skin];
      if (!entry.markerGeometry) continue;
      const material = createOverlayMaterial(this.bag, theme.forklift.light, 0);
      const marker = new SlotMarker(this.bag.track(entry.markerGeometry()), material, new Color(theme.forklift.light));
      marker.mesh.userData.markerSkin = skin;
      this.markers.push({ skin, marker });
      this.root.add(marker.mesh);
    }
  }

  private buildBoxes(snapshot: GameSnapshot, theme: Theme, config: GameConfig): void {
    const dims = boxDims(config);
    const geoByKey = new Map<string, BufferGeometry>();
    // The lid shows the box's own symbol: the small tone-on-tone glyph, or printed large where symbols sort.
    const mark: LidMark = this.sorting ? 'symbol' : 'glyph';
    // Levels with storage: a box locked on its destiny eases to its deeper tone (one tint per colour).
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
        // Stacked boxes ghost when they hide the forklift; boxes on shelves ghost with the piece holding them.
        this.stacking || this.shelved,
        lockTints.get(box.color) ?? null,
        this.slotSupport,
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

/** The box `id` is locked (done on its destiny, levels with storage). */
function isLocked(boxes: readonly BoxState[], id: string): boolean {
  for (let i = 0; i < boxes.length; i++) if (boxes[i].id === id) return boxes[i].locked;
  return false;
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
