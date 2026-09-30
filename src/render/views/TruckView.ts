import { Box3, Group, Mesh, type BufferGeometry, type Material, type MeshBasicMaterial, type MeshStandardMaterial, type Vector3 } from 'three';
import type { FitBox } from '../CameraRig';
import { RackBay, SlotLight, type SlotTone } from './RackView';

/** Below this height scale of its wall the sign stands over nothing (the lintel is gone): it ghosts softly. */
const SUNK_WALL = 0.5;

/**
 * One loading dock (docs/DOCKS.md, builders/truck), all in world space and all static (`group`): the dock plate in
 * the door (flat), the truck parked outside (low: it never hides the warehouse, so it never sinks with its wall; the
 * boxes on its bed are ordinary boxes at their state positions, BoxView) and the sign over the door.
 * The sign (`sign`, a RackBay: its frame and one glowing panel per level) fades like a rack bay when it hides the
 * forklift, a box or a zone, and softly whenever its wall is sunk (it then stands where the lintel was); per level,
 * the sticker (unlit, opaque: never fades, never dims) and a glow band round it. A level lights exactly like a rack
 * slot (RackView SlotLight): only with its destined box on satisfied levels below (`satisfied`), a flash as it lands,
 * then a soft steady glow; it pulses clearly while a box that fits its cue is carried and it is the next level of its
 * column (`loadable`).
 */
export class TruckView {
  readonly id: string;
  readonly group = new Group();
  readonly sign: RackBay;
  /** World bounds of everything it draws (the shadow volume). */
  readonly bounds = new Box3();
  /** Keeps the whole dock in frame at any camera turn (static: the frame never breathes for it). */
  readonly fitBox: FitBox;
  /**
   * The sign as LevelView sees it among the shelves and racks (its `bounds` and `holds`); `sync` adds the soft ghost
   * of a sunk wall to what it hides.
   */
  readonly occluder: {
    readonly bounds: Box3;
    readonly holds: Box3;
    sync(hiding: boolean, rank: number, dt: number, soft?: boolean): void;
  };
  private readonly lights = new Map<string, SlotLight>();
  private sunk = false;

  constructor(
    id: string,
    /** builders/truck buildDockPlate, buildTruckBody, buildSignFrame: world space. */
    plateGeometry: BufferGeometry,
    bodyGeometry: BufferGeometry,
    material: Material,
    signGeometry: BufferGeometry,
    /** The sign frame's own material (it fades on its own). */
    signMaterial: MeshStandardMaterial,
    depthOnly: Material,
    /**
     * The bed columns' volume outside the wall: a box on the bed or loaded into it never makes the sign ghost (from
     * inside the wall hides it anyway; from outside it stands in front of the sign).
     */
    holds: Box3,
    /** Delay before a level lights (lets the dropped box land first). */
    private readonly landDelay: number,
  ) {
    this.id = id;
    this.group.userData.truckId = id;

    const plate = new Mesh(plateGeometry, material);
    plate.receiveShadow = true;
    plate.userData.truckPlate = id;
    const body = new Mesh(bodyGeometry, material);
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData.truckBody = id;
    this.group.add(plate, body);
    this.sign = new RackBay(this.group, holds, 0, signGeometry, signMaterial, depthOnly, 'sign');
    plateGeometry.computeBoundingBox();
    bodyGeometry.computeBoundingBox();
    this.bounds.copy(plateGeometry.boundingBox!).union(bodyGeometry.boundingBox!).union(this.sign.bounds);
    this.fitBox = { min: this.bounds.min.clone(), max: this.bounds.max.clone(), heightScale: 1 };
    const sign = this.sign;
    this.occluder = {
      bounds: sign.bounds,
      holds,
      sync: (hiding, rank, dt, soft = false) => sign.sync(hiding || this.sunk, rank, dt, hiding ? soft : true),
    };
  }

  /**
   * A truck level on its sign cell: its panel (`panelGeometry`, `panelMaterial`: lit, glows, ghosts with the sign), its
   * sticker (`cueGeometry`, `cueMaterial`: unlit, opaque; glows with the panel, never fades) and its glow band
   * (`bandGeometry`, `bandMaterial`: hidden until it glows), all at the cell's centre `origin` (world), `yaw` turning
   * their local +z toward the warehouse; `destined` = its tones with its destined box.
   */
  addLevel(
    id: string,
    satisfied: boolean,
    origin: Vector3,
    yaw: number,
    panelGeometry: BufferGeometry,
    panelMaterial: MeshStandardMaterial,
    cueGeometry: BufferGeometry,
    cueMaterial: MeshBasicMaterial,
    bandGeometry: BufferGeometry,
    bandMaterial: MeshBasicMaterial,
    destined: SlotTone | null,
  ): void {
    const panel = this.sign.addPart(panelGeometry, panelMaterial);
    const cue = new Mesh(cueGeometry, cueMaterial);
    const band = new Mesh(bandGeometry, bandMaterial);
    band.renderOrder = 1;
    band.visible = false;
    for (const m of [panel, cue, band]) {
      m.position.copy(origin);
      m.rotation.y = yaw;
    }
    panel.userData.signPanel = id;
    cue.userData.truckCue = id;
    band.userData.truckGlow = id;
    this.group.add(cue, band);
    this.lights.set(id, new SlotLight({ satisfied }, panelMaterial, cueMaterial, band, bandMaterial, destined, this.landDelay));
  }

  /** `invite` 0‥1: how strongly the level pulses for the carried box; `carried` = that box's tones (null: none). */
  syncLevel(id: string, satisfied: boolean, invite: number, carried: SlotTone | null, time: number, dt: number): void {
    this.lights.get(id)?.sync(satisfied, invite, carried, time, dt);
  }

  /** Level complete: a level's panel and sticker pulse once, after `delay`. */
  playWave(id: string, delay: number): void {
    this.lights.get(id)?.playWave(delay);
  }

  /**
   * Its wall's height scale this frame (WallView: 1 standing, 0 sunk). Nothing of the dock sinks with it; the sign only
   * ghosts softly while the wall is down (read on the next occluder sync).
   */
  followWall(heightScale: number): void {
    this.sunk = heightScale < SUNK_WALL;
  }

  /** Its wall stands (see followWall): from the camera, it hides what lies beyond it, on the bed or in the door. */
  get wallStands(): boolean {
    return !this.sunk;
  }
}
