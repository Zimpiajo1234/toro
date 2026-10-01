import type { Box3, BufferGeometry, Group, Material } from 'three';
import type { ColorId, LevelData, LevelStorage, StorageSlotState, WallSide, ZoneCriteria } from '../../core/types';
import type { Theme } from '../../themes/types';
import type { ZoneMark } from '../builders/zone';
import type { FitBox } from '../CameraRig';
import type { SharedMaterials } from '../materials';
import type { PartList } from '../paint';
import type { ResourceBag } from '../resources';
import type { SlotTone } from '../views/RackView';
import type { WallView } from '../views/WallView';

/*
 * The render side of the shared storage model (docs/STORAGE.md «Contratos por capa», render): one entry per skin in
 * the registry (./index.ts STORAGE_RENDER), and one common interface for every unit it builds, whatever it looks like.
 * LevelView builds every unit of `level.storage` through its skin's entry and then only speaks this interface: the
 * lights of its levels, the chosen-level marker, the burst, its ghosting pieces, its static frame. Heights go by the
 * support of the skin (./support.ts), never by the skin itself.
 */

/**
 * A tall piece of furniture that fades to a ghost while it hides an actor (a wooden shelf, a rack bay, a dock sign):
 * LevelView ranks every one of them together, so overlapping ghosts still blend back to front.
 */
export interface Occluder {
  readonly bounds: Box3;
  /**
   * A storage unit's own volume (a rack's bounds, a truck's bed columns): a box reaching into it is the unit's (in one
   * of its levels, or the load going in or out) and never makes the piece ghost.
   */
  readonly holds?: Box3;
  /**
   * `hiding`: it covers an actor. `soft`: only resting boxes or zones (not the forklift or its load): a storage piece
   * then fades just a little (its cues never fade); a shelf ignores it.
   */
  sync(hiding: boolean, rank: number, dt: number, soft?: boolean): void;
}

/** Where the success burst of a storage level plays (views/success SuccessBurst.play in `slot` mode). */
export interface BurstPlace {
  x: number;
  y: number;
  z: number;
  /** Turns the burst's local +z toward the face of the level the camera sees. */
  yaw: number;
  /** Half the opening its ring hugs. */
  halfW: number;
  halfH: number;
}

/** Where the chosen-level marker (views/SlotMarker) frames a level: its origin, and the yaw turning its +z outward. */
export interface MarkerPlace {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/**
 * A unit that stands beyond a back wall (the `door` access: a truck outside its dock door). Every frame, after the walls
 * sync, LevelView hands it that wall's height scale; while the wall stands (as last followed) whatever lies beyond it
 * (a box on the bed, the part of the load through the door) is hidden by the wall, so it never makes a piece ghost.
 */
export interface BeyondWall {
  readonly side: WallSide;
  /** Its wall's height scale this frame (WallView: 1 standing, 0 sunk). */
  follow(heightScale: number): void;
  readonly stands: boolean;
}

/** One storage unit on screen, built by its skin's entry: all LevelView ever asks of it. */
export interface StorageUnitView {
  /** Its unit's id (LevelStorage.id). */
  readonly id: string;
  /** Everything it draws; LevelView adds it to the level's root (its userData names the unit: rackId, truckId). */
  readonly group: Group;
  /** World bounds of everything it draws: the shadow volume takes them in. */
  readonly bounds: Box3;
  /** Keeps the unit in frame at any camera turn: static, so nothing animated ever moves the frame for it. */
  readonly fitBox: FitBox;
  /** Its pieces that ghost while they hide an actor (a rack's bays, a dock's sign), in its own order. */
  readonly occluders: readonly Occluder[];
  /** The back wall it stands beyond, or null (a unit inside the room). */
  readonly beyondWall: BeyondWall | null;
  /**
   * The light of level `slot` (views/RackView SlotLight): `invite` 0‥1 = how strongly it pulses for the carried box,
   * `carried` = that box's tones (null when nothing is carried). A «libre» level has no light: nothing happens.
   */
  syncSlot(slot: StorageSlotState, invite: number, carried: SlotTone | null, time: number, dt: number): void;
  /** Level complete: level `slotId` pulses once, after `delay`. */
  playWave(slotId: string, delay: number): void;
  /** Where the burst of level `slot` plays, on the face the camera at `cameraYaw` sees (written into `out`). */
  burstAt(slot: StorageSlotState, cameraYaw: number, out: BurstPlace): BurstPlace;
  /**
   * Where the chosen-level marker frames level `slot` (written into `out`): a rack's shelf, a truck level's cell on its
   * dock sign (every unit: the forks go by the keys), or null (no marker there).
   */
  markerAt(slot: StorageSlotState, out: MarkerPlace): MarkerPlace | null;
  /**
   * The piece holding level `slotId` hides the forklift or its load this frame (a rack bay): a box resting on that
   * shelf ghosts with it. Asked for the levels of a shelves support only (a box in a stack ghosts as a stack).
   */
  hidesActorAt(slotId: string): boolean;
}

/** What LevelView lends every skin's builder: the level, its theme and resources, and a few shared looks. */
export interface StorageBuildContext {
  readonly level: LevelData;
  readonly theme: Theme;
  readonly mats: SharedMaterials;
  /** Owns every GPU resource the units create (the level's; disposed with it). */
  readonly bag: ResourceBag;
  /** Depth-only prepass shared by every piece that ghosts (shelves, rack bays, dock signs). */
  readonly depthOnly: Material;
  /** Seconds before a level lights once its box is dropped: the drop glide, so the box lands first. */
  readonly landDelay: number;
  /** Height of one stack level (the box's visual height). */
  readonly boxHeight: number;
  /** The tones a level lights in for a box of each colour (views/RackView SlotTone). */
  readonly slotTones: ReadonlyMap<ColorId, SlotTone>;
  /** What a cue shows in its middle: the level's own mark for its criteria (its colour's glyph, or its symbol). */
  markOf(criteria: ZoneCriteria): ZoneMark | null;
  /** The back wall of a side (always built before the storage). */
  wall(side: WallSide): WallView;
}

/** Builds one level's units of a skin, one per call, in storage order (its shared geometry caches live in it). */
export interface StorageUnitBuilder {
  /** `slots` = the unit's levels in snapshot.storageSlots order (column by column, bottom → top). */
  build(unit: LevelStorage, slots: readonly StorageSlotState[]): StorageUnitView;
}

/**
 * One skin's entry in the registry (./index.ts STORAGE_RENDER): how its units are drawn. Adding a skin = its rows in
 * core/storage (STORAGE_SKINS, STORAGE_WORDS) + an entry here and its builders (docs/STORAGE.md «Cómo añadir un
 * aspecto nuevo»).
 */
export interface StorageSkinRender {
  /** Paint on the floor for a unit (a rack's loading lines), merged into the level's floor mesh; absent = none. */
  paintFloor?(floor: PartList, unit: LevelStorage, level: LevelData, theme: Theme): void;
  /**
   * The chosen-level marker's geometry (views/SlotMarker: one per skin and level, shared by its units, in its local
   * space: see StorageUnitView.markerAt); absent = none of its units shows one.
   */
  markerGeometry?(): BufferGeometry;
  /** A builder for the skin's units of one level. */
  builder(ctx: StorageBuildContext): StorageUnitBuilder;
}
